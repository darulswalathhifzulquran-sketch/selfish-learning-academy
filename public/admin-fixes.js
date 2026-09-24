(()=>{'use strict';if(window.__slaAdminFixes)return;window.__slaAdminFixes=true;
const q=(s,r=document)=>r.querySelector(s),qa=(s,r=document)=>[...r.querySelectorAll(s)];
const RESET_KEY='sla-admin-fresh-gate';let cleaning=false;

async function forceFreshGate(){
 if(sessionStorage.getItem(RESET_KEY)==='reloaded'){sessionStorage.removeItem(RESET_KEY);return}
 sessionStorage.setItem(RESET_KEY,'reloaded');
 q('#panel')?.classList.add('hidden');q('#gate')?.classList.remove('hidden');q('#logout')?.classList.add('hidden');
 try{await fetch('/api/admin/auth/logout',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:'{}'})}catch{}
 location.reload();
}

function cleanPaymentUi(){
 if(cleaning)return;cleaning=true;try{
  const sub=q('.dashHead .sub');if(sub)sub.textContent='Review student requirements, prepare resources, grant access and deliver learning materials.';
  qa('.kpi').forEach(k=>{if(/payment/i.test(k.textContent))k.classList.add('payment-ui-hidden')});
  const table=q('.table');if(table){
   const heads=qa('thead th',table);
   heads.forEach((h,i)=>{
    const t=h.textContent.trim();
    if(/Payment/i.test(t)){h.style.display='none';qa(`tbody tr`,table).forEach(r=>{const c=r.children[i];if(c)c.style.display='none'})}
    if(/Quote \/ Delivery/i.test(t)||/Quote/i.test(t)){h.textContent='Preparation / Delivery';qa('tbody tr',table).forEach(r=>{const c=r.children[i];if(!c)return;const price=c.querySelector('input[type="number"]');if(price)price.style.display='none'})}
   });
  }
  qa('select[id^="status"]').forEach(sel=>{
   if(sel.dataset.cleanStatus)return;sel.dataset.cleanStatus='1';
   const current=sel.value;const mapped=/quotation|payment/i.test(current)?'Under review':current;
   sel.innerHTML=['Under review','Preparing materials','Ready','Completed'].map(x=>`<option ${x===mapped?'selected':''}>${x}</option>`).join('');
  });
  qa('*').forEach(el=>{if(el.children.length===0&&/payment/i.test(el.textContent||'')){if(!el.closest('script,style'))el.textContent=el.textContent.replace(/payment verification/gi,'request review').replace(/payment/gi,'request')}});
 }finally{cleaning=false}
}

function lightAdmin(){document.body.style.colorScheme='light';document.body.classList.remove('dark')}

if(sessionStorage.getItem(RESET_KEY)!=='reloaded')forceFreshGate();else{sessionStorage.removeItem(RESET_KEY);lightAdmin();setTimeout(cleanPaymentUi,80);new MutationObserver(()=>{clearTimeout(window.__slaAdminCleanTimer);window.__slaAdminCleanTimer=setTimeout(cleanPaymentUi,30)}).observe(document.documentElement,{subtree:true,childList:true});}
})();