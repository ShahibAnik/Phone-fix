from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
from pathlib import Path
site=Path('/Users/anik/codex/phone-fix-team-release/site')
fixture=r'''<script>
window.__loginFixture={pinSet:false,unlocked:false,calls:[]};
window.fetch=async function(url,options){
 const p=String(url);const s=window.__loginFixture;s.calls.push(p);
 const data=p.includes('/auth/v1/token')?{access_token:'fixture-token',refresh_token:'fixture-refresh',expires_at:Math.floor(Date.now()/1000)+3600}:
 p.endsWith('/auth/v1/user')?{id:'fixture-user',email:'fixture@example.invalid'}:
 p.includes('/pf_claim_membership')?[{user_id:'fixture-user',email:'fixture@example.invalid',role:'manager',team_role:'developer'}]:
 p.includes('/pf_access_context')?{role:'developer',email:'fixture@example.invalid',name:'Sign-in Test',permissions:null,pinSet:s.pinSet,pinVersion:s.pinSet?1:0,unlocked:s.unlocked}:
 p.includes('/pf_pin_action')?(s.pinSet=true,s.unlocked=true,{ok:true,version:1}):
 p.includes('/pf_members')?[{role:'manager',revoked_at:null}]:[];
 return new Response(JSON.stringify(data),{status:200,headers:{'Content-Type':'application/json'}});
};
window.addEventListener('load',()=>{sessionStorage.clear();localStorage.clear();document.getElementById('pfEmail').value='fixture@example.invalid';document.getElementById('pfPassword').value='fixture-password';document.getElementById('pfAuthForm').requestSubmit();});
if(new URLSearchParams(location.search).has('complete')){let sent=false;const timer=setInterval(()=>{const form=document.getElementById('pfPinForm');if(form&&document.getElementById('pfNewPin')&&!sent){sent=true;document.getElementById('pfNewPin').value='1234';document.getElementById('pfRepeatPin').value='1234';form.requestSubmit();}document.getElementById('pfRecoverySaved')?.click();if(window.PhoneFixWorkspace?.ready)clearInterval(timer);},100);}
</script>'''
class Handler(SimpleHTTPRequestHandler):
 def __init__(self,*a,**kw):super().__init__(*a,directory=str(site),**kw)
 def do_GET(self):
  if self.path.startswith('/__tests/sign-in'):
   data=(site/'index.html').read_text().replace('<head>','<head>'+fixture,1).encode()
   self.send_response(200);self.send_header('Content-Type','text/html');self.send_header('Cache-Control','no-store');self.end_headers();self.wfile.write(data)
  else:super().do_GET()
ThreadingHTTPServer(('127.0.0.1',4182),Handler).serve_forever()
