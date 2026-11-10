(function(root){
 'use strict';
 const key='phoneRepairIntakes',profilesKey='phoneRepairCustomerProfiles',usageKey='phoneRepairPartUsage';
 const clone=o=>JSON.parse(JSON.stringify(o));
 function changed(kind,id,before,value){return kind==='repairs'&&(value.id!==id||value.customerId!==before.customerId)||kind==='customers'&&value.customerId!==id;}
 function plan(kind,id,before,value,snapshot,actor,now=new Date().toISOString()){
  const next=clone(snapshot),ticketChange=kind==='repairs'&&value.id!==id,oldCustomer=kind==='customers'?id:before.customerId,newCustomer=value.customerId,customerChange=oldCustomer!==newCustomer;
  if(!ticketChange&&!customerChange)return next;
  const clean=v=>typeof v==='string'&&v.trim()===v&&/^[A-Za-z0-9][A-Za-z0-9_-]{1,79}$/.test(v);
  if(ticketChange&&!clean(value.id)||customerChange&&!clean(newCustomer))throw new Error('IDs must be 2–80 letters, numbers, hyphens or underscores.');
  if(ticketChange&&next.repairs.some(r=>r.id!==id&&r.id.toLowerCase()===value.id.toLowerCase()))throw new Error('Ticket ID already exists: '+value.id);
  if(customerChange&&(Object.keys(next.customers).some(k=>k!==oldCustomer&&k.toLowerCase()===newCustomer.toLowerCase())||next.repairs.some(r=>r.customerId!==oldCustomer&&r.customerId?.toLowerCase()===newCustomer.toLowerCase())))throw new Error('Customer ID already exists: '+newCustomer);
  if(customerChange&&!oldCustomer)throw new Error('This record has no customer ID to rename. Create or link its customer profile first.');
  const note=(a,b)=>`ID changed from ${a} to ${b} by ${actor} on ${now}.`;
  if(kind==='repairs'){const pos=next.repairs.findIndex(r=>r.id===id);if(pos<0)throw new Error('Ticket no longer exists');next.repairs[pos]=clone(value);if(ticketChange){next.repairs[pos].notes=[next.repairs[pos].notes,note(id,value.id)].filter(Boolean).join('\n');next.usage.forEach(u=>{if(u.ticketId===id)u.ticketId=value.id;});}}
  if(customerChange){if(!next.customers[oldCustomer])throw new Error('Customer profile '+oldCustomer+' is missing; cannot relink safely.');next.customers[newCustomer]={...(kind==='customers'?clone(value):next.customers[oldCustomer]),customerId:newCustomer};delete next.customers[oldCustomer];next.repairs.forEach(r=>{if(r.customerId===oldCustomer||r.id===(ticketChange?value.id:id)){r.customerId=newCustomer;r.notes=[r.notes,note(oldCustomer,newCustomer)].filter(Boolean).join('\n');}});}
  return next;
 }
 const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
 const rows=value=>Array.isArray(value)?value:(value&&(value.data||value.rows))||[];
 async function verify(read,check,label){
  let last;
  for(let attempt=0;attempt<10;attempt++){
   try{const value=rows(await read());if(check(value))return value;last=null;}catch(err){last=err;}
   await delay(1000);
  }
  throw last||new Error(label+' could not be verified. The original ID was kept.');
 }
 async function rename(kind,id,before,value,ctx){
  PhoneFixAccess.assert('history_edit');
  if(!['developer','owner'].includes(PhoneFixAccess.member?.role))throw new Error('Only an Owner or Developer can change Ticket IDs or Customer IDs.');
  const snapshot={repairs:JSON.parse(localStorage.getItem(key)||'[]'),customers:JSON.parse(localStorage.getItem(profilesKey)||'{}'),usage:JSON.parse(localStorage.getItem(usageKey)||'[]')};
  const next=plan(kind,id,before,value,snapshot,PhoneFixAccess.member.name||PhoneFixAccess.member.email);
  const ticketChange=kind==='repairs'&&value.id!==id,oldCustomer=kind==='customers'?id:before.customerId,newCustomer=value.customerId,customerChange=oldCustomer!==newCustomer;
  if(ticketChange&&customerChange)throw new Error('Change the Ticket ID and Customer ID one at a time so each linked change can be verified.');
  if(!confirm('You are changing an ID. This affects linked records. Continue?'))throw new Error('ID change cancelled. Nothing was changed.');
  if(ctx.preview){localStorage.setItem(key,JSON.stringify(next.repairs));localStorage.setItem(profilesKey,JSON.stringify(next.customers));localStorage.setItem(usageKey,JSON.stringify(next.usage));window.dispatchEvent(new Event('pf:data'));return;}
  const serverKind=ticketChange?'ticket':'customer',oldId=ticketChange?id:oldCustomer,newId=ticketChange?value.id:newCustomer;
  await ctx.request('/rest/v1/rpc/pf_identity_change',{method:'POST',body:JSON.stringify({payload:{action:'validate',kind:serverKind,oldId:oldId,newId:newId}})});
  const repairBridge=root.PhoneFixRepairBridge,usageBridge=root.PhoneFixUsageBridge;
  if(!repairBridge)throw new Error('Repair sync is not ready. The original ID was kept.');
  if(ticketChange){
   const changedRepair=next.repairs.find(r=>r.id===newId);if(!changedRepair)throw new Error('Renamed ticket could not be prepared.');
   const affectedUsage=next.usage.filter(u=>u.ticketId===newId&&snapshot.usage.some(old=>old.id===u.id&&old.ticketId===oldId));
   if(affectedUsage.length&&!usageBridge)throw new Error('Part usage sync is not ready. The original ID was kept.');
   await repairBridge.stage(changedRepair,false);await Promise.all(affectedUsage.map(u=>usageBridge.stage(u)));
   await verify(repairBridge.read,rs=>rs.some(r=>String(r.ticketId)===newId),'The new Ticket ID');
   if(affectedUsage.length)await verify(usageBridge.read,rs=>affectedUsage.every(u=>rs.some(r=>String(r.id)===String(u.id)&&String(r.ticketId)===newId)),'Linked part usage');
  }
  if(customerChange){
   const affected=next.repairs.filter(r=>r.customerId===newId&&snapshot.repairs.some(old=>old.id===r.id&&old.customerId===oldId));
   for(const r of affected)await repairBridge.stage(r,false);
   if(affected.length)await verify(repairBridge.read,rs=>affected.every(r=>rs.some(row=>String(row.ticketId)===r.id&&String(row.customerId)===newId)),'Linked customer tickets');
  }
  await ctx.request('/rest/v1/rpc/pf_identity_change',{method:'POST',body:JSON.stringify({payload:{action:'commit',kind:serverKind,oldId:oldId,newId:newId}})});
  localStorage.setItem(key,JSON.stringify(next.repairs));localStorage.setItem(profilesKey,JSON.stringify(next.customers));localStorage.setItem(usageKey,JSON.stringify(next.usage));window.dispatchEvent(new Event('pf:data'));
  if(ticketChange)await repairBridge.stage(before,true);
 }
 root.PhoneFixIdentity={plan,rename,changed};if(typeof module!=='undefined')module.exports=root.PhoneFixIdentity;
})(typeof window==='undefined'?globalThis:window);
