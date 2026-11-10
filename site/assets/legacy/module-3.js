
(function(){
  'use strict';
  /* ============ PARTS inventory (sub-tab of Inventory; SKU-keyed, sheet-synced) ============ */
  var $ = function(id){ return document.getElementById(id); };
  var ENDPOINT = 'https://script.google.com/macros/s/AKfycbxI_O5ZtLFcln6GYPgjphmzkji4-VZfeedhd--4Z26u01iNeRZPgpIg16iY5tQ5HHvSJg/exec';
  var PARTS_KEY = 'phoneRepairParts', DIRTY_KEY = 'phoneRepairPartsDirty';

  var BASE_BRANDS = ['Apple','Samsung','Motorola','Google'];
  var BASE_TYPES = ['LCD Assembly','OLED Assembly','Battery','Battery Flex Cable','Charging Port Flex Cable','Charging Port','Tempered Glass','Camera Lens Protector'];
  var BASE_GRADES = {
    'LCD Assembly': ['Aftermarket Incell / QV6','Aftermarket Incell / QV7','Aftermarket Incell / QV7 V3 (True Tone NOT required)','SERVICE PACK'],
    'OLED Assembly': ['Aftermarket Hard / QV8','Aftermarket Soft / QV8','Soft OLED / QV8','Aftermarket Pro Soft','QV8 V3 Soft (True Tone NOT required)','Premium Assembled','Premium','SERVICE PACK','Genuine','OEM Pull A Grade','OEM Pull B Grade'],
    'Battery': ['QMAX Base','QMAX Plus','QMAX Pro','QMAX Prime V3','QMAX Extended Capacity','Premium'],
    'Battery Flex Cable': ['Standard'],
    'Charging Port Flex Cable': ['Premium','Standard'],
    'Charging Port': ['Standard'],
    'Tempered Glass': ['Clear 2.5D','Edge-to-Edge Black','Privacy','Matte','QUARTZ Clear','QUARTZ Privacy'],
    'Camera Lens Protector': ['Clear','QUARTZ HD']
  };

  /* ---------- custom lists (added from the UI, no code edits; saved in localStorage) ---------- */
  var LISTS_KEY = 'phoneRepairPartLists';
  var ADD_BRAND = '__ADD_BRAND__', ADD_TYPE = '__ADD_TYPE__', ADD_GRADE = '__ADD_GRADE__';
  function loadLists(){ var l = readJSON(LISTS_KEY, null); if (!l || typeof l !== 'object') l = {}; if (!Array.isArray(l.brands)) l.brands = []; if (!Array.isArray(l.types)) l.types = []; if (!l.grades || typeof l.grades !== 'object') l.grades = {}; return l; }
  function saveLists(l){ writeJSON(LISTS_KEY, l || {}); }
  function dedupeCI(arr){ var seen = {}, out = []; arr.forEach(function(v){ var k = String(v).toLowerCase(); if (!seen[k]){ seen[k] = 1; out.push(v); } }); return out; }
  function listBrands(){ return dedupeCI(BASE_BRANDS.concat(loadLists().brands)); }
  function listTypes(){ return dedupeCI(BASE_TYPES.concat(loadLists().types)); }
  function listGrades(t){ var base = BASE_GRADES[t] || ['Standard']; return dedupeCI(base.concat((loadLists().grades[t] || []))); }

  function esc(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
  function readJSON(k, d){ try { var v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch(e){ return d; } }
  function writeJSON(k, v){ try { localStorage.setItem(k, JSON.stringify(v)); } catch(e){} }
  function numOrBlank(v){ if (v === '' || v == null) return ''; var n = parseFloat(String(v).replace(/[^0-9.\-]/g, '')); return isFinite(n) ? n : ''; }
  function todayISO(){ var d = new Date(), p = function(n){ return String(n).padStart(2,'0'); }; return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate()); }
  function fmt$(n){ n = Number(n) || 0; return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

  var parts = [], brandF = '', reorderMode = false, editSku = null, delArm = null;

  /* ---------- section sub-tabs (LCD / Other Parts / customs; data-driven) ---------- */
  var BASE_SECTIONS = ['LCD', 'Other Parts'];
  var SEC_LISTS_KEY = 'phoneRepairPartSections';
  var ADD_SECTION = '__ADD_SECTION__';
  var sectionF = '';
  function loadSecLists(){ var a = readJSON(SEC_LISTS_KEY, []); return Array.isArray(a) ? a : []; }
  function saveSecLists(a){ writeJSON(SEC_LISTS_KEY, a || []); }
  function screenType(t){ return /lcd|oled|digitizer/i.test(String(t || '')); }
  /* Stored section wins; blank falls back to the type rule (digitizers count as screens). */
  function partSection(p){ var s = String((p && p.section) || '').trim(); return s || (screenType(p && p.type) ? 'LCD' : 'Other Parts'); }
  function listSections(){
    var customs = [];
    loadSecLists().forEach(function(s){ if (s && BASE_SECTIONS.indexOf(s) < 0) customs.push(s); });
    parts.forEach(function(p){ var s = String(p.section || '').trim(); if (s && BASE_SECTIONS.indexOf(s) < 0 && customs.indexOf(s) < 0) customs.push(s); });
    customs.sort(function(a, b){ return a.toLowerCase().localeCompare(b.toLowerCase()); });
    return BASE_SECTIONS.concat(dedupeCI(customs));
  }

  /* ---------- To Order queue (local) + part usage log (synced to the PartUsage sheet tab) ---------- */
  var ORDER_KEY = 'phoneRepairToOrder', USAGE_KEY = 'phoneRepairPartUsage', REPAIRS_KEY = 'phoneRepairIntakes';
  var toOrder = [], partUsage = [], toOrderMode = false, clearArm = false;
  function loadOrderUsage(){
    toOrder = readJSON(ORDER_KEY, []).filter(function(o){ return o && o.sku; });
    partUsage = readJSON(USAGE_KEY, []).filter(function(u){ return u && u.sku; });
  }
  function saveOrder(){ writeJSON(ORDER_KEY, toOrder); }
  function saveUsage(){ writeJSON(USAGE_KEY, partUsage); }
  function ptFmtAdded(iso){
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
    if (!m) return String(iso || '');
    return new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }
  function orderCount(){ var n = 0; toOrder.forEach(function(o){ if (!o.added) n += Number(o.qty) || 0; }); return n; }
  function addedEntries(){ return toOrder.filter(function(o){ return o.added; }); }
  function updateOrderBadge(){
    var el = $('ptToOrderCount'); if (!el) return;
    var n = orderCount(); el.textContent = n ? '(' + n + ')' : '';
  }
  function addToOrder(sku){ adjustOrder(sku, 1); }
  /* Adjust the To Order queue by delta (negative removes; entry drops at 0). */
  function adjustOrder(sku, delta){
    if (!sku || !delta) return;
    var e = null; toOrder.forEach(function(o){ if (o.sku === sku) e = o; });
    if (delta > 0){ if (e) { e.qty = (Number(e.qty) || 0) + delta; delete e.added; } else toOrder.push({ sku: sku, qty: delta, ts: Date.now() }); }
    else if (e){ e.qty = Math.max(0, (Number(e.qty) || 0) + delta); if (!e.qty) toOrder = toOrder.filter(function(o){ return o !== e; }); else delete e.added; }
    orderChanged(sku);
  }
  /* Adjust on-hand stock by delta (never below 0) + sheet sync. No-op if the part is gone. */
  function adjustStock(sku, delta){
    if (!sku || !delta) return;
    var p = find(sku); if (!p) return;
    p.qty = Math.max(0, p.qty + delta);
    persist(); pushPart(p, false);
  }
  /* Use a part: deduct stock, queue it for reorder, log usage against a ticket.
     Stock clamps at 0; the full qty is still logged + queued (it was consumed). */
  function usePart(sku, ticketId, qty){
    var p = find(sku); if (!p) return;
    qty = Math.max(1, parseInt(qty, 10) || 1);
    adjustStock(sku, -qty);
    adjustOrder(sku, qty);
    var entry = { id: newUsageId(), sku: p.sku, brand: p.brand || '', model: p.model, type: p.type, color: p.color, ticketId: ticketId || '', date: todayISO(), qty: qty, cost: p.cost };
    logUsage(entry);
    pushUsage(entry);
    render();
  }
  /* Shared with the intake form + ticket edit modal (same code path, no duplicate logic). */
  window.__invUsePart = usePart;
  window.__invReturnPart = function(sku, qty){ qty = Math.max(0, parseInt(qty, 10) || 0); if (!qty) return; adjustStock(sku, qty); adjustOrder(sku, -qty); render(); };
  window.__invTakePart = function(sku, qty){ qty = Math.max(0, parseInt(qty, 10) || 0); if (!qty) return; adjustStock(sku, -qty); adjustOrder(sku, qty); render(); };
  /* Shared with the accessories reorder list: add qty straight to the To Order queue. */
  window.__invAddToOrder = function(sku, qty){ qty = Math.max(1, parseInt(qty, 10) || 1); if (sku) adjustOrder(sku, qty); };
  function logUsage(entry){
    refreshUsage();
    partUsage.push(entry);
    if (partUsage.length > 5000) partUsage = partUsage.slice(partUsage.length - 5000);
    saveUsage();
  }
  function usageCount(sku){ refreshUsage(); var n = 0; partUsage.forEach(function(u){ if (u.sku === sku) n += Number(u.qty) || 0; }); return n; }
  /* The ticket editor (main script) reads/writes the same localStorage key directly,
     so re-read before every local mutation — otherwise a ticket-edit change gets
     silently overwritten by the next in-memory save. */
  function refreshUsage(){ partUsage = readJSON(USAGE_KEY, []).filter(function(u){ return u && u.sku; }); }

  /* ---------- Part usage sheet sync (PartUsage tab; append-only, id-deduped) ---------- */
  var USAGE_OUTBOX_KEY = 'phoneRepairUsageOutbox', USAGE_PUSHED_KEY = 'phoneRepairUsagePushed', USAGE_BACKFILL_KEY = 'phoneRepairUsageBackfilled';
  function newUsageId(){ return 'USE-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).slice(2, 8).toUpperCase(); }
  function usageBody(e){
    var b = { recordType: 'partUsage', id: e.id, date: e.date, ticketId: e.ticketId, sku: e.sku, brand: e.brand, model: e.model, type: e.type, color: e.color, qty: e.qty, cost: e.cost };
    if (e.deleted) b.deleted = true;
    return b;
  }
  function markUsagePushed(id){
    var a = readJSON(USAGE_PUSHED_KEY, []);
    if (a.indexOf(id) < 0){ a.push(id); writeJSON(USAGE_PUSHED_KEY, a); }
  }
  /* Queue a usage entry for the sheet, then flush. Failures stay queued for next time. */
  function pushUsage(entry){
    if (entry && entry.id){
      var outbox = readJSON(USAGE_OUTBOX_KEY, []);
      if (!outbox.some(function(e){ return e.id === entry.id; })) outbox.push(entry);
      writeJSON(USAGE_OUTBOX_KEY, outbox);
    }
    flushUsageOutbox();
  }
  /* Shared with the history edit modal: queue a usage change (upsert or delete by ID).
     Replaces any queued entry with the same ID so the latest change wins. */
  window.__invPushUsage = function(entry){
    if (entry && entry.id){
      var outbox = readJSON(USAGE_OUTBOX_KEY, []);
      var i = -1;
      for (var k = 0; k < outbox.length; k++) if (outbox[k] && outbox[k].id === entry.id){ i = k; break; }
      if (i >= 0) outbox[i] = entry; else outbox.push(entry);
      writeJSON(USAGE_OUTBOX_KEY, outbox);
    }
    flushUsageOutbox();
  };
  window.PhoneFixUsageBridge = {
    stage: function(entry){ return fetch(ENDPOINT,{method:'POST',mode:'no-cors',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify(usageBody(entry))}); },
    read: function(){ return fetch(ENDPOINT+'?action=usage&_='+Date.now()).then(function(r){if(!r.ok)throw new Error('PartUsage Sheet verification failed');return r.json();}); }
  };
  function flushUsageOutbox(){
    var outbox = readJSON(USAGE_OUTBOX_KEY, []);
    if (!outbox.length || !ENDPOINT || !navigator.onLine) return;
    writeJSON(USAGE_OUTBOX_KEY, []); // take the batch; failures re-queue below (server dedupes by id)
    (function next(){
      var e = outbox.shift();
      if (!e) return;
      try {
        fetch(ENDPOINT, { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(usageBody(e)) })
          .then(function(){ markUsagePushed(e.id); next(); })
          .catch(function(){
            var cur = readJSON(USAGE_OUTBOX_KEY, []);
            cur.unshift(e);
            outbox.forEach(function(x){ if (!cur.some(function(y){ return y.id === x.id; })) cur.push(x); });
            writeJSON(USAGE_OUTBOX_KEY, cur);
          });
      } catch(err){
        var cur2 = readJSON(USAGE_OUTBOX_KEY, []);
        cur2.unshift(e);
        writeJSON(USAGE_OUTBOX_KEY, cur2);
      }
    })();
  }
  /* Pull the sheet log and merge by id (entries are immutable: add missing only). */
  function pullUsage(){
    if (!ENDPOINT || !navigator.onLine) return;
    fetch(ENDPOINT + '?action=usage').then(function(r){ if (!r.ok) throw 0; return r.json(); })
      .then(function(data){
        if (!Array.isArray(data)) return;
        refreshUsage();
        var have = {};
        partUsage.forEach(function(u){ if (u && u.id) have[u.id] = 1; });
        var added = false;
        data.forEach(function(o){
          if (!o || !o.id || have[o.id]) return;
          partUsage.push({ id: String(o.id), sku: String(o.sku || ''), brand: String(o.brand || ''), model: String(o.model || ''),
            type: String(o.type || ''), color: String(o.color || ''), ticketId: String(o.ticketId || ''),
            date: String(o.date || '').slice(0, 10), qty: Number(o.qty) || 0, cost: Number(o.cost) || 0 });
          have[o.id] = 1; added = true;
        });
        if (added){ saveUsage(); render(); }
      })
      .catch(function(){});
  }
  /* One-time backfill: give old local entries ids and push them up once. */
  function backfillUsage(){
    if (readJSON(USAGE_BACKFILL_KEY, false)) return;
    refreshUsage();
    var pushed = readJSON(USAGE_PUSHED_KEY, []);
    var have = {}; pushed.forEach(function(id){ have[id] = 1; });
    var changed = false, pending = [];
    partUsage.forEach(function(u){
      if (!u || !u.sku) return;
      if (!u.id){ u.id = newUsageId(); changed = true; }
      if (!have[u.id]) pending.push(u);
    });
    if (changed) saveUsage();
    if (!pending.length){ writeJSON(USAGE_BACKFILL_KEY, true); return; }
    if (!ENDPOINT || !navigator.onLine) return; // retry next start
    var i = 0, ok = true;
    (function next(){
      if (i >= pending.length){ if (ok) writeJSON(USAGE_BACKFILL_KEY, true); return; }
      var e = pending[i++];
      try {
        fetch(ENDPOINT, { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(usageBody(e)) })
          .then(function(){ markUsagePushed(e.id); next(); })
          .catch(function(){ ok = false; pushUsage(e); next(); });
      } catch(err){ ok = false; pushUsage(e); next(); }
    })();
  }

  function normPart(o){
    o = o || {};
    return {
      sku: String(o.sku || o.SKU || '').trim().toUpperCase(),
      brand: String(o.brand || o.Brand || ''),
      model: String(o.model || o.phoneModel || o['Phone Model'] || '').trim(),
      type: String(o.type || o.partType || o['Part Type'] || ''),
      grade: String(o.grade || o.Grade || ''),
      color: String(o.color || o.Color || ''),
      qty: Math.max(0, parseInt(o.qty || o.Qty || 0, 10) || 0),
      cost: numOrBlank(o.cost == null ? o.unitCost : o.cost) === '' ? 0 : Number(numOrBlank(o.cost == null ? o.unitCost : o.cost)),
      sup: String(o.sup || o.supplier || o.Supplier || 'PhoneLCDParts'),
      low: Math.max(0, parseInt(o.low == null ? o.lowAt : o.low, 10) || 0),
      notes: String(o.notes || o.Notes || ''),
      date: String(o.date || o.dateAdded || o['Date Added'] || todayISO()).slice(0, 10),
      section: String(o.section || o.Section || '')
    };
  }
  function persist(){ writeJSON(PARTS_KEY, parts); }
  function load(){ parts = readJSON(PARTS_KEY, []).map(normPart).filter(function(p){ return p.sku; }); }

  /* ---------- dirty tracking (same pattern as phones) ---------- */
  function readDirty(){ try { return JSON.parse(localStorage.getItem(DIRTY_KEY) || '{}') || {}; } catch(e){ return {}; } }
  function writeDirty(m){ try { localStorage.setItem(DIRTY_KEY, JSON.stringify(m)); } catch(e){} }
  function markDirty(sku, deleted){ if(!sku) return; var m = readDirty(); m[sku] = { t: Date.now(), del: !!deleted }; writeDirty(m); }
  function clearDirty(sku, sinceT){ var m = readDirty(); if(m[sku] && m[sku].t <= sinceT){ delete m[sku]; writeDirty(m); } }

  /* ---------- To Order queue sheet sync (shared across devices; SKU-keyed) ---------- */
  var ORDER_DIRTY_KEY = 'phoneRepairToOrderDirty';
  function readOrderDirty(){ try { return JSON.parse(localStorage.getItem(ORDER_DIRTY_KEY) || '{}') || {}; } catch(e){ return {}; } }
  function writeOrderDirty(m){ try { localStorage.setItem(ORDER_DIRTY_KEY, JSON.stringify(m)); } catch(e){} }
  function pushOrder(sku, qty, deleted){
    if (!sku) return;
    var m = readOrderDirty(); m[sku] = { t: Date.now(), del: !!deleted }; writeOrderDirty(m);
    var t0 = Date.now();
    if (!navigator.onLine) return;
    var body = { recordType: 'toOrder', sku: sku };
    if (deleted) body.deleted = true; else body.qty = qty;
    fetch(ENDPOINT, { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) })
      .then(function(){ var m2 = readOrderDirty(); if (m2[sku] && m2[sku].t <= t0){ delete m2[sku]; writeOrderDirty(m2); } })
      .catch(function(){});
  }
  /* After any local To Order change: persist, badge, and push this SKU's new state. */
  function orderChanged(sku){
    saveOrder(); updateOrderBadge();
    var e = null; toOrder.forEach(function(o){ if (o.sku === sku) e = o; });
    if (e) pushOrder(sku, e.qty, false); else pushOrder(sku, 0, true);
  }
  function pullOrder(){
    if (!ENDPOINT || !navigator.onLine) return;
    fetch(ENDPOINT + '?action=toorder').then(function(r){ if(!r.ok) throw 0; return r.json(); })
      .then(function(data){
        var arr = Array.isArray(data) ? data : [];
        var map = {};
        arr.forEach(function(row){
          if (row && row.sku) map[String(row.sku).trim().toUpperCase()] = Math.max(0, parseInt(row.qty, 10) || 0);
        });
        var keys = Object.keys(map);
        var local = readJSON(ORDER_KEY, []);
        if (!keys.length && local.length) return; // empty sheet: never wipe local
        var dirty = readOrderDirty();
        var bySku = {}; local.forEach(function(o){ if (o && o.sku) bySku[o.sku] = o; });
        var list = [];
        keys.forEach(function(sku){
          var d = dirty[sku];
          if (d){
            if (d.del) return; // locally deleted wins
            if (bySku[sku]) list.push(bySku[sku]);
          } else if (map[sku] > 0){
            // keep the local ✓ Added check across pulls when the qty still matches (the flag itself is device-local)
            var keepAdded = (bySku[sku] && bySku[sku].added && Number(bySku[sku].qty) === map[sku]) ? { added: true } : {};
            if (bySku[sku] && bySku[sku].ts){ keepAdded.ts = bySku[sku].ts; if (bySku[sku].tsDateOnly) keepAdded.tsDateOnly = true; }
            list.push(Object.assign({ sku: sku, qty: map[sku] }, keepAdded));
          }
        });
        Object.keys(dirty).forEach(function(sku){
          var d = dirty[sku];
          var exists = list.some(function(o){ return o.sku === sku; });
          if (!d.del && !exists && bySku[sku]) list.push(bySku[sku]);
        });
        toOrder = list; saveOrder(); updateOrderBadge(); render();
      }).catch(function(){});
  }

  function setSync(s){
    var el = $('ptSync'); if(!el) return;
    var map = { local:['#999','local'], syncing:['#b80','syncing'], synced:['#0a0','synced'], offline:['#c00','offline'] };
    var c = map[s] || map.local; el.style.color = c[0]; el.textContent = '\u25CF ' + c[1];
  }

  function pushPart(p, deleted){
    var body = { recordType: 'part', sku: p.sku, brand: p.brand, model: p.model, type: p.type,
      grade: p.grade, color: p.color, qty: p.qty, cost: p.cost, sup: p.sup, low: p.low, notes: p.notes, date: p.date,
      section: partSection(p) };
    if (deleted) body.deleted = true;
    markDirty(p.sku, deleted);
    var t0 = Date.now();
    if (!navigator.onLine){ setSync('offline'); return; }
    setSync('syncing');
    fetch(ENDPOINT, { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) })
      .then(function(){ clearDirty(p.sku, t0); setSync('synced'); })
      .catch(function(){ setSync('offline'); });
  }

  /* Heal: a blank field in a sheet row must never wipe a good local value.
     If the local copy has a value where the sheet is blank, keep the local value
     and mark the row to be re-pushed, so the sheet heals itself on next pull. */
  var HEAL_FIELDS = ['brand','model','type','grade','color','qty','cost','sup','low','notes','date','section'];
  function healPart(sheetP, localP){
    if (!localP) return { part: sheetP, healed: false };
    var out = Object.assign({}, sheetP), healed = false;
    HEAL_FIELDS.forEach(function(f){
      if ((out[f] === '' || out[f] == null) && localP[f] !== '' && localP[f] != null){ out[f] = localP[f]; healed = true; }
    });
    return { part: out, healed: healed };
  }

  function pullParts(){
    if (!navigator.onLine){ setSync('offline'); return; }
    setSync('syncing');
    fetch(ENDPOINT + '?action=parts').then(function(r){ if(!r.ok) throw 0; return r.json(); })
      .then(async function(data){
        if(Array.isArray(data))data=await PhoneFixCommerce.reconcileStock('parts',data);
        var arr = Array.isArray(data) ? data : (data && (data.data || data.items || data.rows));
        if (!Array.isArray(arr)) return;
        var map = {}, order = [];
        arr.forEach(function(row){
          if (row && String(row.deleted).toLowerCase() === 'true') return;
          var p = normPart(row); if (!p.sku) return;
          if (!map[p.sku]) order.push(p.sku); map[p.sku] = p;
        });
        var local = readJSON(PARTS_KEY, []);
        if (!order.length && local.length) return; // empty sheet: never wipe local
        var bySku = {}; local.forEach(function(p){ if(p && p.sku) bySku[p.sku] = p; });
        var rePush = [];
        var list = order.map(function(k){
          var h = healPart(map[k], bySku[k]);
          if (h.healed) rePush.push(h.part);
          return h.part;
        });
        var dirty = readDirty();
        Object.keys(dirty).forEach(function(sku){
          var d = dirty[sku], lp = bySku[sku];
          if (d.del){ list = list.filter(function(p){ return p.sku !== sku; }); }
          else if (lp){
            var idx = -1;
            for (var i = 0; i < list.length; i++) if (list[i].sku === sku){ idx = i; break; }
            if (idx >= 0) list[idx] = lp; else list.push(lp);
            rePush.push(lp);
          }
        });
        parts = list; persist(); setSync('synced'); render();
        var pushed = {};
        rePush.forEach(function(p){ if (p && p.sku && !pushed[p.sku]){ pushed[p.sku] = 1; pushPart(p, false); } });
      }).catch(function(){ setSync('offline'); });
  }

  /* ---------- render ---------- */
  function isLow(p){ return p.qty <= p.low; }
  function render(){
    // section sub-tab chips (data-driven)
    $('ptSections').innerHTML = '<button type="button" class="pt-bchip' + (sectionF === '' ? ' on' : '') + '" data-s="">All</button>' +
      listSections().map(function(s){ return '<button type="button" class="pt-bchip' + (sectionF === s ? ' on' : '') + '" data-s="' + esc(s) + '">' + esc(s) + '</button>'; }).join('');
    // brand chips
    $('ptBrands').innerHTML = '<button type="button" class="pt-bchip' + (brandF === '' ? ' on' : '') + '" data-b="">All</button>' +
      listBrands().map(function(b){ return '<button type="button" class="pt-bchip' + (brandF === b ? ' on' : '') + '" data-b="' + esc(b) + '">' + esc(b) + '</button>'; }).join('');
    // model filter
    var models = {};
    parts.forEach(function(p){ if(!brandF || p.brand === brandF) models[p.model] = 1; });
    var mf = $('ptModelF'), cur = mf.value;
    mf.innerHTML = '<option value="">All models</option>' + Object.keys(models).sort().map(function(m){
      return '<option value="' + esc(m) + '"' + (m === cur ? ' selected' : '') + '>' + esc(m) + '</option>'; }).join('');
    // stats
    var units = 0, cash = 0, low = 0;
    parts.forEach(function(p){ if(brandF && p.brand !== brandF) return; if(sectionF && partSection(p) !== sectionF) return; units += p.qty; cash += p.qty * p.cost; if (isLow(p)) low++; });
    $('ptUnits').textContent = units;
    $('ptCash').textContent = '$' + Math.round(cash).toLocaleString('en-US');
    $('ptLow').textContent = low;
    $('ptLowW').className = 'pt-stat' + (low ? ' warn' : '');
    var tc = $('ptTabCount'); if (tc) tc.textContent = low ? '(' + low + ' low)' : '';
    updateOrderBadge();
    // list
    var q = $('ptSearch').value.trim().toLowerCase(), fm2 = mf.value;
    var list = parts.filter(function(p){
      return (!sectionF || partSection(p) === sectionF) && (!brandF || p.brand === brandF) && (!fm2 || p.model === fm2) &&
        (!q || (p.model + ' ' + p.type + ' ' + p.grade + ' ' + (p.color || '') + ' ' + p.sku).toLowerCase().indexOf(q) >= 0);
    });
    if (toOrderMode){
      renderToOrder();
      return;
    }
    if (reorderMode){
      var lowParts = list.filter(isLow);
      $('ptList').innerHTML = '<div class="pt-mgroup">\uD83D\uDCCB Reorder list (' + lowParts.length + ')</div>' +
        (lowParts.length ? '<div class="pt-toolbar"><button type="button" class="inv-btn ghost" id="ptCopy">\u2398 Copy SKUs</button></div>' : '') +
        (lowParts.map(function(p){
          var sug = Math.max(1, (p.low * 2) - p.qty);
          return '<div class="card pt-card low"><div class="pt-model">' + esc(p.model) + ' <span class="pt-badge lowb">' + p.qty + ' left</span></div>' +
            '<div class="pt-type">' + esc(p.type) + ' \u2022 ' + esc(p.grade) + (p.color ? ' \u2022 ' + esc(p.color) : '') + '</div>' +
            '<div class="pt-meta">SKU: <b>' + esc(p.sku) + '</b> \u2022 suggest order: <b>' + sug + '</b> \u2022 ' + esc(p.sup) + (p.date ? ' \u2022 Added ' + ptFmtAdded(p.date) : '') + '</div>' +
            '<div class="pt-rowbtns" style="align-items:center;margin-top:0.4rem;">' +
            '<input type="number" min="1" data-ra="qty" data-sku="' + esc(p.sku) + '" value="' + sug + '" class="pt-qty-in" style="width:3.5rem;text-align:center;font:inherit;font-weight:800;border:1.5px solid var(--line);border-radius:8px;padding:0.2rem;" aria-label="Qty to order">' +
            '<button type="button" data-ra="add" data-sku="' + esc(p.sku) + '">\u2795 Add to order</button></div></div>';
        }).join('') || '<div class="pt-card"><div class="pt-type">Nothing to reorder. \uD83C\uDF89</div></div>');
      var cp = $('ptCopy');
      if (cp) cp.addEventListener('click', function(){
        var txt = [];
        Array.prototype.forEach.call($('ptList').querySelectorAll('[data-ra="qty"]'), function(inp){
          txt.push(inp.getAttribute('data-sku') + ' x' + Math.max(1, parseInt(inp.value, 10) || 1));
        });
        if (navigator.clipboard) navigator.clipboard.writeText(txt.join('\n'));
        cp.textContent = 'Copied!';
        setTimeout(function(){ cp.textContent = '\u2398 Copy SKUs'; }, 1500);
      });
      return;
    }
    var byModel = {};
    list.forEach(function(p){ (byModel[p.model] = byModel[p.model] || []).push(p); });
    $('ptList').innerHTML = Object.keys(byModel).sort().map(function(m){
      return '<div class="pt-mgroup">' + esc(m) + '</div>' + byModel[m].map(function(p){
        var badge = p.qty === 0 ? '<span class="pt-badge out">out of stock</span>' : (isLow(p) ? '<span class="pt-badge lowb">low stock</span>' : '<span class="pt-badge">in stock</span>');
        var used = usageCount(p.sku);
        return '<div class="pt-card' + (isLow(p) ? ' low' : '') + '">' +
          '<div class="pt-toprow"><div class="pt-titlemain">' +
          '<div class="pt-model">' + esc(p.model) + ' ' + badge + '</div>' +
          '<div class="pt-subtype">' + esc(p.type) + '</div>' +
          '<div class="pt-type">' + esc(p.grade) + (p.color ? ' \u2022 ' + esc(p.color) : '') + '</div>' +
          '</div><div class="pt-price">' + (PhoneFixAccess.can('costs_view')?fmt$(p.cost):'Hidden') + '<span> each</span></div></div>' +
          '<div class="pt-meta">SKU: <b>' + esc(p.sku) + '</b> \u2022 value ' + fmt$(p.qty * p.cost) + (p.sup ? ' \u2022 ' + esc(p.sup) : '') + (used ? ' \u2022 used ' + used + 'x' : '') + (p.date ? ' \u2022 Added ' + ptFmtAdded(p.date) : '') + (p.notes ? '<br>' + esc(p.notes) : '') + '</div>' +
          '<div class="pt-qtyrow"><button type="button" class="pt-step minus" data-a="dec" data-sku="' + esc(p.sku) + '">\u2212</button>' +
          '<div class="pt-qty">' + p.qty + '</div>' +
          '<button type="button" class="pt-step plus" data-a="inc" data-sku="' + esc(p.sku) + '">+</button></div>' +
          '<div class="pt-rowbtns"><button type="button" data-a="use" data-sku="' + esc(p.sku) + '">\uD83D\uDD27 Used on repair</button>' +
          '<button type="button" data-a="usage" data-sku="' + esc(p.sku) + '">\uD83D\uDCCB Usage</button>' +
          '<button type="button" data-a="edit" data-sku="' + esc(p.sku) + '">\u270F\uFE0F Edit</button>' +
          '<button type="button" data-a="del" data-sku="' + esc(p.sku) + '">' + (delArm === p.sku ? 'Tap again to confirm' : '\uD83D\uDDD1 Delete') + '</button></div></div>';
      }).join('');
    }).join('') || '<div class="pt-card"><div class="pt-type">No parts yet — tap <b>+ Add part</b>.</div></div>';
  }

  function find(sku){ for (var i = 0; i < parts.length; i++) if (parts[i].sku === sku) return parts[i]; return null; }
  function changed(p, deleted){ persist(); pushPart(p, !!deleted); render(); }

  /* ---------- modal form ---------- */
  function selectOptions(items, current, addVal, addLabel){
    var html = items.map(function(v){ return '<option' + (v === current ? ' selected' : '') + '>' + esc(v) + '</option>'; }).join('');
    if (current && items.indexOf(current) < 0) html = '<option selected>' + esc(current) + '</option>' + html;
    return html + '<option value="' + addVal + '">' + addLabel + '</option>';
  }
  function brandOptions(current){ return selectOptions(listBrands(), current, ADD_BRAND, '+ Add new brand&hellip;'); }
  function typeOptions(current){ return selectOptions(listTypes(), current, ADD_TYPE, '+ Add new part type&hellip;'); }
  function fillGrades(sel, val){
    var t = sel || listTypes()[0];
    var grades = listGrades(t);
    var opts = grades.map(function(g){
      return '<option value="' + esc(g) + '"' + (g === val ? ' selected' : '') + '>' + esc(g) + '</option>'; }).join('');
    if (val && grades.indexOf(val) < 0) opts = '<option value="' + esc(val) + '" selected>' + esc(val) + '</option>' + opts;
    $('pfGrade').innerHTML = opts + '<option value="' + ADD_GRADE + '">+ Add new grade&hellip;</option>';
  }
  /* "+ Add..." handlers: prompt, save to localStorage lists, rebuild the select, select the new entry.
     Cancel / blank / duplicate restores the value from before the change. */
  function onAddCustom(sel, kind){
    var ADD = kind === 'brand' ? ADD_BRAND : ADD_TYPE;
    if (sel.value !== ADD) return false;
    var prev = sel.dataset.prev || '';
    var label = kind === 'brand' ? 'brand name' : 'part type';
    var v = (prompt('New ' + label + ':') || '').trim();
    if (!v){ sel.value = prev; if (kind === 'type') fillGrades(prev, null); return true; }
    var existing = kind === 'brand' ? listBrands() : listTypes();
    if (existing.some(function(x){ return x.toLowerCase() === v.toLowerCase(); })){
      alert('That ' + label + ' already exists.');
      sel.value = prev; if (kind === 'type') fillGrades(prev, null); return true;
    }
    var lists = loadLists();
    if (kind === 'brand'){ lists.brands.push(v); saveLists(lists); sel.innerHTML = brandOptions(v); }
    else { lists.types.push(v); saveLists(lists); sel.innerHTML = typeOptions(v); fillGrades(v, null); }
    return true;
  }
  function onAddGrade(sel){
    if (sel.value !== ADD_GRADE) return;
    var t = $('pfType').value;
    var prev = sel.dataset.prev || '';
    var v = (prompt('New grade for ' + t + ':') || '').trim();
    if (!v){ fillGrades(t, prev || null); return; }
    if (listGrades(t).some(function(x){ return x.toLowerCase() === v.toLowerCase(); })){
      alert('That grade already exists for ' + t + '.');
      fillGrades(t, prev || null); return;
    }
    var lists = loadLists();
    if (!lists.grades[t]) lists.grades[t] = [];
    lists.grades[t].push(v);
    saveLists(lists);
    fillGrades(t, v);
  }
  /* Section picker: existing sections + "+ Add new section…". A brand-new section
     becomes a new sub-tab chip automatically (chips are data-driven). */
  function sectionOptions(current){
    var secs = listSections();
    var html = secs.map(function(s){ return '<option' + (s === current ? ' selected' : '') + '>' + esc(s) + '</option>'; }).join('');
    if (current && secs.indexOf(current) < 0) html = '<option selected>' + esc(current) + '</option>' + html;
    return html + '<option value="' + ADD_SECTION + '">+ Add new section&hellip;</option>';
  }
  function rebuildSection(sel, val){
    sel.innerHTML = sectionOptions(val);
    sel.dataset.touched = '1';
  }
  function onAddSection(sel){
    if (sel.value !== ADD_SECTION) return false;
    var prev = sel.dataset.prev || '';
    var v = (prompt('New section name (becomes a new sub-tab):') || '').trim();
    if (!v){ sel.value = prev; return true; }
    if (listSections().some(function(x){ return x.toLowerCase() === v.toLowerCase(); })){
      alert('That section already exists.');
      sel.value = prev; return true;
    }
    var a = loadSecLists(); a.push(v); saveSecLists(a);
    rebuildSection(sel, v);
    return true;
  }
  /* Suggest a section from the part type; only auto-updates while the user has
     not manually picked a section (tracked via dataset.touched). */
  function suggestSectionFor(type, sel){
    if (sel.dataset.touched === '1') return;
    var sug = screenType(type) ? 'LCD' : 'Other Parts';
    if (listSections().indexOf(sug) >= 0) sel.value = sug;
  }
  function openForm(sku){
    editSku = sku || null;
    var p = sku ? find(sku) : null;
    $('ptModalTitle').textContent = p ? 'Edit part' : 'Add part';
    var models = {}, colors = {};
    parts.forEach(function(x){ models[x.model] = 1; if (x.color) colors[x.color] = 1; });
    var initType = p ? p.type : listTypes()[0];
    var initSection = p ? partSection(p) : (sectionF || partSection({ type: initType }));
    $('ptModalBody').innerHTML =
      '<label>SKU (phonelcdparts) *<input id="pfSku" class="inv-in" placeholder="e.g. SA156O-WFBLK" value="' + esc(p ? p.sku : '') + '"' + (p ? ' disabled' : '') + '></label>' +
      '<div class="row2"><div><label>Brand<select id="pfBrand" class="inv-in">' + brandOptions(p ? p.brand : '') + '</select></label></div>' +
      '<div><label>Phone model *<input id="pfModel" class="inv-in" list="ptModels" placeholder="e.g. iPhone 14" value="' + esc(p ? p.model : '') + '"></label>' +
      '<datalist id="ptModels">' + Object.keys(models).sort().map(function(m){ return '<option value="' + esc(m) + '">'; }).join('') + '</datalist></div></div>' +
      '<div class="row2"><div><label>Part type<select id="pfType" class="inv-in">' + typeOptions(p ? p.type : '') + '</select></label></div>' +
      '<div><label>Grade<select id="pfGrade" class="inv-in"></select></label></div></div>' +
      '<label>Section (sub-tab)<select id="pfSection" class="inv-in">' + sectionOptions(initSection) + '</select></label>' +
      '<div class="row2"><div><label>Qty<input id="pfQty" class="inv-in" type="number" min="0" value="' + (p ? p.qty : 1) + '"></label></div>' +
      '<div><label>Unit cost $<input id="pfCost" class="inv-in" type="number" min="0" step="0.01" value="' + (p ? p.cost : '') + '"></label></div></div>' +
      '<div class="row2"><div><label>Low-stock at<input id="pfLow" class="inv-in" type="number" min="0" value="' + (p ? p.low : 2) + '"></label></div>' +
      '<div><label>Supplier<input id="pfSup" class="inv-in" value="' + esc(p ? p.sup : 'PhoneLCDParts') + '"></label></div></div>' +
      '<label>Notes<input id="pfNotes" class="inv-in" placeholder="optional" value="' + esc(p ? p.notes : '') + '"></label>' +
      '<label>Color<input id="pfColor" class="inv-in" list="ptColors" placeholder="e.g. Black" value="' + esc(p ? (p.color || '') : '') + '"></label>' +
      '<datalist id="ptColors">' + Object.keys(colors).sort().map(function(c){ return '<option value="' + esc(c) + '">'; }).join('') + '</datalist>' +
      '<div class="acts" style="display:flex;gap:0.5rem;margin-top:0.9rem;"><button type="button" class="inv-btn ghost" id="pfCancel" style="flex:1;">Cancel</button>' +
      '<button type="button" class="inv-btn primary" id="pfSave" style="flex:2;">Save part</button></div>';
    fillGrades($('pfType').value, p ? p.grade : null);
    // remember the pre-change value so cancelling an "+ Add..." prompt restores it
    ['pfBrand', 'pfType', 'pfGrade', 'pfSection'].forEach(function(id){
      $(id).addEventListener('focus', function(){ this.dataset.prev = this.value; });
    });
    $('pfBrand').addEventListener('change', function(){ onAddCustom(this, 'brand'); });
    $('pfType').addEventListener('change', function(){ if (!onAddCustom(this, 'type')) fillGrades(this.value, null); suggestSectionFor(this.value, $('pfSection')); });
    $('pfGrade').addEventListener('change', function(){ onAddGrade(this); });
    $('pfSection').addEventListener('change', function(){
      if (this.value !== ADD_SECTION) this.dataset.touched = '1';
      onAddSection(this);
    });
    $('ptOverlay').hidden = false;
    $('pfCancel').addEventListener('click', function(){ $('ptOverlay').hidden = true; });
    $('pfSave').addEventListener('click', saveForm);
  }
  function saveForm(){
    var sku = $('pfSku').value.trim().toUpperCase();
    var model = $('pfModel').value.trim();
    if (!sku){ alert('SKU is required'); return; }
    if (!model){ alert('Phone model is required'); return; }
    if (!editSku && find(sku)){ alert('This SKU is already in your parts. Use Edit instead.'); return; }
    var p = editSku ? find(editSku) : { sku: sku, date: todayISO() };
    if (!p) return;
    p.brand = $('pfBrand').value; p.model = model; p.type = $('pfType').value; p.grade = $('pfGrade').value;
    var secVal = $('pfSection').value;
    p.section = (secVal && secVal !== ADD_SECTION) ? secVal : partSection({ type: p.type });
    p.qty = Math.max(0, parseInt($('pfQty').value, 10) || 0);
    var c = numOrBlank($('pfCost').value); p.cost = c === '' ? 0 : Number(c);
    p.sup = $('pfSup').value.trim() || 'PhoneLCDParts';
    p.low = Math.max(0, parseInt($('pfLow').value, 10) || 0);
    p.notes = $('pfNotes').value.trim();
    p.color = $('pfColor').value.trim();
    if (!editSku) parts.unshift(p);
    editSku = null;
    $('ptOverlay').hidden = true;
    changed(p, false);
  }

  /* ---------- Used on repair: ticket picker, To Order queue, usage log ---------- */
  function openTickets(){
    var recs = readJSON(REPAIRS_KEY, []);
    return recs.filter(function(r){ return r && r.id && !r.isDelivered; })
      .sort(function(a, b){ return (b.createdAt || 0) - (a.createdAt || 0); }).slice(0, 200);
  }
  function closeUse(){ $('ptUseOverlay').hidden = true; }
  function confirmUse(sku, ticketId){
    usePart(sku, ticketId, useQty);
    useQty = 1;
    quickSel = '';
    var qs = $('ptQuickSearch'); if (qs) qs.value = '';
    hideQuickResults();
    closeUse();
  }
  var useQty = 1; // qty for the open ticket picker (per-card use = 1, Quick use passes its qty)
  function renderUsePicker(sku, qty){
    useQty = Math.max(1, parseInt(qty, 10) || 1);
    var p = find(sku); if (!p) return;
    $('ptUseTitle').textContent = 'Use on repair — ' + p.sku + (useQty > 1 ? ' ×' + useQty : '');
    var list = openTickets();
    $('ptUseBody').innerHTML =
      '<div style="font-size:0.8rem;margin-bottom:0.5rem;">' + esc(p.model) + ' — ' + esc(p.type) + (p.color ? ' • ' + esc(p.color) : '') + ' · <b>' + p.qty + ' in stock</b>' + (useQty > 1 ? ' · using <b>' + useQty + '</b>' : '') + '</div>' +
      '<input id="ptUseSearch" class="inv-in" placeholder="Search ticket, customer, phone, device…" autocomplete="off">' +
      '<div style="max-height:240px;overflow-y:auto;margin:0.5rem 0;">' + (list.map(function(r){
        var hay = [r.id, r.name, r.phone, r.device].join(' ');
        return '<button type="button" class="inv-btn ghost" data-ticket="' + esc(r.id) + '" data-hay="' + esc(hay) + '" style="display:flex;justify-content:space-between;width:100%;margin-bottom:0.3rem;text-align:left;"><span><b>' + esc(r.id) + '</b> — ' + esc(r.name || '') + ' · ' + esc(r.device || '') + '</span><span>' + esc(r.phone || '') + '</span></button>';
      }).join('') || '<div style="font-size:0.8rem;color:#777;">No open tickets found.</div>') + '</div>' +
      '<div style="display:flex;gap:0.5rem;"><button type="button" class="inv-btn ghost" id="ptUseCancel" style="flex:1;">Cancel</button>' +
      '<button type="button" class="inv-btn primary" id="ptUseNoTicket" style="flex:1;">No ticket / walk-in</button></div>';
    $('ptUseOverlay').hidden = false;
    var s = $('ptUseSearch');
    if (s){
      s.addEventListener('input', function(){
        var q = s.value.toLowerCase();
        Array.prototype.forEach.call($('ptUseBody').querySelectorAll('[data-ticket]'), function(b){
          var hay = (b.getAttribute('data-hay') || '').toLowerCase();
          b.style.display = hay.indexOf(q) >= 0 ? '' : 'none';
        });
      });
      setTimeout(function(){ s.focus(); }, 50);
    }
    $('ptUseCancel').addEventListener('click', closeUse);
    $('ptUseNoTicket').addEventListener('click', function(){ confirmUse(sku, ''); });
    Array.prototype.forEach.call($('ptUseBody').querySelectorAll('[data-ticket]'), function(b){
      b.addEventListener('click', function(){ confirmUse(sku, b.getAttribute('data-ticket')); });
    });
  }
  function openUsageHistory(sku){
    var p = find(sku);
    var list = partUsage.filter(function(u){ return u.sku === sku; }).slice().reverse();
    var totalQty = 0, totalCost = 0;
    list.forEach(function(u){ totalQty += Number(u.qty) || 0; totalCost += (Number(u.qty) || 0) * (Number(u.cost) || 0); });
    $('ptUseTitle').textContent = 'Usage history — ' + sku;
    $('ptUseBody').innerHTML =
      '<div style="font-size:0.8rem;margin-bottom:0.5rem;">' + esc(p ? (p.model + ' — ' + p.type + (p.color ? ' • ' + p.color : '')) : sku) +
      ' · used <b>' + totalQty + '×</b> · parts cost <b>' + (PhoneFixAccess.can('costs_view')?fmt$(totalCost):'Hidden') + '</b></div>' +
      '<div style="max-height:260px;overflow-y:auto;">' + (list.map(function(u){
        return '<div style="display:flex;justify-content:space-between;gap:0.5rem;padding:0.3rem 0;border-bottom:1px solid #eee;font-size:0.8rem;"><span>' +
          (u.ticketId ? '<b>' + esc(u.ticketId) + '</b>' : '<i>walk-in / no ticket</i>') + ' · ' + esc(u.date || '') + '</span><span>×' + (Number(u.qty) || 0) + ' · ' + (PhoneFixAccess.can('costs_view')?fmt$(u.cost):'Hidden') + '</span></div>';
      }).join('') || '<div style="font-size:0.8rem;color:#777;">No usage logged yet.</div>') + '</div>' +
      '<div style="display:flex;gap:0.5rem;margin-top:0.7rem;"><button type="button" class="inv-btn ghost" id="ptUseClose2" style="flex:1;">Close</button></div>';
    $('ptUseOverlay').hidden = false;
    $('ptUseClose2').addEventListener('click', closeUse);
  }
  function fmtOrderTs(o){
    var d = new Date(o.ts); if (!o.ts || isNaN(d)) return '';
    var s = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + (d.getFullYear() !== new Date().getFullYear() ? ', ' + d.getFullYear() : '');
    return o.tsDateOnly ? s : s + ' · ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }
  /* Entries that predate the stamp: recover the arrival date from the usage log (the day the part was used is the day it landed on this list). */
  function ensureOrderTs(){
    refreshUsage();
    var changed = false;
    toOrder.forEach(function(o){
      if (o.ts) return;
      var best = '';
      partUsage.forEach(function(u){ if (u.sku === o.sku && u.date && u.date > best) best = u.date; });
      if (best){ var p = best.split('-').map(Number); o.ts = new Date(p[0], (p[1] || 1) - 1, p[2] || 1, 12).getTime(); o.tsDateOnly = true; changed = true; }
    });
    if (changed) saveOrder();
  }
  function renderToOrder(){
    ensureOrderTs();
    var rows = toOrder.map(function(o){
      var p = find(o.sku);
      return { o: o, p: p, name: p ? (p.model + ' — ' + p.type + (p.color ? ' • ' + p.color : '')) : o.sku, cost: p ? p.cost : 0, line: (Number(o.qty) || 0) * (p ? p.cost : 0) };
    });
    // unchecked (still to add) float to the top; ✓ Added sink to the bottom
    rows.sort(function(a, b){ return (a.o.added ? 1 : 0) - (b.o.added ? 1 : 0); });
    var grand = 0; rows.forEach(function(r){ grand += r.line; });
    var addedRows = rows.filter(function(r){ return r.o.added; });
    var leftTotal = 0; rows.forEach(function(r){ if (!r.o.added) leftTotal += r.line; });
    var progress = rows.length ? '<div class="pt-progress">✓ ' + addedRows.length + ' of ' + rows.length + ' added · <b>' + fmt$(leftTotal) + '</b> still to add</div>' : '';
    $('ptList').innerHTML = '<div class="pt-mgroup">📦 To Order (' + orderCount() + ' units left)</div>' + progress +
      (rows.length ? '<div class="pt-toolbar"><button type="button" class="inv-btn ghost" id="ptOrderCopy">⎘ Copy for PhoneLCDParts</button>' + (addedRows.length ? '<button type="button" class="inv-btn ghost" id="ptOrderClear">🧹 Clear added (' + addedRows.length + ')</button>' : '') + '</div>' : '') +
      (rows.map(function(r){
        var added = !!r.o.added;
        return '<div class="pt-card' + (added ? ' pt-added' : '') + '"><div class="pt-model">' + esc(r.name) + (added ? ' <span style="color:#14663F;">✓ ADDED</span>' : '') + '</div>' +
          '<div class="pt-type">SKU: <b>' + esc(r.o.sku) + '</b></div>' +
          '<div class="pt-meta">' + fmt$(r.cost) + ' each • line ' + fmt$(r.line) + '</div>' +
          (r.o.ts ? '<div class="pt-meta">🕒 Added ' + fmtOrderTs(r.o) + '</div>' : '') +
          '<div class="pt-qtyrow"><button type="button" class="pt-step minus" data-oa="dec" data-sku="' + esc(r.o.sku) + '">−</button>' +
          '<input type="number" min="0" class="pt-qty-in" data-oa="set" data-sku="' + esc(r.o.sku) + '" value="' + r.o.qty + '" style="width:3.2rem;text-align:center;font:inherit;font-weight:800;border:1.5px solid var(--line);border-radius:8px;padding:0.15rem;">' +
          '<button type="button" class="pt-step plus" data-oa="inc" data-sku="' + esc(r.o.sku) + '">+</button></div>' +
          '<div class="pt-rowbtns"><button type="button" data-oa="added" data-sku="' + esc(r.o.sku) + '">' + (added ? '✓ Added — tap to undo' : '☐ Already added') + '</button>' +
          '<button type="button" data-oa="del" data-sku="' + esc(r.o.sku) + '">🗑 Remove</button></div></div>';
      }).join('') || '<div class="pt-card"><div class="pt-type">Nothing to order yet — tap 🔧 Used on repair on any part and it lands here.</div></div>') +
      (rows.length ? '<div class="pt-card"><div class="pt-meta">Grand total: <b>' + fmt$(grand) + '</b></div></div>' : '');
    var cp = $('ptOrderCopy');
    if (cp) cp.addEventListener('click', function(){
      var txt = toOrder.filter(function(o){ return !o.added; }).map(function(o){ return o.sku + ' x' + o.qty; }).join('\n');
      if (!txt){ cp.textContent = 'All added ✓'; setTimeout(function(){ cp.textContent = '⎘ Copy for PhoneLCDParts'; }, 1500); return; }
      if (navigator.clipboard) navigator.clipboard.writeText(txt);
      cp.textContent = 'Copied!'; setTimeout(function(){ cp.textContent = '⎘ Copy for PhoneLCDParts'; }, 1500);
    });
    var cl = $('ptOrderClear');
    if (cl) cl.addEventListener('click', function(){
      if (!clearArm){
        clearArm = true;
        cl.textContent = 'Tap again to clear ' + addedRows.length + ' ✓';
        setTimeout(function(){ clearArm = false; if (toOrderMode) render(); }, 3000);
        return;
      }
      clearArm = false;
      var skus = addedEntries().map(function(o){ return o.sku; });
      toOrder = toOrder.filter(function(o){ return !o.added; });
      saveOrder(); updateOrderBadge();
      skus.forEach(function(s){ pushOrder(s, 0, true); });
      render();
    });
  }

  /* ---------- Quick use (search box on top of Parts; same engine as intake) ---------- */
  var quickSel = '', quickHi = -1;
  function quickWordMatch(hay, word){
    if (hay.indexOf(word) >= 0) return true;
    if (word.length < 3) return false;
    var j = 0;
    for (var i = 0; i < hay.length && j < word.length; i++) if (hay[i] === word[j]) j++;
    return j === word.length;
  }
  function quickMatches(p, q){
    if (!q) return true;
    var hay = ((p.model || '') + ' ' + (p.type || '') + ' ' + (p.color || '') + ' ' + (p.sku || '') + ' ' + (p.brand || '')).toLowerCase();
    return q.toLowerCase().split(/\s+/).filter(Boolean).every(function(t){ return quickWordMatch(hay, t); });
  }
  function quickLabel(p){
    return p.model + ' — ' + p.type + (p.color ? ' • ' + p.color : '') + ' (' + p.qty + ' in stock) — ' + (PhoneFixAccess.can('costs_view')?fmt$(p.cost):'Hidden');
  }
  function quickHiHtml(text, q){
    var needle = (q || '').trim();
    if (!needle || /\s/.test(needle) || needle.length < 2) return esc(text);
    var idx = text.toLowerCase().indexOf(needle.toLowerCase());
    if (idx < 0) return esc(text);
    return esc(text.slice(0, idx)) + '<mark>' + esc(text.slice(idx, idx + needle.length)) + '</mark>' + esc(text.slice(idx + needle.length));
  }
  function renderQuickResults(){
    var box = $('ptQuickResults'); if (!box) return;
    var q = $('ptQuickSearch').value;
    var matches = parts.filter(function(p){ return quickMatches(p, q); }).sort(function(a, b){ return (a.model || '').localeCompare(b.model || '') || (a.type || '').localeCompare(b.type || ''); });
    quickHi = -1;
    if (!matches.length){
      box.innerHTML = '<div style="padding:0.6rem 0.8rem;font-size:0.8rem;color:#777;">No parts match. Try fewer words.</div>';
    } else {
      var shown = matches.slice(0, 150);
      box.innerHTML = shown.map(function(p, i){
        return '<div class="pq-result" data-sku="' + esc(p.sku) + '" data-i="' + i + '" style="padding:0.5rem 0.8rem;font-size:0.8rem;cursor:pointer;border-bottom:1px solid #f0ece3;">' + quickHiHtml(quickLabel(p), q) + '</div>';
      }).join('') + (matches.length > 150 ? '<div style="padding:0.4rem 0.8rem;font-size:0.72rem;color:#777;">+' + (matches.length - 150) + ' more — keep typing to narrow.</div>' : '');
    }
    box.hidden = false;
  }
  function hideQuickResults(){ var box = $('ptQuickResults'); if (box) box.hidden = true; }
  function pickQuick(sku){
    var p = find(sku); if (!p) return;
    quickSel = sku;
    $('ptQuickSearch').value = quickLabel(p);
    hideQuickResults();
    $('ptQuickQty').focus();
  }
  function markQuickRow(i){
    var box = $('ptQuickResults'); if (!box) return;
    var rows = box.querySelectorAll('.pq-result');
    quickHi = i;
    rows.forEach(function(r, j){ r.style.background = (j === i) ? '#FFE3C2' : ''; });
  }
  $('ptQuickSearch').addEventListener('input', function(){ quickSel = ''; renderQuickResults(); });
  $('ptQuickSearch').addEventListener('focus', function(){ renderQuickResults(); });
  $('ptQuickSearch').addEventListener('blur', function(){ setTimeout(hideQuickResults, 150); });
  $('ptQuickSearch').addEventListener('keydown', function(e){
    var box = $('ptQuickResults');
    var rows = box ? box.querySelectorAll('.pq-result') : [];
    if (e.key === 'ArrowDown'){ e.preventDefault(); if (box) box.hidden = false; markQuickRow(Math.min(quickHi + 1, rows.length - 1)); }
    else if (e.key === 'ArrowUp'){ e.preventDefault(); markQuickRow(Math.max(quickHi - 1, 0)); }
    else if (e.key === 'Enter'){
      e.preventDefault();
      var row = rows[quickHi >= 0 ? quickHi : 0];
      if (row) pickQuick(row.getAttribute('data-sku'));
    }
    else if (e.key === 'Escape'){ hideQuickResults(); }
  });
  $('ptQuickResults').addEventListener('mousedown', function(e){
    var row = e.target.closest('.pq-result'); if (!row) return;
    e.preventDefault();
    pickQuick(row.getAttribute('data-sku'));
  });
  $('ptQuickAdd').addEventListener('click', function(){
    if (!quickSel){ $('ptQuickSearch').focus(); renderQuickResults(); return; }
    var q = Math.max(1, parseInt($('ptQuickQty').value, 10) || 1);
    renderUsePicker(quickSel, q);
  });

  /* ---------- events ---------- */
  $('ptBrands').addEventListener('click', function(e){
    var c = e.target.closest('.pt-bchip'); if (!c) return;
    brandF = c.getAttribute('data-b'); render();
  });
  $('ptSections').addEventListener('click', function(e){
    var c = e.target.closest('.pt-bchip'); if (!c) return;
    sectionF = c.getAttribute('data-s'); render();
  });
  $('ptSearch').addEventListener('input', render);
  $('ptModelF').addEventListener('change', render);
  $('ptAdd').addEventListener('click', function(){ openForm(null); });
  $('ptModalClose').addEventListener('click', function(){ $('ptOverlay').hidden = true; editSku = null; });
  $('ptOverlay').addEventListener('click', function(e){ if (e.target === $('ptOverlay')){ $('ptOverlay').hidden = true; editSku = null; } });
  $('ptReorder').addEventListener('click', function(){
    reorderMode = !reorderMode;
    if (reorderMode) toOrderMode = false;
    $('ptReorder').innerHTML = reorderMode ? '\uD83D\uDD19 Back to parts' : '\uD83D\uDCCB Reorder list';
    render();
  });
  $('ptToOrder').addEventListener('click', function(){
    toOrderMode = !toOrderMode;
    if (toOrderMode) reorderMode = false;
    $('ptReorder').innerHTML = '\uD83D\uDCCB Reorder list';
    render();
  });
  $('ptUseClose').addEventListener('click', closeUse);
  $('ptUseOverlay').addEventListener('click', function(e){ if (e.target === $('ptUseOverlay')) closeUse(); });
  $('ptList').addEventListener('click', function(e){
    var b = e.target.closest('button'); if (!b) return;
    var oa = b.getAttribute('data-oa');
    if (oa){
      var osku = b.getAttribute('data-sku');
      var entry = null; toOrder.forEach(function(o){ if (o.sku === osku) entry = o; });
      if (oa === 'inc' && entry){ entry.qty = (Number(entry.qty) || 0) + 1; delete entry.added; }
      else if (oa === 'dec' && entry){ entry.qty = Math.max(0, (Number(entry.qty) || 0) - 1); if (!entry.qty) toOrder = toOrder.filter(function(o){ return o !== entry; }); else delete entry.added; }
      else if (oa === 'del'){ toOrder = toOrder.filter(function(o){ return o.sku !== osku; }); }
      else if (oa === 'added' && entry){ entry.added = !entry.added; saveOrder(); updateOrderBadge(); render(); return; }
      orderChanged(osku); render();
      return;
    }
    /* Reorder list: manual qty + "Add to order" (adds to the To Order queue, which syncs). */
    var ra = b.getAttribute('data-ra');
    if (ra === 'add'){
      var rsku = b.getAttribute('data-sku');
      var rcard = b.closest('.pt-card');
      var qinp = rcard ? rcard.querySelector('[data-ra="qty"]') : null;
      var rq = Math.max(1, parseInt(qinp && qinp.value, 10) || 1);
      adjustOrder(rsku, rq);
      var oldT = b.textContent; b.textContent = 'Added \u2713';
      setTimeout(function(){ b.textContent = oldT; }, 1200);
      return;
    }
    var sku = b.getAttribute('data-sku'), a = b.getAttribute('data-a');
    var p = find(sku); if (!p) return;
    if (a === 'inc'){ p.qty++; changed(p, false); }
    else if (a === 'dec'){ p.qty = Math.max(0, p.qty - 1); changed(p, false); }
    else if (a === 'use'){ renderUsePicker(sku); }
    else if (a === 'usage'){ openUsageHistory(sku); }
    else if (a === 'edit'){ openForm(sku); }
    else if (a === 'del'){
      if (delArm === sku){
        parts = parts.filter(function(x){ return x.sku !== sku; });
        delArm = null; persist(); pushPart({ sku: sku }, true); render();
      } else { delArm = sku; setTimeout(function(){ delArm = null; render(); }, 3000); render(); }
    }
  });
  /* To Order: type a qty directly (change event on the qty input). */
  $('ptList').addEventListener('change', function(e){
    var t = e.target; if (!t || t.getAttribute('data-oa') !== 'set') return;
    var sku = t.getAttribute('data-sku');
    var q = Math.max(0, parseInt(t.value, 10) || 0);
    var entry = null; toOrder.forEach(function(o){ if (o.sku === sku) entry = o; });
    if (entry){ if (q === 0) toOrder = toOrder.filter(function(o){ return o !== entry; }); else { entry.qty = q; delete entry.added; } }
    orderChanged(sku); render();
  });

  /* ---------- sub-tab switching (Phones / Parts / Accessories) ---------- */
  function showInvTab(which){
    var isPhones = which === 'phones', isParts = which === 'parts', isAcc = which === 'acc';
    $('invSubPhones').classList.toggle('active', isPhones);
    $('invSubParts').classList.toggle('active', isParts);
    var accBtn = $('invSubAcc'); if (accBtn) accBtn.classList.toggle('active', isAcc);
    $('invPhonesView').hidden = !isPhones;
    $('invPartsView').hidden = !isParts;
    var accView = $('invAccView'); if (accView) accView.hidden = !isAcc;
    ['invAdd','invExport','invLayaway'].forEach(function(id){ var b = $(id); if (b) b.style.display = isPhones ? '' : 'none'; });
    if (isParts){ render(); pullParts(); pullUsage(); pullOrder(); flushUsageOutbox(); }
    if (isAcc && typeof window.__accShow === 'function') window.__accShow();
  }
  window.__invShowTab = showInvTab; // shared with the Accessories module + master search
  function showParts(on){ showInvTab(on ? 'parts' : 'phones'); }
  $('invSubPhones').addEventListener('click', function(){ showInvTab('phones'); });
  $('invSubParts').addEventListener('click', function(){ showInvTab('parts'); });
  var accTabBtn = $('invSubAcc');
  if (accTabBtn) accTabBtn.addEventListener('click', function(){ showInvTab('acc'); });

  /* Exposed for the inventory master search (separate IIFE): parts data + jump-to-part. */
  window.__invPartsList = function(){ return parts.map(function(p){ return Object.assign({}, p); }); };
  window.__invJumpToPart = function(sku){
    showParts(true);
    brandF = '';
    var mf = $('ptModelF'); if (mf) mf.value = '';
    var s = $('ptSearch'); if (s) s.value = sku || '';
    render();
    setTimeout(function(){
      var btn = document.querySelector('#ptList [data-sku="' + cssEscPart(sku) + '"]');
      var card = btn ? btn.closest('.pt-card') : null;
      if (card){ card.scrollIntoView({ behavior: 'smooth', block: 'center' }); flashPartCard(card); }
    }, 100);
  };
  function cssEscPart(s){ return (window.CSS && CSS.escape) ? CSS.escape(String(s)) : String(s); }
  function flashPartCard(el){
    if (!el) return;
    el.classList.remove('flash-link'); void el.offsetWidth; el.classList.add('flash-link');
    setTimeout(function(){ el.classList.remove('flash-link'); }, 1800);
  }

  /* ---------- init ---------- */
  load(); loadOrderUsage(); render(); setSync('local'); pullParts(); pullUsage(); pullOrder(); backfillUsage(); flushUsageOutbox();

window.PhoneFixManager.register('parts',function(id,value,remove){const old=parts.find(r=>r.sku===id);if(!old)throw new Error('Record no longer exists');parts=remove?parts.filter(r=>r.sku!==id):parts.map(r=>r.sku===id?normPart(value):r);persist();pushPart(remove?old:parts.find(r=>r.sku===id),remove);render();});
window.PhoneFixManager.register('usage',function(id,value,remove){const old=partUsage.find(r=>r.id===id);if(!old)throw new Error('Record no longer exists');if(!remove&&value.sku!==old.sku)throw new Error('Keep the original part SKU; create a separate usage to change parts');adjustStock(old.sku,Number(old.qty)-(remove?0:Number(value.qty)));adjustOrder(old.sku,(remove?0:Number(value.qty))-Number(old.qty));partUsage=remove?partUsage.filter(r=>r.id!==id):partUsage.map(r=>r.id===id?value:r);saveUsage();window.__invPushUsage(remove?{...old,deleted:true}:value);render();});
window.PhoneFixManager.register('reorder',function(id,value,remove){toOrder=remove?toOrder.filter(r=>r.sku!==id):toOrder.map(r=>r.sku===id?value:r);orderChanged(id);render();});
})();
