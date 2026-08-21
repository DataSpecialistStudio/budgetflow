// ============================================================
//  BUDGETFLOW REMINDER BOT
//  Runs daily via GitHub Actions at 9am IST
//  - Keep-alive ping to Supabase (prevents free tier pause)
//  - Payday email + WhatsApp on the user's payday date
//  - Chase email + WhatsApp every N days while lines are pending
//  - All-clear email + WhatsApp when everything is settled
// ============================================================

const { createClient } = require('@supabase/supabase-js');
const fetch = (...args) => import('node-fetch').then(({default:f})=>f(...args));

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const RESEND_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = process.env.FROM_EMAIL || 'reminders@budgetflow.app';
const SITE_URL   = process.env.SITE_URL   || 'https://budgetflow.pages.dev';

const INR = n => '₹' + Math.round(Number(n)||0).toLocaleString('en-IN');

async function main(){
  console.log('BudgetFlow reminder bot starting —', new Date().toISOString());

  // ── KEEP-ALIVE PING ───────────────────────────────────────
  const {count} = await sb.from('profiles').select('id',{count:'exact',head:true});
  console.log(`Keep-alive ping OK. ${count} users.`);

  const now = new Date();
  const dayOfMonth = now.getDate();
  const monthId = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;

  // ── LOAD ALL USERS ────────────────────────────────────────
  const {data:users, error} = await sb.from('profiles')
    .select('*')
    .eq('plan_configured', true);
  if(error){ console.error('Could not load users:', error.message); return; }
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

  // Load this month's actuals
  const {data:acts} = await sb.from('actuals').select('*')
    .eq('user_id', user.id).eq('month_id', monthId);
  const actMap = {};
  (acts||[]).forEach(a => actMap[a.line_name] = a);

  // Determine pending and settled lines
  const pending  = plan.filter(l => {
    const a = actMap[l.name]; const added = a?.added||0; const reason = a?.reason||'';
    return added < l.amount && !reason;
  });
  const settled  = plan.filter(l => { const a = actMap[l.name]; return (a?.added||0) >= l.amount && l.amount>0; });
  const explained= plan.filter(l => { const a = actMap[l.name]; return (a?.added||0) < l.amount && a?.reason; });

  const allDone = pending.length === 0;

  // ── PAYDAY REMINDER ───────────────────────────────────────
  if(dayOfMonth === (user.payday_date||1)){
    await sendPaydayReminder(user, plan, monthId);
    return;
  }

  // ── ALL-CLEAR ─────────────────────────────────────────────
  if(allDone){
    // Check we haven't already sent the all-clear this month
    const {data:log} = await sb.from('reminder_log')
      .select('id').eq('user_id',user.id).eq('month_id',monthId)
      .eq('channel','email-allclear').limit(1);
    if(!log||!log.length){
      await sendAllClear(user, plan, actMap, monthId);
    }
    return;
  }

  // ── CHASE REMINDER ────────────────────────────────────────
  // Only start chasing from day 3 (give 2 days after payday)
  // Stop chasing after day 25
  if(dayOfMonth < 3 || dayOfMonth > 25) return;

  // Check when we last chased this user this month
  const {data:lastLog} = await sb.from('reminder_log')
    .select('sent_at').eq('user_id',user.id).eq('month_id',monthId)
    .in('channel',['email','email-allclear']).order('sent_at',{ascending:false}).limit(1);

  const chaseEvery = user.chase_every_days || 2;
  if(lastLog&&lastLog.length){
    const daysSince = Math.floor((now - new Date(lastLog[0].sent_at)) / 86400000);
    if(daysSince < chaseEvery) return; // too soon
  }

  // Count how many chases sent this month
  const {data:chaseLog} = await sb.from('reminder_log')
    .select('id').eq('user_id',user.id).eq('month_id',monthId).eq('channel','email');
  const chaseCount = (chaseLog||[]).length + 1;

  await sendChaseReminder(user, pending, settled, explained, monthId, chaseCount, dayOfMonth);
}

// ── EMAIL HELPERS ─────────────────────────────────────────────
function emailShell(title, preheader, bodyHtml){
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
body{font-family:-apple-system,Segoe UI,Roboto,Helvetica,sans-serif;background:#EFF1E9;margin:0;padding:24px;color:#15252E}
.box{max-width:580px;margin:0 auto;background:#F6F7F1;border:1.5px solid #15252E}
.hdr{padding:20px 22px;border-bottom:1.5px solid #15252E}
.eye{font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;color:#66756D}
.ttl{font-size:24px;font-weight:800;letter-spacing:-.02em;margin-top:6px}
.bdy{padding:20px 22px}
table{width:100%;border-collapse:collapse;border:1.5px solid #15252E;background:#fff;margin:14px 0}
th{padding:9px 12px;font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:#66756D;text-align:left;
   border-bottom:1.5px solid #15252E;background:#E5E9DC}
td{padding:9px 12px;border-bottom:1px solid #D8DECE;font-size:14px}
.cta{display:inline-block;margin-top:18px;padding:12px 20px;background:#15252E;color:#F6F7F1;
     text-decoration:none;font-size:13px;letter-spacing:.08em;text-transform:uppercase}
.note{margin-top:16px;font-size:12.5px;color:#66756D;line-height:1.5}
.ok{color:#127A6B;font-weight:700} .bad{color:#A8402F;font-weight:700}
</style></head><body>
<div class="box">
<div class="hdr"><div class="eye">💰 BudgetFlow</div><div class="ttl">${title}</div></div>
<div class="bdy">${bodyHtml}
<a href="${SITE_URL}/dashboard.html" class="cta">Open my tracker</a>
<p class="note">Fill in the <strong>Added</strong> column or type a <strong>Reason</strong> to stop reminders for that line.</p>
</div></div></body></html>`;
}

async function sendEmail(to, subject, html, logChannel, userId, monthId, message){
  if(!RESEND_KEY){ console.log(`[MOCK EMAIL] To: ${to} | ${subject}`); }
  else {
    await fetch('https://api.resend.com/emails',{
      method:'POST',
      headers:{'Authorization':`Bearer ${RESEND_KEY}`,'Content-Type':'application/json'},
      body:JSON.stringify({from:FROM_EMAIL,to,subject,html})
    });
  }
  await sb.from('reminder_log').insert({user_id:userId,month_id:monthId,channel:logChannel,message,sent_at:new Date().toISOString()});
  console.log(`  Email sent to ${to}: ${subject}`);
}

async function sendWhatsApp(user, text, logChannel, monthId){
  const num = (user.whatsapp||'').replace(/\D/g,'');
  const key = user.callmebot_key;
  if(!num||!key){ console.log(`  [MOCK WA] ${text.slice(0,60)}`); return; }
  const url=`https://api.callmebot.com/whatsapp.php?phone=${num}&text=${encodeURIComponent(text)}&apikey=${key}`;
  try{ await fetch(url); console.log(`  WhatsApp sent to ${user.whatsapp}`); }
  catch(e){ console.log(`  WhatsApp failed: ${e.message}`); }
  await sb.from('reminder_log').insert({user_id:user.id,month_id:monthId,channel:logChannel,message:text.slice(0,120),sent_at:new Date().toISOString()});
}

// ── PAYDAY REMINDER ───────────────────────────────────────────
async function sendPaydayReminder(user, plan, monthId){
  const monthLabel = new Date(monthId+'-01').toLocaleString('en-IN',{month:'long',year:'numeric'});
  const total = plan.reduce((s,l)=>s+l.amount,0);
  const rows = plan.map(l=>`<tr><td>${l.name}</td><td><strong>${INR(l.amount)}</strong></td><td>${l.type}</td></tr>`).join('');
  const html = emailShell(
    `${monthLabel} — payday!`,
    `Your ${INR(total)} budget plan for ${monthLabel}`,
    `<p>It's payday. Here's your full plan for <strong>${monthLabel}</strong>. Open the tracker and log what you've paid — the reminder stops for each line as you go.</p>
    <table><thead><tr><th>Line</th><th>Amount</th><th>Type</th></tr></thead><tbody>${rows}</tbody>
    <tr><td><strong>Total</strong></td><td><strong>${INR(total)}</strong></td><td></td></tr></table>`
  );
  const name = (user.full_name||'there').split(' ')[0];
  const waText = `💰 Payday! ${monthLabel} budget (${INR(total)} total):\n`
    + plan.map(l=>`${l.name.padEnd(22)} ${INR(l.amount)}`).join('\n')
    + `\n\nLog it: ${SITE_URL}/dashboard.html`;
  await sendEmail(user.email,`${monthLabel} budget — ${INR(total)} ready`,html,'email',user.id,monthId,`Payday reminder: ${monthLabel}`);
  await sendWhatsApp(user, waText, 'whatsapp', monthId);
  console.log(`  Payday reminder sent to ${user.email}`);
}

// ── CHASE REMINDER ────────────────────────────────────────────
async function sendChaseReminder(user, pending, settled, explained, monthId, count, dayOfMonth){
  const monthLabel = new Date(monthId+'-01').toLocaleString('en-IN',{month:'long',year:'numeric'});
  const shortTotal = pending.reduce((s,l)=>s+l.amount,0);
  const intro = dayOfMonth>=22
    ? `Last call for ${monthLabel}. ${pending.length} line${pending.length>1?'s are':' is'} still open. Reminders stop after the 25th.`
    : count===1 ? `${pending.length} line${pending.length>1?'s are':' is'} still open for ${monthLabel}.`
    : `Reminder ${count} for ${monthLabel}. Still ${pending.length} line${pending.length>1?'s':''} open.`;
  const rows = pending.map(l=>`<tr><td>${l.name}</td><td class="bad">${INR(l.amount)}</td><td>${INR(l.amount)}</td></tr>`).join('');
  const extras = settled.length ? `<p class="ok">✅ Already settled: ${settled.map(l=>l.name).join(', ')}</p>` : '';
  const expls  = explained.length ? `<p style="color:#2E4A7D">📝 Explained: ${explained.map(l=>l.name).join(', ')}</p>` : '';
  const html = emailShell(`${monthLabel} — ${pending.length} line${pending.length>1?'s':''} pending`,intro,
    `<p>${intro}</p>
    <table><thead><tr><th>Line</th><th>Short by</th><th>Planned</th></tr></thead><tbody>${rows}
    <tr><td><strong>Total outstanding</strong></td><td class="bad">${INR(shortTotal)}</td><td></td></tr></tbody></table>
    ${extras}${expls}`);
  const waText = `⏰ ${monthLabel}: ${pending.length} line${pending.length>1?'s':''} still open (${INR(shortTotal)} total).\n`
    + pending.map(l=>`• ${l.name} — ${INR(l.amount)}`).join('\n')
    + `\n\n${SITE_URL}/dashboard.html`;
  const subj = dayOfMonth>=22
    ? `Last call — ${monthLabel} still has ${pending.length} open line${pending.length>1?'s':''}`
    : `Reminder ${count}: ${monthLabel} — ${pending.length} line${pending.length>1?'s':''} pending`;
  await sendEmail(user.email,subj,html,'email',user.id,monthId,`Chase #${count}: ${pending.length} lines pending`);
  await sendWhatsApp(user,waText,'whatsapp',monthId);
  console.log(`  Chase #${count} sent to ${user.email}, ${pending.length} lines pending`);
}

// ── ALL-CLEAR ─────────────────────────────────────────────────
async function sendAllClear(user, plan, actMap, monthId){
  const monthLabel = new Date(monthId+'-01').toLocaleString('en-IN',{month:'long',year:'numeric'});
  const saved = plan.filter(l=>['Savings'].includes(l.type)).reduce((s,l)=>s+(actMap[l.name]?.added||0),0);
  const total = plan.reduce((s,l)=>s+(actMap[l.name]?.added||0),0);
  const html = emailShell(`${monthLabel} is closed ✅`,
    `All lines settled — ${INR(saved)} saved this month.`,
    `<p>${monthLabel} is fully logged. No more reminders this month.</p>
    <table><tr><td>Total logged</td><td class="ok">${INR(total)}</td></tr>
    <tr><td>Saved this month</td><td class="ok">${INR(saved)}</td></tr></table>`);
  const waText = `✅ ${monthLabel} is closed! ${INR(saved)} saved this month. No more reminders. 🎉`;
  await sendEmail(user.email,`${monthLabel} closed — ${INR(saved)} saved`,html,'email-allclear',user.id,monthId,'All-clear: month fully logged');
  await sendWhatsApp(user,waText,'whatsapp-allclear',monthId);
  console.log(`  All-clear sent to ${user.email} for ${monthLabel}`);
}

main().catch(e=>{ console.error('Bot crashed:', e); process.exit(1); });
