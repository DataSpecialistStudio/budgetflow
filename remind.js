// ============================================================
//  BUDGETFLOW REMINDER BOT — Node 20 compatible, pure https
// ============================================================

const https = require('https');

const SUPA_URL  = (process.env.SUPABASE_URL||'').replace(/\/$/, '');
const SUPA_KEY  = process.env.SUPABASE_SERVICE_KEY || '';
const RESEND    = process.env.RESEND_API_KEY || '';
const FROM      = process.env.FROM_EMAIL || 'onboarding@resend.dev';
const SITE      = (process.env.SITE_URL || 'https://budgetflow-6bs.pages.dev').replace(/\/$/, '');

const INR = n => '\u20B9' + Math.round(Number(n)||0).toLocaleString('en-IN');

function req(method, urlStr, hdrs, body){
  return new Promise((res, rej)=>{
    const b = body ? JSON.stringify(body) : null;
    const u = new URL(urlStr);
    const h = Object.assign({}, hdrs);
    if(b){ h['Content-Length'] = Buffer.byteLength(b); }
    const r = https.request({
      method, hostname: u.hostname, port: 443,
      path: u.pathname + u.search, headers: h
    }, resp=>{
      let d = '';
      resp.on('data', c => d += c);
      resp.on('end', ()=>{
        let parsed;
        try{ parsed = JSON.parse(d); } catch(e){ parsed = d; }
        res({ status: resp.statusCode, body: parsed });
      });
    });
    r.on('error', rej);
    if(b) r.write(b);
    r.end();
  });
}

const H = () => ({
  'apikey': SUPA_KEY,
  'Authorization': 'Bearer ' + SUPA_KEY,
  'Content-Type': 'application/json'
});

function sbGet(table, qs){ return req('GET', `${SUPA_URL}/rest/v1/${table}?${qs||''}`, H()); }
function sbPost(table, data){
  return req('POST', `${SUPA_URL}/rest/v1/${table}`, Object.assign(H(),{'Prefer':'return=minimal'}), data);
}

async function main(){
  console.log('BudgetFlow bot starting', new Date().toISOString());
  console.log('SUPA_URL:', SUPA_URL ? 'set' : 'MISSING');
  console.log('SUPA_KEY:', SUPA_KEY ? 'set ('+SUPA_KEY.slice(0,8)+'...)' : 'MISSING');

  // Keep-alive ping
  const ping = await sbGet('profiles', 'select=id&limit=1');
  console.log('Ping status:', ping.status, typeof ping.body === 'string' ? ping.body.slice(0,100) : '');

  if(ping.status === 401){ console.error('Auth failed — check SUPABASE_SERVICE_KEY secret'); process.exit(1); }

  const now = new Date();
  const day = now.getDate();
  const mid = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;

  const ur = await sbGet('profiles', 'select=*&plan_configured=eq.true');
  const users = Array.isArray(ur.body) ? ur.body : [];
  console.log(`${users.length} users for ${mid}`);

  for(const u of users){
    try{ await doUser(u, mid, day, now); }
    catch(e){ console.error('User error:', u.email, e.message); }
  }
  console.log('Done.');
}

async function doUser(u, mid, day, now){
  const plan = u.plan || [];
  if(!plan.length) return;

  const ar = await sbGet('actuals', `select=*&user_id=eq.${u.id}&month_id=eq.${mid}`);
  const acts = {};
  (Array.isArray(ar.body)?ar.body:[]).forEach(a => acts[a.line_name] = a);

  const pending  = plan.filter(l => { const a=acts[l.name]||{}; return (a.added||0)<l.amount && !a.reason; });
  const settled  = plan.filter(l => { const a=acts[l.name]||{}; return (a.added||0)>=l.amount && l.amount>0; });

  if(day === (u.payday_date||1)){ await sendPayday(u, plan, mid); return; }
  if(!pending.length){
    const lr = await sbGet('reminder_log', `select=id&user_id=eq.${u.id}&month_id=eq.${mid}&channel=eq.email-allclear&limit=1`);
    if(!(Array.isArray(lr.body)?lr.body:[]).length) await sendClear(u, plan, acts, mid);
    return;
  }
  if(day<3||day>25) return;
  const lastR = await sbGet('reminder_log', `select=sent_at&user_id=eq.${u.id}&month_id=eq.${mid}&channel=in.(email,email-allclear)&order=sent_at.desc&limit=1`);
  const every = u.chase_every_days||2;
  const lastArr = Array.isArray(lastR.body)?lastR.body:[];
  if(lastArr.length && Math.floor((now-new Date(lastArr[0].sent_at))/86400000) < every) return;
  const cr = await sbGet('reminder_log', `select=id&user_id=eq.${u.id}&month_id=eq.${mid}&channel=eq.email`);
  await sendChase(u, pending, settled, mid, (Array.isArray(cr.body)?cr.body:[]).length+1, day);
}

function shell(title, body){
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{font-family:sans-serif;background:#EFF1E9;padding:20px}
.w{max-width:560px;margin:0 auto;background:#F6F7F1;border:1.5px solid #15252E}.h{padding:16px 20px;border-bottom:1.5px solid #15252E;font-size:20px;font-weight:800}
.b{padding:16px 20px}table{width:100%;border-collapse:collapse;border:1.5px solid #15252E;margin:12px 0}
th{padding:8px 10px;font-size:10px;letter-spacing:.1em;text-transform:uppercase;background:#E5E9DC;text-align:left;border-bottom:1.5px solid #15252E}
td{padding:8px 10px;border-bottom:1px solid #D8DECE;font-size:14px}
.cta{display:inline-block;margin-top:14px;padding:10px 18px;background:#15252E;color:#F6F7F1;text-decoration:none;font-size:13px}
</style></head><body><div class="w"><div class="h">&#128176; ${title}</div><div class="b">${body}<a href="${SITE}/dashboard.html" class="cta">Open tracker</a></div></div></body></html>`;
}

async function log(userId, mid, channel, message){
  await sbPost('reminder_log',{user_id:userId,month_id:mid,channel,message,sent_at:new Date().toISOString()});
}

async function email(to, subj, html, channel, userId, mid, msg){
  if(RESEND){
    const r = await req('POST','https://api.resend.com/emails',
      {'Authorization':'Bearer '+RESEND,'Content-Type':'application/json'},
      {from:FROM,to,subject:subj,html});
    console.log('  Email status:', r.status, to);
  } else { console.log('  [MOCK EMAIL]', subj, to); }
  await log(userId, mid, channel, msg);
}

async function wa(u, text, channel, mid){
  const num=(u.whatsapp||'').replace(/\D/g,''), key=u.callmebot_key;
  if(num&&key){
    try{
      await req('GET',`https://api.callmebot.com/whatsapp.php?phone=${num}&text=${encodeURIComponent(text)}&apikey=${key}`,{});
      console.log('  WhatsApp sent');
    }catch(e){ console.log('  WhatsApp failed:', e.message); }
  }
  await log(u.id, mid, channel, text.slice(0,120));
}

async function sendPayday(u, plan, mid){
  const ml = new Date(mid+'-01').toLocaleString('en-IN',{month:'long',year:'numeric'});
  const total = plan.reduce((s,l)=>s+l.amount,0);
  const rows = plan.map(l=>`<tr><td>${l.name}</td><td>${INR(l.amount)}</td><td>${l.type}</td></tr>`).join('');
  const h = shell(`${ml} — payday!`,
    `<p>Your plan for <strong>${ml}</strong>:</p><table><thead><tr><th>Line</th><th>Amount</th><th>Type</th></tr></thead><tbody>${rows}</tbody>
    <tfoot><tr><td><strong>Total</strong></td><td><strong>${INR(total)}</strong></td><td></td></tr></tfoot></table>`);
  const wt = `Payday! ${ml}:\n`+plan.map(l=>`${l.name}: ${INR(l.amount)}`).join('\n')+`\n\n${SITE}/dashboard.html`;
  await email(u.email,`${ml} budget \u2014 ${INR(total)} ready`,h,'email',u.id,mid,'Payday');
  await wa(u, wt, 'whatsapp', mid);
}

async function sendChase(u, pending, settled, mid, n, day){
  const ml = new Date(mid+'-01').toLocaleString('en-IN',{month:'long',year:'numeric'});
  const short = pending.reduce((s,l)=>s+l.amount,0);
  const rows = pending.map(l=>`<tr><td>${l.name}</td><td style="color:#A8402F">${INR(l.amount)}</td></tr>`).join('');
  const ok = settled.length ? `<p style="color:#127A6B">Settled: ${settled.map(l=>l.name).join(', ')}</p>` : '';
  const subj = day>=22 ? `Last call \u2014 ${ml}` : `Reminder ${n}: ${ml} \u2014 ${pending.length} lines`;
  const h = shell(subj,`<table><thead><tr><th>Line</th><th>Short by</th></tr></thead><tbody>${rows}</tbody>
    <tfoot><tr><td><strong>Total</strong></td><td style="color:#A8402F"><strong>${INR(short)}</strong></td></tr></tfoot></table>${ok}`);
  const wt = `${ml}: ${pending.length} lines open (${INR(short)}).\n`+pending.map(l=>`\u2022 ${l.name} \u2014 ${INR(l.amount)}`).join('\n')+`\n\n${SITE}/dashboard.html`;
  await email(u.email, subj, h, 'email', u.id, mid, `Chase #${n}`);
  await wa(u, wt, 'whatsapp', mid);
}

async function sendClear(u, plan, acts, mid){
  const ml = new Date(mid+'-01').toLocaleString('en-IN',{month:'long',year:'numeric'});
  const saved = plan.filter(l=>l.type==='Savings').reduce((s,l)=>s+((acts[l.name]||{}).added||0),0);
  const h = shell(`${ml} closed`,`<p>All done. ${INR(saved)} saved this month.</p>`);
  await email(u.email,`${ml} closed \u2014 ${INR(saved)} saved`,h,'email-allclear',u.id,mid,'All-clear');
  await wa(u, `${ml} closed! ${INR(saved)} saved.`, 'whatsapp-allclear', mid);
}

main().catch(e=>{ console.error('Crashed:', e.message); process.exit(1); });
