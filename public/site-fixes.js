(()=>{'use strict';if(window.__slaSiteFixes)return;window.__slaSiteFixes=true;
const q=(s,r=document)=>r.querySelector(s),qa=(s,r=document)=>[...r.querySelectorAll(s)];
const path=()=>location.hash.slice(1).split('?')[0]||'/';
let busy=false,idFetch=false;

const previewThoughts=[
 ['Amjed','B.Sc MLT','The request flow feels clear and focused. I can choose the exact chapter I need and follow everything from one learning space.'],
 ['Afsal Rahman','B.Com Finance','The chapter-wise structure makes revision easier because I can concentrate on one academic need at a time.'],
 ['Fathima Nida','B.Sc Psychology','I like the clean learning dashboard and the way materials are organised around my own course and subject.'],
 ['Nihal','BCA','The notifications and request tracking make the learning process feel organised and easy to follow.'],
 ['Safa Mariyam','BA English','The platform gives a simple path from a difficult topic to a focused set of learning resources.'],
 ['Adil','B.Sc Computer Science','I can request exactly what I am studying instead of searching through unrelated notes and large material bundles.'],
 ['Hiba','B.Com Co-operation','The personalised approach helps me keep my study plan simple, especially when exams are getting closer.'],
 ['Shamil','B.Sc MLT','Having requests, learning materials and progress in one place makes the overall study workflow much easier to manage.']
];

function setLightDefault(){
 if(!localStorage.getItem('sla-light-reset-v4')){localStorage.setItem('sla-light-reset-v4','1');localStorage.setItem('el-dark','0')}
 if(localStorage.getItem('el-dark')!=='1'&&document.body.classList.contains('dark')){
  const b=q('[data-act="theme"]');if(b)b.click();else document.body.classList.remove('dark');
 }
}

function movingFeatureMenu(){
 const inner=q('.feature-nav-inner');if(!inner||inner.dataset.tickerReady)return;
 const links=qa(':scope > a',inner);if(!links.length)return;
 inner.dataset.tickerReady='1';
 const track=document.createElement('div');track.className='feature-track';
 const addSet=(clone=false)=>links.forEach((a,i)=>{const n=clone?a.cloneNode(true):a;if(clone){n.setAttribute('aria-hidden','true');n.tabIndex=-1}track.appendChild(n);const sep=document.createElement('span');sep.className='ticker-sep';sep.setAttribute('aria-hidden','true');track.appendChild(sep)});
 addSet(false);addSet(true);inner.replaceChildren(track);
}

function removeLanguageChoice(){
 if(path()!=='/register')return;const lang=q('#language');if(!lang||lang.type==='hidden')return;
 const field=lang.closest('.field');if(field){field.innerHTML='<input id="language" type="hidden" value="English">'}
}

function replaceExactText(root,from,to){
 if(!root)return;const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);let n;while((n=walker.nextNode())){if(n.nodeValue&&n.nodeValue.includes(from))n.nodeValue=n.nodeValue.split(from).join(to)}
}
function paymentCleanup(){
 if(path()==='/dashboard/payments'){location.hash='/dashboard/requests';return}
 qa('.side-item').filter(x=>/^Payments$/i.test(x.textContent.trim())).forEach(x=>x.remove());
 qa('.stat').forEach(s=>{const l=q('.stat-label',s);if(l&&/awaiting payment/i.test(l.textContent)){l.textContent='In review';const sm=q('small',s);if(sm)sm.textContent='Requests being reviewed or prepared'}});
 qa('.steps-grid > div').forEach(step=>{
  const h=q('h3',step),p=q('p',step);if(!h||!p)return;
  if(/quotation/i.test(h.textContent)){h.textContent='We review your request';p.textContent='We check the academic details and preparation requirements.'}
  if(/pay after/i.test(h.textContent)){h.textContent='We prepare your materials';p.textContent='Your requested learning resources move into preparation.'}
 });
 const req=q('.request-notify-note p');if(req)req.textContent='After you submit, updates will appear in Notifications when your request is reviewed or your learning materials are ready.';
 const suc=q('.success-notify p');if(suc)suc.textContent='We’ll send an in-app notification when your request is reviewed or your learning materials are ready.';
 const notifHead=q('.workspace-top p');if(path()==='/notifications'&&notifHead)notifHead.textContent='Request, material and access updates appear here.';
 qa('.notification-item').forEach(el=>{if(/payment|quotation|price/i.test(el.textContent))el.classList.add('payment-ui-hidden')});
 qa('.card p,.reading p').forEach(p=>{
  if(/sends a quotation, verifies payment/i.test(p.textContent))p.textContent='You request specific materials, the admin reviews the requirement, prepares the learning resources and grants access when they are ready.';
 });
 replaceExactText(document.body,'quotation, payment verification or learning materials','request review or learning materials');
 replaceExactText(document.body,'quotation or learning materials','request review or learning materials');
}

function previewThoughtMarkup(){
 return `<div class="preview-thoughts">${previewThoughts.map(([name,course,thought])=>`<article class="preview-thought"><div class="preview-label">Student voice preview</div><p>“${thought}”</p><div class="preview-person"><span class="avatar">${name[0]}</span><div><strong>${name}</strong><small>${course} · SELFISH STUDENT</small></div></div></article>`).join('')}</div>`;
}
function thoughtFix(){
 qa('.sample-thoughts').forEach(el=>el.outerHTML=previewThoughtMarkup());
 qa('.thought-empty').forEach(el=>el.outerHTML=previewThoughtMarkup());
 qa('.sample-note').forEach(el=>el.remove());
 qa('*').forEach(el=>{if(el.children.length===0&&/Hafiz Rinshad/.test(el.textContent))el.textContent=el.textContent.replace(/Hafiz Rinshad/g,'Amjed')});
}

async function idCardFix(){
 if(path()!=='/student-id')return;
 const form=q('#idDetailsForm');if(!form)return;
 let idName=q('#idName');
 if(!idName){
  const field=document.createElement('div');field.className='field id-extra-field';field.innerHTML='<label>ID Name</label><input id="idName" maxlength="60" placeholder="Name to print on your ID card"><div class="id-form-help">This can be different from your login username.</div>';
  const btn=form.querySelector('button[type="submit"],button');form.insertBefore(field,btn);idName=q('#idName');
  idName.addEventListener('input',()=>{const v=q('#idNamePreview');if(v)v.textContent=idName.value.trim()||'Student'});
  form.addEventListener('submit',()=>{const value=idName.value.trim();fetch('/api/student/id-card',{method:'PUT',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({idName:value})}).catch(()=>{})});
 }
 qa('.id-username').forEach(x=>x.remove());
 if(idFetch)return;idFetch=true;
 try{
  const r=await fetch('/api/student/id-card',{credentials:'include'});if(!r.ok)return;const d=await r.json(),s=d.student||{};
  if(idName&&!idName.value)idName.value=s.id_name||s.full_name||'';
  const main=q('.id-main');if(main){
   let nm=q('#idNamePreview',main);if(!nm){nm=document.createElement('div');nm.id='idNamePreview';nm.className='id-idname';main.appendChild(nm)}nm.textContent=s.id_name||s.full_name||'Student';
   let code=q('#selfishCodePreview',main);if(!code){code=document.createElement('div');code.id='selfishCodePreview';code.className='id-selfish-code';main.appendChild(code)}code.innerHTML='SELFISH CODE · <b>'+String(s.selfish_code||'').replace(/[<>&]/g,'')+'</b>';
   const old=q('.id-number',main);if(old){old.textContent='Academy ID · '+(s.enrollment_id||'');old.style.fontSize='.7rem';old.style.opacity='.72'}
  }
 }catch{}finally{idFetch=false}
}

function run(){if(busy)return;busy=true;try{setLightDefault();movingFeatureMenu();removeLanguageChoice();paymentCleanup();thoughtFix();idCardFix()}finally{busy=false}}
window.addEventListener('hashchange',()=>setTimeout(run,30));window.addEventListener('load',()=>setTimeout(run,60));
new MutationObserver(()=>{clearTimeout(window.__slaFixTimer);window.__slaFixTimer=setTimeout(run,25)}).observe(document.documentElement,{subtree:true,childList:true});
setTimeout(run,80);
})();