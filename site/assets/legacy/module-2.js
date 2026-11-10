
(function(){
  'use strict';
  var $ = function(id){ return document.getElementById(id); };
  var STORE_KEY = 'phoneRepairInventory';
  var DEPNO_KEY = 'phoneRepairDepositNos';       // imei -> receipt number (so a reprint keeps its number)
  var DEPCNT_KEY = 'phoneRepairDepositCounter';  // YYYYMMDD -> last receipt sequence
  var ENDPOINT = 'https://script.google.com/macros/s/AKfycbxI_O5ZtLFcln6GYPgjphmzkji4-VZfeedhd--4Z26u01iNeRZPgpIg16iY5tQ5HHvSJg/exec';
  var VIEW_KEY = 'phoneRepairInvOpen';
  var DEAD_DAYS = 60;
  var FIELDS = ['imei','name','storage','price','qty','lot','dealer','date','status','soldPrice','soldDate','custName','custPhone','layCustomer','layPhone','layAgreed','layPayments','layStatus'];
  var STORE = { name:'Phone Fix Accessories', addr:'2900 Island Ave #2920, Philadelphia, PA 19153', phone:'(267) 344-9102' };

  var items = [];
  var filter = 'all', query = '', openImei = null, chartMode = 'profit', armedDelete = null, armedTimer = null;

  // ---------- helpers ----------
  function esc(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
  function pad(n){ return String(n).padStart(2, '0'); }
  function isoOf(d){ return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function todayISO(){ return isoOf(new Date()); }
  function isoDate(v){
    if (v == null || v === '') return '';
    var s = String(v).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    var d = new Date(s);
    return isNaN(d.getTime()) ? '' : isoOf(d);
  }
  function num(v, dflt){ var n = parseFloat(String(v == null ? '' : v).replace(/[^0-9.\-]/g, '')); return isFinite(n) ? n : (dflt || 0); }
  function numOrBlank(v){ if (v === '' || v == null) return ''; var n = parseFloat(String(v).replace(/[^0-9.\-]/g, '')); return isFinite(n) ? n : ''; }
  function money(n){ n = Number(n) || 0; return (n < 0 ? '\u2212' : '') + '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function fmtPhone(v){
    var d = String(v || '').replace(/\D/g, '').slice(0, 10);
    if (d.length <= 3) return d;
    if (d.length <= 6) return '(' + d.slice(0, 3) + ') ' + d.slice(3);
    return '(' + d.slice(0, 3) + ') ' + d.slice(3, 6) + '-' + d.slice(6);
  }
  function str(v){ return v == null ? '' : String(v).trim(); }
  function ageDays(iso){
    if (!iso) return 0;
    var p = iso.split('-').map(Number), a = new Date(p[0], p[1] - 1, p[2]), t = new Date();
    return Math.round((new Date(t.getFullYear(), t.getMonth(), t.getDate()) - a) / 86400000);
  }
  function invFmtAdded(iso){
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
    if (!m) return String(iso || '');
    return new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }
  function isDead(it){ return it.status === 'Available' && ageDays(it.date) > DEAD_DAYS; }
  function lotTotal(it){ return it.price * it.lot; }
  function profitOf(it){ return it.status === 'Sold' ? (num(it.soldPrice) - it.price) : 0; }
  function nameKey(s){ return str(s).toLowerCase(); }
  function find(imei){ for (var i = 0; i < items.length; i++) if (items[i].imei === imei) return items[i]; return null; }

  function normStatus(s){ s = str(s).toLowerCase(); return (s.indexOf('on layaway') === 0 || s.indexOf('layaway') === 0 || s.indexOf('res') === 0) ? 'On layaway' : (s.indexOf('sold') === 0 ? 'Sold' : 'Available'); }
  function normLayPayments(o){
    var lp = o.layPayments;
    if (typeof lp === 'string' && lp){ try { lp = JSON.parse(lp); } catch(e){ lp = []; } }
    if (!Array.isArray(lp)) lp = [];
    lp = lp.filter(function(p){ return p && isFinite(Number(p.a)); }).map(function(p){ return { d: isoDate(p.d) || todayISO(), a: Number(p.a) }; });
    if (!lp.length){
      var legacyDep = numOrBlank(o.deposit);
      if (str(o.resName || o.layCustomer) || legacyDep !== '') lp = legacyDep === '' ? [] : [{ d: isoDate(o.date) || todayISO(), a: legacyDep }];
    }
    return lp;
  }
  function layPaid(it){ return (it.layPayments || []).reduce(function(s, p){ return s + (Number(p.a) || 0); }, 0); }
  function layBal(it){ var a = numOrBlank(it.layAgreed); return a === '' ? '' : a - layPaid(it); }
  function norm(o){
    o = o || {};
    return {
      imei: str(o.imei), name: str(o.name), storage: str(o.storage),
      price: num(o.price), qty: Math.max(1, num(o.qty, 1)), lot: Math.max(1, num(o.lot, 1)),
      dealer: str(o.dealer), date: isoDate(o.date) || todayISO(), status: normStatus(o.status),
      soldPrice: numOrBlank(o.soldPrice), soldDate: isoDate(o.soldDate), custName: str(o.custName), custPhone: str(o.custPhone),
      layCustomer: str(o.layCustomer || o.resName), layPhone: str(o.layPhone || o.resPhone),
      layAgreed: numOrBlank(o.layAgreed == null || o.layAgreed === '' ? o.agreePrice : o.layAgreed),
      layPayments: normLayPayments(o), layStatus: str(o.layStatus) || (normStatus(o.status) === 'On layaway' ? 'Active' : '')
    };
  }

  // ---------- storage ----------
  function persist(){ try { localStorage.setItem(STORE_KEY, JSON.stringify(items)); } catch(e){} }
  function loadLocal(){
    try {
      var arr = JSON.parse(localStorage.getItem(STORE_KEY) || '[]');
      if (Array.isArray(arr)) items = arr.map(norm).filter(function(x){ return x.imei; });
    } catch(e){ items = []; }
  }
  function readJSON(key){ try { return JSON.parse(localStorage.getItem(key) || '{}') || {}; } catch(e){ return {}; } }
  function writeJSON(key, v){ try { localStorage.setItem(key, JSON.stringify(v)); } catch(e){} }

  // ---------- Google Sheet sync (two-way, never blocks the app) ----------
  var pending = 0, failed = false;
  // dirty tracking: a startup pull must never wipe local changes that haven't synced yet
  var DIRTY_KEY = 'phoneRepairInvDirty'; // imei -> {t:ms, del:bool}
  function readDirty(){ try { return JSON.parse(localStorage.getItem(DIRTY_KEY) || '{}') || {}; } catch(e){ return {}; } }
  function writeDirty(m){ try { localStorage.setItem(DIRTY_KEY, JSON.stringify(m)); } catch(e){} }
  function markDirty(imei, deleted){ if(!imei) return; var m = readDirty(); m[imei] = { t: Date.now(), del: !!deleted }; writeDirty(m); }
  function clearDirty(imei, sinceT){ var m = readDirty(); if(m[imei] && m[imei].t <= sinceT){ delete m[imei]; writeDirty(m); } }
  function setSync(state){
    var el = $('invSync');
    var label = { local: '\u25cf local', syncing: '\u25cc syncing\u2026', synced: '\u25cf synced', offline: '\u25cb offline' }[state] || state;
    el.className = 'inv-sync ' + state;
    el.textContent = label;
  }
  function pushItem(it, deleted){
    var body = { recordType: 'inventory' };
    FIELDS.forEach(function(f){ body[f] = it[f]; });
    if (deleted) body.deleted = true;
    var imei = it.imei;
    markDirty(imei, deleted);
    var t0 = Date.now();
    if (!navigator.onLine) { failed = true; setSync('offline'); return; }
    pending++; setSync('syncing');
    fetch(ENDPOINT, { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) })
      .then(function(){ clearDirty(imei, t0); pending--; if (pending <= 0) { pending = 0; setSync(failed ? 'offline' : 'synced'); } })
      .catch(function(){ pending = Math.max(0, pending - 1); failed = true; setSync('offline'); });
  }
  function pullFromSheet(){
    if (!navigator.onLine) { setSync('offline'); return; }
    setSync('syncing');
    var ctl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var timer = setTimeout(function(){ if (ctl) ctl.abort(); }, 12000);
    fetch(ENDPOINT + '?action=inventory', ctl ? { signal: ctl.signal } : {})
      .then(function(r){ if (!r.ok) throw new Error('http ' + r.status); return r.json(); })
      .then(function(data){
        var arr = Array.isArray(data) ? data : (data && (data.data || data.items || data.rows));
        if (!Array.isArray(arr)) throw new Error('bad payload');
        var map = {}, order = [];
        arr.forEach(function(row){
          if (row && (row.deleted === true || String(row.deleted).toLowerCase() === 'true')) return;
          var it = norm(row);
          if (!it.imei) return;
          if (!map[it.imei]) order.push(it.imei);
          map[it.imei] = it;
        });
        if (!order.length && items.length) { setSync('local'); return; } // empty sheet: never wipe local stock
        var localByImei = {};
        items.forEach(function(it){ if(it && it.imei) localByImei[it.imei] = it; });
        items = order.map(function(k){ return map[k]; });
        // merge: unsynced local (dirty) changes win over the pull — a refresh can never erase them
        var dirty = readDirty(), rePush = [];
        Object.keys(dirty).forEach(function(imei){
          var d = dirty[imei];
          if (d.del) {
            items = items.filter(function(it){ return it.imei !== imei; });
          } else if (localByImei[imei]) {
            var idx = -1;
            for (var i = 0; i < items.length; i++) if (items[i].imei === imei) { idx = i; break; }
            if (idx >= 0) items[idx] = localByImei[imei]; else items.push(localByImei[imei]);
            rePush.push(localByImei[imei]);
          }
        });
        persist(); failed = false; render(); setSync('synced');
        rePush.forEach(function(it){ pushItem(it, false); }); // make sure the sheet catches up
      })
      .catch(function(){ setSync('offline'); })
      .then(function(){ clearTimeout(timer); });
  }

  // ---------- mutations (every one persists + pushes) ----------
  function changed(it){ persist(); pushItem(it, false); render(); }
  function clearSale(it){ it.soldPrice = ''; it.soldDate = ''; it.custName = ''; it.custPhone = ''; }
  function clearHold(it){
    it.layCustomer = ''; it.layPhone = ''; it.layAgreed = ''; it.layPayments = []; it.layStatus = '';
    var m = readJSON(DEPNO_KEY); if (m[it.imei]) { delete m[it.imei]; writeJSON(DEPNO_KEY, m); }
  }

  // ---------- toast / modal ----------
  function toast(msg){
    var t = document.createElement('div'); t.className = 'inv-toast'; t.textContent = msg; document.body.appendChild(t);
    setTimeout(function(){ t.remove(); }, 2200);
  }
  function openModal(title, html, wide, mount){if(!PhoneFixAccess.can('inventory_manage')){alert("You don't have permission for this.");return;}
    $('invModalTitle').textContent = title;
    $('invModalBody').innerHTML = html;
    $('invModal').classList.toggle('wide', !!wide);
    $('invOverlay').hidden = false;
    if (mount) mount($('invModalBody'));
  }
  function closeModal(){ $('invOverlay').hidden = true; $('invModalBody').innerHTML = ''; }
  $('invModalClose').addEventListener('click', closeModal);
  $('invOverlay').addEventListener('mousedown', function(e){ if (e.target === $('invOverlay')) closeModal(); });
  document.addEventListener('keydown', function(e){ if (e.key === 'Escape' && !$('invOverlay').hidden) closeModal(); });
  function onEnter(root, btnId){ root.addEventListener('keydown', function(e){ if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); var b = $(btnId); if (b && !b.disabled) b.click(); } }); }

  // ---------- derived data ----------
  function filtered(){
    var q = query.trim().toLowerCase();
    var list = items.filter(function(it){
      if (filter === 'available' && it.status !== 'Available') return false;
      if (filter === 'layaway' && it.status !== 'On layaway') return false;
      if (filter === 'sold' && it.status !== 'Sold') return false;
      if (filter === 'dead' && !isDead(it)) return false;
      if (q && it.imei.toLowerCase().indexOf(q) < 0 && it.name.toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
    list.sort(function(a, b){
      return filter === 'dead' ? (a.date < b.date ? -1 : 1) : (a.date < b.date ? 1 : (a.date > b.date ? -1 : 0));
    });
    return list;
  }
  function refreshLists(){
    var names = {}, dealers = {};
    items.forEach(function(it){ if (it.name) names[it.name] = 1; if (it.dealer) dealers[it.dealer] = 1; });
    function opts(o){ return Object.keys(o).sort().map(function(k){ return '<option value="' + esc(k) + '">'; }).join(''); }
    $('invNameList').innerHTML = opts(names);
    $('invDealerList').innerHTML = opts(dealers);
  }

  // ---------- render ----------
  function renderStats(){
    var av = 0, rs = 0, sd = 0, tied = 0, profit = 0;
    items.forEach(function(it){
      if (it.status === 'Available') av++; else if (it.status === 'On layaway') rs++; else sd++;
      if (it.status !== 'Sold') tied += lotTotal(it); else profit += profitOf(it);
    });
    function tile(cls, k, v){ return '<div class="inv-stat ' + cls + '"><div class="k">' + k + '</div><div class="v">' + v + '</div></div>'; }
    $('invStats').innerHTML = tile('avail', 'Available', av) + tile('res', 'On layaway', rs) + tile('cash', 'Cash tied up', money(tied))
      + tile('', 'Sold', sd) + tile(profit >= 0 ? 'pos' : 'neg', 'Total profit', money(profit));
    $('invTabCount').textContent = av;
    var dead = items.filter(isDead), locked = dead.reduce(function(s, it){ return s + lotTotal(it); }, 0);
    var b = $('invDeadBanner');
    b.hidden = !dead.length;
    if (dead.length) b.textContent = '\u26a0 ' + dead.length + ' phone' + (dead.length > 1 ? 's' : '') + ' dead stock \u00b7 ' + money(locked) + ' locked \u2014 tap to view';
  }
  function renderChips(){
    var c = { all: items.length, available: 0, layaway: 0, sold: 0, dead: 0 };
    items.forEach(function(it){ c[it.status === 'On layaway' ? 'layaway' : it.status.toLowerCase()]++; if (isDead(it)) c.dead++; });
    var defs = [['all', 'All'], ['available', 'Available'], ['layaway', 'On layaway'], ['sold', 'Sold'], ['dead', '\ud83d\udc80 Dead']];
    $('invChips').innerHTML = defs.map(function(d){
      return '<button type="button" class="inv-fchip' + (filter === d[0] ? ' on' : '') + '" data-filter="' + d[0] + '">' + d[1] + '<b>' + c[d[0]] + '</b></button>';
    }).join('');
  }
  function cardHtml(it){
    var dead = isDead(it), open = openImei === it.imei, age = ageDays(it.date);
    var st = it.status.toLowerCase();
    var profit = profitOf(it);
    var chips = '<span class="inv-chip ' + st + '">' + it.status + '</span>'
      + (dead ? '<span class="inv-chip dead">\ud83d\udc80 DEAD STOCK \u00b7 ' + age + 'd</span>' : '')
      + (it.status === 'Sold' ? '<span class="inv-chip ' + (profit >= 0 ? 'profit' : 'loss') + '">' + (profit >= 0 ? '+' : '') + money(profit) + '</span>' : '')
      + (it.lot > 1 ? '<span class="inv-chip">Lot \u00d7' + it.lot + '</span>' : '') + (it.qty > 1 ? '<span class="inv-chip">Qty ' + it.qty + '</span>' : '');
    var priceBox = it.status === 'Sold'
      ? '<div class="inv-price">' + money(it.soldPrice) + '<small>Sold</small></div>'
      : '<div class="inv-price">' + money(it.price) + '<small>Bought</small></div>';
    var h = '<article class="inv-card st-' + st + (dead ? ' dead' : '') + (open ? ' open' : '') + '" data-imei="' + esc(it.imei) + '">'
      + '<div class="inv-head" role="button" tabindex="0" data-act="toggle" aria-expanded="' + open + '">'
      + '<div class="inv-title"><span class="inv-name">' + esc(it.name) + '</span>' + (it.storage ? '<span class="inv-storage">' + esc(it.storage) + '</span>' : '') + '</div>'
      + '<div class="inv-sub"><span class="mono">' + esc(it.imei) + '</span><span>' + esc(it.dealer || 'No dealer') + '</span><span>Added ' + invFmtAdded(it.date) + ' \u00b7 ' + age + 'd</span></div>'
      + '<div class="inv-pricebox">' + priceBox + '</div><div class="inv-chips">' + chips + '</div></div>';
    if (open) h += bodyHtml(it);
    return h + '</article>';
  }
  function bodyHtml(it){
    var info = '<div class="inv-info">'
      + '<div><span>IMEI</span><b class="inv-mono">' + esc(it.imei) + '</b></div>'
      + '<div><span>Storage</span>' + esc(it.storage || '\u2014') + '</div>'
      + '<div><span>Qty / Lot</span>' + it.qty + ' / ' + it.lot + '</div>'
      + '<div><span>Total buying</span>' + money(lotTotal(it)) + '</div>'
      + '<div><span>Added</span>' + esc(it.date) + ' (' + ageDays(it.date) + ' days)</div></div>';
    var extra = '', actions = '';
    if (it.status === 'On layaway') {
      var agree = numOrBlank(it.layAgreed), pd = layPaid(it), pays = it.layPayments || [], bal = layBal(it);
      extra = '<div class="inv-hold">On layaway for <b>' + esc(it.layCustomer) + '</b>' + (it.layPhone ? ' \u00b7 ' + esc(it.layPhone) : '')
        + '<div>Agreed ' + (agree === '' ? '\u2014' : money(agree)) + ' \u00b7 Paid ' + money(pd) + ' (' + pays.length + ')'
        + ' \u00b7 Balance ' + (bal === '' ? '\u2014' : money(bal)) + (it.layStatus ? ' \u00b7 ' + esc(it.layStatus) : '') + '</div>'
        + (pays.length ? '<div class="inv-payhist">' + pays.map(function(p){ return '<div><span>' + esc(p.d) + '</span><b>' + money(p.a) + '</b></div>'; }).join('') + '</div>' : '')
        + '</div>';
      actions = '<button type="button" class="inv-btn green sm" data-act="complete">Complete sale\u2026</button>'
        + '<button type="button" class="inv-btn purple sm" data-act="laypay">+ Payment</button>'
        + '<button type="button" class="inv-btn ghost sm" data-act="cancellay">Cancel layaway</button>'
        + '<button type="button" class="inv-btn ghost sm" data-act="receipt">\ud83d\udda8 Receipt</button>';
    } else if (it.status === 'Sold') {
      var p = profitOf(it);
      extra = '<div class="inv-info"><div><span>Sold price</span><b>' + money(it.soldPrice) + '</b></div>'
        + '<div><span>Buyer</span>' + (it.custName ? '<button type="button" class="inv-link" data-act="buyer" data-name="' + esc(it.custName) + '">' + esc(it.custName) + '</button>' : '\u2014')
        + (it.custPhone ? '<div>' + esc(it.custPhone) + '</div>' : '') + '</div>'
        + '<div><span>Sale date</span>' + esc(it.soldDate || '\u2014') + '</div>'
        + '<div><span>Profit</span><span class="inv-chip ' + (p >= 0 ? 'profit' : 'loss') + '" style="display:inline-block;margin:0">' + (p >= 0 ? '+' : '') + money(p) + '</span></div></div>';
      actions = '<button type="button" class="inv-btn ghost sm" data-act="return">\u21a9 Return to stock</button>';
    } else {
      actions = '<button type="button" class="inv-btn green sm" data-act="sell">Mark sold\u2026</button>'
        + '<button type="button" class="inv-btn purple sm" data-act="layaway">Layaway\u2026</button>';
    }
    var armed = armedDelete === it.imei;
    actions += '<button type="button" class="inv-btn danger sm' + (armed ? ' armed' : '') + '" data-act="delete">' + (armed ? 'Sure? Tap again' : 'Delete') + '</button>';
    var edit = '<div class="inv-edit"><label>Buying price ($)<input type="number" step="0.01" min="0" inputmode="decimal" class="inv-in" data-f="price" value="' + esc(it.price) + '"></label>'
      + '<label>Dealer<input type="text" list="invDealerList" class="inv-in" data-f="dealer" value="' + esc(it.dealer) + '"></label>'
      + '<button type="button" class="inv-btn primary sm" data-act="save">Save</button></div>';
    return '<div class="inv-body">' + info + extra + edit + '<div class="inv-actions">' + actions + '</div></div>';
  }
  function renderList(){
    var list = filtered();
    $('invList').innerHTML = list.length ? list.map(cardHtml).join('')
      : '<div class="inv-empty">' + (items.length ? 'No phones match your search or filter.' : 'No phones yet. Tap \u201c+ Add phone\u201d to start your inventory.') + '</div>';
  }

  // ---------- analytics (SVG) ----------
  function groupBy(list, keyFn, valFn){
    var m = {}, order = [];
    list.forEach(function(it){
      var k = keyFn(it); if (k == null) return;
      if (!(k in m)) { m[k] = 0; order.push(k); }
      m[k] += valFn(it);
    });
    return order.map(function(k){ return { label: k, value: m[k] }; });
  }
  function short(s, n){ s = String(s); return s.length > n ? s.slice(0, n - 1) + '\u2026' : s; }
  function hBars(rows, signed){
    rows = rows.slice(0, 8);
    if (!rows.length) return '<div class="ch-empty">No data yet.</div>';
    var W = 640, rowH = 32, labelW = 170, valW = 96, x0 = labelW + 8, area = W - x0 - valW;
    var lo = Math.min.apply(null, [0].concat(rows.map(function(r){ return r.value; })));
    var hi = Math.max.apply(null, [0].concat(rows.map(function(r){ return r.value; })));
    var span = (hi - lo) || 1, zero = x0 + area * (-lo / span), H = rows.length * rowH + 10;
    var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Bar chart">';
    rows.forEach(function(r, i){
      var y = 5 + i * rowH, w = Math.abs(r.value) / span * area, x = r.value >= 0 ? zero : zero - w;
      var fill = signed ? (r.value >= 0 ? 'var(--green)' : 'var(--red)') : 'var(--orange)';
      var tx = r.value >= 0 ? x + w + 6 : x - 6, anchor = r.value >= 0 ? 'start' : 'end';
      s += '<text class="ch-label" x="' + (labelW) + '" y="' + (y + 19) + '" text-anchor="end">' + esc(short(r.label, 24)) + '</text>'
        + '<rect x="' + x.toFixed(1) + '" y="' + (y + 4) + '" width="' + Math.max(w, 1.5).toFixed(1) + '" height="' + (rowH - 12) + '" rx="4" style="fill:' + fill + '"></rect>'
        + '<text class="ch-val" x="' + tx.toFixed(1) + '" y="' + (y + 19) + '" text-anchor="' + anchor + '">' + esc(money(r.value)) + '</text>';
    });
    s += '<line class="ch-axis" x1="' + zero.toFixed(1) + '" x2="' + zero.toFixed(1) + '" y1="0" y2="' + H + '"></line></svg>';
    return s;
  }
  function vBars(rows){
    if (!rows.length) return '<div class="ch-empty">No sales yet.</div>';
    rows = rows.slice(-12);
    var W = 640, H = 250, top = 24, bot = 34, left = 10, right = 10, plotH = H - top - bot;
    var lo = Math.min.apply(null, [0].concat(rows.map(function(r){ return r.value; })));
    var hi = Math.max.apply(null, [0].concat(rows.map(function(r){ return r.value; })));
    var span = (hi - lo) || 1, zeroY = top + plotH * (hi / span), slot = (W - left - right) / rows.length, bw = Math.min(54, slot * 0.62);
    var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Profit by month">';
    rows.forEach(function(r, i){
      var h = Math.abs(r.value) / span * plotH, cx = left + slot * i + slot / 2;
      var y = r.value >= 0 ? zeroY - h : zeroY;
      var p = r.label.split('-'), lbl = new Date(+p[0], +p[1] - 1, 1).toLocaleDateString(undefined, { month: 'short', year: '2-digit' });
      s += '<rect x="' + (cx - bw / 2).toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + Math.max(h, 1.5).toFixed(1) + '" rx="4" style="fill:' + (r.value >= 0 ? 'var(--green)' : 'var(--red)') + '"></rect>'
        + '<text class="ch-val" x="' + cx.toFixed(1) + '" y="' + (r.value >= 0 ? y - 5 : y + h + 13).toFixed(1) + '" text-anchor="middle">' + esc(money(r.value)) + '</text>'
        + '<text class="ch-label" x="' + cx.toFixed(1) + '" y="' + (H - 12) + '" text-anchor="middle">' + esc(lbl) + '</text>';
    });
    s += '<line class="ch-axis" x1="' + left + '" x2="' + (W - right) + '" y1="' + zeroY.toFixed(1) + '" y2="' + zeroY.toFixed(1) + '"></line></svg>';
    return s;
  }
  function renderChart(){
    var sold = items.filter(function(it){ return it.status === 'Sold'; });
    var html;
    if (chartMode === 'profit') {
      var rows = groupBy(sold.filter(function(it){ return it.soldDate; }), function(it){ return it.soldDate.slice(0, 7); }, profitOf);
      rows.sort(function(a, b){ return a.label < b.label ? -1 : 1; });
      html = vBars(rows);
    } else if (chartMode === 'models') {
      var rm = groupBy(sold, function(it){ return it.name || '(no name)'; }, profitOf).sort(function(a, b){ return b.value - a.value; });
      html = hBars(rm, true);
    } else if (chartMode === 'dealers') {
      var rd = groupBy(items, function(it){ return it.dealer || '(no dealer)'; }, lotTotal).sort(function(a, b){ return b.value - a.value; });
      html = hBars(rd, false);
    } else {
      var rg = groupBy(sold, function(it){ return it.dealer || '(no dealer)'; }, profitOf).sort(function(a, b){ return b.value - a.value; });
      html = hBars(rg, true);
    }
    $('invChart').innerHTML = html;
    Array.prototype.forEach.call($('invChartTabs').children, function(b){ b.classList.toggle('on', b.dataset.mode === chartMode); });
  }
  function render(){ refreshLists(); renderStats(); renderChart(); renderChips(); renderList(); }

  // ---------- modals ----------
  function openAdd(){
    openModal('Add phone',
      '<div class="inv-form">'
      + '<label class="f">IMEI *<input id="fImei" class="inv-in" inputmode="numeric" autocomplete="off" placeholder="15-digit IMEI"></label><div class="inv-warn" id="fWarn" hidden></div>'
      + '<label class="f">Product name *<input id="fName" list="invNameList" class="inv-in" autocomplete="off" placeholder="iPhone 14 Pro"></label>'
      + '<label class="f">Storage<input id="fStorage" list="invStorageList" class="inv-in" placeholder="128GB"></label>'
      + '<label class="f">Buying price ($) *<input id="fPrice" type="number" step="0.01" min="0" inputmode="decimal" class="inv-in" placeholder="0.00"></label>'
      + '<div class="inv-row2"><label class="f">Qty<input id="fQty" type="number" min="1" step="1" class="inv-in" value="1"></label>'
      + '<label class="f">Lot total<input id="fLot" type="number" min="1" step="1" class="inv-in" value="1"></label></div>'
      + '<label class="f">Dealer<input id="fDealer" list="invDealerList" class="inv-in" autocomplete="off"></label>'
      + '<label class="f">Date<input id="fDate" type="date" class="inv-in" value="' + todayISO() + '"></label>'
      + '<div class="inv-total" id="fTotal">Total buying: $0.00</div><div class="inv-warn" id="fErr" hidden></div>'
      + '<div class="inv-modal-actions"><button type="button" class="inv-btn ghost" id="fCancel">Cancel</button><button type="button" class="inv-btn primary" id="fSave">Add phone</button></div></div>',
      false, function(root){
        function dup(){ var v = $('fImei').value.trim().toLowerCase(); return v ? items.filter(function(i){ return i.imei.toLowerCase() === v; })[0] : null; }
        function upd(){
          var d = dup(), w = $('fWarn');
          w.hidden = !d; $('fImei').classList.toggle('bad', !!d);
          if (d) w.textContent = '\u26a0 This IMEI is already in inventory (' + d.name + ' \u00b7 ' + d.status + '). Duplicates are not allowed.';
          $('fSave').disabled = !!d;
          $('fTotal').textContent = 'Total buying: ' + money(num($('fPrice').value) * Math.max(1, num($('fLot').value, 1)));
        }
        ['fImei', 'fPrice', 'fLot'].forEach(function(id){ $(id).addEventListener('input', upd); });
        $('fCancel').addEventListener('click', closeModal);
        $('fSave').addEventListener('click', function(){
          var imei = $('fImei').value.trim(), name = $('fName').value.trim(), priceRaw = $('fPrice').value.trim(), err = $('fErr');
          function fail(m){ err.textContent = m; err.hidden = false; }
          if (!imei) return fail('IMEI is required.');
          if (dup()) return fail('This IMEI is already in inventory.');
          if (!name) return fail('Product name is required.');
          if (priceRaw === '' || !isFinite(parseFloat(priceRaw)) || parseFloat(priceRaw) < 0) return fail('Enter a valid buying price.');
          var it = norm({ imei: imei, name: name, storage: $('fStorage').value, price: priceRaw, qty: $('fQty').value || 1, lot: $('fLot').value || 1,
            dealer: $('fDealer').value, date: $('fDate').value || todayISO(), status: 'Available' });
          items.unshift(it); closeModal(); changed(it); toast('Phone added');
        });
        onEnter(root, 'fSave'); upd(); $('fImei').focus();
      });
  }
  function openSell(it, prefill){
    prefill = prefill || {};
    openModal('Mark sold \u2014 ' + it.name,
      '<div class="inv-form">'
      + (prefill.deposit ? '<div class="inv-note">Deposit already paid: ' + money(prefill.deposit) + '</div>' : '')
      + '<label class="f">Selling price ($) *<input id="sPrice" type="number" step="0.01" min="0" inputmode="decimal" class="inv-in" value="' + esc(prefill.price == null ? '' : prefill.price) + '"></label>'
      + '<label class="f">Customer name<input id="sName" class="inv-in" autocomplete="off" value="' + esc(prefill.name || '') + '"></label>'
      + '<label class="f">Customer phone<input id="sPhone" class="inv-in" inputmode="tel" value="' + esc(prefill.phone || '') + '"></label>'
      + '<label class="f">Sale date<input id="sDate" type="date" class="inv-in" value="' + todayISO() + '"></label>'
      + '<div class="inv-total" id="sProfit">Profit: \u2014</div><div class="inv-warn" id="sErr" hidden></div>'
      + '<div class="inv-modal-actions"><button type="button" class="inv-btn ghost" id="sCancel">Cancel</button><button type="button" class="inv-btn green" id="sSave">Confirm sale</button></div></div>',
      false, function(root){
        function upd(){
          var raw = $('sPrice').value.trim(), el = $('sProfit');
          if (raw === '' || !isFinite(parseFloat(raw))) { el.textContent = 'Profit: \u2014 (selling price \u2212 ' + money(it.price) + ' buying)'; el.className = 'inv-total'; return; }
          var p = parseFloat(raw) - it.price;
          el.textContent = 'Profit: ' + (p >= 0 ? '+' : '') + money(p) + '  (sell \u2212 buy)'; el.className = 'inv-total ' + (p >= 0 ? 'pos' : 'neg');
        }
        $('sPrice').addEventListener('input', upd);
        $('sPhone').addEventListener('input', function(){ this.value = fmtPhone(this.value); });
        $('sCancel').addEventListener('click', closeModal);
        $('sSave').addEventListener('click', function(){
          var raw = $('sPrice').value.trim();
          if (raw === '' || !isFinite(parseFloat(raw)) || parseFloat(raw) < 0) { $('sErr').textContent = 'Enter the selling price.'; $('sErr').hidden = false; return; }
          it.status = 'Sold'; it.soldPrice = parseFloat(raw); it.soldDate = $('sDate').value || todayISO();
          it.custName = $('sName').value.trim(); it.custPhone = $('sPhone').value.trim();
          clearHold(it); closeModal(); changed(it); toast('Marked sold');
        });
        onEnter(root, 'sSave'); upd(); $('sPrice').focus();
      });
  }
  function openLayaway(it){
    openModal('Layaway \u2014 ' + it.name,
      '<div class="inv-form">'
      + '<label class="f">Customer name *<input id="lName" class="inv-in" autocomplete="off"></label>'
      + '<label class="f">Customer phone<input id="lPhone" class="inv-in" inputmode="tel"></label>'
      + '<div class="inv-row2"><label class="f">Agreed price ($)<input id="lAgree" type="number" step="0.01" min="0" inputmode="decimal" class="inv-in"></label>'
      + '<label class="f">Deposit ($) \u2014 today<input id="lDep" type="number" step="0.01" min="0" inputmode="decimal" class="inv-in"></label></div>'
      + '<div class="inv-total" id="lBal">Balance due: \u2014</div><div class="inv-warn" id="lErr" hidden></div>'
      + '<div class="inv-modal-actions"><button type="button" class="inv-btn ghost" id="lCancel">Cancel</button><button type="button" class="inv-btn purple" id="lSave">Start layaway</button></div></div>',
      false, function(root){
        function upd(){
          var a = numOrBlank($('lAgree').value), d = numOrBlank($('lDep').value);
          $('lBal').textContent = a === '' ? 'Balance due: \u2014' : 'Balance due: ' + money(a - (d === '' ? 0 : d));
        }
        ['lAgree', 'lDep'].forEach(function(id){ $(id).addEventListener('input', upd); });
        $('lPhone').addEventListener('input', function(){ this.value = fmtPhone(this.value); });
        $('lCancel').addEventListener('click', closeModal);
        $('lSave').addEventListener('click', function(){
          var name = $('lName').value.trim();
          if (!name) { $('lErr').textContent = 'Customer name is required.'; $('lErr').hidden = false; return; }
          var dep = numOrBlank($('lDep').value);
          it.status = 'On layaway'; it.layStatus = 'Active';
          it.layCustomer = name; it.layPhone = $('lPhone').value.trim();
          it.layAgreed = numOrBlank($('lAgree').value);
          it.layPayments = (dep === '' || dep <= 0) ? [] : [{ d: todayISO(), a: dep }];
          closeModal(); changed(it); toast('Layaway started');
        });
        onEnter(root, 'lSave'); $('lName').focus();
      });
  }
  function openLayPayment(it){
    var bal = layBal(it);
    openModal('Payment \u2014 ' + it.name,
      '<div class="inv-form">'
      + '<div class="inv-note">Balance due: <b>' + (bal === '' ? '\u2014' : money(bal)) + '</b></div>'
      + '<label class="f">Amount ($) *<input id="lpAmt" type="number" step="0.01" min="0" inputmode="decimal" class="inv-in"></label>'
      + '<label class="f">Date<input id="lpDate" type="date" class="inv-in" value="' + todayISO() + '"></label>'
      + '<div class="inv-warn" id="lpErr" hidden></div>'
      + '<div class="inv-modal-actions"><button type="button" class="inv-btn ghost" id="lpCancel">Cancel</button><button type="button" class="inv-btn green" id="lpSave">Add payment</button></div></div>',
      false, function(root){
        $('lpCancel').addEventListener('click', closeModal);
        $('lpSave').addEventListener('click', function(){
          var a = parseFloat($('lpAmt').value);
          if (!isFinite(a) || a <= 0) { $('lpErr').textContent = 'Enter a valid amount.'; $('lpErr').hidden = false; return; }
          it.layPayments = (it.layPayments || []).concat([{ d: $('lpDate').value || todayISO(), a: a }]);
          var b = layBal(it);
          it.layStatus = (b !== '' && b <= 0) ? 'Paid off' : 'Active';
          closeModal(); changed(it);
          toast(b !== '' && b <= 0 ? 'Paid off! Complete the sale when ready.' : 'Payment recorded');
        });
        onEnter(root, 'lpSave'); $('lpAmt').focus();
      });
  }
  function openBuyer(name){
    var key = nameKey(name);
    var list = items.filter(function(it){ return it.status === 'Sold' && nameKey(it.custName) === key; })
      .sort(function(a, b){ return a.soldDate < b.soldDate ? 1 : -1; });
    var total = list.reduce(function(s, it){ return s + num(it.soldPrice); }, 0);
    var profit = list.reduce(function(s, it){ return s + profitOf(it); }, 0);
    var phone = (list.filter(function(i){ return i.custPhone; })[0] || {}).custPhone || '';
    openModal(name, '<div class="inv-form">'
      + (phone ? '<div class="inv-sub" style="font-size:0.9rem;font-weight:700">' + esc(phone) + '</div>' : '')
      + '<div class="inv-buyer-list">' + (list.length ? list.map(function(it){
          return '<div class="inv-buyer-item"><div><b>' + esc(it.name) + '</b> ' + esc(it.storage)
            + '<small class="inv-mono">' + esc(it.imei) + '</small><small>' + esc(it.soldDate || '') + '</small></div><div><b>' + money(it.soldPrice) + '</b></div></div>';
        }).join('') : '<div class="inv-empty">No purchases found.</div>') + '</div>'
      + '<div class="inv-info"><div><span>Phones bought</span><b>' + list.length + '</b></div><div><span>Total paid</span><b>' + money(total) + '</b></div><div><span>Profit on them</span><b>' + money(profit) + '</b></div></div>'
      + '<div class="inv-modal-actions"><button type="button" class="inv-btn ghost" id="bClose">Close</button></div></div>', true,
      function(){ $('bClose').addEventListener('click', closeModal); });
  }

  // ---------- deposit receipt ----------
  function depositNumber(imei){
    var map = readJSON(DEPNO_KEY);
    if (map[imei]) return map[imei];
    var day = todayISO().replace(/-/g, ''), cnt = readJSON(DEPCNT_KEY), n = (Number(cnt[day]) || 0) + 1;
    cnt[day] = n; writeJSON(DEPCNT_KEY, cnt);
    var no = 'DEP-' + day + '-' + String(n).padStart(3, '0');
    map[imei] = no; writeJSON(DEPNO_KEY, map);
    return no;
  }
  function printReceipt(it){
    var no = depositNumber(it.imei);
    var agree = numOrBlank(it.layAgreed), pays = it.layPayments || [], pd = layPaid(it);
    var bal = agree === '' ? '' : agree - pd;
    var dateStr = new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    function payRows(){
      if(!pays.length) return '<div class="dp-pay"><span>No payments yet</span><span>\u2014</span></div>';
      return pays.map(function(p){ return '<div class="dp-pay"><span>' + esc(p.d || '') + '</span><span>' + money(p.a) + '</span></div>'; }).join('');
    }
    function half(copy){
      return '<div class="dp-half"><div>'
        + '<div class="dp-store">' + esc(STORE.name) + '</div><div class="dp-addr">' + esc(STORE.addr) + ' \u00b7 ' + esc(STORE.phone) + '</div>'
        + '<div class="dp-title"><span>LAYAWAY RECEIPT</span><span class="dp-copy">' + copy + '</span></div>'
        + '<div class="dp-row"><span class="dp-no">' + esc(no) + '</span><span>' + esc(dateStr) + '</span></div>'
        + '<div class="dp-cust">' + esc(it.layCustomer) + (it.layPhone ? ' <span class="dp-sub">\u00b7 ' + esc(it.layPhone) + '</span>' : '') + '</div>'
        + '<div class="dp-device">' + esc(it.name) + (it.storage ? ' \u00b7 ' + esc(it.storage) : '') + '</div>'
        + '<div class="dp-imei">IMEI ' + esc(it.imei) + '</div>'
        + '<div class="dp-amt"><span>Agreed price</span><span>' + (agree === '' ? '\u2014' : money(agree)) + '</span></div>'
        + '<div class="dp-payhead">PAYMENTS (' + pays.length + ')</div>' + payRows()
        + '</div><div>'
        + '<div class="dp-amt"><span>Total paid</span><span>' + money(pd) + '</span></div>'
        + '<div class="dp-bal"><span>BALANCE DUE</span><span>' + (bal === '' ? '\u2014' : money(bal)) + '</span></div>'
        + '<div class="dp-note">Phone on layaway for the customer named above \u2014 please bring this receipt at pickup.</div>'
        + '</div></div>';
    }
    $('depositLabel').innerHTML = half('STORE COPY') + '<div class="dp-cut"><span>\u2702</span><span>CUT / FOLD HERE</span><span>\u2702</span></div>' + half('CUSTOMER COPY');
    document.body.classList.add('printing-deposit');
    window.print();
  }
  window.addEventListener('afterprint', function(){ document.body.classList.remove('printing-deposit'); });
  // safety net (some mobile browsers skip afterprint): any tap/click afterwards restores the normal intake label
  document.addEventListener('pointerdown', function(){ document.body.classList.remove('printing-deposit'); }, true);

  // ---------- layaway finder (toolbar) ----------
  function openLayFinder(){
    function rows(q){
      q = (q || '').toLowerCase();
      var list = items.filter(function(it){
        return it.status === 'On layaway' && (!q || (it.name || '').toLowerCase().indexOf(q) !== -1 || (it.layCustomer || '').toLowerCase().indexOf(q) !== -1);
      });
      if(!list.length) return '<div class="inv-note">No layaway matches.</div>';
      return list.map(function(it){
        var pd = layPaid(it), bal = layBal(it);
        return '<button type="button" class="inv-finder-item" data-imei="' + esc(it.imei) + '">'
          + '<span><b>' + esc(it.name) + '</b><br><span class="inv-sub2">' + esc(it.layCustomer) + ' \u00b7 Balance ' + (bal === '' ? '\u2014' : money(bal)) + '</span></span>'
          + '<span>\ud83d\udda8</span></button>';
      }).join('');
    }
    openModal('Layaway finder',
      '<div class="inv-form"><label class="f">Find phone model or customer<input id="lfQ" class="inv-in" placeholder="Type to search\u2026" autocomplete="off"></label>'
      + '<div id="lfList">' + rows('') + '</div></div>',
      false, function(root){
        $('lfQ').addEventListener('input', function(){ $('lfList').innerHTML = rows(this.value); });
        $('lfList').addEventListener('click', function(e){
          var b = e.target.closest('[data-imei]'); if(!b) return;
          var it = find(b.dataset.imei); closeModal(); if(it) printReceipt(it);
        });
        $('lfQ').focus();
      });
  }

  // ---------- CSV export ----------
  function csvCell(v){
    var s = String(v == null ? '' : v);
    if (/^[=+@\-]/.test(s) && isNaN(Number(s))) s = "'" + s;
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function exportCsv(){ if(!PhoneFixAccess.can('data_export')||!PhoneFixAccess.can('costs_view')){alert("Inventory export requires export and cost-view permission.");return;}
    var rows = [FIELDS.join(',')].concat(items.map(function(it){ return FIELDS.map(function(f){ return csvCell(f === 'layPayments' ? JSON.stringify(it[f] || []) : it[f]); }).join(','); }));
    var blob = new Blob(['\ufeff' + rows.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = 'phone-inventory-' + todayISO().replace(/-/g, '') + '.csv';
    document.body.appendChild(a); a.click();
    setTimeout(function(){ URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  // ---------- events ----------
  $('invAdd').addEventListener('click', openAdd);
  $('invExport').addEventListener('click', exportCsv);
  $('invLayaway').addEventListener('click', openLayFinder);
  $('invSearch').addEventListener('input', function(){ query = this.value; renderList(); });
  $('invChips').addEventListener('click', function(e){ var b = e.target.closest('[data-filter]'); if (b) { filter = b.dataset.filter; render(); } });
  $('invChartTabs').addEventListener('click', function(e){ var b = e.target.closest('[data-mode]'); if (b) { chartMode = b.dataset.mode; renderChart(); } });
  $('invDeadBanner').addEventListener('click', function(){ filter = 'dead'; render(); $('invChips').scrollIntoView({ behavior: 'smooth', block: 'center' }); });
  $('invList').addEventListener('keydown', function(e){
    if ((e.key === 'Enter' || e.key === ' ') && e.target.classList && e.target.classList.contains('inv-head')) { e.preventDefault(); e.target.click(); }
  });
  $('invList').addEventListener('click', function(e){
    var t = e.target.closest('[data-act]');
    if (!t) return;
    var card = t.closest('.inv-card'), it = card ? find(card.dataset.imei) : null;
    if (!it) return;
    var act = t.dataset.act;
    if (act !== 'delete') armedDelete = null;
    switch (act) {
      case 'toggle': openImei = openImei === it.imei ? null : it.imei; renderList(); break;
      case 'save': {
        var pIn = card.querySelector('[data-f=price]'), dIn = card.querySelector('[data-f=dealer]'), pr = pIn.value.trim();
        if (pr === '' || !isFinite(parseFloat(pr)) || parseFloat(pr) < 0) { pIn.classList.add('bad'); return; }
        it.price = parseFloat(pr); it.dealer = dIn.value.trim(); changed(it); toast('Saved');
        break;
      }
      case 'sell': openSell(it); break;
      case 'layaway': openLayaway(it); break;
      case 'laypay': openLayPayment(it); break;
      case 'complete': openSell(it, { price: it.layAgreed, name: it.layCustomer, phone: it.layPhone, deposit: layPaid(it) }); break;
      case 'cancellay': if(!confirm('Cancel this layaway? The phone returns to stock.')) break; it.status = 'Available'; clearHold(it); changed(it); toast('Layaway cancelled'); break;
      case 'return': it.status = 'Available'; clearSale(it); changed(it); toast('Returned to stock'); break;
      case 'receipt': printReceipt(it); break;
      case 'buyer': openBuyer(t.dataset.name); break;
      case 'delete':
        if (armedDelete === it.imei) {
          clearTimeout(armedTimer); armedDelete = null;
          items = items.filter(function(x){ return x !== it; }); openImei = null;
          persist(); pushItem(it, true); render(); toast('Deleted');
        } else {
          armedDelete = it.imei; clearTimeout(armedTimer);
          armedTimer = setTimeout(function(){ armedDelete = null; renderList(); }, 3000);
          renderList();
        }
        break;
    }
  });
  window.addEventListener('online', function(){ if (!pending) setSync(failed ? 'offline' : 'local'); });
  window.addEventListener('offline', function(){ setSync('offline'); });

  // ---------- tab wiring (own tab; leaves the Intake / Queue switching code untouched) ----------
  var tab = $('tabInventory'), view = $('invView');
  function openInv(){
    var m = document.querySelector('main'); if (m) m.style.display = 'none';
    var q = $('queueView'); if (q) q.hidden = true;
    ['tabIntake', 'tabQueue'].forEach(function(id){ var b = $(id); if (b) b.classList.remove('active'); });
    tab.classList.add('active'); view.hidden = false;
    try { sessionStorage.setItem(VIEW_KEY, '1'); } catch(e){}
    window.scrollTo(0, 0); render();
  }
  function closeInv(){
    view.hidden = true; tab.classList.remove('active');
    try { sessionStorage.setItem(VIEW_KEY, '0'); } catch(e){}
  }
  tab.addEventListener('click', openInv);
  ['tabIntake', 'tabQueue'].forEach(function(id){ var b = $(id); if (b) b.addEventListener('click', closeInv); });

  // ---------- start ----------
  loadLocal();
  render();
  setSync('local');
  try { if (sessionStorage.getItem(VIEW_KEY) === '1') openInv(); } catch(e){}
  pullFromSheet();

window.PhoneFixManager.register('inventory',function(id,value,remove){if(!items.some(r=>r.imei===id))throw new Error('Record no longer exists');const old=items.find(r=>r.imei===id);items=remove?items.filter(r=>r.imei!==id):items.map(r=>r.imei===id?norm(value):r);persist();pushItem(remove?old:items.find(r=>r.imei===id),remove);render();});
})();
