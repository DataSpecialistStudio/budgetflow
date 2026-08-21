// ============================================================
//  SETUP.JS  — first-time budget plan builder
// ============================================================
let user=null;
let planLines=[...DEFAULT_PLAN];

document.addEventListener('DOMContentLoaded', async()=>{
  user=await requireAuth();
  if(!user)return;

  // Check if already set up → go to dashboard
  const {data:prof}=await sb.from('profiles').select('plan_configured').eq('id',user.id).single();
  if(prof&&prof.plan_configured){ window.location.href='dashboard.html'; return; }

  renderPlanTable();
  document.getElementById('addLineBtn').onclick=addLine;
  document.getElementById('saveSetupBtn').onclick=saveSetup;
  document.getElementById('income').oninput=updateBalance;
});

function renderPlanTable(){
  const tbody=document.getElementById('planBody');
  tbody.innerHTML=planLines.map((l,i)=>`
    <tr>
      <td><input value="${esc(l.name)}" data-i="${i}" data-f="name" placeholder="Line name"></td>
      <td><input type="number" value="${l.amount}" data-i="${i}" data-f="amount" min="0" step="100" style="width:110px"></td>
      <td><select data-i="${i}" data-f="type">
        ${['Fixed','Savings','Flexible'].map(t=>`<option${l.type===t?' selected':''}>${t}</option>`).join('')}
      </select></td>
      <td><button class="del-btn" data-del="${i}">✕</button></td>
    </tr>`).join('');
  tbody.querySelectorAll('[data-f]').forEach(el=>{
    el.onchange=()=>{
      const i=+el.dataset.i,f=el.dataset.f;
      planLines[i][f]=f==='amount'?(parseFloat(el.value)||0):el.value;
      updateBalance();
    };
  });
  tbody.querySelectorAll('[data-del]').forEach(b=>{
    b.onclick=()=>{planLines.splice(+b.dataset.del,1);renderPlanTable();updateBalance();};
  });
  updateBalance();
}

function addLine(){
  planLines.push({name:'New line',amount:0,type:'Fixed'});
  renderPlanTable();
}

function updateBalance(){
  const income=parseFloat(document.getElementById('income').value)||0;
  const total=planLines.reduce((s,l)=>s+(+l.amount||0),0);
  const diff=income-total;
  const badge=document.getElementById('balanceBadge');
  badge.textContent=diff===0?'✅ Balanced':diff>0?`${INR(diff)} unassigned`:`${INR(-diff)} over budget`;
  badge.className='balance-badge '+(diff===0?'ok':'bad');
}

async function saveSetup(){
  const income=parseFloat(document.getElementById('income').value)||0;
  if(!income){msg('setupMsg','Enter your monthly income.',true);return;}
  const total=planLines.reduce((s,l)=>s+(+l.amount||0),0);
  if(Math.abs(income-total)>1){msg('setupMsg','Plan doesn\'t balance to your income yet.',true);return;}

  msg('setupMsg','Saving…');
  const {error}=await sb.from('profiles').update({
    income, plan:planLines, plan_configured:true, last_active:new Date().toISOString()
  }).eq('id',user.id);

  if(error){msg('setupMsg',error.message,true);return;}
  msg('setupMsg','Done! Opening your dashboard…');
  setTimeout(()=>window.location.href='dashboard.html',900);
}

function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
