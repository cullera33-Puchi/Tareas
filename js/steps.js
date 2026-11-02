'use strict';
/* Tareas. Decision 46: steps (subtasks) inside a task, only a title and a check box, as in Recordatorios.
   A classic script: index.html loads every file of js/ in order and they share their global names. Only declarations and
   listeners run at load; the start itself (first screen, timers, sync, service worker) is in boot.js, the last file.
   - Data: DB.subtasks, one record per step {id, taskId, title, done, order, created, modified}, synced as the table subtasks
     (0005_subtasks.sql). Separate records, not a field of the task, so two devices that change different steps never conflict.
     Changing a step leaves the task's modified alone for the same reason: an edit of the task elsewhere is never beaten by it.
   - order: integers with room between them (STEP_GAP), so a step put between two others changes one record; when there is no room
     left, the task's steps are numbered again. Equal orders (two devices adding at once) fall back on created and id: the same on all.
   - The detail (iPhone) and the inspector (desktop) draw the group Pasos (stepsGroupHTML) and bindSteps wires it. Changes made there
     repaint only that group (stepsPaint, keyed by step), so the field being typed in keeps its focus and the iPhone keyboard stays;
     the lists behind follow (stepsRefresh).
   - iPhone: a tap on a step edits its title, Intro adds the next one, a swipe to the left shows Eliminar, a long press lifts it to
     move it. Desktop: the title is a field, a handle on hover moves it, its menu (the button on hover or the right button) and Supr
     on the selected step delete it; Alt and an arrow move it from the keyboard */
const STEP_GAP=1024;
const GRIP='<svg viewBox="0 0 12 16" fill="currentColor" aria-hidden="true"><circle cx="4" cy="3.5" r="1.3"/><circle cx="8" cy="3.5" r="1.3"/><circle cx="4" cy="8" r="1.3"/><circle cx="8" cy="8" r="1.3"/><circle cx="4" cy="12.5" r="1.3"/><circle cx="8" cy="12.5" r="1.3"/></svg>';

/* ---------- Data ---------- */
const stepRec = sid => DB.subtasks.find(s=>s&&s.id===sid);
const stepCmp = (a,b) => (a.order||0)-(b.order||0) || (a.created<b.created?-1:a.created>b.created?1:0) || (String(a.id)<String(b.id)?-1:String(a.id)>String(b.id)?1:0);
function stepsOf(taskId){ return DB.subtasks.filter(s=>s&&s.taskId===taskId).sort(stepCmp); }
// How many steps a task has and how many are done, worked out once per version of the data (rows ask for it one by one)
let stepMapV=-1, stepMapC=null;
function stepStats(taskId){ if(stepMapV!==dataVer||!stepMapC){ stepMapC=new Map(); DB.subtasks.forEach(s=>{ if(!s) return; let o=stepMapC.get(s.taskId); if(!o){ o={n:0, done:0}; stepMapC.set(s.taskId, o); } o.n++; if(s.done) o.done++; }); stepMapV=dataVer; }
  return stepMapC.get(taskId)||null; }
const stepsCount = taskId => { const st=stepStats(taskId); return st&&st.n ? st.done+' de '+st.n : ''; };
// The order for a step put at index i of list (the task's steps in order, without it). Renumbers the list when there is no room
function stepOrderAt(list, i){ const ord=k=>list[k].order||0;
  const room=()=>{ if(!list.length) return STEP_GAP; if(i<=0) return ord(0)-STEP_GAP; if(i>=list.length) return ord(list.length-1)+STEP_GAP; const a=ord(i-1), b=ord(i); return b-a>1?Math.floor((a+b)/2):null; };
  let o=room(); if(o!==null) return o;
  const now=new Date().toISOString(); list.forEach((s,k)=>{ const n=(k+1)*STEP_GAP*2; if(s.order!==n){ s.order=n; s.modified=now; } }); return room(); }
function addStep(taskId, title, index){ const list=stepsOf(taskId), i=index==null?list.length:Math.max(0, Math.min(index, list.length)), t=new Date().toISOString();
  const s={id:uid(), taskId, title:String(title||'').replace(/\s+/g,' ').trim(), done:false, order:stepOrderAt(list, i), created:t, modified:t};
  DB.subtasks.push(s); save(); return s; }
// Decisions 38 and 46: the next task of a series and a duplicate get the steps of the task, unchecked, in the same order
function copySteps(fromId, toId){ const t=new Date().toISOString(), src=stepsOf(fromId); if(!src.length) return 0;
  src.forEach((s,k)=>DB.subtasks.push({id:uid(), taskId:toId, title:s.title, done:false, order:(k+1)*STEP_GAP, created:t, modified:t})); save(); return src.length; }
// A task deleted takes its steps with it (as its voice notes); what is cut comes back with Deshacer
function cutSteps(ids){ const out=DB.subtasks.filter(s=>s&&ids.has(s.taskId)); if(out.length) DB.subtasks=DB.subtasks.filter(s=>!s||!ids.has(s.taskId)); return out; }
function putSteps(list){ (list||[]).forEach(s=>{ if(!DB.subtasks.some(x=>x.id===s.id)) DB.subtasks.push(s); }); }
// Steps nobody has touched since they were copied (dropNext takes such a next task back)
const stepsTouched = taskId => DB.subtasks.some(s=>s&&s.taskId===taskId&&s.modified!==s.created);
// Typing in a step is saved a moment after the last key, as the task's title (saveEdit); editPatch lets a reload from another window put it back
function saveStepEdit(s, patch){ Object.assign(s, patch, {modified:new Date().toISOString()}); dataVer++;
  editPatch={id:s.id, step:true, patch:Object.assign(editPatch&&editPatch.id===s.id?editPatch.patch:{}, patch, {modified:s.modified})};
  clearTimeout(editSaveT); editSaveT=setTimeout(save, 400); }

/* ---------- Actions ---------- */
// Decision 46.2: checking the last open step offers to complete the task (the normal path: R1's hold, then its own Deshacer); it never completes alone
function toggleStep(sid){ const s=stepRec(sid); if(!s) return; flushEdits(); s.done=!s.done; s.modified=new Date().toISOString(); save(); haptic(s.done?10:6);
  stepsRefresh(s.taskId, sid); const st=stepStats(s.taskId), x=task(s.taskId);
  if(s.done&&st&&st.done===st.n&&x&&x.status!=='done'&&!HELD.has(x.id)){ log('info','Todos los pasos hechos', {n:st.n});
    toast('Todos los pasos hechos', ()=>{ const y=task(x.id); if(y&&y.status!=='done'&&!HELD.has(y.id)) toggleHold(y.id); }, 'Completar tarea'); } }
function deleteStep(sid, quiet){ const i=DB.subtasks.findIndex(s=>s&&s.id===sid); if(i<0) return; const [s]=DB.subtasks.splice(i,1); save(); haptic(quiet?4:14); stepsRefresh(s.taskId);
  if(quiet) return; log('info','Paso eliminado');
  toast('Paso eliminado', ()=>{ if(!DB.subtasks.some(x=>x.id===s.id)) DB.subtasks.push(s); save(); stepsRefresh(s.taskId); }); }
// Moves a step to index i of its task's steps, with Deshacer (the orders of all of them come back)
function reorderStep(sid, i){ const s=stepRec(sid); if(!s) return false; const all=stepsOf(s.taskId), from=all.indexOf(s); if(i===from||i<0||i>=all.length) return false;
  const prev=all.map(o=>({id:o.id, order:o.order})), list=all.filter(o=>o!==s);
  s.order=stepOrderAt(list, i); s.modified=new Date().toISOString(); save(); haptic(8); stepsRefresh(s.taskId); log('info','Paso movido');
  toast('Paso movido', ()=>{ const now=new Date().toISOString(); prev.forEach(o=>{ const r=stepRec(o.id); if(r&&r.order!==o.order){ r.order=o.order; r.modified=now; } }); save(); stepsRefresh(s.taskId); });
  return true; }
// Several lines pasted (or one typed) in Añadir paso: one step each, in order, with one Deshacer when there are several (R6's cleaning)
function addStepLines(taskId, lines, index){ const out=[]; batch(()=>{ lines.forEach((l,k)=>{ if(l) out.push(addStep(taskId, l, index==null?null:index+k)); }); }); stepsRefresh(taskId);
  if(out.length>1){ haptic(8); log('info','Pasos añadidos desde una lista', {n:out.length}); toast(out.length+' pasos añadidos', ()=>{ const ids=new Set(out.map(s=>s.id)); DB.subtasks=DB.subtasks.filter(s=>!ids.has(s.id)); save(); stepsRefresh(taskId); }); }
  return out; }
// R17: the desktop menu of a step (its button, or the right button at the pointer); on the iPhone the swipes and the long press do this
function stepMenu(sid, at){ const s=stepRec(sid); if(!s) return; const all=stepsOf(s.taskId), i=all.indexOf(s);
  popMenu(Object.assign(at, {groups:[[{label:s.done?'Desmarcar paso':'Marcar paso', icon:s.done?MI.undo:MI.check, key:'Espacio', fn:()=>toggleStep(sid)}],
    [{label:'Subir', icon:MI.up, disabled:i<=0, fn:()=>reorderStep(sid, i-1)},{label:'Bajar', icon:MI.down, disabled:i>=all.length-1, fn:()=>reorderStep(sid, i+1)}].filter(o=>!o.disabled),
    [{label:'Eliminar paso', icon:MI.trash, red:true, key:'Supr', fn:()=>deleteStep(sid)}]]})); }

/* ---------- Drawing ---------- */
// "3/4" and a small ring, for the rows and the calendar cards; nothing for a task without steps
function stepProgHTML(x){ const st=stepStats(x.id); if(!st||!st.n) return ''; const C=2*Math.PI*5.5, f=st.done/st.n, w=st.done+' de '+st.n+' pasos';
  return '<span class="sprog'+(st.done===st.n?' full':'')+'" title="'+w+'" aria-label="'+w+'">'+st.done+'/'+st.n+'<svg viewBox="0 0 14 14" aria-hidden="true"><circle cx="7" cy="7" r="5.5" class="sr-bg"/>'+
    (st.done?'<circle cx="7" cy="7" r="5.5" class="sr-fg" transform="rotate(-90 7 7)" stroke-dasharray="'+(f*C).toFixed(2)+' '+C.toFixed(2)+'"/>':'')+'</svg></span>'; }
const stepSig = s => s.title+'\u0001'+!!s.done;
function stepRowHTML(s){ const draft=!s.id;
  return '<div class="vn step'+(s.done?' done':'')+(draft?' draft':'')+'"'+(draft?'':' data-st="'+esc(s.id)+'"')+' role="listitem" tabindex="-1">'+
    (UI.wide?'':'<div class="vn-bg r"><button data-sact="del">Eliminar</button></div>')+
    '<div class="vn-c step-c"><button class="check scheck'+(s.done?' done':'')+'" data-sact="check" role="checkbox" aria-checked="'+!!s.done+'" aria-label="Paso hecho" tabindex="-1">'+I.check+'</button>'+
    '<textarea class="stepin" data-role="step" rows="1" enterkeyhint="next" placeholder="Paso" aria-label="Paso" autocomplete="off">'+esc(s.title||'')+'</textarea>'+
    (UI.wide?'<button class="smore" data-sact="menu" aria-label="Opciones del paso" title="Opciones" tabindex="-1">'+I.more+'</button><span class="sgrip" title="Arrastra para ordenar">'+GRIP+'</span>':'')+'</div></div>'; }
// Decision 46: the group Pasos of the detail and the inspector, its count in the header, the steps and Añadir paso at the end
function stepsGroupHTML(x){ const list=stepsOf(x.id);
  return '<div class="group-title steps-title">Pasos<span class="steps-count" data-steps-count="'+esc(x.id)+'">'+stepsCount(x.id)+'</span></div>'+
    '<div class="group steps" data-steps="'+esc(x.id)+'" role="list" aria-label="Pasos">'+list.map(stepRowHTML).join('')+
    '<div class="step-add"><span class="sadd" aria-hidden="true">'+I.plus+'</span><textarea class="stepin" data-role="stepadd" rows="1" enterkeyhint="next" placeholder="Añadir paso" aria-label="Añadir paso" autocomplete="off"></textarea></div></div>'; }
const htmlEl = h => { const t=document.createElement('template'); t.innerHTML=h; return t.content.firstElementChild; };
// A text area as tall as its text; the scroll box around it keeps its place while it grows
function stepGrow(ta){ if(!ta||!ta.isConnected) return; stepOwn(()=>{ const sc=ta.closest('.scroll'), y=sc?sc.scrollTop:0; ta.style.height='auto'; const h=ta.scrollHeight; if(h) ta.style.height=h+'px'; else ta.style.height=''; if(sc) sc.scrollTop=y; }); }
// Changes of this code to the drawing (heights, a draft row) are not changes the desktop inspector must be drawn again for (R18)
function stepOwn(fn){ markDirty(rowWatch.takeRecords()); try{ return fn(); } finally{ rowWatch.takeRecords(); } }
/* Repaints one group Pasos from the data, by step: a step that did not change stays as it is, a changed one is drawn again, unless the
   field being typed in is inside it (then only its check changes), and a draft row (a step being written after Intro) keeps its place.
   Nothing focused is ever moved, so the iPhone keyboard stays */
function stepsPaint(box){ const tid=box.dataset.steps, list=stepsOf(tid), ae=document.activeElement, add=box.querySelector(':scope > .step-add'); if(!add) return;
  const have=new Map(), drafts=new Map(); let last=null;
  [...box.children].forEach(el=>{ if(el===add) return; if(el.dataset.st){ have.set(el.dataset.st, el); last=el.dataset.st; } else if(el.classList.contains('draft')){ if(el.contains(ae)) drafts.set(last, el); else el.remove(); } });
  const want=[]; if(drafts.has(null)) want.push(drafts.get(null));
  list.forEach(s=>{ let el=have.get(s.id); const sig=stepSig(s);
    if(el){ have.delete(s.id); if(el._sig!==sig){ if(el.contains(ae)){ el.classList.toggle('done', !!s.done); const c=el.querySelector('.scheck'); if(c){ c.classList.toggle('done', !!s.done); c.setAttribute('aria-checked', String(!!s.done)); } el._sig=sig; }
      else { const n=htmlEl(stepRowHTML(s)); n._sig=sig; if(el.dataset.open) closeVn(el); el.replaceWith(n); el=n; stepBindRow(n); } } }
    else { el=htmlEl(stepRowHTML(s)); el._sig=sig; stepBindRow(el); }
    want.push(el); if(drafts.has(s.id)) want.push(drafts.get(s.id)); });
  have.forEach(el=>{ if(el.contains(ae)) want.push(el); else { if(openVn===el) openVn=null; el.remove(); } }); // a step deleted elsewhere while typed in stays until it is left
  drafts.forEach((el,k)=>{ if(!want.includes(el)) want.push(el); });
  want.push(add); let cur=box.firstElementChild;
  want.forEach(el=>{ if(el===cur){ cur=cur.nextElementSibling; return; } box.insertBefore(el, cur); });
  box.querySelectorAll('.stepin').forEach(ta=>{ if(!ta.style.height) stepGrow(ta); }); }
/* After a change of steps: every group Pasos of that task is repainted, then the rest follows. On the desktop the column and the calendar
   are drawn again around an inspector that stays as it is (its focus and caret too, R18); on the iPhone the screens under the detail are
   drawn a moment later, so going back finds them current */
function stepsRefresh(tid, pop){ markDirty(rowWatch.takeRecords()); const pn=UI.wide?document.querySelector('#desk > .pane'):null, ae=document.activeElement, clean=!!pn&&(!pn._dirty||(pn.dataset.task===tid&&!!ae&&pn.contains(ae))); // a change made from inside it keeps it
  document.querySelectorAll('.steps[data-steps="'+CSS.escape(tid)+'"]').forEach(stepsPaint);
  document.querySelectorAll('[data-steps-count="'+CSS.escape(tid)+'"]').forEach(e=>{ e.textContent=stepsCount(tid); });
  if(pop) document.querySelectorAll('.step[data-st="'+CSS.escape(pop)+'"] .scheck.done').forEach(c=>{ c.classList.remove('just'); void c.offsetWidth; c.classList.add('just'); });
  rowWatch.takeRecords(); // its own changes leave the pane current
  if(UI.wide){ if(clean&&pn.isConnected){ pn._h=drawing(deskPaneHTML); pn._dirty=false; } render(); return; }
  app.querySelectorAll('.screen.root:not(.hidden-tab)').forEach(s=>{ s.dataset.dirty='1'; }); UI.stack.slice(0,-1).forEach(s=>{ s.el.dataset.dirty='1'; }); scheduleRefresh(); }

/* ---------- Events ---------- */
// The detail (or the inspector) was drawn: its group Pasos gets its listeners once, its rows their gestures, its fields their height
function bindSteps(scope){ const box=scope.querySelector('.steps[data-steps]'); if(!box) return;
  box.querySelectorAll(':scope > .step[data-st]').forEach(el=>{ const s=stepRec(el.dataset.st); if(s) el._sig=stepSig(s); stepBindRow(el); });
  box.querySelectorAll('.stepin').forEach(stepGrow);
  if(box._sb) return; box._sb=1;
  box.addEventListener('click', stepClick); box.addEventListener('input', stepInput); box.addEventListener('keydown', stepKey);
  box.addEventListener('focusout', stepLeave); box.addEventListener('paste', stepPaste);
  if(UI.wide){ box.addEventListener('contextmenu', e=>{ const row=e.target.closest('.step[data-st]'); if(!row||(e.target.classList.contains('stepin')&&document.activeElement===e.target)) return; e.preventDefault(); /* a title being edited keeps the text menu */ stepMenu(row.dataset.st, {x:e.clientX, y:e.clientY}); });
    box.addEventListener('pointerdown', stepGripDown); } }
function stepBindRow(el){ if(!UI.wide) bindStepGestures(el); }
const stepBox = el => el&&el.closest('.steps[data-steps]');
const stepFocusEnd = ta => { ta.focus(); const n=ta.value.length; try{ ta.setSelectionRange(n,n); }catch(e){} };
function stepClick(e){ const row=e.target.closest('.step'), sa=e.target.closest('[data-sact]');
  if(row&&row.dataset.open){ closeVn(row); if(sa&&sa.dataset.sact==='del') deleteStep(row.dataset.st); return; } // a row showing Eliminar: its button deletes, the rest closes it
  if(sa&&row&&row.dataset.st){ const k=sa.dataset.sact; if(k==='check') toggleStep(row.dataset.st); else if(k==='del') deleteStep(row.dataset.st); else if(k==='menu') stepMenu(row.dataset.st, {anchor:sa, align:'right'}); return; }
  if(sa) return;
  const add=e.target.closest('.step-add'); if(add){ const ta=add.querySelector('.stepin'); if(document.activeElement!==ta) ta.focus(); return; }
  // iPhone: a tap on a step edits it, the focus given inside the tap so iOS opens the keyboard (point 18). On the desktop a click there selects the step
  if(row&&!UI.wide){ const ta=row.querySelector('.stepin'); if(ta&&document.activeElement!==ta) stepFocusEnd(ta); } }
function stepInput(e){ const ta=e.target; if(!ta.classList.contains('stepin')) return; stepGrow(ta); if(ta.dataset.role!=='step') return;
  const row=ta.closest('.step'), v=ta.value.replace(/\s*\n\s*/g,' '), box=stepBox(ta);
  if(!row.dataset.st){ if(!v.trim()) return; // a draft becomes a step with its first letter, in the place where it is written
    const i=[...box.querySelectorAll(':scope > .step')].filter(r=>r===row||r.dataset.st).indexOf(row), s=addStep(box.dataset.steps, v, i);
    row.dataset.st=s.id; row.classList.remove('draft'); row._sig=stepSig(s); row._fresh=true; stepBindRow(row); stepsRefresh(s.taskId); return; }
  const s=stepRec(row.dataset.st); if(!s||!v.trim()) return; // an empty title never reaches the data: leaving it empty deletes the step
  saveStepEdit(s, {title:v}); row._sig=stepSig(s); }
function stepKey(e){ const t=e.target, box=stepBox(t); if(!box||e.isComposing) return; const tid=box.dataset.steps;
  if(t.classList.contains('stepin')){
    if(e.key==='Escape'&&UI.wide){ e.preventDefault(); e.stopPropagation(); const row=t.closest('.step'); if(row&&row.dataset.st) row.focus(); else t.blur(); return; } // the Mac way: the step stays selected, the inspector stays open
    if(e.key!=='Enter'||e.shiftKey) return; e.preventDefault(); e.stopPropagation();
    const v=t.value.replace(/\s+/g,' ').trim();
    if(t.dataset.role==='stepadd'){ if(!v){ t.blur(); return; } t.value=''; stepGrow(t); addStepLines(tid, [v]); haptic(6); return; } // the field stays focused: the keyboard stays for the next one
    const row=t.closest('.step'); if(!v){ t.blur(); return; } // Intro on an empty step ends the writing (leaving it deletes it)
    if(row.dataset.st){ const s=stepRec(row.dataset.st); if(s&&s.title!==v){ s.title=v; s.modified=new Date().toISOString(); save(); } else flushEdits(); }
    // Intro adds the next step: a new row right after this one, focused at once inside this key press so the keyboard stays (point 18)
    let next=row.nextElementSibling; if(next&&next.classList.contains('step-add')){ stepFocusEnd(next.querySelector('.stepin')); return; }
    const d=htmlEl(stepRowHTML({id:'', title:'', done:false})); stepOwn(()=>row.after(d)); stepBindRow(d); d.querySelector('.stepin').focus(); return; }
  // Desktop: the selected step (its row focused) takes Supr, Espacio, Intro, the arrows and Esc, before the keys of the list
  const row=t.classList&&t.classList.contains('step')&&t.dataset.st?t:null; if(!row) return; const k=e.key, sid=row.dataset.st;
  const rows=()=>[...box.querySelectorAll(':scope > .step[data-st]')], i=rows().indexOf(row);
  const stop=()=>{ e.preventDefault(); e.stopPropagation(); };
  const rowOf=id=>document.querySelector('.steps[data-steps="'+CSS.escape(tid)+'"] .step[data-st="'+CSS.escape(id)+'"]'); // the inspector may have been drawn again meanwhile
  if(k==='Delete'||k==='Backspace'){ stop(); const rs=rows(), to=rs[i+1]||rs[i-1], toId=to&&to.dataset.st; deleteStep(sid); const n=toId&&rowOf(toId); if(n) n.focus(); }
  else if(k===' '){ stop(); toggleStep(sid); }
  else if(k==='Enter'){ stop(); const ta=row.querySelector('.stepin'); if(ta) stepFocusEnd(ta); }
  else if(k==='Escape'){ stop(); row.blur(); }
  else if((k==='ArrowUp'||k==='ArrowDown')&&!e.metaKey&&!e.ctrlKey&&!e.shiftKey){ stop(); const d=k==='ArrowUp'?-1:1;
    if(e.altKey){ if(reorderStep(sid, i+d)){ const n=rowOf(sid); if(n) n.focus(); } return; }
    const n=rows()[i+d]; if(n) n.focus(); } }
// Leaving a field: an empty step goes (a new one quietly, one that had a title with Deshacer), a draft without text goes, and the text
// left in Añadir paso becomes a step, so nothing typed is lost. The window losing the focus leaves everything as it is
function stepLeave(e){ const ta=e.target; if(!ta.classList||!ta.classList.contains('stepin')||deskRedraw) return;
  setTimeout(()=>{ if(!ta.isConnected||document.activeElement===ta) return; const box=stepBox(ta); if(!box) return; const v=ta.value.replace(/\s+/g,' ').trim();
    if(ta.dataset.role==='stepadd'){ if(v){ ta.value=''; stepGrow(ta); addStepLines(box.dataset.steps, [v]); } return; }
    const row=ta.closest('.step'); if(!row) return;
    if(!row.dataset.st){ if(openVn===row) openVn=null; stepOwn(()=>row.remove()); return; }
    const s=stepRec(row.dataset.st); if(!s) return;
    if(!v){ deleteStep(s.id, !!row._fresh); return; }
    if(s.title!==v){ s.title=v; s.modified=new Date().toISOString(); save(); }
    else flushEdits();
    if(ta.value!==s.title){ ta.value=s.title; stepGrow(ta); } row._fresh=false; }, 0); }
function stepPaste(e){ const ta=e.target; if(!ta.classList||!ta.classList.contains('stepin')) return; const text=e.clipboardData&&e.clipboardData.getData('text'); if(!text||!/\n/.test(text.trim())) return;
  e.preventDefault(); const ls=pasteLines(text);
  if(ta.dataset.role==='stepadd'){ const box=stepBox(ta), cur=ta.value.replace(/\s+/g,' ').trim(); ta.value=''; stepGrow(ta); if(cur) ls.unshift(cur); addStepLines(box.dataset.steps, ls); return; }
  // In a step's own title the lines join into one
  const s=ta.selectionStart, en=ta.selectionEnd; ta.setRangeText(ls.join(' '), s, en, 'end'); ta.dispatchEvent(new Event('input', {bubbles:true})); }

/* ---------- Moving a step: the row is lifted and follows the pointer, the others make room; a fade with Reduce Motion ---------- */
function stepDrag(el){ const box=el.parentElement, rows=[...box.querySelectorAll(':scope > .step[data-st]')], i0=rows.indexOf(el); if(i0<0) return null;
  const rects=rows.map(r=>r.getBoundingClientRect()), h=rects[i0].height, mid=j=>rects[j].top+rects[j].height/2; let k=i0;
  el.classList.add('lifted'); box.classList.add('sorting'); haptic(15);
  return { move(dy){ el.style.transform='translate3d(0,'+dy+'px,0)'+(RM.matches?'':' scale(1.02)'); const c=mid(i0)+dy; let n=i0;
      for(let j=i0+1;j<rows.length;j++) if(c>mid(j)) n=j; for(let j=i0-1;j>=0;j--) if(c<mid(j)) n=j;
      if(n!==k){ k=n; haptic(4); } rows.forEach((r,j)=>{ if(j===i0) return; const s=(j>i0&&j<=k)?-h:(j<i0&&j>=k)?h:0; r.style.transform=s?'translate3d(0,'+s+'px,0)':''; }); },
    end(apply){ box.classList.remove('sorting'); el.classList.remove('lifted'); rows.forEach(r=>{ r.style.transform=''; }); if(apply&&k!==i0) reorderStep(el.dataset.st, k); } }; } // the transitions go first: the rows are already where the new order puts them
// iPhone: swipe left for Eliminar (it stops there, as the voice notes); a long press lifts the step and the same finger moves it
function bindStepGestures(el){ if(el._stb||!el.querySelector('.vn-bg')) return; el._stb=1; let c=null, x0=0, y0=0, dx=0, mode=null, edge=false, lp=null, drag=null, sc=null, st0=0, lastY=0, raf=0;
  const tick=()=>{ if(mode!=='lift') return; const b=sc.getBoundingClientRect(); let v=0; if(lastY<b.top+60) v=-Math.ceil((b.top+60-lastY)/6); else if(lastY>b.bottom-60) v=Math.ceil((lastY-b.bottom+60)/6);
    if(v){ sc.scrollTop+=v; drag.move(lastY-y0+sc.scrollTop-st0); } raf=requestAnimationFrame(tick); };
  el.addEventListener('touchstart', e=>{ c=el.querySelector('.vn-c'); mode=null; dx=0; clearTimeout(lp); if(!c||e.touches.length>1||!el.dataset.st){ mode='off'; return; }
    const ta=el.querySelector('.stepin'); if(e.target.closest('.vn-bg')||(ta&&document.activeElement===ta&&e.target===ta)){ mode='off'; return; } // its Eliminar button, or a title being edited (the caret moves there)
    const t=e.touches[0]; x0=t.clientX; y0=lastY=t.clientY; edge=x0<EDGE; if(openVn&&openVn!==el) closeVn(openVn); if(openRow) closeRow(openRow);
    lp=setTimeout(()=>{ if(mode!==null||el.dataset.open) return; drag=stepDrag(el); if(!drag) return; mode='lift'; dragStart(); sc=el.closest('.scroll'); st0=sc?sc.scrollTop:0; if(sc) raf=requestAnimationFrame(tick); }, 500); }, {passive:true});
  el.addEventListener('touchmove', e=>{ const t=e.touches[0], mx=t.clientX-x0, my=t.clientY-y0;
    if(mode==='lift'){ if(e.cancelable) e.preventDefault(); lastY=t.clientY; drag.move(my+(sc?sc.scrollTop-st0:0)); return; }
    if(mode===null){ if(Math.abs(my)>8){ mode='scroll'; clearTimeout(lp); } else if(Math.abs(mx)>10){ clearTimeout(lp); if(edge){ mode='edge'; return; } mode='swipe'; c.classList.add('drag'); } }
    if(mode!=='swipe') return; if(e.cancelable) e.preventDefault();
    let raw=(el.dataset.open==='l'?-88:0)+mx; if(raw<-88) raw=-88+(raw+88)*0.15; if(raw>0) raw=raw*0.15;
    dx=Math.max(-104, Math.min(12, raw)); c.style.transform='translate3d('+dx+'px,0,0)'; el.classList.toggle('dir-l', dx<0); }, {passive:false});
  const end=e=>{ clearTimeout(lp); const was=mode; mode=null;
    if(was==='lift'){ cancelAnimationFrame(raf); if(e.cancelable) e.preventDefault(); drag.end(e.type==='touchend'); drag=null; dragEnd(true); return; } // lifting the finger must not click the step open
    if(was!=='swipe') return; c.classList.remove('drag');
    if(dx<-50){ c.style.transform='translate3d(-88px,0,0)'; el.dataset.open='l'; openVn=el; } else closeVn(el); };
  el.addEventListener('touchend', end, {passive:false}); el.addEventListener('touchcancel', end); }
// Desktop: the handle that shows on hover moves the step (pointer events, as the sidebar's projects); Esc cancels
function stepGripDown(e){ const g=e.target.closest('.sgrip'); if(!g||e.button!==0||e.pointerType==='touch') return; const el=g.closest('.step[data-st]'); if(!el) return; e.preventDefault();
  const y0=e.clientY, pid=e.pointerId; let drag=null;
  const mv=ev=>{ const dy=ev.clientY-y0; if(!drag){ if(Math.abs(dy)<4) return; drag=stepDrag(el); if(!drag) return; document.body.classList.add('sdragging'); } drag.move(dy); };
  const fin=apply=>{ g.removeEventListener('pointermove', mv); g.removeEventListener('pointerup', up); g.removeEventListener('pointercancel', cancel); window.removeEventListener('keydown', esc, true);
    try{ g.releasePointerCapture(pid); }catch(err){} document.body.classList.remove('sdragging'); if(drag){ const d=drag; drag=null; d.end(apply); } else if(apply) el.focus(); }; // a click on the handle without moving selects the step
  const up=()=>fin(true), cancel=()=>fin(false), esc=ev=>{ if(ev.key!=='Escape') return; ev.preventDefault(); ev.stopPropagation(); fin(false); };
  try{ g.setPointerCapture(pid); }catch(err){} g.addEventListener('pointermove', mv); g.addEventListener('pointerup', up); g.addEventListener('pointercancel', cancel); window.addEventListener('keydown', esc, true); }
