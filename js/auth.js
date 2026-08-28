// ============================================================
//  AUTH.JS  — login, signup, Google OAuth, session guard
// ============================================================

// Guard: redirect to login if not signed in
async function requireAuth(redirectTo='login.html'){
  const {data:{session}}=await sb.auth.getSession();
  if(!session){ window.location.href=redirectTo; return null; }
  return session.user;
}

// Guard: redirect to dashboard if already signed in
async function requireGuest(redirectTo='dashboard.html'){
  const {data:{session}}=await sb.auth.getSession();
  if(session) window.location.href=redirectTo;
}

// Log out
document.addEventListener('DOMContentLoaded',()=>{
  const logoutBtn=document.getElementById('logoutBtn');
  if(logoutBtn) logoutBtn.onclick=async()=>{
    await sb.auth.signOut(); window.location.href='login.html';
  };
});

// ── LOGIN PAGE ──────────────────────────────────────────────
if(document.getElementById('loginBtn')){

  // ── PASSWORD RECOVERY ────────────────────────────────────
  // Handles BOTH implicit (#access_token&type=recovery)
  // and PKCE (?code=xxx) reset flows.
  let recoveryMode = false;

  function showResetPanel(){
    recoveryMode = true;
    document.querySelectorAll('.auth-panel').forEach(p=>p.classList.remove('active'));
    document.querySelectorAll('.auth-tab').forEach(t=>t.classList.remove('active'));
    const panel=document.getElementById('panel-reset');
    if(panel){ panel.classList.add('active'); }
  }

  // PKCE flow: onAuthStateChange fires after code is exchanged
  sb.auth.onAuthStateChange(async(event,session)=>{
    if(event==='PASSWORD_RECOVERY') showResetPanel();
  });

  // Implicit flow: type=recovery appears in hash immediately
  const _hp=new URLSearchParams(window.location.hash.replace('#',''));
  if(_hp.get('type')==='recovery') recoveryMode=true;

  // If URL has a ?code= param it could be PKCE recovery — delay
  // requireGuest by 400ms so onAuthStateChange fires first
  const _hasCode=new URLSearchParams(window.location.search).has('code');
  setTimeout(()=>{
    if(!recoveryMode) requireGuest();
  }, _hasCode ? 400 : 0);

  // ── Reset password submit ─────────────────────────────────
  const saveNewPwBtn=document.getElementById('saveNewPwBtn');
  if(saveNewPwBtn){
    saveNewPwBtn.onclick=async()=>{
      const pw=document.getElementById('newPassword').value;
      const pw2=document.getElementById('newPassword2').value;
      if(!pw||pw.length<8){msg('resetMsg','Password must be at least 8 characters.',true);return;}
      if(pw!==pw2){msg('resetMsg','Passwords do not match.',true);return;}
      msg('resetMsg','Updating password…');
      const {error}=await sb.auth.updateUser({password:pw});
      if(error){msg('resetMsg',error.message,true);return;}
      msg('resetMsg','Password updated! Redirecting to dashboard…');
      setTimeout(()=>window.location.href='dashboard.html',1500);
    };
  }

  // ── Email login ───────────────────────────────────────────
  document.getElementById('loginBtn').onclick=async()=>{
    const email=document.getElementById('loginEmail').value.trim();
    const pass =document.getElementById('loginPassword').value;
    if(!email||!pass){msg('loginMsg','Enter email and password.',true);return;}
    msg('loginMsg','Signing in…');
    const {error}=await sb.auth.signInWithPassword({email,password:pass});
    if(error){msg('loginMsg',error.message,true);return;}
    window.location.href='dashboard.html';
  };

  // ── Google OAuth ──────────────────────────────────────────
  document.getElementById('googleLoginBtn').onclick=async()=>{
    await sb.auth.signInWithOAuth({provider:'google',options:{redirectTo:window.location.origin+'/dashboard.html'}});
  };
  document.getElementById('googleSignupBtn').onclick=async()=>{
    await sb.auth.signInWithOAuth({provider:'google',options:{redirectTo:window.location.origin+'/dashboard.html'}});
  };

  // ── Forgot password ───────────────────────────────────────
  document.getElementById('forgotBtn').onclick=async(e)=>{
    e.preventDefault();
    const email=document.getElementById('loginEmail').value.trim();
    if(!email){msg('loginMsg','Enter your email address first.',true);return;}
    msg('loginMsg','Sending reset email…');
    const {error}=await sb.auth.resetPasswordForEmail(email,{
      redirectTo:window.location.origin+'/login.html'
    });
    if(error){msg('loginMsg',error.message,true);return;}
    msg('loginMsg','Reset email sent! Check your inbox and click the link.');
  };

  // ── Signup ────────────────────────────────────────────────
  document.getElementById('signupBtn').onclick=async()=>{
    const name    =document.getElementById('signupName').value.trim();
    const email   =document.getElementById('signupEmail').value.trim();
    const pass    =document.getElementById('signupPassword').value;
    const whatsapp=document.getElementById('signupWhatsapp').value.trim();
    const payday  =document.getElementById('signupPayday').value;

    if(!name||!email||!pass){msg('signupMsg','Name, email and password are required.',true);return;}
    if(pass.length<8){msg('signupMsg','Password must be at least 8 characters.',true);return;}

    msg('signupMsg','Creating your account…');
    const {data,error}=await sb.auth.signUp({email,password:pass,options:{data:{full_name:name}}});
    if(error){msg('signupMsg',error.message,true);return;}

    await sb.from('profiles').upsert({
      id:data.user.id, full_name:name, email, whatsapp, payday_date:Number(payday),
      income:55000, reminder_day:'Saturday', chase_every_days:2,
      created_at:new Date().toISOString(), last_active:new Date().toISOString()
    });

    msg('signupMsg','Account created! Redirecting to setup…');
    setTimeout(()=>window.location.href='setup.html',1200);
  };

  // ── Enter key shortcuts ───────────────────────────────────
  document.getElementById('loginPassword').addEventListener('keydown',e=>{
    if(e.key==='Enter') document.getElementById('loginBtn').click();
  });
  document.getElementById('signupPassword').addEventListener('keydown',e=>{
    if(e.key==='Enter') document.getElementById('signupBtn').click();
  });
}
