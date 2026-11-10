(function(root){
'use strict';
const cents=v=>{const n=Number(v);if(!Number.isFinite(n)||Math.abs(n)>100000000)throw Error('Enter a valid amount');return Math.round(n*100);};
const phone=v=>{const s=String(v||'').replace(/\D/g,'');return s.length===11&&s[0]==='1'?s.slice(1):s;};
const date=(d=new Date())=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(d);
const addDays=(d,n)=>{const v=new Date(d+'T12:00:00Z');v.setUTCDate(v.getUTCDate()+n);return v.toISOString().slice(0,10);};
function payroll(rows,user,from,to){
 const own=rows.filter(r=>r.user_id===user&&!r.archived),rates=own.filter(r=>r.kind==='rate').sort((a,b)=>b.day.localeCompare(a.day));
 const days=own.filter(r=>r.kind==='attendance'&&r.day>=from&&r.day<=to).sort((a,b)=>a.day.localeCompare(b.day));
 let units=0,earned=0,missing=0;
 const detail=days.map(r=>{const count={present:1,half:0.5,absent:0,off:0}[r.data.status]||0,rate=rates.find(x=>x.day<=r.day);units+=count;if(count&&!rate)missing++;const amount=count&&rate?Math.round(rate.data.amount*count):0;earned+=amount;return {...r,units:count,rate:rate?.data.amount,amount};});
 const adjustments=own.filter(r=>r.kind==='adjustment'&&r.day>=from&&r.day<=to).reduce((a,r)=>a+r.data.amount,0);
 // Payment allocation date belongs to the pay period; actual paid date is kept separately.
 const payments=own.filter(r=>r.kind==='payment'&&r.day>=from&&r.day<=to),paid=payments.reduce((a,r)=>a+r.data.amount,0),total=earned+adjustments;
 return {units,earned,adjustments,total,paid,balance:total-paid,missing,detail,payments};
}
function analytics(rows,from,to){const sales=rows.filter(r=>r.kind==='sale'&&!r.archived&&r.day>=from&&r.day<=to).sort((a,b)=>a.day.localeCompare(b.day));const values=sales.map(r=>({...r,total:r.data.cash+r.data.card+r.data.other}));const total=values.reduce((s,r)=>s+r.total,0),days=Math.round((new Date(to+'T12:00:00Z')-new Date(from+'T12:00:00Z'))/86400000)+1;const prevFrom=addDays(from,-days),prevTo=addDays(from,-1),previous=rows.filter(r=>r.kind==='sale'&&!r.archived&&r.day>=prevFrom&&r.day<=prevTo);const previousTotal=previous.reduce((s,r)=>s+r.data.cash+r.data.card+r.data.other,0);return {values,total,count:values.length,missing:days-values.length,average:values.length?Math.round(total/values.length):null,best:[...values].sort((a,b)=>b.total-a.total)[0],worst:[...values].sort((a,b)=>a.total-b.total)[0],previousTotal,previousCount:previous.length,change:previous.length&&previousTotal?(total-previousTotal)/previousTotal*100:null};}
const api={cents,phone,date,addDays,payroll,analytics};root.PhoneFixOperationsCore=api;if(typeof module!=='undefined')module.exports=api;
})(typeof window==='undefined'?globalThis:window);
