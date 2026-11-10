
(function(){
  'use strict';
  var $ = function(id){ return document.getElementById(id); };
  function esc(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
  function readArr(k){ try { var v = JSON.parse(localStorage.getItem(k) || '[]'); return Array.isArray(v) ? v : []; } catch(e){ return []; } }
  function readObj(k){ try { var v = JSON.parse(localStorage.getItem(k) || '{}'); return (v && typeof v === 'object') ? v : {}; } catch(e){ return {}; } }
  function money(n){ return '$' + (Math.round((+n || 0) * 100) / 100).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 }); }
  function countUp(el, target, isMoney){
    if (!el) return;
    var t0 = Date.now(), dur = 750;
    function step(){
      var p = Math.min(1, (Date.now() - t0) / dur), e = 1 - Math.pow(1 - p, 3);
      var v = target * e;
      el.textContent = isMoney ? money(v) : Math.round(v).toLocaleString();
      if (p < 1) requestAnimationFrame(step);
    }
    step();
  }

  var kpiDayOffset = 0; // 0 = today, -1 = yesterday... (Revenue/Tickets day stepper)
  function renderHome(animate){
    var records = readArr('phoneRepairIntakes');
    var profiles = readObj('phoneRepairCustomerProfiles');
    var items = readArr('phoneRepairInventory');
    var parts = readArr('phoneRepairParts');

    var totalRevenue = 0, collected = 0, dueAmt = 0, dueCount = 0;
    var inShop = 0, ready = 0, delivered = 0;
    var custSet = {};
    var todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    var dayStart = new Date(todayStart.getTime() + kpiDayOffset * 86400000);
    var dayEnd = new Date(dayStart.getTime() + 86400000);
    var todayTickets = 0, todayRevenue = 0;
    var days = [], dayIdx = {};
    for (var d = 13; d >= 0; d--){
      var dt = new Date(todayStart.getTime() - d * 86400000);
      var key = dt.getFullYear() + '-' + dt.getMonth() + '-' + dt.getDate();
      dayIdx[key] = days.length;
      days.push({ n: 0, label: (dt.getMonth() + 1) + '/' + dt.getDate() });
    }
    var techs = {}, devices = {};
    records.forEach(function(r){
      var p = parseFloat(r.price) || 0;
      totalRevenue += p;
      if (r.isPaid) collected += p; else { dueAmt += p; dueCount++; }
      if (r.customerId) custSet[r.customerId] = 1;
      if (r.isDelivered) delivered++;
      else { inShop++; if (r.queueStatus === 'ready') ready++; }
      var ca = +r.createdAt || 0;
      if (ca >= dayStart.getTime() && ca < dayEnd.getTime()){ todayTickets++; todayRevenue += p; }
      if (ca){
        var cd = new Date(ca), ck = cd.getFullYear() + '-' + cd.getMonth() + '-' + cd.getDate();
        if (ck in dayIdx) days[dayIdx[ck]].n++;
      }
      var tb = (r.fixedBy || '').trim();
      if (tb){ if (!techs[tb]) techs[tb] = { n: 0, rev: 0 }; techs[tb].n++; techs[tb].rev += p; }
      var dv = (r.device || '').trim();
      if (dv){ devices[dv] = (devices[dv] || 0) + 1; }
    });
    var custCount = Object.keys(profiles).length || Object.keys(custSet).length;

    // hero
    if (animate){
      countUp($('hmTotRepairs'), records.length, false);
      countUp($('hmTotRevenue'), totalRevenue, true);
      countUp($('hmTotCustomers'), custCount, false);
    } else {
      $('hmTotRepairs').textContent = records.length.toLocaleString();
      $('hmTotRevenue').textContent = money(totalRevenue);
      $('hmTotCustomers').textContent = custCount.toLocaleString();
    }
    // kpis
    $('hmTodayTickets').textContent = todayTickets.toLocaleString();
    $('hmTodayRevenue').textContent = money(todayRevenue);
    var dayShort = dayStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    var tLbl = $('hmTicketsLbl'); if (tLbl) tLbl.textContent = kpiDayOffset === 0 ? 'Tickets today' : 'Tickets · ' + dayShort;
    var rLbl = $('hmRevenueLbl'); if (rLbl) rLbl.textContent = kpiDayOffset === 0 ? 'Revenue today' : 'Revenue · ' + dayShort;
    var dLbl = $('hmDayLabel'); if (dLbl) dLbl.textContent = kpiDayOffset === 0 ? 'Today' : dayStart.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) + (dayStart.getFullYear() !== new Date().getFullYear() ? ', ' + dayStart.getFullYear() : '');
    var dNx = $('hmDayNext'); if (dNx) dNx.disabled = kpiDayOffset >= 0;
    var dTd = $('hmDayToday'); if (dTd) dTd.hidden = kpiDayOffset === 0;
    $('hmInShop').textContent = inShop.toLocaleString();
    $('hmReady').textContent = ready.toLocaleString();
    $('hmCollected').textContent = money(collected);
    $('hmDue').textContent = money(dueAmt) + (dueCount ? ' · ' + dueCount : '');

    // bars
    var max = 1; days.forEach(function(x){ if (x.n > max) max = x.n; });
    $('hmBars').innerHTML = days.map(function(x){
      var h = Math.max(4, Math.round(x.n / max * 100));
      return '<div class="hm-bar"><b>' + (x.n || '') + '</b><i style="height:' + h + '%"></i><span>' + x.label + '</span></div>';
    }).join('');

    // donut: delivered (green) / ready (amber) / in shop (blue)
    var total = records.length || 1;
    var pD = delivered / total * 100, pR = ready / total * 100, pI = Math.max(0, 100 - pD - pR);
    var donut = $('hmDonut');
    donut.style.background = 'conic-gradient(#1F6F5C 0 ' + pD + '%, #F5A623 ' + pD + '% ' + (pD + pR) + '%, #2C5C8A ' + (pD + pR) + '% 100%)';
    donut.setAttribute('data-total', records.length.toLocaleString());
    $('hmLegend').innerHTML =
      '<div><span class="hm-dot" style="background:#1F6F5C"></span>Delivered — <b>' + delivered.toLocaleString() + '</b></div>' +
      '<div><span class="hm-dot" style="background:#F5A623"></span>Ready — <b>' + ready.toLocaleString() + '</b></div>' +
      '<div><span class="hm-dot" style="background:#2C5C8A"></span>In shop — <b>' + inShop.toLocaleString() + '</b></div>';

    // techs
    var tArr = Object.keys(techs).map(function(k){ return { name: k, n: techs[k].n, rev: techs[k].rev }; })
      .sort(function(a, b){ return b.n - a.n; }).slice(0, 6);
    $('hmTechs').innerHTML = tArr.length ? tArr.map(function(t){
      return '<div class="hm-row"><span class="l">' + esc(t.name) + '</span><span class="r">' + t.n + ' phones · ' + money(t.rev) + '</span></div>';
    }).join('') : '<div class="hm-empty">No technician data yet.</div>';

    // devices
    var dArr = Object.keys(devices).map(function(k){ return { name: k, n: devices[k] }; })
      .sort(function(a, b){ return b.n - a.n; }).slice(0, 6);
    $('hmDevices').innerHTML = dArr.length ? dArr.map(function(t){
      return '<div class="hm-row"><span class="l">' + esc(t.name) + '</span><span class="r">' + t.n + ' repairs</span></div>';
    }).join('') : '<div class="hm-empty">No device data yet.</div>';

    // inventory
    var units = 0, stockValue = 0, soldN = 0, profit = 0;
    items.forEach(function(it){
      var q = parseFloat(it.qty) || 1, bp = parseFloat(it.price) || 0, sp = parseFloat(it.soldPrice);
      if (isFinite(sp) && sp > 0){ soldN++; profit += (sp - bp); }
      else { units += q; stockValue += bp * q; }
    });
    $('hmInv').innerHTML =
      '<div class="hm-row"><span class="l">Phones in stock</span><span class="r">' + units.toLocaleString() + '</span></div>' +
      '<div class="hm-row"><span class="l">Stock value (at cost)</span><span class="r">' + money(stockValue) + '</span></div>' +
      '<div class="hm-row"><span class="l">Phones sold</span><span class="r">' + soldN.toLocaleString() + '</span></div>' +
      '<div class="hm-row"><span class="l">Profit on sold</span><span class="r">' + money(profit) + '</span></div>';

    // low parts
    var low = parts.filter(function(p){ var q = parseFloat(p.qty) || 0, l = parseFloat(p.low) || 0; return l > 0 && q <= l; })
      .sort(function(a, b){ return (parseFloat(a.qty) || 0) - (parseFloat(b.qty) || 0); }).slice(0, 6);
    $('hmLow').innerHTML = low.length ? low.map(function(p){
      var nm = [p.brand, p.model, p.type].filter(Boolean).join(' · ') || p.sku || 'Part';
      return '<div class="hm-row"><span class="l">' + esc(nm) + '</span><span class="r">' + (parseFloat(p.qty) || 0) + ' left</span></div>';
    }).join('') : '<div class="hm-empty">Nothing running low. 👍</div>';

    $('hmUpdated').textContent = 'Updated ' + new Date().toLocaleTimeString() + ' · refreshes automatically';
    renderCal();
  }

  // ---- calendar: fixes & collected by day (Month / Week / Day / Agenda) ----
  var CAL_VIEWS = ['month', 'week', 'day', 'agenda'];
  var CAL_MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  var CAL_DOW = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  function dkey(d){ return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function parseKey(k){ var p = String(k).split('-'); return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2])); }
  var calView = 'month';
  try { var _cv = localStorage.getItem('phoneFixCalView'); if (CAL_VIEWS.indexOf(_cv) >= 0) calView = _cv; } catch(e){}
  var calCursor = new Date(); calCursor.setHours(0, 0, 0, 0);
  var calSel = dkey(calCursor);
  function deliveredKey(r){
    if (!r || !r.isDelivered) return null;
    var s = String(r.deliveredDay || '');
    if (/^\d{8}$/.test(s)) return s.slice(0, 4) + '-' + s.slice(4, 6) + '-' + s.slice(6, 8);
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
    var t = Date.parse(r.deliveredAt || r.statusChangedAt || '');
    return isNaN(t) ? null : dkey(new Date(t));
  }
  function calDayMap(){
    var map = {};
    function slot(k){ if (!map[k]) map[k] = { fixes: 0, collected: 0, due: 0, intakes: 0, tickets: [], techs: {} }; return map[k]; }
    readArr('phoneRepairIntakes').forEach(function(r){
      if (!r) return;
      if (r.createdAt) { var cd = new Date(r.createdAt); if (!isNaN(cd)) slot(dkey(cd)).intakes++; }
      var k = deliveredKey(r); if (!k) return;
      var s = slot(k);
      var amt = Number(r.totalAmount != null ? r.totalAmount : r.price) || 0;
      s.fixes++;
      if (r.isPaid) s.collected += amt; else s.due += amt;
      s.tickets.push(r);
      var tech = r.fixedBy || '—'; s.techs[tech] = (s.techs[tech] || 0) + 1;
    });
    return map;
  }
  function calTopTech(s){ var best = '', n = 0; Object.keys(s.techs).forEach(function(t){ if (s.techs[t] > n) { n = s.techs[t]; best = t; } }); return best; }
  function calHeat(v, max){ if (!v || !max) return ''; var p = v / max; return p > 0.75 ? ' heat4' : p > 0.5 ? ' heat3' : p > 0.25 ? ' heat2' : ' heat1'; }
  function calNiceDay(k){ var d = parseKey(k); return CAL_DOW[d.getDay()] + ', ' + CAL_MONTHS[d.getMonth()].slice(0, 3) + ' ' + d.getDate(); }
  function calSummaryFor(map, keys, label){
    var f = 0, c = 0, du = 0, active = 0, bestK = '', bestV = 0;
    keys.forEach(function(k){ var s = map[k]; if (!s) return; f += s.fixes; c += s.collected; du += s.due; if (s.fixes) active++; if (s.collected > bestV) { bestV = s.collected; bestK = k; } });
    return '<span>' + esc(label) + '</span><span>Fixes <b>' + f + '</b></span><span>Collected <b>' + money(c) + '</b></span><span>Avg / active day <b>' + money(active ? c / active : 0) + '</b></span>'
      + (bestK ? '<span>Best day <b>' + esc(calNiceDay(bestK)) + ' (' + money(bestV) + ')</b></span>' : '')
      + (du ? '<span>Still due <b>' + money(du) + '</b></span>' : '');
  }
  function calTicketRow(r){
    var amt = Number(r.totalAmount != null ? r.totalAmount : r.price) || 0;
    return '<div class="hm-cal-ticket"><span><span class="tk" data-ticket="' + esc(r.id) + '">' + esc(r.name || '—') + '</span> · ' + esc(r.device || '') + '</span><span>'
      + (r.fixedBy ? '🔧 ' + esc(r.fixedBy) + ' · ' : '') + '<b>' + money(amt) + '</b> '
      + (r.isPaid ? '<span style="color:#1E9E6A;font-weight:700;">PAID</span>' : '<span style="color:#B3261E;font-weight:700;">DUE</span>') + '</span></div>';
  }
  function renderCalDetail(map){
    var el = $('hmCalDetail'); if (!el) return;
    var s = map[calSel];
    var head = '<div><b>' + esc(calNiceDay(calSel)) + '</b> — ' + (s && s.fixes
      ? s.fixes + ' fix' + (s.fixes === 1 ? '' : 'es') + ' · ' + money(s.collected) + ' collected · ' + money(s.due) + ' still due · ' + s.intakes + ' taken in'
      : 'no repairs delivered this day · ' + (s ? s.intakes : 0) + ' taken in') + '</div>';
    var list = '';
    if (calView !== 'day' && s && s.tickets.length) list = s.tickets.map(calTicketRow).join('');
    el.innerHTML = head + list;
  }
  function renderCal(){
    var body = $('hmCalBody'); if (!body) return;
    var map = calDayMap();
    var todayK = dkey(new Date());
    var vb = $('hmCalViews');
    if (vb) Array.prototype.forEach.call(vb.querySelectorAll('button'), function(b){ b.classList.toggle('on', b.dataset.calview === calView); });
    var title = '', sumHtml = '', html = '';
    if (calView === 'month'){
      var y = calCursor.getFullYear(), m = calCursor.getMonth();
      title = CAL_MONTHS[m] + ' ' + y;
      var first = new Date(y, m, 1);
      var start = new Date(y, m, 1 - first.getDay());
      var keys = [], maxC = 0, bestK = '', bestV = 0;
      for (var i = 0; i < 42; i++){
        var d0 = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
        var k0 = dkey(d0); keys.push(k0);
        var s0 = map[k0];
        if (s0 && s0.collected > maxC) maxC = s0.collected;
        if (s0 && d0.getMonth() === m && s0.collected > bestV) { bestV = s0.collected; bestK = k0; }
      }
      html = '<div class="hm-cal-grid">' + CAL_DOW.map(function(dn){ return '<div class="hm-cal-dow">' + dn + '</div>'; }).join('') + '<div class="hm-cal-dow">WEEK</div>';
      for (var r2 = 0; r2 < 6; r2++){
        var wkF = 0, wkC = 0;
        for (var c2 = 0; c2 < 7; c2++){
          var dd = new Date(start.getFullYear(), start.getMonth(), start.getDate() + r2 * 7 + c2);
          var kk = dkey(dd), ss = map[kk];
          if (ss) { wkF += ss.fixes; wkC += ss.collected; }
          var cls = 'hm-cal-cell' + (dd.getMonth() !== m ? ' dim' : '') + (kk === todayK ? ' today' : '') + (kk === calSel ? ' sel' : '') + (ss ? calHeat(ss.collected, maxC) : '');
          html += '<div class="' + cls + '" data-day="' + kk + '"><div class="hm-cal-dnum"><span>' + dd.getDate() + '</span>' + (kk === bestK ? '<span>🏆</span>' : '') + '</div>'
            + (ss && ss.fixes ? '<div class="hm-cal-fix">' + ss.fixes + ' fix' + (ss.fixes === 1 ? '' : 'es') + '</div><div class="hm-cal-money">' + money(ss.collected) + '</div>' : '')
            + '</div>';
        }
        html += '<div class="hm-cal-wk"><b>' + wkF + ' fixes</b><span>' + money(wkC) + '</span></div>';
      }
      html += '</div>';
      sumHtml = calSummaryFor(map, keys.filter(function(k){ return parseKey(k).getMonth() === m; }), CAL_MONTHS[m] + ' ' + y);
    } else if (calView === 'week'){
      var ws = new Date(calCursor); ws.setDate(ws.getDate() - ws.getDay());
      var we = new Date(ws); we.setDate(we.getDate() + 6);
      title = CAL_MONTHS[ws.getMonth()].slice(0, 3) + ' ' + ws.getDate() + ' – ' + CAL_MONTHS[we.getMonth()].slice(0, 3) + ' ' + we.getDate() + ', ' + we.getFullYear();
      var wkeys = [];
      html = '<div class="hm-cal-week">';
      for (var wi = 0; wi < 7; wi++){
        var wd = new Date(ws.getFullYear(), ws.getMonth(), ws.getDate() + wi);
        var wk2 = dkey(wd); wkeys.push(wk2);
        var wss = map[wk2];
        html += '<div class="hm-cal-wcell' + (wk2 === todayK ? ' today' : '') + (wk2 === calSel ? ' sel' : '') + '" data-day="' + wk2 + '">'
          + '<div class="hm-cal-dnum"><span>' + CAL_DOW[wd.getDay()] + ' ' + wd.getDate() + '</span></div>'
          + (wss && wss.fixes
            ? '<div class="hm-cal-fix">' + wss.fixes + ' fixes</div><div class="hm-cal-money">' + money(wss.collected) + '</div>'
              + (wss.due ? '<div style="font-size:0.75rem;color:#B3261E;font-weight:700;">' + money(wss.due) + ' due</div>' : '')
              + '<div style="font-size:0.75rem;color:var(--ink-soft);">Top tech: ' + esc(calTopTech(wss)) + '</div>'
            : '<div style="font-size:0.78rem;color:var(--ink-soft);">No fixes</div>')
          + '</div>';
      }
      html += '</div>';
      sumHtml = calSummaryFor(map, wkeys, 'This week');
    } else if (calView === 'day'){
      var dk = dkey(calCursor);
      calSel = dk;
      title = calNiceDay(dk) + ', ' + calCursor.getFullYear();
      var ds = map[dk];
      html = '<div>' + (ds && ds.tickets.length ? ds.tickets.map(calTicketRow).join('') : '<div class="hm-empty">No repairs delivered this day.</div>') + '</div>';
      sumHtml = calSummaryFor(map, [dk], calNiceDay(dk));
    } else {
      title = 'Agenda — all activity';
      var akeys = Object.keys(map).filter(function(k){ return map[k].fixes > 0; }).sort().reverse();
      html = akeys.length ? akeys.map(function(k){ var s = map[k]; return '<div class="hm-cal-agenda-row" data-day="' + k + '"><span><b>' + esc(calNiceDay(k)) + '</b></span><span>' + s.fixes + ' fixes · <b>' + money(s.collected) + '</b>' + (s.due ? ' · ' + money(s.due) + ' due' : '') + '</span></div>'; }).join('') : '<div class="hm-empty">No deliveries recorded yet.</div>';
      sumHtml = calSummaryFor(map, akeys, 'All time');
    }
    $('hmCalTitle').textContent = title;
    $('hmCalSummary').innerHTML = sumHtml;
    body.innerHTML = html;
    renderCalDetail(map);
    calFillSelects();
  }
  function calFillSelects(){
    var ms = $('hmCalMonthSel'), ys = $('hmCalYearSel'); if (!ms || !ys) return;
    if (!ms.options.length) CAL_MONTHS.forEach(function(mn, i){ var o = document.createElement('option'); o.value = String(i); o.textContent = mn; ms.appendChild(o); });
    var yrs = {};
    readArr('phoneRepairIntakes').forEach(function(r){
      if (r && r.createdAt) { var d = new Date(r.createdAt); if (!isNaN(d)) yrs[d.getFullYear()] = 1; }
      var dk2 = deliveredKey(r); if (dk2) yrs[Number(dk2.slice(0, 4))] = 1;
    });
    yrs[new Date().getFullYear()] = 1; yrs[calCursor.getFullYear()] = 1;
    ys.innerHTML = '';
    Object.keys(yrs).sort().forEach(function(yy){ var o = document.createElement('option'); o.value = yy; o.textContent = yy; ys.appendChild(o); });
    ms.value = String(calCursor.getMonth());
    ys.value = String(calCursor.getFullYear());
  }
  function calShift(dir){
    if (calView === 'month' || calView === 'agenda'){
      var d = calCursor.getDate();
      calCursor.setDate(1); calCursor.setMonth(calCursor.getMonth() + dir);
      var last = new Date(calCursor.getFullYear(), calCursor.getMonth() + 1, 0).getDate();
      calCursor.setDate(Math.min(d, last));
    } else if (calView === 'week') calCursor.setDate(calCursor.getDate() + 7 * dir);
    else { calCursor.setDate(calCursor.getDate() + dir); calSel = dkey(calCursor); }
    renderCal();
  }
  function openCalTicket(id){
    var tb = $('tabIntake'); if (tb) tb.click();
    setTimeout(function(){ if (typeof window.__pfOpenTicket === 'function') window.__pfOpenTicket(id); }, 60);
  }
  var calViewsEl = $('hmCalViews');
  if (calViewsEl) calViewsEl.addEventListener('click', function(e){
    var b = e.target.closest('button[data-calview]'); if (!b) return;
    calView = b.dataset.calview;
    try { localStorage.setItem('phoneFixCalView', calView); } catch(err){}
    if (calView === 'day' || calView === 'week') calCursor = parseKey(calSel);
    renderCal();
  });
  var calPrevEl = $('hmCalPrev'), calNextEl = $('hmCalNext'), calTodayEl = $('hmCalToday');
  var dayPrevBtn = $('hmDayPrev'), dayNextBtn = $('hmDayNext'), dayTodayBtn = $('hmDayToday');
  if (dayPrevBtn) dayPrevBtn.addEventListener('click', function(){ kpiDayOffset--; renderHome(false); });
  if (dayNextBtn) dayNextBtn.addEventListener('click', function(){ if (kpiDayOffset < 0){ kpiDayOffset++; renderHome(false); } });
  if (dayTodayBtn) dayTodayBtn.addEventListener('click', function(){ kpiDayOffset = 0; renderHome(false); });
  if (calPrevEl) calPrevEl.addEventListener('click', function(){ calShift(-1); });
  if (calNextEl) calNextEl.addEventListener('click', function(){ calShift(1); });
  if (calTodayEl) calTodayEl.addEventListener('click', function(){ calCursor = new Date(); calCursor.setHours(0, 0, 0, 0); calSel = dkey(calCursor); renderCal(); });
  ['hmCalMonthSel', 'hmCalYearSel'].forEach(function(id){
    var s2 = $(id);
    if (s2) s2.addEventListener('change', function(){
      calCursor.setFullYear(Number($('hmCalYearSel').value), Number($('hmCalMonthSel').value), 1);
      if (calView === 'day') calSel = dkey(calCursor);
      renderCal();
    });
  });
  var calBodyEl = $('hmCalBody');
  if (calBodyEl) calBodyEl.addEventListener('click', function(e){
    var tk = e.target.closest('[data-ticket]');
    if (tk) { openCalTicket(tk.dataset.ticket); return; }
    var dc = e.target.closest('[data-day]');
    if (dc) { calSel = dc.dataset.day; if (calView === 'day') calCursor = parseKey(calSel); renderCal(); }
  });
  var calDetEl = $('hmCalDetail');
  if (calDetEl) calDetEl.addEventListener('click', function(e){
    var tk = e.target.closest('[data-ticket]');
    if (tk) openCalTicket(tk.dataset.ticket);
  });

  var tab = $('tabHome'), view = $('homeView');
  function openHome(){
    var m = document.querySelector('main'); if (m) m.style.display = 'none';
    var q = $('queueView'); if (q) q.hidden = true;
    var iv = $('invView'); if (iv) iv.hidden = true;
    var sv = $('scView'); if (sv) sv.hidden = true;
    ['tabIntake', 'tabQueue', 'tabInventory', 'tabStoreCredit'].forEach(function(id){ var b = $(id); if (b) b.classList.remove('active'); });
    if (tab) tab.classList.add('active');
    view.hidden = false;
    renderHome(true);
    window.scrollTo(0, 0);
  }
  function closeHome(){
    view.hidden = true;
    if (tab) tab.classList.remove('active');
  }
  if (tab) tab.addEventListener('click', openHome);
  ['tabIntake', 'tabQueue', 'tabInventory', 'tabStoreCredit'].forEach(function(id){ var b = $(id); if (b) b.addEventListener('click', closeHome); });
  // remember the current page so a refresh reopens the SAME page instead of always landing on Home
  var VIEW_KEY = 'phoneFixView';
  function saveView(v){ try { localStorage.setItem(VIEW_KEY, v); } catch(e){} }
  if (tab) tab.addEventListener('click', function(){ saveView('home'); });
  [['tabIntake', 'intake'], ['tabQueue', 'queue'], ['tabInventory', 'inventory'], ['tabStoreCredit', 'storecredit']].forEach(function(pair){
    var b = $(pair[0]); if (b) b.addEventListener('click', function(){ saveView(pair[1]); });
  });
  setInterval(function(){ if (view && !view.hidden) renderHome(false); }, 30000);
  // boot: reopen the page the user was last on; Home only when nothing was saved
  (function bootView(){
    var v = null; try { v = localStorage.getItem(VIEW_KEY); } catch(e){}
    var btn = v === 'queue' ? $('tabQueue') : v === 'inventory' ? $('tabInventory') : v === 'storecredit' ? $('tabStoreCredit') : v === 'intake' ? $('tabIntake') : null;
    if (btn) btn.click(); else openHome();
  })();
})();
