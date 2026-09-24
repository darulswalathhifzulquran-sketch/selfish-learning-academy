(()=>{
'use strict';
if(window.__slaProEnhance)return;window.__slaProEnhance=true;
const q=(s,r=document)=>r.querySelector(s), qa=(s,r=document)=>[...r.querySelectorAll(s)];
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const path=()=>location.hash.slice(1).split('?')[0]||'/';
let io=null;

function navPolish(){
 const p=path();
 qa('.navlinks a,.feature-nav a').forEach(a=>{
  const href=(a.getAttribute('href')||'').replace(/^#/, '').split('?')[0];
  a.classList.toggle('pro-active', href===p || (href==='/dashboard'&&p.startsWith('/dashboard')));
 });
}

function authExamples(){
 const name=q('#fullName'), user=q('#username');
 if(name&&!name.dataset.proExample){name.dataset.proExample='1';name.placeholder='e.g. Hafiz Rinshad';}
 if(user&&!user.dataset.proExample){user.dataset.proExample='1';user.placeholder='e.g. hafiz.rinshad';}
}

function sampleThoughtMarkup(){
 return `<div class="sample-thoughts"><div class="sample-note">Sample student profiles</div><article class="sample-thought"><p>“The chapter-wise request system makes it easier to focus on exactly what I need instead of searching through large bundles.”</p><div class="sample-person"><span class="sample-avatar">HR</span><div><strong>Hafiz Rinshad</strong><small>B.Sc MLT · SELFISH STUDENT · Sample</small></div></div></article><article class="sample-thought"><p>“I like having requests, updates and learning materials in one place. The process feels clear and organised.”</p><div class="sample-person"><span class="sample-avatar">AF</span><div><strong>Amina Fathima</strong><small>B.Com Finance · SELFISH STUDENT · Sample</small></div></div></article></div>`;
}
function thoughtFallback(){
 qa('.thought-empty').forEach(el=>{if(el.dataset.proFilled)return;el.dataset.proFilled='1';el.outerHTML=sampleThoughtMarkup();});
}

function universitySuggestions(input){
 if(!input||input.dataset.proUni)return;
 input.dataset.proUni='1';input.setAttribute('list','sla-university-suggestions');
 const form=input.closest('form');
 if(form&&!q('#sla-university-suggestions',form)){
  const d=document.createElement('datalist');d.id='sla-university-suggestions';
  ['University of Calicut','University of Kerala','Mahatma Gandhi University','Kannur University','Kerala University of Health Sciences (KUHS)','APJ Abdul Kalam Technological University (KTU)','Cochin University of Science and Technology (CUSAT)','IGNOU','Private College / Institution','Other University / Institution'].forEach(x=>{const o=document.createElement('option');o.value=x;d.appendChild(o)});
  form.appendChild(d);
 }
 const help=document.createElement('div');help.className='id-form-help';help.textContent='Type your exact university or college name, or choose a suggestion.';input.parentElement?.appendChild(help);
}

function studentIdEnhance(){
 if(path()!=='/student-id')return;
 const form=q('#idDetailsForm'), course=q('#idCourse'), institution=q('#idInstitution');
 if(!form)return;
 universitySuggestions(institution);
 const main=q('.id-main');
 if(main&&!q('.id-username',main)){
  const username=(window.__slaStudentUsername||'').trim();
  const el=document.createElement('div');el.className='id-username';el.id='idUsernamePreview';el.textContent=username?`@${username}`:'@student';main.appendChild(el);
  fetch('/api/student/id-card',{credentials:'include'}).then(r=>r.ok?r.json():null).then(d=>{
   const u=d?.student?.username;if(u){window.__slaStudentUsername=u;const v=q('#idUsernamePreview');if(v)v.textContent='@'+u;}
  }).catch(()=>{});
 }
 if(course&&!course.dataset.proLive){course.dataset.proLive='1';course.addEventListener('input',()=>{const t=q('#idCoursePreview');if(t)t.textContent=course.value.trim()||'Not set';});}
 if(institution&&!institution.dataset.proLive){institution.dataset.proLive='1';institution.addEventListener('input',()=>{const t=q('#idInstitutionPreview');if(t)t.textContent=institution.value.trim()||'Not set';});}
 const input=q('#photoInput');
 if(input&&!input.dataset.proPreview){
  input.dataset.proPreview='1';
  const note=document.createElement('div');note.className='photo-live-note';note.textContent='Your selected photo will preview instantly on the ID card before upload.';input.closest('form')?.insertAdjacentElement('afterend',note);
  input.addEventListener('change',()=>{
   const f=input.files?.[0];if(!f||!/^image\/(jpeg|png|webp)$/i.test(f.type))return;
   const rd=new FileReader();rd.onload=()=>{
    let target=q('#idPhotoPreview');
    if(!target)return;
    if(target.tagName!=='IMG'){
      const img=document.createElement('img');img.id='idPhotoPreview';img.alt='Student photo preview';target.replaceWith(img);target=img;
    }
    target.src=String(rd.result||'');
   };rd.readAsDataURL(f);
  });
 }
}

function injectVisualStory(){
 if(path()!=='/'||q('.pro-visual-story'))return;
 const anchor=q('.university-pro-section');if(!anchor)return;
 const section=document.createElement('section');section.className='pro-visual-story';
 section.innerHTML=`<div class="wrap"><div class="section-head compact"><div><div class="eyebrow">A MORE FOCUSED WAY TO STUDY</div><h2>Academic support that feels structured, modern and personal.</h2></div><p>From a precise chapter request to AI-ready future skills, every part of the academy is designed around a student’s own learning path.</p></div><div class="pro-story-grid"><article class="pro-story-card"><div class="pro-story-media"><img src="/academic-visual.svg" alt="Personalised academic learning dashboard illustration"></div><div class="pro-story-copy"><div class="eyebrow">PERSONALISED ACADEMIC SUPPORT</div><h3>One clear place for your own syllabus.</h3><p>Request exactly what you are studying, follow the status, receive updates and open approved materials from your learning space.</p><div class="pro-story-badges"><span>Chapter-wise</span><span>University-ready</span><span>Notifications</span><span>Learning library</span></div></div></article><article class="pro-story-card"><div class="pro-story-media"><img src="/ai-learning.svg" alt="Modern AI learning illustration"></div><div class="pro-story-copy"><div class="eyebrow">FUTURE-READY LEARNING</div><h3>Build useful AI skills alongside academics.</h3><p>Upcoming learning tracks focus on practical prompting, research, data analysis and responsible AI workflows for students.</p><div class="pro-story-badges"><span>AI foundations</span><span>Research</span><span>Data</span><span>Automation</span></div></div></article></div></div>`;
 anchor.insertAdjacentElement('afterend',section);
}

function animate(){
 if(!('IntersectionObserver'in window))return;
 if(!io)io=new IntersectionObserver(entries=>entries.forEach(e=>{if(e.isIntersecting){e.target.classList.add('in-view');io.unobserve(e.target)}}),{threshold:.08,rootMargin:'0px 0px -28px'});
 qa('main section,.uni-pro-card,.programme,.home-feature-card,.pro-story-card,.student-id-preview,.share-thought').forEach(el=>{if(el.dataset.proAnim)return;el.dataset.proAnim='1';el.classList.add('pro-animate');io.observe(el)});
}

function run(){navPolish();authExamples();thoughtFallback();studentIdEnhance();injectVisualStory();animate();}
window.addEventListener('hashchange',()=>setTimeout(run,40));
window.addEventListener('load',()=>setTimeout(run,80));
new MutationObserver(()=>{clearTimeout(window.__slaProTimer);window.__slaProTimer=setTimeout(run,30)}).observe(document.documentElement,{subtree:true,childList:true});
setTimeout(run,80);
})();