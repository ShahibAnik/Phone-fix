
(function(){
  'use strict';
  /* ============ STORE CREDIT / ORDER : special orders + store credit ============ */
  var $ = function(id){ return document.getElementById(id); };
  var ENDPOINT = 'https://script.google.com/macros/s/AKfycbxI_O5ZtLFcln6GYPgjphmzkji4-VZfeedhd--4Z26u01iNeRZPgpIg16iY5tQ5HHvSJg/exec';
  var SO_KEY = 'phoneRepairSpecialOrders', CRED_KEY = 'phoneRepairStoreCredit';
  var SO_CNT = 'phoneRepairSOCounter', CRED_CNT = 'phoneRepairCredCounter', RCPT_CNT = 'phoneRepairSORcptCounter';
  var VIEW_KEY = 'scViewOpen';
  var STORE = { name:'Phone Fix Accessories', addr:'2900 Island Ave #2920, Philadelphia, PA 19153', phone:'(267) 344-9102' };
  var SO_STATUSES = ['Ordered','Arrived','Paid in full','Picked up','Cancelled'];

  function esc(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
  function money(n){ n = Number(n) || 0; return (n < 0 ? '\u2212' : '') + '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function isoOf(d){ var p = function(n){ return String(n).padStart(2,'0'); }; return d.getFullYear() + '-' + p(d.getMonth()+1) + '-' + p(d.getDate()); }
  function todayISO(){ return isoOf(new Date()); }
  function isoDate(v){ if(!v) return ''; var m = String(v).match(/(\d{4})-(\d{2})-(\d{2})/); return m ? m[0] : ''; }
  function numOrBlank(v){ if (v === '' || v == null) return ''; var n = parseFloat(String(v).replace(/[^0-9.\-]/g, '')); return isFinite(n) ? n : ''; }
  function fmtPhone(v){ var d = String(v||'').replace(/\D/g,'').slice(0,10); if(d.length<4) return d; if(d.length<7) return '('+d.slice(0,3)+') '+d.slice(3); return '('+d.slice(0,3)+') '+d.slice(3,6)+'-'+d.slice(6); }
  function readJSON(k, dflt){ try { var v = JSON.parse(localStorage.getItem(k)); return v == null ? dflt : v; } catch(e){ return dflt; } }
  function writeJSON(k, v){ try { localStorage.setItem(k, JSON.stringify(v)); } catch(e){} }
  function paidSum(pays){ return (pays||[]).reduce(function(s,p){ return s + (Number(p.a)||0); }, 0); }

  var sos = [], creds = [];
  function persistSO(){ writeJSON(SO_KEY, sos); }
  function persistCred(){ writeJSON(CRED_KEY, creds); }
  function normPay(p){ return { d: isoDate(p.d) || todayISO(), a: Number(p.a) || 0, note: p.note ? String(p.note) : '' }; }
  function normSO(o){
    o = o || {};
    var pays = o.payments; if (typeof pays === 'string' && pays){ try{ pays = JSON.parse(pays); }catch(e){ pays = []; } }
    return { id: String(o.id||''), customer: String(o.customer||''), phone: String(o.phone||''),
      item: String(o.item||''), specs: String(o.specs||''), total: numOrBlank(o.total),
      deposit: numOrBlank(o.deposit), depDate: isoDate(o.depDate), expected: isoDate(o.expected),
      status: SO_STATUSES.indexOf(o.status) !== -1 ? o.status : 'Ordered',
      notes: String(o.notes||''), payments: Array.isArray(pays) ? pays.map(normPay) : [],
      createdAt: Number(o.createdAt) || Date.now() };
  }
  function normCred(o){
    o = o || {};
    var uses = o.uses; if (typeof uses === 'string' && uses){ try{ uses = JSON.parse(uses); }catch(e){ uses = []; } }
    return { id: String(o.id||''), customer: String(o.customer||''), phone: String(o.phone||''),
      amount: numOrBlank(o.amount), issued: isoDate(o.issued) || todayISO(), desc: String(o.desc||''),
      uses: Array.isArray(uses) ? uses.map(normPay) : [], createdAt: Number(o.createdAt) || Date.now() };
  }
  function loadLocal(){
    try { var a = JSON.parse(localStorage.getItem(SO_KEY) || '[]'); sos = Array.isArray(a) ? a.map(normSO).filter(function(x){ return x.id; }) : []; } catch(e){ sos = []; }
    try { var b = JSON.parse(localStorage.getItem(CRED_KEY) || '[]'); creds = Array.isArray(b) ? b.map(normCred).filter(function(x){ return x.id; }) : []; } catch(e){ creds = []; }
  }
  function nextId(prefix, cntKey){
    var day = todayISO().replace(/-/g,''), m = readJSON(cntKey, {}), n = (Number(m[day])||0)+1;
    m[day]=n; writeJSON(cntKey,m); return prefix + '-' + day + '-' + String(n).padStart(3,'0');
  }
  function rcptNo(prefix){
    var day = todayISO().replace(/-/g,''), m = readJSON(RCPT_CNT, {}), n = (Number(m[day])||0)+1;
    m[day]=n; writeJSON(RCPT_CNT,m); return prefix + '-' + day + '-' + String(n).padStart(3,'0');
  }

  function setSync(state){
    var el = $('scSync'); if(!el) return;
    var label = { local:'\u25cf local', syncing:'\u25cc syncing\u2026', synced:'\u25cf synced', offline:'\u25cb offline' }[state] || state;
    el.className = 'inv-sync ' + state; el.textContent = label;
  }
  function dirtyKeyFor(type){ return type === 'specialOrder' ? 'phoneRepairSODirty' : 'phoneRepairCredDirty'; }
  function pushRec(type, obj, deleted){
    var body = { recordType: type };
    Object.keys(obj).forEach(function(k){ var v = obj[k]; body[k] = (v && typeof v === 'object') ? JSON.stringify(v) : v; });
    if (deleted) body.deleted = true;
    var dkey = dirtyKeyFor(type), oid = obj.id;
    if (oid) { var dm = readJSON(dkey, {}); dm[oid] = { t: Date.now(), del: !!deleted }; writeJSON(dkey, dm); }
    var t0 = Date.now();
    if (!navigator.onLine){ setSync('offline'); return; }
    setSync('syncing');
    fetch(ENDPOINT, { method:'POST', mode:'no-cors', headers:{'Content-Type':'text/plain;charset=utf-8'}, body: JSON.stringify(body) })
      .then(function(){ if (oid) { var m2 = readJSON(dkey, {}); if (m2[oid] && m2[oid].t <= t0) { delete m2[oid]; writeJSON(dkey, m2); } } setSync('synced'); }).catch(function(){ setSync('offline'); });
  }
  function pullType(action, key, norm, assign, type){
    if (!navigator.onLine) return;
    var dkey = dirtyKeyFor(type);
    fetch(ENDPOINT + '?action=' + action).then(function(r){ if(!r.ok) throw 0; return r.json(); })
      .then(function(data){
        var arr = Array.isArray(data) ? data : (data && (data.data || data.items || data.rows));
        if (!Array.isArray(arr)) return;
        var list = arr.filter(function(o){ return o && String(o.deleted).toLowerCase() !== 'true' && o.id; }).map(norm);
        var local = readJSON(key, []);
        if (!list.length && local.length) return;
        // merge: unsynced local (dirty) records win over the pull
        var dirty = readJSON(dkey, {}), byId = {}, rePush = [];
        local.forEach(function(o){ if(o && o.id) byId[o.id] = o; });
        Object.keys(dirty).forEach(function(id){
          var d = dirty[id], li = byId[id];
          if (d.del) { list = list.filter(function(o){ return o.id !== id; }); }
          else if (li) {
            var idx = -1;
            for (var i = 0; i < list.length; i++) if (list[i].id === id) { idx = i; break; }
            if (idx >= 0) list[idx] = li; else list.push(li);
            rePush.push(li);
          }
        });
        assign(list); setSync('synced');
        rePush.forEach(function(o){ pushRec(type, o, false); });
      }).catch(function(){});
  }

  var tab = $('tabStoreCredit'), view = $('scView');
  function openSC(){
    var m = document.querySelector('main'); if (m) m.style.display = 'none';
    var q = $('queueView'); if (q) q.hidden = true;
    var iv = $('invView'); if (iv) iv.hidden = true;
    ['tabIntake','tabQueue','tabInventory'].forEach(function(id){ var b = $(id); if (b) b.classList.remove('active'); });
    tab.classList.add('active'); view.hidden = false;
    try { sessionStorage.setItem(VIEW_KEY, '1'); } catch(e){}
    window.scrollTo(0,0); render();
  }
  function closeSC(){
    view.hidden = true; tab.classList.remove('active');
    try { sessionStorage.setItem(VIEW_KEY, '0'); } catch(e){}
  }
  tab.addEventListener('click', openSC);
  ['tabIntake','tabQueue','tabInventory'].forEach(function(id){ var b = $(id); if (b) b.addEventListener('click', closeSC); });

  function openScModal(title, html, mount){if(!PhoneFixAccess.can('inventory_manage')&&!PhoneFixAccess.can('ticket_pay')){alert("You don't have permission for this.");return;}
    $('scModalTitle').textContent = title; $('scModalBody').innerHTML = html;
    $('scOverlay').hidden = false;
    if (mount) mount($('scModalBody'));
  }
  function closeScModal(){ $('scOverlay').hidden = true; $('scModalBody').innerHTML = ''; }
  $('scModalClose').addEventListener('click', closeScModal);
  $('scOverlay').addEventListener('mousedown', function(e){ if(e.target === $('scOverlay')) closeScModal(); });
  document.addEventListener('keydown', function(e){ if(e.key === 'Escape' && !$('scOverlay').hidden) closeScModal(); });

  var soQ = '', credQ = '';
  function payHistHtml(pays){
    if(!pays.length) return '';
    return '<div class="sc-payhist">' + pays.map(function(p){
      return '<div><span>\ud83d\udcc5 ' + esc(p.d) + (p.note ? ' \u00b7 ' + esc(p.note) : '') + '</span><b>' + money(p.a) + '</b></div>';
    }).join('') + '</div>';
  }
  function renderSO(){
    var list = sos.filter(function(o){
      return !soQ || (o.customer||'').toLowerCase().indexOf(soQ) !== -1 || (o.item||'').toLowerCase().indexOf(soQ) !== -1 || (o.id||'').toLowerCase().indexOf(soQ) !== -1;
    }).sort(function(a,b){ return b.createdAt - a.createdAt; });
    $('scSOList').innerHTML = list.length ? list.map(function(o){
      var pd = paidSum(o.payments), bal = (o.total === '' ? '' : o.total - pd);
      return '<div class="sc-card" data-id="' + esc(o.id) + '">'
        + '<span class="sc-chip so">' + esc(o.status) + '</span>'
        + '<h3>' + esc(o.item) + '</h3>'
        + '<div class="sub">' + esc(o.id) + ' \u00b7 ' + esc(o.customer) + ' \u00b7 ' + esc(o.phone) + '</div>'
        + (o.specs ? '<div class="sc-row"><span>Specs</span><b>' + esc(o.specs) + '</b></div>' : '')
        + '<div class="sc-row"><span>Total</span><b>' + (o.total === '' ? '\u2014' : money(o.total)) + '</b></div>'
        + '<div class="sc-row"><span>Paid (' + o.payments.length + ')</span><b style="color:var(--green)">' + money(pd) + '</b></div>'
        + '<div class="sc-row"><span>Balance</span><b style="color:var(--amber)">' + (bal === '' ? '\u2014' : money(bal)) + '</b></div>'
        + (o.expected ? '<div class="sc-row"><span>Expected</span><b>' + esc(o.expected) + '</b></div>' : '')
        + (o.notes ? '<div class="sc-desc"><b>Notes:</b> ' + esc(o.notes) + '</div>' : '')
        + payHistHtml(o.payments)
        + '<div class="sc-statusrow"><span style="font-size:0.76rem;color:var(--ink-soft);font-weight:700;">Status</span>'
        + '<select data-sostatus>' + SO_STATUSES.map(function(s){ return '<option' + (s === o.status ? ' selected' : '') + '>' + s + '</option>'; }).join('') + '</select></div>'
        + '<div class="sc-actions"><button type="button" class="inv-btn green sm" data-act="pay">+ Payment</button>'
        + '<button type="button" class="inv-btn ghost sm" data-act="rcpt">\ud83d\udda8 Receipt</button>'
        + '<button type="button" class="inv-btn danger sm" data-act="del">Delete</button></div></div>';
    }).join('') : '<div class="sc-card" style="color:var(--ink-soft)">No special orders yet.</div>';
  }
  function renderCred(){
    var list = creds.filter(function(o){
      return !credQ || (o.customer||'').toLowerCase().indexOf(credQ) !== -1 || (o.phone||'').indexOf(credQ) !== -1;
    }).sort(function(a,b){ return b.createdAt - a.createdAt; });
    $('scCredList').innerHTML = list.length ? list.map(function(o){
      var used = paidSum(o.uses), rem = (o.amount === '' ? '' : o.amount - used);
      var st = rem !== '' && rem <= 0 ? ['Fully used','ok'] : (used > 0 ? ['Partially used','warn'] : ['Active','cred']);
      return '<div class="sc-card" data-id="' + esc(o.id) + '">'
        + '<span class="sc-chip ' + st[1] + '">' + st[0] + '</span>'
        + '<h3>' + esc(o.customer) + '</h3>'
        + '<div class="sub">' + esc(o.id) + ' \u00b7 ' + esc(o.phone) + ' \u00b7 Issued ' + esc(o.issued) + '</div>'
        + '<div class="sc-row"><span>Credit</span><b>' + (o.amount === '' ? '\u2014' : money(o.amount)) + '</b></div>'
        + '<div class="sc-row"><span>Used</span><b>' + money(used) + '</b></div>'
        + '<div class="sc-row"><span>Remaining</span><b style="color:var(--purple)">' + (rem === '' ? '\u2014' : money(rem)) + '</b></div>'
        + '<div class="sc-desc"><b>For:</b> ' + esc(o.desc || '\u2014') + '</div>'
        + payHistHtml(o.uses)
        + '<div class="sc-actions"><button type="button" class="inv-btn purple sm" data-act="redeem">Redeem</button>'
        + '<button type="button" class="inv-btn ghost sm" data-act="rcpt">\ud83d\udda8 Slip</button>'
        + '<button type="button" class="inv-btn danger sm" data-act="del">Delete</button></div></div>';
    }).join('') : '<div class="sc-card" style="color:var(--ink-soft)">No store credits yet.</div>';
  }
  function render(){ renderSO(); renderCred(); }

  function openSONew(){
    openScModal('New Special Order',
      '<div class="inv-form">'
      + '<label class="f">Customer name *<input id="nsoName" class="inv-in" autocomplete="off"></label>'
      + '<label class="f">Phone<input id="nsoPhone" class="inv-in" inputmode="tel"></label>'
      + '<label class="f">Item description *<input id="nsoItem" class="inv-in" placeholder="iPhone 15 Pro Max 256GB Blue"></label>'
      + '<label class="f">Specs / color<input id="nsoSpecs" class="inv-in"></label>'
      + '<div class="inv-row2"><label class="f">Total price ($)<input id="nsoTotal" type="number" step="0.01" min="0" class="inv-in"></label>'
      + '<label class="f">Deposit ($) \u2014 today<input id="nsoDep" type="number" step="0.01" min="0" class="inv-in"></label></div>'
      + '<label class="f">Expected date<input id="nsoExp" type="date" class="inv-in"></label>'
      + '<label class="f">Notes<textarea id="nsoNotes" class="inv-in" rows="2"></textarea></label>'
      + '<div class="inv-warn" id="nsoErr" hidden></div>'
      + '<div class="inv-modal-actions"><button type="button" class="inv-btn ghost" id="nsoCancel">Cancel</button><button type="button" class="inv-btn primary" id="nsoSave">Save order</button></div></div>',
      function(){
        $('nsoPhone').addEventListener('input', function(){ this.value = fmtPhone(this.value); });
        $('nsoCancel').addEventListener('click', closeScModal);
        $('nsoSave').addEventListener('click', function(){
          var name = $('nsoName').value.trim(), item = $('nsoItem').value.trim();
          if(!name || !item){ $('nsoErr').textContent = 'Customer name and item are required.'; $('nsoErr').hidden = false; return; }
          var dep = numOrBlank($('nsoDep').value);
          var o = normSO({ id: nextId('SO', SO_CNT), customer: name, phone: $('nsoPhone').value.trim(),
            item: item, specs: $('nsoSpecs').value.trim(), total: numOrBlank($('nsoTotal').value),
            deposit: dep, depDate: dep === '' ? '' : todayISO(), expected: $('nsoExp').value,
            status: 'Ordered', notes: $('nsoNotes').value.trim(),
            payments: (dep === '' || dep <= 0) ? [] : [{ d: todayISO(), a: dep }], createdAt: Date.now() });
          sos.push(o); persistSO(); pushRec('specialOrder', o, false); closeScModal(); render();
        });
        $('nsoName').focus();
      });
  }
  function openCredNew(){
    openScModal('Issue Store Credit',
      '<div class="inv-form">'
      + '<label class="f">Customer name *<input id="ncrName" class="inv-in" autocomplete="off"></label>'
      + '<label class="f">Phone<input id="ncrPhone" class="inv-in" inputmode="tel"></label>'
      + '<div class="inv-row2"><label class="f">Credit amount ($) *<input id="ncrAmt" type="number" step="0.01" min="0" class="inv-in"></label>'
      + '<label class="f">Date issued<input id="ncrDate" type="date" class="inv-in" value="' + todayISO() + '"></label></div>'
      + '<label class="f">What is this credit for? *<textarea id="ncrDesc" class="inv-in" rows="3" placeholder="e.g. Overpaid $40 on iPhone 12 screen repair \u2014 customer chose store credit."></textarea></label>'
      + '<div class="inv-warn" id="ncrErr" hidden></div>'
      + '<div class="inv-modal-actions"><button type="button" class="inv-btn ghost" id="ncrCancel">Cancel</button><button type="button" class="inv-btn purple" id="ncrSave">Issue credit</button></div></div>',
      function(){
        $('ncrPhone').addEventListener('input', function(){ this.value = fmtPhone(this.value); });
        $('ncrCancel').addEventListener('click', closeScModal);
        $('ncrSave').addEventListener('click', function(){
          var name = $('ncrName').value.trim(), amt = parseFloat($('ncrAmt').value), desc = $('ncrDesc').value.trim();
          if(!name){ $('ncrErr').textContent = 'Customer name is required.'; $('ncrErr').hidden = false; return; }
          if(!isFinite(amt) || amt <= 0){ $('ncrErr').textContent = 'Enter a valid credit amount.'; $('ncrErr').hidden = false; return; }
          if(!desc){ $('ncrErr').textContent = 'Describe what this credit is for.'; $('ncrErr').hidden = false; return; }
          var o = normCred({ id: nextId('SC', CRED_CNT), customer: name, phone: $('ncrPhone').value.trim(),
            amount: amt, issued: $('ncrDate').value || todayISO(), desc: desc, uses: [], createdAt: Date.now() });
          creds.push(o); persistCred(); pushRec('storeCredit', o, false); closeScModal(); render();
        });
        $('ncrName').focus();
      });
  }
  function openPay(kind, id){
    var list = kind === 'so' ? sos : creds, o = null;
    for (var i = 0; i < list.length; i++) if (list[i].id === id){ o = list[i]; break; }
    if(!o) return;
    var isCred = kind === 'cred';
    var total = isCred ? o.amount : o.total, pd = paidSum(isCred ? o.uses : o.payments);
    openScModal(isCred ? 'Redeem Credit' : 'Record Payment',
      '<div class="inv-form">'
      + '<div class="inv-note"><b>' + esc(o.customer) + '</b> \u00b7 balance due: <b>' + (total === '' ? '\u2014' : money(total - pd)) + '</b></div>'
      + '<label class="f">Amount ($) *<input id="pAmt" type="number" step="0.01" min="0" class="inv-in"></label>'
      + '<label class="f">Date<input id="pDate" type="date" class="inv-in" value="' + todayISO() + '"></label>'
      + (isCred ? '<label class="f">Used for<input id="pNote" class="inv-in" placeholder="e.g. screen protector"></label>' : '')
      + '<div class="inv-warn" id="pErr" hidden></div>'
      + '<div class="inv-modal-actions"><button type="button" class="inv-btn ghost" id="pCancel">Cancel</button><button type="button" class="inv-btn green" id="pSave">' + (isCred ? 'Redeem' : 'Add payment') + '</button></div></div>',
      function(){
        $('pCancel').addEventListener('click', closeScModal);
        $('pSave').addEventListener('click', function(){
          var a = parseFloat($('pAmt').value);
          if(!isFinite(a) || a <= 0){ $('pErr').textContent = 'Enter a valid amount.'; $('pErr').hidden = false; return; }
          if(isCred && total !== '' && a > total - pd + 0.005){ $('pErr').textContent = 'Amount exceeds remaining credit (' + money(total - pd) + ').'; $('pErr').hidden = false; return; }
          var entry = normPay({ d: $('pDate').value || todayISO(), a: a, note: (isCred && $('pNote')) ? $('pNote').value.trim() : '' });
          if(isCred){ o.uses.push(entry); persistCred(); pushRec('storeCredit', o, false); }
          else { o.payments.push(entry); persistSO(); pushRec('specialOrder', o, false); }
          closeScModal(); render();
        });
        $('pAmt').focus();
      });
  }

  function payRows(pays, emptyTxt){
    if(!pays.length) return '<div class="dp-pay"><span>' + emptyTxt + '</span><span>\u2014</span></div>';
    return pays.map(function(p){ return '<div class="dp-pay"><span>' + esc(p.d) + (p.note ? ' \u00b7 ' + esc(p.note) : '') + '</span><span>' + money(p.a) + '</span></div>'; }).join('');
  }
  function doPrint(storeHtml, custHtml){
    $('depositLabel').innerHTML = storeHtml + '<div class="dp-cut"><span>\u2702</span><span>CUT / FOLD HERE</span><span>\u2702</span></div>' + custHtml;
    document.body.classList.add('printing-deposit');
    window.print();
  }
  function printSO(o){
    var no = rcptNo('SCO'), pd = paidSum(o.payments), bal = o.total === '' ? '' : o.total - pd;
    var dateStr = new Date().toLocaleDateString(undefined, { year:'numeric', month:'short', day:'numeric' });
    function one(copy){
      return '<div class="dp-half"><div>'
        + '<div class="dp-store">' + esc(STORE.name) + '</div><div class="dp-addr">' + esc(STORE.addr) + ' \u00b7 ' + esc(STORE.phone) + '</div>'
        + '<div class="dp-title"><span>SPECIAL ORDER</span><span class="dp-copy">' + copy + '</span></div>'
        + '<div class="dp-row"><span class="dp-no">' + esc(no) + '</span><span>' + esc(dateStr) + '</span></div>'
        + '<div class="dp-cust">' + esc(o.customer) + (o.phone ? ' <span class="dp-sub">\u00b7 ' + esc(o.phone) + '</span>' : '') + '</div>'
        + '<div class="dp-device">' + esc(o.item) + '</div>'
        + (o.specs ? '<div class="dp-imei">' + esc(o.specs) + '</div>' : '')
        + '<div class="dp-amt"><span>Total price</span><span>' + (o.total === '' ? '\u2014' : money(o.total)) + '</span></div>'
        + '<div class="dp-payhead">PAYMENTS (' + o.payments.length + ')</div>' + payRows(o.payments, 'No payments yet')
        + '</div><div>'
        + '<div class="dp-amt"><span>Total paid</span><span>' + money(pd) + '</span></div>'
        + '<div class="dp-bal"><span>BALANCE DUE</span><span>' + (bal === '' ? '\u2014' : money(bal)) + '</span></div>'
        + '<div class="dp-note">Expected: ' + esc(o.expected || '\u2014') + ' \u00b7 Status: ' + esc(o.status) + (o.notes ? ' \u00b7 ' + esc(o.notes) : '') + '</div>'
        + '</div></div>';
    }
    doPrint(one('STORE COPY'), one('CUSTOMER COPY'));
  }
  function printCred(o){
    var no = rcptNo('SCR'), used = paidSum(o.uses), rem = o.amount === '' ? '' : o.amount - used;
    var dateStr = new Date().toLocaleDateString(undefined, { year:'numeric', month:'short', day:'numeric' });
    function one(copy){
      return '<div class="dp-half"><div>'
        + '<div class="dp-store">' + esc(STORE.name) + '</div><div class="dp-addr">' + esc(STORE.addr) + ' \u00b7 ' + esc(STORE.phone) + '</div>'
        + '<div class="dp-title"><span>STORE CREDIT</span><span class="dp-copy">' + copy + '</span></div>'
        + '<div class="dp-row"><span class="dp-no">' + esc(no) + '</span><span>' + esc(dateStr) + '</span></div>'
        + '<div class="dp-cust">' + esc(o.customer) + (o.phone ? ' <span class="dp-sub">\u00b7 ' + esc(o.phone) + '</span>' : '') + '</div>'
        + '<div class="dp-amt"><span>Credit issued (' + esc(o.issued) + ')</span><span>' + (o.amount === '' ? '\u2014' : money(o.amount)) + '</span></div>'
        + '<div class="dp-payhead">REDEEMED (' + o.uses.length + ')</div>' + payRows(o.uses, 'Not used yet')
        + '</div><div>'
        + '<div class="dp-amt"><span>Total used</span><span>' + money(used) + '</span></div>'
        + '<div class="dp-bal"><span>REMAINING</span><span>' + (rem === '' ? '\u2014' : money(rem)) + '</span></div>'
        + '<div class="dp-note">For: ' + esc(o.desc || '\u2014') + '</div>'
        + '</div></div>';
    }
    doPrint(one('STORE COPY'), one('CUSTOMER COPY'));
  }

  $('scAddSO').addEventListener('click', openSONew);
  $('scAddCred').addEventListener('click', openCredNew);
  $('scTabSO').addEventListener('click', function(){ $('scTabSO').classList.add('active'); $('scTabCred').classList.remove('active'); $('scSOPane').hidden = false; $('scCredPane').hidden = true; });
  $('scTabCred').addEventListener('click', function(){ $('scTabCred').classList.add('active'); $('scTabSO').classList.remove('active'); $('scCredPane').hidden = false; $('scSOPane').hidden = true; });
  $('scSOSearch').addEventListener('input', function(){ soQ = this.value.trim().toLowerCase(); renderSO(); });
  $('scCredSearch').addEventListener('input', function(){ credQ = this.value.trim().toLowerCase(); renderCred(); });
  function findBy(list, id){ for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i]; return null; }
  function onCard(e, list, type){
    var t = e.target.closest('[data-act]'); if(!t) return;
    var card = t.closest('.sc-card'); if(!card) return;
    var o = findBy(list, card.dataset.id); if(!o) return;
    var act = t.dataset.act;
    if (act === 'pay') openPay('so', o.id);
    else if (act === 'redeem') openPay('cred', o.id);
    else if (act === 'rcpt'){ if (type === 'so') printSO(o); else printCred(o); }
    else if (act === 'del'){
      if (!confirm('Delete this ' + (type === 'so' ? 'special order' : 'store credit') + '?')) return;
      list.splice(list.indexOf(o), 1);
      if (type === 'so'){ persistSO(); pushRec('specialOrder', o, true); } else { persistCred(); pushRec('storeCredit', o, true); }
      render();
    }
  }
  $('scSOList').addEventListener('click', function(e){ onCard(e, sos, 'so'); });
  $('scCredList').addEventListener('click', function(e){ onCard(e, creds, 'cred'); });
  $('scSOList').addEventListener('change', function(e){
    var s = e.target.closest('[data-sostatus]'); if(!s) return;
    var card = s.closest('.sc-card'); if(!card) return;
    var o = findBy(sos, card.dataset.id); if(!o) return;
    o.status = s.value; persistSO(); pushRec('specialOrder', o, false); renderSO();
  });

  loadLocal(); render(); setSync('local');
  try { if (sessionStorage.getItem(VIEW_KEY) === '1') openSC(); } catch(e){}
  pullType('specialorders', SO_KEY, normSO, function(list){ sos = list; persistSO(); renderSO(); }, 'specialOrder');
  pullType('storecredit', CRED_KEY, normCred, function(list){ creds = list; persistCred(); renderCred(); }, 'storeCredit');

window.PhoneFixManager.register('special_orders',function(id,value,remove){const old=sos.find(r=>r.id===id);if(!old)throw new Error('Record no longer exists');sos=remove?sos.filter(r=>r.id!==id):sos.map(r=>r.id===id?normSO(value):r);persistSO();pushRec('specialOrder',remove?old:sos.find(r=>r.id===id),remove);render();});
window.PhoneFixManager.register('store_credit',function(id,value,remove){const old=creds.find(r=>r.id===id);if(!old)throw new Error('Record no longer exists');creds=remove?creds.filter(r=>r.id!==id):creds.map(r=>r.id===id?normCred(value):r);persistCred();pushRec('storeCredit',remove?old:creds.find(r=>r.id===id),remove);render();});
})();
