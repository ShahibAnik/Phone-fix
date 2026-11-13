
(function(){
  const STORAGE_KEY = 'phoneRepairIntakes';
  const COUNTER_KEY = 'phoneRepairCounter';
  const PROFILES_KEY = 'phoneRepairCustomerProfiles';
  const DIRTY_REPAIRS_KEY = 'phoneRepairDirty';
  const GOOGLE_SHEET_URL = 'https://script.google.com/macros/s/AKfycbzLGnaehuE8rrtr2vL_cjOpaxedw5IS8NXD-zEWJdsUGgYYljToLY0ZjBgKVm7vosmn/exec';

  const $ = (id) => document.getElementById(id);

  const form = $('intakeForm');
  const fields = {
    name: $('custName'), phone: $('custPhone'), device: $('deviceModel'),
    code: $('devicePasscode'), price: $('repairPrice'), taxToggle: $('taxToggle'),
    isPaid: $('paymentStatus'), fixedBy: $('fixedBy'), notes: $('repairNotes'),
    boundCustId: $('boundCustomerId')
  };

  let currentTicket = null;
  let ticketReservation = null;
  let activeCustomerProfile = null;

  function pad(n, len){ return String(n).padStart(len, '0'); }
  function todayStamp(){ const d = new Date(); return `${d.getFullYear()}${pad(d.getMonth()+1,2)}${pad(d.getDate(),2)}`; }
  function niceDate(d){ return d.toLocaleDateString(undefined,{ month:'short', day:'2-digit', year:'numeric' }); }
  function niceTime(d){ return d.toLocaleTimeString(undefined,{ hour:'2-digit', minute:'2-digit' }); }
  function formatMoney(val){ const num = parseFloat(val); return isNaN(num) ? '$0.00' : `$${num.toFixed(2)}`; }

  function calculatePricing(rawSubtotal, applyTax){
    const sub = Math.max(0, parseFloat(rawSubtotal) || 0);
    const tax = applyTax ? Math.round(sub * 0.08 * 100) / 100 : 0;
    const total = sub + tax;
    return {
      subtotal: sub,
      tax: tax,
      total: total,
      subtotalFormatted: formatMoney(sub),
      taxFormatted: formatMoney(tax),
      totalFormatted: formatMoney(total)
    };
  }

  function nextTicketId(){
    const stamp = todayStamp();
    let counters = JSON.parse(localStorage.getItem(COUNTER_KEY) || '{}');
    const seq = (counters[stamp] || 0) + 1;
    return { id: `FIX-${stamp}-${pad(seq,4)}`, stamp, seq };
  }
  function observedTicketMaximum(stamp){
    var max = 0;
    getRecords().forEach(function(r){
      var m = new RegExp('^FIX-' + stamp + '-(\\d+)$').exec(String((r && r.id) || ''));
      if (m) max = Math.max(max, parseInt(m[1], 10) || 0);
    });
    return max;
  }
  function observedCustomerMaximum(){
    var max = 0, m;
    Object.keys(getProfiles()).forEach(function(k){ m=/^CUST-(\d+)$/.exec(k); if(m)max=Math.max(max,parseInt(m[1],10)||0); });
    getRecords().forEach(function(r){ m=/^CUST-(\d+)$/.exec(String((r&&r.customerId)||'')); if(m)max=Math.max(max,parseInt(m[1],10)||0); });
    return max;
  }
  async function reserveStoreTicketId(){
    if (new URLSearchParams(location.search).get('preview') === '1') return nextTicketId();
    var stamp = todayStamp();
    var result;
    try { PhoneFixAccess.assert('repair_create'); result = await PhoneFixAuth.request('/rest/v1/rpc/pf_reserve_ticket_id', { method:'POST', body:JSON.stringify({ minimum_value:observedTicketMaximum(stamp) }) }); }
    catch(err) { throw new Error('Ticket ID reservation failed: ' + (err.message || 'Please check your connection and repair creation access.')); }
    if (!result || !result.id) throw new Error('Could not reserve a store-wide Ticket ID. Check the connection and try again.');
    return result;
  }
  async function reserveStoreCustomerId(){
    if (new URLSearchParams(location.search).get('preview') === '1') return generateNextCustomerId();
    var result;
    try { PhoneFixAccess.assert('repair_create'); result = await PhoneFixAuth.request('/rest/v1/rpc/pf_reserve_customer_id', { method:'POST', body:JSON.stringify({ minimum_value:observedCustomerMaximum() }) }); }
    catch(err) { throw new Error('Customer ID reservation failed: ' + (err.message || 'Please check your connection and repair creation access.')); }
    if (!result || !result.id) throw new Error('Could not reserve a store-wide Customer ID. Check the connection and try again.');
    return result.id;
  }
  function commitTicketCounter(stamp, seq){
    let counters = JSON.parse(localStorage.getItem(COUNTER_KEY) || '{}');
    counters[stamp] = Math.max(counters[stamp] || 0, seq);
    localStorage.setItem(COUNTER_KEY, JSON.stringify(counters));
  }

  function getRecords(){ try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); } catch(e){ return []; } }
  function saveRecords(records){ try { localStorage.setItem(STORAGE_KEY, JSON.stringify(records)); return true; } catch(e){ alert('Storage is full. Export CSV and clear old delivered tickets, then retry.'); return false; } }

  function getProfiles(){ try { return JSON.parse(localStorage.getItem(PROFILES_KEY) || '{}'); } catch(e){ return {}; } }
  function saveProfiles(profiles){ localStorage.setItem(PROFILES_KEY, JSON.stringify(profiles)); }

  function generateNextCustomerId(){
    // Next ID = highest CUST-#### already used (profiles + tickets) + 1.
    // Strict 4-digit match: ignores junk IDs ('aser', 'CUST-00096', 'CUST-20260301')
    // so they can never poison the counter. Max over records too, so a fresh
    // device that just pulled the sheet never re-issues an existing ID.
    var max = 0;
    var m;
    Object.keys(getProfiles()).forEach(function(k){
      m = /^CUST-(\d{4})$/.exec(k);
      if (m) max = Math.max(max, parseInt(m[1], 10));
    });
    getRecords().forEach(function(r){
      m = /^CUST-(\d{4})$/.exec(r.customerId || '');
      if (m) max = Math.max(max, parseInt(m[1], 10));
    });
    return 'CUST-' + pad(max + 1, 4);
  }


  /* ---- repair two-way sync: every ticket change pushes status+timestamp to the sheet ---- */
  function repairStatusFor(r){
    if (r.isDelivered) return 'Delivered';
    var s = (typeof normQueueStatus === 'function') ? normQueueStatus(r) : (r.queueStatus || 'queued');
    if (r.selfIntake && s === 'queued') return 'Self-intake';
    return s === 'progress' ? 'Fixing' : s === 'ready' ? 'Ready for pickup' : 'Queued';
  }
  function repairBody(rec, deleted){
    var now = new Date();
    var body = { recordType:'repair', ticketId: rec.id, customerName: rec.name, phone: rec.phone,
      deviceModel: rec.device, passcode: rec.code, price: rec.price, priceFormatted: rec.priceFormatted,
      paymentStatus: rec.isPaid ? 'PAID' : 'DUE', fixedBy: rec.fixedBy, notes: rec.notes,
      dateTime: rec.dateDisplay, createdAtMs: rec.createdAt, status: repairStatusFor(rec),
      statusChangedAt: rec.statusChangedAt || (niceDate(now) + ' ' + niceTime(now)),
      customerId: rec.customerId || '', subtotal: rec.subtotal, taxAmount: rec.taxAmount,
      isTaxable: rec.isTaxable, warrantyDays: rec.warrantyDays, queueSerial: rec.queueSerial,
      queueDay: rec.queueDay, priority: rec.priority, readyBy: rec.readyBy, readyByLabel: rec.readyByLabel,
      deliveredDay: rec.deliveredDay, rating: rec.rating, reviewText: rec.reviewText, intakeAt: rec.intakeAt };
    if (deleted) body.deleted = true;
    return body;
  }
  function pushRepair(rec, deleted){
    if(!GOOGLE_SHEET_URL || !rec) return;
    var body = repairBody(rec, deleted);
    var dm = rdDirty(); dm[rec.id] = { t: Date.now(), del: !!deleted }; wrDirty(dm);
    var t0 = Date.now(), rid = rec.id;
    if (!deleted) pushWarranty(rec.id, rec.warrantyDays, false);
    try { return fetch(GOOGLE_SHEET_URL, { method:'POST', mode:'no-cors', headers:{'Content-Type':'text/plain;charset=utf-8'}, body: JSON.stringify(body) })
      .then(function(){ var m = rdDirty(); if (m[rid] && m[rid].t <= t0) { delete m[rid]; wrDirty(m); } return true; })
      .catch(function(){return false;}); } catch(e){return Promise.resolve(false);}
  }

  // Durable public check-ins are imported by an authorized staff session.
  // The stable ID and local dirty queue make retries safe; never replace an existing ticket.
  let publicCheckinBusy=false;
  async function syncPublicCheckins(){
    if(publicCheckinBusy || new URLSearchParams(location.search).get('preview')==='1' || !PhoneFixAccess.can('repair_create') || PhoneFixAccess.locked)return;
    publicCheckinBusy=true;
    try{
      const pending=await PhoneFixAuth.request('/rest/v1/rpc/pf_public_checkin_pending',{method:'POST',body:'{}'});
      for(const item of pending){
        const rows=getRecords();let record=rows.find(r=>r.id===item.record.id);
        if(!record){record=item.record;rows.push(record);if(!saveRecords(rows))break;}
        if(await pushRepair(record))await PhoneFixAuth.request('/rest/v1/rpc/pf_public_checkin_ack',{method:'POST',body:JSON.stringify({request_id:item.requestId})});
      }
      if(pending.length){renderHistory($('searchHistory').value);renderQueue();window.dispatchEvent(new Event('pf:data'));}
    }catch(err){console.warn('Public check-in sync pending:',err.message);}
    finally{publicCheckinBusy=false;}
  }
  setTimeout(syncPublicCheckins,2000);setInterval(syncPublicCheckins,30000);window.addEventListener('online',syncPublicCheckins);

  /* ---- repeat-issue detection: same phone + same model in within the last 30 days ---- */
  function normModel_(s){ return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ''); }
  function findRepeat(phoneRaw, deviceRaw, beforeTs, excludeId){
    var cp = cleanPhone(phoneRaw);
    var dm = normModel_(deviceRaw);
    if (cp.length < 10 || !dm) return null;
    var best = null;
    getRecords().forEach(function(r){
      if (!r || typeof r !== 'object' || r.id === excludeId) return;
      if (cleanPhone(r.phone) !== cp) return;
      if (normModel_(r.device) !== dm) return;
      var t = r.createdAt || 0;
      if (!t || t >= beforeTs) return;
      if (beforeTs - t > 30 * 86400000) return;
      if (!best || t > (best.createdAt || 0)) best = r;
    });
    return best;
  }
  function repeatWarrantyNote(prev){
    if (!prev || !prev.createdAt) return '';
    var days = (typeof normWarranty === 'function') ? normWarranty(prev.warrantyDays) : 7;
    if (!days) return '';
    var end = prev.createdAt + days * 86400000;
    return end > Date.now() ? (' Previous repair is still under warranty until ' + niceDate(new Date(end)) + '.') : '';
  }
  function checkRepeatIssue(){
    var box = $('repeatWarn');
    if (!box) return;
    var prev = (typeof fields !== 'undefined' && fields.phone && fields.device)
      ? findRepeat(fields.phone.value, fields.device.value, Date.now(), null) : null;
    if (!prev){ box.style.display = 'none'; box.innerHTML = ''; return; }
    box.innerHTML = '⚠️ <b>Repeat issue?</b> This customer had the same model in on ' + escapeHtml(prev.dateDisplay || '')
      + ' — ticket <b>' + escapeHtml(prev.id) + '</b> (' + escapeHtml(repairStatusFor(prev)) + ').'
      + escapeHtml(repeatWarrantyNote(prev)) + ' Check the old ticket before quoting.';
    box.style.display = 'block';
  }

  /* ---------- Warranty sheet sync ("Warranty Days" column; fire-and-forget + outbox) ---------- */
  var WARRANTY_OUTBOX_KEY = 'phoneRepairWarrantyOutbox', WARRANTY_BACKFILL_KEY = 'phoneRepairWarrantyBackfilled';
  function wrWarranty(k, v){ try { localStorage.setItem(k, JSON.stringify(v)); } catch(e){} }
  function rdWarranty(k, d){ try { var v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch(e){ return d; } }
  function queueWarranty(ticketId, warrantyDays, onlyIfBlank){
    var outbox = rdWarranty(WARRANTY_OUTBOX_KEY, []);
    var entry = { ticketId: ticketId, warrantyDays: normWarranty(warrantyDays), onlyIfBlank: !!onlyIfBlank };
    var ix = -1;
    outbox.forEach(function(e, i){ if (e.ticketId === ticketId && !!e.onlyIfBlank === !!onlyIfBlank) ix = i; });
    if (ix >= 0) outbox[ix] = entry; else outbox.push(entry);
    wrWarranty(WARRANTY_OUTBOX_KEY, outbox);
  }
  function pushWarranty(ticketId, warrantyDays, onlyIfBlank){
    if (!GOOGLE_SHEET_URL || !ticketId) return;
    queueWarranty(ticketId, warrantyDays, onlyIfBlank);
    flushWarrantyOutbox();
  }
  function flushWarrantyOutbox(onDone){
    var outbox = rdWarranty(WARRANTY_OUTBOX_KEY, []);
    if (!outbox.length || !navigator.onLine){ if (onDone) onDone(false); return; }
    wrWarranty(WARRANTY_OUTBOX_KEY, []);
    var groups = {};
    outbox.forEach(function(e){
      var k = e.onlyIfBlank ? 'blank' : 'force';
      (groups[k] = groups[k] || []).push({ ticketId: e.ticketId, warrantyDays: e.warrantyDays });
    });
    var keys = Object.keys(groups), failed = [], allOk = true;
    (function next(){
      var k = keys.shift();
      if (!k){ if (failed.length) wrWarranty(WARRANTY_OUTBOX_KEY, failed); if (onDone) onDone(allOk && !failed.length); return; }
      try {
        fetch(GOOGLE_SHEET_URL, { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({ recordType: 'warranty', onlyIfBlank: k === 'blank', rows: groups[k] }) })
          .then(function(){ next(); })
          .catch(function(){
            allOk = false;
            groups[k].forEach(function(r){ failed.push({ ticketId: r.ticketId, warrantyDays: r.warrantyDays, onlyIfBlank: k === 'blank' }); });
            next();
          });
      } catch(e){
        allOk = false;
        groups[k].forEach(function(r){ failed.push({ ticketId: r.ticketId, warrantyDays: r.warrantyDays, onlyIfBlank: k === 'blank' }); });
        next();
      }
    })();
  }
  /* One-time backfill: every local record's warranty goes up; the sheet fills blanks only. */
  function warrantyBackfillOnce(){
    if (rdWarranty(WARRANTY_BACKFILL_KEY, false)) return;
    var recs = [];
    try { recs = getRecords(); } catch(e){}
    recs.forEach(function(r){ if (r && r.id) queueWarranty(r.id, r.warrantyDays, true); });
    flushWarrantyOutbox(function(ok){ if (ok) wrWarranty(WARRANTY_BACKFILL_KEY, true); });
  }

  // ---------- sheet -> app: pull repairs on startup (cross-device) ----------
  function stampMs(s){
    if(!s) return 0;
    var t = Date.parse(s);
    if(isFinite(t)) return t;
    var m = String(s).match(/(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
    return m ? new Date(+m[1], +m[2]-1, +m[3], +m[4], +m[5]).getTime() : 0;
  }
  function rdDirty(){ try { return JSON.parse(localStorage.getItem(DIRTY_REPAIRS_KEY) || '{}') || {}; } catch(e){ return {}; } }
  function wrDirty(m){ try { localStorage.setItem(DIRTY_REPAIRS_KEY, JSON.stringify(m)); } catch(e){} }
  function flushRepairs(){
    if (!navigator.onLine) return;
    var d = rdDirty(), ids = Object.keys(d); if (!ids.length) return;
    var recs = getRecords();
    ids.forEach(function(id){
      if (d[id].del) { pushRepair({ id: id }, true); return; }
      var r = recs.find(function(x){ return x.id === id; });
      if (r) pushRepair(r); else { var m = rdDirty(); delete m[id]; wrDirty(m); }
    });
  }
  function fixDT(v){
    if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)) { var d = new Date(v); if (!isNaN(d.getTime())) return niceDate(d) + ' ' + niceTime(d); }
    return v || '';
  }
  function fillMoney(r){
    if (r.totalFormatted) return;
    var p = Number(r.price) || 0;
    r.subtotal = p; r.subtotalFormatted = formatMoney(p); r.taxAmount = 0; r.taxFormatted = '$0.00';
    r.totalAmount = p; r.totalFormatted = formatMoney(p); r.priceFormatted = formatMoney(p); r.isTaxable = false;
  }
  function pullRepairs(){
    if(!GOOGLE_SHEET_URL) return;
    try { if(!navigator.onLine) return; } catch(e){}
    var ctl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var timer = setTimeout(function(){ if(ctl) ctl.abort(); }, 15000);
    fetch(GOOGLE_SHEET_URL + '?action=repairs', ctl ? { signal: ctl.signal } : {})
      .then(function(r){ if(!r.ok) throw new Error('http ' + r.status); return r.json(); })
      .then(function(data){
        var arr = Array.isArray(data) ? data : (data && (data.data || data.rows));
        if(!Array.isArray(arr)) return;
        var records = getRecords();
        if(!arr.length && records.length) return; // empty sheet: never wipe local tickets
        var byId = {};
        records.forEach(function(r){ if(r && r.id) byId[r.id] = r; });
        var changed = false;
        arr.forEach(function(o){
          if(!o || !o.ticketId) return;
          var id = String(o.ticketId);
          var m = id.match(/FIX-(\d{8})-(\d{4})/);
          if(m) commitTicketCounter(m[1], parseInt(m[2], 10));
          var st = String(o.status || '').toLowerCase();
          var isDel = st === 'delivered';
          var pc = o.passcode;
          var mapped = {
            id: id, name: o.customerName || '', phone: o.phone || '', device: o.deviceModel || '',
            code: (pc == null) ? '' : String(pc),
            price: parseFloat(o.price) || 0,
            isPaid: String(o.paymentStatus || '').toUpperCase() === 'PAID',
            fixedBy: o.fixedBy || '', notes: o.notes || '',
            dateDisplay: fixDT(o.dateTime), createdAt: Number(o.createdAtMs) || Date.now(),
            customerId: o.customerId || '',
            queueStatus: isDel ? 'ready' : (st === 'fixing' ? 'progress' : (st.indexOf('ready') === 0 ? 'ready' : 'queued')),
            isDelivered: isDel,
            deliveredAt: isDel ? (o.statusChangedAt || '') : null,
            statusChangedAt: o.statusChangedAt || '',
            selfIntake: st === 'self-intake'
          };
          if (isDel) { var _ms = stampMs(o.statusChangedAt); mapped.deliveredDay = _ms ? dayStampOf(_ms) : null; }
          function has(v){ return v !== undefined && v !== null && v !== ''; }
          if (has(o.taxAmount)) {
            mapped.subtotal = Number(o.subtotal) || 0; mapped.taxAmount = Number(o.taxAmount) || 0; mapped.totalAmount = mapped.price;
            mapped.isTaxable = o.isTaxable === true || String(o.isTaxable).toUpperCase() === 'TRUE';
            mapped.subtotalFormatted = formatMoney(mapped.subtotal); mapped.taxFormatted = formatMoney(mapped.taxAmount);
            mapped.totalFormatted = formatMoney(mapped.price); mapped.priceFormatted = mapped.totalFormatted;
          }
          if (has(o.warrantyDays)) mapped.warrantyDays = Number(o.warrantyDays);
          if (has(o.queueSerial)) { mapped.queueSerial = Number(o.queueSerial); mapped.queueDay = String(o.queueDay || ''); mapped.readyBy = Number(o.readyBy) || null; mapped.readyByLabel = o.readyByLabel || ''; }
          if (has(o.priority)) mapped.priority = o.priority === true || String(o.priority).toUpperCase() === 'TRUE';
          if (has(o.rating)) mapped.rating = Number(o.rating);
          if (has(o.reviewText)) mapped.reviewText = String(o.reviewText);
          if (has(o.intakeAt)) mapped.intakeAt = String(o.intakeAt);
          fillMoney(mapped);
          var cur = byId[id];
          if(!cur){ fillMoney(mapped); records.push(mapped); byId[id] = mapped; changed = true; }
          else if(stampMs(mapped.statusChangedAt) > stampMs(cur.statusChangedAt)){
            if(!mapped.customerId) mapped.customerId = cur.customerId || '';
            if (!mapped.totalFormatted && Number(mapped.price) !== Number(cur.totalAmount)) { ['subtotal','subtotalFormatted','taxAmount','taxFormatted','totalAmount','totalFormatted','priceFormatted'].forEach(function(k){ delete cur[k]; }); }
            Object.assign(cur, mapped); fillMoney(cur); changed = true;
          }
          // Customer ID syncs independently of status timestamps: the sheet is the
          // shared source of truth for the ID, so a non-empty sheet ID always wins.
          // This is also how old local records adopt their backfilled IDs on next pull.
          if(cur && o.customerId && cur.customerId !== o.customerId){
            cur.customerId = o.customerId; changed = true;
          }
          // Price syncs independently of status timestamps too: the sheet is the
          // shared source of truth, so an edited or backfilled sheet price always
          // wins even when the ticket status did not change.
          if(cur && cur.price !== mapped.price){
            cur.price = mapped.price;
            cur.totalFormatted = mapped.totalFormatted;
            cur.priceFormatted = mapped.priceFormatted;
            cur.subtotalFormatted = mapped.subtotalFormatted;
            changed = true;
          }
        });
        if(changed){
          saveRecords(records);
          var sh = $('searchHistory');
          renderHistory(sh ? sh.value : '');
          queueTick(true);
        }
      })
      .catch(function(){})
      .then(function(){ clearTimeout(timer); });
  }

  function formatPhone(value){
    const d = value.replace(/\D/g,'').slice(0,10);
    if (d.length <= 3) return d;
    if (d.length <= 6) return `(${d.slice(0,3)}) ${d.slice(3)}`;
    return `(${d.slice(0,3)}) ${d.slice(3,6)}-${d.slice(6)}`;
  }
  function cleanPhone(val){ return (val || '').replace(/\D/g,''); }

  function computeCustomerLTV(customerId){
    const records = getRecords().filter(r => r.customerId === customerId);
    const visits = records.length;
    let spend = 0;
    records.forEach(r => {
      const val = parseFloat(r.totalAmount || r.price) || 0;
      if(r.isPaid) spend += val;
    });
    return { visits, spend, records };
  }

  function getLtvTier(visits, spend){
    if(visits >= 4 || spend >= 250) return { label: `VIP · ${visits}th Visit`, cls: 'ltv-vip' };
    if(visits >= 2) return { label: `Returning · ${visits}th Visit`, cls: 'ltv-return' };
    return { label: '1st Visit', cls: 'ltv-new' };
  }

  function findExistingProfile(phoneRaw, nameRaw){
    const clPhone = cleanPhone(phoneRaw);
    const profiles = getProfiles();
    const records = getRecords();

    if(clPhone.length >= 10){
      for(const id in profiles){
        const prof = profiles[id];
        if(cleanPhone(prof.primaryPhone) === clPhone) return prof;
        if(prof.phoneHistory && prof.phoneHistory.some(ph => cleanPhone(ph.phone) === clPhone)) return prof;
      }
    }

    const normName = (nameRaw || '').trim().toLowerCase();
    if(normName.length > 2 && clPhone.length < 10){
      for(const id in profiles){
        if(profiles[id].primaryName.toLowerCase() === normName) return profiles[id];
      }
    }

    if(clPhone.length >= 10){
      const matchRec = records.find(r => cleanPhone(r.phone) === clPhone);
      if(matchRec){
        if (!matchRec.customerId) return null;
        const newCustId = matchRec.customerId;
        const created = {
          customerId: newCustId,
          primaryName: matchRec.name,
          primaryPhone: matchRec.phone,
          phoneHistory: [],
          changeLog: [{ text: 'Initial intake created', timestamp: matchRec.dateDisplay }]
        };
        profiles[newCustId] = created;
        saveProfiles(profiles);
        return created;
      }
    }

    return null;
  }

  function triggerCustomerLookup(){
    const pVal = fields.phone.value;
    const nVal = fields.name.value;
    const profile = findExistingProfile(pVal, nVal);

    const banner = $('customerMatchBanner');
    if(!profile){
      banner.style.display = 'none';
      fields.boundCustId.value = '';
      activeCustomerProfile = null;
      $('nextCustBadge').textContent = 'Next shared ID';
      checkRepeatIssue();
      updatePreview();
      return;
    }

    activeCustomerProfile = profile;
    fields.boundCustId.value = profile.customerId;
    $('nextCustBadge').textContent = profile.customerId;

    if(!fields.name.value.trim()){
      fields.name.value = profile.primaryName;
    }

    $('matchCustName').textContent = profile.primaryName;
    $('matchCustId').textContent = profile.customerId;

    const ltv = computeCustomerLTV(profile.customerId);
    $('matchVisitCount').textContent = ltv.visits;
    $('matchLtvSpend').textContent = formatMoney(ltv.spend);

    if(ltv.records.length > 0){
      ltv.records.sort((a,b) => b.createdAt - a.createdAt);
      $('matchLastVisit').textContent = ltv.records[0].dateDisplay;
    } else {
      $('matchLastVisit').textContent = 'Recent';
    }

    const devList = $('matchDevicesList');
    devList.innerHTML = '';
    const uniqueDevices = [...new Set(ltv.records.map(r => r.device).filter(Boolean))];
    if(uniqueDevices.length > 0){
      $('matchDevicesWrap').style.display = 'flex';
      uniqueDevices.forEach(d => {
        const chip = document.createElement('span');
        chip.className = 'preset-chip';
        chip.textContent = d;
        chip.onclick = () => {
          fields.device.value = d;
          const matchedTicket = ltv.records.find(r => r.device === d);
          if(matchedTicket && matchedTicket.code && !fields.code.value.trim()){
            fields.code.value = matchedTicket.code;
          }
          updatePreview();
          checkRepeatIssue();
        };
        devList.appendChild(chip);
      });
    } else {
      $('matchDevicesWrap').style.display = 'none';
    }

    const typedClPhone = cleanPhone(pVal);
    const primClPhone = cleanPhone(profile.primaryPhone);
    if(typedClPhone.length >= 10 && typedClPhone !== primClPhone){
      $('phoneChangePrompt').style.display = 'flex';
    } else {
      $('phoneChangePrompt').style.display = 'none';
    }

    banner.style.display = 'block';
    checkRepeatIssue();
    updatePreview();
  }

  $('dismissMatchBtn').addEventListener('click', () => {
    $('customerMatchBanner').style.display = 'none';
  });

  $('applyPhoneChangeBtn').addEventListener('click', () => {
    if(!activeCustomerProfile) return;
    const newPhone = fields.phone.value.trim();
    const oldPhone = activeCustomerProfile.primaryPhone;
    const now = new Date();
    const stamp = `${niceDate(now)} ${niceTime(now)}`;

    const profiles = getProfiles();
    const p = profiles[activeCustomerProfile.customerId];
    if(!p.phoneHistory) p.phoneHistory = [];

    p.phoneHistory.push({ phone: oldPhone, replacedAt: stamp });
    p.primaryPhone = newPhone;
    if(!p.changeLog) p.changeLog = [];
    p.changeLog.push({ text: `Phone changed from ${oldPhone} to ${newPhone}`, timestamp: stamp });

    saveProfiles(profiles);
    activeCustomerProfile = p;
    $('phoneChangePrompt').style.display = 'none';
    alert(`Customer phone updated to ${newPhone}. Previous number recorded.`);
  });

  $('viewMatchProfileBtn').addEventListener('click', () => {
    if(activeCustomerProfile) openProfileModal(activeCustomerProfile.customerId);
  });

  document.querySelectorAll('.preset-chip[data-target]').forEach(chip => {
    chip.addEventListener('click', () => {
      const targetId = chip.dataset.target;
      $(targetId).value = chip.dataset.val;
      updatePreview();
    });
  });

  document.querySelectorAll('.preset-chip[data-append]').forEach(chip => {
    chip.addEventListener('click', () => {
      const targetId = chip.dataset.append;
      const el = $(targetId);
      const val = chip.dataset.val;
      if(el.value.trim()){
        el.value = el.value.trim() + ', ' + val;
      } else {
        el.value = val;
      }
      updatePreview();
    });
  });

  function reserveNewTicket(){
    currentTicket = null;
    $('nextIdBadge').textContent = 'Reserving…';
    ticketReservation = reserveStoreTicketId().then(function(ticket){
      currentTicket = ticket;
      $('nextIdBadge').textContent = ticket.id;
      $('nextCustBadge').textContent = activeCustomerProfile ? activeCustomerProfile.customerId : ('Next shared ID');
      updatePreview();
      return ticket;
    }).catch(function(err){
      ticketReservation = null;
      $('nextIdBadge').textContent = err.message || 'Ticket ID reservation failed';
      throw err;
    });
    ticketReservation.catch(function(){});
    return ticketReservation;
  }

  function updatePreview(){
    const now = new Date();
    const id = currentTicket ? currentTicket.id : 'FIX-00000000-0000';
    const custId = activeCustomerProfile ? activeCustomerProfile.customerId : ($('nextCustBadge').textContent || 'CUST-0000');
    const name = fields.name.value.trim() || 'Customer name';
    const phone = fields.phone.value.trim() || '—';
    const device = fields.device.value.trim() || '—';
    const code = fields.code.value.trim() || '—';
    const isPaid = fields.isPaid.checked;
    const fixedBy = fields.fixedBy.value.trim() || '—';
    const notes = fields.notes.value.trim() || '—';

    const pricing = calculatePricing(fields.price.value, fields.taxToggle.checked);

    $('displaySubtotal').textContent = pricing.subtotalFormatted;
    $('displayTax').textContent = pricing.taxFormatted;
    $('displayTotal').textContent = pricing.totalFormatted;

    $('pvTicket').textContent = id;
    $('pvCustId').textContent = custId;
    $('pvDate').textContent = niceDate(now) + ' · ' + niceTime(now);
    $('pvName').textContent = name;
    $('pvPhone').textContent = phone;
    $('pvDevice').textContent = device;
    $('pvCode').textContent = code;
    $('pvPrice').textContent = pricing.totalFormatted;
    $('pvFixedBy').textContent = fixedBy;
    $('pvNotes').textContent = notes;

    const statusTxt = isPaid ? 'PAID' : 'DUE';
    $('paymentStatusText').textContent = statusTxt;
    $('paymentStatusText').style.color = isPaid ? 'var(--green)' : 'var(--amber)';

    $('pvStatusBadge').textContent = statusTxt;
    $('pvStatusBadge').className = 'badge ' + (isPaid ? 'badge-paid' : 'badge-due');

    const ltv = computeCustomerLTV(custId);
    const tier = getLtvTier(ltv.visits + 1, ltv.spend + (isPaid ? pricing.total : 0));
    $('pvLtvBadge').textContent = tier.label;
    $('pvLtvBadge').className = `badge-ltv ${tier.cls}`;

    renderBarcode('barcodeSvg', id);
  }

  function renderBarcode(elId, value){
    try{
      JsBarcode('#'+elId, value, { format:'CODE128', displayValue:false, margin:0, height:34, width:1.8, background:'transparent', lineColor:'#141A21' });
    }catch(e){}
  }

  function tickClock(){ const now = new Date(); $('clockBadge').textContent = `${niceDate(now)} · ${niceTime(now)}`; }
  tickClock(); setInterval(tickClock, 1000*15);

  fields.phone.addEventListener('input', (e) => {
    e.target.value = formatPhone(e.target.value);
    triggerCustomerLookup();
    updatePreview();
  });
  fields.name.addEventListener('input', () => {
    triggerCustomerLookup();
    updatePreview();
  });

  ['input','change'].forEach(evt => {
    fields.device.addEventListener(evt, updatePreview);
    fields.device.addEventListener(evt, checkRepeatIssue);
    fields.code.addEventListener(evt, updatePreview);
    fields.price.addEventListener(evt, updatePreview);
    fields.taxToggle.addEventListener(evt, updatePreview);
    fields.isPaid.addEventListener(evt, updatePreview);
    fields.fixedBy.addEventListener(evt, updatePreview);
    fields.notes.addEventListener(evt, updatePreview);
  });

  function flashSaved(){
    const badge = $('savedBadge');
    badge.style.display = 'inline-flex';
    clearTimeout(flashSaved._t);
    flashSaved._t = setTimeout(() => { badge.style.display = 'none'; }, 2400);
  }

  function toggleDelivered(id, isChecked){
    if(!PhoneFixAccess.can('ticket_edit')) { alert("You don't have permission for this."); return; }
    const records = getRecords();
    const idx = records.findIndex(r => r.id === id);
    if (idx > -1) {
      records[idx].isDelivered = isChecked;
      if (isChecked) {
        const now = new Date();
        records[idx].deliveredAt = `${niceDate(now)} ${niceTime(now)}`;
        records[idx].statusChangedAt = `${niceDate(now)} ${niceTime(now)}`;
        records[idx].deliveredDay = todayStamp();
      } else {
        records[idx].deliveredAt = null;
        records[idx].deliveredDay = null;
        records[idx].statusChangedAt = `${niceDate(new Date())} ${niceTime(new Date())}`;
      }
      saveRecords(records);
      pushRepair(records[idx]);
      renderHistory($('searchHistory').value);
    }
  }

  function togglePaid(id, isChecked){
    if(!PhoneFixAccess.can('ticket_pay')) { alert("You don't have permission for this."); return; }
    const records = getRecords();
    const idx = records.findIndex(r => r.id === id);
    if (idx > -1) {
      records[idx].isPaid = isChecked;
      saveRecords(records);
      pushRepair(records[idx]);
      renderHistory($('searchHistory').value);
    }
  }

  function deleteTicket(id){
    if(!PhoneFixAccess.can('ticket_delete')) { alert("You don't have permission for this."); return; }
    if(!confirm(`Are you sure you want to delete ticket ${id}?`)) return;
    const records = getRecords().filter(r => r.id !== id);
    saveRecords(records);
    try { var _u = readPartUsage(), _keep = []; _u.forEach(function(u){ if (u && u.ticketId === id) { if (typeof window.__invReturnPart === 'function') window.__invReturnPart(u.sku, u.qty); } else _keep.push(u); }); savePartUsage(_keep); } catch(e){}
    pushRepair({id:id}, true);
    renderHistory($('searchHistory').value);
  }

  function starSVG(filled){
    return `<svg class="${filled ? 'star-fill' : 'star-empty'}"><use href="#starIcon"/></svg>`;
  }
  function starsHtml(rating){
    rating = Number(rating) || 0;
    let out = '<span class="stars">';
    for(let i=1;i<=5;i++){ out += starSVG(i <= rating); }
    out += '</span>';
    return out;
  }

  function sqlLikeMatch(record, tokens, profiles){
    const prof = profiles[record.customerId] || {};
    const oldPhones = prof.phoneHistory ? prof.phoneHistory.map(ph => cleanPhone(ph.phone)).join(' ') : '';
    const currentProfPhone = cleanPhone(prof.primaryPhone || '');

    const pool = [
      record.id,
      record.customerId || '',
      record.name,
      cleanPhone(record.phone),
      record.phone,
      currentProfPhone,
      oldPhones,
      record.device,
      record.fixedBy || '',
      record.notes || '',
      record.dateDisplay || '',
      record.intakeAt || ''
    ].join(' ').toLowerCase();

    return tokens.every(token => pool.includes(token));
  }

  function renderHistory(filter){
    const records = getRecords().slice().sort((a,b) => b.createdAt - a.createdAt);
    const profiles = getProfiles();
    const q = (filter || '').trim().toLowerCase();
    const tokens = q.split(/\s+/).filter(Boolean);

    const filtered = tokens.length > 0
      ? records.filter(r => sqlLikeMatch(r, tokens, profiles))
      : records;

    $('historyCount').textContent = records.length;
    const ltvMap = {};
    records.forEach(x => { if (!x.customerId) return; const m = ltvMap[x.customerId] || (ltvMap[x.customerId] = { visits: 0, spend: 0 }); m.visits++; if (x.isPaid) m.spend += parseFloat(x.totalAmount || x.price) || 0; });
    const body = $('historyBody');
    const mobileList = $('historyMobileList');
    body.innerHTML = '';
    mobileList.innerHTML = '';

    $('emptyState').style.display = filtered.length === 0 ? 'block' : 'none';

    filtered.forEach(r => {
      const isPaid = r.isPaid;
      const rating = r.rating || 0;
      const reviewText = r.reviewText || '';
      const nameColor = r.isDelivered ? 'color:var(--green);' : '';
      const deliveredTimeHtml = (r.isDelivered && r.deliveredAt)
        ? `<span class="delivery-time">Out: ${escapeHtml(r.deliveredAt)}</span>`
        : '';
      const intakeTimeHtml = `<span class="intake-time">In: ${escapeHtml(r.intakeAt || r.dateDisplay)}</span>`;

      const reviewCellHtml = rating > 0
        ? `${starsHtml(rating)}${reviewText ? `<div class="review-quote">"${escapeHtml(reviewText)}"</div>` : ''}`
        : `<span class="no-review">Not rated</span>`;

      const custLtv = ltvMap[r.customerId] || { visits: 0, spend: 0 };
      const tier = getLtvTier(custLtv.visits, custLtv.spend);
      const repPrev = findRepeat(r.phone, r.device, r.createdAt || Date.now(), r.id);
      const flagBadges = (r.selfIntake ? ' <span class="badge badge-selfin">📝 Self-intake</span>' : '')
        + (repPrev ? ` <span class="badge badge-repeat" title="Same model in on ${escapeHtml(repPrev.dateDisplay || '')} — ${escapeHtml(repPrev.id)}">↻ Repeat</span>` : '');
      const dispTotal = r.totalFormatted || r.priceFormatted || '$0.00';

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td class="col-status">
          <label style="display:inline-flex;align-items:center;gap:0.35rem;cursor:pointer;">
            <input type="checkbox" data-id="${escapeHtml(r.id)}" class="deliver-toggle" style="width:14px;height:14px;accent-color:var(--blue);" ${r.isDelivered ? 'checked' : ''}>
            <span class="badge ${r.isDelivered ? 'badge-delivered' : 'badge-inshop'}">${r.isDelivered ? 'Delivered' : 'In shop'}</span>
          </label>
          ${deliveredTimeHtml}
        </td>
        <td class="col-customer">
          <div style="font-weight:600;${nameColor}">${r.customerId ? `<button type="button" class="xlink" data-xlink="dossier" data-cust="${escapeHtml(r.customerId)}" title="Open customer dossier" style="font-weight:600;${nameColor}">${escapeHtml(r.name)}</button>` : escapeHtml(r.name)}</div>
          <div class="mono" style="font-size:0.72rem;color:#9C9585;">${escapeHtml(r.phone)}</div>
          <span class="badge-ltv ${tier.cls}">${tier.label}</span>${flagBadges}
        </td>
        <td class="col-device" style="color:var(--ink-soft);">${escapeHtml(r.device)}</td>
        <td class="col-price">
          <div class="mono" style="font-weight:700;">${escapeHtml(dispTotal)}</div>
          <label style="display:inline-flex;align-items:center;gap:0.35rem;cursor:pointer;margin-top:0.25rem;">
            <input type="checkbox" data-id="${escapeHtml(r.id)}" class="paid-toggle" style="width:14px;height:14px;accent-color:var(--green);" ${isPaid ? 'checked' : ''}>
            <span class="badge ${isPaid ? 'badge-paid' : 'badge-due'}">${isPaid ? 'Paid' : 'Due'}</span>
          </label>
        </td>
        <td class="col-tech" style="color:var(--ink-soft);">${escapeHtml(r.fixedBy || '—')}</td>
        <td class="col-action">
          <div class="action-grid">
            <button data-cust="${escapeHtml(r.customerId)}" class="row-btn profile profileBtn">Profile</button>
            <button data-id="${escapeHtml(r.id)}" class="row-btn rate rateBtn">Rate</button>
            <button data-id="${escapeHtml(r.id)}" class="row-btn reprintBtn">Print</button>
            <button data-id="${escapeHtml(r.id)}" class="row-btn edit editBtn">Edit</button>
            <button data-id="${escapeHtml(r.id)}" class="row-btn del delBtn">Delete</button>
          </div>
        </td>
        <td class="col-review">${reviewCellHtml}</td>
        <td class="col-ticket mono" style="color:#8A8272;">
          <div><button type="button" class="xlink mono" data-xlink="ticket" data-id="${escapeHtml(r.id)}" title="Go to ticket" style="font-weight:700;">${escapeHtml(r.id)}</button></div>
          <div style="font-size:0.68rem;color:var(--purple);">${escapeHtml(r.customerId || 'CUST-0000')}</div>
          ${intakeTimeHtml}
        </td>
      `;
      body.appendChild(tr);

      const card = document.createElement('div');
      card.className = 'mob-card';
      card.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;">
          <div>
            <span class="mono" style="font-size:0.78rem;font-weight:700;"><button type="button" class="xlink mono" data-xlink="ticket" data-id="${escapeHtml(r.id)}" title="Go to ticket" style="font-weight:700;">${escapeHtml(r.id)}</button></span>
            <span class="mono" style="font-size:0.72rem;font-weight:700;color:var(--purple);margin-left:0.4rem;">${escapeHtml(r.customerId || '')}</span>
          </div>
          <label style="display:inline-flex;align-items:center;gap:0.35rem;cursor:pointer;">
            <input type="checkbox" data-id="${escapeHtml(r.id)}" class="paid-toggle" style="width:14px;height:14px;accent-color:var(--green);" ${isPaid ? 'checked' : ''}>
            <span class="badge ${isPaid ? 'badge-paid' : 'badge-due'}">${isPaid ? 'Paid' : 'Due'}</span>
          </label>
        </div>
        <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-top:0.4rem;">
          <div>
            <div style="font-weight:700;font-size:0.88rem;${nameColor}">${r.customerId ? `<button type="button" class="xlink" data-xlink="dossier" data-cust="${escapeHtml(r.customerId)}" title="Open customer dossier" style="font-weight:700;font-size:0.88rem;${nameColor}">${escapeHtml(r.name)}</button>` : escapeHtml(r.name)}</div>
            <div class="mono" style="font-size:0.72rem;color:#9C9585;">${escapeHtml(r.phone)} · <span style="font-family:'Inter',sans-serif;">${escapeHtml(r.device)}</span></div>
            <span class="badge-ltv ${tier.cls}">${tier.label}</span>${flagBadges}
          </div>
          <span class="mono" style="font-weight:700;font-size:0.88rem;">${escapeHtml(dispTotal)}</span>
        </div>
        <div style="margin-top:0.3rem;font-size:0.7rem;color:#9C9585;">
          ${intakeTimeHtml}
        </div>
        <div style="margin-top:0.5rem;">${reviewCellHtml}</div>
        <div style="display:flex;align-items:flex-start;justify-content:space-between;padding-top:0.5rem;margin-top:0.5rem;border-top:1px dashed var(--line);">
          <div>
            <label style="display:inline-flex;align-items:center;gap:0.4rem;cursor:pointer;">
              <input type="checkbox" data-id="${escapeHtml(r.id)}" class="deliver-toggle" style="width:14px;height:14px;accent-color:var(--blue);" ${r.isDelivered ? 'checked' : ''}>
              <span class="badge ${r.isDelivered ? 'badge-delivered' : 'badge-inshop'}">${r.isDelivered ? 'Delivered' : 'In shop'}</span>
            </label>
            ${deliveredTimeHtml}
          </div>
          <span style="font-size:0.72rem;color:#9C9585;">Tech: ${escapeHtml(r.fixedBy || '—')}</span>
        </div>
        <div style="display:flex;gap:0.35rem;margin-top:0.55rem;justify-content:flex-end;">
          <div class="action-grid" style="max-width:140px;width:100%;">
            <button data-cust="${escapeHtml(r.customerId)}" class="row-btn profile profileBtn">Profile</button>
            <button data-id="${escapeHtml(r.id)}" class="row-btn rate rateBtn">Rate</button>
            <button data-id="${escapeHtml(r.id)}" class="row-btn reprintBtn">Print</button>
            <button data-id="${escapeHtml(r.id)}" class="row-btn edit editBtn">Edit</button>
            <button data-id="${escapeHtml(r.id)}" class="row-btn del delBtn">Delete</button>
          </div>
        </div>
      `;
      mobileList.appendChild(card);
    });

    document.querySelectorAll('.deliver-toggle').forEach(chk => chk.addEventListener('change', (e) => toggleDelivered(e.target.dataset.id, e.target.checked)));
    document.querySelectorAll('.paid-toggle').forEach(chk => chk.addEventListener('change', (e) => togglePaid(e.target.dataset.id, e.target.checked)));
    document.querySelectorAll('.reprintBtn').forEach(btn => btn.addEventListener('click', () => reprintTicket(btn.dataset.id)));
    document.querySelectorAll('.editBtn').forEach(btn => btn.addEventListener('click', () => openHistoryModal('edit', btn.dataset.id)));
    document.querySelectorAll('.rateBtn').forEach(btn => btn.addEventListener('click', () => openHistoryModal('edit', btn.dataset.id)));
    document.querySelectorAll('.profileBtn').forEach(btn => btn.addEventListener('click', () => openProfileModal(btn.dataset.cust)));
    document.querySelectorAll('.delBtn').forEach(btn => btn.addEventListener('click', () => deleteTicket(btn.dataset.id)));

    renderNotDelivered();
  }

  function daysWaiting(createdAt){
    const now = Date.now();
    const ms = now - (createdAt || now);
    return Math.max(0, Math.floor(ms / 86400000));
  }
  function daysLabel(days){
    if(days <= 0) return 'Today';
    if(days === 1) return '1 day at store';
    return `${days} days at store`;
  }

  function renderNotDelivered(){
    const sortSelect = $('ndSort');
    const sortMode = sortSelect ? sortSelect.value : 'days-desc';

    const records = getRecords().filter(r => !r.isDelivered).map(r => ({
      ...r, __days: daysWaiting(r.createdAt)
    }));

    records.sort((a, b) => {
      switch(sortMode){
        case 'date-asc': return a.createdAt - b.createdAt;
        case 'date-desc': return b.createdAt - a.createdAt;
        case 'days-asc': return a.__days - b.__days;
        case 'amount-asc': return (parseFloat(a.totalAmount || a.price)||0) - (parseFloat(b.totalAmount || b.price)||0);
        case 'amount-desc': return (parseFloat(b.totalAmount || b.price)||0) - (parseFloat(a.totalAmount || a.price)||0);
        case 'name-asc': return (a.name||'').localeCompare(b.name||'');
        case 'name-desc': return (b.name||'').localeCompare(a.name||'');
        case 'days-desc':
        default: return b.__days - a.__days;
      }
    });

    const list = $('ndList');
    const empty = $('ndEmpty');
    list.innerHTML = '';

    let totalValue = 0, totalDue = 0;
    records.forEach(r => {
      const price = parseFloat(r.totalAmount || r.price) || 0;
      totalValue += price;
      if(!r.isPaid) totalDue += price;
    });

    $('ndCount').textContent = records.length;
    $('ndTotalValue').textContent = `$${totalValue.toFixed(2)}`;
    $('ndTotalDue').textContent = `$${totalDue.toFixed(2)}`;

    if(records.length === 0){
      empty.style.display = 'block';
      return;
    }
    empty.style.display = 'none';

    records.forEach(r => {
      const price = parseFloat(r.totalAmount || r.price) || 0;
      const item = document.createElement('div');
      item.className = 'nd-item';
      item.innerHTML = `
        <div class="nd-item-left">
          <button type="button" class="nd-cust-link ndJumpBtn" data-jump="${escapeHtml(r.id)}">${escapeHtml(r.name || 'Unknown')}</button>
          <button type="button" class="nd-phone-link ndJumpBtn" data-jump="${escapeHtml(r.id)}">${escapeHtml(r.phone || '—')}</button>
          <span class="nd-item-device">${escapeHtml(r.device || '—')}</span>
          <span class="nd-item-date">Received ${escapeHtml(r.intakeAt || r.dateDisplay || '—')}</span>
        </div>
        <div class="nd-item-right">
          <span class="nd-item-days ${r.__days >= 7 ? 'warn' : ''}">${daysLabel(r.__days)}</span>
          <span class="nd-item-amount">${formatMoney(price)}</span>
          <span class="badge ${r.isPaid ? 'badge-paid' : 'badge-due'}" style="margin-top:0.2rem;">${r.isPaid ? 'Paid' : 'Due'}</span>
        </div>
      `;
      list.appendChild(item);
    });

    document.querySelectorAll('.ndJumpBtn').forEach(btn => btn.addEventListener('click', () => jumpToHistoryRecord(btn.dataset.jump)));
  }

  function jumpToHistoryRecord(ticketId){
    if(!ticketId) return;
    $('searchHistory').value = ticketId;
    renderHistory(ticketId);
    const ledgerEl = document.querySelector('.ledger');
    if(ledgerEl) ledgerEl.scrollIntoView({ behavior:'smooth', block:'start' });
    setTimeout(() => {
      const chk = document.querySelector(`.deliver-toggle[data-id="${CSS.escape(ticketId)}"]`);
      const rowEl = chk ? (chk.closest('tr') || chk.closest('.mob-card')) : null;
      if(rowEl){
        rowEl.classList.add('row-flash');
        setTimeout(() => rowEl.classList.remove('row-flash'), 1700);
      }
    }, 350);
  }

  function escapeHtml(str){ return String(str).replace(/[&<>"']/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s])); }

  function reprintTicket(id){
    const records = getRecords();
    const record = records.find(r => r.id === id);
    if(!record) return;

    const now = new Date();
    record.reprintedAt = `${niceDate(now)} ${niceTime(now)}`;
    saveRecords(records);

    populatePrintLabel(record);
    window.print();
  }

  function populatePrintLabel(record){
    const statusTxt = record.isPaid ? 'PAID' : 'DUE';
    const totalStr = record.totalFormatted || record.priceFormatted || '$0.00';
    const subStr = record.subtotalFormatted || record.priceFormatted || '$0.00';
    const taxStr = record.taxFormatted || '$0.00';

    $('prTicketTop').textContent = record.id;
    $('prCustTop').textContent = record.customerId || 'CUST-0000';
    $('prDateTop').textContent = record.intakeAt || record.dateDisplay;
    $('prNameTop').textContent = record.name;
    $('prStatusTop').textContent = statusTxt;
    $('prPhoneTop').textContent = record.phone;
    $('prPriceTop').textContent = totalStr;
    $('prDeviceTop').textContent = record.device;
    $('prCodeTop').textContent = record.code || '—';
    $('prFixedByTop').textContent = record.fixedBy || '—';
    $('prNotesTop').textContent = record.notes || '—';
    const wDays = normWarranty(record.warrantyDays);
    $('prWarrantyTop').textContent = wDays === 0 ? 'No warranty' : warrantyText(wDays) + ' (valid until ' + warrantyEndStr(record) + ')';
    renderBarcode('prBarcodeTop', record.id);

    $('prTicketBtm').textContent = record.id;
    $('prCustBtm').textContent = record.customerId || 'CUST-0000';
    $('prDateBtm').textContent = record.intakeAt || record.dateDisplay;
    $('prNameBtm').textContent = record.name;
    $('prStatusBtm').textContent = statusTxt;
    $('prDeviceBtm').textContent = record.device;
    $('prPhoneBtm').textContent = record.phone;
    $('prSubtotalBtm').textContent = subStr;
    $('prTaxBtm').textContent = taxStr;
    $('prTotalBtm').textContent = totalStr;
    const brEl = $('prBreakBtm');
    if (brEl){
      const showBr = Number(record.priorityFee) > 0 && record.fixingPrice != null;
      brEl.hidden = !showBr;
      if (showBr) brEl.textContent = 'Fixing ' + formatMoney(record.fixingPrice) + ' + Priority ' + formatMoney(record.priorityFee) + ' = ' + formatMoney(record.subtotal);
    }
    $('prWarrantyBtm').innerHTML = 'Warranty: ' + (wDays === 0 ? 'No warranty' : warrantyText(wDays) + ' (valid until ' + warrantyEndStr(record) + ')') + '<br>' + escapeHtml("Warranty doesn't cover any physical damage and water damage.");
    renderBarcode('prBarcodeBtm', record.id);
    fillQueueOnLabel(record);
  }

  /* ---- Warranty (7-day default; custom timeline picker; prints on the token) ---- */
  let intakeWarranty = 7;
  let hmWarranty = 7;
  function normWarranty(v){
    const n = parseInt(v, 10);
    if (!isFinite(n)) return 7;
    return Math.max(0, Math.min(3650, n));
  }
  function warrantyText(days){
    days = normWarranty(days);
    return days === 0 ? 'No warranty' : days + (days === 1 ? ' day' : ' days');
  }
  function warrantyEndStr(record){
    let base = null;
    if (record && record.createdAt) base = new Date(record.createdAt);
    else if (record && (record.intakeAt || record.dateDisplay)) base = new Date(record.intakeAt || record.dateDisplay);
    if (!base || isNaN(base.getTime())) base = new Date();
    return niceDate(new Date(base.getTime() + normWarranty(record ? record.warrantyDays : 7) * 86400000));
  }
  function setIntakeWarranty(days){
    intakeWarranty = normWarranty(days);
    const lbl = $('warrantyBtnLabel'); if (lbl) lbl.textContent = warrantyText(intakeWarranty);
    const c = $('warrantyCustom'); if (c) c.value = intakeWarranty;
  }
  function setHmWarranty(days){
    hmWarranty = normWarranty(days);
    const lbl = $('hmWarrantyBtnLabel'); if (lbl) lbl.textContent = warrantyText(hmWarranty);
    const c = $('hmWarrantyCustom'); if (c) c.value = hmWarranty;
  }
  $('warrantyBtn').addEventListener('click', () => {
    const p = $('warrantyPicker');
    p.style.display = (p.style.display === 'none' || !p.style.display) ? 'flex' : 'none';
  });
  $('warrantyPicker').addEventListener('click', (e) => {
    const b = e.target.closest('[data-w]'); if (!b) return;
    setIntakeWarranty(b.getAttribute('data-w'));
    $('warrantyPicker').style.display = 'none';
  });
  $('warrantyApply').addEventListener('click', () => {
    setIntakeWarranty($('warrantyCustom').value);
    $('warrantyPicker').style.display = 'none';
  });
  $('hmWarrantyBtn').addEventListener('click', () => {
    const p = $('hmWarrantyPicker');
    p.style.display = (p.style.display === 'none' || !p.style.display) ? 'flex' : 'none';
  });
  $('hmWarrantyPicker').addEventListener('click', (e) => {
    const b = e.target.closest('[data-w]'); if (!b) return;
    setHmWarranty(b.getAttribute('data-w'));
    $('hmWarrantyPicker').style.display = 'none';
  });
  $('hmWarrantyApply').addEventListener('click', () => {
    setHmWarranty($('hmWarrantyCustom').value);
    $('hmWarrantyPicker').style.display = 'none';
  });

  /* ---- Parts used on a ticket (read from the parts usage log; local only) ---- */
  function readPartUsage(){ try { return JSON.parse(localStorage.getItem('phoneRepairPartUsage') || '[]'); } catch(e){ return []; } }
  function savePartUsage(list){ try { localStorage.setItem('phoneRepairPartUsage', JSON.stringify(list || [])); } catch(e){} }
  function renderHmPartsUsed(){
    const el = $('hmPartsUsed'); if (!el) return;
    el.innerHTML = partsUsedHtml(hm.recordId.value || '');
  }
  function partsUsedHtml(ticketId){
    if (!ticketId) return 'No parts linked to this ticket yet.';
    const list = readPartUsage();
    const rows = [];
    list.forEach((u, idx) => { if (u && u.ticketId === ticketId) rows.push({ u, idx }); });
    if (!rows.length) return 'No parts linked to this ticket yet.';
    let total = 0;
    const html = rows.map(({ u, idx }) => {
      const line = (Number(u.qty) || 0) * (Number(u.cost) || 0); total += line;
      const label = [u.model, u.type, u.color].filter(Boolean).join(' · ') || (u.sku || 'Part');
      return '<div style="display:flex;justify-content:space-between;align-items:center;gap:0.5rem;padding:0.15rem 0;">' +
        '<span>' + escapeHtml(label) + ' — ' + escapeHtml(u.sku || '') + '</span>' +
        '<span style="display:flex;align-items:center;gap:0.3rem;">' +
        '<button type="button" class="tool-btn" data-uact="dec" data-uidx="' + idx + '">−</button><b>×' + (Number(u.qty) || 0) + '</b>' +
        '<button type="button" class="tool-btn" data-uact="inc" data-uidx="' + idx + '">+</button>' +
        '<span style="min-width:4.5rem;text-align:right;">' + formatMoney(line) + '</span>' +
        '<button type="button" class="tool-btn" data-uact="del" data-uidx="' + idx + '">✕</button></span></div>';
    }).join('');
    return html + '<div style="display:flex;justify-content:space-between;border-top:1px dashed var(--line);margin-top:0.3rem;padding-top:0.3rem;"><b>Total parts cost</b><b>' + formatMoney(total) + '</b></div>';
  }
  $('hmPartsUsed').addEventListener('click', (e) => {
    const b = e.target.closest('[data-uact]'); if (!b) return;
    const idx = parseInt(b.getAttribute('data-uidx'), 10), act = b.getAttribute('data-uact');
    const list = readPartUsage();
    const entry = list[idx]; if (!entry) return;
    const sku = entry.sku, q = Number(entry.qty) || 0;
    const pushU = (en) => { if (typeof window.__invPushUsage === 'function') window.__invPushUsage(en); };
    if (act === 'inc'){
      entry.qty = q + 1;
      if (typeof window.__invTakePart === 'function') window.__invTakePart(sku, 1);
      pushU(entry);
    } else if (act === 'dec'){
      entry.qty = q - 1;
      if (typeof window.__invReturnPart === 'function') window.__invReturnPart(sku, 1);
      if (entry.qty <= 0){ list.splice(idx, 1); pushU({ id: entry.id, deleted: true }); }
      else pushU(entry);
    } else if (act === 'del'){
      if (typeof window.__invReturnPart === 'function') window.__invReturnPart(sku, q);
      list.splice(idx, 1);
      pushU({ id: entry.id, deleted: true });
    }
    savePartUsage(list);
    renderHmPartsUsed();
  });

  /* ---- Add a part to the ticket from the history edit modal ----
     Search reuses the intake picker's matching; Add runs the same
     __invUsePart path (deduct stock, queue To Order, log + push usage). */
  let hmPartSel = '';
  function renderHmPartResults(){
    const box = $('hmPartResults'); if (!box) return;
    const q = $('hmPartSearch').value;
    const all = typeof window.__invPartsList === 'function' ? window.__invPartsList() : [];
    const matches = all.filter(p => intakePartMatches(p, q))
      .sort((a, b) => (a.model || '').localeCompare(b.model || '') || (a.type || '').localeCompare(b.type || '')).slice(0, 50);
    box.innerHTML = matches.map(p =>
      '<div class="ip-result" data-sku="' + escapeHtml(p.sku) + '" style="padding:0.4rem 0.5rem;font-size:0.78rem;cursor:pointer;border-bottom:1px solid #f0ece3;">' +
      escapeHtml(intakePartLabel(p)) + '</div>').join('') ||
      '<div style="font-size:0.78rem;color:#777;padding:0.3rem;">No parts match. Try fewer words.</div>';
  }
  $('hmPartAddBtn').addEventListener('click', () => {
    const pk = $('hmPartPicker'); pk.hidden = !pk.hidden;
    if (!pk.hidden){
      hmPartSel = ''; $('hmPartSearch').value = ''; $('hmPartQty').value = 1;
      renderHmPartResults();
      setTimeout(() => $('hmPartSearch').focus(), 30);
    }
  });
  $('hmPartSearch').addEventListener('input', () => { hmPartSel = ''; renderHmPartResults(); });
  $('hmPartResults').addEventListener('mousedown', (e) => {
    const row = e.target.closest('.ip-result'); if (!row) return;
    e.preventDefault();
    hmPartSel = row.getAttribute('data-sku');
    const all = typeof window.__invPartsList === 'function' ? window.__invPartsList() : [];
    const p = all.find(x => x.sku === hmPartSel);
    $('hmPartSearch').value = p ? intakePartLabel(p) : hmPartSel;
    $('hmPartResults').innerHTML = '';
    $('hmPartQty').focus();
  });
  $('hmPartAddGo').addEventListener('click', () => {
    if (!hmPartSel) { $('hmPartSearch').focus(); return; }
    const ticketId = (typeof hm !== 'undefined' && hm.recordId && hm.recordId.value) || '';
    const qty = Math.max(1, parseInt($('hmPartQty').value, 10) || 1);
    if (typeof window.__invUsePart === 'function') window.__invUsePart(hmPartSel, ticketId, qty);
    hmPartSel = ''; $('hmPartSearch').value = ''; $('hmPartQty').value = 1; $('hmPartPicker').hidden = true;
    renderHmPartsUsed();
  });

  /* ---- Parts used on this intake (dropdown from inventory; attaches on save) ---- */
  let intakeParts = []; // { sku, qty } — not yet saved; stock/order/usage update on submit
  function intakePartsTotal(){
    const all = typeof window.__invPartsList === 'function' ? window.__invPartsList() : [];
    let total = 0;
    intakeParts.forEach(it => {
      const p = all.find(x => x.sku === it.sku);
      if (p) total += (Number(it.qty) || 0) * (Number(p.cost) || 0);
    });
    return total;
  }
  function renderIntakeParts(){
    const all = typeof window.__invPartsList === 'function' ? window.__invPartsList() : [];
    $('intakePartsList').innerHTML = intakeParts.map((it, i) => {
      const p = all.find(x => x.sku === it.sku);
      const label = p ? (p.model + ' — ' + p.type + (p.color ? ' • ' + p.color : '')) : it.sku;
      const cost = p ? (Number(p.cost) || 0) : 0;
      return '<div style="display:flex;justify-content:space-between;align-items:center;gap:0.5rem;background:var(--paper);border:1.5px solid var(--line);border-radius:8px;padding:0.3rem 0.6rem;font-size:0.78rem;">' +
        '<span>' + escapeHtml(label) + ' — <b>' + escapeHtml(it.sku) + '</b></span>' +
        '<span style="display:flex;align-items:center;gap:0.3rem;">' +
        '<button type="button" class="tool-btn" data-ip="dec" data-i="' + i + '">−</button><b>' + it.qty + '</b>' +
        '<button type="button" class="tool-btn" data-ip="inc" data-i="' + i + '">+</button>' +
        '<span style="min-width:4.5rem;text-align:right;">' + (PhoneFixAccess.can('costs_view')?formatMoney(it.qty * cost):'Hidden') + '</span>' +
        '<button type="button" class="tool-btn" data-ip="del" data-i="' + i + '">✕</button></span></div>';
    }).join('');
    $('intakePartsTotal').textContent = intakeParts.length ? ('Parts total: ' + formatMoney(intakePartsTotal())) : '';
  }
  /* ---- Parts search box (live filter: every typed word must match somewhere) ---- */
  let intakePartSel = ''; // SKU of the picked part (must pick a row; typing alone doesn't select)
  let intakePartHi = -1;  // keyboard-highlighted row index
  function intakePartWordMatch(hay, word){
    if (hay.indexOf(word) >= 0) return true; // exact partial
    if (word.length < 3) return false; // too short for fuzzy matching
    let j = 0; // subsequence: letters appear in order ("blk" ~ "black")
    for (let i = 0; i < hay.length && j < word.length; i++) if (hay[i] === word[j]) j++;
    return j === word.length;
  }
  function intakePartMatches(p, q){
    if (!q) return true;
    const hay = ((p.model || '') + ' ' + (p.type || '') + ' ' + (p.color || '') + ' ' + (p.sku || '') + ' ' + (p.brand || '')).toLowerCase();
    return q.toLowerCase().split(/\s+/).filter(Boolean).every(t => intakePartWordMatch(hay, t));
  }
  function intakePartLabel(p){
    return p.model + ' — ' + p.type + (p.color ? ' • ' + p.color : '') + ' (' + p.qty + ' in stock) — ' + (PhoneFixAccess.can('costs_view')?formatMoney(p.cost):'Hidden');
  }
  function intakePartHiHtml(text, q){
    const needle = (q || '').trim();
    if (!needle || /\s/.test(needle) || needle.length < 2) return escapeHtml(text);
    const idx = text.toLowerCase().indexOf(needle.toLowerCase());
    if (idx < 0) return escapeHtml(text);
    return escapeHtml(text.slice(0, idx)) + '<mark>' + escapeHtml(text.slice(idx, idx + needle.length)) + '</mark>' + escapeHtml(text.slice(idx + needle.length));
  }
  function renderIntakePartResults(){
    const box = $('intakePartResults'); if (!box) return;
    const q = $('intakePartSearch').value;
    const all = typeof window.__invPartsList === 'function' ? window.__invPartsList() : [];
    const matches = all.filter(p => intakePartMatches(p, q)).sort((a, b) => (a.model || '').localeCompare(b.model || '') || (a.type || '').localeCompare(b.type || ''));
    intakePartHi = -1;
    if (!matches.length){
      box.innerHTML = '<div style="padding:0.6rem 0.8rem;font-size:0.8rem;color:#777;">No parts match. Try fewer words.</div>';
    } else {
      const shown = matches.slice(0, 150);
      box.innerHTML = shown.map((p, i) => {
        return '<div class="ip-result" data-sku="' + escapeHtml(p.sku) + '" data-i="' + i + '" style="padding:0.5rem 0.8rem;font-size:0.8rem;cursor:pointer;border-bottom:1px solid #f0ece3;">' + intakePartHiHtml(intakePartLabel(p), q) + '</div>';
      }).join('') + (matches.length > 150 ? '<div style="padding:0.4rem 0.8rem;font-size:0.72rem;color:#777;">+' + (matches.length - 150) + ' more — keep typing to narrow.</div>' : '');
    }
    box.hidden = false;
  }
  function hideIntakePartResults(){ const box = $('intakePartResults'); if (box) box.hidden = true; }
  function pickIntakePart(sku){
    const all = typeof window.__invPartsList === 'function' ? window.__invPartsList() : [];
    const p = all.find(x => x.sku === sku); if (!p) return;
    intakePartSel = sku;
    $('intakePartSearch').value = intakePartLabel(p);
    hideIntakePartResults();
    $('intakePartQty').focus();
  }
  function markIntakePartRow(i){
    const box = $('intakePartResults'); if (!box) return;
    const rows = box.querySelectorAll('.ip-result');
    intakePartHi = i;
    rows.forEach((r, j) => { r.style.background = (j === i) ? '#FFE3C2' : ''; });
  }
  $('intakePartSearch').addEventListener('input', () => { intakePartSel = ''; renderIntakePartResults(); });
  $('intakePartSearch').addEventListener('focus', () => { renderIntakePartResults(); });
  $('intakePartSearch').addEventListener('blur', () => { setTimeout(hideIntakePartResults, 150); });
  $('intakePartSearch').addEventListener('keydown', (e) => {
    const box = $('intakePartResults');
    const rows = box ? box.querySelectorAll('.ip-result') : [];
    if (e.key === 'ArrowDown'){ e.preventDefault(); if (box) box.hidden = false; markIntakePartRow(Math.min(intakePartHi + 1, rows.length - 1)); }
    else if (e.key === 'ArrowUp'){ e.preventDefault(); markIntakePartRow(Math.max(intakePartHi - 1, 0)); }
    else if (e.key === 'Enter'){
      e.preventDefault();
      const row = rows[intakePartHi >= 0 ? intakePartHi : 0];
      if (row) pickIntakePart(row.getAttribute('data-sku'));
    }
    else if (e.key === 'Escape'){ hideIntakePartResults(); }
  });
  $('intakePartResults').addEventListener('mousedown', (e) => {
    const row = e.target.closest('.ip-result'); if (!row) return;
    e.preventDefault();
    pickIntakePart(row.getAttribute('data-sku'));
  });
  $('intakePartAdd').addEventListener('click', () => {
    const sku = intakePartSel; if (!sku) { $('intakePartSearch').focus(); renderIntakePartResults(); return; }
    const q = Math.max(1, parseInt($('intakePartQty').value, 10) || 1);
    const ex = intakeParts.find(it => it.sku === sku);
    if (ex) ex.qty += q; else intakeParts.push({ sku, qty: q });
    $('intakePartQty').value = 1;
    intakePartSel = '';
    $('intakePartSearch').value = '';
    hideIntakePartResults();
    renderIntakeParts();
  });
  $('intakePartsList').addEventListener('click', (e) => {
    const b = e.target.closest('[data-ip]'); if (!b) return;
    const i = parseInt(b.getAttribute('data-i'), 10), act = b.getAttribute('data-ip');
    const it = intakeParts[i]; if (!it) return;
    if (act === 'inc') it.qty++;
    else if (act === 'dec'){ it.qty--; if (it.qty <= 0) intakeParts.splice(i, 1); }
    else if (act === 'del') intakeParts.splice(i, 1);
    renderIntakeParts();
  });

  form.addEventListener('submit', async (e) => {
    if(!PhoneFixAccess.can('repair_create')){e.preventDefault();alert('Ticket creation denied: repair creation permission is required.');return;}
    e.preventDefault();
    if(!form.reportValidity()) return;
    const submitButton = e.submitter;
    if (submitButton) submitButton.disabled = true;
    let intakeOperation = 'Ticket ID reservation';
    try {
    if(!currentTicket) await (ticketReservation || reserveNewTicket());

    const now = new Date();
    const formattedNow = `${niceDate(now)} ${niceTime(now)}`;
    intakeOperation = 'Customer ID reservation';
    const custId = activeCustomerProfile ? activeCustomerProfile.customerId : await reserveStoreCustomerId();

    intakeOperation = 'Customer profile save';
    const profiles = getProfiles();
    if(!profiles[custId]){
      profiles[custId] = {
        customerId: custId,
        primaryName: fields.name.value.trim(),
        primaryPhone: fields.phone.value.trim(),
        phoneHistory: [],
        changeLog: [{ text: `Profile registered with phone ${fields.phone.value.trim()}`, timestamp: formattedNow }]
      };
    } else {
      const oldName = profiles[custId].primaryName;
      const newName = fields.name.value.trim();
      if(oldName !== newName){
        profiles[custId].primaryName = newName;
        profiles[custId].changeLog.push({ text: `Name updated from ${oldName} to ${newName}`, timestamp: formattedNow });
      }
    }
    saveProfiles(profiles);

    const pricing = calculatePricing(fields.price.value, fields.taxToggle.checked);

    const queueDay = todayStamp();
    const queueSerial = nextQueueSerial(queueDay);
    const queuePriority = $('priorityToggle').checked;
    const queueReady = computeReadyBy(now.getTime(), queuePriority, $('readyByOverride').value);

    const record = {
      id: currentTicket.id,
      customerId: custId,
      name: fields.name.value.trim(),
      phone: fields.phone.value.trim(),
      device: fields.device.value.trim(),
      code: fields.code.value.trim(),
      subtotal: pricing.subtotal,
      subtotalFormatted: pricing.subtotalFormatted,
      taxAmount: pricing.tax,
      taxFormatted: pricing.taxFormatted,
      totalAmount: pricing.total,
      totalFormatted: pricing.totalFormatted,
      isTaxable: fields.taxToggle.checked,
      price: pricing.total,
      priceFormatted: pricing.totalFormatted,
      isPaid: fields.isPaid.checked,
      isDelivered: false,
      deliveredAt: null,
      fixedBy: fields.fixedBy.value.trim(),
      notes: fields.notes.value.trim(),
      rating: 0,
      reviewText: '',
      dateDisplay: formattedNow,
      createdAt: now.getTime(),
      intakeAt: formattedNow,
      updatedAt: formattedNow,
      reprintedAt: null,
      queueSerial: queueSerial,
      queueDay: queueDay,
      queueStatus: 'queued',
      statusChangedAt: formattedNow,
      priority: queuePriority,
      readyBy: queueReady.ts,
      readyByLabel: readyLabel(queueReady.ts, now.getTime()),
      carriedFrom: null,
      warrantyDays: intakeWarranty
    };

    intakeOperation = 'Ticket save';
    const records = getRecords();
    records.push(record);
    if (!saveRecords(records)) throw new Error('Local storage could not save the ticket. Receipt was not printed.');
    commitTicketCounter(currentTicket.stamp, currentTicket.seq);
    commitQueueCounter(record.queueDay, record.queueSerial);
    pushRepair(record);
    // Attach the parts picked on this intake: deduct stock, queue reorder, log usage on the ticket.
    if (intakeParts.length && typeof window.__invUsePart === 'function'){
      intakeParts.forEach(it => { window.__invUsePart(it.sku, record.id, it.qty); });
    }
    intakeParts = []; renderIntakeParts();

    flashSaved();
    renderHistory($('searchHistory').value);
    intakeOperation = 'Receipt printing (ticket already saved)';
    populatePrintLabel(record);
    try { window.print(); } catch(err) { alert('Receipt printing failed: the ticket was saved. Reprint its receipt instead of saving another ticket. ' + (err.message || '')); }

    form.reset();
    fields.isPaid.checked = false;
    fields.taxToggle.checked = true;
    fields.boundCustId.value = '';
    setIntakeWarranty(7);
    $('warrantyPicker').style.display = 'none';
    activeCustomerProfile = null;
    $('customerMatchBanner').style.display = 'none';
    checkRepeatIssue();
    reserveNewTicket();
    if (typeof closeIntakeModal === 'function') closeIntakeModal();
    } catch (err) {
      alert(intakeOperation + ' failed: ' + (err && err.message ? err.message : 'Please check the connection and try again.'));
    } finally {
      if (submitButton) submitButton.disabled = false;
    }
  });

  $('resetBtn').addEventListener('click', () => {
    form.reset();
    fields.isPaid.checked = false;
    fields.taxToggle.checked = true;
    fields.boundCustId.value = '';
    setIntakeWarranty(7);
    $('warrantyPicker').style.display = 'none';
    intakeParts = []; renderIntakeParts();
    activeCustomerProfile = null;
    $('customerMatchBanner').style.display = 'none';
    checkRepeatIssue();
    reserveNewTicket();
  });

  $('printBtn').addEventListener('click', () => {
    const now = new Date();
    const formattedNow = `${niceDate(now)} ${niceTime(now)}`;
    const pricing = calculatePricing(fields.price.value, fields.taxToggle.checked);
    const draft = {
      id: currentTicket ? currentTicket.id : 'FIX-00000000-0000',
      customerId: activeCustomerProfile ? activeCustomerProfile.customerId : 'CUST-0000',
      name: fields.name.value.trim() || 'Customer name',
      phone: fields.phone.value.trim() || '—',
      device: fields.device.value.trim() || '—',
      code: fields.code.value.trim() || '—',
      subtotalFormatted: pricing.subtotalFormatted,
      taxFormatted: pricing.taxFormatted,
      totalFormatted: pricing.totalFormatted,
      priceFormatted: pricing.totalFormatted,
      isPaid: fields.isPaid.checked,
      fixedBy: fields.fixedBy.value.trim() || '—',
      notes: fields.notes.value.trim() || '—',
      warrantyDays: intakeWarranty,
      intakeAt: formattedNow,
      dateDisplay: formattedNow,
      queueSerial: nextQueueSerial(todayStamp()),
      priority: $('priorityToggle').checked,
      readyByLabel: readyLabel(computeReadyBy(now.getTime(), $('priorityToggle').checked, $('readyByOverride').value).ts, now.getTime()),
    };
    populatePrintLabel(draft);
    window.print();
  });

  let _shT; $('searchHistory').addEventListener('input', (e) => { clearTimeout(_shT); const v = e.target.value; _shT = setTimeout(() => renderHistory(v), 150); });

  $('exportCsvBtn').addEventListener('click', () => {
    const records = getRecords().slice().sort((a,b) => a.createdAt - b.createdAt);
    if(records.length === 0){ alert('No records to export yet.'); return; }

    const headers = ['Ticket ID','Customer ID','Intake Timestamp','Delivered At','Last Updated','Reprinted At','Customer Name','Phone','Device Model','Subtotal','Tax (8%)','Total Price','Taxable','Payment Status','Fixed By','Rating','Review','Notes'];
    const rows = records.map(r => [
      r.id, r.customerId || '', r.intakeAt || r.dateDisplay, r.deliveredAt || '', r.updatedAt || '', r.reprintedAt || '',
      r.name, r.phone, r.device,
      r.subtotalFormatted || r.priceFormatted,
      r.taxFormatted || '$0.00',
      r.totalFormatted || r.priceFormatted,
      r.isTaxable ? 'YES' : 'NO',
      r.isPaid ? 'PAID' : 'DUE', r.fixedBy, r.rating || 0, r.reviewText || '', r.notes
    ]);

    const csvEscape = (val) => { let s = String(val ?? ''); if (/^[=+@\-]/.test(s) && isNaN(Number(s))) s = "'" + s; return /[",\n]/.test(s) ? '"' + s.replace(/"/g,'""') + '"' : s; };
    const csv = [headers, ...rows].map(row => row.map(csvEscape).join(',')).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `phone-fix-records-${todayStamp()}.csv`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  });

  const profileModalOverlay = $('profileModalOverlay');
  function openProfileModal(custId){
    if(!custId) return;
    const profiles = getProfiles();
    const prof = profiles[custId] || {
      customerId: custId, primaryName: 'Unknown', primaryPhone: '—', phoneHistory: [], changeLog: []
    };

    $('profModalCustId').textContent = prof.customerId;
    $('profCustName').textContent = prof.primaryName;
    $('profCustPhone').textContent = prof.primaryPhone;
    window.PhoneFixOperations?.profile(prof);

    const ltv = computeCustomerLTV(custId);
    const tier = getLtvTier(ltv.visits, ltv.spend);
    $('profTierBadge').textContent = tier.label;
    $('profTierBadge').className = `badge-ltv ${tier.cls}`;
    $('profCustLTV').textContent = formatMoney(ltv.spend);
    $('profCustVisits').textContent = ltv.visits;

    const phList = $('profPhoneHistoryList');
    phList.innerHTML = '';
    if(prof.phoneHistory && prof.phoneHistory.length > 0){
      prof.phoneHistory.forEach(ph => {
        const item = document.createElement('div');
        item.style.fontSize = '0.74rem';
        item.innerHTML = `<span class="mono" style="font-weight:700;">${escapeHtml(ph.phone)}</span> <span style="color:#9C9585;">(superseded ${escapeHtml(ph.replacedAt)})</span>`;
        phList.appendChild(item);
      });
    } else {
      phList.innerHTML = '<span style="font-size:0.75rem;color:#9C9585;">No previous phone numbers recorded.</span>';
    }

    if(prof.changeLog && prof.changeLog.length > 0){
      prof.changeLog.forEach(cl => {
        const item = document.createElement('div');
        item.className = 'audit-pill';
        item.textContent = `${cl.timestamp} — ${cl.text}`;
        phList.appendChild(item);
      });
    }

    const fleetWrap = $('profDeviceFleetList');
    fleetWrap.innerHTML = '';
    const devices = [...new Set(ltv.records.map(r => r.device).filter(Boolean))];
    if(devices.length > 0){
      devices.forEach(d => {
        const chip = document.createElement('span');
        chip.className = 'preset-chip';
        chip.textContent = d;
        fleetWrap.appendChild(chip);
      });
    } else {
      fleetWrap.innerHTML = '<span style="font-size:0.75rem;color:#9C9585;">No devices registered yet.</span>';
    }

    const timeline = $('profVisitTimeline');
    timeline.innerHTML = '';
    if(ltv.records.length > 0){
      ltv.records.sort((a,b) => b.createdAt - a.createdAt);
      ltv.records.forEach(r => {
        const item = document.createElement('div');
        item.className = 'timeline-item';
        const dispPrice = r.totalFormatted || r.priceFormatted;
        item.innerHTML = `
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <button type="button" class="xlink mono" data-xlink="ticket" data-id="${escapeHtml(r.id)}" title="Go to ticket" style="font-size:0.76rem;font-weight:700;">${escapeHtml(r.id)}</button>
            <span style="font-size:0.68rem;color:#8A8272;">${escapeHtml(r.intakeAt || r.dateDisplay)}</span>
          </div>
          <div style="font-size:0.8rem;font-weight:700;margin-top:0.2rem;">${escapeHtml(r.device)} · <span class="mono">${escapeHtml(dispPrice)}</span></div>
          <div style="font-size:0.72rem;color:var(--ink-soft);margin-top:0.15rem;"><b>Notes:</b> ${escapeHtml(r.notes || 'None')}</div>
          <div style="font-size:0.68rem;color:#6B7280;margin-top:0.2rem;">Tech: ${escapeHtml(r.fixedBy || '—')} · Status: <b>${r.isDelivered ? 'Delivered' : 'In Shop'}</b></div>
        `;
        timeline.appendChild(item);
      });
    } else {
      timeline.innerHTML = '<span style="font-size:0.75rem;color:#9C9585;">No previous repair tickets found.</span>';
    }

    profileModalOverlay.style.display = 'flex';
  }

  $('profileModalClose').addEventListener('click', () => profileModalOverlay.style.display = 'none');
  profileModalOverlay.addEventListener('click', (e) => { if(e.target === profileModalOverlay) profileModalOverlay.style.display = 'none'; });

  const historyModalOverlay = $('historyModalOverlay');
  const historyForm = $('historyForm');
  const hm = {
    recordId: $('hmRecordId'), ticketId: $('hmTicketId'), custId:$('hmCustId'),
    name: $('hmName'), phone:$('hmPhone'), device: $('hmDevice'), code:$('hmCode'),
    price: $('hmPrice'), taxToggle: $('hmTaxToggle'), isPaid:$('hmIsPaid'),
    isDelivered: $('hmIsDelivered'), deliveredAt:$('hmDeliveredAt'),
    fixedBy: $('hmFixedBy'), notes: $('hmNotes'), date:$('hmDate'),
    reviewText: $('hmReviewText')
  };
  let hmRating = 0;

  function updateHmPricing(){
    const pricing = calculatePricing(hm.price.value, hm.taxToggle.checked);
    $('hmCalculatedTotal').textContent = pricing.totalFormatted;
  }

  hm.phone.addEventListener('input', (e) => { e.target.value = formatPhone(e.target.value); });
  hm.price.addEventListener('input', updateHmPricing);
  hm.taxToggle.addEventListener('change', updateHmPricing);
  hm.isPaid.addEventListener('change', () => {
    $('hmIsPaidText').textContent = hm.isPaid.checked ? 'PAID' : 'DUE';
    $('hmIsPaidText').style.color = hm.isPaid.checked ? 'var(--green)' : 'var(--amber)';
  });

  function updateHmDeliveredUI(){
    $('hmIsDeliveredText').textContent = hm.isDelivered.checked ? 'DELIVERED' : 'IN SHOP';
    $('hmIsDeliveredText').style.color = hm.isDelivered.checked ? 'var(--blue)' : '#8A8272';
  }
  hm.isDelivered.addEventListener('change', (e) => {
    if (e.target.checked && !hm.deliveredAt.value) {
      const now = new Date();
      hm.deliveredAt.value = `${niceDate(now)} ${niceTime(now)}`;
    } else if (!e.target.checked) {
      hm.deliveredAt.value = '';
    }
    updateHmDeliveredUI();
  });

  const starLabels = ['No rating','Poor','Fair','Good','Very good','Excellent'];
  function setHmRating(val,preview=false){
    if(!preview)hmRating = val;
    const stars = document.querySelectorAll('#hmStarPicker svg');
    stars.forEach(s => {
      const n = Number(s.dataset.star);
      s.setAttribute('class', n <= val ? 'star-fill' : 'star-empty');
    });
    $('hmRatingLabel').textContent = val > 0 ? `${val} / 5 — ${starLabels[val]}` : 'No rating';
  }
  document.querySelectorAll('#hmStarPicker svg').forEach(s => {
    s.setAttribute('role','button');s.setAttribute('tabindex','0');s.setAttribute('aria-label',s.dataset.star+' out of 5 stars');
    s.addEventListener('mouseenter',()=>setHmRating(Number(s.dataset.star),true));
    s.addEventListener('focus',()=>setHmRating(Number(s.dataset.star),true));
    s.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();setHmRating(Number(s.dataset.star));}});
    s.addEventListener('click', () => setHmRating(Number(s.dataset.star)));
  });

  $('hmStarPicker').addEventListener('mouseleave',()=>setHmRating(hmRating,true));
  $('hmStarPicker').addEventListener('focusout',()=>setHmRating(hmRating,true));
  async function openHistoryModal(mode, id){
    hm.ticketId.readOnly = true; hm.custId.readOnly = true;
    historyForm.reset();
    if(mode === 'edit'){
      const record = getRecords().find(r => r.id === id);
      if(!record) return;
      $('historyModalTitle').textContent = 'Edit history record';
      hm.recordId.value = record.id;
      window.PhoneFixOperations?.ticket(record);
      hm.ticketId.value = record.id;
      hm.custId.value = record.customerId || '';
      hm.name.value = record.name || '';
      hm.phone.value = record.phone || '';
      hm.device.value = record.device || '';
      hm.code.value = record.code || '';
      hm.price.value = record.subtotal !== undefined ? record.subtotal : (record.price || '');
      hm.taxToggle.checked = record.isTaxable !== undefined ? record.isTaxable : true;
      hm.isPaid.checked = !!record.isPaid;
      hm.isDelivered.checked = !!record.isDelivered;
      hm.deliveredAt.value = record.deliveredAt || '';
      hm.fixedBy.value = record.fixedBy || '';
      hm.notes.value = record.notes || '';
      hm.date.value = record.intakeAt || record.dateDisplay || '';
      hm.reviewText.value = record.reviewText || '';
      setHmWarranty(record.warrantyDays);
      renderHmPartsUsed();
      setHmRating(record.rating || 0);
      const repPrevHm = findRepeat(record.phone, record.device, record.createdAt || Date.now(), record.id);
      const rl = $('hmRepeatLine');
      if (rl){
        const parts = [];
        if (record.selfIntake) parts.push('📝 <b>Customer self-intake</b> — not confirmed yet. Confirm it from the Queue board to assign a queue number and print the label.');
        if (qPriority(record)) {
          let prioTxt = '⭐ <b>Priority' + (record.selfIntake ? ' requested' : '') + ' (+$10)</b> — collect the $10 priority fee with the repair payment.';
          if (Number(record.priorityFee) > 0 && record.fixingPrice != null && Math.abs((Number(record.fixingPrice) || 0) + Number(record.priorityFee) - (Number(record.subtotal) || 0)) < 0.005)
            prioTxt += '<br>Fixing ' + formatMoney(record.fixingPrice) + ' + Priority ' + formatMoney(record.priorityFee) + ' · Subtotal ' + formatMoney(record.subtotal) + ' · Tax ' + formatMoney(record.taxAmount || 0) + ' · <b>Total ' + formatMoney(record.totalAmount != null ? record.totalAmount : record.price) + '</b>';
          parts.push(prioTxt);
        }
        if (repPrevHm) parts.push('↻ <b>Repeat:</b> same model was in on ' + escapeHtml(repPrevHm.dateDisplay || '') + ' — ticket <button type="button" class="xlink mono" id="hmRepeatJump">' + escapeHtml(repPrevHm.id) + '</button> (' + escapeHtml(repairStatusFor(repPrevHm)) + ').' + escapeHtml(repeatWarrantyNote(repPrevHm)));
        if (parts.length){
          rl.innerHTML = parts.join('<br>');
          rl.style.display = 'block';
          const jb = $('hmRepeatJump');
          if (jb) jb.addEventListener('click', () => { closeHistoryModal(); jumpToTicket(repPrevHm.id); });
        } else rl.style.display = 'none';
      }
    } else {
      $('historyModalTitle').textContent = 'Add history record';
      hm.recordId.value = '';
      const now = new Date();
      const reservedTicket = await reserveStoreTicketId();
      hm.ticketId.value = reservedTicket.id;
      hm.custId.value = await reserveStoreCustomerId();
      hm.date.value = `${niceDate(now)} · ${niceTime(now)}`;
      hm.taxToggle.checked = true;
      hm.isPaid.checked = false;
      hm.isDelivered.checked = false;
      hm.deliveredAt.value = '';
      hm.reviewText.value = '';
      setHmWarranty(7);
      renderHmPartsUsed();
      setHmRating(0);
      const rlAdd = $('hmRepeatLine'); if (rlAdd) rlAdd.style.display = 'none';
    }
    $('hmIsPaidText').textContent = hm.isPaid.checked ? 'PAID' : 'DUE';
    $('hmIsPaidText').style.color = hm.isPaid.checked ? 'var(--green)' : 'var(--amber)';
    updateHmPricing();
    updateHmDeliveredUI();

    historyModalOverlay.style.display = 'flex';
  }
  function closeHistoryModal(){ historyModalOverlay.style.display = 'none'; }

  $('addHistoryBtn').addEventListener('click', () => openHistoryModal('add').catch(function(err){ alert(err.message || 'Could not reserve IDs for this record.'); }));
  $('historyModalClose').addEventListener('click', closeHistoryModal);
  $('historyModalCancel').addEventListener('click', closeHistoryModal);
  historyModalOverlay.addEventListener('click', (e) => { if(e.target === historyModalOverlay) closeHistoryModal(); });

  historyForm.addEventListener('submit', (e) => {
    if(!PhoneFixAccess.can('history_edit')){e.preventDefault();return;}
    e.preventDefault();
    if(!historyForm.reportValidity()) return;

    const isEditing = !!hm.recordId.value;
    const records = getRecords();
    const newTicketId = hm.ticketId.value.trim();
    if (records.some(r => r.id === newTicketId && r.id !== hm.recordId.value)) { alert('Ticket ID ' + newTicketId + ' already exists.'); return; }
    const custId = hm.custId.value.trim() || generateNextCustomerId();
    const now = new Date();
    const formattedNow = `${niceDate(now)} ${niceTime(now)}`;

    const profiles = getProfiles();
    if(!profiles[custId]){
      profiles[custId] = {
        customerId: custId, primaryName: hm.name.value.trim(), primaryPhone: hm.phone.value.trim(),
        phoneHistory: [], changeLog: [{ text: 'Record created via modal', timestamp: formattedNow }]
      };
      saveProfiles(profiles);
    }

    const pricing = calculatePricing(hm.price.value, hm.taxToggle.checked);

    if(isEditing){
      const idx = records.findIndex(r => r.id === hm.recordId.value);
      if(idx === -1){ closeHistoryModal(); return; }
      records[idx] = {
        ...records[idx],
        id: newTicketId, customerId: custId, name: hm.name.value.trim(), phone: hm.phone.value.trim(),
        device: hm.device.value.trim(), code: hm.code.value.trim(),
        subtotal: pricing.subtotal,
        subtotalFormatted: pricing.subtotalFormatted,
        taxAmount: pricing.tax,
        taxFormatted: pricing.taxFormatted,
        totalAmount: pricing.total,
        totalFormatted: pricing.totalFormatted,
        isTaxable: hm.taxToggle.checked,
        price: pricing.total,
        priceFormatted: pricing.totalFormatted,
        isPaid: hm.isPaid.checked,
        isDelivered: hm.isDelivered.checked,
        deliveredAt: hm.isDelivered.checked ? hm.deliveredAt.value : null,
        fixedBy: hm.fixedBy.value.trim(), notes: hm.notes.value.trim(),
        warrantyDays: hmWarranty,
        intakeAt: hm.date.value.trim() || records[idx].intakeAt || records[idx].dateDisplay,
        updatedAt: formattedNow,
        rating: hmRating, reviewText: hm.reviewText.value.trim(),
      };
    } else {
      records.push({
        id: newTicketId, customerId: custId, name: hm.name.value.trim(), phone: hm.phone.value.trim(),
        device: hm.device.value.trim(), code: hm.code.value.trim(),
        subtotal: pricing.subtotal,
        subtotalFormatted: pricing.subtotalFormatted,
        taxAmount: pricing.tax,
        taxFormatted: pricing.taxFormatted,
        totalAmount: pricing.total,
        totalFormatted: pricing.totalFormatted,
        isTaxable: hm.taxToggle.checked,
        price: pricing.total,
        priceFormatted: pricing.totalFormatted,
        isPaid: hm.isPaid.checked,
        isDelivered: hm.isDelivered.checked,
        deliveredAt: hm.isDelivered.checked ? hm.deliveredAt.value : null,
        fixedBy: hm.fixedBy.value.trim(), notes: hm.notes.value.trim(),
        warrantyDays: hmWarranty,
        intakeAt: hm.date.value.trim() || formattedNow,
        dateDisplay: hm.date.value.trim() || formattedNow,
        createdAt: now.getTime(), updatedAt: formattedNow,
        rating: hmRating, reviewText: hm.reviewText.value.trim(),
      });
    }

    saveRecords(records);
    if (!isEditing) { const mm = /^FIX-(\d{8})-(\d{4})$/.exec(newTicketId); if (mm) { commitTicketCounter(mm[1], parseInt(mm[2], 10)); if (currentTicket && currentTicket.id === newTicketId) reserveNewTicket(); } }
    var _rid = isEditing ? hm.recordId.value : newTicketId;
    var _rec = records.find(function(r){ return r.id === _rid; });
    if (_rec){ _rec.statusChangedAt = formattedNow; saveRecords(records); pushRepair(_rec); }
    flashSaved();
    renderHistory($('searchHistory').value);
    closeHistoryModal();
  });

  $('ndSort').addEventListener('change', renderNotDelivered);

  // ---- Technician name suggestions (one datalist shared by both "Fixed by" fields) ----
  // Seeded names are always offered. Other names become suggestions after four
  // completed saves. Whitespace and case variants are merged.
  const TECH_SEED_NAMES = ['Anik', 'Kazi', 'Sojib', 'Ontor'];
  const TECH_LEARN_AFTER = 4;
  function refreshTechSuggestions(){
    const list = $('techNameList');
    if (!list) return;
    const names = new Map(); // lowercase key -> display name
    TECH_SEED_NAMES.forEach(n => names.set(n.toLowerCase(), n));

    const tally = new Map(); // lowercase key -> { count, forms: Map(spelling -> count) }
    getRecords().forEach(r => {
      const raw = (r && typeof r.fixedBy === 'string') ? r.fixedBy.trim() : '';
      if (!raw || raw === '\u2014') return; // skip blanks and the "—" placeholder
      const key = raw.replace(/\s+/g, ' ').toLowerCase();
      let t = tally.get(key);
      if (!t){ t = { count: 0, forms: new Map() }; tally.set(key, t); }
      t.count++;
      t.forms.set(raw, (t.forms.get(raw) || 0) + 1);
    });

    const learned = [];
    tally.forEach((t, key) => {
      if (t.count < TECH_LEARN_AFTER || names.has(key)) return;
      let best = '', bestN = 0; // display with the most common spelling
      t.forms.forEach((n, form) => { if (n > bestN){ best = form; bestN = n; } });
      learned.push({ key, name: best, count: t.count });
    });
    learned.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    learned.forEach(l => names.set(l.key, l.name));

    const sig = Array.from(names.values()).join('|');
    if (list.dataset.sig === sig) return; // unchanged, don't rebuild
    list.dataset.sig = sig;
    list.innerHTML = '';
    names.forEach(n => { const o = document.createElement('option'); o.value = n; list.appendChild(o); });

    // quick-pick chips under each field (same look/behavior as the device model presets)
    [['techChipsMain', 'fixedBy'], ['techChipsModal', 'hmFixedBy']].forEach(([boxId, inputId]) => {
      const box = $(boxId), input = $(inputId);
      if (!box || !input) return;
      box.innerHTML = '';
      names.forEach(n => {
        const chip = document.createElement('span');
        chip.className = 'preset-chip';
        chip.textContent = n;
        chip.addEventListener('click', () => {
          input.value = n;
          input.dispatchEvent(new Event('input', { bubbles: true })); // keeps live preview in sync
        });
        box.appendChild(chip);
      });
    });
  }
  refreshTechSuggestions();
  // also refresh when a field gets focus, so names learned since page load show up
  ['fixedBy', 'hmFixedBy'].forEach(id => { const el = $(id); if (el) el.addEventListener('focus', refreshTechSuggestions); });

  // Custom device models are learned after their first saved repair. The
  // predefined datalist values remain intact and are never replaced.
  function refreshModelSuggestions(){
    const list = $('deviceDataList');
    if (!list) return;
    const names = new Map();
    list.querySelectorAll('option').forEach(o => {
      const value = String(o.value || '').trim().replace(/\s+/g, ' ');
      if (value) names.set(value.toLowerCase(), value);
    });
    const tally = new Map();
    getRecords().forEach(r => {
      const value = String(r?.device || '').trim().replace(/\s+/g, ' ');
      if (!value) return;
      const key = value.toLowerCase(), current = tally.get(key) || {count:0, forms:new Map()};
      current.count++;
      current.forms.set(value, (current.forms.get(value) || 0) + 1);
      tally.set(key, current);
    });
    [...tally.entries()].sort((a,b)=>b[1].count-a[1].count).forEach(([key,item]) => {
      if (names.has(key)) return;
      let best='', count=-1;
      item.forms.forEach((n,form)=>{if(n>count){best=form;count=n;}});
      names.set(key,best);
    });
    list.innerHTML='';
    names.forEach(value=>{const option=document.createElement('option');option.value=value;list.append(option);});
  }
  refreshModelSuggestions();
  $('deviceModel')?.addEventListener('focus', refreshModelSuggestions);
  window.addEventListener('pf:data', ()=>{refreshTechSuggestions();refreshModelSuggestions();});

  // ============ QUEUE BOARD ============
  // Record fields (all optional): queueSerial (n), queueDay (YYYYMMDD), queueStatus (queued|progress|ready),
  // priority (bool), readyBy (ms), readyByLabel ("4:30 PM"), carriedFrom (YYYYMMDD | null).
  const QUEUE_COUNTER_KEY = 'phoneRepairQueueCounter';
  const QUEUE_VIEW_KEY = 'phoneRepairActiveView';
  const QUEUE_SORT_KEY = 'phoneRepairQueueSort';
  const Q_STATUSES = ['queued', 'progress', 'ready'];
  const Q_LABEL = { queued: 'Queue', progress: 'Repairing', ready: 'Ready to deliver', delivered:'Delivered' };
  const Q_REPAIR_MIN = 45;    // minutes per repair
  const Q_PRIORITY_MIN = 15;  // flat ready-by for priority orders
  const Q_ROUND_MIN = 15;     // wait estimate rounds up to this
  let boardDay = null;        // null = follow today; otherwise a past YYYYMMDD

  // ---- date helpers ----
  function dayStampOf(ts){ const d = new Date(ts); return `${d.getFullYear()}${pad(d.getMonth() + 1, 2)}${pad(d.getDate(), 2)}`; }
  function stampToDate(st){ return new Date(+st.slice(0, 4), +st.slice(4, 6) - 1, +st.slice(6, 8)); }
  function shiftStamp(st, delta){ const d = stampToDate(st); d.setDate(d.getDate() + delta); return dayStampOf(d.getTime()); }
  function stampLabel(st){ return stampToDate(st).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }); }
  function stampShort(st){ return stampToDate(st).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); }
  const isStamp = (v) => typeof v === 'string' && /^\d{8}$/.test(v);
  const isRec = (r) => !!r && typeof r === 'object';
  function recDay(r){
    if (isStamp(r.queueDay)) return r.queueDay;
    if (r.createdAt) return dayStampOf(r.createdAt);
    const m = /^FIX-(\d{8})-/.exec(String(r.id || ''));
    return m ? m[1] : todayStamp();
  }
  function qPriority(r){ return r.priority !== undefined ? !!r.priority : !!r.isPriority; }
  function normQueueStatus(r){ const s = r.queueStatus === 'inprogress' ? 'progress' : r.queueStatus; return Q_STATUSES.indexOf(s) > -1 ? s : 'queued'; }
  function hasSerial(r){ return r.queueSerial != null && r.queueSerial !== '' && Number.isFinite(Number(r.queueSerial)); }
  function fmtMins(m){
    m = Math.max(0, Math.round(m));
    if (m < 60) return m + 'm';
    const h = Math.floor(m / 60);
    if (h < 24) return h + 'h ' + pad(m % 60, 2) + 'm';
    return Math.floor(h / 24) + 'd ' + (h % 24) + 'h';
  }
  function sinceText(ts){
    if (!ts) return '';
    const d = new Date(ts);
    return d.toDateString() === new Date().toDateString()
      ? niceTime(d)
      : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ', ' + niceTime(d);
  }

  // ---- records by day ----
  function dayRecords(day){ return getRecords().filter(r => isRec(r) && recDay(r) === day); }
  function boardRecords(day){ return dayRecords(day).filter(r => !r.isDelivered); }
  function activeTodayCount(){ return dayRecords(todayStamp()).filter(r => !r.isDelivered && normQueueStatus(r) !== 'ready').length; }

  // ---- daily serials (date-keyed counter, collision-safe) ----
  function nextQueueSerial(day){
    let counters = {};
    try { counters = JSON.parse(localStorage.getItem(QUEUE_COUNTER_KEY) || '{}') || {}; } catch(e){ counters = {}; }
    let highest = Number(counters[day]) || 0;
    getRecords().forEach(r => {
      if (isRec(r) && r.queueDay === day && hasSerial(r)) highest = Math.max(highest, Number(r.queueSerial));
    });
    return highest + 1;
  }
  function commitQueueCounter(day, serial){
    let counters = {};
    try { counters = JSON.parse(localStorage.getItem(QUEUE_COUNTER_KEY) || '{}') || {}; } catch(e){ counters = {}; }
    counters[day] = Math.max(Number(counters[day]) || 0, Number(serial) || 0);
    localStorage.setItem(QUEUE_COUNTER_KEY, JSON.stringify(counters));
  }

  // ---- load-time migration: rename fields from the earlier build, backfill serials by intake order ----
  function migrateQueueRecords(){
    const records = getRecords();
    if (!Array.isArray(records)) return;
    let changed = false;
    const counters = (() => { try { return JSON.parse(localStorage.getItem(QUEUE_COUNTER_KEY) || '{}') || {}; } catch(e){ return {}; } })();
    const pending = {}; // day -> records that still need a serial
    const highest = {}; // day -> highest serial in use
    records.forEach((r, idx) => {
      if (!isRec(r)) return;
      if ('isPriority' in r) { if (r.priority === undefined) r.priority = !!r.isPriority; delete r.isPriority; changed = true; }
      if (r.queueStatus === 'inprogress') { r.queueStatus = 'progress'; changed = true; }
      const day = recDay(r);
      if (!isStamp(r.queueDay)) { r.queueDay = day; changed = true; }
      if (hasSerial(r)) highest[day] = Math.max(highest[day] || 0, Number(r.queueSerial));
      else (pending[day] = pending[day] || []).push({ r, idx });
    });
    Object.keys(pending).forEach(day => {
      let n = Math.max(highest[day] || 0, Number(counters[day]) || 0);
      pending[day]
        .sort((a, b) => (a.r.createdAt || 0) - (b.r.createdAt || 0) || a.idx - b.idx)
        .forEach(p => { p.r.queueSerial = ++n; });
      counters[day] = n;
      changed = true;
    });
    if (changed) {
      saveRecords(records);
      localStorage.setItem(QUEUE_COUNTER_KEY, JSON.stringify(counters));
    }
  }

  // ---- wait engine: (active + 1) * 45 / techs, rounded up to 15 min ----
  function techCountToday(){
    const names = new Set();
    dayRecords(todayStamp()).forEach(r => {
      const n = String(r.fixedBy || '').trim().toLowerCase();
      if (n && n !== '\u2014') names.add(n);
    });
    return Math.max(1, names.size);
  }
  function estimateWaitMin(){
    const raw = (activeTodayCount() + 1) * Q_REPAIR_MIN / techCountToday();
    return Math.ceil(raw / Q_ROUND_MIN) * Q_ROUND_MIN;
  }
  // override (HH:MM) wins; else priority = flat +15; else the wait estimate
  function computeReadyBy(nowMs, isPriority, overrideVal){
    if (overrideVal && /^\d{2}:\d{2}$/.test(overrideVal)) {
      const d = new Date(nowMs);
      const parts = overrideVal.split(':');
      d.setHours(+parts[0], +parts[1], 0, 0);
      if (d.getTime() <= nowMs) d.setDate(d.getDate() + 1); // time already passed today -> next occurrence
      return { ts: d.getTime(), source: 'override' };
    }
    if (isPriority) return { ts: nowMs + Q_PRIORITY_MIN * 60000, source: 'priority' };
    return { ts: nowMs + estimateWaitMin() * 60000, source: 'estimate' };
  }
  function readyLabel(ts, refMs){
    const d = new Date(ts);
    const t = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const day = dayStampOf(ts), ref = dayStampOf(refMs);
    if (day === ref) return t;
    if (day === shiftStamp(ref, 1)) return 'Tomorrow ' + t;
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + t;
  }

  // ---- intake form: priority toggle + live ready-by ----
  function syncPriorityUi(){
    const on = $('priorityToggle').checked, t = $('priorityToggleText');
    t.textContent = on ? 'PRIORITY' : 'NORMAL';
    t.style.color = on ? 'var(--red)' : '#8A8272';
  }
  function updateReadyByLive(){
    const el = $('readyByLive');
    if (!el) return;
    const now = Date.now();
    const ov = $('readyByOverride').value;
    const r = computeReadyBy(now, $('priorityToggle').checked, ov);
    const mins = Math.max(0, Math.round((r.ts - now) / 60000));
    el.textContent = '~' + readyLabel(r.ts, now) + ' (' + (mins < 60 ? mins + ' min' : fmtMins(mins)) + ')'
      + (r.source === 'override' ? ' \u00b7 your time' : (r.source === 'priority' ? ' \u00b7 priority +15m' : ''));
    $('readyByAuto').hidden = !ov;
  }
  $('priorityToggle').addEventListener('change', () => { syncPriorityUi(); updateReadyByLive(); });
  $('readyByOverride').addEventListener('input', updateReadyByLive);
  $('readyByOverride').addEventListener('change', updateReadyByLive);
  $('readyByAuto').addEventListener('click', () => { $('readyByOverride').value = ''; updateReadyByLive(); });
  form.addEventListener('reset', () => setTimeout(() => { syncPriorityUi(); updateReadyByLive(); }, 0));

  // ---- printed label: queue serial, ready-by (customer copy), PRIORITY stamp (both copies) ----
  function fillQueueOnLabel(record){
    const ok = !!record && hasSerial(record);
    const pri = !!record && qPriority(record);
    const rdy = record && record.readyByLabel ? String(record.readyByLabel) : '';
    ['Top', 'Btm'].forEach(k => {
      const row = $('prQueueRow' + k);
      if (!row) return;
      row.hidden = !(ok || pri || (k === 'Btm' && rdy));
      const box = row.querySelector('.pl-queue-box');
      if (box) box.style.display = ok ? '' : 'none';
      $('prQueueNum' + k).textContent = ok ? pad(Number(record.queueSerial), 3) : '';
      $('prPriority' + k).hidden = !pri;
    });
    const rb = $('prReadyBtm');
    if (rb) {
      rb.hidden = !rdy;
      $('prReadyTimeBtm').textContent = rdy;
      rb.classList.toggle('long', rdy.length > 9);
    }
  }

  // ---- board: sort (display only) ----
  function sortQueue(list, mode){
    const ser = (a, b) => (hasSerial(a) ? Number(a.queueSerial) : 1e9) - (hasSerial(b) ? Number(b.queueSerial) : 1e9) || (a.createdAt || 0) - (b.createdAt || 0);
    const stOrder = { queued: 0, progress: 1, ready: 2 };
    const price = (r) => parseFloat(r.totalAmount != null ? r.totalAmount : r.price) || 0;
    const cmp = {
      'serial-asc': ser,
      'serial-desc': (a, b) => -ser(a, b),
      'priority': (a, b) => (qPriority(b) - qPriority(a)) || ser(a, b),
      'leftovers': (a, b) => (!!b.carriedFrom - !!a.carriedFrom) || ser(a, b),
      'status': (a, b) => (stOrder[normQueueStatus(a)] - stOrder[normQueueStatus(b)]) || ser(a, b),
      'name': (a, b) => String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' }) || ser(a, b),
      'price': (a, b) => (price(b) - price(a)) || ser(a, b)
    }[mode] || ser;
    return list.slice().sort(cmp);
  }

  // ---- board: card ----
  function countdownChip(r, now){
    const st = normQueueStatus(r);
    if (st === 'ready') return '<span class="qv-chip ok">\u2713 Ready for pickup</span>';
    if (!r.readyBy) return '<span class="qv-chip">in store ' + fmtMins((now - (r.createdAt || now)) / 60000) + '</span>';
    const ms = r.readyBy - now;
    if (ms <= 0) return '<span class="qv-chip over">OVERDUE ' + fmtMins(Math.max(1, Math.floor(-ms / 60000))) + '</span>';
    const left = Math.ceil(ms / 60000);
    return '<span class="qv-chip' + (left <= 15 ? ' warn' : '') + '">\u23f1 ' + fmtMins(left) + ' left</span>';
  }
  function cardHtml(r, onToday, now){
    const st = r.isDelivered ? 'delivered' : normQueueStatus(r);
    const pri = qPriority(r);
    const id = escapeHtml(r.id);
    const next = st === 'queued' ? ['Start repair', ''] : (st === 'progress' ? ['Mark ready', 'go-ready'] : ['Delivered \u2713', 'go-deliver']);
    const price = r.totalFormatted || r.priceFormatted || '';
    const name = escapeHtml(r.name || '\u2014');
    const nameHtml = r.customerId
      ? `<button type="button" class="qv-name link" data-act="dossier" title="Open customer profile">${name}</button>`
      : `<div class="qv-name">${name}</div>`;
    const rep = findRepeat(r.phone, r.device, r.createdAt || now, r.id);
    const badges = (pri ? '<span class="qv-badge prio">PRIORITY</span>' : '')
      + (rep ? `<span class="qv-badge repeat" title="Same model in on ${escapeHtml(rep.dateDisplay || '')} — ${escapeHtml(rep.id)}">↻ REPEAT</span>` : '')
      + (isStamp(r.carriedFrom) ? `<span class="qv-badge leftover">\u21a9 Leftover ${escapeHtml(stampShort(r.carriedFrom))}</span>` : '');
    return `<article draggable="${PhoneFixAccess.can('ticket_edit')}" class="qv-card st-${st}${pri ? ' is-priority' : ''}" data-id="${id}">
      <div class="qv-top">
        <div class="qv-serial${hasSerial(r) ? '' : ' none'}" title="${hasSerial(r) ? 'Queue number' : 'No queue number'}">${hasSerial(r) ? '#' + pad(Number(r.queueSerial), 3) : '#&ndash;'}</div>
        <div class="qv-main">
          ${nameHtml}
          <div class="qv-device">${escapeHtml(r.device || '\u2014')}</div>
        </div>
        <span class="qv-pill">${Q_LABEL[st]}</span>
      </div>
      ${badges ? `<div class="qv-badges">${badges}</div>` : ''}
      <div class="qv-contact"><span class="mono">${escapeHtml(r.phone || '\u2014')}</span>${price ? `<span class="qv-price">${escapeHtml(price)}</span>` : ''}</div>
      <div class="qv-issue${r.notes ? '' : ' empty'}">${r.notes ? escapeHtml(r.notes) : 'No issue noted'}</div>
      <div class="qv-meta">
        ${r.isDelivered ? '<span class="qv-chip ok">Delivered · '+escapeHtml(r.deliveredAt||'')+'</span>' : countdownChip(r, now)}
        <span>Tech: <b>${escapeHtml(r.fixedBy || 'Unassigned')}</b></span>
        ${r.readyByLabel ? `<span>Ready by <b>${escapeHtml(r.readyByLabel)}</b></span>` : ''}
        <span class="mono"><button type="button" class="xlink mono" data-act="ticket" title="Open ticket">${id}</button></span>
      </div>
      ${window.PhoneFixOperations?.flagMarkup(r)||''}
      <div class="qv-actions">
        ${!r.isDelivered ? `<button type="button" class="qv-btn ${next[1]}" data-act="status">${next[0]}</button>` : ''}
        ${st !== 'queued' ? '<button type="button" class="qv-iconbtn" data-act="back" title="Step back one status" aria-label="Step back one status">&#8630;</button>' : ''}
        <button type="button" class="qv-prio-btn${pri ? ' on' : ''}" data-act="priority" aria-pressed="${pri}">${pri ? '&#9733; PRIORITY' : '&#9734; Priority'}</button>
        ${onToday || r.isDelivered ? '' : '<button type="button" class="qv-carry-btn" data-act="carry">&rarr; Carry to today</button>'}
      </div>
    </article>`;
  }

  // ---- board: self-intake review card ----
  function selfCardHtml(r, now){
    const id = escapeHtml(r.id);
    const rep = findRepeat(r.phone, r.device, r.createdAt || now, r.id);
    return `<article class="qv-card st-selfin${qPriority(r) ? ' is-priority' : ''}" data-id="${id}">
      <div class="qv-top">
        <div class="qv-serial none" title="No queue number yet">#&ndash;</div>
        <div class="qv-main">
          <div class="qv-name">${escapeHtml(r.name || '—')}</div>
          <div class="qv-device">${escapeHtml(r.device || '—')}</div>
        </div>
        <span class="qv-pill selfin">SELF-INTAKE</span>
      </div>
      <div class="qv-badges"><span class="qv-badge selfin">📝 Needs review</span>${qPriority(r) ? '<span class="qv-badge prio">⭐ PRIORITY +$10</span>' : ''}${rep ? '<span class="qv-badge repeat">↻ REPEAT</span>' : ''}</div>
      <div class="qv-contact"><span class="mono">${escapeHtml(r.phone || '—')}</span><span>Submitted ${escapeHtml(sinceText(r.createdAt || now))}</span></div>
      <div class="qv-issue${r.notes ? '' : ' empty'}">${r.notes ? escapeHtml(r.notes) : 'No issue noted'}</div>
      <div class="qv-meta">
        ${r.code ? `<span>Passcode: <b>${escapeHtml(r.code)}</b></span>` : ''}
        <span class="mono"><button type="button" class="xlink mono" data-act="ticket" title="Open ticket">${id}</button></span>
      </div>
      <div class="qv-actions">
        <button type="button" class="qv-btn go-confirm" data-act="confirm">✓ Confirm &amp; print label</button>
        <button type="button" class="qv-btn" data-act="review">💲 Review &amp; price</button>
        <button type="button" class="qv-iconbtn" data-act="ticket" title="Open ticket to set price / tech" aria-label="Open ticket">✎</button>
      </div>
    </article>`;
  }

  // ---- board: render ----
  function viewDay(){ return boardDay || todayStamp(); }
  function earliestDay(){
    let min = todayStamp();
    getRecords().forEach(r => { if (isRec(r)) { const d = recDay(r); if (d < min) min = d; } });
    return min;
  }
  function queueIsOpen(){ const v = $('queueView'); return !!v && !v.hidden; }
  function updateQueueBadge(){ $('queueTabCount').textContent = activeTodayCount(); }

  function renderQueue(){
    updateQueueBadge();
    if (!queueIsOpen()) return;
    const today = todayStamp();
    if (boardDay && boardDay >= today) boardDay = null;
    const day = viewDay(), onToday = day === today, now = Date.now();
    const mode = $('qvSort').value || 'serial-asc';
    const list = sortQueue(boardRecords(day).filter(r => !r.selfIntake), mode);

    $('qvDayLabel').textContent = (onToday ? 'Today \u00b7 ' : '') + stampLabel(day);
    $('qvPrev').disabled = day <= earliestDay();
    $('qvNext').disabled = onToday;
    $('qvToday').disabled = onToday;
    $('qvSubtitle').textContent = onToday
      ? 'Serial order \u00b7 priority jobs are highlighted in red'
      : 'Earlier day \u00b7 carry unfinished devices to today';

    const cnt = (s) => list.filter(r => normQueueStatus(r) === s).length;
    $('qvCountQueued').textContent = cnt('queued');
    $('qvCountProgress').textContent = cnt('progress');
    $('qvCountReady').textContent = cnt('ready');

    // self-intake review strip: unconfirmed customer submissions from any day, pinned on today's board
    const selfList = onToday ? getRecords().filter(r => isRec(r) && r.selfIntake && !r.isDelivered).sort((a, b) => (qPriority(b) - qPriority(a)) || ((a.createdAt || 0) - (b.createdAt || 0))) : [];
    const strip = $('qvSelfReview');
    if (strip){
      strip.hidden = selfList.length === 0;
      if (selfList.length){
        $('qvSelfCount').textContent = '· ' + selfList.length + ' waiting';
        $('qvSelfGrid').innerHTML = selfList.map(r => selfCardHtml(r, now)).join('');
      }
    }

    // earlier-day leftovers hint (today only)
    let leftDays = [];
    if (onToday) getRecords().forEach(r => { if (isRec(r) && !r.isDelivered && recDay(r) < today) leftDays.push(recDay(r)); });
    $('qvLeftBanner').hidden = !(onToday && leftDays.length);
    if (leftDays.length) {
      $('qvLeftText').textContent = '\u26a0 ' + leftDays.length + ' device' + (leftDays.length > 1 ? 's' : '') + ' still in store from earlier days.';
      $('qvLeftReview').dataset.day = leftDays.sort().pop();
    }

    // carry-all bar (past days)
    $('qvCarryBar').hidden = onToday || list.length === 0;
    if (!onToday && list.length) {
      $('qvCarryText').textContent = list.length + ' device' + (list.length > 1 ? 's' : '') + ' from ' + stampLabel(day) + ' still in store.';
      $('qvCarryAll').textContent = 'Carry all ' + list.length + ' \u2192 Today';
    }

    const delivered=getRecords().filter(r=>isRec(r)&&r.isDelivered&&fixedDayOf(r)===day);
    const all=[...list,...delivered];
    $('qvGrid').classList.add('pf-kanban');
    $('qvGrid').innerHTML=['queued','progress','ready','delivered'].map(stage=>{
      const cards=all.filter(r=>(r.isDelivered?'delivered':normQueueStatus(r))===stage);
      return `<section class="pf-lane" data-stage="${stage}" aria-label="${Q_LABEL[stage]}"><h3>${Q_LABEL[stage]} <span>${cards.length}</span></h3><div class="pf-lane-cards">${cards.map(r=>cardHtml(r,onToday,now)).join('')||'<p class="pf-lane-empty">No repairs</p>'}</div></section>`;
    }).join('');
    $('qvEmpty').hidden = all.length !== 0;
    $('qvEmpty').textContent = onToday
      ? 'No repairs in the queue today. New intake tickets show up here automatically.'
      : 'Nothing left over from this day.';
    renderFixedPanel();
  }

  // ---- floating "fixed" panel (right side of the queue board) ----
  function fixedDayOf(r){ return r.deliveredDay || recDay(r); }
  function renderFixedPanel(){
    const panel = $('fixedPanel');
    if(!panel || !queueIsOpen()) return;
    const day = viewDay(), onToday = day === todayStamp();
    const list = getRecords()
      .filter(r => isRec(r) && r.isDelivered && fixedDayOf(r) === day)
      .sort((a,b) => String(b.deliveredAt || '').localeCompare(String(a.deliveredAt || '')));
    $('fpDay').textContent = onToday ? 'today' : stampLabel(day);
    $('fpCount').textContent = list.length;
    $('fpList').innerHTML = list.length ? list.map(r =>
      '<div class="fp-row"><button type="button" class="fp-cust" data-fp-ticket="' + escapeHtml(r.id) + '">' + escapeHtml(r.name || '—') + '</button>'
      + '<div>' + escapeHtml(r.device || '') + '</div>'
      + '<div class="fp-meta">' + escapeHtml(r.phone || '') + ' · 🔧 ' + escapeHtml(r.fixedBy || '—') + '</div>'
      + '<div class="fp-meta">Picked up: ' + escapeHtml(r.deliveredAt || '—') + '</div></div>'
    ).join('') : '<div class="fp-empty">No pickups this day.</div>';
  }
  $('fpHead').addEventListener('click', () => $('fixedPanel').classList.toggle('collapsed'));
  $('fixedPanel').addEventListener('click', (e) => {
    const b = e.target.closest('[data-fp-ticket]');
    if(b) jumpToTicket(b.dataset.fpTicket);
  });

  // ---- board: actions ----
  function patchQueueRecord(id, patch){
    if(!PhoneFixAccess.can('ticket_edit')) { alert("You don't have permission for this."); return; }
    const records = getRecords();
    const i = records.findIndex(r => isRec(r) && r.id === id);
    if (i < 0) return;
    records[i] = Object.assign({}, records[i], patch);
    if (patch.queueStatus){ var _sn = new Date(); records[i].statusChangedAt = `${niceDate(_sn)} ${niceTime(_sn)}`; }
    saveRecords(records);
    pushRepair(records[i]);
    queueTick(true);
  }
  // bridge: other script blocks (Home calendar) open a ticket through here
  window.__pfOpenTicket = function(id){ try { jumpToTicket(id); } catch(e){} };
  // confirm a customer self-intake: assign customer ID + today's queue serial, flip to Queued, print the label
  async function confirmSelfIntake(id){
    const records = getRecords();
    const i = records.findIndex(r => isRec(r) && r.id === id);
    if (i < 0) return;
    const r = records[i];
    const now = new Date();
    const formattedNow = `${niceDate(now)} ${niceTime(now)}`;
    if (!r.customerId){
      const prof = findExistingProfile(r.phone, r.name);
      r.customerId = prof ? prof.customerId : await reserveStoreCustomerId();
    }
    const profiles = getProfiles();
    if (!profiles[r.customerId]){
      profiles[r.customerId] = { customerId: r.customerId, primaryName: r.name || '', primaryPhone: r.phone || '',
        phoneHistory: [], changeLog: [{ text: 'Profile registered from self-intake ' + r.id, timestamp: formattedNow }] };
      saveProfiles(profiles);
    }
    const today = todayStamp();
    if (recDay(r) !== today || !hasSerial(r)){
      r.queueDay = today;
      r.queueSerial = nextQueueSerial(today);
      commitQueueCounter(today, r.queueSerial);
    }
    if (!r.readyBy){
      const rb = computeReadyBy(now.getTime(), qPriority(r), '');
      r.readyBy = rb.ts;
      r.readyByLabel = readyLabel(rb.ts, now.getTime());
    }
    r.selfIntake = false;
    r.queueStatus = 'queued';
    r.statusChangedAt = formattedNow;
    records[i] = r;
    saveRecords(records);
    pushRepair(r);
    renderHistory($('searchHistory').value);
    populatePrintLabel(r);
    window.print();
    queueTick(true);
  }

  // ---- self-intake review & price: staff sets the fixing price, sees fixing + priority + tax, then approves ----
  let rvId = null;
  function rvRecord(){ if (!rvId) return null; return getRecords().find(x => isRec(x) && x.id === rvId) || null; }
  function rvBreakdown(){
    const r = rvRecord(); if (!r) return null;
    const fixing = Math.max(0, parseFloat($('rvPrice').value) || 0);
    const fee = qPriority(r) ? 10 : 0;
    return { fixing, fee, pricing: calculatePricing(fixing + fee, $('rvTax').checked) };
  }
  function rvRenderBreak(){
    const b = rvBreakdown(); if (!b) return;
    const row = (l, v, bold) => '<div style="display:flex;justify-content:space-between;' + (bold ? 'border-top:1.5px solid var(--line);margin-top:0.3rem;padding-top:0.3rem;font-size:1.05rem;font-weight:800;' : '') + '"><span>' + l + '</span><span>' + v + '</span></div>';
    let h = row('Fixing price', formatMoney(b.fixing));
    if (b.fee) h += row('⭐ Priority fee', formatMoney(b.fee));
    h += row('Subtotal', b.pricing.subtotalFormatted);
    h += row('Tax (8%)', b.pricing.taxFormatted);
    h += row('Total', b.pricing.totalFormatted, true);
    $('rvBreak').innerHTML = h;
  }
  function openReview(id){
    const r = getRecords().find(x => isRec(x) && x.id === id);
    if (!r) return;
    rvId = id;
    $('rvTicket').textContent = r.id;
    $('rvPrioBanner').style.display = qPriority(r) ? 'block' : 'none';
    $('rvNoPrio').style.display = qPriority(r) ? '' : 'none';
    $('rvInfo').innerHTML =
      '<div><b>' + escapeHtml(r.name || '—') + '</b> · <span class="mono">' + escapeHtml(r.phone || '—') + '</span></div>'
      + '<div>📱 ' + escapeHtml(r.device || '—') + '</div>'
      + '<div>🛠 ' + (r.notes ? escapeHtml(r.notes) : 'No issue noted') + '</div>'
      + (r.code ? '<div>🔑 Passcode: <b>' + escapeHtml(r.code) + '</b></div>' : '')
      + '<div style="color:var(--ink-soft);">Submitted ' + escapeHtml(sinceText(r.createdAt || Date.now())) + '</div>';
    $('rvPrice').value = (Number(r.fixingPrice) > 0) ? r.fixingPrice : '';
    $('rvFixedBy').value = r.fixedBy || PhoneFixAccess.member?.name || '';
    $('rvService').value = r.repairService || '';
    $('rvTax').checked = (Number(r.fixingPrice) > 0 && r.isTaxable !== undefined) ? !!r.isTaxable : true;
    rvRenderBreak();
    $('reviewModalOverlay').style.display = 'flex';
    setTimeout(() => { try { $('rvPrice').focus(); } catch(e){} }, 30);
  }
  function closeReview(){ $('reviewModalOverlay').style.display = 'none'; rvId = null; }
  async function rvApprove(dropPriority){
    if(!PhoneFixAccess.can('ticket_edit')) { alert("You don't have permission for this."); return; }
    const fixedBy = $('rvFixedBy').value.trim(), service = $('rvService').value.trim();
    if (!fixedBy || !service || $('rvPrice').value === '') {
      alert('Enter who is fixing it, the repair/service, and the fixing price before approval.');
      (!fixedBy ? $('rvFixedBy') : !service ? $('rvService') : $('rvPrice')).focus();
      return;
    }
    const b = rvBreakdown(); if (!b || !rvId) { closeReview(); return; }
    const records = getRecords();
    const i = records.findIndex(x => isRec(x) && x.id === rvId);
    if (i < 0) { closeReview(); return; }
    const rec = records[i];
    if (dropPriority) rec.priority = false;
    const fee = dropPriority ? 0 : b.fee;
    const pricing = calculatePricing(b.fixing + fee, $('rvTax').checked);
    rec.fixingPrice = b.fixing;
    rec.fixedBy = fixedBy;
    rec.repairService = service;
    if (!String(rec.notes || '').includes('Service: ' + service)) rec.notes = [rec.notes, 'Service: ' + service].filter(Boolean).join('\n');
    rec.priorityFee = fee;
    rec.subtotal = pricing.subtotal; rec.subtotalFormatted = pricing.subtotalFormatted;
    rec.taxAmount = pricing.tax; rec.taxFormatted = pricing.taxFormatted;
    rec.isTaxable = $('rvTax').checked;
    rec.totalAmount = pricing.total; rec.totalFormatted = pricing.totalFormatted;
    rec.price = pricing.total; rec.priceFormatted = pricing.totalFormatted;
    records[i] = rec;
    saveRecords(records);
    pushRepair(rec);
    const id = rvId;
    closeReview();
    try { await confirmSelfIntake(id); }
    catch (err) { alert(err && err.message ? err.message : 'Could not confirm this check-in.'); }
  }
  $('rvClose').addEventListener('click', closeReview);
  $('rvCancel').addEventListener('click', closeReview);
  $('reviewModalOverlay').addEventListener('click', (e) => { if (e.target === $('reviewModalOverlay')) closeReview(); });
  $('rvPrice').addEventListener('input', rvRenderBreak);
  $('rvTax').addEventListener('change', rvRenderBreak);
  $('rvApprove').addEventListener('click', () => rvApprove(false));
  $('rvNoPrio').addEventListener('click', () => rvApprove(true));

  function deliverFromBoard(id){
    if(!PhoneFixAccess.can('ticket_edit'))return;
    const records = getRecords();
    const i = records.findIndex(r => isRec(r) && r.id === id);
    if (i < 0) return;
    const now = new Date();
    records[i].isDelivered = true;
    records[i].deliveredAt = `${niceDate(now)} ${niceTime(now)}`;
    records[i].statusChangedAt = `${niceDate(now)} ${niceTime(now)}`;
    records[i].deliveredDay = todayStamp();
    saveRecords(records);
    pushRepair(records[i]);
    renderHistory($('searchHistory').value); // keep the history list / "phone at store" panel in sync
    queueTick(true);
  }
  // move unfinished devices from a past day onto today's board
  function carryToToday(ids){
    if(!PhoneFixAccess.can('ticket_edit')) { alert("You don't have permission for this."); return; }
    const records = getRecords();
    const today = todayStamp(), now = Date.now();
    const idSet = new Set(ids);
    let serial = nextQueueSerial(today);
    const ser = (a, b) => (hasSerial(a) ? Number(a.queueSerial) : 1e9) - (hasSerial(b) ? Number(b.queueSerial) : 1e9) || (a.createdAt || 0) - (b.createdAt || 0);
    records.filter(r => isRec(r) && idSet.has(r.id) && !r.isDelivered && recDay(r) < today).sort(ser).forEach(r => {
      r.carriedFrom = isStamp(r.carriedFrom) ? r.carriedFrom : recDay(r);
      r.queueDay = today;
      r.queueSerial = serial++;
      r.readyBy = now + (qPriority(r) ? Q_PRIORITY_MIN : Q_REPAIR_MIN) * 60000;
      r.readyByLabel = readyLabel(r.readyBy, now);
    });
    if (serial - 1 >= nextQueueSerial(today)) commitQueueCounter(today, serial - 1);
    saveRecords(records);
    queueTick(true);
  }

  // customer dossier + "at store" line
  function openDossierFor(id){
    const r = getRecords().find(x => isRec(x) && x.id === id);
    if (!r || !r.customerId) return;
    openProfileModal(r.customerId);
    const line = $('profQueueLine');
    const mins = r.createdAt ? (Date.now() - r.createdAt) / 60000 : 0;
    line.textContent = '\ud83d\udcf1 ' + (r.device || 'Device') + ' at store ' + fmtMins(mins) + (r.createdAt ? ' (since ' + sinceText(r.createdAt) + ')' : '');
    line.hidden = false;
  }
  new MutationObserver(() => { if (profileModalOverlay.style.display === 'none') $('profQueueLine').hidden = true; })
    .observe(profileModalOverlay, { attributes: true, attributeFilter: ['style'] });

  $('queueView').addEventListener('click', (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.id === 'qvPrev') { boardDay = shiftStamp(viewDay(), -1); renderQueue(); return; }
    if (t.id === 'qvNext') { const n = shiftStamp(viewDay(), 1); boardDay = n >= todayStamp() ? null : n; renderQueue(); return; }
    if (t.id === 'qvToday') { boardDay = null; renderQueue(); return; }
    if (t.id === 'qvLeftReview') { boardDay = t.dataset.day || null; renderQueue(); window.scrollTo(0, 0); return; }
    if (t.id === 'qvCarryAll') { carryToToday(boardRecords(viewDay()).map(r => r.id)); return; }
    const card = t.closest('.qv-card');
    if (!card || !t.dataset.act) return;
    const id = card.dataset.id;
    const rec = getRecords().find(r => isRec(r) && r.id === id);
    if (!rec) { renderQueue(); return; }
    const st = normQueueStatus(rec);
    switch (t.dataset.act) {
      case 'priority': patchQueueRecord(id, { priority: !qPriority(rec) }); break;
      case 'status':
        if (st === 'queued') patchQueueRecord(id, { queueStatus: 'progress' });
        else if (st === 'progress') patchQueueRecord(id, { queueStatus: 'ready' });
        else deliverFromBoard(id);
        break;
      case 'back': patchQueueRecord(id, rec.isDelivered?{queueStatus:'ready',isDelivered:false,deliveredAt:null,deliveredDay:null}:{ queueStatus: st === 'ready' ? 'progress' : 'queued' }); renderHistory($('searchHistory').value); break;
      case 'carry': carryToToday([id]); break;
      case 'confirm': confirmSelfIntake(id); break;
      case 'review': openReview(id); break;
      case 'dossier': openDossierFor(id); break;
      case 'ticket': openHistoryModal('edit', id); break;
    }
  });
  let draggedTicket=null;
  $('qvGrid').addEventListener('dragstart',e=>{const card=e.target.closest('.qv-card');if(!card||!PhoneFixAccess.can('ticket_edit')){e.preventDefault();return;}draggedTicket=card.dataset.id;e.dataTransfer?.setData('text/plain',draggedTicket);});
  $('qvGrid').addEventListener('dragover',e=>{if(draggedTicket&&e.target.closest('[data-stage]'))e.preventDefault();});
  $('qvGrid').addEventListener('drop',e=>{e.preventDefault();const stage=e.target.closest('[data-stage]')?.dataset.stage,id=draggedTicket;draggedTicket=null;if(!id||!stage||!PhoneFixAccess.can('ticket_edit'))return;if(stage==='delivered')deliverFromBoard(id);else{patchQueueRecord(id,{queueStatus:stage,isDelivered:false,deliveredAt:null,deliveredDay:null});renderHistory($('searchHistory').value);}});
  $('qvGrid').addEventListener('dragend',()=>draggedTicket=null);
  $('qvSort').addEventListener('change', () => { try { sessionStorage.setItem(QUEUE_SORT_KEY, $('qvSort').value); } catch(e){} renderQueue(); });

  // ---- view switching ----
  function setView(view){
    const q = view === 'queue';
    const mainEl = document.querySelector('main');
    if (mainEl) mainEl.style.display = q ? 'none' : '';
    $('queueView').hidden = !q;
    $('tabIntake').classList.toggle('active', !q);
    $('tabQueue').classList.toggle('active', q);
    $('tabIntake').setAttribute('aria-selected', q ? 'false' : 'true');
    $('tabQueue').setAttribute('aria-selected', q ? 'true' : 'false');
    try { sessionStorage.setItem(QUEUE_VIEW_KEY, q ? 'queue' : 'intake'); } catch(e){}
    if (q) { boardDay = null; renderQueue(); }
    else { updateQueueBadge(); updateReadyByLive(); }
    const fab = $('intakeFabBtn'); if (fab) fab.classList.toggle('show', q);
    window.scrollTo(0, 0);
  }
  document.querySelectorAll('.view-tab').forEach(b => b.addEventListener('click', () => setView(b.dataset.view)));

  // ---- New Intake modal on the queue board: moves the REAL intake card in/out ----
  let intakeCardHome = null, intakeModalOpen = false;
  function openIntakeModal(){
    const card = $('intakeCard');
    if(!card || intakeModalOpen) return;
    intakeCardHome = document.createComment('intake-home');
    card.parentNode.insertBefore(intakeCardHome, card);
    $('intakeModalBody').appendChild(card);
    $('intakeModalOverlay').style.display = 'flex';
    document.body.style.overflow = 'hidden';
    intakeModalOpen = true;
    setTimeout(() => { const f = $('custPhone'); if (f) f.focus(); }, 60);
  }
  function closeIntakeModal(){
    if(!intakeModalOpen) return;
    const card = $('intakeCard');
    if(card && intakeCardHome && intakeCardHome.parentNode){
      intakeCardHome.parentNode.insertBefore(card, intakeCardHome);
      intakeCardHome.parentNode.removeChild(intakeCardHome);
    }
    intakeCardHome = null;
    $('intakeModalOverlay').style.display = 'none';
    document.body.style.overflow = '';
    intakeModalOpen = false;
  }
  $('qvNewIntakeBtn').addEventListener('click', openIntakeModal);
  $('intakeFabBtn').addEventListener('click', openIntakeModal);
  $('intakeModalClose').addEventListener('click', closeIntakeModal);
  $('intakeModalOverlay').addEventListener('click', (e) => { if(e.target === $('intakeModalOverlay')) closeIntakeModal(); });
  document.addEventListener('keydown', (e) => { if(e.key === 'Escape') closeIntakeModal(); });

  // ---- master search + hyperlinked cross-references ----
  function flashEl(el){
    if(!el) return;
    el.classList.remove('flash-link'); void el.offsetWidth; el.classList.add('flash-link');
    setTimeout(() => el.classList.remove('flash-link'), 1800);
  }
  function cssEsc(s){ return (window.CSS && CSS.escape) ? CSS.escape(s) : s; }
  function jumpToTicket(id){
    const rec = getRecords().find(r => isRec(r) && r.id === id);
    if(!rec) return;
    closeIntakeModal();
    msHide();
    if(!rec.isDelivered){
      setView('queue');
      setTimeout(() => {
        const card = document.querySelector('.qv-card[data-id="' + cssEsc(id) + '"]');
        if(card){ card.scrollIntoView({behavior:'smooth', block:'center'}); flashEl(card); }
        else openHistoryModal('edit', id);
      }, 90);
    } else {
      openHistoryModal('edit', id);
    }
  }
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-xlink]');
    if(!el) return;
    const kind = el.dataset.xlink;
    if(kind === 'dossier' && el.dataset.cust) openProfileModal(el.dataset.cust);
    else if(kind === 'ticket' && el.dataset.id) jumpToTicket(el.dataset.id);
  });

  const msInput = $('masterSearch'), msBox = $('masterSearchResults'), msClear = $('masterSearchClear');
  let msItems = [], msActive = -1;
  function msMark(text, q){
    const raw = String(text == null ? '' : text);
    const low = raw.toLowerCase(), ql = String(q).toLowerCase();
    if(!ql) return escapeHtml(raw);
    let out = '', i = 0, idx;
    while((idx = low.indexOf(ql, i)) !== -1){
      out += escapeHtml(raw.slice(i, idx)) + '<mark>' + escapeHtml(raw.slice(idx, idx + q.length)) + '</mark>';
      i = idx + q.length;
    }
    return out + escapeHtml(raw.slice(i));
  }
  function runMasterSearch(q){
    q = q.trim().toLowerCase();
    if(q.length < 2) return null;
    const qd = q.replace(/\D/g, '');
    const phoneHit = (p) => qd && String(p || '').replace(/\D/g, '').indexOf(qd) !== -1;
    const recs = getRecords().filter(isRec);
    const profiles = getProfiles();
    const customers = Object.values(profiles).filter(p =>
      (p.primaryName||'').toLowerCase().includes(q) ||
      (p.customerId||'').toLowerCase().includes(q) || phoneHit(p.primaryPhone)).slice(0,8);
    const tickets = recs.filter(r =>
      (r.id||'').toLowerCase().includes(q) || (r.name||'').toLowerCase().includes(q) ||
      (r.device||'').toLowerCase().includes(q) || phoneHit(r.phone))
      .sort((a,b) => b.createdAt - a.createdAt).slice(0,8);
    let inv = [];
    try{ inv = JSON.parse(localStorage.getItem('phoneRepairInventory') || '[]'); }catch(e){}
    const items = (Array.isArray(inv) ? inv : []).filter(it =>
      (it.imei||'').toLowerCase().includes(q) || (it.name||'').toLowerCase().includes(q) ||
      (it.layCustomer||'').toLowerCase().includes(q) || phoneHit(it.layPhone) || phoneHit(it.custPhone)).slice(0,8);
    let rawSO = [], rawCred = [];
    try{ rawSO = JSON.parse(localStorage.getItem('phoneRepairSpecialOrders')||'[]'); }catch(e){}
    try{ rawCred = JSON.parse(localStorage.getItem('phoneRepairStoreCredit')||'[]'); }catch(e){}
    const sos = (Array.isArray(rawSO)?rawSO:[]).filter(o =>
      (o.customer||'').toLowerCase().includes(q) || (o.item||'').toLowerCase().includes(q) ||
      (o.id||'').toLowerCase().includes(q) || phoneHit(o.phone)).slice(0,8);
    const creds = (Array.isArray(rawCred)?rawCred:[]).filter(o =>
      (o.customer||'').toLowerCase().includes(q) || (o.desc||'').toLowerCase().includes(q) ||
      (o.id||'').toLowerCase().includes(q) || phoneHit(o.phone)).slice(0,8);
    return {customers, tickets, items, sos, creds, q: q.trim()};
  }
  function renderMsResults(res){
    msItems = []; msActive = -1;
    if(!res){ msBox.hidden = true; msBox.innerHTML = ''; return; }
    const q = res.q;
    let html = '';
    if(res.customers.length){
      html += '<div class="ms-group"><div class="ms-gtitle">Customers</div>' + res.customers.map(p => {
        const ltv = computeCustomerLTV(p.customerId);
        msItems.push({type:'customer', custId:p.customerId});
        const n = msItems.length - 1;
        return '<button type="button" class="ms-item" data-ms="' + n + '">'
          + '<span class="ms-main"><span class="ms-t">' + msMark(p.primaryName || '—', q) + '</span>'
          + '<span class="ms-s mono">' + msMark(p.primaryPhone || '', q) + ' · ' + escapeHtml(p.customerId || '') + ' · ' + ltv.visits + ' visits</span></span></button>';
      }).join('') + '</div>';
    }
    if(res.tickets.length){
      html += '<div class="ms-group"><div class="ms-gtitle">Repair Tickets</div>' + res.tickets.map(r => {
        msItems.push({type:'ticket', id:r.id});
        const n = msItems.length - 1;
        const st = r.isDelivered ? 'Delivered' : (Q_LABEL[normQueueStatus(r)] || 'In shop');
        return '<button type="button" class="ms-item" data-ms="' + n + '">'
          + '<span class="ms-main"><span class="ms-t mono">' + msMark(r.id, q) + '</span>'
          + '<span class="ms-s">' + msMark(r.name || '', q) + ' · ' + msMark(r.device || '', q) + ' · ' + escapeHtml(st) + '</span></span></button>';
      }).join('') + '</div>';
    }
    if(res.items.length){
      html += '<div class="ms-group"><div class="ms-gtitle">Inventory</div>' + res.items.map(it => {
        msItems.push({type:'inventory', imei:it.imei});
        const n = msItems.length - 1;
        return '<button type="button" class="ms-item" data-ms="' + n + '">'
          + '<span class="ms-main"><span class="ms-t">' + msMark(it.name || 'Phone', q) + '</span>'
          + '<span class="ms-s mono">' + msMark(it.imei || '', q) + '</span>'
          + '<span class="ms-s"> · ' + escapeHtml(it.status || '') + '</span></span></button>';
      }).join('') + '</div>';
    }
    if(res.sos.length){
      html += '<div class="ms-group"><div class="ms-gtitle">Special Orders</div>' + res.sos.map(o => {
        msItems.push({type:'so', id:o.id});
        const n = msItems.length - 1;
        return '<button type="button" class="ms-item" data-ms="' + n + '">'
          + '<span class="ms-main"><span class="ms-t">' + msMark(o.item || 'Order', q) + '</span>'
          + '<span class="ms-s">' + msMark(o.customer || '', q) + ' · ' + escapeHtml(o.id || '') + ' · ' + escapeHtml(o.status || '') + '</span></span></button>';
      }).join('') + '</div>';
    }
    if(res.creds.length){
      html += '<div class="ms-group"><div class="ms-gtitle">Store Credit</div>' + res.creds.map(o => {
        msItems.push({type:'cred', id:o.id});
        const n = msItems.length - 1;
        return '<button type="button" class="ms-item" data-ms="' + n + '">'
          + '<span class="ms-main"><span class="ms-t">' + msMark(o.customer || 'Credit', q) + '</span>'
          + '<span class="ms-s">' + escapeHtml(o.id || '') + ' · ' + escapeHtml(o.phone || '') + '</span></span></button>';
      }).join('') + '</div>';
    }
    if(!html) html = '<div class="ms-empty">No matches for &ldquo;' + escapeHtml(q) + '&rdquo;</div>';
    msBox.innerHTML = html;
    msBox.hidden = false;
  }
  function msHide(){ msBox.hidden = true; msActive = -1; }
  function msPick(sel){
    if(!sel) return;
    msHide();
    if(sel.type === 'customer'){
      const p = getProfiles()[sel.custId];
      if(!p) return;
      closeIntakeModal();
      fields.phone.value = p.primaryPhone || '';
      fields.name.value = p.primaryName || '';
      triggerCustomerLookup();
      const card = $('intakeCard');
      if(card) card.scrollIntoView({behavior:'smooth', block:'start'});
      setTimeout(() => fields.device.focus(), 350);
    } else if(sel.type === 'ticket'){
      jumpToTicket(sel.id);
    } else if(sel.type === 'inventory'){
      const tab = $('tabInventory');
      if(tab) tab.click();
      setTimeout(() => {
        const card = document.querySelector('.inv-card[data-imei="' + cssEsc(sel.imei) + '"]');
        if(card){ card.scrollIntoView({behavior:'smooth', block:'center'}); flashEl(card); }
      }, 150);
    } else if(sel.type === 'so' || sel.type === 'cred'){
      const tab = $('tabStoreCredit');
      if(tab) tab.click();
      setTimeout(() => {
        const sub = $(sel.type === 'so' ? 'scTabSO' : 'scTabCred');
        if(sub) sub.click();
        setTimeout(() => {
          const card = document.querySelector((sel.type === 'so' ? '#scSOList' : '#scCredList') + ' .sc-card[data-id="' + cssEsc(sel.id) + '"]');
          if(card){ card.scrollIntoView({behavior:'smooth', block:'center'}); flashEl(card); }
        }, 150);
      }, 150);
    }
  }
  msBox.addEventListener('click', (e) => {
    const b = e.target.closest('[data-ms]');
    if(b) msPick(msItems[+b.dataset.ms]);
  });
  msInput.addEventListener('input', () => {
    msClear.hidden = !msInput.value;
    renderMsResults(runMasterSearch(msInput.value));
  });
  msInput.addEventListener('keydown', (e) => {
    const items = msBox.querySelectorAll('[data-ms]');
    if(e.key === 'Escape'){ msHide(); msInput.blur(); return; }
    if(msBox.hidden || !items.length) return;
    if(e.key === 'ArrowDown'){ e.preventDefault(); msActive = (msActive + 1) % items.length; }
    else if(e.key === 'ArrowUp'){ e.preventDefault(); msActive = (msActive - 1 + items.length) % items.length; }
    else if(e.key === 'Enter'){ e.preventDefault(); (msActive >= 0 ? items[msActive] : items[0]).click(); return; }
    else return;
    items.forEach((it, i) => it.classList.toggle('active', i === msActive));
    if(items[msActive]) items[msActive].scrollIntoView({block:'nearest'});
  });
  msClear.addEventListener('click', () => { msInput.value = ''; msClear.hidden = true; msHide(); msInput.focus(); });
  document.addEventListener('click', (e) => { if(!e.target.closest('#masterSearchWrap')) msHide(); });

  // ---- live refresh: data changes (also from other tabs) + a 30s tick for countdowns / estimates ----
  let queueLastRaw = null, queueLastBucket = -1;
  function queueTick(force){
    const raw = localStorage.getItem(STORAGE_KEY) || '';
    const bucket = Math.floor(Date.now() / 30000);
    if (!force && raw === queueLastRaw && bucket === queueLastBucket) return;
    queueLastRaw = raw; queueLastBucket = bucket;
    updateQueueBadge();
    updateReadyByLive();
    if (queueIsOpen()) renderQueue();
  }
  window.addEventListener('storage', (e) => { if (e.key === STORAGE_KEY || e.key === null) queueTick(); });
  setInterval(queueTick, 2000);

  // ---- scroll-to-top button (bottom-left, both views) ----
  (function(){
    const btn = $('scrollTopBtn');
    const sync = () => btn.classList.toggle('show', window.scrollY > 400);
    window.addEventListener('scroll', sync, { passive: true });
    btn.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
    sync();
  })();

  // ---- start up ----
  migrateQueueRecords();
  (function(){
    try { const s = sessionStorage.getItem(QUEUE_SORT_KEY); if (s) $('qvSort').value = s; } catch(e){}
    if (!$('qvSort').value) $('qvSort').value = 'serial-asc';
    let saved = 'intake';
    try { saved = sessionStorage.getItem(QUEUE_VIEW_KEY) || 'intake'; } catch(e){}
    syncPriorityUi();
    setView(saved === 'queue' ? 'queue' : 'intake');
    queueTick(true);
  })();

  reserveNewTicket();
  renderHistory('');
  if (window.innerWidth <= 560) { var _fp = $('fixedPanel'); if (_fp) _fp.classList.add('collapsed'); }
  window.addEventListener('online', function(){ flushRepairs(); flushWarrantyOutbox(); }); setInterval(flushRepairs, 60000);
  flushRepairs();
  pullRepairs();
  // Auto-refresh: new check-ins appear on the dashboard without a manual
  // reload. Skips a tick while the tab is hidden or while local edits are
  // still waiting to be pushed, so a refresh can never clobber unsynced work.
  setInterval(function(){
    try { if (document.hidden || !navigator.onLine) return; } catch(e){ return; }
    try { if (Object.keys(rdDirty()).length) return; } catch(e){}
    pullRepairs();
  }, 30000);
  warrantyBackfillOnce();
  flushWarrantyOutbox();

window.PhoneFixManager.register('repairs', function(id,value,remove){
 const rows=getRecords(),old=rows.find(r=>r.id===id);if(!old)throw new Error('Record no longer exists');
 if(remove){const uses=readPartUsage(),keep=[];uses.forEach(u=>{if(u.ticketId===id){window.__invReturnPart?.(u.sku,u.qty);window.__invPushUsage?.({...u,deleted:true});}else keep.push(u);});savePartUsage(keep);}
 else {if(value.subtotal!==old.subtotal||value.isTaxable!==old.isTaxable){const sub=Number(value.subtotal)||0,tax=value.isTaxable?Math.round(sub*8)/100:0;Object.assign(value,{taxAmount:tax,price:Math.round((sub+tax)*100)/100,totalAmount:Math.round((sub+tax)*100)/100});}value.priceFormatted=formatMoney(value.price);value.totalFormatted=formatMoney(value.price);value.subtotalFormatted=formatMoney(value.subtotal);value.taxFormatted=formatMoney(value.taxAmount);value.dateDisplay=niceDate(new Date(value.createdAt))+' '+niceTime(new Date(value.createdAt));if(value.isDelivered&&!old.isDelivered){value.deliveredAt=new Date().toISOString();value.deliveredDay=dayStampOf(Date.now());}if(!value.isDelivered){value.deliveredAt=null;value.deliveredDay=null;}value.statusChangedAt=niceDate(new Date())+' '+niceTime(new Date());}
 if(!saveRecords(remove?rows.filter(r=>r.id!==id):rows.map(r=>r.id===id?value:r)))throw new Error('Could not save');pushRepair(remove?old:value,remove);renderHistory($('searchHistory').value);renderQueue();
});
window.PhoneFixManager.register('customers',function(id,value,remove){const profiles=getProfiles();if(remove)delete profiles[id];else profiles[id]=value;saveProfiles(profiles);renderHistory($('searchHistory').value);});
window.PhoneFixRepairBridge={
 stage:function(rec,deleted){return fetch(GOOGLE_SHEET_URL,{method:'POST',mode:'no-cors',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify(repairBody(rec,!!deleted))});},
 read:function(){return fetch(GOOGLE_SHEET_URL+'?action=repairs&_='+Date.now()).then(function(r){if(!r.ok)throw new Error('Repairs Sheet verification failed');return r.json();});}
};
})();
