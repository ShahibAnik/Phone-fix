(function(){
 'use strict';
 const A=()=>window.PhoneFixAccess;
 const routes={intake:['intake_create'],history:['ticket_edit','ticket_pay','ticket_delete','history_edit'],queue:['ticket_edit','ticket_pay','intake_create'],inventory:['inventory_manage'],parts:['inventory_manage','toorder_manage'],credit:['ticket_pay','inventory_manage'],records:['history_edit'],team:['team_manage'],automation:['settings_manage'],sales:['costs_view'],audit:['history_edit'],overview:['costs_view'],alerts:['inventory_manage','ticket_edit'],days:[]};
 const selectors={
 intake_create:'#intakeForm, #pfNewRepair, #pfHomeIntake, #qvNewIntakeBtn, #intakeFabBtn',
 history_edit:'.editBtn, .rateBtn, #historyForm, #addHistoryBtn, #hmWarrantyBtn, #hmWarrantyApply, #hmPartAddBtn, #hmPartAddGo, [data-edit-record]',
 ticket_delete:'.delBtn, .delete-btn, [data-remove-record]',
 ticket_pay:'.paid-toggle',
 ticket_edit:'.deliver-toggle, #rvApprove, #rvNoPrio, #qvCarryAll, #queueView [data-act="priority"], #queueView [data-act="status"], #queueView [data-act="back"], #queueView [data-act="carry"], #queueView [data-act="confirm"], #queueView [data-act="review"]',
 data_export:'#exportCsvBtn, #pfSalesExport, #pfShiftExport, #invExport',
 inventory_manage:'#invAdd, #invList [data-act]:not([data-act=toggle]):not([data-act=receipt]):not([data-act=buyer]), #fSave, #sSave, #lSave, #lpSave, #ptAdd, #acAdd, #pfSave, #afSave, #ptList [data-a]:not([data-a=history]), #acList [data-a], #scAddSO, #scAddCred, #scSOList [data-act=del], #scCredList [data-act=del], [data-sostatus]',
 toorder_manage:'[data-oa], [data-ra], #ptQuickAdd',
 settings_manage:'#pfRulesForm, [data-rule]',team_manage:'#pfTeamForm'
 };
 function routeAllowed(key){if(['days','payroll'].includes(key))return true;if(key==='daily')return ['developer','owner','manager'].includes(A().member?.role);if(key==='notes')return ['intake_create','history_edit','ticket_edit'].some(p=>A().can(p));if(key==='audit')return A().can('history_edit')&&A().can('costs_view');return key in routes&&routes[key].some(p=>A().can(p))||key==='days';}
 function fallback(){return ['overview','intake','history','inventory','days'].find(routeAllowed);}
 function required(el){for(const [permission,selector] of Object.entries(selectors))if(el.closest?.(selector))return permission;return null;}
 function deny(e){e.preventDefault();e.stopImmediatePropagation();let n=document.getElementById('pfPermissionError');if(!n){n=document.createElement('p');n.id='pfPermissionError';n.className='pf-toast';n.setAttribute('role','alert');document.body.append(n);}n.textContent="You don't have permission for this.";n.hidden=false;setTimeout(()=>n.hidden=true,4500);}
 function render(){
  document.querySelectorAll('[data-route]').forEach(el=>el.hidden=!routeAllowed(el.dataset.route));
  for(const [permission,selector] of Object.entries(selectors))document.querySelectorAll(selector).forEach(el=>{if(el.tagName!=='FORM')el.hidden=!A().can(permission);});
  document.body.classList.toggle('pf-costs-hidden',!A().can('costs_view'));
  for(const id of ['pfViewQueue','pfHomeQueue']){const el=document.getElementById(id);if(el)el.hidden=!routeAllowed('queue');}
  const search=document.getElementById('masterSearchWrap');if(search)search.hidden=!(A().can('history_edit')||A().can('inventory_manage'));
  const alerts=document.getElementById('pfAlerts');if(alerts)alerts.hidden=!routeAllowed('alerts');
  const profile=document.getElementById('pfProfileMenu');if(profile){const label=(A().member.name||A().member.email||'My account')+' · '+A().member.role;if(profile.textContent!==label)profile.textContent=label;}
  document.querySelectorAll('.inv-price').forEach(el=>{if(el.textContent.includes('Bought'))el.classList.add('pf-cost-field');});
  document.querySelectorAll('.inv-chip.profit,.inv-chip.loss,.pt-price,.pt-meta,#intakePartsTotal,#hmPartsTotal').forEach(el=>el.classList.add('pf-cost-field'));
  document.querySelectorAll('.inv-info>div').forEach(el=>{if(/profit|buying|bought|cost/i.test(el.textContent))el.classList.add('pf-cost-field');});
  document.querySelectorAll('table').forEach(table=>{const headers=[...table.querySelectorAll('thead th')];headers.forEach((th,i)=>{if(/buying|unit cost|total cost|profit|margin/i.test(th.textContent)){th.classList.add('pf-cost-field');table.querySelectorAll('tbody tr').forEach(tr=>tr.children[i]?.classList.add('pf-cost-field'));}});});
  document.querySelectorAll('label').forEach(el=>{if(/^(buying price|unit cost|cost|profit)(\s|\(|$)/i.test(el.textContent.trim())){el.classList.add('pf-cost-field');const id=el.htmlFor;if(id)document.getElementById(id)?.classList.add('pf-cost-field');}});
  document.querySelectorAll('.inv-analytics').forEach(el=>el.hidden=!A().can('costs_view'));
 }
 function install(){document.addEventListener('click',e=>{if(e.target.closest('#pfAccessGate,#pfLogin'))return;const nav=e.target.closest('[data-route]');const p=required(e.target);if(A().locked||nav&&!routeAllowed(nav.dataset.route)||p&&!A().can(p))deny(e);},true);document.addEventListener('change',e=>{if(e.target.closest('#pfAccessGate,#pfLogin'))return;const p=required(e.target);if(A().locked||p&&!A().can(p))deny(e);},true);document.addEventListener('submit',e=>{if(e.target.closest('#pfAccessGate,#pfLogin'))return;const p=required(e.target);if(A().locked||p&&!A().can(p))deny(e);},true);let pending=false;new MutationObserver(()=>{if(pending)return;pending=true;setTimeout(()=>{pending=false;render();},50);}).observe(document.body,{childList:true,subtree:true});render();}
 window.PhoneFixPermissions={routeAllowed,fallback,render,install};
})();
