// ============================================================
//  BUDGETFLOW CONFIG
//  Fill in your Supabase URL and anon key after creating
//  your free project at supabase.com
//  The setup.bat will prompt you for these and fill them in.
// ============================================================

const SUPABASE_URL  = 'https://yccxlxyghjrbpchryrtl.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InljY3hseHlnaGpyYnBjaHJ5cnRsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODczMzE5OTAsImV4cCI6MjEwMjkwNzk5MH0.2CauV8XYm84kctHhAT5w_a2JeCSlQ2cLg6uvn568Ruw';
const ADMIN_EMAIL   = 'dataspecialiststudio@gmail.com';  // your Gmail — gets the admin panel

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON);

// Months Aug 2026 → Aug 2027
const MONTHS = (()=>{
  const names=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const out=[]; let y=2026, m=7;
  for(let i=0;i<13;i++){
    out.push({id:`${y}-${String(m+1).padStart(2,'0')}`, label:`${names[m]} ${y}`});
    m++; if(m>11){m=0;y++;}
  } return out;
})();

const INR = n => '₹'+Math.round(Number(n)||0).toLocaleString('en-IN');
const INRs = n => Math.abs(n)>=1e5?'₹'+(n/1e5).toFixed(2)+'L':INR(n);

const DEFAULT_PLAN = [
  {name:'FD savings',          amount:20700, type:'Savings'},
  {name:'Credit card EMIs',    amount:10200, type:'Fixed'},
  {name:'Emergency fund',      amount:5000,  type:'Savings'},
  {name:'Lifestyle',           amount:4800,  type:'Flexible'},
  {name:'Health + life policy',amount:2000,  type:'Fixed'},
  {name:'Equity SIP',          amount:2000,  type:'Savings'},
  {name:'Travel + festivals',  amount:2500,  type:'Flexible'},
  {name:'Commute + phone',     amount:1800,  type:'Fixed'},
  {name:'Unallocated buffer',  amount:6000,  type:'Flexible'},
];

const SAVINGS_TYPES = ['Savings'];
const GROUP_COLORS  = {Fixed:'#2E4A7D', Savings:'#127A6B', Flexible:'#C9871F'};

function toast(msg, isErr=false){
  const t=document.getElementById('toast');
  if(!t)return;
  t.textContent=msg; t.className='toast show'+(isErr?' err':'');
  clearTimeout(t._t); t._t=setTimeout(()=>t.className='toast',isErr?4000:2000);
}

function msg(id, text, isErr=false){
  const el=document.getElementById(id);
  if(!el)return;
  el.textContent=text; el.className='auth-msg'+(isErr?' error':' success');
}

function currentMonthId(){
  const now=new Date(), m=now.getMonth(), y=now.getFullYear();
  return `${y}-${String(m+1).padStart(2,'0')}`;
}
