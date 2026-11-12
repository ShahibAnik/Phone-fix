(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const paths = {
    phone:'<rect x="7" y="2" width="10" height="20" rx="2.5"/><path d="M11 18h2"/>',
    plus:'<path d="M12 5v14M5 12h14"/>',
    grid:'<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    repair:'<path d="m14.7 6.3 3 3M6 18l-2 2M8 3h8l3 3v15H5V3h3Zm1-1v4h6V2M9 11h6M9 15h4"/>',
    queue:'<path d="M4 4h16v16H4zM9 4v16M15 4v16M4 10h5M9 15h6M15 8h5"/>',
    box:'<path d="m12 3 9 5-9 5-9-5 9-5ZM3 8v9l9 5 9-5V8M12 13v9M7.5 5.5l9 5"/>',
    tool:'<path d="M14 6a5 5 0 0 0-6 6L3 17a3 3 0 0 0 4 4l5-5a5 5 0 0 0 6-6l-4 4-4-4 4-4Z"/>',
    wallet:'<rect x="3" y="5" width="18" height="15" rx="2"/><path d="M3 9h18M16 14h5M5 5V3h13"/>',
    chart:'<path d="M4 3v17h17M8 16v-5M13 16V7M18 16V4"/>',
    clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    users:'<circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6M18 15a5 5 0 0 1 3 5"/>',
    bolt:'<path d="m13 2-9 12h7l-1 8 10-13h-7l1-7Z"/>',
    store:'<path d="M3 10h18l-2-7H5l-2 7ZM4 10v11h16V10M9 21v-7h6v7M8 3l-1 7M16 3l1 7"/>',
    check:'<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
    arrow:'<path d="M4 12h16m-5-5 5 5-5 5"/>',
    logout:'<path d="M9 3H4v18h5M8 12h13m-4-4 4 4-4 4"/>',
    sync:'<path d="M20 8a8 8 0 0 0-14-3L3 8m0-5v5h5M4 16a8 8 0 0 0 14 3l3-3m0 5v-5h-5"/>',
    bell:'<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/>',
    menu:'<path d="M4 6h16M4 12h16M4 18h16"/>',
    help:'<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 0 1 5 0c0 2-2.5 2-2.5 4M12 17h.01"/>',
    download:'<path d="M12 3v12m-4-4 4 4 4-4M4 15v6h16v-6"/>',
    calendar:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4M17 3v4M3 11h18M7 15h3M14 15h3"/>'
  };
  function icon(name,size=18){return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]||paths.grid}</svg>`;}
  function esc(value){return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
  function read(key, fallback=[]){try{return JSON.parse(localStorage.getItem(key))??fallback;}catch(_){return fallback;}}
  const money=n=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:2}).format(Number(n)||0);
  const isoDate=(d=new Date())=>[d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');
  const monthKey=d=>isoDate(d).slice(0,7);
  const stamp=d=>isoDate(d).replaceAll('-','');
  let context, route='intake', rules={lowStock:true,waitingPickup:true,overdueRepair:true}, mirror, syncState={}, reportRows=[], toastTimer;
  function toast(message){let el=$('pfToast');if(!el){el=document.createElement('div');el.id='pfToast';el.className='pf-toast';el.setAttribute('role','status');document.body.append(el);}el.textContent=message;el.hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.hidden=true,5500);}
  function isManager(){return ['developer','owner','manager'].includes(context.member.role);}
  function empty(message){return `<div class="pf-empty">${icon('repair',28)}${esc(message)}</div>`;}
  function setupDemo(){
    // Isolated in memory: never reads or mutates real customer storage or sends Google writes.
    const memory=new Map();
    const storage={getItem:k=>memory.get(String(k))??null,setItem:(k,v)=>{memory.set(String(k),String(v));window.dispatchEvent(new Event('pf:data'));},removeItem:k=>memory.delete(String(k)),clear:()=>memory.clear(),key:i=>[...memory.keys()][i]??null,get length(){return memory.size;}};
    Object.defineProperty(window,'localStorage',{value:storage,configurable:true});
    Object.defineProperty(window,'sessionStorage',{value:{...storage},configurable:true});
    const previousFetch=window.fetch.bind(window);
    window.fetch=(input,options)=>{
      const url=String(input?.url||input);
      if(url.includes('script.google.com')||url.includes('script.googleusercontent.com'))return Promise.resolve(new Response('[]',{status:200,headers:{'Content-Type':'application/json'}}));
      if(url.includes('.supabase.co'))return Promise.reject(new Error('Sample workspace does not connect to live data'));
      return previousFetch(input,options);
    };
    const names=['Jordan Miller','Sarah Chen','Michael Brooks','Emma Wilson','David Park','Olivia Reed','Noah Carter','Ava Thompson','Liam Davis','Mia Foster','Ethan Harris','Sophia Morgan'];
    const models=['iPhone 14 Pro','Samsung Galaxy S23','iPhone 13','iPhone 15 Pro','Google Pixel 8','iPad Air'];
    const tickets=names.map((name,i)=>{const date=new Date();date.setDate(date.getDate()-(i<5?0:i-3));date.setHours(9+i%7,15,0,0);const sub=[129,89,75,149,99,159][i%6];return {id:`FIX-${stamp(date)}-${String(i+1).padStart(4,'0')}`,name,phone:`(215) 555-${String(100+i).padStart(4,'0')}`,device:models[i%6],code:'',price:Math.round(sub*108)/100,subtotal:sub,taxAmount:Math.round(sub*8)/100,totalAmount:Math.round(sub*108)/100,isTaxable:true,isPaid:i%3!==0,fixedBy:i%2?'Alex':'Anik',notes:['Screen replacement','Battery replacement','Charge port repair'][i%3],customerId:'CUST-'+String(i+1).padStart(4,'0'),createdAt:date.getTime(),dateDisplay:date.toLocaleDateString('en-US')+' '+date.toLocaleTimeString(),queueDay:stamp(date),queueSerial:i+1,queueStatus:['progress','queued','ready'][i%3],isDelivered:i>5,priority:i===1,readyBy:date.getTime()+5400000,warrantyDays:7,rating:i>5?5:0};});
    tickets.forEach(r=>{if(r.isDelivered){r.deliveredAt=new Date(r.createdAt+3600000).toISOString();r.deliveredDay=stamp(new Date(r.createdAt+3600000));}r.priceFormatted=money(r.price);r.totalFormatted=money(r.price);r.subtotalFormatted=money(r.subtotal);r.taxFormatted=money(r.taxAmount);});
    storage.setItem('phoneRepairIntakes',JSON.stringify(tickets));
    storage.setItem('phoneRepairCounter',JSON.stringify(Object.fromEntries(tickets.map(r=>[stamp(new Date(r.createdAt)),12]))));
    storage.setItem('phoneRepairCustomerProfiles',JSON.stringify(Object.fromEntries(tickets.map(r=>[r.customerId,{customerId:r.customerId,primaryName:r.name,primaryPhone:r.phone,phoneHistory:[],changeLog:[]}]))));
    storage.setItem('phoneRepairInventory',JSON.stringify(models.slice(0,5).map((name,i)=>({imei:String(350000000000001+i),name,storage:i%2?'128GB':'256GB',price:180+i*35,qty:1,lot:1,dealer:'Mobile Supply',date:isoDate(),status:i===3?'Sold':'Available',soldPrice:i===3?499:'',soldDate:i===3?isoDate():'',layPayments:[]}))));
    storage.setItem('phoneRepairParts',JSON.stringify([{sku:'IP14P-OLED',brand:'Apple',model:'iPhone 14 Pro',type:'Screen',grade:'Premium',color:'Black',qty:2,cost:48,low:3,sup:'PhoneLCDParts'},{sku:'IP13-BAT',brand:'Apple',model:'iPhone 13',type:'Battery',grade:'Standard',qty:8,cost:19,low:3,sup:'PhoneLCDParts'},{sku:'S23-PORT',brand:'Samsung',model:'Galaxy S23',type:'Charge port',qty:1,cost:16,low:2,sup:'PhoneLCDParts'},{sku:'IP15-OLED',brand:'Apple',model:'iPhone 15',type:'Screen',qty:6,cost:68,low:2,sup:'PhoneLCDParts'}]));
    storage.setItem('phoneRepairSpecialOrders','[]');storage.setItem('phoneRepairStoreCredit','[]');
  }
  function makeNavigation(){
    const nav=document.createElement('aside');nav.className='pf-sidebar';nav.setAttribute('aria-label','Main navigation');
    nav.innerHTML=`<a class="pf-brand" id="pfHomeLogo" href="#overview" aria-label="Phone Fix home"><span class="pf-brand-mark">${icon('phone',23)}</span><div><b>phonefix<span style="color:#76936e">.</span></b><small>Store workspace</small></div></a><div class="pf-store">${icon('store',19)}<div><b>Philadelphia store</b><small>2900 Island Avenue</small></div></div><div class="pf-nav-label">Workspace</div><nav class="pf-nav" id="pfWorkNav"></nav><div class="pf-nav-label" data-manager>Management</div><nav class="pf-nav" id="pfManageNav"></nav><div class="pf-sidebar-bottom"><div class="pf-sync-card"><b><i class="pf-dot" id="pfSyncDot"></i><span id="pfSyncLabel">Workspace connected</span></b><div id="pfSyncDetail">Google Sheets + Supabase</div><button id="pfOpenSync" type="button" style="margin-top:8px">View sync activity ${icon('arrow',10)}</button></div><div class="pf-user"><span class="pf-avatar" id="pfUserAvatar">A</span><div><b id="pfUserName">Anik</b><small id="pfUserRole">Manager</small></div><button type="button" class="pf-icon-btn" id="pfLogout" aria-label="Sign out">${icon('logout',16)}</button></div></div>`;
    document.body.prepend(nav);
    const navItems=[['tabIntake','New repair','plus','intake'],['tabHistory','Repair history','repair','history'],['tabQueue','Repair queue','queue','queue'],['tabInventory','Inventory','box','inventory'],['tabStoreCredit','Credit & orders','wallet','credit'],['tabDays','Daily attendance','calendar','days'],['tabPayroll','My payroll','wallet','payroll'],['tabNotes','Customer Flagged/ problems','bell','notes'],['tabTrade','Store & employee billing','store','trade',true],['tabBackup','Master Backup','download','backup',true],['tabDaily','Daily sales','chart','daily',true],['tabHome','Home','grid','overview',true],['tabRecords','Manage records','repair','records',true],['tabAudit','Activity log','clock','audit',true],['tabSales','Monthly sales','chart','sales',true],['tabTeam','Team access','users','team',true],['tabAutomation','Settings','bolt','automation',true]];
    navItems.forEach(([id,label,symbol,key,manager])=>{let button=$(id);if(!button){button=document.createElement('button');button.id=id;button.type='button';}const count=button.querySelector('.vt-count');button.removeAttribute('role');button.dataset.route=key;button.innerHTML=icon(symbol)+`<span>${label}</span>`;if(count)button.append(count);if(manager)button.dataset.manager='';$(manager?'pfManageNav':'pfWorkNav').append(button);});
    document.body.insertAdjacentHTML('afterbegin',`<button class="pf-nav-backdrop" aria-label="Close navigation" type="button"></button>`);
    const top=document.createElement('div');top.className='pf-topbar';top.innerHTML=`<button type="button" class="pf-icon-btn pf-mobile-menu" id="pfMenu" aria-label="Open navigation">${icon('menu',20)}</button><div class="pf-breadcrumb">Workspace <span>/</span> <strong id="pfCrumb">New repair</strong></div><div id="pfSearchSlot"></div><div class="pf-top-actions"><span class="pf-online"><i class="pf-dot"></i><span id="pfConnection">Online</span></span><time>${new Date().toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}</time><button type="button" class="pf-icon-btn" id="pfAlerts" aria-label="View store alerts">${icon('bell',18)}</button></div>`;
    nav.after(top);$('pfSearchSlot').replaceWith($('masterSearchWrap'));$('masterSearch').placeholder='Search customers, tickets, or devices…';
    const heading=document.createElement('div');heading.className='pf-page-heading';heading.innerHTML=`<div><h1 id="pfPageTitle">Repair intake</h1><p id="pfPageSubtitle">A good repair starts with the right details.</p></div><div class="pf-actions"><button class="pf-btn" type="button" id="pfViewQueue">${icon('queue',14)} View queue</button><button class="pf-btn primary" type="button" id="pfNewRepair">${icon('plus',14)} New repair</button></div>`;top.after(heading);
    heading.insertAdjacentHTML('afterend','<div id="pfStats"></div>');
    document.body.insertAdjacentHTML('beforeend','<dialog id="pfDialog" class="pf-modal"></dialog>');
    if(context.preview){top.insertAdjacentHTML('beforebegin',`<div class="pf-demo-banner"><span>Sample workspace · changes stay in this preview</span><label>View as <select id="pfDemoRole" aria-label="Preview role"><option value="developer">Developer</option><option value="owner">Owner</option><option value="manager">Manager</option><option value="employee">Employee</option></select></label><a href="${location.pathname}">Sign in to your store →</a></div>`);}
    const name=(context.user.email||'Store team').split('@')[0];$('pfUserName').textContent=context.preview?'Anik Shahib':name;$('pfUserAvatar').textContent=name.slice(0,1).toUpperCase();$('pfUserRole').textContent=isManager()?'Store manager':'Employee';
  }
  function organizeIntake(){
    const form=$('intakeForm');
    const rows=[...form.children].filter(x=>x.classList.contains('field-row'));
    const sections=[['Customer details','Start with a phone number'],['Device & repair','What can we help with?'],['Service & payment','Set the right expectations']].map(([title,hint],i)=>{const section=document.createElement('section');section.className='pf-form-section';section.innerHTML=`<h2 class="pf-section-title"><span class="pf-section-number">${i+1}</span>${title}<small>${hint}</small></h2>`;return section;});
    const customerRows=rows.filter(r=>r.contains($('custPhone')));
    const deviceRows=rows.filter(r=>r.contains($('deviceModel'))||r.contains($('repairNotes'))||r.contains($('intakePartSearch')));
    sections[0].append($('customerMatchBanner'),...customerRows);
    sections[1].append(...deviceRows.sort((a,b)=>{const priority=r=>r.contains($('deviceModel'))?0:r.contains($('repairNotes'))?1:2;return priority(a)-priority(b);}));
    sections[2].append(...rows.filter(r=>!customerRows.includes(r)&&!deviceRows.includes(r)));
    const footer=form.querySelector('.form-foot');sections.forEach(section=>form.insertBefore(section,footer));
    document.querySelector('.order-title').textContent='New repair ticket';document.querySelector('.order-sub').textContent='Customer details, device information, and service preferences.';
    $('custName').placeholder='Full name';$('deviceModel').placeholder='Search or enter a device model';$('devicePasscode').placeholder='If provided by customer';$('devicePasscode').type='password';$('devicePasscode').autocomplete='off';
    $('repairNotes').placeholder='Describe the issue and the condition of the device…';
    $('searchHistory').placeholder='Search name, phone, ticket, customer ID, or device…';
    footer.querySelector('p').innerHTML='<span id="pfDraftStatus">Your ticket will be saved and ready to print.</span>';
    const note=document.querySelector('.rail .info-note');note.innerHTML=`${icon('check',13)} <b>One less thing to worry about.</b><br>Saved repairs follow your existing Google Sheets sync, with an additional Supabase backup.`;
    document.querySelector('.rail-label').textContent='Receipt preview';
    // Retain the exact history DOM and its handlers, in its own focused page.
    const history=document.createElement('section');history.id='pfHistoryView';history.className='pf-content';history.hidden=true;history.append(document.querySelector('.ledger'));document.querySelector('main').after(history);
    for(const key of ['sales','attendance','team','automation','alerts','records','audit','daily','days','payroll','notes','trade','backup']){const el=document.createElement('section');el.id=`pf${key[0].toUpperCase()+key.slice(1)}View`;el.className='pf-content';el.hidden=true;document.body.insertBefore(el,$('appCopyright'));}
    document.querySelector('.hm-hero-label').innerHTML='Your store, <em>at a glance.</em>';
    document.querySelector('.hm-hero-sub').textContent='Every repair has a story. Keep yours moving, from the first hello to the final pickup.';
    const quick=document.createElement('div');quick.className='pf-home-actions';quick.innerHTML='<button class="pf-btn primary" type="button" id="pfHomeIntake">+ New repair</button><button class="pf-btn" type="button" id="pfHomeQueue">View repair queue →</button><a class="pf-btn" href="/intake" target="_blank" rel="noopener">Customer check-in ↗</a>';document.querySelector('.hm-hero').before(quick);quick.querySelector('#pfHomeIntake').onclick=()=>navigate('intake');quick.querySelector('#pfHomeQueue').onclick=()=>navigate('queue');
    document.querySelector('#hmTotRepairs + span').textContent='Repair tickets';document.querySelector('#hmTotRevenue + span').textContent='Ticket value · paid + unpaid';
    $('hmCollected').parentElement.querySelector('span').textContent='Paid ticket value';
  }
  async function executeLegacy(){for(let i=1;i<=7;i++){await new Promise((resolve,reject)=>{const script=document.createElement('script');if(window.__PhoneFixLegacySources){script.textContent=window.__PhoneFixLegacySources[i-1];document.body.append(script);resolve();return;}script.src='/assets/legacy/module-'+i+'.js?v=20261110a';script.onload=resolve;script.onerror=()=>reject(new Error('Could not load workspace module '+i));document.body.append(script);});}}
  const titles={trade:['Store & employee billing','Items, monthly statements, and payments.'],backup:['Master Backup','Download your business records to this laptop.'],daily:['Daily sales','Record the day. Understand what works.'],days:['Daily attendance','Days worked, with a clear history.'],payroll:['Payroll','Daily earnings, payments, and balances.'],notes:['Customer Flagged/ problems','Remember the conversation before the next call.'],records:['Manage records','Edit details, correct mistakes, and remove records.'],audit:['Activity log','A timestamped history of changes in your store.'],intake:['Repair intake','A good repair starts with the right details.'],history:['Repair history','Every repair. Every customer. All in one place.'],queue:['Repair queue','Keep the counter moving and your customers in the loop.'],inventory:['Inventory','Phones, parts, and accessories — what’s in stock, on layaway, and sold.'],parts:['Parts & supplies','The right part, right when you need it.'],credit:['Store credit & special orders','Follow every order, payment, and customer credit.'],overview:['Welcome to your store','Your day, your team, and every repair — all together.'],sales:['Monthly sales','A closer look at the numbers behind your month.'],attendance:['Attendance','Your time at work, clearly recorded.'],team:['Team access','The right access for everyone in your store.'],automation:['Automations','Small routines that help your store run smoothly.'],alerts:['Needs attention','A short list to keep your day on track.']};
  const oldNav={intake:'tabIntake',queue:'tabQueue',inventory:'tabInventory',parts:'tabInventory',credit:'tabStoreCredit',overview:'tabHome'};
  function showRoute(key){
    if(key==='attendance')key='days';
    if(!titles[key])key=PhoneFixPermissions.fallback();
    if(!PhoneFixPermissions.routeAllowed(key)){toast("You don't have permission for this.");key=PhoneFixPermissions.fallback();}
    if(location.hash!=='#'+key)history.pushState(null,'',location.pathname+location.search+'#'+key);
    route=key;document.querySelector('main').style.display=key==='intake'?'':'none';
    $('intakeFabBtn').classList.toggle('show',key==='queue');
    for(const [id,viewKey] of [['queueView','queue'],['invView','inventory'],['scView','credit'],['homeView','overview']])$(id).hidden=!(key===viewKey||(key==='parts'&&id==='invView'));
    document.querySelectorAll('.pf-content').forEach(view=>{view.hidden=view.id!==`pf${key[0].toUpperCase()+key.slice(1)}View`;});
    document.querySelectorAll('[data-route]').forEach(b=>{b.classList.toggle('active',b.dataset.route===key);if(b.dataset.route===key)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});
    $('pfPageTitle').textContent=titles[key][0];$('pfPageSubtitle').textContent=titles[key][1];$('pfCrumb').textContent=titles[key][0];$('pfStats').hidden=key!=='intake';
    document.body.classList.remove('pf-nav-open');
    if(key==='records')PhoneFixManager.renderRecords();if(key==='audit')PhoneFixManager.renderAudit();if(key==='sales')renderSales();if(key==='team')PhoneFixTeam.render();if(key==='automation')renderAutomation();if(key==='alerts')renderAlerts();
    if(['daily','days','payroll','notes'].includes(key))PhoneFixOperations.render(key);
    if(['trade','backup'].includes(key))PhoneFixCommerce.render(key);
    if(key==='overview')PhoneFixOperations.home();
    window.scrollTo(0,0);
  }
  function navigate(key){if(key==='attendance')key='days';if(!PhoneFixPermissions.routeAllowed(key))key=PhoneFixPermissions.fallback();if($('intakeModalOverlay').style.display==='flex')$('intakeModalClose').click();if(oldNav[key])$(oldNav[key]).click();if(key==='parts')$('invSubParts').click();else if(key==='inventory')$('invSubPhones').click();showRoute(key);}
  function applyRole(){document.querySelectorAll('[data-manager]').forEach(el=>el.hidden=!isManager());$('pfUserRole').textContent=context.member.role;PhoneFixPermissions.render();if(!PhoneFixPermissions.routeAllowed(route))navigate(PhoneFixPermissions.fallback());}

  function metrics(){
    const records=read('phoneRepairIntakes'),today=new Date();today.setHours(0,0,0,0);
    const active=records.filter(r=>!r.isDelivered),newToday=records.filter(r=>Number(r.createdAt)>=today.getTime());
    const values=[['repair','Tickets today',newToday.length,'Today'],['tool','In progress',active.filter(r=>r.queueStatus==='progress').length,'In store'],['check','Ready for pickup',active.filter(r=>r.queueStatus==='ready').length,'Ready'],['users','Customers',Object.keys(read('phoneRepairCustomerProfiles',{})).length,'All time']];
    $('pfStats').innerHTML=`<div class="pf-page-metrics">${values.map(([symbol,label,value,unit])=>`<div class="pf-stat"><span class="pf-stat-icon">${icon(symbol,18)}</span><div><p>${label}</p><strong>${value}</strong><small>${unit}</small></div></div>`).join('')}</div>`;
  }
  function syncStatus(state){syncState=state;$('pfSyncLabel').textContent=state.error?'Backup needs attention':state.busy?'Backing up changes…':state.pending?`${state.pending} changes queued`:'Workspace connected';$('pfSyncDetail').textContent=context.preview?'Sample data · no live sync':state.lastSuccess?'Last backup '+new Date(state.lastSuccess).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}):'Google Sheets + Supabase';$('pfSyncDot').classList.toggle('warn',!!state.error||state.pending>0);}
  function showSync(){const dialog=$('pfDialog');dialog.innerHTML=`<h2>Sync activity</h2><p>Your original Google Sheets sync runs independently of the Supabase backup.</p><div class="pf-rule">${icon('sync')}<div><b>Google Sheets</b><p>${context.preview?'Disabled in sample workspace':'Original endpoints, payloads, and retry behavior preserved.'}</p></div></div><div class="pf-rule">${icon('box')}<div><b>Supabase backup</b><p>${context.preview?'Disabled in sample workspace':esc(syncState.error||(syncState.pending?syncState.pending+' changes waiting':'No changes waiting'))}</p></div></div><p class="pf-note">Existing Google writes use no-cors, so the browser cannot confirm their final acceptance. Check your Sheet to verify a write.</p><div class="pf-form-line"><button id="pfRetrySync" type="button" class="pf-btn primary">Retry Supabase</button><button id="pfCloseDialog" type="button" class="pf-btn">Close</button></div>`;dialog.showModal();$('pfCloseDialog').onclick=()=>dialog.close();$('pfRetrySync').onclick=()=>{if(context.preview)toast('Sample workspace: no live sync.');else{mirror?.flush();toast('Retrying queued backup changes.');}dialog.close();};}
  function downloadCSV(name,rows){const cell=value=>{let s=String(value??'');if(/^[=+@\-\t\r]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';};const blob=new Blob(['\uFEFF'+rows.map(row=>row.map(cell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),5000);}
  function buildSales(month){
    const records=read('phoneRepairIntakes'),phones=read('phoneRepairInventory');const rows=[];
    for(const r of records){const date=new Date(Number(r.createdAt)||0);if(monthKey(date)===month)rows.push({id:r.id,date:isoDate(date),type:'Repair',customer:r.name,item:r.device,value:Number(r.price)||0,paid:!!r.isPaid});}
    for(const p of phones){if(p.status==='Sold'&&String(p.soldDate).startsWith(month))rows.push({id:p.imei,date:String(p.soldDate).slice(0,10),type:'Phone sale',customer:p.custName||'Walk-in',item:p.name,value:Number(p.soldPrice)||0,paid:true});}
    return rows.sort((a,b)=>b.date.localeCompare(a.date));
  }
  function renderSales(){
    if(!PhoneFixAccess.can('costs_view'))return;const view=$('pfSalesView'),month=$('pfSalesMonth')?.value||monthKey(new Date());reportRows=buildSales(month);
    const total=reportRows.reduce((s,r)=>s+r.value,0),paid=reportRows.filter(r=>r.paid).reduce((s,r)=>s+r.value,0);
    const days=new Date(Number(month.slice(0,4)),Number(month.slice(5)),0).getDate(),values=Array.from({length:days},(_,i)=>reportRows.filter(r=>Number(r.date.slice(-2))===i+1).reduce((s,r)=>s+r.value,0)),peak=Math.max(...values,1);
    view.innerHTML=`<div class="pf-card"><div style="display:flex;align-items:center;justify-content:space-between;gap:15px;flex-wrap:wrap"><div><h2>Your month in numbers</h2><p style="margin-bottom:0">Repair ticket value + completed phone sales</p></div><div class="pf-form-line" style="margin:0"><label for="pfSalesMonth">Reporting month<input type="month" id="pfSalesMonth" value="${esc(month)}" required></label><button type="button" class="pf-btn" id="pfSalesExport">${icon('download',14)} Export report</button></div></div><div class="pf-page-metrics" style="margin:24px 0 0"><div class="pf-stat"><div><p>Total value</p><strong>${money(total)}</strong></div></div><div class="pf-stat"><div><p>Paid value</p><strong>${money(paid)}</strong></div></div><div class="pf-stat"><div><p>Unpaid repairs</p><strong>${money(total-paid)}</strong></div></div><div class="pf-stat"><div><p>Transactions</p><strong>${reportRows.length}</strong></div></div></div><div class="pf-chart" role="img" aria-label="Daily ticket and phone sale values for ${esc(month)}">${values.map((v,i)=>`<div class="pf-chart-bar" title="${i+1}: ${money(v)}"><i style="height:${v/peak*100}%"></i><span>${i===0||(i+1)%5===0?i+1:''}</span></div>`).join('')}</div><p class="pf-note" style="margin-top:25px">Repairs are grouped by intake date and include tax. Paid value uses each ticket’s current payment status, not its payment date. This is a sales activity report, not a cash-received statement. Store credit and special-order deposits are excluded to avoid double counting.</p></div><div class="pf-card" style="margin-top:20px;padding:0;overflow:hidden"><div class="pf-scroll"><table class="pf-table"><thead><tr><th>DATE</th><th>CUSTOMER / ITEM</th><th>TYPE</th><th>PAYMENT</th><th>VALUE</th></tr></thead><tbody>${reportRows.map(r=>`<tr><td>${esc(r.date)}</td><td><strong>${esc(r.customer)}</strong><br><small>${esc(r.item)}</small></td><td>${r.type}</td><td><span class="pf-badge ${r.paid?'':'amber'}">${r.paid?'Paid':'Due'}</span></td><td>${money(r.value)}</td></tr>`).join('')}</tbody></table>${reportRows.length?'':empty('No sales activity in this month.')}</div></div>`;
    $('pfSalesMonth').onchange=()=>{if($('pfSalesMonth').value)renderSales();};$('pfSalesExport').onclick=()=>downloadCSV(`phonefix-sales-${month}.csv`,[['Date','Record','Type','Customer','Item','Payment','Value'],...reportRows.map(r=>[r.date,r.id,r.type,r.customer,r.item,r.paid?'Paid':'Due',r.value])]);
  }
  async function renderAutomation(){
    if(!PhoneFixAccess.can('settings_manage'))return;const view=$('pfAutomationView');
    view.innerHTML=`<div class="pf-card-grid"><div class="pf-card"><h2>Store reminders</h2><p>Automatic alerts in your workspace. No messages are sent to customers.</p>${[['lowStock','Low-stock reminders','Flag parts at or below their minimum quantity.'],['waitingPickup','Ready-for-pickup reminders','Surface finished repairs still waiting in the store.'],['overdueRepair','Overdue repair reminders','Flag unfinished repairs past their ready-by time.']].map(([key,label,description])=>`<label class="pf-rule"><span>${icon(key==='lowStock'?'box':key==='waitingPickup'?'check':'clock',21)}</span><div><b>${label}</b><p>${description}</p></div><input class="pf-switch" type="checkbox" data-rule="${key}" ${rules[key]?'checked':''} aria-label="${label}"></label>`).join('')}</div><div class="pf-card"><h2>Always working in the background</h2><p>Existing workflows stay in place.</p><div class="pf-rule">${icon('sync',21)}<div><b>Google Sheets sync</b><p>Your existing repairs, stock, payments, and orders integration.</p></div><span class="pf-badge">Preserved</span></div><div class="pf-rule">${icon('box',21)}<div><b>Supabase backup</b><p>Separate queued updates, deletion markers, and automatic retries.</p></div><span class="pf-badge">${context.preview?'Preview':'Enabled'}</span></div><div class="pf-rule">${icon('repair',21)}<div><b>Intake draft recovery</b><p>Recover unfinished details on this device. Device passcodes are excluded.</p></div><span class="pf-badge">Enabled</span></div></div></div><div id="pfDeveloperTools"></div>`;
    PhoneFixCustomization.render();
    view.querySelectorAll('[data-rule]').forEach(input=>input.onchange=async()=>{if(!PhoneFixAccess.can('settings_manage')){toast("You don't have permission for this.");return;}const key=input.dataset.rule,previous=rules[key];rules[key]=input.checked;input.disabled=true;try{if(!context.preview)await context.request('/rest/v1/pf_settings?store_id=eq.philadelphia',{method:'PATCH',body:JSON.stringify({rules})});toast('Reminder preference saved.');}catch(e){rules[key]=previous;input.checked=previous;toast(e.message);}finally{input.disabled=false;}});
  }
  function renderAlerts(){const records=read('phoneRepairIntakes'),parts=read('phoneRepairParts'),alerts=[];
    if(rules.lowStock)parts.filter(p=>Number(p.qty)<=Number(p.low)).forEach(p=>alerts.push({title:[p.model,p.type].join(' '),note:`${p.qty} in stock · reorder threshold ${p.low}`,route:'parts',label:'Low stock'}));
    records.filter(r=>!r.isDelivered).forEach(r=>{if(rules.waitingPickup&&r.queueStatus==='ready')alerts.push({title:r.name,note:r.device+' · '+r.id,route:'queue',label:'Ready for pickup'});else if(rules.overdueRepair&&r.readyBy&&Number(r.readyBy)<Date.now())alerts.push({title:r.name,note:r.device+' · '+r.id,route:'queue',label:'Past ready-by time'});});
    $('pfAlertsView').innerHTML=`<div class="pf-card"><h2>${alerts.length} ${alerts.length===1?'item':'items'} to check</h2><p>Based on your current repair and inventory records.</p>${alerts.map(a=>`<div class="pf-rule">${icon(a.route==='parts'?'box':'clock',20)}<div><b>${esc(a.title)}</b><p>${esc(a.note)}</p></div><span class="pf-badge amber">${a.label}</span><button type="button" class="pf-btn" data-alert-route="${a.route}">View</button></div>`).join('')||empty('All caught up. Nothing needs your attention.')}</div>`;$('pfAlertsView').querySelectorAll('[data-alert-route]').forEach(b=>b.onclick=()=>navigate(b.dataset.alertRoute));
  }
  function setupDraft(){
    const key='pf.intake.draft.v1',ids=['custName','custPhone','deviceModel','repairPrice','fixedBy','repairNotes'];let timer;
    const saved=read(key,null);if(saved&&ids.some(id=>saved[id])){const button=document.createElement('button');button.type='button';button.className='tool-btn';button.textContent='Restore unfinished intake';button.style.marginLeft='12px';document.querySelector('.order-sub').append(button);button.onclick=()=>{ids.forEach(id=>{if(saved[id]!=null)$(id).value=saved[id];$(id).dispatchEvent(new Event('input',{bubbles:true}));});button.remove();toast('Draft restored. Review the details before saving.');};}
    $('intakeForm').addEventListener('input',()=>{clearTimeout(timer);timer=setTimeout(()=>{try{localStorage.setItem(key,JSON.stringify(Object.fromEntries(ids.map(id=>[id,$(id).value]))));$('pfDraftStatus').textContent='Draft saved on this device';}catch(_){$('pfDraftStatus').textContent='Draft could not be saved on this device';}},600);});
    $('resetBtn').addEventListener('click',()=>{clearTimeout(timer);localStorage.removeItem(key);$('pfDraftStatus').textContent='Your ticket will be saved and ready to print.';});
    $('intakeForm').addEventListener('submit',()=>setTimeout(()=>{if(!$('custName').value){clearTimeout(timer);localStorage.removeItem(key);$('pfDraftStatus').textContent='Ticket saved. Ready for the next customer.';}metrics();},0));
  }
  async function boot(options){
    context=options;
    if(options.preview){setupDemo();context.user={id:'preview-manager',email:'developer@example.invalid'};context.member={role:'developer',email:'developer@example.invalid',name:'Demo Developer',permissions:null};PhoneFixAccess.setPreview(context.member);}
    makeNavigation();organizeIntake();
    if(!context.preview){let device=localStorage.getItem('pf.device');if(!device){device=crypto.randomUUID();localStorage.setItem('pf.device',device);}mirror=PhoneFixSync.start({storage:localStorage,device,request:context.request,onChange:syncStatus,canCapture:PhoneFixAccess.canMirror,canSend:PhoneFixAccess.canSend});}
    PhoneFixManager.init(context, {toast, esc, icon, navigate});PhoneFixTeam.init(context,{toast,esc});PhoneFixPermissions.install();
    PhoneFixOperations.init(context,{toast,esc,icon,navigate});
    PhoneFixCommerce.init(context,{toast,esc});
    await executeLegacy();
    await PhoneFixCustomization.init(context);
    $('pfHomeLogo').onclick=e=>{e.preventDefault();navigate('overview');};
    window.addEventListener('popstate',()=>navigate(location.hash.slice(1)));
    window.addEventListener('hashchange',()=>{if(location.hash.slice(1)!==route)navigate(location.hash.slice(1));});
    document.querySelectorAll('[data-route]').forEach(button=>button.addEventListener('click',()=>{const key=button.dataset.route;if(key==='parts'){$('tabInventory').click();$('invSubParts').click();}else if(key==='inventory')$('invSubPhones').click();showRoute(key);}));
    $('pfNewRepair').onclick=()=>{navigate('intake');$('custPhone').focus();};$('pfViewQueue').onclick=()=>navigate('queue');
    document.addEventListener('click',event=>{if(event.target.closest('.ndJumpBtn'))navigate('history');});
    $('masterSearchResults').addEventListener('click',event=>{if(event.target.closest('.ms-group')?.querySelector('.ms-gtitle')?.textContent==='Customers')navigate('intake');},true);
    new MutationObserver(()=>{if(!$('queueView').hidden&&route!=='queue')showRoute('queue');}).observe($('queueView'),{attributes:true,attributeFilter:['hidden']});
    $('pfOpenSync').onclick=showSync;$('pfAlerts').onclick=()=>navigate('alerts');$('pfMenu').onclick=()=>document.body.classList.toggle('pf-nav-open');document.querySelector('.pf-nav-backdrop').onclick=()=>document.body.classList.remove('pf-nav-open');
    $('pfLogout').onclick=()=>context.preview?location.assign(location.pathname):context.logout();
    if(context.preview)$('pfDemoRole').onchange=()=>{context.member.role=$('pfDemoRole').value;context.member.permissions=null;PhoneFixAccess.setPreview(context.member);applyRole();toast(`Previewing the ${context.member.role} workspace.`);};
    document.addEventListener('keydown',event=>{if(event.key==='Escape')document.body.classList.remove('pf-nav-open');if((event.ctrlKey||event.metaKey)&&event.key==='k'){event.preventDefault();$('masterSearch').focus();}});
    document.querySelectorAll('.preset-chip').forEach(chip=>{chip.tabIndex=0;chip.setAttribute('role','button');chip.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();chip.click();}});});
    let dataTimer;window.addEventListener('pf:data',()=>{clearTimeout(dataTimer);dataTimer=setTimeout(()=>{metrics();if(route==='sales')renderSales();if(route==='alerts')renderAlerts();},250);});
    window.addEventListener('storage',event=>{if(event.key?.startsWith('phoneRepair'))metrics();});
    const connection=()=>{$('pfConnection').textContent=navigator.onLine?'Online':'Offline';};window.addEventListener('online',connection);window.addEventListener('offline',connection);connection();
    setupDraft();applyRole();metrics();navigate(location.hash.slice(1)|| (isManager()?'overview':'intake'));document.body.classList.remove('pf-locked');
    if(context.preview)syncStatus({});else context.request('/rest/v1/pf_settings?store_id=eq.philadelphia&select=rules').then(rows=>{if(rows?.[0]?.rules)rules=rows[0].rules;}).catch(()=>{});
    const ticketOpener=window.__pfOpenTicket;window.__pfOpenTicket=id=>{navigate('history');ticketOpener?.(id);};
    window.PhoneFixWorkspace.ready=true;window.dispatchEvent(new Event('pf:ready'));
  }
  window.PhoneFixWorkspace={boot,icon,navigate,buildSales,isManager,toast,esc,ready:false};
})();
