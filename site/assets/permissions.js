(function(){
 'use strict';
 const A=()=>window.PhoneFixAccess;
 const routes={intake:['repair_create'],history:['repair_view','customer_history_view'],queue:['repair_view','repair_status','repair_create'],inventory:['inventory_view'],parts:['inventory_view','orders_manage'],credit:['payment_record','orders_manage'],records:['repair_edit','customer_edit'],team:['team_view','team_manage'],automation:['settings_manage'],sales:['financial_reports_view'],audit:['audit_view'],overview:['financial_reports_view'],alerts:['inventory_view','repair_view'],days:['attendance_view','attendance_own']};
 const selectors={
 repair_create:'#intakeForm, #pfNewRepair, #pfHomeIntake, #qvNewIntakeBtn, #intakeFabBtn',
 repair_edit:'.editBtn, .rateBtn, #historyForm, #addHistoryBtn, #hmWarrantyBtn, #hmWarrantyApply, #hmPartAddBtn, #hmPartAddGo, [data-edit-record]',
 repair_delete:'.delBtn, .delete-btn, [data-remove-record]',
 payment_record:'.paid-toggle',
 repair_status:'.deliver-toggle, #rvApprove, #rvNoPrio, #qvCarryAll, #queueView [data-act="priority"], #queueView [data-act="status"], #queueView [data-act="back"], #queueView [data-act="carry"], #queueView [data-act="confirm"], #queueView [data-act="review"]',
 data_export:'#exportCsvBtn, #pfSalesExport, #pfShiftExport, #invExport',
 inventory_add:'#invAdd, #ptAdd, #acAdd, #scAddSO, #scAddCred',
 inventory_edit:'#invList [data-act]:not([data-act=toggle]):not([data-act=receipt]):not([data-act=buyer]):not([data-act=delete]), #fSave, #sSave, #lSave, #lpSave, #pfSave, #afSave, #ptList [data-a]:not([data-a=history]):not([data-a=delete]), #acList [data-a]:not([data-a=delete]), [data-sostatus]',
 inventory_delete:'#invList [data-act=delete], #ptList [data-a=delete], #acList [data-a=delete], #scSOList [data-act=del], #scCredList [data-act=del]',
 orders_manage:'[data-oa], [data-ra], #ptQuickAdd',
 settings_manage:'#pfRulesForm, [data-rule]',team_manage:'#pfTeamForm'
 };
 function routeAllowed(key){if(key==='backup')return A().member?.role==='developer';if(key==='trade')return A().can('financial_reports_view')||A().can('orders_manage');if(key==='payroll')return A().can('attendance_view')||A().can('attendance_own');if(key==='daily')return A().can('daily_closing_submit')||A().can('daily_closing_edit');if(key==='notes')return A().can('customer_history_view')||A().can('customer_edit');return key in routes&&routes[key].some(p=>A().can(p));}
 function fallback(){return ['overview','intake','history','inventory','days'].find(routeAllowed);}
 function required(el){for(const [permission,selector] of Object.entries(selectors))if(el.closest?.(selector))return permission;return null;}
 function deny(e){e.preventDefault();e.stopImmediatePropagation();let n=document.getElementById('pfPermissionError');if(!n){n=document.createElement('p');n.id='pfPermissionError';n.className='pf-toast';n.setAttribute('role','alert');document.body.append(n);}n.textContent="You don't have permission for this.";n.hidden=false;setTimeout(()=>n.hidden=true,4500);}
 function render(){
  document.querySelectorAll('[data-route]').forEach(el=>el.hidden=!routeAllowed(el.dataset.route));
  for(const [permission,selector] of Object.entries(selectors))document.querySelectorAll(selector).forEach(el=>{if(el.tagName!=='FORM')el.hidden=!A().can(permission);});
  document.body.classList.toggle('pf-costs-hidden',!A().can('costs_view'));
  for(const id of ['pfViewQueue','pfHomeQueue']){const el=document.getElementById(id);if(el)el.hidden=!routeAllowed('queue');}
  const search=document.getElementById('masterSearchWrap');if(search)search.hidden=!(A().can('customer_history_view')||A().can('inventory_view'));
  const alerts=document.getElementById('pfAlerts');if(alerts)alerts.hidden=!routeAllowed('alerts');
  const profile=document.getElementById('pfProfileMenu');if(profile){const label=(A().member.name||A().member.email||'My account')+' · '+A().member.role;if(profile.textContent!==label)profile.textContent=label;}
  const addPerson=document.getElementById('pfAddPerson');if(addPerson)addPerson.hidden=!['developer','owner','manager'].includes(A().member?.role)||!A().can('team_manage');
  const quickFlag=document.getElementById('opQuickFlag');if(quickFlag)quickFlag.hidden=!(A().can('customer_history_view')||A().can('customer_edit')||A().can('repair_create'));
  document.querySelectorAll('.inv-price').forEach(el=>{if(el.textContent.includes('Bought'))el.classList.add('pf-cost-field');});
  document.querySelectorAll('.inv-chip.profit,.inv-chip.loss,.pt-price,.pt-meta,#intakePartsTotal,#hmPartsTotal').forEach(el=>el.classList.add('pf-cost-field'));
  document.querySelectorAll('.inv-info>div').forEach(el=>{if(/profit|buying|bought|cost/i.test(el.textContent))el.classList.add('pf-cost-field');});
  document.querySelectorAll('table').forEach(table=>{const headers=[...table.querySelectorAll('thead th')];headers.forEach((th,i)=>{if(/buying|unit cost|total cost|profit|margin/i.test(th.textContent)){th.classList.add('pf-cost-field');table.querySelectorAll('tbody tr').forEach(tr=>tr.children[i]?.classList.add('pf-cost-field'));}});});
  document.querySelectorAll('label').forEach(el=>{if(/^(buying price|unit cost|cost|profit)(\s|\(|$)/i.test(el.textContent.trim())){el.classList.add('pf-cost-field');const id=el.htmlFor;if(id)document.getElementById(id)?.classList.add('pf-cost-field');}});
  document.querySelectorAll('.inv-analytics').forEach(el=>el.hidden=!A().can('costs_view'));
  document.querySelectorAll('[data-cost-sort]').forEach(el=>{el.disabled=!A().can('costs_view');el.hidden=!A().can('costs_view');});
  const invSort=document.getElementById('invSort');if(invSort&&!A().can('costs_view')&&['cost-asc','cost-desc','value-desc'].includes(invSort.value)){invSort.value='date-desc';invSort.dispatchEvent(new Event('change',{bubbles:true}));}
 }
 function install(){document.addEventListener('click',e=>{if(e.target.closest('#pfAccessGate,#pfLogin'))return;const nav=e.target.closest('[data-route]');const p=required(e.target);if(A().locked||nav&&!routeAllowed(nav.dataset.route)||p&&!A().can(p))deny(e);},true);document.addEventListener('change',e=>{if(e.target.closest('#pfAccessGate,#pfLogin'))return;const p=required(e.target);if(A().locked||p&&!A().can(p))deny(e);},true);document.addEventListener('submit',e=>{if(e.target.closest('#pfAccessGate,#pfLogin'))return;const p=required(e.target);if(A().locked||p&&!A().can(p))deny(e);},true);let pending=false;new MutationObserver(()=>{if(pending)return;pending=true;setTimeout(()=>{pending=false;render();},50);}).observe(document.body,{childList:true,subtree:true});render();}
 window.PhoneFixPermissions={routeAllowed,fallback,render,install};
})();
