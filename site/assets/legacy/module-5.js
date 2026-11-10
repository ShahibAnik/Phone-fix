
(function(){
  'use strict';
  /* ============ INVENTORY MASTER SEARCH (Phones + Parts, inventory only) ============ */
  var $ = function(id){ return document.getElementById(id); };
  function esc(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
  function cssEsc(s){ return (window.CSS && CSS.escape) ? CSS.escape(String(s)) : String(s); }
  function mark(text, q){
    var raw = String(text == null ? '' : text), low = raw.toLowerCase(), ql = String(q).toLowerCase(), out = '', i = 0, idx;
    if (!ql) return esc(raw);
    while ((idx = low.indexOf(ql, i)) !== -1){
      out += esc(raw.slice(i, idx)) + '<mark>' + esc(raw.slice(idx, idx + q.length)) + '</mark>';
      i = idx + q.length;
    }
    return out + esc(raw.slice(i));
  }
  function flashCard(el){
    if (!el) return;
    el.classList.remove('flash-link'); void el.offsetWidth; el.classList.add('flash-link');
    setTimeout(function(){ el.classList.remove('flash-link'); }, 1800);
  }
  function readPhones(){ try { var v = JSON.parse(localStorage.getItem('phoneRepairInventory') || '[]'); return Array.isArray(v) ? v : []; } catch(e){ return []; } }
  function readParts(){ try { return (typeof window.__invPartsList === 'function') ? window.__invPartsList() : []; } catch(e){ return []; } }
  function readAccs(){ try { return (typeof window.__invAccList === 'function') ? window.__invAccList() : []; } catch(e){ return []; } }

  var items = [], active = -1;
  function open(){
    $('invSearchOverlay').hidden = false;
    var inp = $('invSearchInput'); inp.value = '';
    $('invSearchClear').hidden = true;
    renderResults(null);
    setTimeout(function(){ inp.focus(); }, 30);
  }
  function close(){ $('invSearchOverlay').hidden = true; items = []; active = -1; }
  function runSearch(rawQ){
    var q = rawQ.trim().toLowerCase();
    if (q.length < 2) return null;
    var qd = q.replace(/\D/g, '');
    var phoneHit = function(p){ return !!qd && String(p || '').replace(/\D/g, '').indexOf(qd) !== -1; };
    var has = function(){
      for (var i = 0; i < arguments.length; i++){
        var v = arguments[i];
        if (v != null && String(v).toLowerCase().indexOf(q) !== -1) return true;
      }
      return false;
    };
    var phones = readPhones().filter(function(it){
      return has(it.imei, it.name, it.dealer, it.status, it.custName, it.layCustomer, it.storage) || phoneHit(it.custPhone) || phoneHit(it.layPhone);
    }).slice(0, 8);
    var parts = readParts().filter(function(p){
      return has(p.sku, p.brand, p.model, p.type, p.grade, p.color, p.sup);
    }).slice(0, 8);
    var accs = readAccs().filter(function(a){
      return has(a.sku, a.brand, a.model, a.section, a.color, a.sup);
    }).slice(0, 8);
    return { phones: phones, parts: parts, accs: accs, q: rawQ.trim() };
  }
  function renderResults(res){
    items = []; active = -1;
    var box = $('invSearchResults');
    if (!res){ box.innerHTML = '<div class="ms-empty">Type to search phones, parts &amp; accessories&hellip;</div>'; return; }
    var q = res.q, html = '';
    if (res.phones.length){
      html += '<div class="ms-group"><div class="ms-gtitle">Phones</div>' + res.phones.map(function(it){
        items.push({ kind: 'phone', imei: it.imei });
        var n = items.length - 1;
        var sub = [it.imei, it.status, it.dealer, it.custName].filter(Boolean).join(' \u00B7 ');
        return '<button type="button" class="ms-item" data-idx="' + n + '"><span class="ms-main"><span class="ms-t">' + mark(it.name || 'Phone', q) + '</span><span class="ms-s mono">' + mark(sub, q) + '</span></span></button>';
      }).join('') + '</div>';
    }
    if (res.parts.length){
      html += '<div class="ms-group"><div class="ms-gtitle">Parts</div>' + res.parts.map(function(p){
        items.push({ kind: 'part', sku: p.sku });
        var n = items.length - 1;
        var sub = [p.sku, p.type, p.grade, p.color, ('qty ' + p.qty)].filter(Boolean).join(' \u00B7 ');
        return '<button type="button" class="ms-item" data-idx="' + n + '"><span class="ms-main"><span class="ms-t">' + mark((p.brand ? p.brand + ' ' : '') + p.model, q) + '</span><span class="ms-s mono">' + mark(sub, q) + '</span></span></button>';
      }).join('') + '</div>';
    }
    if (res.accs.length){
      html += '<div class="ms-group"><div class="ms-gtitle">Accessories</div>' + res.accs.map(function(a){
        items.push({ kind: 'acc', sku: a.sku });
        var n = items.length - 1;
        var sub = [a.sku, a.section, a.color, ('qty ' + a.qty)].filter(Boolean).join(' \u00B7 ');
        return '<button type="button" class="ms-item" data-idx="' + n + '"><span class="ms-main"><span class="ms-t">' + mark((a.brand ? a.brand + ' ' : '') + a.model, q) + '</span><span class="ms-s mono">' + mark(sub, q) + '</span></span></button>';
      }).join('') + '</div>';
    }
    if (!html) html = '<div class="ms-empty">No inventory matches for &ldquo;' + esc(q) + '&rdquo;</div>';
    box.innerHTML = html;
  }
  function setActive(n){
    var els = $('invSearchResults').querySelectorAll('.ms-item');
    active = n;
    els.forEach(function(el, i){ el.classList.toggle('active', i === n); });
    if (els[n]) els[n].scrollIntoView({ block: 'nearest' });
  }
  function pick(sel){
    if (!sel) return;
    close();
    if (sel.kind === 'part'){
      if (typeof window.__invJumpToPart === 'function') window.__invJumpToPart(sel.sku);
      return;
    }
    if (sel.kind === 'acc'){
      if (typeof window.__invJumpToAcc === 'function') window.__invJumpToAcc(sel.sku);
      return;
    }
    // Phone: Phones sub-tab, All filter, IMEI in the phone search, then flash the card.
    var sub = $('invSubPhones'); if (sub) sub.click();
    var all = document.querySelector('#invChips [data-filter="all"]'); if (all) all.click();
    var q = $('invSearch'); if (q){ q.value = sel.imei || ''; q.dispatchEvent(new Event('input', { bubbles: true })); }
    setTimeout(function(){
      var card = document.querySelector('.inv-card[data-imei="' + cssEsc(sel.imei) + '"]');
      if (card){ card.scrollIntoView({ behavior: 'smooth', block: 'center' }); flashCard(card); }
    }, 150);
  }
  $('invMasterBtn').addEventListener('click', open);
  $('invSearchClose').addEventListener('click', close);
  $('invSearchOverlay').addEventListener('click', function(e){ if (e.target === $('invSearchOverlay')) close(); });
  $('invSearchInput').addEventListener('input', function(){
    $('invSearchClear').hidden = !this.value;
    renderResults(runSearch(this.value));
  });
  $('invSearchInput').addEventListener('keydown', function(e){
    if (e.key === 'ArrowDown'){ e.preventDefault(); if (items.length) setActive((active + 1) % items.length); }
    else if (e.key === 'ArrowUp'){ e.preventDefault(); if (items.length) setActive((active - 1 + items.length) % items.length); }
    else if (e.key === 'Enter'){ e.preventDefault(); if (active >= 0) pick(items[active]); else if (items.length) pick(items[0]); }
    else if (e.key === 'Escape'){ e.preventDefault(); close(); }
  });
  $('invSearchClear').addEventListener('click', function(){
    var inp = $('invSearchInput'); inp.value = ''; this.hidden = true; renderResults(null); inp.focus();
  });
  $('invSearchResults').addEventListener('click', function(e){
    var b = e.target.closest('[data-idx]'); if (!b) return;
    pick(items[parseInt(b.getAttribute('data-idx'), 10)]);
  });
})();
