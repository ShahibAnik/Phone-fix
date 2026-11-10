(function () {
  'use strict';
  const URL = 'https://nqmpplbddzigosyzwmbt.supabase.co';
  const KEY = 'sb_publishable_6LnFNGQR3dGBDWOGjF1ubg_pM3QODMl';
  const SESSION = 'pf.auth.session.v1';
  const RETURN_URL = 'https://phone-fix-site.vercel.app/';
  const REMEMBER = 'pf.auth.rememberUntil.v2';
  const IDENTITY_UNTIL = 'pf.auth.identityUntil.v1';
  let gateContext, firstPasswordSignIn = false;
  let session = null, refreshPromise, booted = false;
  const preview = new URLSearchParams(location.search).get('preview') === '1';
  const nativeFetch = window.fetch.bind(window);
  const $ = id => document.getElementById(id);
  async function raw(path, options = {}, token) {
    const response = await nativeFetch(URL + path, {
      ...options,
      headers: { apikey: KEY, 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...options.headers },
      signal: options.signal || AbortSignal.timeout(20000)
    });
    const value = await response.text();
    let result; try { result = value ? JSON.parse(value) : null; } catch (_) { result = null; }
    if (!response.ok) throw new Error(result?.msg || result?.message || result?.error_description || 'Connection failed. Please try again.');
    return result;
  }
  function saveSession(value) {
    session = value;
    if (value) {
      if (!Number(localStorage.getItem(IDENTITY_UNTIL))) localStorage.setItem(IDENTITY_UNTIL,String(Date.now()+30*86400000));
      sessionStorage.setItem(SESSION,JSON.stringify(value));localStorage.setItem(SESSION,JSON.stringify(value));
    } else {
      localStorage.removeItem(SESSION);sessionStorage.removeItem(SESSION);localStorage.removeItem(REMEMBER);localStorage.removeItem(IDENTITY_UNTIL);
      localStorage.removeItem('pf.pin.remember');sessionStorage.removeItem('pf.pin.unlocked');
    }
  }
  async function token() {
    if (!session) throw new Error('Sign in to sync your changes');
    if (session.expires_at * 1000 > Date.now() + 60000) return session.access_token;
    if (!refreshPromise) refreshPromise = raw('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: JSON.stringify({ refresh_token: session.refresh_token }) })
      .then(value => { saveSession(value); return value.access_token; }).finally(() => { refreshPromise = null; });
    return refreshPromise;
  }
  async function request(path, options) { return raw(path, options, await token()); }
  async function enter() {
    const user = await request('/auth/v1/user');
    const members = await request('/rest/v1/rpc/pf_claim_membership', { method: 'POST', body: '{}' });
    if (!members?.length) throw new Error('Your email is confirmed. Ask your store manager to allow this email in Team access, then sign in again.');
    gateContext = await window.PhoneFixAccess.open({user, member:members[0], request, firstPasswordSignIn});
    firstPasswordSignIn = false;
    if (booted) return;
    let accessCheckedAt=0, accessPromise;
    async function verifyAccess(){
      if (window.PhoneFixAccess.locked) throw new Error('Unlock your workspace first');
      if(Date.now()-accessCheckedAt<10000)return;
      if(!accessPromise)accessPromise=request('/rest/v1/pf_members?select=role,revoked_at&user_id=eq.'+encodeURIComponent(user.id)).then(rows=>{
        if(!rows[0]||rows[0].revoked_at){
          document.body.classList.add('pf-locked');
          if($('pfRevokedSignOut'))throw new Error('Your store access has been removed');
          const notice=document.createElement('div');notice.id='pfLogin';notice.innerHTML='<section class="pf-login-panel"><div><h2>Store access removed</h2><p>Contact your manager if you need access again.</p><button id="pfRevokedSignOut" class="pf-btn">Sign out</button></div></section>';document.body.append(notice);$('pfRevokedSignOut').onclick=logout;
          throw new Error('Your store access has been removed');
        }
        return window.PhoneFixAccess.refresh().then(access=>{if(!access.unlocked)throw new Error('Unlock your workspace first');accessCheckedAt=Date.now();});
      }).finally(()=>accessPromise=null);
      return accessPromise;
    }
    const googleFetch=window.fetch.bind(window);
    window.fetch=async(input,options)=>{const url=String(input?.url||input);if(url.includes('script.google.com')||url.includes('script.googleusercontent.com'))await verifyAccess();return googleFetch(input,options);};
    await window.PhoneFixWorkspace.boot({ preview: false, user, member: gateContext, request, logout });
    window.PhoneFixAccess.attachProfile();
    setInterval(()=>verifyAccess().catch(()=>{}),15000);
    booted = true;
    $('pfLogin')?.remove();
  }
  async function logout() {
    try { await request('/auth/v1/logout?scope=local', { method: 'POST' }); } catch (_) { /* Local session is always cleared. */ }
    saveSession(null); location.href = location.pathname;
  }
  window.PhoneFixAuth = { request, logout, token, remember: checked => { if(checked)localStorage.setItem(REMEMBER,String(Date.now()+30*86400000));else localStorage.removeItem(REMEMBER); if(session)saveSession(session); } };
  if (preview) { window.PhoneFixWorkspace.boot({ preview: true }).then(()=>window.PhoneFixAccess.attachProfile()); return; }
  const login = document.createElement('div'); login.id = 'pfLogin';
  login.innerHTML = `<section class="pf-login-brand">
    <div class="pf-brand"><span class="pf-brand-mark">${PhoneFixWorkspace.icon('phone',22)}</span><div><b>phonefix<span style="color:#72936d">.</span></b><small>Store workspace</small></div></div>
    <div><span class="pf-badge">MADE FOR YOUR EVERYDAY</span><h1>Less busywork.<br>More good repairs.</h1><p>Your customers, repairs, inventory, and team. Together in one calm workspace.</p><div class="pf-login-art">${PhoneFixWorkspace.icon('check',25)}<div><b style="font-size:12px;color:#476c4e">Everything in its place.</b><div style="font-size:10px;color:#81947d;margin-top:4px">From the first hello to the final pickup.</div></div></div></div>
    <small>PHONE FIX ACCESSORIES · PHILADELPHIA</small>
  </section><section class="pf-login-panel"><form class="pf-login-form" id="pfAuthForm">
    <h2 id="pfAuthTitle">Welcome back</h2><p id="pfAuthSubtitle">Sign in to your store workspace.</p>
    <label for="pfEmail">Work email</label><input id="pfEmail" type="email" autocomplete="username" placeholder="you@example.com" required>
    <label for="pfPassword">Password</label><input id="pfPassword" type="password" autocomplete="current-password" minlength="8" placeholder="Enter your password" required>
    <label id="pfConfirmLabel" for="pfPasswordConfirm" hidden>Confirm new password</label><input id="pfPasswordConfirm" type="password" autocomplete="new-password" minlength="8" hidden>
    <label class="pf-remember"><input id="pfRemember" type="checkbox"> Stay logged in on this device for 30 days</label>
    <div id="pfAuthMessage" class="pf-auth-message" role="status" aria-live="polite"></div>
    <button class="pf-btn primary" id="pfAuthSubmit" type="submit">Sign in ${PhoneFixWorkspace.icon('arrow',15)}</button>
    <div class="pf-login-links"><button type="button" id="pfCreateAccount">Set up your account</button><button type="button" id="pfForgot">Forgot password?</button><button type="button" id="pfResend">Resend verification email</button></div>
    <p class="pf-note">Access is managed by your store manager.<br><a href="?preview=1" style="color:#568160">Explore the workspace with sample data →</a></p>
  </form></section>`;
  document.body.append(login);
  let mode = 'signin';
  function message(value, success = false) { $('pfAuthMessage').textContent = value; $('pfAuthMessage').classList.toggle('success', success); }
  $('pfCreateAccount').onclick = () => {
    if(mode==='recovery') { saveSession(null); location.replace(location.pathname); return; }
    mode = mode === 'signup' ? 'signin' : 'signup';
    $('pfAuthTitle').textContent = mode === 'signup' ? 'Make yourself at home' : 'Welcome back';
    $('pfAuthSubtitle').textContent = mode === 'signup' ? 'Use the email your manager has approved.' : 'Sign in to your store workspace.';
    $('pfAuthSubmit').textContent = mode === 'signup' ? 'Create account' : 'Sign in';
    $('pfCreateAccount').textContent = mode === 'signup' ? 'Already have an account? Sign in' : 'Set up your account';
    $('pfPassword').autocomplete = mode === 'signup' ? 'new-password' : 'current-password'; $('pfPasswordConfirm').hidden=$('pfConfirmLabel').hidden=mode!=='signup';$('pfPasswordConfirm').required=mode==='signup'; message('');
  };
  $('pfForgot').onclick = async () => {
    if (!$('pfEmail').reportValidity()) return;
    try { await raw('/auth/v1/recover?redirect_to=' + encodeURIComponent(RETURN_URL), { method: 'POST', body: JSON.stringify({ email: $('pfEmail').value }) }); message('If this account exists, a password reset email is on its way.', true); }
    catch (e) { message(e.message); }
  };
  $('pfResend').onclick = async () => {
    if (!$('pfEmail').reportValidity()) return;
    $('pfResend').disabled=true;
    try { await raw('/auth/v1/resend?redirect_to='+encodeURIComponent(RETURN_URL), {method:'POST',body:JSON.stringify({type:'signup',email:$('pfEmail').value.trim()})}); message('If verification is needed, a fresh email is on its way. Use the newest email.',true); } catch(e) { message(e.message); } finally {$('pfResend').disabled=false;}
  };
  $('pfAuthForm').onsubmit = async event => {
    event.preventDefault(); const button = $('pfAuthSubmit'); button.disabled = true; message('');
    try {
      const email = $('pfEmail').value.trim(), password = $('pfPassword').value;
      if((mode==='signup'||mode==='recovery') && password!==$('pfPasswordConfirm').value)throw new Error('The passwords do not match.');
      PhoneFixAuth.remember($('pfRemember').checked);
      if (mode === 'signup') {
        const result = await raw('/auth/v1/signup?redirect_to=' + encodeURIComponent(RETURN_URL), { method: 'POST', body: JSON.stringify({ email, password }) });
        if (result?.access_token) { saveSession(result); await enter(); }
        else message('Check your email to confirm your account, then return here and sign in.', true);
      } else if (mode === 'recovery') {
        await request('/auth/v1/user', { method: 'PUT', body: JSON.stringify({ password }) });
        message('Password updated. Signing you in…', true); firstPasswordSignIn=true; sessionStorage.removeItem('pf.pin.unlocked');localStorage.removeItem('pf.pin.remember');await enter();
      } else {
        saveSession(await raw('/auth/v1/token?grant_type=password', { method: 'POST', body: JSON.stringify({ email, password }) })); firstPasswordSignIn=true; sessionStorage.removeItem('pf.pin.unlocked');localStorage.removeItem('pf.pin.remember');await enter();
      }
    } catch (error) { message(error.message); }
    finally { button.disabled = false; }
  };
  (async () => {
    const hash = new URLSearchParams(location.hash.slice(1));
    if(hash.has('error') || hash.has('error_code')) {
      history.replaceState(null,'',location.pathname);
      saveSession(null);
      message('This email link has expired or was already used. Enter your email and request a new password reset or verification email.');
      return;
    }
    if (hash.has('access_token')) {
      saveSession({ access_token: hash.get('access_token'), refresh_token: hash.get('refresh_token'), expires_at: Math.floor(Date.now()/1000) + Number(hash.get('expires_in') || 3600) });
      history.replaceState(null, '', location.pathname);
      if (hash.get('type') === 'recovery') {
        mode = 'recovery'; $('pfPasswordConfirm').hidden=$('pfConfirmLabel').hidden=false; $('pfPasswordConfirm').required=true; $('pfPassword').autocomplete='new-password'; $('pfCreateAccount').textContent='Cancel and sign in'; $('pfForgot').hidden=$('pfResend').hidden=true; $('pfAuthTitle').textContent = 'Choose a new password'; $('pfAuthSubtitle').textContent = 'Use at least 8 characters.'; $('pfAuthSubmit').textContent = 'Save password';
        const user = await request('/auth/v1/user'); $('pfEmail').value = user.email; $('pfEmail').readOnly = true; return;
      }
    } else try { session = JSON.parse(sessionStorage.getItem(SESSION) || (Number(localStorage.getItem(IDENTITY_UNTIL))>Date.now()?localStorage.getItem(SESSION):'null')); if(!session) localStorage.removeItem(SESSION); } catch (_) { /* No saved session. */ }
    if (session) try { message('Opening your workspace…', true); await enter(); } catch (error) { message(error.message); }
  })().catch(e => message(e.message));
})();
