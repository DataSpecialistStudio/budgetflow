// ============================================================
//  DASHBOARD.JS  — all five tabs
// ============================================================
let USER=null, PROFILE=null, ACTUALS={}, NOTES={};
let savingsChart=null, corpusChart=null, projChart=null, donutChart=null;
let activeMonth=currentMonthId();

document.addEventListener('DOMContentLoaded',async()=>{
  USER=await requireAuth();
  if(!USER)return;

  const {data:prof}=await sb.from('profiles').select('*').eq('id',USER.id).single();
  if(!prof||!prof.plan_configured){window.location.href='setup.html';return;}
  PROFILE=prof;

  await sb.from('profiles').update({last_active:new Date().toISOString()}).eq('id',USER.id);

  if(USER.email===ADMIN_EMAIL) document.getElementById('adminLink').style.display='';

  const {data:acts}=await sb.from('actuals').select('*').eq('user_id',USER.id);
  (acts||[]).forEach(a=>{ ACTUALS[a.month_id]=ACTUALS[a.month_id]||{}; ACTUALS[a.month_id][a.line_name]=a; });

  const {data:nts}=await sb.from('month_notes').select('*').eq('user_id',USER.id);
  (nts||[]).forEach(n=>NOTES[n.month_id]=n.note);

  renderAll();

  document.querySelectorAll('.app-tab').forEach(tab=>{
    tab.onclick=()=>{
      document.querySelectorAll('.app-tab').forEach(t=>t.classList.remove('active'));
      document.querySelectorAll('.tab-section').forEach(s=>s.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById('section-'+tab.dataset.section).classList.add('active');
      const titles={month:'This Month',year:'Year View',corpus:'Corpus',reminders:'Reminders',settings:'Settings'};
      const tt=document.getElementById('topbarTitle');
      if(tt) tt.textContent=titles[tab.dataset.section]||'';
      if(tab.dataset.section==='year') renderYear();
      if(tab.dataset.section==='corpus') renderCorpus();
      if(tab.dataset.section==='reminders') renderReminders();
      if(tab.dataset.section==='settings') renderSettings();
    };
  });
});

// ── RENDER ALL ──────────────────────────────────────────────
function renderAll(){
  renderNav();
  renderMonth();
}

function renderNav(){
  const name=(PROFILE.full_name||USER.email).split(' ')[0];
  const el=document.getElementById('navUser');
  if(el) el.textContent=name;
  const emailEl=document.getElementById('navUserEmail');
  if(emailEl) emailEl.textContent=USER.email;
  // Set avatar initials
  const av=document.getElementById('userAvatarInitials');
  if(av){
    const parts=(PROFILE.full_name||USER.email).split(/[\s@]/);
    av.textContent=(parts[0][0]+(parts[1]?.[0]||'')).toUpperCase();
  }
}

// ── TYPE PILL HELPER ─────────────────────────────────────────
function typePillClass(type){
  return{Fixed:'pill-fixed',Savings:'pill-savings',Flexible:'pill-flex'}[type]||'';
}

// ── THIS MONTH ──────────────────────────────────────────────
function renderMonth(){
  const plan=PROFILE.plan||DEFAULT_PLAN;
  const now=new Date();
  const monthObj=MONTHS.find(m=>m.id===activeMonth)||MONTHS[0];
  document.getElementById('monthLabel').textContent=monthObj.label;
  document.getElementById('greetUser').textContent=`Hi ${(PROFILE.full_name||'').split(' ')[0]||'there'}`;
  document.getElementById('paydayBadge').textContent=`Payday: ${PROFILE.payday_date||1}${ordinal(PROFILE.payday_date||1)}`;

  const acts=ACTUALS[activeMonth]||{};
  let totalPlan=0,totalAdded=0,totalSaved=0;
  let fixedTotal=0,savingsTotal=0,flexTotal=0;
  plan.forEach(l=>{
    totalPlan+=l.amount;
    const a=acts[l.name]||{};
    totalAdded+=a.added||0;
    if(SAVINGS_TYPES.includes(l.type)) totalSaved+=a.added||0;
    if(l.type==='Fixed') fixedTotal+=l.amount;
    else if(l.type==='Savings') savingsTotal+=l.amount;
    else flexTotal+=l.amount;
  });

  // River
  const river=document.getElementById('river');
  river.innerHTML=plan.map(l=>{
    const pct=totalPlan?l.amount/totalPlan*100:0;
    const col=GROUP_COLORS[l.type]||'#8C9A90';
    return `<div class="river-seg" style="flex:${pct};background:${col}" title="${l.name} — ${INR(l.amount)}"></div>`;
  }).join('');

  // KPIs
  const daysLeft=new Date(now.getFullYear(),now.getMonth()+1,0).getDate()-now.getDate();
  const salaryEl=document.getElementById('kpiSalary'); if(salaryEl) salaryEl.textContent=INR(PROFILE.income||0);
  document.getElementById('kpiLogged').textContent=INR(totalAdded);
  document.getElementById('kpiPending').textContent=INR(Math.max(totalPlan-totalAdded,0));
  document.getElementById('kpiSaved').textContent=INR(totalSaved);
  document.getElementById('kpiDays').textContent=daysLeft;

  // Donut chart — allocation split
  renderMonthDonut(fixedTotal, savingsTotal, flexTotal);

  // Month rail
  renderMonthRail();

  // Entry table — with color pills + progress bars
  const tbody=document.getElementById('entryBody');
  tbody.innerHTML=plan.map(l=>{
    const a=acts[l.name]||{};
    const added=a.added||0, reason=a.reason||'';
    const pend=l.amount-added;
    const st=chipStatus(l.amount,added,reason);
    const cls=added===0?'':pend<0?'over':pend===0?'done':'';
    const pct=l.amount>0?Math.min(100,Math.round(added/l.amount*100)):0;
    const barCol=l.type==='Savings'?'var(--teal)':l.type==='Fixed'?'var(--rust)':'var(--marigold)';
    return `<tr>
      <td>
        <strong>${esc(l.name)}</strong><br>
        <span class="type-pill ${typePillClass(l.type)}">${l.type}</span>
      </td>
      <td class="num">
        <span class="plan-amt-click" data-line="${esc(l.name)}" data-amount="${l.amount}" title="Double-click to mark as fully paid" style="cursor:pointer;border-bottom:1.5px dashed rgba(0,0,0,.18);display:inline-block">${INR(l.amount)}</span>
        <div class="bar-wrap" style="margin-top:5px;min-width:60px">
          <div class="bar-fill" style="width:${pct}%;background:${barCol}"></div>
        </div>
      </td>
      <td><input class="amt-input ${cls}" type="number" inputmode="decimal" step="50" min="0" placeholder="0"
          value="${added||''}" data-line="${esc(l.name)}" aria-label="${esc(l.name)}"></td>
      <td><input class="reason-input" type="text" placeholder="Only if not paid"
          value="${esc(reason)}" data-reason="${esc(l.name)}"></td>
      <td><span class="status-chip ${st[0]}">${st[1]}</span></td>
    </tr>`;
  }).join('');

  // Footer
  document.getElementById('entryFoot').innerHTML=`<tr>
    <td colspan="2"><strong>Total</strong></td>
    <td class="num">${INR(totalAdded)}</td>
    <td></td>
    <td class="num">${totalPlan?Math.round(totalAdded/totalPlan*100):0}%</td>
  </tr>`;

  // Double-click plan amount → auto-fill added
  tbody.querySelectorAll('.plan-amt-click').forEach(span=>{
    span.ondblclick=async()=>{
      const line=span.dataset.line;
      const amount=parseFloat(span.dataset.amount)||0;
      // Fill the matching amt-input
      const inp=tbody.querySelector(`.amt-input[data-line="${line}"]`);
      if(inp){ inp.value=amount; inp.classList.remove(''); }
      // Flash green confirmation
      span.style.transition='color .2s';
      span.style.color='#127A6B';
      setTimeout(()=>span.style.color='',600);
      // Save immediately
      await saveEntry(line, amount, null);
      renderMonth();
    };
  });

  // Wire inputs
  tbody.querySelectorAll('.amt-input').forEach(inp=>{
    inp.onblur=()=>saveEntry(inp.dataset.line, inp.value, null);
    inp.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();inp.blur();}};
  });
  tbody.querySelectorAll('.reason-input').forEach(inp=>{
    inp.onblur=()=>saveEntry(null, null, {line:inp.dataset.reason, reason:inp.value});
    inp.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();inp.blur();}};
  });

  // Notes
  document.getElementById('monthNotes').value=NOTES[activeMonth]||'';
  document.getElementById('monthNotes').onblur=saveNote;

  // Buttons
  document.getElementById('markAllBtn').onclick=markAllAsPlanned;
  document.getElementById('copyLastBtn').onclick=copyLastMonth;
}

// ── DONUT CHART ──────────────────────────────────────────────
function renderMonthDonut(fixed, savings, flex){
  const canvas=document.getElementById('monthDonut');
  if(!canvas) return;

  // Update alloc-card legend values (new rich cards)
  const lf=document.getElementById('legendFixed');
  const ls=document.getElementById('legendSavings');
  const lx=document.getElementById('legendFlex');
  if(lf) lf.textContent=INR(fixed);
  if(ls) ls.textContent=INR(savings);
  if(lx) lx.textContent=INR(flex);

  const total=fixed+savings+flex;
  const labels=['Fixed','Savings','Flexible'];
  const values=[fixed,savings,flex];
  const colors=['#A8402F','#127A6B','#C9871F'];
  const lightColors=['rgba(168,64,47,.15)','rgba(18,122,107,.15)','rgba(201,135,31,.15)'];
  const icons=['🔒','📈','🌀'];

  // Centre label elements
  const titleEl=document.querySelector('.donut-center-title');
  const subEl=document.querySelector('.donut-center-sub');

  function setCentre(label, value){
    if(titleEl) titleEl.textContent=label||'Total';
    if(subEl)   subEl.textContent=value||(total?INR(total):'—');
  }
  setCentre('Total', total?INR(total):'—');

  if(donutChart) donutChart.destroy();

  // Custom centre-label plugin
  const centreLabelPlugin={
    id:'centreLabel',
    beforeDraw(chart){
      // handled by DOM overlay — nothing needed here
    }
  };

  // Richer segment colors with lighter hover variants
  const hoverColors=['#BF4F38','#0F8F7A','#D99A28'];

  donutChart=new Chart(canvas,{
    type:'doughnut',
    data:{
      labels,
      datasets:[{
        data:values,
        backgroundColor:colors,
        hoverBackgroundColor:hoverColors,
        borderWidth:4,
        borderColor:'#F4F5EF',
        hoverBorderColor:'#ffffff',
        hoverOffset:18,
        spacing:3
      }]
    },
    options:{
      cutout:'70%',
      plugins:{
        legend:{display:false},
        tooltip:{enabled:false}   // centre label handles hover info — no overlap
      },
      animation:{
        animateRotate:true,
        animateScale:true,
        duration:1000,
        easing:'easeOutQuart'
      },
      onHover:(evt,elements)=>{
        if(elements.length){
          const i=elements[0].index;
          const pct=total?Math.round(values[i]/total*100):0;
          setCentre(icons[i]+' '+labels[i], INR(values[i])+'  ·  '+pct+'%');
          canvas.style.cursor='pointer';
        } else {
          setCentre('Total', total?INR(total):'—');
          canvas.style.cursor='default';
        }
      }
    },
    plugins:[centreLabelPlugin]
  });
}

function renderMonthRail(){
  let rail=document.getElementById('monthRail');
  if(!rail){
    rail=document.createElement('div');
    rail.id='monthRail';
    rail.style.cssText='display:flex;overflow:hidden;border:1.5px solid var(--ink);border-top:0;background:var(--paper2);margin-bottom:16px;width:100%;box-sizing:border-box';
    document.getElementById('entryBody').closest('.card').before(rail);
  }
  rail.innerHTML=MONTHS.map(m=>{
    const acts=ACTUALS[m.id]||{};
    const plan=PROFILE.plan||DEFAULT_PLAN;
    const tp=plan.reduce((s,l)=>s+l.amount,0);
    const ta=plan.reduce((s,l)=>s+Math.min((acts[l.name]||{}).added||0,l.amount),0);
    const pct=tp?Math.round(ta/tp*100):0;
    const bits=m.label.split(' ');
    return `<button style="flex:1 1 0;min-width:0;padding:9px 6px;border:0;border-right:1px solid var(--rule);
      background:${m.id===activeMonth?'var(--ink)':'none'};color:${m.id===activeMonth?'var(--paper)':'var(--ink)'};cursor:pointer;text-align:center"
      data-mid="${m.id}">
      <b style="font-family:var(--display);font-weight:700;font-size:12px;display:block;white-space:nowrap">${bits[0]}</b>
      <span style="font-family:var(--mono);font-size:9px;color:${m.id===activeMonth?'#A9B7AC':'var(--slate)'}">${bits[1]}</span>
      <div style="height:3px;background:${m.id===activeMonth?'#3A4B54':'var(--rule-soft)'};margin-top:6px">
        <div style="height:100%;width:${pct}%;background:var(--teal)"></div>
      </div>
    </button>`;
  }).join('');
  rail.querySelectorAll('button').forEach(b=>{
    b.onclick=()=>{activeMonth=b.dataset.mid;renderMonth();};
  });
}

// ── SAVE ────────────────────────────────────────────────────
async function saveEntry(lineName, addedVal, reasonObj){
  const mid=activeMonth;
  ACTUALS[mid]=ACTUALS[mid]||{};

  if(lineName!==null&&addedVal!==null){
    const added=parseFloat(addedVal)||0;
    ACTUALS[mid][lineName]=ACTUALS[mid][lineName]||{};
    ACTUALS[mid][lineName].added=added;
    await sb.from('actuals').upsert({
      user_id:USER.id, month_id:mid, line_name:lineName, added,
      reason:ACTUALS[mid][lineName].reason||'', updated_at:new Date().toISOString()
    },{onConflict:'user_id,month_id,line_name'});
  }
  if(reasonObj){
    ACTUALS[mid][reasonObj.line]=ACTUALS[mid][reasonObj.line]||{};
    ACTUALS[mid][reasonObj.line].reason=reasonObj.reason;
    await sb.from('actuals').upsert({
      user_id:USER.id, month_id:mid, line_name:reasonObj.line,
      added:ACTUALS[mid][reasonObj.line].added||0, reason:reasonObj.reason,
      updated_at:new Date().toISOString()
    },{onConflict:'user_id,month_id,line_name'});
  }
  toast('Saved');
  renderMonth();
}

async function saveNote(){
  const note=document.getElementById('monthNotes').value;
  NOTES[activeMonth]=note;
  await sb.from('month_notes').upsert({user_id:USER.id,month_id:activeMonth,note},{onConflict:'user_id,month_id'});
}

async function markAllAsPlanned(){
  const plan=PROFILE.plan||DEFAULT_PLAN;
  ACTUALS[activeMonth]=ACTUALS[activeMonth]||{};
  await Promise.all(plan.map(l=>{
    ACTUALS[activeMonth][l.name]={added:l.amount,reason:''};
    return sb.from('actuals').upsert({
      user_id:USER.id,month_id:activeMonth,line_name:l.name,added:l.amount,reason:'',updated_at:new Date().toISOString()
    },{onConflict:'user_id,month_id,line_name'});
  }));
  toast('All marked as planned');
  renderMonth();
}

async function copyLastMonth(){
  const idx=MONTHS.findIndex(m=>m.id===activeMonth);
  if(idx<=0){toast('No earlier month to copy',true);return;}
  const prev=MONTHS[idx-1].id;
  const src=ACTUALS[prev]||{};
  ACTUALS[activeMonth]=ACTUALS[activeMonth]||{};
  await Promise.all(Object.entries(src).map(([line,v])=>{
    ACTUALS[activeMonth][line]={added:v.added||0,reason:v.reason||''};
    return sb.from('actuals').upsert({
      user_id:USER.id,month_id:activeMonth,line_name:line,added:v.added||0,reason:v.reason||'',updated_at:new Date().toISOString()
    },{onConflict:'user_id,month_id,line_name'});
  }));
  toast('Copied from last month');
  renderMonth();
}

// ── YEAR ────────────────────────────────────────────────────
function renderYear(){
  const plan=PROFILE.plan||DEFAULT_PLAN;
  let head='<thead><tr><th>Line</th><th>Plan</th>'+MONTHS.map(m=>`<th>${m.label.split(' ')[0]}</th>`).join('')+'<th>Total</th></tr></thead>';
  let body=plan.map(l=>{
    let tot=0;
    const cells=MONTHS.map(m=>{
      const a=(ACTUALS[m.id]||{})[l.name]||{};
      const added=a.added||0; tot+=added;
      let bg='transparent',col='var(--slate)',txt='·';
      if(added>0){
        txt=Math.round(added/1000)+'k';
        if(added>=l.amount){bg='rgba(18,122,107,.18)';col='var(--teal)';}
        else if(added>0){bg='rgba(201,135,31,.18)';col='var(--marigold)';}
      }
      if(added>l.amount){bg='rgba(168,64,47,.18)';col='var(--rust)';}
      return `<td><span class="heat-cell" style="background:${bg};color:${col}" title="${m.label}: ${INR(added)}">${txt}</span></td>`;
    }).join('');
    return `<tr><td><strong>${esc(l.name)}</strong><br><span class="type-pill ${typePillClass(l.type)}">${l.type}</span></td><td class="num">${INR(l.amount)}</td>${cells}<td class="num"><strong>${INRs(tot)}</strong></td></tr>`;
  }).join('');
  document.getElementById('yearTable').innerHTML=head+'<tbody>'+body+'</tbody>';

  const savLabels=MONTHS.map(m=>m.label.split(' ')[0]);
  const planPerMonth=plan.filter(l=>SAVINGS_TYPES.includes(l.type)).reduce((s,l)=>s+l.amount,0);
  const savPlan=MONTHS.map(()=>planPerMonth);
  const savAct=MONTHS.map(m=>plan.filter(l=>SAVINGS_TYPES.includes(l.type)).reduce((s,l)=>s+((ACTUALS[m.id]||{})[l.name]?.added||0),0));

  // Color bars: teal=settled, amber=partial, light gray=not started
  const barColors=savAct.map(a=>
    a===0 ? 'rgba(198,207,188,.45)'
    : a>=planPerMonth ? 'rgba(18,122,107,.85)'
    : 'rgba(201,135,31,.8)'
  );
  const barBorders=savAct.map(a=>
    a===0 ? 'rgba(180,190,175,.6)'
    : a>=planPerMonth ? '#0F6E56'
    : '#B07818'
  );

  // YTD summary stats
  const ytdSaved=savAct.reduce((s,v)=>s+v,0);
  const monthsDone=savAct.filter(v=>v>0).length;
  const bestMonth=Math.max(...savAct);
  const bestIdx=savAct.indexOf(bestMonth);

  // Inject summary strip above chart
  const chartWrap=document.getElementById('savChartWrap')?.parentElement||document.getElementById('savingsChart').parentElement;
  let strip=chartWrap.querySelector('.sav-summary-strip');
  if(!strip){
    strip=document.createElement('div');
    strip.className='sav-summary-strip';
    strip.style.cssText='display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:10px';
    const savWrap=document.getElementById('savChartWrap'); if(savWrap) savWrap.parentElement.insertBefore(strip, savWrap); else chartWrap.insertBefore(strip,chartWrap.firstChild);
  }
  strip.innerHTML=[
    {l:'YTD saved',v:INRs(ytdSaved),c:'#127A6B'},
    {l:'Best month',v:bestMonth>0?savLabels[bestIdx]+' · '+INRs(bestMonth):'—',c:'#C9871F'},
    {l:'Monthly target',v:INR(planPerMonth),c:'#2E4A7D'}
  ].map(({l,v,c})=>`<div style="background:#F8F9F4;border:1.5px solid #E0E3D8;border-radius:8px;padding:8px 10px">
    <div style="font-size:9px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#66756D;margin-bottom:2px">${l}</div>
    <div style="font-size:13px;font-weight:700;color:${c};font-family:'IBM Plex Mono',monospace;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${v}</div>
  </div>`).join('');

  if(savingsChart) savingsChart.destroy();

  // Custom plugin: pct labels above bars + goal line
  const pctLabelPlugin={
    id:'pctLabels',
    afterDatasetsDraw(chart){
      const {ctx,data,scales:{x,y}}=chart;
      data.datasets[0].data.forEach((_,i)=>{
        const actual=savAct[i], plan2=planPerMonth;
        if(actual===0) return;
        const pct=plan2?Math.round(actual/plan2*100):0;
        const meta=chart.getDatasetMeta(0);
        const bar=meta.data[i];
        ctx.save();
        ctx.font='600 11px Inter, sans-serif';
        ctx.fillStyle=actual>=plan2?'#0F6E56':'#B07818';
        ctx.textAlign='center';
        ctx.textBaseline='bottom';
        ctx.fillText(pct+'%', bar.x, bar.y-3);
        ctx.restore();
      });
    }
  };

  const goalLinePlugin={
    id:'goalLine',
    afterDraw(chart){
      const {ctx,scales:{y},chartArea:{left,right}}=chart;
      const yVal=y.getPixelForValue(planPerMonth);
      ctx.save();
      ctx.setLineDash([6,4]);
      ctx.lineWidth=1.5;
      ctx.strokeStyle='rgba(46,74,125,.5)';
      ctx.beginPath(); ctx.moveTo(left,yVal); ctx.lineTo(right,yVal); ctx.stroke();
      ctx.setLineDash([]);
      ctx.font='500 10px Inter, sans-serif';
      ctx.fillStyle='rgba(46,74,125,.75)';
      ctx.textAlign='right';
      ctx.fillText('Target', right, yVal-4);
      ctx.restore();
    }
  };

  savingsChart=new Chart(document.getElementById('savingsChart'),{
    type:'bar',
    data:{
      labels:savLabels,
      datasets:[{
        label:'Actual saved',
        data:savAct,
        backgroundColor:barColors,
        borderColor:barBorders,
        borderWidth:1.5,
        borderRadius:6,
        borderSkipped:false,
        hoverBackgroundColor:savAct.map(a=>a===0?'rgba(198,207,188,.7)':a>=planPerMonth?'rgba(18,122,107,1)':'rgba(201,135,31,1)'),
      }]
    },
    options:{
      responsive:true,
      maintainAspectRatio:false,
      plugins:{
        legend:{display:false},
        tooltip:{
          backgroundColor:'rgba(21,37,46,.95)',
          titleColor:'#EFF1E9',
          bodyColor:'#B0C4BD',
          titleFont:{size:13,weight:'700'},
          bodyFont:{size:12},
          padding:{top:12,bottom:12,left:14,right:14},
          cornerRadius:10,
          callbacks:{
            title:ctx=>{
              const i=ctx[0].dataIndex;
              return MONTHS[i].label;
            },
            label:ctx=>{
              const i=ctx.dataIndex;
              const a=savAct[i], p=planPerMonth;
              const pct=p?Math.round(a/p*100):0;
              const status=a===0?'Not started':a>=p?'✓ Fully saved':'Partial — '+pct+'% done';
              return [
                '  Saved:  '+INR(a),
                '  Target: '+INR(p),
                '  Status: '+status
              ];
            }
          }
        }
      },
      onClick:(evt,elements)=>{
        if(elements.length){
          const i=elements[0].index;
          activeMonth=MONTHS[i].id;
          // Switch to This Month tab
          document.querySelector('[data-section="month"]')?.click();
        }
      },
      onHover:(evt,elements)=>{
        evt.native.target.style.cursor=elements.length?'pointer':'default';
      },
      scales:{
        x:{
          grid:{display:false},
          ticks:{font:{size:11,weight:'500'},color:'#66756D'}
        },
        y:{
          grid:{color:'rgba(0,0,0,.05)'},
          ticks:{
            callback:v=>`₹${(v/1000).toFixed(0)}k`,
            font:{size:11},
            color:'#66756D'
          },
          beginAtZero:true
        }
      },
      animation:{duration:500,easing:'easeOutQuart'}
    },
    plugins:[pctLabelPlugin, goalLinePlugin]
  });
}

// ── CORPUS ──────────────────────────────────────────────────
function renderCorpus(){
  const plan=PROFILE.plan||DEFAULT_PLAN;
  const savLines=plan.filter(l=>SAVINGS_TYPES.includes(l.type));
  let dep=0,vals={};
  savLines.forEach(l=>vals[l.name]=0);
  const deps=[],ests=[],plans=[];
  MONTHS.forEach((m,i)=>{
    let mDep=0;
    savLines.forEach(l=>{
      const a=((ACTUALS[m.id]||{})[l.name]||{}).added||0;
      mDep+=a;
      const r=l.type==='Savings'?(l.name.includes('SIP')?0.12:0.065):0.065;
      vals[l.name]=(vals[l.name]+a)*(1+r/12);
    });
    dep+=mDep;
    const est=Object.values(vals).reduce((a,b)=>a+b,0);
    const planTo=savLines.reduce((s,l)=>s+l.amount,0)*(i+1);
    deps.push(dep); ests.push(est); plans.push(planTo);
  });
  const last=ests[12]||0, lastDep=deps[12]||0;
  const planTotal=plans[12]||0;
  document.getElementById('cDeposited').textContent=INRs(lastDep);
  document.getElementById('cEst').textContent=INRs(last);
  document.getElementById('cGain').textContent=INR(last-lastDep);
  document.getElementById('cTarget').textContent=INRs(planTotal);
  const labels=MONTHS.map(m=>m.label.split(' ')[0]);
  if(corpusChart) corpusChart.destroy();
  corpusChart=new Chart(document.getElementById('corpusChart'),{
    type:'bar',
    data:{labels,datasets:[
      {type:'bar',label:'Deposited',data:deps,backgroundColor:'rgba(46,74,125,.65)',borderWidth:0},
      {type:'line',label:'Estimated',data:ests,borderColor:'#127A6B',backgroundColor:'rgba(18,122,107,.08)',borderWidth:2.5,pointRadius:3,fill:true,tension:.3},
      {type:'line',label:'Plan',data:plans,borderColor:'#8C9A90',borderWidth:1.8,borderDash:[5,4],pointRadius:0,fill:false}
    ]},
    options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'top',labels:{font:{size:11},boxWidth:20}}},scales:{y:{grid:{color:'rgba(0,0,0,.04)'},ticks:{callback:v=>INRs(v),font:{size:10}}},x:{grid:{display:false},ticks:{font:{size:10}}}}}
  });
  renderProjection();
}

function renderProjection(){
  const plan=PROFILE.plan||DEFAULT_PLAN;
  const eqRate=+(document.getElementById('projRate')?.value||12)/100/12;
  const fdRate=+(document.getElementById('projFd')?.value||6.5)/100/12;
  const eqM=plan.filter(l=>l.name.includes('SIP')).reduce((s,l)=>s+l.amount,0)||2000;
  const fdM=plan.filter(l=>l.type==='Savings'&&!l.name.includes('SIP')).reduce((s,l)=>s+l.amount,0)||25000;
  let eq=0,fd=0,tot=[],put=[];
  for(let i=0;i<120;i++){
    eq=(eq+eqM)*(1+eqRate); fd=(fd+fdM)*(1+fdRate);
    tot.push(eq+fd); put.push((eqM+fdM)*(i+1));
  }
  const labels=Array.from({length:120},(_,i)=>`Y${Math.floor(i/12)+1}`).filter((_,i)=>i%12===11);
  const totY=tot.filter((_,i)=>(i+1)%12===0);
  const putY=put.filter((_,i)=>(i+1)%12===0);
  if(projChart) projChart.destroy();
  projChart=new Chart(document.getElementById('projChart'),{
    type:'line',
    data:{labels,datasets:[
      {label:'Corpus',data:totY,borderColor:'#127A6B',backgroundColor:'rgba(18,122,107,.1)',fill:true,borderWidth:2.5,tension:.4},
      {label:'Invested',data:putY,borderColor:'#8C9A90',borderWidth:1.8,borderDash:[5,4],fill:false,tension:.4}
    ]},
    options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'top',labels:{font:{size:11},boxWidth:20}}},scales:{y:{grid:{color:'rgba(0,0,0,.04)'},ticks:{callback:v=>INRs(v),font:{size:10}}},x:{grid:{display:false},ticks:{font:{size:10}}}}}
  });
  const ms=document.getElementById('projMilestones');
  ms.innerHTML=[[1,12],[3,36],[5,60],[10,120]].map(([yr,i])=>{
    const v=tot[i-1]||0,p=put[i-1]||0;
    return `<div class="kpi" style="padding:8px 10px"><div class="kpi-l" style="font-size:9px">Year ${yr}</div><div class="kpi-v" style="font-size:14px">${INRs(v)}</div><div style="font-size:10px;color:var(--slate)">+${INRs(v-p)}</div></div>`;
  }).join('');
  document.getElementById('projRate')?.addEventListener('change',renderProjection);
  document.getElementById('projFd')?.addEventListener('change',renderProjection);
}

// ── REMINDERS ────────────────────────────────────────────────
function renderReminders(){
  document.getElementById('remEmail').value=USER.email;
  document.getElementById('remWhatsapp').value=PROFILE.whatsapp||'';
  document.getElementById('remApiKey').value=PROFILE.callmebot_key||'';
  document.getElementById('remDay').value=PROFILE.reminder_day||'Saturday';
  document.getElementById('remFreq').value=PROFILE.chase_every_days||2;
  document.getElementById('saveRemBtn').onclick=saveReminders;
  document.getElementById('testEmailBtn').onclick=testEmail;
  document.getElementById('testWaBtn').onclick=testWhatsApp;
  loadRemLog();
}

async function saveReminders(){
  const {error}=await sb.from('profiles').update({
    whatsapp:document.getElementById('remWhatsapp').value.trim(),
    callmebot_key:document.getElementById('remApiKey').value.trim(),
    reminder_day:document.getElementById('remDay').value,
    chase_every_days:+document.getElementById('remFreq').value
  }).eq('id',USER.id);
  if(error){msg('remMsg',error.message,true);return;}
  PROFILE.whatsapp=document.getElementById('remWhatsapp').value.trim();
  PROFILE.callmebot_key=document.getElementById('remApiKey').value.trim();
  PROFILE.reminder_day=document.getElementById('remDay').value;
  PROFILE.chase_every_days=+document.getElementById('remFreq').value;
  msg('remMsg','Reminder settings saved.');
}

async function testEmail(){
  msg('remMsg','Test email feature requires the GitHub Actions cron to be deployed. See GUIDE.md.');
}

async function testWhatsApp(){
  const num=PROFILE.whatsapp, key=PROFILE.callmebot_key;
  if(!num||!key){msg('remMsg','Save your WhatsApp number and CallMeBot API key first.',true);return;}
  const phone=num.replace(/\D/g,'');
  const text=encodeURIComponent('BudgetFlow test: your reminders are working!');
  const url=`https://api.callmebot.com/whatsapp.php?phone=${phone}&text=${text}&apikey=${key}`;
  try{
    await fetch(url,{mode:'no-cors'});
    msg('remMsg','WhatsApp message sent — check your phone.');
  }catch(e){msg('remMsg','Sent (check your phone — browser security may block the response).');}
}

async function loadRemLog(){
  const {data}=await sb.from('reminder_log').select('*').eq('user_id',USER.id).order('sent_at',{ascending:false}).limit(10);
  const tbody=document.getElementById('remLogBody');
  if(!data||!data.length){tbody.innerHTML='<tr><td colspan="3" style="color:var(--slate);font-size:13px">No reminders sent yet.</td></tr>';return;}
  tbody.innerHTML=data.map(r=>`<tr>
    <td class="num">${new Date(r.sent_at).toLocaleDateString('en-IN')}</td>
    <td>${r.channel}</td>
    <td>${esc(r.message||'')}</td>
  </tr>`).join('');
}

// ── SETTINGS ─────────────────────────────────────────────────
function renderSettings(){
  document.getElementById('settIncome').value=PROFILE.income||55000;
  document.getElementById('settPayday').value=PROFILE.payday_date||1;
  let settPlan=[...(PROFILE.plan||DEFAULT_PLAN)];

  function renderSettPlan(){
    const tbody=document.getElementById('settPlanBody');
    tbody.innerHTML=settPlan.map((l,i)=>`
      <tr>
        <td><input value="${esc(l.name)}" data-i="${i}" data-f="name" placeholder="Line name"></td>
        <td><input type="number" value="${l.amount}" data-i="${i}" data-f="amount" min="0" step="100" style="width:110px"></td>
        <td><select data-i="${i}" data-f="type">
          ${['Fixed','Savings','Flexible'].map(t=>`<option${l.type===t?' selected':''}>${t}</option>`).join('')}
        </select></td>
        <td><button class="del-btn" data-del="${i}">✕</button></td>
      </tr>`).join('');
    tbody.querySelectorAll('[data-f]').forEach(el=>{
      el.onchange=()=>{const i=+el.dataset.i,f=el.dataset.f;settPlan[i][f]=f==='amount'?(parseFloat(el.value)||0):el.value;updateSettBal();};
    });
    tbody.querySelectorAll('[data-del]').forEach(b=>{b.onclick=()=>{settPlan.splice(+b.dataset.del,1);renderSettPlan();};});
    updateSettBal();
  }

  function updateSettBal(){
    const income=parseFloat(document.getElementById('settIncome').value)||0;
    const total=settPlan.reduce((s,l)=>s+(+l.amount||0),0);
    const diff=income-total;
    const badge=document.getElementById('settBalanceBadge');
    badge.textContent=diff===0?'Balanced':diff>0?`${INR(diff)} unassigned`:`${INR(-diff)} over`;
    badge.className='balance-badge '+(diff===0?'ok':'bad');
  }

  renderSettPlan();
  document.getElementById('settIncome').oninput=updateSettBal;
  document.getElementById('settAddLineBtn').onclick=()=>{settPlan.push({name:'New line',amount:0,type:'Fixed'});renderSettPlan();};
  document.getElementById('saveSettingsBtn').onclick=async()=>{
    const income=parseFloat(document.getElementById('settIncome').value)||0;
    const payday=+document.getElementById('settPayday').value;

    // Read rows in current DOM order so drag-and-drop reordering is respected
    const rows=document.getElementById('settPlanBody').querySelectorAll('tr');
    const orderedPlan=Array.from(rows).map(row=>{
      const el=row.querySelector('[data-i]');
      return el ? settPlan[+el.dataset.i] : null;
    }).filter(Boolean);
    // Sync settPlan to DOM order and re-index data-i
    settPlan=orderedPlan;
    rows.forEach((row,idx)=>row.querySelectorAll('[data-i]').forEach(el=>el.dataset.i=idx));

    const {error}=await sb.from('profiles').update({income,payday_date:payday,plan:settPlan}).eq('id',USER.id);
    if(error){msg('settMsg',error.message,true);return;}
    PROFILE.income=income; PROFILE.payday_date=payday; PROFILE.plan=settPlan;
    msg('settMsg','Settings saved.'); renderAll();
  };
  document.getElementById('deleteAccountBtn').onclick=async()=>{
    if(!confirm('This deletes your account and all budget data permanently. Are you sure?'))return;
    await sb.from('actuals').delete().eq('user_id',USER.id);
    await sb.from('month_notes').delete().eq('user_id',USER.id);
    await sb.from('profiles').delete().eq('id',USER.id);
    await sb.auth.admin.deleteUser(USER.id).catch(()=>{});
    await sb.auth.signOut(); window.location.href='index.html';
  };
}

// ── HELPERS ───────────────────────────────────────────────────
function chipStatus(plan,added,reason){
  if(plan>0&&added>=plan) return['chip-settled','Settled'];
  if(reason) return['chip-explained','Explained'];
  if(added>0) return['chip-part','Part paid'];
  return['chip-pending','Pending'];
}
function ordinal(n){const s=['th','st','nd','rd'],v=n%100;return s[(v-20)%10]||s[v]||s[0];}
function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
