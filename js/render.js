'use strict';
/* Tareas. Drawing: root render, partial repaint (R18), swipe between tabs, and the Tareas, Proyectos, Ajustes and detail screens.
   A classic script: index.html loads every file of js/ in order and they share their global names. Only declarations and
   listeners run at load; the start itself (first screen, timers, sync, service worker) is in boot.js, the last file. */
/* ---------- Root render ---------- */
const app=$('#app'), tabbarEl=$('#tabbar');
const TABS=['tareas','proyectos','ajustes'];
// Root screens: one per tab, kept alive so each keeps its scroll position
function rootScreen(tab){
  let scr=app.querySelector('.screen.root[data-root="'+tab+'"]');
  if(!scr){ scr=document.createElement('div'); scr.className='screen root hidden-tab'; scr.dataset.root=tab; app.insertBefore(scr, app.firstChild); renderRoot(scr); }
  return scr;
}
function renderRoot(scr){
  const tab=scr.dataset.root;
  drawing(()=>swapHTML(scr, tab==='tareas'?viewTareas():tab==='proyectos'?viewProyectos():viewAjustes(), tab==='tareas'));
}
/* FLIP: when a render follows a user action, rows that moved slide to their new place and new rows fade in */
let FLIP=false;
function renderAnimated(){ FLIP=true; try{ render(); } finally{ FLIP=false; } }
const RM=matchMedia('(prefers-reduced-motion: reduce)'); // Reduce Motion: transitions become fades (design rule 8)
/* While a finger drags a row, a tab or a pushed screen, render() waits: rebuilding the screen would detach the dragged element.
   The gesture's end runs the pending render (dragEnd(true)) or leaves it to its own timer (dragEnd(false)). */
let touchDrag=false, renderPending=false, renderPendingFlip=false;
const EDGE=28; // px from the left edge of a pushed screen that belong to the back swipe, never to a row
const FLICK=0.4; // px/ms: a release this fast counts as a flick (R4), the same speed the tab swipe takes
function dragStart(){ touchDrag=true; }
function dragEnd(flush){ touchDrag=false; if(flush&&renderPending){ if(renderPendingFlip) renderAnimated(); else render(); } }
window.addEventListener('touchstart',e=>{ if(e.touches.length===1) touchDrag=false; },{capture:true,passive:true}); // safety net: a new single touch means no drag is still running
// Rows far below the visible part of a list skip style, layout and paint (content-visibility) until they scroll into view.
// Only rows below it: a row above that grew to its real height while scrolling up would shift the list under the finger.
// 52 px is the lowest a row can be, so a row past this index cannot be on screen when the list is drawn.
// The class goes into the markup: added afterwards row by row, it costs more than it saves.
// Lists of 200 rows or more are windowed (design rule 6): rows more than a screen below that point are left out, each behind
// an empty placeholder of a row's usual height, and drawn as the list scrolls toward them (armRows, fillRows).
// Every row drawn is a full one (no content-visibility), so whatever ends up above the visible part has its real height
// and a later render, which draws those rows again, restores the scroll exactly.
let rowStash=null; // the markup of the rows the last lazyRows left out, for the armRows that follows it
function lazyRows(html, top, height){ const rh=UI.wide?32:52, from=Math.ceil((top+height*1.5)/rh), far=Math.ceil((top+height*2.5)/rh); rowStash=null; // the desktop rows are one line of 32 px (R11)
  const re=/<div class="row(?=[ "])/g, starts=[]; let m; while((m=re.exec(html))) starts.push(m.index);
  if(starts.length<200){ let i=0; return html.replace(/<div class="row(?=[ "])/g, m=>i++<from?m:'<div class="row cv'); }
  const tag=/<\/?div[\s>]/g, out=[], stash=[]; let pos=0;
  for(let i=far;i<starts.length;i++){ const st=starts[i]; if(st<pos) continue; out.push(html.slice(pos,st));
    tag.lastIndex=st; let depth=0, end=-1, t; while((t=tag.exec(html))){ if(t[0][1]==='/'){ if(--depth===0){ end=t.index+6; break; } } else depth++; } // the row's own closing tag
    if(end<0){ pos=st; break; }
    const row=html.slice(st,end), id=(/ data-id="([^"]*)"/.exec(row)||[])[1]||'';
    out.push('<div class="rph" data-id="'+id+'" data-ph="'+stash.length+'"></div>'); stash.push(row); pos=end; }
  out.push(html.slice(pos)); rowStash=stash.length?stash:null; return out.join(''); }
// The scroll box the last lazyRows output went into keeps the rows left out, and draws them as it scrolls
function armRows(sc){ const st=rowStash; rowStash=null; if(!sc) return; sc._rows=st; if(st&&!sc._fill){ sc._fill=()=>fillRows(sc); sc.addEventListener('scroll',sc._fill,{passive:true}); } }
// Rows within a screen and a half below the visible part are drawn, in order, so the finger never reaches a placeholder
function fillRows(sc){ const st=sc._rows; if(!st||!sc.clientHeight) return; const lim=sc.getBoundingClientRect().bottom+sc.clientHeight*1.5;
  for(;;){ const phs=sc.querySelectorAll('.rph'); if(!phs.length){ sc._rows=null; return; } if(phs[0].getBoundingClientRect().top>lim) return;
    for(let k=0;k<phs.length&&k<25;k++){ const ph=phs[k]; const h=st[+ph.dataset.ph]; ph.insertAdjacentHTML('beforebegin', h); const row=ph.previousElementSibling; ph.remove(); if(row) row._h=rowKey(h); // the markup it came from (R18)
      if(row&&!UI.wide&&!UI.select) bindRowGestures(row); } } }
/* ---------- R18: repaint only what changes ----------
   A list screen (Tareas, a project, the desktop column) is not rebuilt on every render. Its new markup is split into rows and a skeleton
   (everything else, each row left as a token); the small skeleton is parsed and merged node by node into the live one (attributes,
   text, children), and each row is reused when its markup is the one it was drawn from and nothing has changed it since (rowWatch).
   Only new or changed rows are parsed. The result is the same DOM a full rebuild gives, so every view keeps its look and behaviour,
   while the elements that did not change keep their listeners, focus and layout: completing, postponing, a new priority or project
   touch one row and the counters; a search drops and adds rows around the field. The desktop pane is kept while its markup is the same */
// A row (or the desktop pane) changed by code after it was drawn (held, swiped, lifted, FLIP, selection, a title typed) is not reused
function markDirty(recs){ for(const r of recs){ let n=r.target; if(n.nodeType!==1) n=n.parentElement; const el=n&&n.closest('.row, .pane'); if(el) el._dirty=true; } }
// Only the boxes merged this way are watched (watchBox): the rest of the app, the detail being typed in among them, costs nothing
const rowWatch=new MutationObserver(markDirty), WATCH={subtree:true, attributes:true, childList:true, characterData:true};
function watchBox(el){ if(!el._watched){ el._watched=1; rowWatch.observe(el, WATCH); } }
// The markup cut into its rows (each from its opening tag to its own closing one, with its task id) and the rest, where each row is a token <b data-rk="i">
function splitRows(html){ const tag=/<(\/?)div[\s>]/g, rows=[], ids=[], parts=[]; let pos=0, depth=0, start=-1, sd=0, m;
  while((m=tag.exec(html))){
    if(m[1]){ depth--; if(start>=0&&depth===sd){ const end=m.index+6; rows.push(html.slice(start,end)); parts.push('<b data-rk="'+(rows.length-1)+'"></b>'); pos=end; start=-1; } }
    else { if(start<0&&html.startsWith('<div class="row',m.index)){ const c=html[m.index+15]; if(c===' '||c==='"'){ parts.push(html.slice(pos,m.index)); start=m.index; sd=depth;
      const te=html.indexOf('>',m.index), q=html.indexOf(' data-id="',m.index); ids.push(q>0&&q<te?html.slice(q+10, html.indexOf('"',q+10)):''); } } depth++; } }
  if(start>=0) return null; parts.push(html.slice(pos)); return {sk:parts.join(''), rows, ids, keys:rows.map(rowKey)}; }
// A row's markup without the content-visibility class lazyRows gives by position, so a row that only moved past that point is still the same row
const rowKey = h => h.startsWith('<div class="row cv ')||h.startsWith('<div class="row cv"') ? '<div class="row'+h.slice(18) : h;
const isRowEl = c => c.nodeType===1 && c.tagName==='DIV' && c.classList.contains('row');
// Old and new children are paired by tag, first class and the element's own key; the rest is matched in order
function nodeKey(c){ if(c.nodeType!==1) return '#'+c.nodeType; const cl=c.getAttribute('class')||'', i=cl.indexOf(' ');
  return c.tagName+'.'+(i<0?cl:cl.slice(0,i))+'#'+(c.getAttribute('data-id')||c.getAttribute('data-day-head')||c.getAttribute('data-pf')||c.getAttribute('data-role')||''); }
function syncAttrs(o, n){ const na=n.attributes, oa=o.attributes;
  for(let i=oa.length-1;i>=0;i--){ const a=oa[i]; if(a.namespaceURI?!n.hasAttributeNS(a.namespaceURI,a.localName):!n.hasAttribute(a.name)) o.removeAttributeNode(a); }
  for(let i=0;i<na.length;i++){ const a=na[i]; if(a.namespaceURI){ if(o.getAttributeNS(a.namespaceURI,a.localName)!==a.value) o.setAttributeNS(a.namespaceURI,a.name,a.value); } else if(o.getAttribute(a.name)!==a.value) o.setAttribute(a.name,a.value); } }
function morphNode(o, n, cx){
  if(o.nodeType!==1){ if(o.nodeValue!==n.nodeValue) o.nodeValue=n.nodeValue; return; }
  if(o===cx.keep) return; // the field being typed in is never touched
  if(!o.firstChild&&!n.firstChild){ syncAttrs(o, n); return; } // a leaf (a placeholder of a long list): its attributes only
  if(o.isEqualNode(n)) return;
  syncAttrs(o, n); morphKids(o, n, cx); }
const isTok = c => c.nodeType===1 && c.tagName==='B' && c.hasAttribute('data-rk');
function morphKids(o, n, cx){
  const want=[]; let oc=o.firstChild, c=n.firstChild;
  // In step while old and new parts line up (the usual case); from the first difference on, by key
  for(;c;c=c.nextSibling){
    if(isTok(c)){ want.push(cx.els[+c.getAttribute('data-rk')]); continue; }
    while(oc&&isRowEl(oc)) oc=oc.nextSibling;
    if(!oc||oc.nodeType!==c.nodeType||(c.nodeType===1&&nodeKey(oc)!==nodeKey(c))) break;
    morphNode(oc, c, cx); want.push(oc); oc=oc.nextSibling; }
  if(c){ const q=new Map();
    for(;oc;oc=oc.nextSibling){ if(isRowEl(oc)) continue; const k=nodeKey(oc), a=q.get(k); if(a) a.push(oc); else q.set(k,[oc]); }
    for(;c;c=c.nextSibling){
      if(isTok(c)){ want.push(cx.els[+c.getAttribute('data-rk')]); continue; }
      const a=q.get(nodeKey(c)), m=a&&a.shift();
      if(m){ morphNode(m, c, cx); want.push(m); }
      else { if(c.nodeType===1&&c.firstChild) c.querySelectorAll('b[data-rk]').forEach(t=>t.replaceWith(cx.els[+t.getAttribute('data-rk')])); want.push(c); } } } // a new part, with its rows in place
  const ws=new Set(want); let cur=o.firstChild;
  for(const w of want){ while(cur&&!ws.has(cur)){ const nx=cur.nextSibling; o.removeChild(cur); cur=nx; } if(cur===w) cur=cur.nextSibling; else o.insertBefore(w, cur); }
  while(cur){ const nx=cur.nextSibling; o.removeChild(cur); cur=nx; } }
// A box drawn for the first time (or emptied) is filled at once, and its rows remember the markup they came from
function fillFresh(box, html, outer, sp){ const t=document.createElement('template'); t.innerHTML=html; let src=t.content;
  if(outer){ src=t.content.firstElementChild; if(!src||src.tagName!==box.tagName) return false; syncAttrs(box, src); }
  const rs=src.querySelectorAll('div.row'); if(rs.length===sp.rows.length) rs.forEach((r,i)=>{ r._h=sp.keys[i]; }); // otherwise they are not reused, which is only slower
  box.append(...src.childNodes); return true; }
/* Puts html into box (outer: html is box itself, one element) and returns true; false when the markup cannot be split, and nothing changed.
   keep: a field left exactly as it is. blur: a focused field that stays loses the focus, as a rebuilt one would (the iPhone keyboard closes) */
function morphInto(box, html, opts={}){ const sp=splitRows(html); if(!sp) return false;
  markDirty(rowWatch.takeRecords()); watchBox(box);
  if(!box.firstChild){ const ok=fillFresh(box, html, opts.outer, sp); rowWatch.takeRecords(); return ok; }
  const pool=new Map(); box.querySelectorAll('div.row').forEach(r=>{ if(r._h===undefined||r._dirty||r._flip) return; const id=r.getAttribute('data-id')||'', a=pool.get(id); if(a) a.push(r); else pool.set(id,[r]); });
  const els=new Array(sp.rows.length), need=[];
  sp.keys.forEach((h,i)=>{ const a=pool.get(sp.ids[i]); let k=-1; if(a) for(let j=0;j<a.length;j++) if(a[j]._h===h){ k=j; break; }
    if(k>=0){ const el=els[i]=a[k]; a.splice(k,1); const raw=sp.rows[i]; if(raw!==h){ const cls=raw.slice(12, raw.indexOf('"',12)); if(el.getAttribute('class')!==cls) el.setAttribute('class', cls); } else if(el.classList.contains('cv')) el.setAttribute('class', raw.slice(12, raw.indexOf('"',12))); }
    else need.push(i); });
  if(need.length){ const t=document.createElement('template'); t.innerHTML=need.map(i=>sp.rows[i]).join(''); const kids=[...t.content.children]; if(kids.length!==need.length) return false;
    need.forEach((i,k)=>{ const el=kids[k]; el._h=sp.keys[i]; els[i]=el; }); }
  const t=document.createElement('template'); t.innerHTML=sp.sk; const ae=document.activeElement;
  const cx={els, keep:opts.keep||null};
  if(opts.outer){ const r=t.content.firstElementChild; if(!r||r.tagName!==box.tagName) return false; morphNode(box, r, cx); }
  else morphKids(box, t.content, cx);
  // A field that stays shows what a new one would: the value it is drawn with
  box.querySelectorAll('input').forEach(i=>{ if(i===cx.keep) return; if(i.type==='checkbox'||i.type==='radio') i.checked=i.hasAttribute('checked'); else { const v=i.getAttribute('value')||''; if(i.value!==v) i.value=v; } });
  rowWatch.takeRecords(); // its own changes mark nothing
  if(opts.blur&&ae&&ae!==cx.keep&&/^(INPUT|TEXTAREA)$/.test(ae.tagName)&&box.contains(ae)) ae.blur();
  return true; }
function swapHTML(scr, html, morph){
  // A screen drawn while hidden (a tab coming back) reads nothing from its old list, which would lay it out for nothing:
  // its scroll comes from UI.scroll once it is shown (restoreRootScroll)
  const hidden=scr.classList.contains('hidden-tab');
  const sc=hidden?null:scr.querySelector('.scroll'); const st=sc?sc.scrollTop:0;
  const pc=hidden?null:scr.querySelector('.pchips'); const pl=pc?pc.scrollLeft:0; // the project chips keep their horizontal position too
  const key=el=>el.dataset.id||el.dataset.openProject;
  let prev=null;
  if(FLIP&&sc){ prev=new Map(); sc.querySelectorAll('[data-id]:not(.rph),[data-open-project]').forEach(el=>{ if(!el.closest('.first')) prev.set(key(el), el.getBoundingClientRect().top); }); }
  const lz=lazyRows(html, hidden?(UI.scroll[scr.dataset.root]||0):st, innerHeight), stash=rowStash; // R18: a list screen is merged, not rebuilt
  if(!(morph&&morphInto(scr, lz, {blur:true}))) scr.innerHTML=lz; rowStash=stash; delete scr.dataset.dirty; scr.dataset.ver=dataVer;
  const sc2=scr.querySelector('.scroll'); armRows(sc2);
  if(sc2){ if(!hidden) sc2.scrollTop=st; bindScroll(scr); }
  { const pc2=!hidden&&scr.querySelector('.pchips'); if(pc2){ if(pc) pc2.scrollLeft=pl; else chipInView(pc2); } } // a row drawn anew (after a search) shows the chip in use
  if(prev&&sc2){
    // All new positions are read first and only then written: one layout for the whole list, not one per row.
    // Only rows that are or were near the visible part move; rows far off screen take their place at once.
    // With Reduce Motion nothing slides: new rows only fade in.
    const els=[...sc2.querySelectorAll('[data-id]:not(.rph),[data-open-project]')].filter(el=>!el.closest('.first'));
    const tops=els.map(el=>el.getBoundingClientRect().top);
    const r=sc2.getBoundingClientRect(), m=r.height/2, near=y=>y>=r.top-m&&y<=r.bottom+m;
    // R18: the slide leaves each row exactly as drawn (its style attribute put back as it was), so a later merge can keep it;
    // a row still sliding (_flip) is drawn anew by a render that comes meanwhile, as before
    const moved=[], own=fn=>{ markDirty(rowWatch.takeRecords()); fn(); rowWatch.takeRecords(); };
    own(()=>els.forEach((el,i)=>{ const k=key(el), nt=tops[i];
      if(!prev.has(k)){ if(near(nt)){ el.classList.add('enter'); el._flip=true; moved.push(el); } return; }
      const d=prev.get(k)-nt; if(Math.abs(d)>0.5&&!RM.matches&&(near(nt)||near(prev.get(k)))){ el._st=el.getAttribute('style'); el._flip=true; el.style.transform='translate3d(0,'+d+'px,0)'; moved.push(el); } }));
    if(moved.length){ requestAnimationFrame(()=>requestAnimationFrame(()=>{ own(()=>moved.forEach(el=>{ el.classList.add('flip');
        if(el._st!==undefined){ if(el._st===null) el.removeAttribute('style'); else el.setAttribute('style', el._st); delete el._st; } el.classList.remove('enter'); }));
      setTimeout(()=>own(()=>moved.forEach(el=>{ el.classList.remove('flip'); el._flip=false; })),450); })); }
  }
  bindCommon(scr);
}
// Scrolls the project chips just enough to show the active one, without touching the vertical scroll
function chipInView(pc){ const on=pc.querySelector('.chip.on'); if(!on) return; const a=pc.getBoundingClientRect(), b=on.getBoundingClientRect(), pad=16;
  if(b.left<a.left+pad) pc.scrollLeft-=a.left+pad-b.left; else if(b.right>a.right-pad) pc.scrollLeft+=b.right-(a.right-pad); }
function render(){ drawing(renderNow); }
function renderNow(){
  // List state that no longer applies is dropped before drawing, on the iPhone and the desktop alike:
  // a project filter whose project was archived, removed or belongs to another space would hide tasks with no chip to clear it,
  // and an emptied search asks again before showing completed tasks
  if(UI.projFilter && UI.projFilter!=='none' && !activeProjects().some(p=>p.id===UI.projFilter)) UI.projFilter=null;
  if(!UI.query) UI.searchDone=false;
  if(UI.wide){ renderDesktop(); return; }
  if(touchDrag){ renderPending=true; renderPendingFlip=renderPendingFlip||FLIP; return; }
  renderPending=false; renderPendingFlip=false;
  UI.stack=UI.stack.filter(s=>s.kind!=='detail'||task(s.id)||(s.el.remove(),false)); // a detail whose task is gone would be a blank screen with no Atrás
  const fresh=!app.querySelector('.screen.root[data-root="'+UI.tab+'"]'); const scr = rootScreen(UI.tab);
  app.querySelectorAll('.screen.root').forEach(s=>{ s.classList.remove('dragging'); if(s!==scr){ hideRoot(s); s.style.transform=''; } });
  // Only what can be seen is drawn. A root covered by a pushed screen is marked and drawn before it shows again
  // (refreshCovered, pop, back swipe); a tab coming back is drawn while still hidden, so its old list is never laid out.
  if(UI.stack.length){ if(!fresh) scr.dataset.dirty='1'; } else renderRoot(scr);
  if(scr.classList.contains('hidden-tab')){ scr.classList.remove('hidden-tab'); restoreRootScroll(scr); }
  scr.style.transform='';
  renderTabbar();
  if(UI.stack.length){ scr.classList.add('under'); } else { scr.classList.remove('under','dragging-under'); }
  // Pushed screens: the top one is drawn, the ones below it are marked
  app.querySelectorAll('.screen.pushed-screen').forEach(s=>{ if(!UI.stack.find(x=>x.el===s)) s.remove(); });
  UI.stack.forEach((s,i)=>{ const top=i===UI.stack.length-1; if(top) renderPushed(s); else s.el.dataset.dirty='1';
    if(top) s.el.classList.remove('under'); else s.el.classList.add('under'); });
  if(UI.stack.length) scheduleRefresh();
}
function renderPushed(s){ drawing(()=>renderPushedNow(s)); }
function renderPushedNow(s){ const osc=s.el.querySelector('.scroll'), ost=osc?osc.scrollTop:0; swapHTML(s.el, s.kind==='detail'?viewDetail(s.id):viewProject(s.id), s.kind==='project');
  if(s.kind==='detail'){ bindDetail(s.el, s.id); const sc=s.el.querySelector('.scroll'); if(sc) sc.scrollTop=ost; attHydrate(s.el); } } // restored once the text areas have their full height, or a long note would clamp it to the top
// A root put away keeps its scroll in UI.scroll; it is drawn anew when it comes back and gets it back there
function hideRoot(s){ if(s.classList.contains('hidden-tab')) return; const sc=s.querySelector('.scroll'), pc=s.querySelector('.pchips');
  if(sc) UI.scroll[s.dataset.root]=sc.scrollTop; UI.scroll[s.dataset.root+'.chips']=pc?pc.scrollLeft:null; s.classList.add('hidden-tab'); }
function restoreRootScroll(scr){ const sc=scr.querySelector('.scroll'), nav=scr.querySelector('.nav'), pc=scr.querySelector('.pchips');
  if(sc){ sc.scrollTop=UI.scroll[scr.dataset.root]||0; if(nav) nav.classList.toggle('compact', sc.scrollTop>36); }
  if(pc){ const l=UI.scroll[scr.dataset.root+'.chips']; if(l!=null) pc.scrollLeft=l; else chipInView(pc); } }
// Screens marked while covered are drawn a moment later, off the tap that changed the data, so going back finds them current
let refreshT=null;
function scheduleRefresh(){ clearTimeout(refreshT); refreshT=setTimeout(refreshCovered, 400); }
function refreshCovered(){ refreshT=null; if(UI.wide||!UI.stack.length) return; if(touchDrag){ scheduleRefresh(); return; }
  drawIfDirty(app.querySelector('.screen.root:not(.hidden-tab)')); UI.stack.slice(0,-1).forEach(s=>drawIfDirty(s.el)); }
// A screen about to show again is drawn now if a render was asked while it was covered
function drawIfDirty(el){ if(!el||!el.dataset.dirty) return;
  if(el.classList.contains('root')) renderRoot(el); else { const s=UI.stack.find(x=>x.el===el); if(s) renderPushed(s); } }
function renderTabbar(){
  const b=(id,ic,icF,l)=>'<button data-tab="'+id+'" class="'+(UI.tab===id?'on':'')+'">'+(UI.tab===id?icF:ic)+'<span>'+l+'</span></button>';
  tabbarEl.innerHTML = b('tareas',I.list,I.listF,'Tareas')+b('proyectos',I.folder,I.folderF,'Proyectos')+b('ajustes',I.gear,I.gearF,'Ajustes');
}
function resetListState(){ UI.query=''; UI.searchDone=false; UI.sumFilter=null; UI.projFilter=null; } // a space change starts its list with no search or filter
function switchTab(tab){ if(UI.select){ UI.select=null; app.classList.remove('selecting'); }
  if(UI.tab===tab){ const r=rootScreen(tab); if(!UI.stack.length&&r.classList.contains('hidden-tab')){ render(); return; } const sc=r.querySelector('.scroll'); sc&&sc.scrollTo({top:0,behavior:'smooth'}); return; } UI.tab=tab; UI.query=''; UI.sumFilter=null; render(); } // a current tab that does not show is drawn, never only scrolled
tabbarEl.addEventListener('click', e=>{ const b=e.target.closest('[data-tab]'); if(b) switchTab(b.dataset.tab); });
$('#selbar').addEventListener('click', e=>{ const b=e.target.closest('[data-act]'); if(!b||b.disabled||!UI.select) return; ({bulkComplete, bulkPostpone:bulkPostponeSheet, bulkMove:bulkMoveSheet, bulkDelete})[b.dataset.act](); });

/* ---------- Swipe between tabs: the screen follows the finger, iOS style.
   Task rows keep their own horizontal gestures, so a swipe that starts on one is theirs. ---------- */
(function bindTabSwipe(){
  let x0=0,y0=0,mode=null,cur=null,nb=null,dir=0,w=0,lastX=0,lastT=0,vx=0;
  const neighbor=d=>{ const i=TABS.indexOf(UI.tab)+d; return i>=0&&i<TABS.length?TABS[i]:null; };
  // The end of the last slide (its 420 ms timer). A touch that lands before it runs it at once, before any handler reads the screens:
  // a gesture never starts on half-finished screens, and a stale timer never puts away a screen a newer swipe is dragging
  let settleFn=null, settleT=0;
  function settle(e){ const f=settleFn; if(!f) return; settleFn=null; clearTimeout(settleT); f(e); }
  app.addEventListener('touchstart',e=>settle(e),{capture:true,passive:true});
  // From touchstart to release no render() replaces the touched screen (dragStart), so a timer cannot kill the gesture halfway
  app.addEventListener('touchstart',e=>{ const was=mode; mode=null; if(was==='swipe') finish(false); // a second finger cancels the swipe
    if(UI.stack.length||e.touches.length>1||UI.select) return; const t=e.touches[0]; let root=e.target.closest('.screen.root');
    const gone=!!root&&root.classList.contains('hidden-tab'); if(gone) root=rootScreen(UI.tab); // the slide just settled put away the screen under the finger: what shows there now is the current tab
    if(!root||root.dataset.root!==UI.tab||root.classList.contains('hidden-tab')) return;
    if(!gone){ const row=e.target.closest('.row'); if(row&&row.querySelector('.row-bg')) return;
      if(e.target.closest('.pchips')) return; if(e.target.closest('.vn[data-bk]')) return; } // the project chips scroll sideways on their own; a local copy of Ajustes slides to Eliminar (decision 34)
    x0=lastX=t.clientX; y0=t.clientY; lastT=e.timeStamp; mode='pending'; cur=root; nb=null; w=innerWidth; vx=0; dragStart(); },{passive:true});
  app.addEventListener('touchmove',e=>{ if(!mode||mode==='off') return; const t=e.touches[0]; const dx=t.clientX-x0, dy=t.clientY-y0;
    if(mode==='pending'){ if(Math.abs(dy)>8&&Math.abs(dy)>Math.abs(dx)){ mode='off'; return; } if(Math.abs(dx)<10) return; dir=dx<0?1:-1; const nt=neighbor(dir); if(!nt){ mode='off'; return; }
      nb=rootScreen(nt); nb.style.transform='translate3d('+(dir*w)+'px,0,0)'; if(nb.classList.contains('hidden-tab')){ nb.classList.remove('hidden-tab'); restoreRootScroll(nb); } cur.classList.remove('tabanim'); nb.classList.remove('tabanim'); cur.classList.add('dragging'); nb.classList.add('dragging'); mode='swipe'; if(openRow) closeRow(openRow); }
    if(mode!=='swipe') return; if(e.cancelable) e.preventDefault();
    const now=e.timeStamp; if(now>lastT){ vx=(t.clientX-lastX)/(now-lastT); lastX=t.clientX; lastT=now; }
    const d = dir===1?Math.min(0,dx):Math.max(0,dx);
    cur.style.transform='translate3d('+d+'px,0,0)'; nb.style.transform='translate3d('+(d+dir*w)+'px,0,0)';
  },{passive:false});
  function finish(commit){ mode=null; settle(null);
    const c=cur, n=nb, dd=dir, ww=w, target=commit?n.dataset.root:c.dataset.root; c.classList.remove('dragging'); n.classList.remove('dragging'); c.classList.add('tabanim'); n.classList.add('tabanim');
    if(commit){ haptic(6); UI.tab=target; UI.query=''; UI.sumFilter=null; renderTabbar(); renderRoot(n); } // the new tab is current, and drawn, from the release, so a tap or a push in the next 420 ms acts on it; the same reset as a tap on the tab bar
    let placed=false; const place=()=>{ placed=true; if(commit){ c.style.transform='translate3d('+(-dd*ww)+'px,0,0)'; n.style.transform='translate3d(0,0,0)'; } else { c.style.transform='translate3d(0,0,0)'; n.style.transform='translate3d('+(dd*ww)+'px,0,0)'; } };
    const done=e=>{ c.classList.remove('tabanim'); n.classList.remove('tabanim'); if(!placed) place(); // a touch in the first frame: the screens go straight to their place
      if(!((UI.tab===target&&!UI.stack.length)||renderPending)) return; // a tab tap or a push in between has rendered already
      const on=rootScreen(UI.tab), held=!!e&&!!e.target.closest&&!!e.target.closest('.screen'); // held: a finger has just landed on a screen, which no render may rebuild under it
      if(UI.tab===target&&!UI.stack.length&&(e||typingIn(on)||!renderPending)){ // nothing changed during the slide (a cancelled swipe, or the new tab drawn at the release), the search was tapped meanwhile, or a touch lands: only the other tab is put away
        app.querySelectorAll('.screen.root').forEach(r=>{ if(r.classList.contains('dragging')) return; if(r!==on) hideRoot(r); r.style.transform=''; });
        if(on.classList.contains('hidden-tab')){ on.classList.remove('hidden-tab'); restoreRootScroll(on); } // the current tab always shows
        if(!tabbarEl.querySelector('.on[data-tab="'+UI.tab+'"]')) renderTabbar(); // only when stale: a finger may be on it
        if(!e||!renderPending||typingIn(on)) return; } // data that changed during the slide is drawn now, or when the finger on the screen lifts
      if(held){ dragStart(); return; } // renderPending is set: the touch's end draws it
      render(); };
    settleFn=done; requestAnimationFrame(()=>{ if(settleFn===done&&!placed) place(); }); settleT=setTimeout(()=>settle(null),420);
  }
  const end=e=>{ const was=mode; mode=null;
    if(was==='swipe'){ const ct=e.type==='touchend'&&e.changedTouches[0]; const dx=ct?ct.clientX-x0:0; const d=dir===1?Math.min(0,dx):Math.max(0,dx);
      finish(!!ct && (Math.abs(d)>w/3 || (Math.abs(vx)>FLICK && Math.sign(vx)===-dir && Math.abs(d)>20))); // a cancelled touch never switches tab
      if(!e.touches.length) dragEnd(false); } // the 420 ms timer renders
    if(!e.touches.length&&touchDrag) dragEnd(true); // the last finger is up: nothing may keep render() waiting
  };
  app.addEventListener('touchend',end); app.addEventListener('touchcancel',end);
})();
// A text field focused in this screen: a render from a timer must not rebuild it, or iOS closes the keyboard and the typing is lost
function typingIn(scr){ const ae=document.activeElement; return !!scr && !!ae && /^(INPUT|TEXTAREA)$/.test(ae.tagName) && scr.contains(ae); }
// A list kept by a merge (R18) keeps its listener, which reads the header it has now
function bindScroll(scr){ const sc=scr.querySelector('.scroll'), nav=scr.querySelector('.nav'); if(!sc||!nav) return; sc._nav=nav;
  if(!sc._bs){ sc._bs=1; sc.addEventListener('scroll',()=>{ const n=sc._nav; if(n) n.classList.toggle('compact', sc.scrollTop>36); },{passive:true}); } nav.classList.toggle('compact', sc.scrollTop>36); }

/* ---------- Tasks view ---------- */
/* R3: a project capsule keeps the stored colour but its text is made readable, above 4.4:1 on its own background:
   in the light theme the colour is mixed with black, in the dark theme the system's dark variant is used (lightened if still short) */
const COLOR_NAMES=['Rojo','Naranja','Amarillo','Verde','Azul','Morado','Rosa','Marrón','Menta','Cian','Índigo','Gris','Granate','Oliva','Azul marino','Coral'];
const TAG_DARK={'#FF3B30':'#FF453A','#FF9500':'#FF9F0A','#FFCC00':'#FFD60A','#34C759':'#30D158','#007AFF':'#0A84FF','#5856D6':'#5E5CE6','#AF52DE':'#BF5AF2','#A2845E':'#AC8E68',
  '#FF2D55':'#FF375F','#00C7BE':'#63E6E2','#32ADE6':'#64D2FF','#8E8E93':'#98989D','#9B2242':'#E0627D','#7D8A2E':'#B5C454','#1F3A8A':'#7398F0','#FF7A5C':'#FF927A'}; // decision 33: the dark variants of the 16
const tagCache=new Map();
function tagVars(c){ let v=tagCache.get(c); if(v) return v;
  const rgb=h=>/^#[0-9a-f]{6}$/i.test(h)?[0,2,4].map(i=>parseInt(h.slice(1+i,3+i),16)):null;
  const lin=u=>{ u/=255; return u<=.03928?u/12.92:Math.pow((u+.055)/1.055,2.4); }, lum=a=>.2126*lin(a[0])+.7152*lin(a[1])+.0722*lin(a[2]);
  const ratio=(a,b)=>{ const x=lum(a), y=lum(b); return (Math.max(x,y)+.05)/(Math.min(x,y)+.05); }, mix=(a,b,k)=>a.map((u,i)=>Math.round(u*(1-k)+b[i]*k));
  const css=a=>'rgb('+a.join(',')+')', fit=(ink,bg,to)=>{ let k=0, t=ink; while(ratio(t,bg)<4.6&&k<1){ k+=.02; t=mix(ink,to,k); } return t; };
  const l=rgb(c); if(!l){ v='--pc:'+c+';--tagbg:'+tint(c,.15); tagCache.set(c,v); return v; } // a colour this code cannot read keeps the old look
  const d=rgb(TAG_DARK[String(c).toUpperCase()]||c), bgl=mix([255,255,255],l,.15), bgd=mix([28,28,30],d,.24); // over the card of each theme
  v='--pc:'+c+';--tagbg:'+css(bgl)+';--tagl:'+css(fit(l,bgl,[0,0,0]))+';--tagbgd:'+css(bgd)+';--tagd:'+css(fit(d,bgd,[255,255,255]));
  tagCache.set(c,v); return v; }
/* A row. R3: it leaves out what the screen around it already says. opts:
   noProj (inside a project, grouped by project or with a project filter: no capsule), noToday (a Hoy list or group: no "Hoy"),
   hideCarried (the Aplazadas group: no "Aplazada"), byDay (Completadas grouped by day: the time alone, not struck through),
   day (R14: a day group of Todas; a row dated that day says no date),
   simple ("Lo primero": no swipe). A carried task says "Aplazada" in orange where it would say "Hoy". */
function rowHTML(x, opts={}){
  const p = x.projectId?proj(x.projectId):null; const t=todayStr();
  const done=x.status==='done';
  const held=HELD.has(x.id), shownDone=held?HELD.get(x.id):done; // R1: a marked row shows the state it is about to take
  const meta=[]; if(p&&!opts.noProj) meta.push('<span class="tag">'+esc(p.name)+'</span>');
  if(done){ if(x.completed) meta.push('<span>'+(opts.byDay?fmtTime(x.completed):'Hecha '+fmtDateTime(x.completed))+'</span>'); }
  else { if(x.date){ if(x.carried&&x.date<=t){ if(!opts.hideCarried) meta.push('<span class="carried">Aplazada</span>'); }
      else if(!(opts.noToday&&x.date===t) && x.date!==opts.day) meta.push('<span class="'+(x.date<t?'over':'')+'">'+fmtDate(x.date)+'</span>'); }
    if(x.reminder) meta.push('<span class="bell">'+I.bell+(x.date&&localDay(x.reminder)===x.date?fmtTime(x.reminder):fmtDateTime(x.reminder))+'</span>'); } // the reminder's own day when it is not the task's date (moved task, no date)
  const ind=(x.notes&&x.notes.trim()?I.note:'')+(DB.voiceNotes.some(v=>v.taskId===x.id)?I.mic:'')+(hasAtt(x.id)?I.clip:''); // decision 29: a paperclip when it has photos or audio
  const pri = done?'':x.priority==='high'?'<span class="pri high">!!!</span>':x.priority==='mid'?'<span class="pri mid">!!</span>':'';
  const pc=p?p.color:null;
  const selecting = UI.select && !opts.simple; const selected = selecting && UI.select.ids.has(x.id);
  if(UI.wide) return deskRowHTML(x, opts, {p, t, done, held, shownDone, ind, pri, pc, selecting, selected});
  return '<div class="row'+(done?' done':'')+(held?' held':'')+(opts.byDay?' byday':'')+(selected?' selected':'')+'" data-id="'+x.id+'"'+(pc?' style="'+tagVars(pc)+'"':'')+'>'+
    (opts.simple||selecting?'':'<div class="row-bg left"><span>'+I.check+'</span></div><div class="row-bg right"><button class="b-tomorrow" data-act="postpone">Aplazar</button><button class="b-delete" data-act="delete">Eliminar</button></div>')+
    '<div class="row-content">'+(selecting?'<span class="selbox">'+I.check+'</span>':'<button class="check'+(shownDone?' done':'')+'" data-act="check" aria-label="Completar">'+I.check+'</button>')+
    '<div class="row-text"><div class="row-title">'+esc(x.title||'Sin título')+'</div>'+(meta.length?'<div class="row-meta">'+meta.join('')+'</div>':'')+'</div>'+(ind?'<span class="inds">'+ind+'</span>':'')+pri+(UI.wide&&!selecting&&!opts.simple?'<button class="rowmore" data-act="rowMenu" aria-label="Más">'+I.more+'</button>':'')+'</div></div>';
}
/* R11: a desktop row is one line of 32 px: circle, title and project capsule, then right-aligned columns for the notes and voice
   indicators, the date (or "Aplazada", or when it was done), the reminder and the priority. The R3 rules decide what each column says */
function deskRowHTML(x, opts, v){ const t=v.t; let date='', dcls='', rem='';
  if(v.done){ if(x.completed) date=opts.byDay?fmtTime(x.completed):fmtDateTime(x.completed); }
  else { if(x.date){ if(x.carried&&x.date<=t){ if(!opts.hideCarried){ date='Aplazada'; dcls=' carried'; } }
      else if(!(opts.noToday&&x.date===t) && x.date!==opts.day){ date=fmtDate(x.date); if(x.date<t) dcls=' over'; } }
    if(x.reminder) rem=x.date&&localDay(x.reminder)===x.date?fmtTime(x.reminder):fmtDateTime(x.reminder); }
  // The project goes in a fixed column on the left, so titles start aligned and keep the room on the right; a list of one project has no column
  const pcol=opts.noProj?'':'<span class="pcol">'+(v.p?'<span class="tag" title="'+esc(v.p.name)+'">'+esc(v.p.name)+'</span>':'')+'</span>';
  // R15, R16: the selected row (cur), the multiple selection, the selection mode's boxes and the title edited in place; "Lo primero" repeats rows and shows none of the selection
  const ds=UI.dsel, own=!opts.simple, multi=deskMulti(), sel=own&&multi&&ds.ids.has(x.id), cur=own&&!multi&&ds.cur===x.id, edit=own&&ds.edit&&ds.edit.id===x.id;
  v.selecting=own&&ds.mode;
  return '<div class="row'+(v.done?' done':'')+(v.held?' held':'')+(opts.byDay?' byday':'')+(sel?' selected':'')+(cur?' cur':'')+'" data-id="'+x.id+'"'+(v.pc?' style="'+tagVars(v.pc)+'"':'')+' role="option" aria-selected="'+(sel||cur)+'" tabindex="'+(own&&ds.cur===x.id?0:-1)+'"'+(edit?'':' draggable="true"')+'>'+
    '<div class="row-content">'+(v.selecting?'<span class="selbox">'+I.check+'</span>':'<button class="check'+(v.shownDone?' done':'')+'" data-act="check" aria-label="Completar" tabindex="-1">'+I.check+'</button>')+pcol+
    '<div class="row-text">'+(edit?'<input class="rowedit" data-role="rowedit" type="text" value="'+esc(ds.edit.text)+'" aria-label="Título" autocomplete="off" spellcheck="false">':'<div class="row-title" title="'+esc(x.title||'')+'">'+esc(x.title||'Sin título')+'</div>')+'</div>'+
    '<span class="inds">'+v.ind+'</span><span class="row-meta"><span class="rc rc-date'+dcls+'"'+(date?' title="'+esc(date)+'"':'')+'>'+date+'</span><span class="rc rc-rem"'+(rem?' title="Recordatorio: '+esc(rem)+'"':'')+'>'+(rem?I.bell+rem:'')+'</span></span>'+
    '<span class="pri'+(v.pri?(x.priority==='high'?' high':' mid'):'')+'">'+(v.pri?(x.priority==='high'?'!!!':'!!'):'')+'</span>'+
    (v.selecting?'':opts.simple?'<span class="rowmore" aria-hidden="true"></span>':'<button class="rowmore" data-act="rowMenu" aria-label="Más" title="Más" tabindex="-1">'+I.more+'</button>')+'</div></div>'; } // "Lo primero" keeps the columns aligned with the list
// The reminder line of the summary: the next one within two hours, kept until five minutes after its time
function soonReminder(){ return spaceTasks().filter(x=>x.status==='pending'&&x.reminder).map(x=>({x,d:new Date(x.reminder).getTime()-Date.now()})).filter(o=>o.d>-5*6e4&&o.d<2*36e5).sort((a,b)=>a.d-b.d)[0]; }
// What the summary shows that changes with the clock alone (that reminder line and the 19:00 button): the minute timer redraws when it differs
function clockKey(){ const o=soonReminder(); return (o?o.x.id+o.x.reminder:'')+'|'+(new Date().getHours()>=19); }
function summaryCollapsed(n){ const st=DB.settings.summaryState||'auto'; if(st==='auto' && UI.summaryFirst) return false; return st==='closed' || (st==='auto' && n>20); }
function summaryHTML(){
  const t=todayStr(); const hoy=pendingFor('hoy');
  const carried=hoy.filter(x=>x.carried).length, deHoy=hoy.length, prio=hoy.filter(x=>x.priority==='high').length; const doneToday=spaceTasks().filter(x=>x.status==='done'&&x.completed&&localDay(x.completed)===t).length;
  // Only today's high-priority tasks; the list below already shows the rest.
  const first = hoy.filter(x=>x.priority==='high').slice(0,3);
  const soon = soonReminder(); const folded=summaryCollapsed(hoy.length), late=hoy.length&&new Date().getHours()>=19;
  if(UI.wide){ // R11: one line. The three figures filter the list (para hoy clears it); the next reminder or the day done fill the middle;
    // "Cerrar el día" from 19:00; the fold opens "Lo primero" under the line (the summary's own fold and setting)
    const num=(k,n,l,c)=>'<button class="num'+(c&&n?' '+c:'')+((k==='all'?!UI.sumFilter:UI.sumFilter===k)?' on':'')+'" data-sum="'+k+'"><b>'+n+'</b><span>'+l+'</span></button>';
    const mid = soon ? '<span class="soonl" title="Recordatorio a las '+fmtTime(soon.x.reminder)+'">'+I.bell+'<span>'+fmtTime(soon.x.reminder)+' '+esc(soon.x.title)+'</span></span>'
      : !hoy.length&&doneToday ? '<span class="soonl ok">'+I.check+'<span>Todo hecho por hoy: '+doneToday+(doneToday===1?' tarea completada':' tareas completadas')+'</span></span>' : '<span class="soonl"></span>';
    // With a short Hoy every task is already on screen right below: "Lo primero" would only repeat them, so it shows from 9 tasks on, in its own block
    const firstD = hoy.length>8 ? first : [];
    return '<section class="summary dsum'+(folded?' collapsed':'')+'"><div class="summary-head">'+num('all',deHoy,'para hoy')+num('carried',carried,carried===1?'aplazada':'aplazadas','orange')+num('high',prio,prio===1?'prioritaria':'prioritarias','red')+mid+
      (late&&!UI.select?'<button class="sumclose" data-act="closeDay">Cerrar el día</button>':'')+
      (firstD.length?'<button class="sumfold" data-act="toggleSummary" aria-expanded="'+!folded+'" title="'+(folded?'Mostrar':'Plegar')+' lo primero">Lo primero'+I.chevD+'</button>':'')+'</div>'+
      (firstD.length?'<div class="summary-body"><div class="first"><div class="firsthead">Lo primero</div>'+firstD.map(x=>rowHTML(x,{simple:true,noToday:true})).join('')+'</div></div>':'')+'</section>'; }
  // R8: from 19:00 "Cerrar el día" shows in the folded summary too, so a loaded day never hides it
  return '<section class="summary'+(folded?' collapsed':'')+'"><div class="summary-head"><h3>Resumen del día</h3>'+(folded&&late&&!UI.select?'<button class="sumclose" data-act="closeDay">Cerrar el día</button>':'')+'<button data-act="toggleSummary" aria-label="Plegar">'+I.chevD+'</button></div>'+
   '<div class="summary-body"><div class="nums"><button class="num" data-sum="all"><b>'+deHoy+'</b><span>para hoy</span></button><button class="num'+(carried?' orange':'')+(UI.sumFilter==='carried'?' on':'')+'" data-sum="carried"><b>'+carried+'</b><span>aplazadas</span></button><button class="num'+(prio?' red':'')+(UI.sumFilter==='high'?' on':'')+'" data-sum="high"><b>'+prio+'</b><span>prioritarias</span></button></div>'+
   (late?'<button class="closeday" data-act="closeDay">'+I.cal+'<span>Cerrar el día, '+hoy.length+(hoy.length===1?' pendiente':' pendientes')+'</span></button>':'')+
   (!hoy.length&&doneToday?'<div class="alldone">'+I.check+'<span>Todo hecho por hoy: '+doneToday+(doneToday===1?' tarea completada':' tareas completadas')+'</span></div>':'')+
   ((first.length||soon)?'<div class="first">'+(first.length?'<h4>Lo primero</h4>'+first.map(x=>rowHTML(x,{simple:true,noToday:true})).join(''):'')+
   (soon?'<div class="soon"'+(first.length?'':' style="border-top:0;padding-top:0"')+'>'+I.bell+'<span>Recordatorio a las '+fmtTime(soon.x.reminder)+': '+esc(soon.x.title)+'</span></div>':'')+'</div>':'')+'</div></section>';
}
/* Group headers. R14: in Todas, a project, Hoy by project and Completadas each header sits in a .gsec with its group,
   so it stays at the top of the list (sticky, translucent) while its own rows scroll under it and the next one pushes it away */
function gtitle(label, n, right, attrs){ return '<div class="group-title gh"'+(attrs||'')+'><span class="gl">'+label+(n!=null?'<span class="gn">'+n+'</span>':'')+'</span>'+(right||'')+'</div>'; }
const gsec = (head, rows, attrs) => '<div class="gsec"'+(attrs||'')+'>'+head+'<div class="group">'+rows+'</div></div>';
// Decision 36: on the desktop a group of days or of projects takes rows dropped on it (its date, or its project); months and Completadas do not
const gdrop = (k, v) => UI.wide ? ' data-g'+k+'="'+esc(v)+'"' : '';
// R14: a day of Todas, "Martes 3 nov"; a month, "Diciembre" (and the year when it is not this one)
function dayTitle(d){ const t=todayStr(); if(d===t) return 'Hoy'; if(d===addDays(t,1)) return 'Mañana'; const x=new Date(d+'T00:00:00'); return DIAS_FULL[x.getDay()]+' '+x.getDate()+' '+MESES[x.getMonth()]; }
function monthTitle(ym){ const [y,m]=ym.split('-').map(Number), n=MESES_FULL[m-1]; return n[0].toUpperCase()+n.slice(1)+(y!==new Date().getFullYear()?' '+y:''); }
/* R14: Todas by date. Today first (with the carried tasks), then one group per day for the next 14 days that have tasks,
   then one per month, then Sin fecha. A day header adds with its date (+) and, on a long press or a right click, moves its tasks.
   Keys sort as text: a day 'YYYY-MM-DD', a month 'YYYY-MM-~' (after its days), no date '~' (last) */
function dayGroupsHTML(list, R, root, projectId){ const t=todayStr(), lim=addDays(t,14), by=new Map(); let h='';
  list.forEach(x=>{ const k=!x.date?'~':x.date<=t?t:x.date<=lim?x.date:x.date.slice(0,7)+'-~'; if(!by.has(k)) by.set(k,[]); by.get(k).push(x); });
  [...by.keys()].sort().forEach(k=>{ const xs=by.get(k); let head;
    if(k==='~') head=root&&!UI.select ? gtitle('Sin fecha', null, '<button class="gx" data-act="plan">Planificar ('+xs.length+')</button>') : gtitle('Sin fecha', xs.length);
    else if(k.length===10) head=gtitle(dayTitle(k), xs.length, UI.select?'':'<button class="gadd" data-add-date="'+k+'"'+(projectId!==undefined?' data-project="'+(projectId||'')+'"':'')+' aria-label="Añadir con esta fecha">'+I.plus+'</button>', ' data-day-head="'+k+'"');
    else head=gtitle(monthTitle(k.slice(0,7)), xs.length);
    h+=gsec(head, xs.map(x=>R(x, k.length===10?{day:k, noToday:true}:{})).join(''), k==='~'?gdrop('day',''):k.length===10?gdrop('day',k):''); });
  return h; }
/* Grouped by project (Todas and, R13, Hoy): one group per project in the order of the Proyectos tab, with its colour and count.
   Tapping a header filters the list by that project (a second tap clears it). In Hoy the rows say "Aplazada" where it applies */
function projectGroupsHTML(list, R, filter){ const ps=activeProjects(), by={}; let h=''; const o={noProj:true, noToday:filter==='hoy'};
  list.forEach(x=>{ const k=!x.projectId||!proj(x.projectId)?'none':ps.some(p=>p.id===x.projectId)?x.projectId:'archived'; (by[k]=by[k]||[]).push(x); });
  const head=(pf, dot, label, n)=>'<div class="group-title gh gtap" role="button" tabindex="0" data-pf="'+pf+'"><span class="gl"><span class="gdot" style="background:'+dot+'"></span>'+label+'<span class="gn">'+n+'</span></span>'+I.chev.replace('<svg','<svg class="gchev"')+'</div>'; // a div: a button would not stretch to the full width once stuck
  ps.forEach(p=>{ if(by[p.id]) h+=gsec(head(p.id, p.color, esc(p.name), by[p.id].length), by[p.id].map(x=>R(x,o)).join(''), gdrop('proj',p.id)); });
  if(by.archived) h+=gsec(gtitle('Proyectos archivados', by.archived.length), by.archived.map(x=>R(x,{noToday:o.noToday})).join(''));
  if(by.none) h+=gsec(head('none', 'var(--ink3)', 'Sin proyecto', by.none.length), by.none.map(x=>R(x,o)).join(''), gdrop('proj','none'));
  return h; }
function listHTML(filter, projectId){
  let list = pendingFor(filter, projectId, UI.query);
  const root = projectId===undefined;
  if(root && filter==='hoy' && !UI.query && UI.sumFilter) list = list.filter(x=> UI.sumFilter==='carried' ? x.carried : x.priority==='high');
  if(root && !UI.query && UI.projFilter!==null) list = list.filter(x=> UI.projFilter==='none' ? !x.projectId : x.projectId===UI.projFilter);
  const done = doneList(projectId); const dm = UI.query ? done.filter(queryMatcher(UI.query)) : [];
  // R3: no project capsule inside a project or under a project filter (a search ignores the filter, so it shows them)
  const noProj = projectId!==undefined || (root && !UI.query && UI.projFilter!==null);
  const R = (x,o)=>rowHTML(x, Object.assign({noProj}, o));
  const addBtn = '<button class="btn-link" data-act="add"'+(projectId!==undefined?' data-project="'+(projectId||'')+'"':'')+'>Añadir tarea</button>';
  const byProject = root && DB.settings[filter==='hoy'?'hoyGroup':'allGroup']==='project'; // R13: each view keeps its own grouping
  let h='';
  if(!list.length){ if(!(UI.query && UI.searchDone && dm.length)){ // the completed matches are listed below: no "Sin resultados" above them
    let title, sub, acts;
    if(UI.query){ title='Sin resultados'; sub='Prueba con otra palabra'; acts='<button class="btn-link" data-act="clearSearch">Borrar búsqueda</button>'; }
    else if(root && filter==='hoy' && UI.sumFilter){ title=UI.sumFilter==='carried'?'Sin aplazadas':'Sin prioritarias'; sub='Hoy no hay ninguna'; acts='<button class="btn-link" data-sum="all">Quitar filtro</button>'; }
    else if(root && UI.projFilter!==null){ const pf=UI.projFilter==='none'?null:proj(UI.projFilter); title='Nada '+(pf?'de '+esc(pf.name):'sin proyecto'); sub=filter==='hoy'?'Hoy no hay ninguna':'No hay pendientes'; acts='<button class="btn-link" data-pf="">Quitar filtro</button>'; }
    else if(filter==='hoy'){ title='Nada para hoy'; sub='Nada pendiente con fecha de hoy'; acts='<button class="btn-link" data-filter="todas">Ver todas</button>'+addBtn; }
    else { title='Sin tareas pendientes'; sub='Toca + o añade una desde aquí'; acts=addBtn; }
    h += '<div class="empty">'+I.inbox+'<b>'+title+'</b>'+sub+'<div class="acts">'+acts+'</div></div>';
  } }
  else if(UI.query){ h += '<div class="group-title">'+list.length+(list.length===1?' resultado':' resultados')+'</div><div class="group">'+list.map(x=>R(x)).join('')+'</div>'; }
  if(UI.query){ if(dm.length){ h += UI.searchDone ? '<div class="group-title">Completadas</div><div class="group">'+dm.map(x=>R(x)).join('')+'</div>' : '<div class="empty" style="padding:8px 0 16px"><div class="acts"><button class="btn-link" data-act="searchDone">Incluir '+dm.length+(dm.length===1?' completada':' completadas')+'</button></div></div>'; } return h; }
  else if(!list.length){}
  else if(byProject) h += projectGroupsHTML(list, R, filter);
  else if(filter==='todas') h += dayGroupsHTML(list, R, root, projectId);
  // Hoy: the carried tasks first, under Aplazadas with "Repasar (N)" (R9); the aplazadas filter already says it, so it keeps a plain list
  else if(filter==='hoy' && root && UI.sumFilter!=='carried' && list.some(x=>x.carried)){ const c=list.filter(x=>x.carried), d=list.filter(x=>!x.carried);
    h += gtitle('Aplazadas', null, UI.select?'':'<button class="gx" data-act="review">Repasar ('+c.length+')</button>')+'<div class="group">'+c.map(x=>R(x,{noToday:true,hideCarried:true})).join('')+'</div>'+
      (d.length?'<div class="group-title"'+gdrop('day',todayStr())+'>Hoy</div><div class="group"'+gdrop('day',todayStr())+'>'+d.map(x=>R(x,{noToday:true})).join('')+'</div>':''); } // decision 36: an Aplazada dropped on Hoy is confirmed for today
  else h += '<div class="group">'+list.map(x=>R(x,{noToday:filter==='hoy', hideCarried:root&&filter==='hoy'&&UI.sumFilter==='carried'})).join('')+'</div>';
  // R8: from 19:00 the day can be closed from the end of Hoy too, whatever the summary shows
  if(root && filter==='hoy' && !UI.select && new Date().getHours()>=19){ const n=pendingFor('hoy').length; if(n) h += '<div class="group"><button class="cell link closecell" data-act="closeDay">'+I.cal+'<span class="lbl">Cerrar el día</span><span class="val">'+n+(n===1?' pendiente':' pendientes')+'</span></button></div>'; }
  if(root && filter==='hoy' && !UI.sumFilter){ const tm=pendingFor('todas').filter(x=>x.date===addDays(todayStr(),1)).length; if(tm) h += '<button class="preview" data-filter="todas"><span>Mañana: '+tm+(tm===1?' tarea':' tareas')+'</span>'+I.chev+'</button>'; }
  if(done.length){ const dt=done.filter(x=>x.completed&&localDay(x.completed)===todayStr()).length;
    if(!DB.settings.doneOpen){ h += '<div class="group"><button class="cell link" data-act="toggleDone" style="justify-content:center"><span>Mostrar completadas ('+done.length+(dt?', '+dt+' hoy':'')+')</span></button></div>'; }
    else { const t=todayStr(), yd=addDays(t,-1); const by={}, order=[]; done.forEach(x=>{ const d=x.completed?localDay(x.completed):'0000'; if(!by[d]){ by[d]=[]; order.push(d); } by[d].push(x); });
      h += '<div class="group"><button class="cell link" data-act="toggleDone" style="justify-content:center"><span>Ocultar completadas</span></button></div>';
      order.forEach(d=>{ const label=d===t?'Hoy':d===yd?'Ayer':d==='0000'?'Sin fecha':fmtDate(d); h += gsec(gtitle(label, by[d].length), by[d].map(x=>R(x,{byDay:true})).join('')); }); } }
  return h;
}
function selectNav(){ const n=UI.select.ids.size; return '<header class="nav"><div class="nav-row"><button class="action" data-act="selAll">'+(UI.select.all?'Ninguna':'Todas')+'</button><div class="nav-title" id="selTitle">'+(n?n+(n===1?' seleccionada':' seleccionadas'):'Seleccionar')+'</div><button class="action strong" data-act="selDone">OK</button></div></header>'; }
function viewTareas(){
  const f=DB.settings.filter; const nHoy=UI.query?0:pendingFor('hoy').length, nTodas=UI.query?0:pendingFor('todas').length; // a search hides the segment that shows them
  if(UI.select && UI.select.scope==='root') return selectNav()+'<div class="scroll">'+listHTML(UI.query?'todas':f)+'</div>';
  return '<header class="nav"><div class="nav-row"><button class="title" data-act="spaceMenu" aria-label="Cambiar espacio">'+esc(space().name)+I.chevD+'</button>'+'<button class="action vopts" data-act="viewMenu" aria-label="Opciones de vista">'+I.more+'</button>'+'</div></header>'+
   '<div class="scroll">'+(f==='hoy'&&!UI.query?summaryHTML():'')+
   '<div class="searchbar"><div class="search">'+I.search+'<input type="search" placeholder="Buscar" value="'+esc(UI.query)+'" data-role="search" autocomplete="off"></div>'+(UI.query?'<button class="cancel" data-act="clearSearch">Cancelar</button>':'')+'</div>'+
   (UI.query?'':'<div class="seg"><button data-filter="hoy" class="'+(f==='hoy'?'on':'')+'">Hoy<span class="n">'+nHoy+'</span></button><button data-filter="todas" class="'+(f==='todas'?'on':'')+'">Todas<span class="n">'+nTodas+'</span></button></div>')+
   (!UI.query&&activeProjects().length?'<div class="pchips">'+activeProjects().map(p=>'<button class="chip'+(UI.projFilter===p.id?' on':'')+'" data-pf="'+p.id+'"'+(UI.projFilter===p.id?' style="background:'+p.color+'"':'')+'><span class="dot" style="background:'+(UI.projFilter===p.id?'#fff':p.color)+'"></span>'+esc(p.name)+'</button>').join('')+'<button class="chip'+(UI.projFilter==='none'?' on':'')+'" data-pf="none"><span class="dot" style="background:'+(UI.projFilter==='none'?'#fff':'var(--ink3)')+'"></span>Sin proyecto</button></div>':'')+
   listHTML(UI.query?'todas':f)+'</div>'+
   '<button class="fab" data-act="add" aria-label="Añadir tarea">'+I.plus+'</button>';
}

/* ---------- Projects view ---------- */
function viewProyectos(){
  const ps=activeProjects(); const pend=spaceTasks().filter(x=>x.status==='pending');
  const cnt = id => pend.filter(x=> id===null?!x.projectId:x.projectId===id).length;
  return '<header class="nav"><div class="nav-row"><div class="title">Proyectos</div><button class="action" data-act="newProject" aria-label="Nuevo proyecto">'+I.plus.replace('<svg','<svg style="width:22px;height:22px"')+'</button></div></header>'+
   '<div class="scroll"><div class="group">'+
   ps.map(p=>'<button class="cell" data-open-project="'+p.id+'"><span class="picon" style="background:'+p.color+'">'+I.list+'</span><span class="lbl">'+esc(p.name)+'</span><span class="count">'+cnt(p.id)+'</span>'+I.chev.replace('<svg','<svg class="chev"')+'</button>').join('')+
   '<button class="cell" data-open-project="none"><span class="picon" style="background:var(--ink3)">'+I.inbox.replace('stroke-width="2.2"','stroke-width="3"')+'</span><span class="lbl">Sin proyecto</span><span class="count">'+cnt(null)+'</span>'+I.chev.replace('<svg','<svg class="chev"')+'</button>'+
   '</div><div class="group"><button class="cell link" data-act="newProject">'+I.plus.replace('<svg','<svg style="width:18px;height:18px"')+'<span class="lbl">Nuevo proyecto</span></button></div>'+
   (ps.length?'<div class="footnote">Mantén pulsado un proyecto para renombrarlo, cambiar el color o archivarlo.</div>':'')+'</div>';
}
function viewProject(id){
  const p = id==='none'?null:proj(id); const title=p?p.name:'Sin proyecto';
  if(UI.select && UI.select.scope==='project') return selectNav()+'<div class="scroll">'+listHTML('todas', p?p.id:null)+'</div>';
  return '<header class="nav"><div class="nav-row"><button class="back" data-act="back">'+I.back+'Atrás</button><div class="nav-title">'+(p?'<span class="pdot" style="width:10px;height:10px;border-radius:50%;background:'+p.color+';display:inline-block;margin-right:6px;vertical-align:1px"></span>':'')+esc(title)+'</div>'+'<button class="action vopts" data-act="viewMenu" aria-label="Opciones de vista">'+I.more+'</button>'+'</div></header>'+
   '<div class="scroll">'+listHTML('todas', p?p.id:null)+'</div>'+
   '<button class="fab" data-act="add" data-project="'+(p?p.id:'')+'" aria-label="Añadir tarea">'+I.plus+'</button>';
}

/* ---------- Settings view ---------- */
function viewAjustes(){
  const th=DB.settings.theme||'auto'; const dev=UI.wide?'este dispositivo':'este iPhone'; // the desktop reuses this view
  return '<header class="nav"><div class="nav-row"><div class="title">Ajustes</div></div></header>'+
   '<div class="scroll">'+
   syncAccountHTML(dev)+pushSectionHTML(dev)+
   '<div class="group-title">Espacios</div><div class="group">'+DB.spaces.slice().sort((a,b)=>a.order-b.order).map(sp=>'<button class="cell" data-edit-space="'+sp.id+'"><span class="lbl">'+esc(sp.name)+'</span>'+(sp.id===space().id?'<span class="val">Activo</span>':'')+I.chev.replace('<svg','<svg class="chev"')+'</button>').join('')+'<button class="cell link" data-act="newSpace">'+I.plus.replace('<svg','<svg style="width:18px;height:18px"')+'<span class="lbl">Nuevo espacio</span></button></div>'+
   '<div class="footnote">Al eliminar un espacio se eliminan también sus proyectos, tareas y notas de voz.</div>'+
   '<div class="group-title">Datos</div><div class="group"><button class="cell" data-act="exportFile"><span class="lbl">Exportar a archivo</span><span class="val">JSON</span></button><button class="cell" data-act="exportCSV"><span class="lbl">Exportar a Excel</span><span class="val">CSV</span></button><button class="cell" data-act="importFile"><span class="lbl">Importar desde archivo</span><span class="val">JSON</span></button><button class="cell" data-act="import"><span class="lbl">Importar pegando texto</span></button></div>'+
   '<div class="footnote">Al importar, lo existente se actualiza si la copia es más reciente.</div>'+
   '<div class="group-title">Copias de seguridad</div><div class="group bk-group">'+(BACKUPS.length?BACKUPS.map(backupRowHTML).join(''):'<div class="cell"><span class="lbl" style="color:var(--ink2)">Todavía ninguna</span></div>')+'<button class="cell link" data-act="backupNow">'+I.plus.replace('<svg','<svg style="width:18px;height:18px"')+'<span class="lbl">Crear copia ahora</span></button>'+
   (BACKUPS.length?'<button class="cell" data-act="backupsClear"><span class="lbl" style="color:var(--red)">Borrar todas las copias</span></button>':'')+'</div>'+
   '<div class="footnote">Una copia automática al día en '+dev+'; se conservan las últimas siete. '+(UI.wide?'Haz clic en una para restaurarla; con el botón derecho, o la papelera, se borra.':'Toca una para restaurarla; desliza a la izquierda para borrarla.')+'</div>'+
   (UI.wide?'':'<div class="group-title">Gestos</div><div class="group"><button class="cell" data-act="shakeToggle"><span class="lbl">Agitar para deshacer</span><span class="switch'+(DB.settings.shakeUndo?' on':'')+'"></span></button></div>'+
   '<div class="footnote">Agita el iPhone mientras se muestra el aviso para deshacer la última acción. Pide permiso de movimiento una vez.</div>')+ // shaking is an iPhone gesture
   '<div class="group-title">Pruebas</div><div class="group"><button class="cell" data-act="demo"><span class="lbl">Generar datos de prueba</span><span class="val">150 tareas</span></button><button class="cell" data-act="demoClear"><span class="lbl" style="color:var(--red)">Eliminar datos de prueba</span><span class="val">'+demoCount()+'</span></button></div>'+
   '<div class="footnote">Se crean en el espacio activo y se eliminan sin tocar tus datos.</div>'+
   '<div class="group-title">Registro</div><div class="group"><button class="cell" data-act="log"><span class="lbl">Ver registro</span><span class="val">'+LOG.length+' entradas</span></button><button class="cell" data-act="logCopy"><span class="lbl">Copiar registro</span></button></div>'+
   '<div class="footnote">Cópialo y pégalo en el chat para depurar.</div>'+
   '<div class="group-title">Aspecto</div><div class="group"><div class="cell"><span class="lbl">Tema</span></div><div style="padding:0 16px 12px"><div class="seg" style="margin:0"><button data-theme="auto" class="'+(th==='auto'?'on':'')+'">Automático</button><button data-theme="light" class="'+(th==='light'?'on':'')+'">Claro</button><button data-theme="dark" class="'+(th==='dark'?'on':'')+'">Oscuro</button></div></div></div>'+
   '<div class="group-title">Proyectos archivados</div><div class="group">'+(DB.projects.filter(p=>p.archived&&p.spaceId===space().id).map(p=>'<button class="cell" data-unarchive="'+p.id+'"><span class="pdot" style="background:'+p.color+'"></span><span class="lbl">'+esc(p.name)+'</span><span class="val">Restaurar</span></button>').join('')||'<div class="cell"><span class="lbl" style="color:var(--ink2)">Ninguno en '+esc(space().name)+'</span></div>')+'</div>'+
   (pendingSW?'<div class="group-title">Actualización</div><div class="group"><button class="cell link" data-act="update"><span class="lbl">Nueva versión disponible</span><span class="val">Actualizar</span></button></div>':'')+
   '<div class="footnote">Tareas v'+APP_VERSION+'. Datos guardados en el dispositivo.</div></div>';
}

/* ---------- Detail view ---------- */
function viewDetail(id){
  const x=task(id); if(!x) return '';
  const p=x.projectId?proj(x.projectId):null; const vns=DB.voiceNotes.filter(v=>v.taskId===id).sort((a,b)=>a.created<b.created?1:-1);
  const pl={high:'Alta',mid:'Media',none:'Ninguna'}[x.priority]||'Ninguna'; const chev=I.chev.replace('<svg','<svg class="chev"'); const links=detailLinks(x.notes);
  if(UI.wide) return inspectorHTML(x, p, vns, links);
  return '<header class="nav"><div class="nav-row"><button class="back" data-act="back">'+(UI.wide?'Cerrar':I.back+'Atrás')+'</button><div class="nav-title">Detalles</div><div class="actions"><button class="action" data-act="share" aria-label="Compartir">'+I.share+'</button><button class="action" data-act="menu" aria-label="Más">'+I.more+'</button></div></div></header>'+
   '<div class="scroll">'+
   '<div class="group"><div class="cell input"><textarea class="titlein" data-role="title" rows="1" placeholder="Título" enterkeyhint="done">'+esc(x.title)+'</textarea></div><div class="cell input"><textarea data-role="notes" placeholder="Notas">'+esc(x.notes)+'</textarea></div>'+(links.length?'<div class="links">'+linksHTML(links)+'</div>':'')+convertHTML(x)+'</div>'+
   '<div class="group"><button class="cell" data-act="pickProject"><span class="lbl">Proyecto</span><span class="val">'+(p?'<span class="dot" style="background:'+p.color+'"></span>'+esc(p.name):'Ninguno')+'</span>'+chev+'</button>'+
   '<button class="cell" data-act="pickDate"><span class="lbl">Fecha</span><span class="val">'+(x.date?fmtDate(x.date):'Sin fecha')+'</span>'+chev+'</button>'+
   '<button class="cell" data-act="pickReminder"><span class="lbl">Recordatorio</span><span class="val">'+(x.reminder?fmtDateTime(x.reminder):'Ninguno')+'</span>'+chev+'</button>'+
   '<button class="cell" data-act="pickPriority"><span class="lbl">Prioridad</span><span class="val '+(x.priority==='none'?'':x.priority)+'">'+pl+'</span>'+chev+'</button></div>'+
   (pushNote(x)?'<div class="footnote push-note">'+pushNote(x)+'</div>':'')+
   '<div class="group-title">Notas de voz</div><div class="group">'+vns.map(vnHTML).join('')+'<button class="cell link" data-act="voice">'+I.mic.replace('<svg','<svg style="width:18px;height:18px"')+'<span class="lbl">Añadir nota de voz</span></button></div>'+
   attWrapHTML(x)+
   '</div>';
}
/* R17: the desktop detail as a Mac inspector. The title and notes (the same fields and roles as the iPhone, for bindDetail),
   then a form: Proyecto a pop-up menu, Fecha and Recordatorio popovers with the calendar, Prioridad a three-position segment;
   voice notes; and when it was created and last changed at the foot */
const UPDOWN='<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 4.5L6 2l2.5 2.5M3.5 7.5L6 10l2.5-2.5"/></svg>';
const XICON='<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M2 2l8 8M10 2l-8 8"/></svg>';
function inspectorHTML(x, p, vns, links){
  const pop=(act, val, none, ic, extra)=>'<button class="ipop" data-act="'+act+'" aria-haspopup="'+(act==='pickProject'?'menu':'dialog')+'">'+(extra||'')+'<span class="val'+(none?' none':'')+'">'+val+'</span>'+ic+'</button>';
  const seg=[['none','Ninguna',''],['mid','Media','!!'],['high','Alta','!!!']].map(([k,l,mk])=>'<button class="'+k+(x.priority===k?' on':'')+'" data-act="setPri" data-pr="'+k+'" role="radio" aria-checked="'+(x.priority===k)+'">'+(mk?'<span class="pri '+k+'">'+mk+'</span>':'')+l+'</button>').join('');
  return '<header class="ihead"><button class="ix back" data-act="back" aria-label="Cerrar" title="Cerrar (Esc)">'+XICON+'</button><span class="grow"></span><button data-act="share" aria-label="Compartir" title="Compartir">'+I.share+'</button><button data-act="menu" aria-label="Más" title="Más">'+I.more+'</button></header>'+
   '<div class="scroll">'+
   '<div class="group igroup"><div class="cell input"><textarea class="titlein" data-role="title" rows="1" placeholder="Título" enterkeyhint="done">'+esc(x.title)+'</textarea></div><div class="cell input"><textarea data-role="notes" placeholder="Notas">'+esc(x.notes)+'</textarea></div>'+(links.length?'<div class="links">'+linksHTML(links)+'</div>':'')+convertHTML(x)+'</div>'+
   '<div class="iform"><span class="ilbl">Proyecto</span>'+pop('pickProject', p?esc(p.name):'Ninguno', !p, UPDOWN, p?'<span class="dot" style="background:'+p.color+'"></span>':'')+
   '<span class="ilbl">Fecha</span>'+pop('pickDate', x.date?(x.carried&&x.date<=todayStr()?'Hoy, aplazada':fmtDate(x.date)):'Sin fecha', !x.date, I.cal)+
   '<span class="ilbl">Recordatorio</span>'+pop('pickReminder', x.reminder?fmtDateTime(x.reminder):'Ninguno', !x.reminder, I.bell)+
   '<span class="ilbl">Prioridad</span><div class="seg iseg" role="radiogroup" aria-label="Prioridad">'+seg+'</div></div>'+
   '<div class="group-title">Notas de voz</div><div class="group">'+vns.map(vnHTML).join('')+'<button class="cell link" data-act="voice">'+I.mic.replace('<svg','<svg style="width:16px;height:16px"')+'<span class="lbl">Añadir nota de voz</span></button></div>'+
   attWrapHTML(x)+
   '<div class="ifoot">'+[['Creada',x.created],['Modificada',x.modified],['Completada',x.status==='done'&&x.completed]].filter(o=>o[1]).map(o=>{ const w=fmtDateTime(o[1]); return o[0]+' '+w[0].toLowerCase()+w.slice(1)+'<br>'; }).join('')+(pushNote(x)?'<span class="push-note">'+pushNote(x)+'</span>':'')+'</div>'+
   '</div>';
}
const detailLinks = notes => extractLinks(notes).slice(0,6);
/* R6: note lines that start with a dash, an asterisk or an empty box can become tasks of the same project. The note keeps its lines;
   once converted, the link hides until the note changes. */
function convertHTML(x){ const n=UI.convertedNotes[x.id]===x.notes?0:noteItems(x.notes).length; return n?'<button class="cell link convert" data-act="convertLines">'+I.list.replace('<svg','<svg style="width:18px;height:18px"')+'<span class="lbl">Convertir '+n+(n===1?' línea en tarea':' líneas en tareas')+'</span></button>':''; }
function convertNoteLines(id){ const x=task(id); if(!x) return; const ls=noteItems(x.notes); if(!ls.length) return;
  const ids=addMany(ls, {date:null, projectId:x.projectId, priority:'none'}, x.projectId?{}:{spaceId:x.spaceId}); UI.convertedNotes[id]=x.notes; renderAnimated();
  log('info','Líneas de notas convertidas en tareas', {n:ids.length}); toast(ids.length===1?'1 tarea creada':ids.length+' tareas creadas', ()=>{ removeTasks(ids); delete UI.convertedNotes[id]; }); }
// A voice note row: swipe right to edit, left to delete (on the desktop, a click offers both)
const vnHTML = v => '<div class="vn" data-vn="'+v.id+'"><div class="vn-bg l"><button data-vact="edit">Editar</button></div><div class="vn-bg r"><button data-vact="del">Eliminar</button></div><div class="vn-c"><small>'+fmtDateTime(v.created)+(v.modified?', editada':'')+'</small>'+linkify(v.text)+'</div></div>';
function linksHTML(links){ return links.map(l=>'<a href="'+esc(l.href)+'"'+(l.href.startsWith('tel:')?'':' target="_blank" rel="noopener"')+'>'+esc(l.label)+'</a>').join(''); }
function bindDetail(el, id){
  const x=task(id); if(!x) return;
  const ti=$('[data-role=title]',el), no=$('[data-role=notes]',el), sc=el.querySelector('.scroll');
  // Growing a text area collapses it for a moment: the screen keeps its scroll instead of jumping to the top
  const fit=(ta,h)=>{ const y=sc?sc.scrollTop:0; ta.style.height='auto'; ta.style.height=h()+'px'; if(sc) sc.scrollTop=y; };
  const growT=()=>fit(ti,()=>ti.scrollHeight); growT();
  // The lists behind show the new title as it is typed; no render here, which would rebuild this screen under the finger
  const showTitle=()=>{ document.querySelectorAll('.row[data-id="'+id+'"] .row-title').forEach(e=>{ e.textContent=x.title||'Sin título'; if(e.hasAttribute('title')) e.title=x.title||''; }); // the desktop tooltip follows the title
    document.querySelectorAll('.wcard[data-id="'+id+'"] .t').forEach(e=>{ const n=[...e.childNodes].find(c=>c.nodeType===3); if(n) n.nodeValue=x.title; }); };
  // The title is required: an empty field never reaches the data, and on leaving it the last title comes back
  ti.addEventListener('input',()=>{ const v=ti.value.replace(/\n/g,' '); if(v.trim()){ saveEdit(x,{title:v}); showTitle(); } growT(); });
  ti.addEventListener('keydown',e=>{ if(e.key==='Enter'){ e.preventDefault(); ti.blur(); } });
  ti.addEventListener('blur',()=>{ const v=ti.value.replace(/\n/g,' ').trim(); if(v&&v!==x.title){ x.title=v; x.modified=new Date().toISOString(); save(); showTitle(); } else flushEdits(); if(ti.value!==x.title){ ti.value=x.title; growT(); } });
  const grow=()=>fit(no,()=>Math.max(100, no.scrollHeight+2)); grow();
  // The link and phone chips under the notes follow what is typed, a moment after the last key; only the strip changes
  let lt=null; const refreshLinks=()=>{ const ls=detailLinks(x.notes); let box=$('.links',el); const cur=box?[...box.querySelectorAll('a')].map(a=>a.getAttribute('href')).join(' '):'';
    if(cur===ls.map(l=>l.href).join(' ')) return;
    if(!ls.length){ box.remove(); return; }
    if(!box){ if(!no.isConnected) return; box=document.createElement('div'); box.className='links'; no.closest('.cell').after(box); }
    box.innerHTML=linksHTML(ls); };
  const refreshConvert=()=>{ const old=$('.convert',el), html=convertHTML(x); if(!no.isConnected) return; if(old&&old.outerHTML===html) return; if(old) old.remove(); if(html) no.closest('.group').insertAdjacentHTML('beforeend', html); };
  no.addEventListener('input',()=>{ saveEdit(x,{notes:no.value}); grow(); clearTimeout(lt); lt=setTimeout(()=>{ refreshLinks(); refreshConvert(); }, 400); });
  no.addEventListener('blur', flushEdits);
}
