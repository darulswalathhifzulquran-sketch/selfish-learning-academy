(()=>{'use strict';if(window.__slaAdminEnhance)return;window.__slaAdminEnhance=true;
const q=s=>document.querySelector(s);let timer=null;
const metric=(label,value,sub,pct)=>`<article class="admin-metric"><small>${label}</small><strong>${value}</strong><span>${sub}</span><div class="bar"><i style="width:${Math.max(4,Math.min(100,pct||0))}%"></i></div></article>`;
async function loadStats(){
 const panel=q('#panel');if(!panel||panel.classList.contains('hidden'))return;
 try{
  const r=await fetch('/api/admin/stats',{credentials:'same-origin'});if(!r.ok)return;const d=await r.json();
  let box=q('#adminLiveOverview');if(!box){box=document.createElement('section');box.id='adminLiveOverview';const head=q('.dashHead');head?.insertAdjacentElement('afterend',box);}
  const total=Math.max(1,Number(d.total_students||0));
  const activePct=Math.round(Number(d.active_students_30d||0)/total*100);
  const requestPct=Math.min(100,Math.round(Number(d.total_requests||0)/total*25));
  box.innerHTML=`<div class="admin-kicker">Live academy account overview · MongoDB Atlas</div><div class="admin-overview">${metric('Student accounts',d.total_students||0,'Total students who created an account',100)}${metric('New this week',d.new_students_7d||0,'Accounts created in the last 7 days',Math.min(100,(d.new_students_7d||0)*20))}${metric('Active students',d.active_students_30d||0,'Logged in during the last 30 days',activePct)}${metric('Learning requests',d.total_requests||0,'All submitted personalised requests',requestPct)}</div><div class="admin-insight"><div class="admin-insight-card"><strong>${d.pending_requests||0} requests need attention</strong><p>${d.ready_requests||0} ready/completed · ${d.materials_count||0} delivered learning resources · ${d.approved_thoughts||0} published student thoughts.</p></div><div class="admin-insight-card"><strong>${d.notifications_sent||0} student notifications</strong><p>Request, material and learning-access updates sent through the academy notification system.</p></div></div>`;
 }catch(e){console.warn('Admin stats unavailable',e)}
}
function watch(){loadStats();clearInterval(timer);timer=setInterval(loadStats,30000)}
new MutationObserver(()=>{const p=q('#panel');if(p&&!p.classList.contains('hidden'))loadStats()}).observe(document.documentElement,{subtree:true,attributes:true,attributeFilter:['class'],childList:true});
window.addEventListener('load',watch);setTimeout(watch,300);
})();