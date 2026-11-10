/** Phone Fix operations mirror. Add as a separate file; preserve existing doGet/doPost. */
const PF_OPS_URL = 'https://nqmpplbddzigosyzwmbt.supabase.co';
const PF_OPS_KEY = 'sb_publishable_6LnFNGQR3dGBDWOGjF1ubg_pM3QODMl';
const PF_OPS_SHEET = '1xAIQT635B6m38KxAFCpaJe97Ist4csrwROVoMSECW80';
const PF_OPS_TABS = {sale:'Daily Sales',attendance:'Daily Attendance',rate:'Payroll Rates',adjustment:'Payroll Adjustments',payment:'Payroll Payments',note:'Customer Notes'};
const PF_OPS_HEADERS = ['Record ID','Version','Date / allocation date','Employee','Customer ID','Name','Phone','Ticket','Status','Cash','Card','Others','Total','Amount / daily rate','Payment date','Payment method','Rating','Description','Correction reason','Archived','Created by','Created at','Updated by','Updated at'];
function pfOperationsRequest_(name,payload){
 const response=UrlFetchApp.fetch(PF_OPS_URL+'/rest/v1/rpc/'+name,{method:'post',contentType:'application/json',headers:{apikey:PF_OPS_KEY},payload:JSON.stringify(payload),muteHttpExceptions:true});
 if(response.getResponseCode()>=300)throw new Error(name+' failed ('+response.getResponseCode()+'): '+response.getContentText().slice(0,1200));
 const body=response.getContentText();return body?JSON.parse(body):null;
}
function pfOperationsText_(value){const s=String(value==null?'':value);return /^[=+\-@\t\r]/.test(s)?"'"+s:s;}
function pfOperationsRow_(r){const d=r.data;return [r.id,r.version,r.day,r.employee_email||'',d.customer_id||'',d.name||'',d.phone||'',d.ticket_id||'',d.status||(r.kind==='note'?(d.resolved?'Resolved':'Active'):''),d.cash==null?'':d.cash/100,d.card==null?'':d.card/100,d.other==null?'':d.other/100,r.kind==='sale'?(d.cash+d.card+d.other)/100:'',d.amount==null?'':d.amount/100,d.paid_on||'',d.method||'',d.rating||'',d.description||'',d.reason||'',r.archived?'Yes':'No',r.created_by,r.created_at,r.updated_by,r.updated_at].map(v=>typeof v==='string'?pfOperationsText_(v):v);}
function pfSyncDailyOperations(){
 const lock=LockService.getScriptLock();if(!lock.tryLock(1000))return;
 try{
  const token=PropertiesService.getScriptProperties().getProperty('PF_OPERATIONS_TOKEN');if(!token)throw new Error('Set PF_OPERATIONS_TOKEN in Script properties first.');
  const batch=pfOperationsRequest_('pf_operations_sheet_pull',{token});if(batch.sheet_id!==PF_OPS_SHEET)throw new Error('Unexpected destination spreadsheet');
  const book=SpreadsheetApp.openById(PF_OPS_SHEET),sheets={};
  Object.keys(PF_OPS_TABS).forEach(kind=>{let s=book.getSheetByName(PF_OPS_TABS[kind]);if(!s){s=book.insertSheet(PF_OPS_TABS[kind]);s.getRange(1,1,1,PF_OPS_HEADERS.length).setValues([PF_OPS_HEADERS]).setFontWeight('bold').setBackground('#f3e5d4');s.setFrozenRows(1);s.setColumnWidths(1,PF_OPS_HEADERS.length,140);s.setColumnWidth(18,320);s.getRange('J:N').setNumberFormat('$#,##0.00');}else if(s.getRange(1,1).getValue()!=='Record ID')throw new Error('Tab '+PF_OPS_TABS[kind]+' already exists with a different layout; refusing to overwrite it.');sheets[kind]=s;});
  const ack=[];
  batch.records.forEach(r=>{try{const s=sheets[r.kind];if(!s)throw new Error('Unknown record type');const values=s.getLastRow()>1?s.getRange(2,1,s.getLastRow()-1,2).getValues():[];const i=values.findIndex(x=>String(x[0])===r.id);if(i<0||Number(values[i][1])<=r.version){s.getRange(i<0?s.getLastRow()+1:i+2,1,1,PF_OPS_HEADERS.length).setValues([pfOperationsRow_(r)]);SpreadsheetApp.flush();}ack.push({id:r.id,version:r.version});}catch(e){ack.push({id:r.id,version:0,error:String(e.message).slice(0,500)});}});
  if(ack.length)pfOperationsRequest_('pf_operations_sheet_ack',{token,records:ack});
 }finally{lock.releaseLock();}
}
function pfInstallDailyOperationsSync(){
 pfSyncDailyOperations();
 if(!ScriptApp.getProjectTriggers().some(t=>t.getHandlerFunction()==='pfSyncDailyOperations'))ScriptApp.newTrigger('pfSyncDailyOperations').timeBased().everyMinutes(5).create();
}
