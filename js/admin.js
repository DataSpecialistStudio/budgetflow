// ============================================================
//  ADMIN.JS
// ============================================================
document.addEventListener('DOMContentLoaded',async()=>{
  const user=await requireAuth();
  if(!user){return;}
  if(user.email!==ADMIN_EMAIL){
    document.querySelector('.app-body').innerHTML='<div style="padding:60px;text-align:center;color:var(--slate)">Admin access only.</div>';
    return;
  }

  const {data:users}=await sb.from('profiles').select('*').order('created_at',{ascending:false});
  if(!users){document.getElementById('adminMsg').textContent='Could not load users.';return;}

  const now=new Date(), thisMonth=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  const active=users.filter(u=>u.last_active&&u.last_active.startsWith(thisMonth.slice(0,7)));
  const newU=users.filter(u=>u.created_at&&u.created_at.startsWith(thisMonth.slice(0,7)));
  const {data:logs}=await sb.from('reminder_log').select('id',{count:'exact'});

  document.getElementById('totalUsers').textContent=users.length;
  document.getElementById('activeUsers').textContent=active.length;
  document.getElementById('remsSent').textContent=(logs||[]).length;
  document.getElementById('newUsers').textContent=newU.length;

  let allUsers=[...users];

  function renderUsers(list){
    document.getElementById('usersBody').innerHTML=list.map(u=>`
      <tr>
        <td>${esc(u.email)}</td>
        <td>${esc(u.full_name||'—')}</td>
        <td class="num">${u.created_at?new Date(u.created_at).toLocaleDateString('en-IN'):'—'}</td>
        <td class="num">${u.last_active?new Date(u.last_active).toLocaleDateString('en-IN'):'—'}</td>
        <td>${u.payday_date||'—'}</td>
        <td><button class="del-btn" data-uid="${u.id}" data-uemail="${esc(u.email)}">Delete</button></td>
      </tr>`).join('');
    document.querySelectorAll('[data-uid]').forEach(b=>{
      b.onclick=async()=>{
        if(!confirm(`Delete ${b.dataset.uemail} and all their data?`))return;
        await sb.from('actuals').delete().eq('user_id',b.dataset.uid);
        await sb.from('month_notes').delete().eq('user_id',b.dataset.uid);
        await sb.from('profiles').delete().eq('id',b.dataset.uid);
        allUsers=allUsers.filter(u=>u.id!==b.dataset.uid);
        document.getElementById('totalUsers').textContent=allUsers.length;
        renderUsers(allUsers);
        document.getElementById('adminMsg').textContent=`Deleted ${b.dataset.uemail}.`;
      };
    });
  }

  renderUsers(allUsers);

  document.getElementById('userSearch').oninput=e=>{
    const q=e.target.value.toLowerCase();
    renderUsers(q?allUsers.filter(u=>(u.email||'').toLowerCase().includes(q)):allUsers);
  };
});
function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
