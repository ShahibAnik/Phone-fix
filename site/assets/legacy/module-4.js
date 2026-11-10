
(function(){
  'use strict';
  /* ============ ACCESSORIES inventory (sub-tab of Inventory; SKU-keyed, sheet-synced) ============
     Stock-only: no repair usage, no To Order queue. Section chips are data-driven —
     a new Section value automatically becomes a new sub-tab chip. */
  var $ = function(id){ return document.getElementById(id); };
  var ENDPOINT = 'https://script.google.com/macros/s/AKfycbxI_O5ZtLFcln6GYPgjphmzkji4-VZfeedhd--4Z26u01iNeRZPgpIg16iY5tQ5HHvSJg/exec';
  var ACC_KEY = 'phoneRepairAcc', DIRTY_KEY = 'phoneRepairAccDirty', LISTS_KEY = 'phoneRepairAccLists';

  var BASE_SECTIONS = ['Case', 'Tempered Glass', 'Chargers'];
  var ADD_SECTION = '__ADD_ACC_SECTION__';

  function esc(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
  function readJSON(k, d){ try { var v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch(e){ return d; } }
  function writeJSON(k, v){ try { localStorage.setItem(k, JSON.stringify(v)); } catch(e){} }
  function numOrBlank(v){ if (v === '' || v == null) return ''; var n = parseFloat(String(v).replace(/[^0-9.\-]/g, '')); return isFinite(n) ? n : ''; }
  function todayISO(){ var d = new Date(), p = function(n){ return String(n).padStart(2,'0'); }; return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate()); }
  function fmt$(n){ n = Number(n) || 0; return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function dedupeCI(arr){ var seen = {}, out = []; arr.forEach(function(v){ var k = String(v).toLowerCase(); if (!seen[k]){ seen[k] = 1; out.push(v); } }); return out; }

  var accs = [], sectionF = '', reorderMode = false, editSku = null, delArm = null;

  function loadSecLists(){ var a = readJSON(LISTS_KEY, []); return Array.isArray(a) ? a : []; }
  function saveSecLists(a){ writeJSON(LISTS_KEY, a || []); }
  function listSections(){
    var customs = [];
    loadSecLists().forEach(function(s){ if (s && BASE_SECTIONS.indexOf(s) < 0) customs.push(s); });
    accs.forEach(function(a){ var s = String(a.section || '').trim(); if (s && BASE_SECTIONS.indexOf(s) < 0 && customs.indexOf(s) < 0) customs.push(s); });
    customs.sort(function(a, b){ return a.toLowerCase().localeCompare(b.toLowerCase()); });
    return BASE_SECTIONS.concat(dedupeCI(customs));
  }

  function normAcc(o){
    o = o || {};
    return {
      sku: String(o.sku || o.SKU || '').trim().toUpperCase(),
      brand: String(o.brand || o.Brand || ''),
      model: String(o.model || o.Model || '').trim(),
      section: String(o.section || o.Section || ''),
      color: String(o.color || o.Color || ''),
      qty: Math.max(0, parseInt(o.qty || o.Qty || 0, 10) || 0),
      cost: numOrBlank(o.cost == null ? o.unitCost : o.cost) === '' ? 0 : Number(numOrBlank(o.cost == null ? o.unitCost : o.cost)),
      sup: String(o.sup || o.supplier || o.Supplier || 'PhoneLCDParts'),
      low: Math.max(0, parseInt(o.low == null ? o.lowAt : o.low, 10) || 0),
      notes: String(o.notes || o.Notes || ''),
      date: String(o.date || o.dateAdded || o['Date Added'] || todayISO()).slice(0, 10)
    };
  }
  function accFmtAdded(iso){
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
    if (!m) return String(iso || '');
    return new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }
  function persist(){ writeJSON(ACC_KEY, accs); }
  function load(){ accs = readJSON(ACC_KEY, []).map(normAcc).filter(function(a){ return a.sku; }); }

  /* ---------- dirty tracking (same pattern as parts/phones) ---------- */
  function readDirty(){ try { return JSON.parse(localStorage.getItem(DIRTY_KEY) || '{}') || {}; } catch(e){ return {}; } }
  function writeDirty(m){ try { localStorage.setItem(DIRTY_KEY, JSON.stringify(m)); } catch(e){} }
  function markDirty(sku, deleted){ if(!sku) return; var m = readDirty(); m[sku] = { t: Date.now(), del: !!deleted }; writeDirty(m); }
  function clearDirty(sku, sinceT){ var m = readDirty(); if(m[sku] && m[sku].t <= sinceT){ delete m[sku]; writeDirty(m); } }

  function setSync(s){
    var el = $('acSync'); if(!el) return;
    var map = { local:['#999','local'], syncing:['#b80','syncing'], synced:['#0a0','synced'], offline:['#c00','offline'] };
    var c = map[s] || map.local; el.style.color = c[0]; el.textContent = '\u25CF ' + c[1];
  }

  function pushAcc(a, deleted){
    var body = { recordType: 'accessory', sku: a.sku, brand: a.brand, model: a.model, section: a.section,
      color: a.color, qty: a.qty, cost: a.cost, sup: a.sup, low: a.low, notes: a.notes, date: a.date };
    if (deleted) body.deleted = true;
    markDirty(a.sku, deleted);
    var t0 = Date.now();
    if (!navigator.onLine){ setSync('offline'); return; }
    setSync('syncing');
    fetch(ENDPOINT, { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) })
      .then(function(){ clearDirty(a.sku, t0); setSync('synced'); })
      .catch(function(){ setSync('offline'); });
  }

  /* Heal: a blank field in a sheet row must never wipe a good local value. */
  var HEAL_FIELDS = ['brand','model','section','color','qty','cost','sup','low','notes','date'];
  function healAcc(sheetA, localA){
    if (!localA) return { acc: sheetA, healed: false };
    var out = Object.assign({}, sheetA), healed = false;
    HEAL_FIELDS.forEach(function(f){
      if ((out[f] === '' || out[f] == null) && localA[f] !== '' && localA[f] != null){ out[f] = localA[f]; healed = true; }
    });
    return { acc: out, healed: healed };
  }

  function pullAcc(){
    if (!navigator.onLine){ setSync('offline'); return; }
    setSync('syncing');
    fetch(ENDPOINT + '?action=accessories').then(function(r){ if(!r.ok) throw 0; return r.json(); })
      .then(function(data){
        var arr = Array.isArray(data) ? data : (data && (data.data || data.items || data.rows));
        if (!Array.isArray(arr)) return;
        var map = {}, order = [];
        arr.forEach(function(row){
          if (row && String(row.deleted).toLowerCase() === 'true') return;
          var a = normAcc(row); if (!a.sku) return;
          if (!map[a.sku]) order.push(a.sku); map[a.sku] = a;
        });
        var local = readJSON(ACC_KEY, []);
        if (!order.length && local.length) return; // empty sheet: never wipe local
        var bySku = {}; local.forEach(function(a){ if(a && a.sku) bySku[a.sku] = a; });
        var rePush = [];
        var list = order.map(function(k){
          var h = healAcc(map[k], bySku[k]);
          if (h.healed) rePush.push(h.acc);
          return h.acc;
        });
        var dirty = readDirty();
        Object.keys(dirty).forEach(function(sku){
          var d = dirty[sku], la = bySku[sku];
          if (d.del){ list = list.filter(function(a){ return a.sku !== sku; }); }
          else if (la){
            var idx = -1;
            for (var i = 0; i < list.length; i++) if (list[i].sku === sku){ idx = i; break; }
            if (idx >= 0) list[idx] = la; else list.push(la);
            rePush.push(la);
          }
        });
        accs = list; persist(); setSync('synced'); render();
        var pushed = {};
        rePush.forEach(function(a){ if (a && a.sku && !pushed[a.sku]){ pushed[a.sku] = 1; pushAcc(a, false); } });
      }).catch(function(){ setSync('offline'); });
  }

  /* ---------- render ---------- */
  function isLow(a){ return a.qty <= a.low; }
  function render(){
    // section sub-tab chips
    $('acSections').innerHTML = '<button type="button" class="pt-bchip' + (sectionF === '' ? ' on' : '') + '" data-s="">All</button>' +
      listSections().map(function(s){ return '<button type="button" class="pt-bchip' + (sectionF === s ? ' on' : '') + '" data-s="' + esc(s) + '">' + esc(s) + '</button>'; }).join('');
    // model filter
    var models = {};
    accs.forEach(function(a){ if(!sectionF || a.section === sectionF) models[a.model] = 1; });
    var mf = $('acModelF'), cur = mf.value;
    mf.innerHTML = '<option value="">All models</option>' + Object.keys(models).sort().map(function(m){
      return '<option value="' + esc(m) + '"' + (m === cur ? ' selected' : '') + '>' + esc(m) + '</option>'; }).join('');
    // stats
    var units = 0, cash = 0, low = 0;
    accs.forEach(function(a){ if(sectionF && a.section !== sectionF) return; units += a.qty; cash += a.qty * a.cost; if (isLow(a)) low++; });
    $('acUnits').textContent = units;
    $('acCash').textContent = '$' + Math.round(cash).toLocaleString('en-US');
    $('acLow').textContent = low;
    $('acLowW').className = 'pt-stat' + (low ? ' warn' : '');
    var tc = $('acTabCount'); if (tc) tc.textContent = low ? '(' + low + ' low)' : '';
    // list
    var q = $('acSearch').value.trim().toLowerCase(), fm2 = mf.value;
    var list = accs.filter(function(a){
      return (!sectionF || a.section === sectionF) && (!fm2 || a.model === fm2) &&
        (!q || (a.model + ' ' + a.section + ' ' + (a.brand || '') + ' ' + (a.color || '') + ' ' + a.sku).toLowerCase().indexOf(q) >= 0);
    });
    if (reorderMode){
      var lowAccs = list.filter(isLow);
      $('acList').innerHTML = '<div class="pt-mgroup">\uD83D\uDCCB Reorder list (' + lowAccs.length + ')</div>' +
        (lowAccs.length ? '<div class="pt-toolbar"><button type="button" class="inv-btn ghost" id="acCopy">\u2398 Copy SKUs</button></div>' : '') +
        (lowAccs.map(function(a){
          var sug = Math.max(1, (a.low * 2) - a.qty);
          return '<div class="card pt-card low"><div class="pt-model">' + esc(a.model) + ' <span class="pt-badge lowb">' + a.qty + ' left</span></div>' +
            '<div class="pt-type">' + esc(a.section) + (a.color ? ' \u2022 ' + esc(a.color) : '') + (a.brand ? ' \u2022 ' + esc(a.brand) : '') + '</div>' +
            '<div class="pt-meta">SKU: <b>' + esc(a.sku) + '</b> \u2022 suggest order: <b>' + sug + '</b> \u2022 ' + esc(a.sup) + (a.date ? ' \u2022 Added ' + accFmtAdded(a.date) : '') + '</div>' +
            '<div class="pt-rowbtns" style="align-items:center;margin-top:0.4rem;">' +
            '<input type="number" min="1" data-ra="qty" data-sku="' + esc(a.sku) + '" value="' + sug + '" class="pt-qty-in" style="width:3.5rem;text-align:center;font:inherit;font-weight:800;border:1.5px solid var(--line);border-radius:8px;padding:0.2rem;" aria-label="Qty to order">' +
            '<button type="button" data-ra="add" data-sku="' + esc(a.sku) + '">\u2795 Add to order</button></div></div>';
        }).join('') || '<div class="pt-card"><div class="pt-type">Nothing to reorder. \uD83C\uDF89</div></div>');
      var cp = $('acCopy');
      if (cp) cp.addEventListener('click', function(){
        var txt = [];
        Array.prototype.forEach.call($('acList').querySelectorAll('[data-ra="qty"]'), function(inp){
          txt.push(inp.getAttribute('data-sku') + ' x' + Math.max(1, parseInt(inp.value, 10) || 1));
        });
        if (navigator.clipboard) navigator.clipboard.writeText(txt.join('\n'));
        cp.textContent = 'Copied!';
        setTimeout(function(){ cp.textContent = '\u2398 Copy SKUs'; }, 1500);
      });
      return;
    }
    var byModel = {};
    list.forEach(function(a){ (byModel[a.model] = byModel[a.model] || []).push(a); });
    $('acList').innerHTML = Object.keys(byModel).sort().map(function(m){
      return '<div class="pt-mgroup">' + esc(m) + '</div>' + byModel[m].map(function(a){
        var badge = a.qty === 0 ? '<span class="pt-badge out">out of stock</span>' : (isLow(a) ? '<span class="pt-badge lowb">low stock</span>' : '<span class="pt-badge">in stock</span>');
        return '<div class="pt-card' + (isLow(a) ? ' low' : '') + '">' +
          '<div class="pt-toprow"><div class="pt-titlemain">' +
          '<div class="pt-model">' + esc(a.model) + ' ' + badge + '</div>' +
          '<div class="pt-subtype">' + esc(a.section || 'Accessory') + '</div>' +
          '<div class="pt-type">' + esc(a.brand || '') + (a.color ? ' \u2022 ' + esc(a.color) : '') + '</div>' +
          '</div><div class="pt-price">' + fmt$(a.cost) + '<span> each</span></div></div>' +
          '<div class="pt-meta">SKU: <b>' + esc(a.sku) + '</b> \u2022 value ' + fmt$(a.qty * a.cost) + (a.sup ? ' \u2022 ' + esc(a.sup) : '') + (a.date ? ' \u2022 Added ' + accFmtAdded(a.date) : '') + (a.notes ? '<br>' + esc(a.notes) : '') + '</div>' +
          '<div class="pt-qtyrow"><button type="button" class="pt-step minus" data-a="dec" data-sku="' + esc(a.sku) + '">\u2212</button>' +
          '<div class="pt-qty">' + a.qty + '</div>' +
          '<button type="button" class="pt-step plus" data-a="inc" data-sku="' + esc(a.sku) + '">+</button></div>' +
          '<div class="pt-rowbtns"><button type="button" data-a="edit" data-sku="' + esc(a.sku) + '">\u270F\uFE0F Edit</button>' +
          '<button type="button" data-a="del" data-sku="' + esc(a.sku) + '">' + (delArm === a.sku ? 'Tap again to confirm' : '\uD83D\uDDD1 Delete') + '</button></div></div>';
      }).join('');
    }).join('') || '<div class="pt-card"><div class="pt-type">No accessories yet — tap <b>+ Add accessory</b>.</div></div>';
  }

  function find(sku){ for (var i = 0; i < accs.length; i++) if (accs[i].sku === sku) return accs[i]; return null; }
  function changed(a, deleted){ persist(); pushAcc(a, !!deleted); render(); }

  /* ---------- modal form ---------- */
  function sectionOptions(current){
    var secs = listSections();
    var html = secs.map(function(s){ return '<option' + (s === current ? ' selected' : '') + '>' + esc(s) + '</option>'; }).join('');
    if (current && secs.indexOf(current) < 0) html = '<option selected>' + esc(current) + '</option>' + html;
    return html + '<option value="' + ADD_SECTION + '">+ Add new section&hellip;</option>';
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
    sel.innerHTML = sectionOptions(v);
    return true;
  }
  function openForm(sku){
    editSku = sku || null;
    var a = sku ? find(sku) : null;
    $('acModalTitle').textContent = a ? 'Edit accessory' : 'Add accessory';
    var models = {}, colors = {}, brands = {};
    accs.forEach(function(x){ models[x.model] = 1; if (x.color) colors[x.color] = 1; if (x.brand) brands[x.brand] = 1; });
    var initSection = a ? (a.section || listSections()[0]) : (sectionF || listSections()[0]);
    $('acModalBody').innerHTML =
      '<label>SKU (phonelcdparts) *<input id="afSku" class="inv-in" placeholder="e.g. 1246-DSC-BLK" value="' + esc(a ? a.sku : '') + '"' + (a ? ' disabled' : '') + '></label>' +
      '<div class="row2"><div><label>Brand<input id="afBrand" class="inv-in" list="afBrands" placeholder="e.g. Toocki" value="' + esc(a ? a.brand : '') + '"></label>' +
      '<datalist id="afBrands">' + Object.keys(brands).sort().map(function(b){ return '<option value="' + esc(b) + '">'; }).join('') + '</datalist></div>' +
      '<div><label>Model (fits) *<input id="afModel" class="inv-in" list="afModels" placeholder="e.g. iPad 10" value="' + esc(a ? a.model : '') + '"></label>' +
      '<datalist id="afModels">' + Object.keys(models).sort().map(function(m){ return '<option value="' + esc(m) + '">'; }).join('') + '</datalist></div></div>' +
      '<div class="row2"><div><label>Section (sub-tab)<select id="afSection" class="inv-in">' + sectionOptions(initSection) + '</select></label></div>' +
      '<div><label>Color<input id="afColor" class="inv-in" list="afColors" placeholder="e.g. Black" value="' + esc(a ? (a.color || '') : '') + '"></label>' +
      '<datalist id="afColors">' + Object.keys(colors).sort().map(function(c){ return '<option value="' + esc(c) + '">'; }).join('') + '</datalist></div></div>' +
      '<div class="row2"><div><label>Qty<input id="afQty" class="inv-in" type="number" min="0" value="' + (a ? a.qty : 1) + '"></label></div>' +
      '<div><label>Unit cost $<input id="afCost" class="inv-in" type="number" min="0" step="0.01" value="' + (a ? a.cost : '') + '"></label></div></div>' +
      '<div class="row2"><div><label>Low-stock at<input id="afLow" class="inv-in" type="number" min="0" value="' + (a ? a.low : 2) + '"></label></div>' +
      '<div><label>Supplier<input id="afSup" class="inv-in" value="' + esc(a ? a.sup : 'PhoneLCDParts') + '"></label></div></div>' +
      '<label>Notes<input id="afNotes" class="inv-in" placeholder="optional" value="' + esc(a ? a.notes : '') + '"></label>' +
      '<div class="acts" style="display:flex;gap:0.5rem;margin-top:0.9rem;"><button type="button" class="inv-btn ghost" id="afCancel" style="flex:1;">Cancel</button>' +
      '<button type="button" class="inv-btn primary" id="afSave" style="flex:2;">Save accessory</button></div>';
    $('afSection').addEventListener('focus', function(){ this.dataset.prev = this.value; });
    $('afSection').addEventListener('change', function(){ onAddSection(this); });
    $('afCancel').addEventListener('click', function(){ $('acOverlay').hidden = true; });
    $('afSave').addEventListener('click', saveForm);
    $('acOverlay').hidden = false;
  }
  function saveForm(){
    var sku = $('afSku').value.trim().toUpperCase();
    var model = $('afModel').value.trim();
    if (!sku){ alert('SKU is required'); return; }
    if (!model){ alert('Model is required'); return; }
    if (!editSku && find(sku)){ alert('This SKU is already in your accessories. Use Edit instead.'); return; }
    var a = editSku ? find(editSku) : { sku: sku, date: todayISO() };
    if (!a) return;
    a.brand = $('afBrand').value.trim(); a.model = model;
    var secVal = $('afSection').value;
    a.section = (secVal && secVal !== ADD_SECTION) ? secVal : listSections()[0];
    a.qty = Math.max(0, parseInt($('afQty').value, 10) || 0);
    var c = numOrBlank($('afCost').value); a.cost = c === '' ? 0 : Number(c);
    a.sup = $('afSup').value.trim() || 'PhoneLCDParts';
    a.low = Math.max(0, parseInt($('afLow').value, 10) || 0);
    a.notes = $('afNotes').value.trim();
    a.color = $('afColor').value.trim();
    if (!editSku) accs.unshift(a);
    editSku = null;
    $('acOverlay').hidden = true;
    changed(a, false);
  }

  /* ---------- events ---------- */
  $('acSections').addEventListener('click', function(e){
    var c = e.target.closest('.pt-bchip'); if (!c) return;
    sectionF = c.getAttribute('data-s'); render();
  });
  $('acSearch').addEventListener('input', render);
  $('acModelF').addEventListener('change', render);
  $('acAdd').addEventListener('click', function(){ openForm(null); });
  $('acModalClose').addEventListener('click', function(){ $('acOverlay').hidden = true; editSku = null; });
  $('acOverlay').addEventListener('click', function(e){ if (e.target === $('acOverlay')){ $('acOverlay').hidden = true; editSku = null; } });
  $('acReorder').addEventListener('click', function(){
    reorderMode = !reorderMode;
    $('acReorder').innerHTML = reorderMode ? '\uD83D\uDD19 Back to accessories' : '\uD83D\uDCCB Reorder list';
    render();
  });
  $('acList').addEventListener('click', function(e){
    var b = e.target.closest('button'); if (!b) return;
    /* Accessories reorder list: manual qty + "Add to order" (shared To Order queue). */
    var ra = b.getAttribute('data-ra');
    if (ra === 'add'){
      var rsku = b.getAttribute('data-sku');
      var rcard = b.closest('.pt-card');
      var qinp = rcard ? rcard.querySelector('[data-ra="qty"]') : null;
      var rq = Math.max(1, parseInt(qinp && qinp.value, 10) || 1);
      if (typeof window.__invAddToOrder === 'function') window.__invAddToOrder(rsku, rq);
      var oldT = b.textContent; b.textContent = 'Added \u2713';
      setTimeout(function(){ b.textContent = oldT; }, 1200);
      return;
    }
    var sku = b.getAttribute('data-sku'), act = b.getAttribute('data-a');
    var a = find(sku); if (!a) return;
    if (act === 'inc'){ a.qty++; changed(a, false); }
    else if (act === 'dec'){ a.qty = Math.max(0, a.qty - 1); changed(a, false); }
    else if (act === 'edit'){ openForm(sku); }
    else if (act === 'del'){
      if (delArm === sku){
        accs = accs.filter(function(x){ return x.sku !== sku; });
        delArm = null; persist(); pushAcc({ sku: sku }, true); render();
      } else { delArm = sku; setTimeout(function(){ delArm = null; render(); }, 3000); render(); }
    }
  });

  /* ---------- exposed: tab show, master search ---------- */
  window.__accShow = function(){ render(); pullAcc(); };
  window.__invAccList = function(){ return accs.map(function(a){ return Object.assign({}, a); }); };
  window.__invJumpToAcc = function(sku){
    if (typeof window.__invShowTab === 'function') window.__invShowTab('acc');
    sectionF = '';
    var mf = $('acModelF'); if (mf) mf.value = '';
    var s = $('acSearch'); if (s) s.value = sku || '';
    render();
    setTimeout(function(){
      var btn = document.querySelector('#acList [data-sku="' + cssEscAcc(sku) + '"]');
      var card = btn ? btn.closest('.pt-card') : null;
      if (card){ card.scrollIntoView({ behavior: 'smooth', block: 'center' }); flashAccCard(card); }
    }, 100);
  };
  function cssEscAcc(s){ return (window.CSS && CSS.escape) ? CSS.escape(String(s)) : String(s); }
  function flashAccCard(el){
    if (!el) return;
    el.classList.remove('flash-link'); void el.offsetWidth; el.classList.add('flash-link');
    setTimeout(function(){ el.classList.remove('flash-link'); }, 1800);
  }

  /* ---------- init ---------- */
  load(); render(); setSync('local'); pullAcc();

window.PhoneFixManager.register('accessories',function(id,value,remove){const old=accs.find(r=>r.sku===id);if(!old)throw new Error('Record no longer exists');accs=remove?accs.filter(r=>r.sku!==id):accs.map(r=>r.sku===id?normAcc(value):r);persist();pushAcc(remove?old:accs.find(r=>r.sku===id),remove);render();});
})();
