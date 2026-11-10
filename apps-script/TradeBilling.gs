/** Add alongside DailyOperations.gs. Uses the same restricted connector token. */
const PF_TRADE_TAB='Store & Employee Billing';
const PF_TRADE_HEADERS=['Record ID','Account ID','Account type','Store / employee','Date','Type','Item','Quantity','Buying unit price','Selling unit price','Amount','Payment method','Description','Inventory type','Inventory ID','Stock before','Stock after','Recorded by','Recorded at','Stock sync'];
function pfTradeRow_(r,status){return [r.id,r.account_id,r.account_kind,r.account_name,r.day,r.kind,r.item||'',r.quantity||'',r.unit_cost==null?'':r.unit_cost/100,r.unit_price==null?'':r.unit_price/100,r.amount/100,r.method||'',r.description||'',r.source_kind||'',r.source_id||'',r.stock_before?JSON.stringify(r.stock_before):'',r.stock_after?JSON.stringify(r.stock_after):'',r.created_by,r.created_at,status].map(v=>typeof v==='string'?pfOperationsText_(v):v);}
function pfTradeStock_(book,records){
 const latest=records[records.length-1],kind=latest.source_kind,tab={inventory:'Inventory',parts:'Parts',accessories:'Accessories'}[kind],s=book.getSheetByName(tab);
 if(!s)throw Error('Inventory tab missing: '+tab);
 const values=s.getDataRange().getValues(),head=values[0].map(String),key=head.indexOf(kind==='inventory'?'IMEI':'SKU'),qty=head.indexOf('Qty');
 if(key<0||qty<0)throw Error('Inventory headers missing');
 const matches=values.map((r,i)=>String(r[key]).trim()===latest.source_id?i:-1).filter(i=>i>0);if(matches.length!==1)throw Error('Inventory ID must match exactly one row');
 const row=matches[0],current=Number(values[row][qty]),target=Number(latest.stock_after.qty);
 // An unrelated quantity change is never overwritten silently.
 if(!records.some(r=>Number(r.stock_before.qty)===current||Number(r.stock_after.qty)===current))throw Error('Stock conflict. Check '+tab+' / '+latest.source_id+' before retrying');
 if(current!==target)s.getRange(row+1,qty+1).setValue(target);
 if(kind==='inventory'&&latest.stock_after.status==='Sold')for(const pair of [['Status','status'],['Sold Price','soldPrice'],['Sold Date','soldDate'],['Customer Name','custName']]){const col=head.indexOf(pair[0]);if(col<0)throw Error('Missing '+pair[0]);const v=latest.stock_after[pair[1]];s.getRange(row+1,col+1).setValue(typeof v==='string'?pfOperationsText_(v):v);}
 SpreadsheetApp.flush();
}
function pfSyncTradeBilling(){const lock=LockService.getScriptLock();if(!lock.tryLock(1000))return;try{
 const token=PropertiesService.getScriptProperties().getProperty('PF_OPERATIONS_TOKEN');if(!token)throw Error('Operations connector is not configured');
 const batch=pfOperationsRequest_('pf_trade_sheet_pull',{token});if(batch.sheet_id!==PF_OPS_SHEET)throw Error('Unexpected spreadsheet');
 const book=SpreadsheetApp.openById(PF_OPS_SHEET);let s=book.getSheetByName(PF_TRADE_TAB);if(!s){s=book.insertSheet(PF_TRADE_TAB);s.getRange(1,1,1,PF_TRADE_HEADERS.length).setValues([PF_TRADE_HEADERS]).setFontWeight('bold');s.setFrozenRows(1);s.getRange('I:K').setNumberFormat('$#,##0.00');}else if(s.getRange(1,1,1,PF_TRADE_HEADERS.length).getValues()[0].join('|')!==PF_TRADE_HEADERS.join('|'))throw Error('Billing tab layout differs; existing data preserved');
 const entries=batch.records.sort((a,b)=>a.created_at.localeCompare(b.created_at)||a.id.localeCompare(b.id)),groups={},errors={};
 entries.filter(r=>r.stock_after).forEach(r=>{const key=r.source_kind+':'+r.source_id;(groups[key]||(groups[key]=[])).push(r);});
 Object.keys(groups).forEach(key=>{try{pfTradeStock_(book,groups[key]);}catch(e){groups[key].forEach(r=>errors[r.id]=String(e.message).slice(0,500));}});
 const ids=s.getLastRow()>1?s.getRange(2,1,s.getLastRow()-1,1).getValues().map(r=>String(r[0])):[],ack=[];
 entries.forEach(r=>{try{let i=ids.indexOf(r.id);if(i<0){i=ids.length;ids.push(r.id);}s.getRange(i+2,1,1,PF_TRADE_HEADERS.length).setValues([pfTradeRow_(r,errors[r.id]||'Complete')]);SpreadsheetApp.flush();ack.push({id:r.id,ok:!errors[r.id],error:errors[r.id]||''});}catch(e){ack.push({id:r.id,ok:false,error:String(e.message).slice(0,500)});}});
 if(ack.length)pfOperationsRequest_('pf_trade_sheet_ack',{token,records:ack});
 }finally{lock.releaseLock();}}
function pfInstallTradeBillingSync(){pfSyncTradeBilling();if(!ScriptApp.getProjectTriggers().some(t=>t.getHandlerFunction()==='pfSyncTradeBilling'))ScriptApp.newTrigger('pfSyncTradeBilling').timeBased().everyMinutes(5).create();}
