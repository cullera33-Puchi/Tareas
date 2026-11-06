'use strict';
/* Tareas. Sheets and flows: selection, close the day, reviews, view options, quick add, project and space sheets, calendar, pickers, plan, voice notes, share, local backups, export and import, test data.
   A classic script: index.html loads every file of js/ in order and they share their global names. Only declarations and
   listeners run at load; the start itself (first screen, timers, sync, service worker) is in boot.js, the last file. */
/* Multi-select: entered from the long-press menu; a bottom bar replaces the tab bar */
function renderSelbar(){ const n=UI.select?UI.select.ids.size:0; const b=(act,ic,l,red)=>'<button data-act="'+act+'"'+(n?'':' disabled')+(red?' class="red"':'')+'>'+ic+'<span>'+l+'</span></button>'; $('#selbar').innerHTML=b('bulkComplete',I.check,'Completar')+b('bulkPostpone',I.cal,'Aplazar')+b('bulkMove',I.folder,'Mover')+(n&&bulkRemindOn()?b('bulkRemind',MI.send,'Recordar'):'')+b('bulkDelete',I.trash,'Eliminar',true); } // decision 48c: Recordar when every selected task has the same person
function startSelect(id){ flushHeld(true); const top=UI.stack[UI.stack.length-1]; UI.select={scope: top&&(top.kind==='project'||top.kind==='person')?'project':'root', ids:new Set(id?[id]:[]), all:false}; if(openRow) closeRow(openRow); app.classList.add('selecting'); render(); renderSelbar(); haptic(6); }
function endSelect(){ if(UI.wide){ endDeskSelect(); return; } UI.select=null; app.classList.remove('selecting'); render(); } // the desktop's own selection (R16) ends the same way
function visibleRowIds(){ const scr=UI.select.scope==='project'?UI.stack[UI.stack.length-1].el:rootScreen('tareas'); return [...scr.querySelectorAll('.scroll .row[data-id], .scroll .rph[data-id]')].filter(r=>!r.closest('.first')).map(r=>r.dataset.id); } // rows of a long list not drawn yet count too
function updateSelectUI(){ const n=UI.select.ids.size; const t=$('#selTitle'); if(t) t.textContent=n?n+(n===1?' seleccionada':' seleccionadas'):'Seleccionar'; const b=$('[data-act=selAll]'); if(b) b.textContent=UI.select.all?'Ninguna':'Todas'; renderSelbar(); } // the label always says what a tap will do
function toggleSelected(row){ const id=row.dataset.id; if(UI.select.ids.has(id)){ UI.select.ids.delete(id); row.classList.remove('selected'); } else { UI.select.ids.add(id); row.classList.add('selected'); } const vis=visibleRowIds(); UI.select.all=vis.length>0&&vis.every(i=>UI.select.ids.has(i)); haptic(4); updateSelectUI(); }
function selectAllVisible(){ const ids=visibleRowIds(); if(UI.select.all){ UI.select.ids.clear(); UI.select.all=false; } else { ids.forEach(i=>UI.select.ids.add(i)); UI.select.all=true; } render(); renderSelbar(); }
// The selected ids: the iPhone's selection mode or, on the desktop, its multiple selection (R16), which the same bulk actions use
function selSet(){ return UI.wide ? (deskMulti()?UI.dsel.ids:null) : UI.select ? UI.select.ids : null; }
function selectedTasks(){ const s=selSet(); return s ? [...s].map(task).filter(Boolean) : []; } // empty once selection mode has ended
function bulkComplete(){ const xs=selectedTasks(); if(!xs.length) return; const prev=xs.filter(isOpen).map(doneSnap); let nx=null; batch(()=>xs.forEach(x=>{ const r=applyDone(x.id, true); if(r) nx=r; })); const n=prev.length; log('info','Completadas en bloque: '+n); endSelect(); toast(doneText(n, nx), ()=>batch(()=>prev.forEach(undoDone))); } // decision 38: applyDone makes the next task of each series
/* Decision 38: deleting tasks that repeat asks first (askRepeatDelete): "solo estas" move each one to the next date of its series and delete
   the others; "las series" delete them all. One Deshacer for everything */
function bulkDelete(){ const xs=selectedTasks(); if(!xs.length) return; const rep=xs.filter(x=>isOpen(x)&&repGoesOn(x)); // decision 65e: the last one of a series that ends is deleted as any other
  const run=only=>{ const skip=only?rep:[], ids=new Set(xs.filter(x=>!skip.includes(x)).map(x=>x.id)); let undoS=[], removedT=[], removedV=[], removedA=[], removedS=[];
    batch(()=>{ undoS=skip.map(x=>skipOccurrence(x.id, true)).filter(Boolean); removedT=DB.tasks.filter(x=>ids.has(x.id)); removedV=DB.voiceNotes.filter(v=>ids.has(v.taskId)); DB.tasks=DB.tasks.filter(x=>!ids.has(x.id)); DB.voiceNotes=DB.voiceNotes.filter(v=>!ids.has(v.taskId)); removedA=cutAttachments(ids); removedS=cutSteps(ids); save(); });
    log('info','Eliminadas en bloque: '+removedT.length+(undoS.length?', '+undoS.length+' pasadas a su siguiente fecha':'')); endSelect(); haptic(14);
    const parts=[]; if(removedT.length) parts.push(removedT.length+(removedT.length===1?' tarea eliminada':' tareas eliminadas')); if(undoS.length) parts.push(undoS.length+(undoS.length===1?' pasada a su siguiente fecha':' pasadas a su siguiente fecha'));
    toast(parts.join(', '), ()=>batch(()=>{ undoS.forEach(u=>u()); DB.tasks.push(...removedT); DB.voiceNotes.push(...removedV); putAttachments(removedA); putSteps(removedS); save(); })); };
  if(rep.length){ askRepeatDelete({n:xs.length, rep:rep.length}, ()=>run(true), ()=>run(false)); return; }
  confirmSheet('Eliminar '+xs.length+(xs.length===1?' tarea':' tareas'), 'Podrás deshacerlo durante unos segundos.', ()=>run(false)); }
function bulkReschedule(date, label){ const xs=selectedTasks(); if(!xs.length) return; const prev=xs.map(daySnap); batch(()=>xs.forEach(x=>updTask(x.id, dayPatch(x, date)))); endSelect(); toast(xs.length+(xs.length===1?' tarea aplazada a ':' tareas aplazadas a ')+label, ()=>batch(()=>prev.forEach(undoDay))); }
function bulkPostponeSheet(src){ const sel=selSet(); if(!sel||!sel.size) return; const t=todayStr(); const opts=uniqueBy([['Mañana',addDays(t,1)],['Fin de semana',weekendDay()],['Próxima semana',nextWeekday(1,true)],['En una semana',addDays(t,7)]], o=>o[1]);
  popMenu({anchor:src, align:UI.wide?'left':undefined, title:'Aplazar '+sel.size+(sel.size===1?' tarea':' tareas'), groups:[opts.map(([l,d])=>dateItem(l, d, ()=>bulkReschedule(d,l.toLowerCase()))), [dateItem('Sin fecha', null, ()=>bulkReschedule(null,'sin fecha'))]]}); }
function bulkMoveSheet(src){ const sel=selSet(); if(!sel||!sel.size) return; const ps=activeProjects(); const n=sel.size;
  const dot=c=>'<span class="pm-dot" style="background:'+c+'"></span>'; popMenu({anchor:src, align:UI.wide?'left':undefined, title:'Mover '+n+(n===1?' tarea':' tareas'), groups:[[{label:'Sin proyecto', icon:dot('var(--ink3)'), fn:()=>bulkMove(null)}].concat(ps.map(p=>({label:p.name, icon:dot(p.color), fn:()=>bulkMove(p.id)})))]}); }
function bulkMove(projectId){ const xs=selectedTasks(); if(!xs.length) return; const prev=xs.map(x=>({id:x.id, projectId:x.projectId})); batch(()=>xs.forEach(x=>updTask(x.id,{projectId}))); const p=projectId?proj(projectId):null; endSelect(); toast(xs.length+(xs.length===1?' tarea movida a ':' tareas movidas a ')+(p?p.name:'Sin proyecto'), ()=>batch(()=>prev.forEach(q=>updTask(q.id,{projectId:q.projectId})))); }
function rescheduleMany(xs, date, label){ if(!xs.length) return; const prev=xs.map(daySnap); batch(()=>xs.forEach(x=>updTask(x.id, dayPatch(x, date)))); renderAnimated(); haptic(8); log('info','Aplazadas en bloque: '+xs.length+' a '+date); toast(xs.length+(xs.length===1?' tarea ':' tareas ')+(date?(xs.length===1?'pasada a ':'pasadas a ')+label:'sin fecha'), ()=>batch(()=>prev.forEach(undoDay))); }
// What tomorrow starts with, in the active space: "Mañana empieza con 6 tareas, 2 prioritarias"
function tomorrowLine(){ const tm=addDays(todayStr(),1), xs=spaceTasks().filter(x=>x.status==='pending'&&(x.date===tm||(x.deadline===tm&&!(x.date&&x.date<=tm)))), /* decision 48a: a deadline tomorrow brings it too */ p=xs.filter(x=>x.priority==='high').length;
  return xs.length ? 'Mañana empieza con '+xs.length+(xs.length===1?' tarea':' tareas')+(p?', '+p+(p===1?' prioritaria':' prioritarias'):'')+'.' : 'Mañana empieza sin tareas.'; }
/* R8: close the day. What was done today, what is left and three ways out: all to tomorrow, only the non-priority ones,
   or one by one (the review walk). Each bulk move has its Deshacer (rescheduleMany); the foot says what tomorrow starts with */
/* Closing the day on every device (owner, 3 November): each way out also sets the space's closedDay (setClosedDay), so Hoy turns to tomorrow
   here and on the other devices once they sync; with nothing left the sheet offers just Cerrar el día. Deshacer opens it again */
/* Decision 65e: a task of a series that does not pile up goes to its next occurrence from tomorrow on (rollTarget), not to tomorrow when
   tomorrow is not one, and that is no postponing; Deshacer puts back its rule too (its count of occurrences) */
function closeDayMove(xs, how){ const tm=addDays(todayStr(),1), prev=xs.map(x=>Object.assign(daySnap(x), {repeat:x.repeat||null, deadline:x.deadline||null})); let nk=0;
  batch(()=>{ xs.forEach(x=>{ const s=rollTarget(x, tm); if(s){ updTask(x.id, skipPatch(x, s)); if(s.date!==tm) nk++; } else updTask(x.id, dayPatch(x, tm)); }); setClosedDay(true, how); }); renderAnimated(); haptic(8); if(xs.length) log('info','Aplazadas en bloque: '+xs.length+' a '+tm+(nk?', '+nk+' a su siguiente fecha':''));
  const nt=xs.length-nk, parts=[]; if(nt) parts.push(nt+(nt===1?' tarea pasada':' tareas pasadas')+' a mañana'); if(nk) parts.push(nk+(nk===1?' a su siguiente fecha':' a su siguiente fecha'));
  if(nk&&!nt) parts[0]=nk+(nk===1?' tarea pasada':' tareas pasadas')+' a su siguiente fecha';
  toast((parts.length?parts.join(', ')+', día cerrado':'Día cerrado'), ()=>batch(()=>{ prev.forEach(o=>{ const x=task(o.id); undoDay(o); if(x&&(x.repeat||null)!==o.repeat) updTask(o.id, {repeat:o.repeat}); if(x&&(x.deadline||null)!==o.deadline) updTask(o.id, {deadline:o.deadline}); }); setClosedDay(false, 'Deshacer'); })); }
function reopenDay(){ if(!isClosed()) return; setClosedDay(false, 'Reabrir hoy'); haptic(6); renderAnimated(); toast('Día reabierto', ()=>setClosedDay(true, 'Deshacer')); }
function closeDaySheet(){ flushHeld(true); const t=todayStr(), tm=addDays(t,1); const hoy=pendingFor('hoy'); if(isClosed()) return;
  const due=hoy.filter(dlDue), mov=hoy.filter(x=>!dlDue(x)); // decision 48a: a task whose deadline has come stays in Hoy; moving its work date would only pull it earlier
  const high=hoy.filter(x=>x.priority==='high'), rest=mov.filter(x=>x.priority!=='high'), movHigh=mov.filter(x=>x.priority==='high');
  const done=spaceTasks().filter(x=>x.status==='done'&&x.completed&&localDay(x.completed)===t).sort((a,b)=>a.completed<b.completed?-1:1);
  const li=(x,d)=>'<div class="pl"><span class="t">'+esc(x.title||'Sin título')+'</span>'+(d?'':x.priority==='high'?'<span class="pri high">!!!</span>':x.priority==='mid'?'<span class="pri mid">!!</span>':'')+'</div>';
  const n=k=>k+(k===1?' tarea':' tareas');
  openSheet('<h2>Cerrar el día</h2><div class="cdnums"><div><b>'+done.length+'</b><span>'+(done.length===1?'hecha':'hechas')+' hoy</span></div><div><b>'+hoy.length+'</b><span>'+(hoy.length===1?'queda':'quedan')+'</span></div><div class="'+(high.length?'red':'')+'"><b>'+high.length+'</b><span>prioritarias</span></div></div>'+
    (hoy.length?'<div class="plhead"><span>Queda</span></div><div class="plist cdlist">'+hoy.map(x=>li(x)).join('')+'</div>':'')+
    (done.length?'<div class="plhead"><span>Hecho hoy</span></div><div class="plist cdlist done">'+done.map(x=>li(x,true)).join('')+'</div>':'')+
    '<div class="list cdacts">'+(mov.length?'<button class="cell" data-cd="all"><span class="lbl">Todo a mañana</span><span class="val">'+n(mov.length)+'</span></button>':'')+
    (movHigh.length&&rest.length?'<button class="cell" data-cd="rest"><span class="lbl">Solo las no prioritarias</span><span class="val">'+n(rest.length)+'</span></button>':'')+
    (hoy.length?'<button class="cell" data-cd="one"><span class="lbl">Decidir una a una</span>'+I.chev.replace('<svg','<svg class="chev"')+'</button>':'')+(mov.length?'':'<button class="cell" data-cd="close"><span class="lbl">Cerrar el día</span></button>')+'</div>'+
    (mov.some(x=>{ const r=rollTarget(x, tm); return r&&r.date!==tm; })?'<div class="hint cdfoot">Las que se repiten sin acumularse pasan a su siguiente fecha.</div>':'')+ // decision 65e
    (due.length?'<div class="hint cdfoot">'+(due.length===1?'La tarea con entrega hoy o vencida se queda en Hoy.':'Las '+due.length+' tareas con entrega hoy o vencida se quedan en Hoy.')+'</div>':'')+'<div class="hint cdfoot">'+tomorrowLine()+'</div>', s=>{
    s.onclick=e=>{ const b=e.target.closest('[data-cd]'); if(!b) return; const k=b.dataset.cd;
      if(k==='one'){ reviewStart('close'); return; }
      closeSheet(); closeDayMove(k==='all'?mov:k==='rest'?rest:[], k==='all'?'Cerrar el día, todo a mañana':k==='rest'?'Cerrar el día, las no prioritarias':'Cerrar el día'); }; }); }
/* R9 and R8: review tasks one by one. 'carried': the Aplazadas of Hoy (under the project filter, as the list shows them);
   'close': all of Hoy, from Cerrar el día. Each decision applies at once, so the list behind stays current;
   the balance at the end has one Deshacer for all of them. Decision 56b: a task that keeps being put off says so under its title ("Aplazada
   4 veces", "Desde el martes 27") and is offered Partir en pasos, which ends the walk there (the rest counts as skipped) and opens the task
   with Añadir paso ready, inside the same tap so the iPhone keyboard comes up (decision 18) */
/* Decision 60b: kind 'forgot' walks the forgotten tasks of Sin fecha (isForgot) with the same steps: a quick day or one of the calendar,
   Completar, Eliminar, Saltar, Terminar, and the balance with Deshacer. It offers no Sin fecha: they have none already */
function reviewStart(kind){ flushHeld(true); let xs=kind==='carried'?pendingFor('hoy').filter(carriedOn):kind==='forgot'?pendingFor('todas').filter(isForgot):pendingFor('hoy');
  if(kind!=='close'&&filterOn()) xs=xs.filter(passFilter); // the project filter and the responsible's (decision 48c)
  if(!xs.length) return; log('info', kind==='carried'?'Repasar aplazadas':kind==='forgot'?'Repasar olvidadas':'Cerrar el día una a una', {n:xs.length});
  reviewStep(xs.map(x=>x.id), 0, {kind, prev:new Map(), removed:[], tally:{}}); }
const REVIEW_OUT=[['hoy','para hoy','para hoy'],['man','a mañana','a mañana'],['vie','al viernes','al viernes'],['nsem','a la próxima semana','a la próxima semana'],['none','sin fecha','sin fecha'],['done','completada','completadas'],['del','eliminada','eliminadas'],['cal','a otro día','a otro día'],['skip','saltada','saltadas']];
function reviewStep(ids, i, st){
  if(i>=ids.length){ sheetOnClose=null; reviewEnd(st, true); return; }
  const x=task(ids[i]); if(!x||x.status!=='pending'){ reviewStep(ids, i+1, st); return; } // completed or removed meanwhile
  const t=todayStr(), fg=st.kind==='forgot'; const opts=uniqueBy([['hoy',t,'Hoy'],['man',addDays(t,1),'Mañana'],['vie',nextWeekday(5,true),'Viernes'],['nsem',nextWeekday(1,true),'Próxima semana']], o=>o[1]).concat(fg?[]:[['none',null,'Sin fecha']]);
  let ym=t.slice(0,7); // decision 60b: the forgotten ones may take any day of the calendar too
  const p=x.projectId?proj(x.projectId):null; const tally=k=>{ st.tally[k]=(st.tally[k]||0)+1; };
  const keep=()=>{ if(!st.prev.has(x.id)) st.prev.set(x.id, Object.assign({date:x.date, carried:x.carried, reminder:x.reminder||null, status:x.status, completed:x.completed, postponed:x.postponed||null, carriedSince:x.carriedSince||null}, x.focus?{focus:x.focus}:{}, x.repeat?{repeat:x.repeat}:{})); }; // decision 65e: Eliminar solo esta moves the count of a series on; // decision 56b: the counters too
  const next=()=>{ haptic(6); render(); reviewStep(ids, i+1, st); };
  const dg=dragText(x);
  openSheet('<h2>'+(st.kind==='close'?'Cerrar el día':fg?'Repasar olvidadas':'Repasar aplazadas')+'</h2><div class="hint" style="margin-top:-6px">'+(i+1)+' de '+ids.length+(p?', '+esc(p.name):'')+'</div><div class="plan-title">'+esc(x.title||'Sin título')+'</div>'+(dg?'<div class="rvdrag">'+esc(dg)+'</div>':'')+
    (fg?'<div class="hint rvsince">'+esc(forgotSince(x))+'</div>':'')+
    '<div class="chips rvchips">'+opts.map(o=>'<button class="chip" data-rv="'+o[0]+'">'+o[2]+'</button>').join('')+'</div>'+(fg?'<div id="calwrap">'+calendarHTML(ym, null)+'</div>':'')+
    '<div class="sheet-actions"><button class="btn" data-x="done">'+I.check+'Completar</button><button class="btn redtext" data-x="del">'+I.trash+'Eliminar</button></div>'+
    (dg?'<div class="sheet-actions" style="margin-top:10px"><button class="btn" data-x="split">'+I.list+'Partir en pasos</button></div>':'')+
    '<div class="sheet-actions" style="margin-top:10px"><button class="btn" data-x="skip">Saltar</button><button class="btn" data-x="end">Terminar</button></div>', s=>{
    sheetOnClose=()=>{ st.tally.skip=(st.tally.skip||0)+ids.length-i; reviewEnd(st, false); }; // closed with a tap outside or a drag: as Terminar, the balance as a toast
    s.onclick=e=>{ const nav=e.target.closest('[data-cal]'); if(nav){ ym=shiftMonth(ym,+nav.dataset.cal); $('#calwrap',s).innerHTML=calendarHTML(ym, null); return; }
      const cd=e.target.closest('[data-d]'); if(cd&&cd.dataset.d){ keep(); updTask(x.id, dayPatch(x, cd.dataset.d, {carried:false})); const o=opts.find(q=>q[1]===cd.dataset.d); tally(o?o[0]:'cal'); next(); return; }
      const c=e.target.closest('[data-rv]'); if(c){ const o=opts.find(q=>q[0]===c.dataset.rv); keep(); updTask(x.id, dayPatch(x, o[1], {carried:false})); tally(o[0]); next(); return; } // Hoy confirms the task and clears its Aplazada mark
      const b=e.target.closest('[data-x]'); if(!b) return; const k=b.dataset.x;
      if(k==='done'){ keep(); applyDone(x.id, true); tally('done'); next(); }
      else if(k==='del'){ const go=()=>{ const j=DB.tasks.indexOf(x); if(j>=0){ DB.tasks.splice(j,1); const vn=DB.voiceNotes.filter(v=>v.taskId===x.id); DB.voiceNotes=DB.voiceNotes.filter(v=>v.taskId!==x.id); st.removed.push({x, vn, at:cutAttachments(new Set([x.id])), ss:cutSteps(new Set([x.id]))}); save(); } tally('del'); haptic(10); next(); };
        if(repGoesOn(x)) askRepeatDelete({n:1, title:x.title}, ()=>{ keep(); skipOccurrence(x.id, true); tally('del'); haptic(10); next(); }, go); else go(); } // decision 38: only this one, or the series
      else if(k==='skip'){ tally('skip'); reviewStep(ids, i+1, st); }
      else if(k==='split'){ st.tally.skip=(st.tally.skip||0)+ids.length-i-1; sheetOnClose=null; closeSheet(); reviewEnd(st, false); log('info','Partir en pasos desde el repaso'); openStepAdd(x.id); }
      else { st.tally.skip=(st.tally.skip||0)+ids.length-i; sheetOnClose=null; reviewEnd(st, true); } }; });
}
// Decision 60b: how long a forgotten task has been still, "Sin cambios desde el 2 de octubre"
function forgotSince(x){ const d=localDay(x.modified||x.created||new Date().toISOString()), dd=new Date(d+'T00:00:00'), t=todayStr();
  return 'Sin cambios desde el '+dd.getDate()+' de '+MESES_FULL[dd.getMonth()]+(d.slice(0,4)!==t.slice(0,4)?' de '+d.slice(0,4):''); }
// Decision 56b: the task open (the detail on the iPhone, the inspector on the desktop) with the focus in Añadir paso, at once: called inside a tap
function openStepAdd(id){ if(!task(id)) return; openDetail(id); const scope=UI.wide?$('#desk .pane'):(UI.stack.length?UI.stack[UI.stack.length-1].el:null);
  const ta=scope&&scope.querySelector('[data-role=stepadd]'); if(!ta) return false;
  ta.focus({preventScroll:true}); // the detail is still sliding in: a plain focus would scroll the screens around it; its own list scrolls instead
  const sc=ta.closest('.scroll'); if(sc){ const a=sc.getBoundingClientRect(), b=ta.getBoundingClientRect(); if(b.bottom>a.bottom-24||b.top<a.top) sc.scrollTop+=b.top-a.top-Math.round(a.height/3); }
  return true; }
// Deshacer of a review: a task completed in it takes back the next one of its series (decision 38)
function reviewEnd(st, asSheet){ const T=st.tally, decided=Object.keys(T).some(k=>k!=='skip'&&T[k]);
  const closing=st.kind==='close'&&asSheet; if(closing) setClosedDay(true, 'Cerrar el día una a una'); // walked to its end or Terminar: the day is closed; a sheet dismissed is not
  const undo=()=>batch(()=>{ if(closing) setClosedDay(false, 'Deshacer'); st.prev.forEach((o,id)=>{ const x=task(id); if(!x) return; if(x.status==='done'&&o.status!=='done') dropNext(x); updTask(id, o); }); st.removed.forEach(r=>{ if(!task(r.x.id)){ DB.tasks.push(r.x); DB.voiceNotes.push(...r.vn); putAttachments(r.at); putSteps(r.ss); } }); save(); });
  const parts=REVIEW_OUT.filter(o=>T[o[0]]).map(o=>T[o[0]]+' '+(T[o[0]]===1?o[1]:o[2]));
  log('info', st.kind==='carried'?'Repaso de aplazadas':st.kind==='forgot'?'Repaso de olvidadas':'Día cerrado una a una', T);
  if(!decided){ if(asSheet) closeSheet(); renderAnimated(); if(closing) toast('Día cerrado', ()=>setClosedDay(false, 'Deshacer')); return; }
  renderAnimated();
  if(!asSheet){ toast(parts.join(', '), undo); return; }
  openSheet('<h2>'+(st.kind==='close'?'Día cerrado':'Repaso terminado')+'</h2><div class="list">'+REVIEW_OUT.filter(o=>T[o[0]]).map(o=>'<div class="cell"><span class="lbl">'+(o[0]==='done'||o[0]==='del'||o[0]==='skip'?o[2][0].toUpperCase()+o[2].slice(1):o[1][0].toUpperCase()+o[1].slice(1))+'</span><span class="val">'+T[o[0]]+'</span></div>').join('')+'</div>'+
    '<div class="hint cdfoot">'+tomorrowLine()+'</div><div class="sheet-actions"><button class="btn" data-x="undo">Deshacer</button><button class="btn primary" data-x="ok">Listo</button></div>', s=>{
    s.onclick=e=>{ const b=e.target.closest('[data-x]'); if(!b) return; closeSheet(); if(b.dataset.x==='undo'){ undo(); renderAnimated(); toast(st.kind==='close'?'Cierre deshecho':'Repaso deshecho'); } }; }); }
/* R13: the view options, from the three dots of the Tareas bar (and of a project) on the iPhone and of the column head on the desktop */
function setGrouping(key, g){ if(DB.settings[key]===g) return; DB.settings[key]=g; save(); haptic(4); renderAnimated(); }
function spaceMenu(src){ const pickSpace=s=>{ DB.settings.activeSpace=s.id; save(); resetListState();
    if(UI.wide){ UI.deskDetail=null; if(UI.deskView.startsWith('project:')&&UI.deskView!=='project:none'||UI.deskView.startsWith('person:')&&!personRemindable(UI.deskView.slice(7)).length) UI.deskView=DB.settings.filter||'hoy'; } // decision 65a: a person with nothing in the new space leaves too // the other space's project and task never stay on screen
    render(); };
  const sps=DB.spaces.slice().sort((a,b)=>a.order-b.order);
  popMenu({anchor:src, align:'left', groups:[sps.map(s=>({label:s.name, on:s.id===space().id, fn:()=>pickSpace(s)})), [{label:'Nuevo espacio', icon:MI.plus, fn:()=>spaceSheet(null)}]]}); }
function viewMenu(src){ const top=UI.stack[UI.stack.length-1]; const inProject=UI.wide?UI.deskView.startsWith('project:'):!!(top&&top.kind==='project');
  const f=inProject?null:UI.wide?UI.deskView:DB.settings.filter; const k=f==='hoy'?'hoyGroup':'allGroup', g=DB.settings[k]==='project'?'project':'date';
  // R10 and R17: an anchored menu, the grouping as a checked pair. On the desktop Seleccionar tareas starts its own selection (R16)
  popMenu({anchor:src, align:UI.wide?'right':undefined, groups:[
    [{label:'Seleccionar tareas', icon:MI.select, fn:()=>UI.wide?startDeskSelect():startSelect(null)}].concat([{label:DB.settings.doneOpen?'Ocultar completadas':'Mostrar completadas', icon:DB.settings.doneOpen?MI.eyeOff:MI.eye, fn:()=>{ DB.settings.doneOpen=!DB.settings.doneOpen; save(); render(); }}]),
    f==='hoy'||f==='todas'?[{label:'Agrupar por fecha', icon:MI.cal, on:g==='date', fn:()=>setGrouping(k,'date')}, {label:'Agrupar por proyecto', icon:MI.folder, on:g==='project', fn:()=>setGrouping(k,'project')}]:[],
    f==='hoy'?[{label:'¿Qué hago ahora?', icon:MI.bulb, fn:()=>suggestSheet(src)}]:[], // decision 56c
    statusItems(inProject?(UI.wide?UI.deskView.slice(8):top.id):undefined) ]}); }
// Roadmap M4: Compartir estado for a real project (pid), Compartir estado de la semana for the space (pid undefined); nothing for Sin proyecto
const statusItems = pid => pid===undefined ? [{label:UI.wide?'Compartir estado de la semana…':'Compartir estado de la semana', icon:MI.share, fn:()=>statusSheet(null)}]
  : pid&&proj(pid) ? [{label:UI.wide?'Compartir estado…':'Compartir estado', icon:MI.share, fn:()=>statusSheet(pid)}] : [];
/* R14: a day header of Todas. A long press (iPhone) or a right click (desktop, at the pointer: pt) offers to move its tasks to another day */
function dayHeadMenu(head, pt){ const sec=head.closest('.gsec'), day=head.dataset.dayHead; if(!sec||UI.select) return;
  const xs=[...sec.querySelectorAll('.group [data-id]')].map(r=>task(r.dataset.id)).filter(x=>x&&x.status==='pending'); if(!xs.length) return;
  const label=xs.length===1?'Mover esta tarea':'Mover estas '+xs.length;
  popMenu(Object.assign(pt&&UI.wide?{x:pt.x, y:pt.y}:{anchor:head}, {title:dayTitle(day), groups:[[{label, icon:MI.postpone, fn:()=>moveDaySheet(xs, day)}]]})); }
function moveDaySheet(xs, from){ const t=todayStr(); const chips=uniqueBy([[t,'Hoy'],[addDays(t,1),'Mañana'],[nextWeekday(5,true),'Viernes'],[nextWeekday(1,true),'Próxima semana']], c=>c[0]).filter(c=>c[0]!==from).concat([['','Sin fecha']]);
  let ym=(from>t?from:t).slice(0,7); const n=xs.length;
  openSheet('<h2>'+(n===1?'Mover 1 tarea':'Mover '+n+' tareas')+'</h2><div class="hint" style="margin-top:-6px">Desde '+esc(dayTitle(from).toLowerCase())+'</div><div class="chips" style="margin-top:6px">'+chips.map(c=>'<button class="chip" data-d="'+c[0]+'">'+c[1]+'</button>').join('')+'</div><div id="calwrap">'+calendarHTML(ym, from)+'</div>', s=>{
    s.onclick=e=>{ const nav=e.target.closest('[data-cal]'); if(nav){ ym=shiftMonth(ym,+nav.dataset.cal); $('#calwrap',s).innerHTML=calendarHTML(ym, from); return; }
      const c=e.target.closest('[data-d]'); if(!c) return; const d=c.dataset.d||null; closeSheet(); if(d===from) return;
      xs.forEach(x=>releaseHold(x.id)); rescheduleMany(xs.filter(x=>task(x.id)&&x.date!==d), d, d?fmtDate(d).toLowerCase():''); }; }); }
function rowMenu(id, src){ const x=task(id); if(!x) return; releaseHold(id);
  if(UI.wide){ // R17: at the pointer (right click), under the three dots (anchor), or under the row when called without either
    const at=src&&src.anchor?{anchor:src.anchor, align:'right'}:src&&src.x!=null?{x:src.x, y:src.y}:taskAnchor(id)||{}; return popMenu(Object.assign(at, deskTaskMenu(id))); }
  { // R10: the row lifts and the menu opens next to it
    const row=src&&src.row||visibleRow(id), b=row&&row.getBoundingClientRect();
    return popMenu({lift:row, x:src&&src.x||(b?b.left+b.width/2:0), y:src&&src.y||0, prio:{cur:x.priority, fn:pr=>setPriority(id,pr)}, groups:[
      [{label:'Aplazar', icon:MI.postpone, menu:()=>postponeMenu(id)}].concat(x.status!=='done'?[{label:'Fecha límite', icon:MI.flag, menu:()=>deadlineMenu(id)}, {label:'Tiempo', icon:MI.est, menu:()=>estimateMenu(id)}, {label:'Responsable', icon:MI.person, fn:()=>responsibleSheet(id)}]:[], canSnooze(x)?[{label:'Posponer recordatorio', icon:MI.bell, menu:()=>snoozeMenu(id)}]:[], [{label:'Mover a proyecto', icon:MI.folder, menu:()=>projectPickMenu(id)}]).concat(DB.spaces.length>1?[{label:'Mover a otro espacio', icon:MI.space, menu:()=>spaceMoveMenu(id)}]:[]), // decision 48a: Fecha límite next to Aplazar
      [{label:x.status==='done'?'Marcar pendiente':'Completar', icon:x.status==='done'?MI.undo:MI.done, fn:()=>{ leaveRows(id); setTimeout(()=>{ completeTask(id); renderAnimated(); },200); }}]
       .concat(x.status==='pending'?[{label:x.focus?'Quitar de Ahora':'Ahora', icon:x.focus?MI.starOff:MI.star, fn:()=>toggleFocus(id)}]:[]) // decision 39
       .concat(waitItems(x, MI)) // decision 41
       .concat(canRemind(x)?[{label:'Enviar recordatorio', icon:MI.send, fn:()=>remindSheet([id])}]:[]) // decision 48c
       .concat(noticeItems(x, true)) // decision 63b: Avisar a…
       .concat([{label:'Duplicar', icon:MI.dup, fn:()=>duplicateTask(id)}, {label:'Seleccionar', icon:MI.select, fn:()=>startSelect(id)}]),
      [{label:'Eliminar', icon:MI.trash, red:true, fn:()=>confirmDelete(id)}] ]}); } }
/* Desktop sidebar: a project dragged to another place (or moved with Alt and an arrow). The space's projects are numbered again from 0,
   active ones first in their new order, archived ones after; only those whose number changes get a new 'modified', so the order syncs */
function renumberProjects(ps){ const now=new Date().toISOString(), arch=DB.projects.filter(p=>p.spaceId===space().id&&p.archived).sort((a,b)=>a.order-b.order);
  ps.concat(arch).forEach((q,k)=>{ if(q.order!==k){ q.order=k; q.modified=now; } }); }
function reorderProject(id, to){ const ps=activeProjects(), i=ps.findIndex(p=>p.id===id); if(i<0) return false; to=Math.max(0, Math.min(ps.length-1, to)); if(to===i) return false;
  const prev=DB.projects.filter(p=>p.spaceId===space().id).map(p=>({id:p.id, order:p.order}));
  const [p]=ps.splice(i,1); ps.splice(to,0,p); renumberProjects(ps); save(); haptic(6); render(); log('info','Proyecto movido', {name:p.name, from:i, to});
  toast('Proyecto movido', ()=>{ const now=new Date().toISOString(); prev.forEach(o=>{ const q=proj(o.id); if(q&&q.order!==o.order){ q.order=o.order; q.modified=now; } }); save(); }); return true; }
function moveProject(id, dir){ const ps=activeProjects(); ps.forEach((p,i)=>p.order=i); const i=ps.findIndex(p=>p.id===id), j=i+dir; if(i<0||j<0||j>=ps.length) return; ps[i].order=j; ps[j].order=i; ps[i].modified=ps[j].modified=new Date().toISOString(); save(); haptic(6); renderAnimated(); }
function projectMenu(id, src){ const p=proj(id); if(!p) return; const ps=activeProjects(); const i=ps.findIndex(x=>x.id===id);
  const archive=()=>{ p.archived=true; p.modified=new Date().toISOString(); save(); render(); toast('Proyecto archivado', ()=>{p.archived=false; p.modified=new Date().toISOString(); save();}); };
  // the iPhone lifts the project's row; the desktop opens at the pointer (a right click on the sidebar)
  popMenu({lift:UI.wide?null:src&&src.row, x:src&&src.x, y:src&&src.y, groups:[[{label:UI.wide?'Renombrar o cambiar color…':'Renombrar o cambiar color', icon:MI.pencil, fn:()=>projectSheet(id)}],
    (i>0?[{label:'Subir', icon:MI.up, fn:()=>moveProject(id,-1)}]:[]).concat(i<ps.length-1?[{label:'Bajar', icon:MI.down, fn:()=>moveProject(id,1)}]:[]),
    statusItems(id), [{label:'Archivar', icon:MI.archive, red:true, fn:archive}] ]}); }

// Header used by sheets with text fields: on the iPhone the bottom of a sheet ends up under the keyboard bar
function sheadHTML(title, cancel, ok){ return '<div class="shead"><button class="hbtn" data-x="cancel">'+cancel+'</button><h2>'+title+'</h2><button class="hbtn ok" data-x="ok">'+ok+'</button></div>'; }
/* Quick add (R5). The title field and, glued to the keyboard, a bar of 44 pt icons: Fecha, Proyecto, Prioridad, Tiempo (decision 56a) and Añadir.
   Each icon opens a strip of options above the bar without taking the focus from the field, so the keyboard stays up and Enter keeps adding.
   What the title says (R7: date, '#proyecto', '!!', 'a las 9') wins over a pick; a value picked by hand stays for the next task.
   Pasting two or more lines (R6) turns the sheet into a list that Añadir creates in one go. A long press on Añadir adds and opens. */
// The project of the active project filter, if it still exists ('none', Sin proyecto, gives no project)
const filterProject = () => { const f=UI.projFilter; return f&&f!=='none'&&activeProjects().some(p=>p.id===f)?f:null; };
/* Decision 27b: on the iPhone, the + and Añadir tarea of the Tareas list propose the project of the active filter, as a removable token,
   and in Hoy also today (v0.29.2: Todas proposes the filter's project too); a search proposes nothing */
function addFromList(){ const hoy=UI.wide?UI.deskView==='hoy':UI.tab==='tareas'&&DB.settings.filter==='hoy';
  if(UI.query){ addSheet(null); return; } addSheet(filterProject(), '', hoy?{date:hoyAddDate(), fromHoy:true}:{}); } // the evening rule: tomorrow from 18:30
function addSheet(projectId){
  const prefill=arguments[1]||'', preset=arguments[2]||{};
  const st={date:preset.date||null, projectId:projectId||null, priority:'none', estimate:null, open:null, ym:null, lines:null, added:0, msg:'', warn:false, fromHoy:!!preset.fromHoy, dates:[]};
  // Quick date chips, each a different date: on a Thursday 'Viernes' is tomorrow and on a Sunday 'Próx. semana' is, so they are left out
  const quick=()=>{ const t=todayStr(); return uniqueBy([['hoy',t,'Hoy'],['man',addDays(t,1),'Mañana'],['vie',nextWeekday(5,true),'Viernes'],['nsem',nextWeekday(1,true),'Próx. semana']], q=>q[1]); };
  const base=()=>({date:st.date, projectId:st.projectId, priority:st.priority, estimate:st.estimate});
  let inp, cur=quickTask('', base()), lastId=null;
  const strip=()=>{ const k=st.open; if(!k) return ''; const on=(c,v)=>c===v?' on':'';
    if(k==='date'){ if(st.ym) return calendarHTML(st.ym, cur.date); const q=quick();
      return q.map(c=>'<button class="chip'+on(cur.date,c[1])+'" data-c="'+c[0]+'">'+c[2]+'</button>').join('')+'<button class="chip'+(cur.date&&!q.some(c=>c[1]===cur.date)?' on':'')+'" data-c="fecha">'+I.cal+(cur.date&&!q.some(c=>c[1]===cur.date)?fmtDate(cur.date):'Otra fecha')+'</button>'+(cur.date?'<button class="chip" data-c="none">Sin fecha</button>':''); }
    if(k==='proj'){ const ps=activeProjects(); if(!ps.length) return '<button class="chip" disabled>Crea un proyecto en la pestaña Proyectos</button>';
      return '<button class="chip'+(cur.projectId?'':' on')+'" data-p="">Ninguno</button>'+ps.map(p=>'<button class="chip'+on(cur.projectId,p.id)+'" data-p="'+p.id+'"><span class="dot" style="background:'+p.color+'"></span>'+esc(p.name)+'</button>').join(''); }
    if(k==='est') return EST_VALUES.map(m=>'<button class="chip'+on(cur.estimate,m)+'" data-es="'+m+'">'+I.est+estLabel(m)+'</button>').join('')+(cur.estimate?'<button class="chip" data-es="">Sin tiempo</button>':''); // decision 56a
    return [['high','Alta'],['mid','Media'],['none','Ninguna']].map(c=>'<button class="chip'+on(cur.priority,c[0])+'" data-pr="'+c[0]+'">'+I.flag+c[1]+'</button>').join(''); };
  const tokHTML=(k,label,icon)=>'<span class="tok" data-tok="'+k+'">'+icon+'<span>'+label+'</span><button class="x" data-untok="'+k+'" aria-label="Quitar">×</button></span>';
  const many=()=>(st.lines||[]).concat(inp&&inp.value.trim()?[inp.value.trim()]:[]);
  const draw=()=>{ const s=sheet; if(!inp) return;
    cur=quickTask(inp.value, base()); paintQuick(inp, cur.toks);
    const p=cur.projectId&&proj(cur.projectId); let t='';
    if(!st.lines){ if(cur.date) t+=tokHTML('date', fmtDate(cur.date), I.cal);
      if(cur.reminder) t+=tokHTML('time', fmtTime(cur.reminder), I.bell);
      if(p) t+=tokHTML('proj', esc(p.name), '<span class="dot" style="background:'+p.color+'"></span>');
      if(cur.priority!=='none') t+=tokHTML('pri', cur.priority==='high'?'Alta':'Media', I.flag);
      if(cur.estimate) t+=tokHTML('est', estLabel(cur.estimate), I.est); }
    else { if(st.date) t+=tokHTML('date', fmtDate(st.date), I.cal); const sp=st.projectId&&proj(st.projectId); if(sp) t+=tokHTML('proj', esc(sp.name), '<span class="dot" style="background:'+sp.color+'"></span>'); if(st.priority!=='none') t+=tokHTML('pri', st.priority==='high'?'Alta':'Media', I.flag); if(st.estimate) t+=tokHTML('est', estLabel(st.estimate), I.est); }
    $('#qtoks',s).innerHTML=t;
    const said=st.lines?{warn:[]}:quickSaid(cur); const hint=$('#addHint',s); hint.textContent=said.warn.length?said.warn.join(' '):st.msg; hint.classList.toggle('warn', !!said.warn.length);
    const pl=$('#qlist',s); if(st.lines){ const all=many(); pl.innerHTML='<div class="plhead"><span>'+all.length+(all.length===1?' tarea':' tareas')+'</span><button data-x="unlist">Cancelar</button></div><div class="plist">'+all.map((l,i)=>{ const r=quickTask(l, base()); return '<div class="pl"><span class="t">'+esc(r.title||l)+'</span><span class="m">'+esc(quickMeta(r))+'</span>'+(i<st.lines.length?'<button class="x" data-rm="'+i+'" aria-label="Quitar">×</button>':'<span style="width:44px"></span>')+'</div>'; }).join('')+'</div>'; } else pl.innerHTML='';
    const sEl=$('#qstrip',s), was=sEl.dataset.k||''; sEl.innerHTML=strip(); sEl.classList.toggle('calon', st.open==='date'&&!!st.ym); sEl.dataset.k=st.open||''; if(st.open&&st.open!==was) chipInView(sEl); // a strip just opened shows its lit option
    const val={date:st.lines?st.date:cur.date, proj:st.lines?st.projectId:cur.projectId, pri:(st.lines?st.priority:cur.priority)!=='none', est:!!(st.lines?st.estimate:cur.estimate)};
    s.querySelectorAll('.qbtn').forEach(b=>{ b.classList.toggle('set', !!val[b.dataset.k]); b.classList.toggle('open', st.open===b.dataset.k); });
    const n=st.lines?many().length:0; $('.qadd',s).textContent=st.lines?'Crear '+n+(n===1?' tarea':' tareas'):'Añadir'; };
  // Drops what the title says for one kind, so that a pick (or the cross of its token) is what counts
  const dropText=kind=>{ const tk=cur.toks.filter(t=>t.kind===kind); if(!tk.length) return false; let v=inp.value; tk.slice().reverse().forEach(t=>{ v=v.slice(0,t.start)+v.slice(t.end); }); inp.value=v.replace(/\s{2,}/g,' ').replace(/^\s+/,''); return true; };
  openSheet(qinHTML('<input class="titlein" placeholder="Nueva tarea" aria-label="Nueva tarea" autocomplete="off" autocapitalize="sentences" enterkeyhint="done">')+'<div class="qtoks" id="qtoks"></div><div class="qstatus" id="addHint"></div><div id="qlist"></div><div class="qstrip" id="qstrip"></div>'+
    '<div class="qbar"><button class="qbtn" data-k="date" aria-label="Fecha">'+I.cal+'</button><button class="qbtn" data-k="proj" aria-label="Proyecto">'+I.folder+'</button><button class="qbtn" data-k="pri" aria-label="Prioridad">'+I.flag+'</button><button class="qbtn" data-k="est" aria-label="Tiempo">'+I.est+'</button><span class="grow"></span><button class="qadd" data-x="ok">Añadir</button></div>', s=>{
    sheet.classList.add('addsheet'); inp=$('.titlein',s); inp.focus(); bindQuickScroll(inp);
    inp.addEventListener('input',()=>{ st.msg=''; draw(); });
    // A pasted list (R6): two or more lines become a list; bullets, numbers and check boxes go
    inp.addEventListener('paste',e=>{ const txt=e.clipboardData&&e.clipboardData.getData('text'); const ls=pasteLines(txt); if(ls.length<2) return; e.preventDefault(); takeLines(ls); });
    const takeLines=ls=>{ st.lines=(st.lines||[]).concat(ls); st.open=null; st.ym=null; draw(); };
    if(prefill){ const ls=pasteLines(prefill); if(ls.length>1) takeLines(ls); else inp.value=ls[0]||''; }
    draw();
    const add=()=>{ const r=quickTask(inp.value, base()); if(!r.title) return false;
      lastId=addTask(Object.assign({title:r.title, date:r.date, projectId:r.projectId, priority:r.priority, reminder:r.reminder}, r.estimate?{estimate:r.estimate}:{})).id; st.added++; st.dates.push(r.date); haptic(8); return r.title; };
    // The list behind the sheet is drawn once, when the sheet closes (any way it closes), not after every Enter
    sheetOnClose=()=>{ if(st.added) render(); };
    // Decision 28b: a typed title or a pasted list not yet added asks before the sheet goes
    sheetGuard=()=>{ const n=st.lines?many().length:(inp.value.trim()?1:0); if(!n) return null;
      return {title:n>1?'Las tareas no se han añadido.':'La tarea no se ha añadido.', label:n>1?'Descartar tareas':'Descartar tarea', field:inp}; };
    const finish=()=>{ closeSheet(); if(!st.added) return; const tm=st.fromHoy&&forTomorrow(st.dates); toast(st.added===1?(tm?'Añadida para mañana':'Tarea añadida'):st.added+' tareas añadidas'+(tm?' para mañana':'')); }; // the evening rule: not in the list behind
    const createList=()=>{ const ls=many(); if(!ls.length){ st.lines=null; draw(); inp.focus(); return; } const ids=addMany(ls, base()); st.added=0; closeSheet(); renderAnimated();
      log('info','Tareas creadas desde una lista', {n:ids.length}); const tm=st.fromHoy&&forTomorrow(ids.map(i=>(task(i)||{}).date)); toast((ids.length===1?'1 tarea creada':ids.length+' tareas creadas')+(tm?' para mañana':''), ()=>removeTasks(ids)); };
    const ok=()=>{ if(st.lines){ createList(); return; } if(!add()){ if(st.added) finish(); else inp.focus(); return; } finish(); };
    const okAndNext=()=>{ if(st.lines){ const v=inp.value.trim(); if(v){ st.lines.push(v); inp.value=''; draw(); } inp.focus(); return; }
      const t=add(); if(!t){ finish(); return; } inp.value=''; st.open=null; st.ym=null; st.msg=st.added+(st.added===1?' añadida: ':' añadidas. Última: ')+t; draw(); inp.focus(); };
    const addOpen=()=>{ if(st.lines){ createList(); return; } if(!add()){ inp.focus(); return; } finish(); openDetail(lastId); };
    inp.addEventListener('keydown',e=>{ if(e.key==='Enter'){ e.preventDefault(); okAndNext(); } });
    // Buttons never take the focus from the field: the keyboard stays where it is (and each handler focuses it again inside the tap)
    s.addEventListener('mousedown',e=>{ if(e.target.closest('button')) e.preventDefault(); });
    // Añadir y abrir: a long press on Añadir
    const ab=$('.qadd',s); let lpT=null, lpDone=false, lpX=0, lpY=0;
    ab.addEventListener('pointerdown',e=>{ lpDone=false; lpX=e.clientX; lpY=e.clientY; clearTimeout(lpT); lpT=setTimeout(()=>{ lpDone=true; haptic(12); swallowClick(); addOpen(); },500); });
    ab.addEventListener('pointermove',e=>{ if(Math.abs(e.clientX-lpX)>10||Math.abs(e.clientY-lpY)>10) clearTimeout(lpT); });
    ['pointerup','pointercancel','pointerleave'].forEach(n=>ab.addEventListener(n,()=>clearTimeout(lpT)));
    ab.addEventListener('contextmenu',e=>e.preventDefault());
    // The sheet is gone when the finger lifts: the click that follows a long press must not reach what was under the button (the tab bar)
    ab.addEventListener('touchend',e=>{ if(lpDone) e.preventDefault(); });
    s.onclick=e=>{ const x=e.target.closest('[data-x]');
      if(x){ const k=x.dataset.x; if(k==='ok'){ if(lpDone){ lpDone=false; return; } ok(); } else if(k==='unlist'){ st.lines=null; draw(); inp.focus(); } return; }
      const rm=e.target.closest('[data-rm]'); if(rm){ st.lines.splice(+rm.dataset.rm,1); if(!st.lines.length) st.lines=null; draw(); inp.focus(); return; }
      const un=e.target.closest('[data-untok]'); if(un){ const k=un.dataset.untok; if(!dropText(k)){ if(k==='date') st.date=null; else if(k==='proj') st.projectId=null; else if(k==='pri') st.priority='none'; else if(k==='est') st.estimate=null; } haptic(4); draw(); inp.focus(); return; }
      const qb=e.target.closest('.qbtn'); if(qb){ st.open=st.open===qb.dataset.k?null:qb.dataset.k; st.ym=null; draw(); inp.focus(); return; }
      const nav=e.target.closest('[data-cal]'); if(nav){ st.ym=shiftMonth(st.ym,+nav.dataset.cal); draw(); inp.focus(); return; }
      const d=e.target.closest('[data-d]'); if(d){ dropText('date'); st.date=d.dataset.d; st.open=null; st.ym=null; haptic(4); draw(); inp.focus(); return; }
      const c=e.target.closest('[data-c]'); if(c){ const k=c.dataset.c; if(k==='fecha'){ st.ym=(cur.date||todayStr()).slice(0,7); draw(); inp.focus(); return; }
        const qc=quick().find(q=>q[0]===k); const was=cur.date; dropText('date'); st.date= k==='none'||(qc&&was===qc[1]) ? null : qc[1]; // a second tap on the lit chip clears the date
        st.open=null; haptic(4); draw(); inp.focus(); return; }
      const pj=e.target.closest('[data-p]'); if(pj){ dropText('proj'); st.projectId=pj.dataset.p||null; st.open=null; haptic(4); draw(); inp.focus(); return; }
      const pr=e.target.closest('[data-pr]'); if(pr){ dropText('pri'); st.priority=pr.dataset.pr; st.open=null; haptic(4); draw(); inp.focus(); return; }
      const es=e.target.closest('[data-es]'); if(es){ const was=cur.estimate; dropText('est'); st.estimate=es.dataset.es&&+es.dataset.es!==was?+es.dataset.es:null; st.open=null; haptic(4); draw(); inp.focus(); return; } // a second tap on the lit chip clears it
      if(!e.target.closest('input')) inp.focus(); };
  });
}
// After a long press that closed what was under the finger, the click the browser may still send is dropped
function swallowClick(){ const f=e=>{ e.stopPropagation(); e.preventDefault(); off(); }; const off=()=>{ document.removeEventListener('click', f, true); clearTimeout(t); }; document.addEventListener('click', f, true); const t=setTimeout(off, 1000); }
// R6: several tasks at once (a pasted list, the items of a note). Each line is read as a quick-add title over the shared values.
function addMany(lines, base, extra){ const ids=[]; batch(()=>{ lines.forEach(l=>{ const r=quickTask(l, base); if(!r.title) return; ids.push(addTask(Object.assign({title:r.title, date:r.date, projectId:r.projectId, priority:r.priority, reminder:r.reminder}, r.estimate?{estimate:r.estimate}:{}, extra||{})).id); }); }); haptic(8); return ids; }
function removeTasks(ids){ const set=new Set(ids); DB.tasks=DB.tasks.filter(x=>!set.has(x.id)); DB.voiceNotes=DB.voiceNotes.filter(v=>!set.has(v.taskId)); cutAttachments(set); cutSteps(set); save(); }
/* New or edited project */
function projectSheet(id){
  const p=id?proj(id):null; let color=p?p.color:COLORS[4];
  openSheet(sheadHTML(p?'Editar proyecto':'Nuevo proyecto','Cancelar',p?'Guardar':'Crear')+'<input class="titlein" placeholder="Nombre" value="'+(p?esc(p.name):'')+'" autocomplete="off"><div class="colors" role="radiogroup" aria-label="Color">'+COLORS.map((c,i)=>'<button data-col="'+c+'" style="background:'+c+'" class="'+(c===color?'on':'')+'" role="radio" aria-checked="'+(c===color)+'" aria-label="'+COLOR_NAMES[i]+'" title="'+COLOR_NAMES[i]+'"></button>').join('')+(COLORS.includes(color)?'':'<button data-col="'+esc(color)+'" style="background:'+esc(color)+'" class="on" role="radio" aria-checked="true" aria-label="Color actual" title="Color actual"></button>')+'</div>', s=>{
    const inp=$('.titlein',s); inp.focus();
    s.onclick=e=>{ const cb=e.target.closest('[data-col]'); if(cb){ color=cb.dataset.col; s.querySelectorAll('[data-col]').forEach(b=>{ b.classList.toggle('on',b.dataset.col===color); b.setAttribute('aria-checked', String(b.dataset.col===color)); }); return; }
      const b=e.target.closest('[data-x]'); if(!b) return; if(b.dataset.x==='cancel'){ closeSheet(); return; }
      const n=inp.value.trim(); if(!n){ inp.focus(); return; } if(p){ p.name=n; p.color=color; p.modified=new Date().toISOString(); save(); } else addProject(n,color); closeSheet(); render(); };
    inp.addEventListener('keydown',e=>{ if(e.key==='Enter'){ e.preventDefault(); s.querySelector('[data-x=ok]').click(); } });
  });
}
/* New or edited space */
// What goes with a space, in words: "3 proyectos, 42 tareas y 5 notas de voz" (archived projects and old completed tasks count too)
// Decision 49: a voice note is a recording now (any dictated one left counts too)
const spaceVoice = L => L.vs.length+L.as.filter(a=>a.kind==='audio').length;
function spaceLoadText(L){ const n=(k,one,many)=>k?k+' '+(k===1?one:many):''; const parts=[n(L.ps.length,'proyecto','proyectos'), n((L.ns||[]).length,'nota de proyecto','notas de proyecto'), n(L.ts.length,'tarea','tareas'), n(spaceVoice(L),'nota de voz','notas de voz')].filter(Boolean); // decision 47: the notes of its projects
  return parts.length>1 ? parts.slice(0,-1).join(', ')+' y '+parts[parts.length-1] : parts.join(''); }
// Decision 28a: confirmation with what goes, a local copy first (as before the first sync), then one Deshacer for everything
function confirmDeleteSpace(sp){ const L=spaceLoad(sp.id), n=L.ps.length+L.ts.length+spaceVoice(L)+L.ns.length;
  const text = n ? 'Se '+(n===1?'eliminará ':'eliminarán ')+spaceLoadText(L)+' del espacio "'+sp.name+'". Podrás deshacerlo durante unos segundos.' : 'El espacio "'+sp.name+'" está vacío.';
  confirmSheet('Eliminar espacio', text, async()=>{ flushEdits();
    try{ await Promise.race([BK.put(todayStr()), new Promise((_,rej)=>setTimeout(()=>rej(new Error('tiempo agotado')), 4000))]); await refreshBackups(); log('info','Copia local antes de eliminar un espacio', {space:sp.name, tasks:DB.tasks.length}); }
    catch(e){ log('warn','Copia local antes de eliminar un espacio no disponible: '+(e&&e.message||e)); }
    const undo=deleteSpace(sp.id); if(!undo) return; log('info','Espacio eliminado', {projects:L.ps.length, tasks:L.ts.length, voiceNotes:L.vs.length});
    haptic(10); if(UI.wide) UI.deskDetail=null; render(); toast('Espacio eliminado', ()=>{ undo(); log('info','Espacio recuperado'); }); }); }
function spaceSheet(id){
  const sp=id?DB.spaces.find(x=>x.id===id):null; const canDelete=sp&&DB.spaces.length>1;
  openSheet(sheadHTML(sp?'Editar espacio':'Nuevo espacio','Cancelar',sp?'Guardar':'Crear')+'<input class="titlein" placeholder="Nombre" value="'+(sp?esc(sp.name):'')+'" autocomplete="off" enterkeyhint="done">'+
    (sp&&!canDelete?'<div class="hint" style="margin-top:10px">Es el único espacio; no se puede eliminar.</div>':'')+
    (canDelete?'<div class="sheet-actions" style="margin-top:10px"><button class="btn red" data-x="del">Eliminar espacio</button></div>':''), s=>{
    const inp=$('.titlein',s); inp.focus();
    s.onclick=e=>{ const b=e.target.closest('[data-x]'); if(!b) return;
      if(b.dataset.x==='cancel'){ closeSheet(); return; }
      if(b.dataset.x==='del'){ closeSheet(); confirmDeleteSpace(sp); return; }
      const n=inp.value.trim(); if(!n){ inp.focus(); return; }
      if(sp){ sp.name=n; sp.modified=new Date().toISOString(); save(); } else { const ns=addSpace(n); DB.settings.activeSpace=ns.id; save(); resetListState(); }
      closeSheet(); render(); };
    inp.addEventListener('keydown',e=>{ if(e.key==='Enter'){ e.preventDefault(); s.querySelector('[data-x=ok]').click(); } });
  });
}
/* Month calendar, Monday first. R14: a day's load of pending tasks shows as one, two or three dots (1 or 2, 3 to 5, 6 or more) */
// opts.mini (R19, the sidebar): every day can be clicked (data-mini) and takes a dropped task (data-day); opts.range marks the days the calendar shows
function calendarHTML(ym, sel, opts){ const mini=!!(opts&&opts.mini), rg=opts&&opts.range;
  const [y,m]=ym.split('-').map(Number); const t=todayStr(); const startDow=(new Date(y,m-1,1).getDay()+6)%7;
  const days=new Date(y,m,0).getDate(), prevDays=new Date(y,m-1,0).getDate();
  const load=new Map(); spaceTasks().forEach(x=>{ if(isOpen(x)&&x.date) load.set(x.date, (load.get(x.date)||0)+1); });
  const dots=ds=>{ const n=load.get(ds)||0; return n?'<i class="ld">'+'<b></b>'.repeat(n<3?1:n<6?2:3)+'</i>':''; };
  let cells=''; const total=Math.ceil((startDow+days)/7)*7;
  for(let i=0;i<total;i++){ const n=i-startDow+1; let yy=y,mm=m,dd=n,other=false; if(n<1){ other=true; mm=m-1; dd=prevDays+n; if(mm<1){ mm=12; yy--; } } else if(n>days){ other=true; mm=m+1; dd=n-days; if(mm>12){ mm=1; yy++; } }
    const ds=yy+'-'+String(mm).padStart(2,'0')+'-'+String(dd).padStart(2,'0');
    cells+='<button class="cal-d'+(other?' other':'')+(ds<t?' past':'')+(ds===t?' today':'')+(ds===sel?' sel':'')+(rg&&ds>=rg[0]&&ds<=rg[1]?' inr':'')+'"'+(mini?' data-mini="'+ds+'" data-day="'+ds+'"':ds<t?' disabled':' data-d="'+ds+'"')+'><span>'+dd+'</span>'+dots(ds)+'</button>'; } // a past day cannot be picked: no task is ever overdue (decision 8.5)
  const name=MESES_FULL[m-1]; return '<div class="cal'+(mini?' mini':'')+'"><div class="cal-head"><button data-cal="-1" aria-label="Mes anterior">'+I.back+'</button><span>'+name[0].toUpperCase()+name.slice(1)+' '+y+'</span><button data-cal="1" aria-label="Mes siguiente">'+I.chev+'</button></div><div class="cal-grid">'+['L','M','X','J','V','S','D'].map(d=>'<div class="cal-dow">'+d+'</div>').join('')+cells+'</div></div>';
}
function shiftMonth(ym, d){ let [y,m]=ym.split('-').map(Number); m+=d; if(m<1){ m=12; y--; } if(m>12){ m=1; y++; } return y+'-'+String(m).padStart(2,'0'); }
// The project of a task: an anchored menu, from the detail's value on the iPhone and as the inspector's pop-up button on the desktop
function pickProjectSheet(id, src){ const x=task(id); if(!x) return; const m=projectPickMenu(id); m.title=''; popMenu(Object.assign(m, src?{anchor:src, align:UI.wide?'left':'right'}:taskAnchor(id, 'pickProject')||{})); }
function dateSheet(id, src){ const x=task(id); if(!x) return; const t=todayStr(); const dow=new Date(t+'T00:00:00').getDay(); const chips=[[t,'Hoy'],[addDays(t,1),'Mañana']]; if(dow>=1&&dow<=4) chips.push([nextWeekday(5,true),'Este viernes']); chips.push([nextWeekday(1,true),'Próxima semana'],['','Sin fecha']);
  let ym=(x.date||t).slice(0,7);
  pickerPanel('Fecha', '<div class="chips" style="margin-top:0">'+uniqueBy(chips, c=>c[0]).map(c=>'<button class="chip'+(x.date===c[0]?' on':'')+'" data-d="'+c[0]+'">'+c[1]+'</button>').join('')+'</div><div id="calwrap">'+calendarHTML(ym, x.date)+'</div>', id, src, 'pickDate', (s, done)=>{
    s.onclick=e=>{ const nav=e.target.closest('[data-cal]'); if(nav){ ym=shiftMonth(ym,+nav.dataset.cal); $('#calwrap',s).innerHTML=calendarHTML(ym, x.date); return; }
      const c=e.target.closest('[data-d]'); if(c){ if(pickFresh(e)){ log('warn','Toque en el calendario ignorado justo al abrir'); return; } releaseHold(id); setManualDate(id, c.dataset.d||null); haptic(6); done(); render(); } }; }); }
/* Decision 48a: the Fecha límite picker, a sheet on the iPhone and a popover on the desktop (the inspector's control, or the row): quick days,
   the calendar (no past day) and Quitar when it has one */
function deadlineSheet(id, src){ const x=task(id); if(!x) return; const t=todayStr(), dow=new Date(t+'T00:00:00').getDay(); const chips=[[t,'Hoy'],[addDays(t,1),'Mañana']]; if(dow>=1&&dow<=4) chips.push([nextWeekday(5,true),'Este viernes']); chips.push([nextWeekday(1,true),'Próxima semana']); if(x.deadline) chips.push(['','Quitar']);
  let ym=(x.deadline&&x.deadline>=t?x.deadline:t).slice(0,7);
  pickerPanel('Fecha límite', '<div class="chips" style="margin-top:0">'+uniqueBy(chips, c=>c[0]).map(c=>'<button class="chip'+(x.deadline===c[0]?' on':'')+'" data-d="'+c[0]+'">'+c[1]+'</button>').join('')+'</div><div id="calwrap">'+calendarHTML(ym, x.deadline)+'</div><div class="hint dlhint">Ese día la tarea entra en Hoy aunque esté aplazada.</div>', id, src, 'pickDeadline', (s, done)=>{
    s.onclick=e=>{ const nav=e.target.closest('[data-cal]'); if(nav){ ym=shiftMonth(ym,+nav.dataset.cal); $('#calwrap',s).innerHTML=calendarHTML(ym, x.deadline); return; }
      const c=e.target.closest('[data-d]'); if(c){ if(pickFresh(e)){ log('warn','Toque en el calendario ignorado justo al abrir'); return; } done(); setDeadline(id, c.dataset.d||null); } }; }); }
/* Decision 27a: the Fecha picker (iPhone sheet, desktop popover and inspector) takes a reminder set on the old day to the new day, at the
   same time, as decision 25, and says so with Deshacer. Sin fecha leaves the reminder alone (dayPatch only moves it to a date) */
function setManualDate(id, d){ const x=task(id); if(!x) return; const old=daySnap(x), p=dayPatch(x, d); updTask(id, p);
  if(p.reminder&&p.reminder!==old.reminder){ log('info','Recordatorio movido con la fecha', {from:old.reminder, to:p.reminder}); toast('Movida a '+fmtDate(d).toLowerCase()+', recordatorio a las '+fmtTime(p.reminder), ()=>undoDay(old)); } }
function reminderSheet(id, src){ const x=task(id); if(!x) return; const t=todayStr(); const pad=n=>String(n).padStart(2,'0');
  const tm=new Date(); tm.setDate(tm.getDate()+1); tm.setHours(9,0,0,0);
  const now=new Date(); const h1=new Date(Math.ceil((now.getTime()+36e5)/3e5)*3e5); const e18=new Date(); e18.setHours(18,0,0,0);
  let chips=[]; if(now.getHours()<17) chips.push([e18.toISOString(),'Hoy a las 18:00']); chips.push([tm.toISOString(),'Mañana a las 9:00'],[h1.toISOString(),'En una hora ('+fmtTime(h1.toISOString())+')']); if(x.reminder) chips.push(['','Quitar']); chips=uniqueBy(chips, c=>c[0]); // from 16:55 'En una hora' is 18:00 too
  const cur = x.reminder?new Date(x.reminder):tm; let day=localDay(cur.toISOString()), time=pad(cur.getHours())+':'+pad(cur.getMinutes()), ym=day.slice(0,7);
  pickerPanel('Recordatorio', '<div class="chips" style="margin-top:0">'+chips.map(c=>'<button class="chip" data-r="'+c[0]+'">'+c[1]+'</button>').join('')+'</div><div id="calwrap">'+calendarHTML(ym, day)+'</div>'+(UI.wide?timePickHTML(time):'<div class="timerow"><span>Hora</span><input type="time" value="'+time+'"></div>')+'<div class="sheet-actions"><button class="btn primary" data-x="ok">Guardar</button></div>', id, src, 'pickReminder', (s, closeSheet)=>{ // closeSheet here closes the sheet or the popover that holds it
    const unwarn=()=>{ const w=$('.hint.warn',s); if(w) w.remove(); };
    // Decision 32: the desktop has its own time picker; the iPhone keeps the native wheel
    const tp=UI.wide?bindTimePick(s, {fresh:!x.reminder, onChange:unwarn, onEnter:()=>$('[data-x=ok]',s).click()}):null;
    const inp=tp?tp.input:$('input[type=time]',s); if(!tp){ inp.addEventListener('input',unwarn); inp.addEventListener('keydown', e=>{ if(e.key==='Enter'){ e.preventDefault(); $('[data-x=ok]',s).click(); } }); } // Enter in the time saves
    s.onclick=e=>{ const nav=e.target.closest('[data-cal]'); if(nav){ ym=shiftMonth(ym,+nav.dataset.cal); $('#calwrap',s).innerHTML=calendarHTML(ym, day); return; }
      const d=e.target.closest('[data-d]'); if(d){ day=d.dataset.d; ym=day.slice(0,7); $('#calwrap',s).innerHTML=calendarHTML(ym, day); unwarn(); haptic(4); return; }
      const c=e.target.closest('[data-r]'); if(c){ if(pickFresh(e)){ log('warn','Toque en el recordatorio ignorado justo al abrir'); return; } updTask(id,{reminder:c.dataset.r||null}); closeSheet(); render(); if(c.dataset.r) pushOfferSoon(); return; }
      if(e.target.closest('[data-x=ok]')){ const [hh,mi]=(tp?hmStr(tp.value()):(inp.value||time)).split(':').map(Number); const dt=new Date(day+'T00:00:00'); dt.setHours(hh||0, mi||0, 0, 0); if(dt.getTime()<=Date.now()){ let w=$('.hint.warn',s); if(!w){ w=document.createElement('div'); w.className='hint warn'; $('.timerow, .tpk',s).after(w); } w.textContent='Esa hora ya ha pasado'; haptic(10); return; } updTask(id,{reminder:dt.toISOString()}); closeSheet(); render(); pushOfferSoon(); } }; }); } // a past reminder could never notify: the sheet stays open, with a line above Guardar (a toast would cover the time field)

/* Plan the undated tasks one by one */
function planStart(){ let ids=pendingFor('todas').filter(x=>!x.date&&!dlDue(x)); /* decision 48a: one whose deadline has come is in Hoy, not in Sin fecha */ if(filterOn()) ids=ids.filter(passFilter); ids=ids.map(x=>x.id); if(!ids.length) return; planStep(ids, 0, {done:0, skipped:0}); }
function planEnd(st){ renderAnimated(); toast(st.done+(st.done===1?' planificada':' planificadas')+(st.skipped?', '+st.skipped+(st.skipped===1?' saltada':' saltadas'):'')); log('info','Planificar sin fecha', st); }
function planStep(ids, i, st){
  if(i>=ids.length){ sheetOnClose=null; closeSheet(); planEnd(st); return; }
  const x=task(ids[i]); if(!x){ planStep(ids, i+1, st); return; }
  const t=todayStr(); const dow=new Date(t+'T00:00:00').getDay(); const chips=[[t,'Hoy'],[addDays(t,1),'Mañana']]; if(dow>=1&&dow<=4) chips.push([nextWeekday(5,true),'Este viernes']); chips.push([nextWeekday(1,true),'Próxima semana']);
  let ym=t.slice(0,7); const p=x.projectId?proj(x.projectId):null;
  openSheet('<h2>Planificar</h2><div class="hint" style="margin-top:-6px">'+(i+1)+' de '+ids.length+(p?', '+esc(p.name):'')+'</div><div class="plan-title">'+esc(x.title)+'</div><div class="chips" style="margin-top:0">'+uniqueBy(chips, c=>c[0]).map(c=>'<button class="chip" data-d="'+c[0]+'">'+c[1]+'</button>').join('')+'</div><div id="calwrap">'+calendarHTML(ym, null)+'</div><div class="sheet-actions"><button class="btn" data-x="skip">Saltar</button><button class="btn" data-x="end">Terminar</button></div>', s=>{
    sheetOnClose=()=>{ st.skipped+=ids.length-i; planEnd(st); }; // closed with a tap outside or a drag: as Terminar
    s.onclick=e=>{ const nav=e.target.closest('[data-cal]'); if(nav){ ym=shiftMonth(ym,+nav.dataset.cal); $('#calwrap',s).innerHTML=calendarHTML(ym, null); return; }
      const d=e.target.closest('[data-d]'); if(d){ updTask(x.id, dayPatch(x, d.dataset.d)); st.done++; haptic(6); render(); planStep(ids, i+1, st); return; } // the list behind stays current
      const b=e.target.closest('[data-x]'); if(!b) return; if(b.dataset.x==='skip'){ st.skipped++; planStep(ids, i+1, st); } else { st.skipped+=ids.length-i; planStep(ids, ids.length, st); } }; });
}

/* Decision 49: the dictated voice note is gone (dictation is the keyboard's microphone in Notas). stopRec is set by the recording
   sheet (decision 29) so closeSheet lets the microphone go however the sheet closes */
let stopRec=null;
const isStandalone = () => { try{ return navigator.standalone===true || matchMedia('(display-mode: standalone)').matches; }catch(e){ return false; } };

/* Share */
function shareText(id){ const x=task(id); if(!x) return ''; const p=x.projectId?proj(x.projectId):null;
  const d = x.date? new Date(x.date+'T00:00:00').toLocaleDateString('es-ES',{day:'numeric',month:'long',year:'numeric'}) : 'sin fecha';
  const sp=DB.spaces.find(o=>o.id===x.spaceId)||space(); // the task's own space, not the one on screen
  let t='Tarea: '+x.title+'\nEspacio: '+sp.name+'\nProyecto: '+(p?p.name:'ninguno')+'\nFecha: '+d+'\nPrioridad: '+(x.priority==='high'?'alta':x.priority==='mid'?'media':'ninguna')+'\n';
  if(x.estimate) t+='Tiempo estimado: '+estLabel(x.estimate).toLowerCase()+'\n'; // decision 56a
  if(x.deadline) t+='Fecha límite: '+new Date(x.deadline+'T00:00:00').toLocaleDateString('es-ES',{day:'numeric',month:'long',year:'numeric'})+'\n'; // decision 48a
  if(x.status==='waiting') t+='Estado: por confirmar'+(x.waitingFor?', esperando a '+x.waitingFor:'')+'\n'; // decision 41
  if(x.responsible) t+='Responsable: '+x.responsible+'\n'; // decision 48c
  if(repParse(x.repeat)) t+='Se repite: '+repSummary(x.repeat).replace(/^./, c=>c.toLowerCase())+'\n'; // decision 38
  if(x.notes&&x.notes.trim()) t+='\nNotas:\n'+x.notes.trim()+'\n';
  const ss=stepsOf(id); if(ss.length) t+='\nPasos ('+stepsCount(id)+' hechos):\n'+ss.map(o=>'- ['+(o.done?'x':' ')+'] '+o.title).join('\n')+'\n'; // decision 46: the boxes Convertir líneas reads back
  return t; }
async function shareTask(id){ const t=shareText(id); if(!t) return; try{ if(navigator.share){ await navigator.share({title:task(id).title, text:t}); return; } }catch(e){ if(e&&e.name==='AbortError') return; } copyText(t,'Texto copiado. Pégalo en Claude, WhatsApp o Mail.'); }
async function copyText(t,msg){ try{ await navigator.clipboard.writeText(t); toast(msg||'Copiado'); }catch(e){ const ta=document.createElement('textarea'); ta.value=t; ta.setAttribute('readonly',''); ta.style.cssText='position:fixed;top:0;left:0;opacity:0;font-size:16px;'; document.body.appendChild(ta); ta.select(); ta.setSelectionRange(0,t.length); // iOS selects only through setSelectionRange
    let ok=false; try{ ok=document.execCommand('copy'); }catch(e2){} ta.remove(); if(ok) toast(msg||'Copiado'); else { log('error','No se pudo copiar al portapapeles', e&&e.name); toast('No se pudo copiar'); } } } // execCommand returns false, without throwing, when the copy is refused

/* Local backups: one snapshot per day in IndexedDB, last seven kept. A safety net until the sync exists. */
const BK = {
  // Version 2 keeps a small 'meta' record (date, counts) next to each snapshot: listing the copies never reads the snapshots themselves,
  // which hold all the data seven times over. The upgrade writes the records of the copies already kept.
  open(){ return new Promise((res,rej)=>{ try{ const r=indexedDB.open('tareas-backups',2);
    r.onupgradeneeded=()=>{ const db=r.result, tx=r.transaction; const snaps=db.objectStoreNames.contains('snapshots')?tx.objectStore('snapshots'):db.createObjectStore('snapshots',{keyPath:'date'});
      if(!db.objectStoreNames.contains('meta')){ const meta=db.createObjectStore('meta',{keyPath:'date'}); snaps.openCursor().onsuccess=e=>{ const c=e.target.result; if(!c) return; meta.put(BK.metaOf(c.value)); c.continue(); }; } };
    r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); }catch(e){ rej(e); } }); },
  metaOf(x){ const d=x.data||{}; return {date:x.date, day:x.day||String(x.date).slice(0,10), created:x.created, tasks:(d.tasks||[]).length, projects:(d.projects||[]).length, owner:x.owner||null}; },
  async tx(mode, fn){ const db=await this.open(); return new Promise((res,rej)=>{ const t=db.transaction(['snapshots','meta'],mode); const out=fn(t.objectStore('snapshots'), t.objectStore('meta')); t.oncomplete=()=>{ db.close(); res(out&&out.result!==undefined?out.result:out); }; t.onerror=()=>{ db.close(); rej(t.error); }; }); },
  async list(){ const db=await this.open(); return new Promise((res,rej)=>{ const t=db.transaction('meta','readonly'); const r=t.objectStore('meta').getAll(); r.onsuccess=()=>{ db.close(); res((r.result||[]).sort((a,b)=>a.date<b.date?1:-1)); }; r.onerror=()=>{ db.close(); rej(r.error); }; }); },
  async get(date){ const db=await this.open(); return new Promise((res,rej)=>{ const t=db.transaction('snapshots','readonly'); const r=t.objectStore('snapshots').get(date); r.onsuccess=()=>{ db.close(); res(r.result); }; r.onerror=()=>{ db.close(); rej(r.error); }; }); },
  del(date){ return this.tx('readwrite', (st,meta)=>{ st.delete(date); meta.delete(date); }); }, // decision 34
  clear(){ return this.tx('readwrite', (st,meta)=>{ st.clear(); meta.clear(); }); },
  // Copies made before copies carried their account (or before the first sync) hold the data of the account the device synced with: before
  // emptying it for another account they are marked as that account's, so none of them restores into another
  tagOwnerless(owner){ if(!owner) return Promise.resolve(); return this.tx('readwrite', (st,meta)=>{ st.openCursor().onsuccess=e=>{ const c=e.target.result; if(!c) return; const v=c.value;
    if(!v.owner){ v.owner=owner; c.update(v); meta.put(BK.metaOf(v)); } c.continue(); }; }); },
  /* owner: the account these data synced with (null when none), so a copy of one account never restores into another. The key is the day;
     a copy that would replace that day's copy of another account, or one asked to be apart (own: the copy before emptying the device for
     another account), takes its own key (day, owner and time), so no copy ever replaces another account's (a copy of no account, made
     before the device first synced, belongs to it and may be replaced). day: the day it shows */
  async put(date, owner, own){ owner=owner!==undefined?owner:syncPrevOwner()||null; let key=date; // owner: the account these data belong to, signed in or not
    const cur=own?null:(await this.list()).find(b=>b.date===date); if(own||(cur&&cur.owner&&cur.owner!==owner)) key=date+'#'+(owner||'sin-cuenta')+'#'+Date.now();
    const snap={date:key, day:date, created:new Date().toISOString(), data:exportData(), owner}; await this.tx('readwrite', (st,meta)=>{ st.put(snap); meta.put(BK.metaOf(snap)); });
    // Seven copies of this device's account (or of none) are kept; another account's copies (made when the device was emptied for this one)
    // never count and are never removed automatically: they may be the only home of what that account had not sent. Ajustes deletes them
    const mine=syncPrevOwner()||null, old=(await this.list()).filter(b=>!b.owner||b.owner===mine).slice(7); if(old.length) await this.tx('readwrite', (st,meta)=>{ old.forEach(b=>{ st.delete(b.date); meta.delete(b.date); }); }); }
};
let BACKUPS=[];
async function refreshBackups(){ try{ BACKUPS=await BK.list(); }catch(e){ BACKUPS=[]; } }
// Ajustes is on screen: the desktop settings view, or the iPhone tab with nothing pushed on top
function onSettings(){ return UI.wide ? UI.deskView==='settings' : (UI.tab==='ajustes'&&!UI.stack.length); }
/* Decision 34: a copy can be deleted (an iPhone row slides to Eliminar, or its menu; the desktop has the right click and a bin on hover), and all
   of them at once. Always confirmed, never undone. A copy of today deleted by hand is not made again until tomorrow ('tareas-bk-skip') */
const BK_SKIP='tareas-bk-skip';
const bkWhen = date => date===todayStr()?'de hoy':date===addDays(todayStr(),-1)?'de ayer':'del '+fmtDate(date);
const bkDay = b => b.day||String(b.date).slice(0,10);
const backupRowHTML = b => '<div class="vn bk" data-bk="'+esc(b.date)+'"><div class="vn-bg r"><button data-bkact="del">Eliminar</button></div><div class="vn-c bk-c"><button class="cell" data-restore="'+esc(b.date)+'"><span class="lbl">'+fmtDate(bkDay(b))+'</span><span class="val">'+b.tasks+(b.tasks===1?' tarea':' tareas')+'</span>'+I.chev.replace('<svg','<svg class="chev"')+'</button>'+
  (UI.wide?'<button class="bk-del" data-bkact="del" aria-label="Borrar la copia '+bkWhen(bkDay(b))+'" title="Borrar la copia">'+I.trash+'</button>':'')+'</div></div>';
function backupMenu(date, at){ popMenu(Object.assign(at, {groups:[[{label:'Restaurar', icon:MI.undo, fn:()=>restoreBackup(date)}],[{label:'Borrar copia', icon:MI.trash, red:true, fn:()=>deleteBackup(date)}]]})); }
function deleteBackup(date){ const b=BACKUPS.find(x=>x.date===date); if(!b) return; const dev=UI.wide?'este dispositivo':'este iPhone';
  confirmSheet('Borrar copia', 'La copia '+bkWhen(bkDay(b))+' ('+b.tasks+(b.tasks===1?' tarea':' tareas')+') se borrará de '+dev+'. No se puede deshacer.', async()=>{
    try{ await BK.del(date); if(date===todayStr()) try{ localStorage.setItem(BK_SKIP, date); }catch(e){} await refreshBackups(); log('info','Copia local borrada', {date}); toast('Copia borrada'); }
    catch(e){ log('error','No se pudo borrar la copia: '+(e&&e.message||e)); toast('No se pudo borrar la copia'); }
    render(); }, 'Borrar'); }
function deleteAllBackups(){ const n=BACKUPS.length; if(!n) return; const dev=UI.wide?'este dispositivo':'este iPhone';
  confirmSheet('Borrar todas las copias', (n===1?'La copia':'Las '+n+' copias')+' de '+dev+' se borrarán. No se puede deshacer. La copia automática vuelve mañana.', async()=>{
    try{ await BK.clear(); try{ localStorage.setItem(BK_SKIP, todayStr()); }catch(e){} await refreshBackups(); log('info','Copias locales borradas', {n}); toast(n===1?'Copia borrada':n+' copias borradas'); }
    catch(e){ log('error','No se pudieron borrar las copias: '+(e&&e.message||e)); toast('No se pudieron borrar las copias'); }
    render(); }, 'Borrar todas'); }
async function dailyBackup(force){ try{ const t=todayStr(); let skip=null; try{ skip=localStorage.getItem(BK_SKIP); }catch(e){} if(!force&&skip===t) return; if(force || !BACKUPS.some(b=>bkDay(b)===t&&(!b.owner||b.owner===(syncState().owner||null)))){ await BK.put(t); await refreshBackups(); log('info', force?'Copia local creada':'Copia local diaria', {date:t, tasks:DB.tasks.length}); if(onSettings()) render(); } }catch(e){ log('warn','Copia local no disponible: '+(e&&e.message||e)); } }
function restoreBackup(date){ const b=BACKUPS.find(x=>x.date===date); if(!b) return;
  // Never into another account: not while this device holds another account's data, and never a copy of an account other than the one these
  // data belong to (or the one signed in)
  if(SY&&syncOtherOwner()){ toast('Este dispositivo tiene datos de otra cuenta. No se puede restaurar ahora'); log('info','Restaurar con datos de otra cuenta: no'); return; }
  const mine=syncPrevOwner()||(SY&&SY.user&&SY.user.id)||null;
  if(b.owner&&mine&&b.owner!==mine){ toast('Esta copia es de otra cuenta. Inicia sesión con ella para restaurarla'); log('info','Copia de otra cuenta: no se restaura'); return; }
  const day=bkDay(b), when = day===todayStr()?'de hoy':day===addDays(todayStr(),-1)?'de ayer':'del '+fmtDate(day);
  // Signed in, the copy applies to every device (agreed with Enric): restored records get a new modified so they win, and what the copy lacks is deleted everywhere by the next sync
  const synced=!!(typeof SY!=='undefined'&&SY&&SY.user);
  confirmSheet('Restaurar copia '+when, synced?'Se sustituyen espacios, proyectos, notas de proyecto, tareas, pasos, notas de voz, adjuntos y contactos por los de esa copia ('+b.tasks+' tareas) en todos tus dispositivos. Lo creado después de esa copia se eliminará también en ellos.':'Se sustituyen espacios, proyectos, notas de proyecto, tareas, pasos, notas de voz, adjuntos y contactos por los de esa copia ('+b.tasks+' tareas). Podrás deshacerlo durante unos segundos.', async()=>{
    try{ const snap=await BK.get(date); if(!snap) return; const prev={spaces:DB.spaces, projects:DB.projects, tasks:DB.tasks, voiceNotes:DB.voiceNotes, attachments:DB.attachments, subtasks:DB.subtasks, projectNotes:DB.projectNotes, contacts:DB.contacts}, prevActive=DB.settings.activeSpace;
      DB.spaces=snap.data.spaces||prev.spaces; DB.projects=snap.data.projects||[]; DB.tasks=snap.data.tasks||[]; DB.voiceNotes=snap.data.voiceNotes||[];
      // Decision 29.5: the copy's attachment records (their files are on the device or in Storage for 24 hours more); a copy from before them keeps those of its tasks
      { const tids=new Set(DB.tasks.map(x=>x.id)); DB.attachments=Array.isArray(snap.data.attachments)?snap.data.attachments:prev.attachments.filter(a=>tids.has(a.taskId));
        DB.subtasks=Array.isArray(snap.data.subtasks)?snap.data.subtasks:prev.subtasks.filter(o=>tids.has(o.taskId)); // decision 46: the copy's steps; a copy from before them keeps those of its tasks
        const pids=new Set(DB.projects.map(p=>p.id)); DB.projectNotes=Array.isArray(snap.data.projectNotes)?snap.data.projectNotes:prev.projectNotes.filter(n=>pids.has(n.projectId)); // decision 47: the same for the project notes
        DB.contacts=Array.isArray(snap.data.contacts)?snap.data.contacts:prev.contacts; } // decision 48c: the copy's contacts; a copy from before them keeps today's
      if(synced){ const now=new Date().toISOString(); [DB.spaces,DB.projects,DB.tasks,DB.voiceNotes,DB.attachments,DB.subtasks,DB.projectNotes,DB.contacts].forEach(a=>a.forEach(r=>{ r.modified=now; })); log('info','Copia restaurada con sesión iniciada: se aplicará en todos los dispositivos', {date}); }
      foldVoiceNotes(DB); // decision 49: a copy from before it brings dictated voice notes: they go into Notas
      if(!DB.spaces.some(sp=>sp.id===DB.settings.activeSpace)){ DB.settings.activeSpace=DB.spaces[0].id; resetListState(); } save(); rollOver(); render(); haptic(10);
      log('info','Copia restaurada', {date, tasks:DB.tasks.length}); toast('Copia '+when+' restaurada', ()=>{ Object.assign(DB, prev); if(synced){ const now=new Date().toISOString(); [DB.spaces,DB.projects,DB.tasks,DB.voiceNotes,DB.attachments,DB.subtasks,DB.projectNotes,DB.contacts].forEach(a=>a.forEach(r=>{ r.modified=now; })); } DB.settings.activeSpace=prevActive; save(); });
    }catch(e){ log('error','Restaurar copia falló: '+(e&&e.message||e)); toast('No se pudo restaurar'); } }, 'Restaurar'); }

/* Export and import */
function exportData(){ return { app:'tareas', version:APP_VERSION, exported:new Date().toISOString(), spaces:DB.spaces, projects:DB.projects, tasks:DB.tasks, voiceNotes:DB.voiceNotes, attachments:DB.attachments, subtasks:DB.subtasks, projectNotes:DB.projectNotes, contacts:DB.contacts }; } // decision 48c: the contacts; decision 29.5: the list of attachments, not their files; decision 46: the steps; decision 47: the project notes
function exportJSON(){ const t=JSON.stringify(exportData(),null,2); if(navigator.share){ navigator.share({title:'Tareas (copia)', text:t}).catch(()=>copyText(t,'Copia JSON en el portapapeles')); } else copyText(t,'Copia JSON en el portapapeles'); }
// CSV for Excel in Spanish locales: semicolon separated, UTF-8 with BOM, one row per task.
// A cell that starts with = + - or @ gets a leading apostrophe: Excel runs it as a formula even when quoted.
function csvText(){ const q=v=>{ let s=String(v==null?'':v).replace(/"/g,'""').replace(/\r?\n/g,' '); if(/^[=+\-@\t\r]/.test(s)) s="'"+s; return '"'+s+'"'; }; const sp=Object.fromEntries(DB.spaces.map(s=>[s.id,s.name])); const pr={high:'Alta',mid:'Media',none:''};
  const head=['Espacio','Proyecto','Título','Fecha','Fecha límite','Prioridad','Tiempo estimado','Estado','Completada','Recordatorio','Se repite','Esperando a','Responsable','Aplazada','Notas','Pasos','Creada']; // decision 49: no Notas de voz column, they are in Notas; decision 38: Se repite, the rule in words; decision 46: Pasos, each with its box
  const rows=DB.tasks.slice().sort((a,b)=>(a.spaceId+(a.date||'9999')+a.created)<(b.spaceId+(b.date||'9999')+b.created)?-1:1).map(x=>{ const p=x.projectId?proj(x.projectId):null; const ps=stepsOf(x.id).map(o=>'['+(o.done?'x':' ')+'] '+o.title).join(' | ');
    return [sp[x.spaceId]||'', p?p.name:'', x.title, x.date||'', x.deadline||'', pr[x.priority]||'', x.estimate?estLabel(x.estimate).toLowerCase():'', x.status==='done'?'Hecha':x.status==='waiting'?'Por confirmar':'Pendiente', x.completed?localDay(x.completed)+' '+fmtTime(x.completed):'', x.reminder?localDay(x.reminder)+' '+fmtTime(x.reminder):'', repSummary(x.repeat), x.waitingFor||'', x.responsible||'', x.carried?'Sí':'', x.notes||'', ps, localDay(x.created)].map(q).join(';'); });
  return '﻿'+head.map(q).join(';')+'\r\n'+rows.join('\r\n')+'\r\n'; }
async function exportCSV(){
  const name='tareas-'+todayStr()+'.csv'; const blob=new Blob([csvText()],{type:'text/csv;charset=utf-8'});
  try{ const file=new File([blob],name,{type:'text/csv'}); if(navigator.canShare&&navigator.canShare({files:[file]})){ await navigator.share({files:[file],title:'Tareas'}); log('info','Exportado CSV (compartir)',name); return; } }
  catch(e){ if(e&&e.name==='AbortError') return; log('warn','Compartir CSV no disponible: '+(e&&e.message||e)); }
  try{ const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=name; document.body.appendChild(a); a.click(); setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); },1500); toast('Archivo '+name+' generado'); log('info','Exportado CSV (descarga)',name); }
  catch(e){ log('error','Exportar CSV falló: '+(e&&e.message||e)); copyText(csvText(),'CSV copiado al portapapeles'); }
}
async function exportFile(){
  const name='tareas-'+todayStr()+'.json'; const text=JSON.stringify(exportData(),null,2); const blob=new Blob([text],{type:'application/json'});
  try{ const file=new File([blob],name,{type:'application/json'}); if(navigator.canShare&&navigator.canShare({files:[file]})){ await navigator.share({files:[file],title:'Tareas'}); log('info','Exportado a archivo (compartir)',name); return; } }
  catch(e){ if(e&&e.name==='AbortError') return; log('warn','Compartir archivo no disponible: '+(e&&e.message||e)); }
  try{ const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=name; document.body.appendChild(a); a.click(); setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); },1500); toast('Archivo '+name+' generado'); log('info','Exportado a archivo (descarga)',name); }
  catch(e){ log('error','Exportar a archivo falló: '+(e&&e.message||e)); exportJSON(); }
}
// Merge an exported copy: unknown ids are added, known ids are replaced when the copy is newer.
// "1 nuevo, 3 actualizados": the import's summary, in the singular when it is one
const importLine = r => (r.added===1?'1 nuevo':r.added+' nuevos')+', '+(r.updated===1?'1 actualizado':r.updated+' actualizados');
function importData(text){
  const d=JSON.parse(text); if(!d||typeof d!=='object') throw new Error('Formato no reconocido');
  let added=0, updated=0;
  const merge=(arr,src)=>{ (Array.isArray(src)?src:[]).forEach(it=>{ if(!it||!it.id) return; const i=arr.findIndex(a=>a.id===it.id); if(i<0){ arr.push(it); added++; } else if((it.modified||'')>(arr[i].modified||'')){ arr[i]=it; updated++; } }); };
  merge(DB.spaces,d.spaces); merge(DB.projects,d.projects); merge(DB.tasks,d.tasks); merge(DB.voiceNotes,d.voiceNotes); merge(DB.attachments,d.attachments); merge(DB.subtasks,d.subtasks); merge(DB.projectNotes,d.projectNotes); merge(DB.contacts,d.contacts); // decision 48c
  DB.tasks.forEach(x=>{ if(x.carried===undefined) x.carried=false; });
  foldVoiceNotes(DB); // decision 49: an older export's voice notes go into Notas
  save(); rollOver(); log('info','Importación', {added, updated, spaces:(d.spaces||[]).length, projects:(d.projects||[]).length, tasks:(d.tasks||[]).length});
  return {added, updated};
}
function importSheet(){ openSheet(sheadHTML('Importar texto','Cancelar','Importar')+'<div class="hint">Pega aquí una copia exportada.</div><textarea placeholder="{ ... }"></textarea>', s=>{ const ta=$('textarea',s); ta.focus(); s.onclick=e=>{ const b=e.target.closest('[data-x]'); if(!b) return; if(b.dataset.x==='cancel'){ closeSheet(); return; } try{ const r=importData(ta.value); closeSheet(); render(); toast(importLine(r)); }catch(err){ log('warn','Importar texto: '+err.message); toast('El texto no es un JSON válido'); } }; }); }
function pickImportFile(){
  let inp=$('#importFile'); if(!inp){ inp=document.createElement('input'); inp.type='file'; inp.id='importFile'; inp.accept='application/json,.json,text/plain'; inp.style.cssText='position:fixed;left:-100px;top:0;width:1px;height:1px;opacity:0'; document.body.appendChild(inp); }
  inp.value=''; inp.onchange=()=>{ const f=inp.files&&inp.files[0]; if(!f) return; const rd=new FileReader(); rd.onload=()=>{ try{ const r=importData(rd.result); render(); toast(importLine(r)); }catch(err){ log('warn','Importar archivo '+f.name+': '+err.message); toast('El archivo no es una copia válida'); } }; rd.onerror=()=>{ log('error','No se pudo leer '+f.name); toast('No se pudo leer el archivo'); }; rd.readAsText(f); };
  inp.click();
}

/* Test data: about 150 tasks in invented projects, all ids prefixed "demo-" so they can be removed cleanly */
const demoCount = () => DB.tasks.filter(x=>String(x.id).startsWith('demo-')).length;
function generateDemo(){
  let seed=20261031; const rnd=()=>{ seed=(seed*1103515245+12345)&0x7fffffff; return seed/0x7fffffff; }; const pick=a=>a[Math.floor(rnd()*a.length)];
  const batch=Date.now().toString(36); const sp=space().id; const now=new Date(); const t=todayStr();
  const projNames=[['Cliente FLC',0],['Verifactu',4],['Cash Application',3],['Propuesta Iberdrola',10],['Formación del equipo',5],['Administración',7]]; // the same colours as before decision 33 reordered COLORS
  const projects=projNames.map((pn,i)=>({id:'demo-p-'+batch+'-'+i, spaceId:sp, name:pn[0], color:COLORS[pn[1]], order:DB.projects.length+i, archived:false, created:now.toISOString(), modified:now.toISOString()}));
  const verbs=['Preparar','Revisar','Enviar','Cerrar','Actualizar','Llamar a','Validar','Redactar','Planificar','Documentar','Confirmar','Analizar'];
  const objs=['comité de seguimiento','SOW con legal','acta del steering','plan de cutover','RAID log','Marta por el presupuesto','mapping de Verifactu','propuesta de fase 2','sesión de formación','backlog de defectos','escenarios de prueba UAT','calendario de go-live','informe de horas','presentación a dirección','integración con BTP','matriz de riesgos','contrato marco','facturas pendientes','ampliación del equipo','notas del taller'];
  const noteTexts=['Pendiente de la respuesta del cliente.','Revisar con el equipo antes del jueves.','Incluye los cambios acordados en la última reunión.','Ver correo de ayer con el detalle.',''];
  const tasks=[], steps=[];
  const stepTexts=['Pedir los datos','Revisar el borrador','Enviar al cliente','Validar con el equipo','Preparar la plantilla','Confirmar la fecha'];
  for(let i=0;i<150;i++){
    const r=rnd(); let date=null; if(r<0.2) date=addDays(t,-1-Math.floor(rnd()*10)); else if(r<0.5) date=t; else if(r<0.8) date=addDays(t,1+Math.floor(rnd()*30));
    const pr=rnd(); const priority=pr<0.15?'high':pr<0.4?'mid':'none';
    const done=rnd()<0.2; const created=new Date(now.getTime()-Math.floor(rnd()*40)*864e5).toISOString();
    const completed=done?new Date(now.getTime()-Math.floor(rnd()*25)*864e5).toISOString():null;
    const projectId=rnd()<0.85?pick(projects).id:null;
    let reminder=null; if(!done&&rnd()<0.1){ const d=new Date(now.getTime()+Math.floor(rnd()*72)*36e5); d.setMinutes(0,0,0); reminder=d.toISOString(); }
    const id='demo-t-'+batch+'-'+i;
    tasks.push({id, title:pick(verbs)+' '+pick(objs), spaceId:sp, projectId, date, reminder, priority, status:done?'done':'pending', notes:pick(noteTexts), carried:false, created, modified:created, completed});
    if(rnd()<0.06){ const x=tasks[tasks.length-1], l=vnLine({text:'Nota dictada de prueba: '+pick(noteTexts.filter(Boolean)), created}); x.notes=(x.notes?x.notes+'\n\n':'')+l; } // decision 49: a dictated note is a line of Notas
    if(rnd()<0.12){ const n=2+Math.floor(rnd()*3); for(let k=0;k<n;k++) steps.push({id:'demo-s-'+batch+'-'+i+'-'+k, taskId:id, title:pick(stepTexts), done:done||rnd()<0.4, order:(k+1)*STEP_GAP, created, modified:created}); } // decision 46
  }
  DB.projects.push(...projects); DB.tasks.push(...tasks); DB.subtasks.push(...steps); save(); const n=rollOver(); render(); haptic(8);
  log('info','Datos de prueba generados', {projects:projects.length, tasks:tasks.length, steps:steps.length, rolledOver:n});
  toast(tasks.length+' tareas de prueba en '+projects.length+' proyectos');
}
function clearDemo(){
  const n=demoCount(); if(!n){ toast('No hay datos de prueba'); return; }
  confirmSheet('Eliminar '+n+' tareas de prueba', 'Se eliminan solo los elementos marcados como prueba. Tus datos no se tocan.', ()=>{
    const isDemo=x=>String(x.id).startsWith('demo-');
    DB.tasks=DB.tasks.filter(x=>!isDemo(x)); DB.projects=DB.projects.filter(x=>!isDemo(x)); DB.voiceNotes=DB.voiceNotes.filter(x=>!isDemo(x)); DB.subtasks=DB.subtasks.filter(x=>!isDemo(x));
    // Your own tasks filed in a test project stay, with no project; notes of removed tasks go with them
    const pids=new Set(DB.projects.map(p=>p.id)), tids=new Set(DB.tasks.map(x=>x.id)), now=new Date().toISOString(); let moved=0;
    DB.tasks.forEach(x=>{ if(x.projectId&&!pids.has(x.projectId)){ x.projectId=null; x.modified=now; moved++; } });
    const vn=DB.voiceNotes.length; DB.voiceNotes=DB.voiceNotes.filter(v=>tids.has(v.taskId)); DB.attachments=DB.attachments.filter(a=>tids.has(a.taskId)); DB.subtasks=DB.subtasks.filter(o=>tids.has(o.taskId)); DB.projectNotes=DB.projectNotes.filter(n=>pids.has(n.projectId)); // decision 47: notes of a test project go with it
    save(); render(); haptic(10);
    log('info','Datos de prueba eliminados', {tasks:n, unfiled:moved, voiceNotes:vn-DB.voiceNotes.length}); toast('Datos de prueba eliminados');
  });
}
