// ============================================================
//  BUDGETFLOW REMINDER BOT — fixed for Node 20
// ============================================================

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const https = require('https');

// Pure REST calls — no Supabase realtime, no WebSocket needed
const SUPA_URL = process.env.SUPABASE_URL;
const SUPA_KEY = process.env.SUPABASE_SERVICE_KEY;
const RESEND_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = process.env.FROM_EMAIL || 'onboarding@resend.dev';
const SITE_URL   = process.env.SITE_URL   || 'https://budgetflow-6bs.pages.dev';

const INR = n => '₹' + Math.round(Number(n)||0).toLocaleString('en-IN');

// ── HTTP helpers ──────────────────────────────────────────────
function request(method, url, headers, body){
  return new Promise((resolve, reject)=>{
    const u = new URL(url);
    const opts = { method, hostname:u.hostname, path:u.pathname+u.search, headers };
    const req = https.request(opts, res=>{
      let d=''; res.on('data',c=>d+=c); res.on('end',()=>{
        try{ resolve({status:res.statusCode, body:JSON.parse(d)}); }
        catch(e){ resolve({status:res.statusCode, body:d}); }
      });
    });
    req.on('error', reject);
    if(body) req.write(typeof body==='string'?body:JSON.stringify(body));
    req.end();
  });
}

function sbGet(table, params=''){
  return request('GET', `${SUPA_URL}/rest/v1/${table}?${params}`, {
    'apikey': SUPA_KEY, 'Authorization': `Bearer ${SUPA_KEY}`,
    'Content-Type': 'application/json'
  });
}

function sbInsert(table, data){
  return request('POST', `${SUPA_URL}/rest/v1/${table}`, {
    'apikey': SUPA_KEY, 'Authorization': `Bearer ${SUPA_KEY}`,
    'Content-Type': 'application/json', 'Prefer': 'return=minimal'
  }, data);
}

function sbGetSingle(table, params=''){
  return request('GET', `${SUPA_URL}/rest/v1/${table}?${params}&limit=1`, {
    'apikey': SUPA_KEY, 'Authorization': `Bearer ${SUPA_KEY}`,
    'Content-Type': 'application/json', 'Accept': 'application/vnd.pgrst.object+json'
  });
}

// ── MAIN ─────────────────────────────────────────────────────
async function main(){
  console.log('BudgetFlow reminder bot starting —', new Date().toISOString());

  // Keep-alive ping
  const ping = await sbGet('profiles', 'select=id&limit=1');
  console.log(`Keep-alive ping OK. Status: ${ping.status}`);

  const now = new Date();
  const dayOfMonth = now.getDate();
  const monthId = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;

  // Load all configured users
  const usersRes = await sbGet('profiles', 'select=*&plan_configured=eq.true');
  const users = usersRes.body || [];
  console.log(`Processing ${users.length} users for ${monthId}`);

  for(const user of users){
    try{ await processUser(user, monthId, dayOfMonth, now); }
    catch(e){ console.error(`Error for ${user.email}:`, e.message); }
  }
  console.log('Done.');
}

async function processUser(user, monthId, dayOfMonth, now){
  const plan = user.plan || [];
  if(!plan.length) return;

  // Load actuals
  const actsRes = await sbGet('actuals', `select=*&user_id=eq.${user.id}&month_id=eq.${monthId}`);
  const actMap = {};
  (actsRes.body||[]).forEach(a => actMap[a.line_name] = a);

  const pending   = plan.filter(l => { const a=actMap[l.name]||{}; return (a.added||0)<l.amount && !a.reason; });
  const settled   = plan.filter(l => { const a=actMap[l.name]||{}; return (a.added||0)>=l.amount && l.amount>0; });
  const explained = plan.filter(l => { const a=actMap[l.name]||{}; return (a.added||0)<l.amount && a.reason; });

  // Payday
  if(dayOfMonth===(user.payday_date||1)){
    await sendPaydayReminder(user, plan, monthId);
    return;
  }

  // All clear
  if(!pending.length){
    const logRes = await sbGet('reminder_log', `select=id&user_id=eq.${user.id}&month_id=eq.${monthId}&channel=eq.email-allclear&limit=1`);
    if(!(logRes.body||[]).length) await sendAllClear(user, plan, actMap, monthId);
    return;
  }

  // Chase
  if(dayOfMonth<3||dayOfMonth>25) return;
  const lastRes = await sbGet('reminder_log',
    `select=sent_at&user_id=eq.${user.id}&month_id=eq.${monthId}&channel=in.(email,email-allclear)&order=sent_at.desc&limit=1`);
  const chaseEvery = user.chase_every_days||2;
  if((lastRes.body||[]).length){
    const daysSince = Math.floor((now - new Date(lastRes.body[0].sent_at))/86400000);
    if(daysSince < chaseEvery) return;
  }
  const countRes = await sbGet('reminder_log', `select=id&user_id=eq.${user.id}&month_id=eq.${monthId}&channel=eq.email`);
  const chaseCount = (countRes.body||[]).length + 1;
  await sendChaseReminder(user, pending, settled, explained, monthId, chaseCount, dayOfMonth);
}

// ── EMAIL ─────────────────────────────────────────────────────
function emailShell(title, bodyHtml){
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>body{font-family:-apple-system,sans-serif;background:#EFF1E9;padding:20px;color:#15252E}
.box{max-width:580px;margin:0 auto;background:#F6F7F1;border:1.5px solid #15252E}
.hdr{padding:18px 20px;border-bottom:1.5px solid #15252E}
.ttl{font-size:22px;font-weight:800}
.bdy{padding:18px 20px}
table{width:100%;border-collapse:collapse;border:1.5px solid #15252E;margin:12px 0}
th{padding:8px 10px;font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:#66756D;text-align:left;background:#E5E9DC;border-bottom:1.5px solid #15252E}
td{padding:9px 10px;border-bottom:1px solid #D8DECE;font-size:14px}
.cta{display:inline-block;margin-top:16px;padding:11px 18px;background:#15252E;color:#F6F7F1;text-decoration:none;font-size:13px}
</style></head><body><div class="box">
<div class="hdr"><div style="font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:#66756D">💰 BudgetFlow</div>
<div class="ttl">${title}</div></div>
<div class="bdy">${bodyHtml}<a href="${SITE_URL}/dashboard.html" class="cta">Open my tracker</a></div>
</div></body></html>`;
}

async function sendEmail(to, subject, html, channel, userId, monthId, message){
  if(!RESEND_KEY){ console.log(`[MOCK EMAIL] ${subject}`); }
  else {
    await request('POST','https://api.resend.com/emails',
      {'Authorization':`Bearer ${RESEND_KEY}`,'Content-Type':'application/json'},
      {from:FROM_EMAIL, to, subject, html});
  }
  await sbInsert('reminder_log',{user_id:userId,month_id:monthId,channel,message,sent_at:new Date().toISOString()});
  console.log(`  Email sent to ${to}: ${subject}`);
}

async function sendWA(user, text, channel, monthId){
  const num=(user.whatsapp||'').replace(/\D/g,''), key=user.callmebot_key;
  if(!num||!key){ console.log(`  [MOCK WA] ${text.slice(0,60)}`); return; }
  try{
    await request('GET',`https://api.callmebot.com/whatsapp.php?phone=${num}&text=${encodeURIComponent(text)}&apikey=${key}`,{});
    console.log(`  WhatsApp sent to ${user.whatsapp}`);
  }catch(e){ console.log(`  WhatsApp failed: ${e.message}`); }
  await sbInsert('reminder_log',{user_id:user.id,month_id:monthId,channel,message:text.slice(0,120),sent_at:new Date().toISOString()});
}

async function sendPaydayReminder(user, plan, monthId){
  const ml = new Date(monthId+'-01').toLocaleString('en-IN',{month:'long',year:'numeric'});
  const total = plan.reduce((s,l)=>s+l.amount,0);
  const rows = plan.map(l=>`<tr><td>${l.name}</td><td>${INR(l.amount)}</td><td>${l.type}</td></tr>`).join('');
  const html = emailShell(`${ml} — payday!`,
    `<p>Your full plan for <strong>${ml}</strong>. Log what you have paid — reminders stop line by line as you go.</p>
    <table><thead><tr><th>Line</th><th>Amount</th><th>Type</th></tr></thead><tbody>${rows}</tbody>
    <tr><td><strong>Total</strong></td><td><strong>${INR(total)}</strong></td><td></td></tr></table>`);
  const waText = `💰 Payday! ${ml} budget:\n`+plan.map(l=>`${l.name}: ${INR(l.amount)}`).join('\n')+`\n\nLog: ${SITE_URL}/dashboard.html`;
  await sendEmail(user.email,`${ml} budget — ${INR(total)} ready`,html,'email',user.id,monthId,`Payday: ${ml}`);
  await sendWA(user,waText,'whatsapp',monthId);
}

async function sendChaseReminder(user, pending, settled, explained, monthId, count, day){
  const ml = new Date(monthId+'-01').toLocaleString('en-IN',{month:'long',year:'numeric'});
  const short = pending.reduce((s,l)=>s+l.amount,0);
  const rows = pending.map(l=>`<tr><td>${l.name}</td><td style="color:#A8402F">${INR(l.amount)}</td></tr>`).join('');
  const extras = settled.length?`<p style="color:#127A6B">✅ Settled: ${settled.map(l=>l.name).join(', ')}</p>`:'';
  const subj = day>=22?`Last call — ${ml} has ${pending.length} open lines`:`Reminder ${count}: ${ml} — ${pending.length} lines pending`;
  const html = emailShell(subj,
    `<p>${pending.length} line${pending.length>1?'s':''} still open for ${ml}.</p>
    <table><thead><tr><th>Line</th><th>Short by</th></tr></thead><tbody>${rows}</tbody>
    <tr><td><strong>Total</strong></td><td style="color:#A8402F"><strong>${INR(short)}</strong></td></tr></table>${extras}`);
  const waText = `⏰ ${ml}: ${pending.length} line${pending.length>1?'s':''} open (${INR(short)}).\n`
    +pending.map(l=>`• ${l.name} — ${INR(l.amount)}`).join('\n')+`\n\n${SITE_URL}/dashboard.html`;
  await sendEmail(user.email,subj,html,'email',user.id,monthId,`Chase #${count}`);
  await sendWA(user,waText,'whatsapp',monthId);
}

async function sendAllClear(user, plan, actMap, monthId){
  const ml = new Date(monthId+'-01').toLocaleString('en-IN',{month:'long',year:'numeric'});
  const saved = plan.filter(l=>l.type==='Savings').reduce((s,l)=>s+(actMap[l.name]?.added||0),0);
  const html = emailShell(`${ml} closed ✅`,
    `<p>All lines settled. ${INR(saved)} saved this month.</p>
    <table><tr><td>Saved</td><td style="color:#127A6B"><strong>${INR(saved)}</strong></td></tr></table>`);
  const waText = `✅ ${ml} closed! ${INR(saved)} saved 🎉`;
  await sendEmail(user.email,`${ml} closed — ${INR(saved)} saved`,html,'email-allclear',user.id,monthId,'All-clear');
  await sendWA(user,waText,'whatsapp-allclear',monthId);
}

main().catch(e=>{ console.error('Bot crashed:', e); process.exit(1); });
