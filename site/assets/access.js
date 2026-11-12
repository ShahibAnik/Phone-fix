/* Supabase identity remains authoritative. PIN is a convenience lock, never a new identity. */
(function(root){
 'use strict';
 const GROUPS={
  'Repairs & customers':['repair_create','repair_view','repair_edit','repair_delete','repair_status','technician_assign','customer_history_view','customer_edit'],
  'Payments & financial':['payment_record','refund_issue','discount_apply','financial_reports_view','costs_view','daily_closing_submit','daily_closing_edit'],
  'Inventory':['inventory_view','inventory_add','inventory_edit','inventory_delete','suppliers_view','orders_manage'],
  'Employee & administration':['attendance_view','attendance_own','attendance_edit','team_view','team_manage','settings_manage','data_export','audit_view']
 };
 const ALL=Object.values(GROUPS).flat();
 const LEGACY={intake_create:['repair_create'],ticket_edit:['repair_edit','repair_status','technician_assign'],ticket_delete:['repair_delete'],ticket_pay:['payment_record'],inventory_manage:['inventory_view','inventory_add','inventory_edit','inventory_delete'],toorder_manage:['orders_manage'],history_edit:['repair_view','repair_edit','customer_history_view','customer_edit']};
 const $=id=>document.getElementById(id), esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 let state,context,locked=false,version=0,polling;
 const role=()=>state?.role||'employee';
 function can(permission,member=state){if(!member)return false;if(['developer','owner'].includes(member.role)||(member.role==='manager'&&member.permissions==null)||(member.role==='employee'&&permission==='attendance_own'))return true;const granted=Array.isArray(member.permissions)?member.permissions:[];if(granted.includes(permission))return true;if(LEGACY[permission])return LEGACY[permission].some(p=>granted.includes(p));return Object.entries(LEGACY).some(([old,next])=>next.includes(permission)&&granted.includes(old));}
 function canMirror(event,before){
  if(locked)return false;const k=event.kind;
  if(k==='device_settings')return true;
  if(k==='reorder')return can('orders_manage');
  if(['inventory','parts','accessories','usage','special_orders','store_credit'].includes(k)){if(event.deleted)return can('inventory_delete');return before?can('inventory_edit'):can('inventory_add');}
  if(k==='customers')return before?can('customer_edit'):can('repair_create');
  if(k!=='repairs')return can('settings_manage');
  if(event.deleted)return can('repair_delete');
  if(!before)return can('repair_create');
  const omit=(v,keys)=>Object.fromEntries(Object.entries(v||{}).filter(([key])=>!keys.includes(key)));
  const same=keys=>JSON.stringify(omit(before,keys))===JSON.stringify(omit(event.data,keys));
  if(same(['isPaid','payments','paymentStatus']))return can('payment_record');
  if(same(['fixedBy']))return can('technician_assign');
  if(same(['queueStatus','priority','readyBy','readyByLabel','isDelivered','deliveredAt','deliveredDay','statusChangedAt']))return can('repair_status');
  return can('repair_edit');
 }
 function canSend(event){if(locked)return false;if(event.kind==='repairs')return ['repair_create','repair_edit','repair_status','technician_assign','payment_record','repair_delete'].some(p=>can(p));return canMirror(event);}
 function assert(permission){if(locked||!can(permission))throw new Error("You don't have permission for this.");}
 function mayManage(actor,target){return !!actor&&['developer','owner'].includes(actor.role)&&can('team_manage',actor)&&target.role!=='developer'&&target.email!==actor.email;}
 async function hash(value,recovery=false){const bytes=new TextEncoder().encode((recovery?'phonefix-recovery-v1:':'phonefix-pin-v1:')+value);return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');}
 function code(){let n;do{n=crypto.getRandomValues(new Uint32Array(1))[0];}while(n>=4294000000);return String(n%1000000).padStart(6,'0');}
 function rpc(name,payload){return context.request('/rest/v1/rpc/'+name,{method:'POST',body:JSON.stringify(payload)});}
 async function refresh(){state=await rpc('pf_access_context',{});return state;}
 function markUnlocked(){locked=false;version=state.pinVersion;sessionStorage.setItem('pf.pin.unlocked',String(version));const remember=Number(localStorage.getItem('pf.auth.rememberUntil.v2'));if(remember>Date.now())localStorage.setItem('pf.pin.remember',JSON.stringify({version,until:remember,email:context.user.email}));else localStorage.removeItem('pf.pin.remember');document.getElementById('pfAccessGate')?.remove();}
 function remembered(){try{const r=JSON.parse(localStorage.getItem('pf.pin.remember'));return r&&r.version===state.pinVersion&&r.until>Date.now()&&r.email===context.user.email;}catch(_){return false;}}
 function gate(mode='unlock'){
  locked=true;
  return new Promise(resolve=>{
   const prior=$('pfAccessGate');if(prior)prior.remove();const el=document.createElement('section');el.id='pfAccessGate';el.className='pf-access-gate';
   const setup=mode==='setup',change=mode==='change',recover=mode==='recover';
   el.innerHTML=`<form class="pf-access-card" id="pfPinForm"><span class="pf-badge">${esc(state.name||state.email)} · ${esc(role())}</span><h2>${setup?'Set your quick-unlock PIN':change?'Change my PIN':recover?'Recover your PIN':'Unlock your workspace'}</h2><p>Your email account controls access. Your PIN keeps casual hands off this device; it does not encrypt store data.</p>${!setup?`<label for="pfCurrentPin">${recover?'6-digit recovery code':'Current PIN'}</label><input id="pfCurrentPin" type="password" inputmode="numeric" pattern="[0-9]{${recover?6:4}}" minlength="${recover?6:4}" maxlength="${recover?6:4}" autocomplete="off" required>`:''}${setup||change||recover?'<label for="pfNewPin">New 4-digit PIN</label><input id="pfNewPin" type="password" inputmode="numeric" pattern="[0-9]{4}" maxlength="4" autocomplete="new-password" required><label for="pfRepeatPin">Repeat new PIN</label><input id="pfRepeatPin" type="password" inputmode="numeric" pattern="[0-9]{4}" maxlength="4" autocomplete="new-password" required>':''}<label class="pf-remember"><input id="pfPinRemember" type="checkbox" ${Number(localStorage.getItem('pf.auth.rememberUntil.v2'))>Date.now()?'checked':''}> Stay logged in on this device for 30 days</label><p id="pfPinError" role="alert" class="pf-error"></p><button class="pf-btn primary" type="submit">${setup?'Set PIN':change||recover?'Save new PIN':'Unlock'}</button><div class="pf-login-links">${!setup&&!change&&!recover?'<button type="button" id="pfRecoverPin">Forgot PIN?</button>':''}<button type="button" id="pfPinSwitch">Switch user / sign out</button>${change?'<button type="button" id="pfPinCancel">Cancel</button>':''}</div></form>`;
   document.body.append(el);$('pfPinSwitch').onclick=()=>root.PhoneFixAuth.logout();
   if($('pfRecoverPin'))$('pfRecoverPin').onclick=()=>gate('recover').then(resolve);
   if($('pfPinCancel'))$('pfPinCancel').onclick=()=>{markUnlocked();resolve(state);};
   $('pfPinForm').onsubmit=async e=>{e.preventDefault();if(e.submitter)e.submitter.disabled=true;$('pfPinError').textContent='';try{
    const current=$('pfCurrentPin')?.value,newPin=$('pfNewPin')?.value;
    if(newPin && (newPin!==$('pfRepeatPin').value||!/^\d{4}$/.test(newPin)))throw new Error('Enter the same four-digit PIN twice.');
    if(change&&current===newPin)throw new Error('Choose a different PIN.');
    const recoveryCode=setup?code():null;
    const payload={action:mode,currentHash:current&&!recover?await hash(current):null,newHash:newPin?await hash(newPin):null,recoveryHash:recover?await hash(current,true):null,newRecoveryHash:recoveryCode?await hash(recoveryCode,true):null};
    const result=await rpc('pf_pin_action',{payload});if(!result.ok)throw new Error(result.error);
    root.PhoneFixAuth.remember($('pfPinRemember').checked);await refresh();
    if(recoveryCode){$('pfPinForm').innerHTML=`<h2>Save your recovery code</h2><p>This code is shown once. Store it privately; it lets you reset your PIN after signing in with email.</p><output class="pf-recovery">${esc(recoveryCode)}</output><button type="button" class="pf-btn primary" id="pfRecoverySaved">I saved my recovery code</button>`;$('pfRecoverySaved').onclick=()=>{markUnlocked();resolve(state);};}
    else{markUnlocked();resolve(state);}
   }catch(err){$('pfPinError').textContent=err.message;}finally{if(e.submitter?.isConnected)e.submitter.disabled=false;}};
   el.querySelector('input')?.focus();
  });
 }
 async function open(options){context=options;await refresh();version=state.pinVersion;
  if(!state.pinSet)await gate('setup');else if(!state.unlocked||(!remembered()&&sessionStorage.getItem('pf.pin.unlocked')!==String(version)))await gate();
  markUnlocked();
  if(!polling)polling=setInterval(async()=>{try{const previous=version,old=JSON.stringify([state.role,state.permissions]);await refresh();if(!locked&&(state.pinVersion!==previous||!state.unlocked)){sessionStorage.removeItem('pf.pin.unlocked');localStorage.removeItem('pf.pin.remember');await gate(state.pinSet?'unlock':'setup');}if(old!==JSON.stringify([state.role,state.permissions]))location.reload();}catch(_){if(!locked){gate('unlock');const e=document.getElementById('pfPinError');if(e)e.textContent='Could not verify access. Reconnect and unlock to continue.';}}},15000);
  return {...context.member,...state};
 }
 async function lock(){if(!context)return;await rpc('pf_pin_action',{payload:{action:'lock'}});sessionStorage.removeItem('pf.pin.unlocked');localStorage.removeItem('pf.pin.remember');await gate();}
 function attachProfile(){const wrap=document.querySelector('.pf-top-actions');if(!wrap||$('pfProfileMenu'))return;
  const preview=new URLSearchParams(location.search).get('preview')==='1';if(preview)state={email:'developer@example.invalid',name:'Demo Developer',role:'developer',permissions:null};
  const b=document.createElement('button');b.id='pfProfileMenu';b.className='pf-btn';b.textContent=(state?.name||state?.email||'My account')+' · '+role();wrap.prepend(b);
  if($('pfUserName'))$('pfUserName').textContent=state.name||state.email;if($('pfUserRole'))$('pfUserRole').textContent=role();
  b.onclick=()=>{const d=$('pfDialog');d.innerHTML='<h2>My account</h2><p>'+esc(state.name||state.email)+'</p><div class="pf-form-line"><button class="pf-btn" id="pfChangeOwnPin">Change my PIN</button><button class="pf-btn" id="pfLockDevice">Lock device</button><button class="pf-btn" id="pfSwitchUser">Switch user</button><button class="pf-btn" id="pfProfileClose">Close</button></div>';d.showModal();$('pfProfileClose').onclick=()=>d.close();$('pfSwitchUser').onclick=()=>root.PhoneFixAuth.logout();$('pfChangeOwnPin').onclick=()=>{d.close();if(preview){alert('PINs are not saved in the sample workspace.');return;}gate('change');};$('pfLockDevice').onclick=()=>{d.close();if(!preview)lock();};};
 }
 root.PhoneFixAccess={ALL,GROUPS,LEGACY,can,canMirror,canSend,assert,mayManage,open,lock,refresh,attachProfile,get member(){return state;},get locked(){return locked;},setPreview(member){state=member;},hash,recoveryCode:code};
 if(typeof module!=='undefined')module.exports=root.PhoneFixAccess;
})(typeof window==='undefined'?globalThis:window);
