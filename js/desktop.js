'use strict';
/* Tareas. Desktop (900 px and wider): views, selected row, keyboard, multiple selection, drops on groups, sidebar and main column.
   A classic script: index.html loads every file of js/ in order and they share their global names. Only declarations and
   listeners run at load; the start itself (first screen, timers, sync, service worker) is in boot.js, the last file. */
/* ---------- Desktop layout ---------- */
function mondayOf(d){ const x=new Date(d+'T00:00:00'); return addDays(d, -((x.getDay()+6)%7)); }
function setDeskView(v){ if(v==='project:none') v='project:none'; if(UI.pitOpen) pitCollapse(true); /* decision 59 */ if(UI.noteOpen&&v!==UI.deskView&&v!=='project:'+((noteRec(UI.noteOpen)||{}).projectId)) noteLeft(UI.noteOpen); if(v!=="hoy"&&DB.settings.focusMode){ delete DB.settings.focusMode; save(); } /* decision 65d: another view ends focus mode */ UI.deskView=v; UI.deskDetail=null; UI.dsel.ids.clear(); UI.dsel.mode=false; UI.dsel.edit=null; UI.query=''; UI.searchDone=false; if(v==='hoy'||v==='todas'){ DB.settings.filter=v; save(); } render(); } // another list starts with nothing selected (R16)
/* ---------- R15, R16: the desktop lists' selected row, keyboard and multiple selection ----------
   UI.dsel.cur is the selected row, apart from the hover (the inspector, when open, shows it); arrows or J and K move it and the inspector
   follows, as in Mail. ids is the multiple selection (Comando clic, Mayúsculas clic, Comando A, Mayúsculas y flechas): it counts from two
   rows on, or from none in the mode the view menu starts (Seleccionar tareas), and then the pane offers the iPhone's bulk actions.
   order and idx remember the list as last drawn, so a row that leaves it (done, moved, deleted) hands the selection to its neighbour.
   The iPhone keeps its own selection mode (UI.select) */
function deskMulti(){ return UI.wide && (UI.dsel.mode || UI.dsel.ids.size>1); }
function deskListView(){ const v=UI.deskView; return v==='hoy'||v==='todas'||v==='ahora'||v==='waiting'||v.startsWith('person:')||(v.startsWith('project:')&&!deskNotesOn()); } // decision 65a: a person's view // decision 47: a project's Notas is not a list of tasks // decisions 39 and 41: Ahora and Por confirmar are lists too
// The rows of the visible list in order, with the placeholders of a long one; Ahora repeats rows and is left out
function deskOrder(){ return [...document.querySelectorAll('#desk .main .mbody .row[data-id], #desk .main .mbody .rph[data-id]')].filter(r=>!r.closest('.first')).map(r=>r.dataset.id); }
function deskRow(id){ return id?document.querySelector('#desk .main .mbody .row[data-id="'+CSS.escape(id)+'"]:not(.first .row)'):null; }
// The selection changed without the rows' markup: classes, ARIA and the one row the Tab key reaches.
// Only what differs is written, so the rows that keep their state are not marked as changed (R18)
function paintSel(){ const ds=UI.dsel, multi=deskMulti();
  document.querySelectorAll('#desk .main .mbody .row[data-id]').forEach(r=>{ if(r.closest('.first')) return; const id=r.dataset.id, s=multi&&ds.ids.has(id), c=!multi&&ds.cur===id, a=String(s||c), ti=ds.cur===id?0:-1;
    r.classList.toggle('selected', s); r.classList.toggle('cur', c); if(r.getAttribute('aria-selected')!==a) r.setAttribute('aria-selected', a); if(r.tabIndex!==ti) r.tabIndex=ti; });
  const f=deskRow(ds.cur)||[...document.querySelectorAll('#desk .main .mbody .row[data-id]')].find(r=>!r.closest('.first')); if(f&&f.tabIndex!==0) f.tabIndex=0; } // the list is one stop of the Tab key
// A row brought into view (a long list draws it first) and given the focus, which shows the ring when it came from the keyboard
function revealRow(id, focus){ let r=deskRow(id); const sc=document.querySelector('#desk .main .mbody');
  if(!r&&sc){ const ph=sc.querySelector('.rph[data-id="'+CSS.escape(id)+'"]'); if(ph){ ph.scrollIntoView({block:'nearest'}); fillRows(sc); r=deskRow(id); } }
  if(!r) return null; r.scrollIntoView({block:'nearest'}); if(focus!==false) r.focus({preventScroll:true}); return r; }
// After a desktop draw: the selection keeps only rows still listed, and a selected row that left hands over to its neighbour.
// The inspector follows it only after a key (follow); a task done or moved from the inspector stays shown and selected.
// Returns true when the pane must change (a redraw)
function syncSel(paneWas){ const ds=UI.dsel, key=UI.deskView+'|'+DB.settings.activeSpace, before=deskMulti();
  if(!deskListView()){ ds.ids.clear(); ds.mode=false; ds.edit=null; ds.cur=UI.deskDetail; ds.order=[]; ds.key=key; ds.follow=false; return false; }
  const order=deskOrder(), has=new Set(order); let redo=false;
  ds.ids.forEach(id=>{ if(!has.has(id)) ds.ids.delete(id); });
  if(ds.edit&&!has.has(ds.edit.id)) ds.edit=null;
  if(ds.cur&&!has.has(ds.cur)&&!(UI.deskDetail===ds.cur&&!ds.follow)){
    const i=ds.key===key?ds.order.indexOf(ds.cur):-1; let n=null;
    if(i>=0){ for(let k=i+1;k<ds.order.length&&!n;k++) if(has.has(ds.order[k])) n=ds.order[k]; for(let k=i-1;k>=0&&!n;k--) if(has.has(ds.order[k])) n=ds.order[k]; }
    if(ds.follow&&paneWas===ds.cur&&!deskMulti()){ UI.deskDetail=n; redo=true; }
    ds.cur=n; }
  if(!ds.mode&&ds.ids.size===1){ ds.cur=[...ds.ids][0]; ds.ids.clear(); }
  if(before!==deskMulti()) redo=true;
  const ci=order.indexOf(ds.cur); if(ci>=0) ds.idx=ci;
  ds.follow=false; ds.order=order; ds.key=key; return redo; }
function endDeskSelect(){ const ds=UI.dsel; ds.ids.clear(); ds.mode=false; ds.anchor=ds.cur; render(); }
// Seleccionar tareas (the view menu): plain clicks then add and remove rows, as on the iPhone; the selected row starts it
function startDeskSelect(){ const ds=UI.dsel; flushHeld(true); ds.mode=true; ds.ids.clear(); ds.edit=null; if(ds.cur&&deskRow(ds.cur)) ds.ids.add(ds.cur); UI.deskDetail=null; render(); }
// Comando A: every row of the list (the rows of a long list not drawn yet too)
function selectAllDesk(){ const ds=UI.dsel, o=deskOrder(); if(!o.length) return; flushHeld(true); o.forEach(id=>ds.ids.add(id)); if(!ds.cur||!o.includes(ds.cur)) ds.cur=o[0]; if(o.length>1||ds.mode) UI.deskDetail=null; else ds.ids.clear(); render(); }
function selRange(a, b){ const o=deskOrder(); let i=o.indexOf(a), j=o.indexOf(b); if(j<0) return []; if(i<0) i=j; if(i>j) [i,j]=[j,i]; return o.slice(i, j+1); }
// One selected task left of several: it shows in the inspector, which was showing the selection
function oneLeft(wasMulti){ const ds=UI.dsel; if(ds.mode||ds.ids.size!==1) return; const id=[...ds.ids][0]; ds.ids.clear(); ds.cur=id; ds.anchor=id; if(wasMulti||UI.deskDetail) UI.deskDetail=id; }
// A click on a row with Comando or Control (add or take it out), with Mayúsculas (the stretch from the last row clicked), or any click
// in the selection mode. A plain click is left to onClick: it selects the row and opens the inspector (openDetail)
function deskRowClick(e, row){ const ds=UI.dsel, id=row.dataset.id, mod=e.metaKey||e.ctrlKey;
  if(e.target.closest('.rowedit')) return true; // a click inside the title being edited stays there
  // R15: a double click edits the title in place. Read from the second click: the first one redrew the row, so no dblclick event reaches it
  if(e.detail===2&&!mod&&!e.shiftKey&&!ds.mode&&!row.closest('.first')&&!e.target.closest('button')){ startRowEdit(id); return true; }
  if(e.target.closest('[data-act=rowMenu]')||(!mod&&!e.shiftKey&&!ds.mode)) return false;
  if(!task(id)) return true; const was=deskMulti(); flushEdits(); flushHeld(true);
  if(e.shiftKey){ const r=selRange(ds.anchor&&deskRow(ds.anchor)?ds.anchor:ds.cur||id, id); if(!mod&&!ds.mode) ds.ids.clear(); else if(!ds.ids.size&&ds.cur&&deskRow(ds.cur)) ds.ids.add(ds.cur); r.forEach(i=>ds.ids.add(i)); ds.cur=id; }
  else { if(!ds.mode&&!ds.ids.size&&ds.cur&&ds.cur!==id&&deskRow(ds.cur)) ds.ids.add(ds.cur); // the row already selected joins the new one
    if(ds.ids.has(id)) ds.ids.delete(id); else ds.ids.add(id); ds.cur=id; ds.anchor=id; }
  if(deskMulti()) UI.deskDetail=null; else oneLeft(was);
  haptic(4); render(); return true; }
// Arrows (or J and K) move the selected row; with Mayúsculas they stretch the selection. With the inspector open it shows the new row
function moveSel(dir, extend){ const ds=UI.dsel, o=deskOrder(); if(!o.length) return; const i=o.indexOf(ds.cur), was=deskMulti();
  const n = i>=0 ? Math.max(0, Math.min(o.length-1, i+dir)) : ds.cur ? (dir>0?Math.min(ds.idx, o.length-1):Math.max(0, ds.idx-1)) : dir>0?0:o.length-1; // a row that just left: its neighbours
  const id=o[n]; ds.idx=n;
  // A new stretch starts at the selected row
  if(extend&&!ds.mode){ const a=was&&ds.anchor&&o.includes(ds.anchor)?ds.anchor:(i>=0?ds.cur:id); ds.anchor=a; ds.ids.clear(); selRange(a, id).forEach(k=>ds.ids.add(k)); ds.cur=id; if(deskMulti()) UI.deskDetail=null; else oneLeft(was); }
  else { if(!ds.mode){ ds.ids.clear(); ds.anchor=id; } ds.cur=id; if(UI.deskDetail&&!deskMulti()) UI.deskDetail=id; }
  if(was||deskMulti()) render(); else if(UI.deskDetail) deskSelPane(); else paintSel(); // the pane says how many; R18: one row to another changes only the highlight and the inspector
  revealRow(id); }
// The task the single-key shortcuts act on: the one the inspector shows, or the selected row while it is listed
function keyTarget(){ const id=UI.deskDetail||UI.dsel.cur; if(!id||!task(id)) return null; return id===UI.deskDetail||deskRow(id)||document.querySelector('#desk .main .rph[data-id="'+CSS.escape(id)+'"]')?id:null; }
// An action that may take the row out of the list: the selection, and the inspector, go on to the next row (as Mail)
function followAct(fn){ UI.dsel.follow=true; try{ fn(); } finally{ UI.dsel.follow=false; } }
function togglePane(){ if(deskMulti()) return; if(UI.deskDetail){ pop(); revealRow(UI.dsel.cur); return; } const id=keyTarget(); if(id){ openDetail(id); revealRow(id); } }
/* R15: the title edited in the row itself (Intro or a double click): Intro keeps it, Esc leaves it as it was, and a click elsewhere keeps it too.
   It is drawn by deskRowHTML from UI.dsel.edit, so a redraw meanwhile keeps the field and what was typed */
function startRowEdit(id){ const x=task(id); if(!x||!deskRow(id)||deskMulti()) return; flushEdits(); UI.dsel.edit={id, text:x.title, fresh:true}; UI.dsel.cur=id; render(); }
function endRowEdit(keep){ const ds=UI.dsel, ed=ds.edit; if(!ed) return false; ds.edit=null; const x=task(ed.id), inp=document.querySelector('#desk [data-role=rowedit]'); const v=(inp?inp.value:ed.text).replace(/\s+/g,' ').trim();
  const ok=keep&&x&&v&&v!==x.title;
  if(inp){ const t=document.createElement('div'); t.className='row-title'; t.textContent=(ok?v:x&&x.title)||'Sin título'; const row=inp.closest('.row'); inp.replaceWith(t); if(row) row.draggable=true; } // in place: a click elsewhere keeps its target
  if(ok){ const old=x.title; updTask(ed.id,{title:v}); log('info','Título cambiado en la fila'); toast('Título cambiado', ()=>updTask(ed.id,{title:old})); }
  return ok; }
/* R15: the single-key shortcuts of the desktop, the ones deskTaskMenu and dateMenu show. With several rows selected they act on all of them */
function deskShortcut(k){ const t=todayStr(), dates={h:t, m:addDays(t,1), v:nextWeekday(5,true), s:nextWeekday(1,true)}, pr={'1':'high','2':'mid','0':'none'};
  const del=k==='Delete'||k==='Backspace'; k=k.length===1?k.toLowerCase():k;
  if(deskMulti()){ if(!UI.dsel.ids.size) return false; const btn=a=>document.querySelector('#desk .pane.multi [data-act='+a+']');
    if(k==='c') bulkComplete(); else if(k==='a') bulkFocus(); else if(k in pr) bulkPriority(pr[k]); else if(k in dates) bulkDate(dates[k]); else if(k==='f') bulkDateMenu(btn('bulkDate')); else if(k==='p') bulkMoveSheet(btn('bulkMove')); else if(del) bulkDelete(); else return false; return true; }
  const id=keyTarget(); if(!id) return false; const x=task(id);
  if(k==='c'){ releaseHold(id); leaveRows(id); setTimeout(()=>{ if(!task(id)) return; followAct(()=>{ completeTask(id); renderAnimated(); }); revealRow(UI.dsel.cur); }, 200); }
  else if(k==='a'){ if(x.status==='pending'||x.focus) followAct(()=>toggleFocus(id)); } // decision 39
  else if(k in pr) setPriority(id, pr[k]);
  else if(k in dates){ followAct(()=>setTaskDate(id, dates[k])); revealRow(UI.dsel.cur); }
  else if(k==='f') dateSheet(id);
  else if(k==='p') pickProjectSheet(id);
  else if(del) confirmDelete(id, ()=>{ followAct(()=>renderAnimated()); revealRow(UI.dsel.cur); });
  else return false;
  return !!x; }
function shortcutsSheet(){ const k=(a,b)=>'<div class="kr"><span class="kk">'+a.map(x=>'<kbd>'+x+'</kbd>').join(' ')+'</span><span>'+b+'</span></div>', g=(t,rows)=>'<div class="kg"><div class="ks">'+t+'</div>'+rows.join('')+'</div>';
  openSheet('<h2>Atajos de teclado</h2><div class="keys">'+
    g('Lista', [k(['Arriba','Abajo'],'Tarea anterior o siguiente'), k(['J','K'],'Lo mismo'), k(['Mayúsculas','Abajo'],'Ampliar la selección'), k(['Espacio'],'Abrir o cerrar el detalle'), k(['Intro'],'Cambiar el título, también con doble clic'), k(['N'],'Nueva tarea, o nota en Notas'), k(['/'],'Buscar'), k(['Esc'],'Cerrar o quitar la selección')])+
    g('Varias tareas', [k([MODK,'clic'],'Añadir o quitar una'), k(['Mayúsculas','clic'],'Seleccionar un tramo'), k([MODK,'A'],'Seleccionar todas'), k(['Arrastrar'],'A un proyecto, a Hoy o a un día')])+
    g('Tarea seleccionada', [k(['C'],'Completar'), k(['A'],'Poner en Ahora o quitarla'), k(['1','2','0'],'Prioridad alta, media o ninguna'), k(['H','M'],'Hoy o mañana'), k(['V','S'],'Viernes o la próxima semana'), k(['F'],'Elegir fecha'), k(['P'],'Elegir proyecto'), k(['Supr'],'Eliminar')])+
    g('General', [k([MODK,'Z'],'Deshacer'), k(['?'],'Estos atajos')])+
    '</div><div class="sheet-actions"><span style="flex:1"></span><button class="btn primary" data-close>Hecho</button></div>', s=>{ s.classList.add('keysheet'); s.onclick=e=>{ if(e.target.closest('[data-close]')) closeSheet(); }; }); }
/* R16: the pane with several tasks selected: how many, which, and the iPhone's bulk actions plus Fecha, Prioridad and Mover a espacio */
function multiPaneHTML(){ const ds=UI.dsel, xs=[...ds.ids].map(task).filter(Boolean), n=xs.length, dis=n?'':' disabled';
  const b=(act,ic,l,key,red)=>'<button class="mact'+(red?' red':'')+'" data-act="'+act+'"'+dis+' aria-haspopup="'+(/Complete|Delete|Remind/.test(act)?'false':'menu')+'">'+ic+'<span class="l">'+l+'</span>'+(key?'<span class="k">'+key+'</span>':'')+'</button>';
  const list=xs.slice(0,6).map(x=>'<li>'+esc(x.title||'Sin título')+'</li>').join('')+(n>6?'<li class="more">y '+(n-6)+' más</li>':'');
  return '<section class="pane multi" aria-label="Tareas seleccionadas"><div class="screen detail"><header class="ihead"><button class="ix" data-act="selDone" aria-label="Quitar la selección" title="Quitar la selección (Esc)">'+XICON+'</button><span class="grow"></span></header><div class="scroll">'+
    '<h2 class="mtitle">'+(n?(n===1?'1 tarea seleccionada':n+' tareas seleccionadas'):'Ninguna tarea seleccionada')+'</h2>'+(n?'<ul class="mlist">'+list+'</ul>':'')+
    (ds.mode?'<p class="mhint">Haz clic en las tareas para añadirlas o quitarlas. Con Mayúsculas y clic, un tramo.</p>':'')+
    '<div class="mgroup">'+b('bulkComplete',MI.done,'Completar','C')+b('bulkPostpone',MI.postpone,'Aplazar')+b('bulkDate',MI.cal,'Fecha','F')+b('bulkMove',MI.folder,'Proyecto','P')+b('bulkPriority',MI.p3,'Prioridad')+(DB.spaces.length>1?b('bulkSpace',MI.space,'Mover a espacio'):'')+(n&&bulkRemindOn()?b('bulkRemind',MI.send,'Enviar recordatorio'):'')+'</div>'+ // decision 48c
    '<div class="mgroup">'+b('bulkDelete',MI.trash,'Eliminar','Supr',true)+'</div></div></div></section>'; }
// Decision 39: A with several rows selected puts them all in Ahora (none if they do not fit) or, when all are already there, takes them out
function bulkFocus(){ const xs=selectedTasks(); if(!xs.length) return; const ids=xs.map(x=>x.id); if(xs.every(x=>x.focus)) removeFromAhora(ids); else addToAhora(ids); }
// The desktop bulk actions the iPhone does not have; they end the selection and give one Deshacer, as the others
function bulkPriority(pr){ const xs=selectedTasks().filter(x=>x.priority!==pr), n=UI.dsel.ids.size; if(!n) return; const prev=xs.map(x=>({id:x.id, priority:x.priority}));
  batch(()=>xs.forEach(x=>updTask(x.id,{priority:pr}))); haptic(8); log('info','Prioridad en bloque: '+xs.length); endSelect();
  toast(bulkN(n)+' '+{high:'con prioridad alta',mid:'con prioridad media',none:'sin prioridad'}[pr], xs.length?()=>batch(()=>prev.forEach(p=>updTask(p.id,{priority:p.priority}))):null); }
function bulkPriorityMenu(src){ const s=selSet(); if(!s||!s.size) return;
  popMenu({anchor:src, align:'left', title:'Prioridad de '+bulkN(s.size), groups:[[['high','Alta',MI.p3,'1'],['mid','Media',MI.p2,'2'],['none','Ninguna',MI.p0,'0']].map(([k,l,ic,key])=>({label:l, icon:ic, key, fn:()=>bulkPriority(k)}))]}); }
function bulkDate(d){ const xs=selectedTasks().filter(x=>x.date!==d||x.carried); endSelect(); xs.forEach(x=>releaseHold(x.id)); rescheduleMany(xs, d, d?fmtDate(d).toLowerCase():''); }
function bulkDateMenu(src){ const s=selSet(); if(!s||!s.size) return; const t=todayStr();
  const ds=uniqueBy([['Hoy',t,'H'],['Mañana',addDays(t,1),'M'],['Viernes',nextWeekday(5,true),'V'],['Próxima semana',nextWeekday(1,true),'S']], o=>o[1]);
  popMenu({anchor:src, align:'left', title:'Fecha de '+bulkN(s.size), groups:[ds.map(([l,d,k])=>({label:l, key:k, fn:()=>bulkDate(d)})), [{label:'Sin fecha', fn:()=>bulkDate(null)}], [{label:'Elegir fecha…', fn:()=>bulkCalendar(src)}]]}); }
function bulkCalendar(src){ let ym=todayStr().slice(0,7);
  pickerPanel('Fecha', '<div id="calwrap">'+calendarHTML(ym, null)+'</div>', null, src, null, (s, done)=>{
    s.onclick=e=>{ const nav=e.target.closest('[data-cal]'); if(nav){ ym=shiftMonth(ym,+nav.dataset.cal); $('#calwrap',s).innerHTML=calendarHTML(ym, null); return; }
      const c=e.target.closest('[data-d]'); if(c){ done(); bulkDate(c.dataset.d||null); } }; }); }
function bulkSpaceMenu(src){ const s=selSet(); if(!s||!s.size) return; const sps=DB.spaces.filter(sp=>sp.id!==space().id).sort((a,b)=>a.order-b.order); if(!sps.length) return;
  popMenu({anchor:src, align:'left', title:'Mover '+bulkN(s.size)+' a', groups:[sps.map(sp=>({label:sp.name, icon:MI.space, fn:()=>bulkSpace(sp)}))]}); }
function bulkSpace(sp){ const xs=selectedTasks(); if(!xs.length) return; const prev=xs.map(x=>({id:x.id, spaceId:x.spaceId, projectId:x.projectId}));
  xs.forEach(x=>releaseHold(x.id)); batch(()=>xs.forEach(x=>updTask(x.id,{spaceId:sp.id, projectId:null}))); haptic(8); log('info','Movidas a otro espacio en bloque: '+xs.length); endSelect();
  toast(bulkN(xs.length)+(xs.length===1?' movida a ':' movidas a ')+sp.name, ()=>batch(()=>prev.forEach(p=>updTask(p.id,{spaceId:p.spaceId, projectId:p.projectId})))); }
// R16: rows dropped on a sidebar project or Sin proyecto
/* Decision 36: rows dropped on a day group of a desktop list take that date (null: Sin fecha); the reminder goes with the day (decision 25),
   one Deshacer for all. An Aplazada dropped on Hoy stays today, confirmed */
function dropToDay(ids, day){ const t=todayStr(), xs=ids.map(task).filter(x=>x&&((x.date||null)!==day||(x.carried&&day===t))); if(!xs.length){ render(); return; }
  const prev=xs.map(daySnap); batch(()=>xs.forEach(x=>{ releaseHold(x.id); updTask(x.id, dayPatch(x, day)); })); haptic(6); renderAnimated();
  log('info','Tareas arrastradas a otro día de la lista', {n:xs.length, date:day});
  const where=day?fmtDate(day).toLowerCase():'';
  toast(xs.length===1?(day?'Movida a '+where:'Sin fecha'):bulkN(xs.length)+(day?' movidas a '+where:' sin fecha'), ()=>batch(()=>prev.forEach(undoDay))); }
function dropToProject(ids, pid){ const xs=ids.map(task).filter(x=>x&&(x.projectId||null)!==pid); if(!xs.length){ render(); return; }
  xs.forEach(x=>releaseHold(x.id)); if(ids.length===1){ moveToProject(xs[0].id, pid); haptic(6); return; } // its own toast and Deshacer
  const prev=xs.map(x=>({id:x.id, projectId:x.projectId})), p=pid?proj(pid):null; batch(()=>xs.forEach(x=>updTask(x.id,{projectId:pid}))); haptic(6); renderAnimated(); log('info','Tareas arrastradas a un proyecto', {n:xs.length});
  toast(bulkN(xs.length)+(xs.length===1?' movida a ':' movidas a ')+(p?p.name:'Sin proyecto'), ()=>batch(()=>prev.forEach(q=>updTask(q.id,{projectId:q.projectId})))); }
// R16: several rows dropped on a day, Hoy, a half hour or Sin fecha, with the rules of dropTask and one Deshacer
function dropMany(ids, z){ if(ids.length===1) return dropTask(ids[0], z); const xs=ids.map(task).filter(Boolean); if(!xs.length) return;
  const prev=xs.map(daySnap); let patch, msg; // decision 56b: the counters go back with Deshacer too
  if(z.dataset.slot){ const [day,hm]=z.dataset.slot.split('T'), iso=new Date(day+'T'+hm+':00').toISOString(); patch=x=>Object.assign({date:day, reminder:iso}, postPatch(x, day)); msg=' movidas a '+fmtDate(day).toLowerCase()+' a las '+fmtTime(iso); }
  else if(z.dataset.allday){ const day=z.dataset.day; patch=x=>remMin(x)!==null?Object.assign({date:day, reminder:null}, postPatch(x, day)):dayPatch(x, day); msg=' movidas a '+fmtDate(day).toLowerCase(); }
  else { const day=z.dataset.day||null; patch=x=>dayPatch(x, day); msg=day?' movidas a '+fmtDate(day).toLowerCase():' sin fecha'; }
  xs.forEach(x=>releaseHold(x.id)); batch(()=>xs.forEach(x=>updTask(x.id, patch(x)))); haptic(6); renderAnimated(); log('info','Tareas arrastradas a una fecha', {n:xs.length, date:z.dataset.day||z.dataset.slot||null});
  toast(bulkN(xs.length)+msg, ()=>batch(()=>prev.forEach(undoDay))); }
function applyWide(){ const w=wideMQ.matches; if(w===UI.wide) return; closeMenu(true); UI.wide=w; document.documentElement.classList.toggle('wide', w); document.body.classList.toggle('desktop', w); app.classList.toggle('desktop', w);
  if(w){ // the pushed iPhone screens map onto the desktop: a project becomes the view and the last detail the pane
    let pr=null; UI.deskDetail=null; UI.stack.forEach(s=>{ if(s.kind==='project') pr=s.id; else if(s.kind==='person') pr={person:s.id}; else if(s.kind==='note'){ const n=noteRec(s.id); if(n){ pr=n.projectId; UI.projTab[pr]='notes'; UI.noteOpen=n.id; } } else if(s.kind==='settings'){} /* the desktop shows Ajustes whole */ else UI.deskDetail=s.id; s.el.remove(); }); UI.stack=[]; // decision 47: a note opens in its project's Notas
    if(UI.select){ UI.select=null; app.classList.remove('selecting'); closeSheet(); } // an open bulk menu would act on nothing
    Object.assign(UI.dsel, {ids:new Set(), mode:false, edit:null, follow:false});
    if(pr&&pr.person) UI.deskView='person:'+pr.person; else if(pr) UI.deskView='project:'+pr; else if(UI.tab==='ajustes') UI.deskView='settings';
    else if(!isCalView(UI.deskView)) UI.deskView=DB.settings.filter; // the list the iPhone showed; the calendar has no iPhone screen, so it is kept
    app.querySelectorAll('.screen.root').forEach(s=>s.remove()); } // hidden on the desktop; render() rebuilds them on the way back
  else { const d=$('#desk'); if(d) d.remove(); app.classList.remove('has-pane'); Object.assign(UI.dsel, {ids:new Set(), mode:false, edit:null, follow:false}); // the iPhone has its own selection mode
    const v=UI.deskView; UI.tab = v==='settings'?'ajustes' : v.startsWith('project:')||v.startsWith('person:')?'proyectos' : 'tareas';
    // The desktop project view and pane become pushed screens, already in place (no slide-in)
    const put=(kind,id)=>{ const el=document.createElement('div'); el.className='screen pushed-screen shown '+kind; el.dataset.kind=kind; app.appendChild(el); UI.stack.push({kind,id,el}); };
    if(v.startsWith('person:')) put('person', v.slice(7)); // decision 65a
    if(v.startsWith('project:')){ const id=v.slice(8); if(id==='none'||proj(id)) put('project', id); const n=projTab(id)==='notes'&&noteRec(UI.noteOpen); if(n&&n.projectId===id&&proj(id)) put('note', n.id); } // decision 47: the open note stays open
    if(UI.deskDetail&&task(UI.deskDetail)) put('detail', UI.deskDetail);
    UI.deskDetail=null; } // the stack holds it now; a later widen maps it back
  log('info', w?'Modo escritorio':'Modo móvil'); render(); }
function deskSide(){
  const ps=activeProjects(); const pend=spaceTasks().filter(x=>x.status==='pending'); const cnt=id=>pend.filter(x=> id===null?!x.projectId:x.projectId===id).length; const v=UI.deskView;
  // R16: Hoy takes dropped rows and cards as today (data-day), a project or Sin proyecto as that project (data-drop-project)
  const it=(view,ic,label,n,on,attr)=>'<button class="it'+(on?' on':'')+'" data-view="'+view+'"'+(attr||'')+'>'+ic+'<span>'+label+'</span>'+(n!==undefined?'<span class="n">'+n+'</span>':'')+'</button>';
  return '<aside class="side"><button class="sp" data-act="spaceMenu">'+esc(space().name)+I.chevD+'</button>'+
    it('ahora',I.star,'Ahora',ahoraTasks().length,v==='ahora',' data-drop-ahora=""')+ // decision 39: above Hoy, and rows dropped on it go into Ahora
    it('hoy',I.list,isClosed()?'Mañana':'Hoy',hoyShown().length,v==='hoy',' data-day="'+(isClosed()?addDays(todayStr(),1):todayStr())+'"')+it('todas',I.inbox.replace('viewBox="0 0 48 48"','viewBox="0 0 48 48" stroke-width="3"'),'Todas',pendingFor('todas').filter(x=>x.status!=='waiting').length,v==='todas')+it('waiting',MI.wait,'Por confirmar',spaceTasks().filter(x=>x.status==='waiting').length,v==='waiting')+recvSideHTML()+ /* decision 63b */it('week',I.cal,'Semana',undefined,isCalView(v))+miniMonthHTML()+ // decision 41
    '<div class="sec">Proyectos</div>'+ps.map(p=>'<button class="it'+(v==='project:'+p.id?' on':'')+'" data-view="project:'+p.id+'" data-drop-project="'+p.id+'" aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"><span class="dot" style="background:'+p.color+'"></span><span>'+esc(p.name)+'</span><span class="n">'+cnt(p.id)+'</span></button>').join('')+
    '<button class="it'+(v==='project:none'?' on':'')+'" data-view="project:none" data-drop-project=""><span class="dot" style="background:var(--ink3)"></span><span>Sin proyecto</span><span class="n">'+cnt(null)+'</span></button>'+
    '<button class="it add" data-act="newProject">'+I.plus+'<span>Nuevo proyecto</span></button>'+peopleSideHTML()+ // decision 65a: Personas, under Proyectos
    '<div class="grow"></div>'+it('settings',I.gear,'Ajustes',undefined,v==='settings')+'</aside>';
}
function addBarHTML(projectId){ return '<div class="addx'+(AX.open?' open':'')+'"><div class="addbar">'+I.plus+qinHTML('<input type="text" placeholder="Nueva tarea… mañana, a las 9, !! o #proyecto" data-role="addbar"'+(projectId?' data-project="'+projectId+'"':'')+' value="'+esc(UI.addDraft||'')+'" autocomplete="off" spellcheck="false">')+'<span class="kbd">N</span></div>'+(AX.open?addxPanelHTML(projectId):'<div class="addhint" id="deskSaid"></div>')+'</div>'+pasteBoxHTML(projectId); } // decision 31: open, the composer under the bar
// The desktop add bar starts from today in Hoy and from the project in a project view; the title can say otherwise (R7)
// Decision 27b: in Hoy and Todas it also takes the project of the active project filter (the list ignores the filter during a search, so does the bar)
function deskAddBase(projectId){ const hoy=UI.deskView==='hoy', pf=(hoy||UI.deskView==='todas')&&!projectId&&!UI.query?filterProject():null;
  return {date:hoy?hoyAddDate():null, projectId:projectId||pf, priority:'none'}; } // the evening rule: in Hoy from 18:30 it proposes tomorrow
// R6: a list pasted into the desktop add bar waits under it until it is created or dropped
function pasteBoxHTML(projectId){ const ls=UI.addPaste; if(!ls||!ls.length) return ''; const b=deskAddBase(projectId); const n=ls.length+' '+(ls.length===1?'tarea':'tareas');
  return '<div class="pastebox"><div class="plhead"><span>'+n+'</span></div><div class="plist">'+ls.map((l,i)=>{ const r=quickTask(l,b); return '<div class="pl"><span class="t">'+esc(r.title||l)+'</span><span class="m">'+esc(quickMeta(r))+'</span><button class="x" data-paste-rm="'+i+'" aria-label="Quitar">×</button></div>'; }).join('')+'</div><div class="sheet-actions"><button class="btn" data-paste="cancel">Cancelar</button><span style="flex:1"></span><button class="btn primary" data-paste="ok">Crear '+n+'</button></div></div>'; }
// R11: the project filter of the desktop lists and week, a pop-up button in the column head (the iPhone keeps its chips).
// Hidden during a search, which ignores the filter
function pfDropHTML(){ if(UI.query||!activeProjects().length) return ''; const f=UI.projFilter, p=f&&f!=='none'?proj(f):null;
  return '<button class="pfdrop'+(f!==null?' on':'')+'" data-act="projFilterMenu" aria-haspopup="menu" title="Filtrar por proyecto">'+(f!==null?'<span class="dot" style="background:'+(p?p.color:'var(--ink3)')+'"></span>':'')+'<span class="l"><i>Proyecto:</i> '+esc(f===null?'Todos':p?p.name:'Sin proyecto')+'</span>'+I.chevD+'</button>'; }
function projFilterMenu(src){ const dot=c=>'<span class="pm-dot" style="background:'+c+'"></span>', set=v=>{ UI.projFilter=v; render(); };
  popMenu({anchor:src, align:'right', groups:[[{label:'Todos', on:UI.projFilter===null, fn:()=>set(null)}], activeProjects().map(p=>({label:p.name, icon:dot(p.color), on:UI.projFilter===p.id, fn:()=>set(p.id)})), [{label:'Sin proyecto', icon:dot('var(--ink3)'), on:UI.projFilter==='none', fn:()=>set('none')}]]}); }
/* Decision 58: the column header above a desktop list (Proyecto, Tarea and the right-hand columns some row of the list uses, by the same
   :has rules as the rows) and its resize handles. The widths are CSS custom properties on #desk (--col-proj, --col-per, --col-date, --col-dl,
   --col-rem, --col-est): rows and header read them, so a drag moves both with no redraw. A column the user never resized has no property
   and takes its default from the stylesheet, which differs with the inspector open (the narrower widths of point 22); a resized one keeps
   its width in both states. Kept in DB.settings.colWidths, a device setting that is not synced */
const COL_LIMITS={proj:[60,300], per:[70,320], date:[60,200], dl:[70,200], rem:[60,200], est:[44,140]}; // per: Persona (v0.33.1)
// The saved widths, with anything unknown or out of range dropped (an old or hand-edited setting)
function colWidths(){ const c=DB.settings.colWidths; if(!c||typeof c!=='object'||Array.isArray(c)){ if(c!==undefined) delete DB.settings.colWidths; return {}; }
  Object.keys(c).forEach(k=>{ const l=COL_LIMITS[k], w=c[k]; if(!l||typeof w!=='number'||!isFinite(w)||w<l[0]||w>l[1]) delete c[k]; else c[k]=Math.round(w); }); return c; }
function applyColWidths(d){ const c=colWidths(); Object.keys(COL_LIMITS).forEach(k=>{ if(c[k]) d.style.setProperty('--col-'+k, c[k]+'px'); else d.style.removeProperty('--col-'+k); });
  d.classList.toggle('colw-rem', !!c.rem); } // a resized reminder column shows its time with the inspector open too
function colHeadHTML(){ const g=k=>'<i class="colgrip" data-col="'+k+'" title="Arrastra para cambiar el ancho. Doble clic: ancho inicial"></i>', c=(k,l)=>'<span class="rc rc-'+k+'"'+(k==='rem'?' title="Recordatorio"':'')+'>'+g(k)+(k==='rem'?I.bell:'')+(l?'<span class="chl">'+l+'</span>':'')+'</span>';
  return '<div class="colhead" aria-hidden="true"><span class="ch-check"></span><span class="pcol"><span class="chl">Proyecto</span>'+g('proj')+'</span><span class="row-text"><span class="chl">Tarea</span></span>'+c('per','Persona')+'<span class="inds">'+indSlotsHTML()+'</span><span class="rsteps"><span class="chl">Pasos</span></span><span class="row-meta">'+c('date','Fecha')+c('dl','Entrega')+c('rem','')+c('est','Tiempo')+'</span><span class="pri"></span><span class="rowmore"></span></div>'; }
/* v0.37.2 (E1): a list's columns fit their content, and the title keeps at least 40 % of the row.
   1. Each column the person has not resized (colWidths) takes the width of its widest cell or of its header, between FIT_MIN and the width
      the stylesheet gives it (never wider than before). The widths go on .main as --col-<column>, over the defaults.
   2. While the title has less than 40 % of the row, the columns go under the title one by one in HIDE_ORDER (never one the person resized): the class hc-<column> on
      .main hides the column and shows its value in the row's grey line (.rsub, deskRowHTML). Nothing is lost, only moved.
   Run after every drawing of the desktop column and when the window changes width (ResizeObserver in bindDeskEvents). */
const FIT_COLS=['proj','per','date','dl','rem','est'], FIT_MIN={proj:48, per:56, date:40, dl:56, rem:40, est:34};
const HIDE_ORDER=['est','steps','rem','per','dl','date'];
const colSel = k => k==='proj'?'.pcol':k==='steps'?'.rsteps':'.rc-'+k;
function fitCols(d){ const main=d&&d.querySelector(':scope > .main'); if(!main) return;
  HIDE_ORDER.forEach(k=>main.classList.remove('hc-'+k)); FIT_COLS.forEach(k=>main.style.removeProperty('--col-'+k));
  const head=main.querySelector('.colhead'); if(!head||!head.offsetWidth||!main.querySelector('.mbody .row')) return;
  const user=colWidths(), keys=FIT_COLS.filter(k=>!(k in user)), cap={}, want={};
  keys.forEach(k=>{ const h=head.querySelector(colSel(k)); cap[k]=h?h.offsetWidth:0; });
  main.classList.add('colmeasure');
  try{ keys.forEach(k=>{ if(!cap[k]) return; let w=0; main.querySelectorAll('.mbody .row '+colSel(k)+', .colhead '+colSel(k)).forEach(c=>{ if(c.offsetWidth>w) w=c.offsetWidth; }); want[k]=w; }); }
  finally{ main.classList.remove('colmeasure'); }
  keys.forEach(k=>{ if(!cap[k]) return; const w=Math.min(cap[k], Math.max(FIT_MIN[k], want[k]+2)); if(w<cap[k]) main.style.setProperty('--col-'+k, w+'px'); });
  const title=head.querySelector('.row-text'), short=()=>title.offsetWidth < .4*head.clientWidth;
  for(const k of HIDE_ORDER){ if(!short()) break; if(k in user) continue; /* a width the person chose stays a column */ const h=head.querySelector(colSel(k)); if(h&&h.offsetWidth) main.classList.add('hc-'+k); } }
/* A handle drags the width of its column: Proyecto's sits on its right edge (the title takes the rest); a right-hand column's on its left
   edge, so dragging left widens it. Limits in COL_LIMITS; the width is written once per frame and saved on the drop; a double click resets */
function bindColResize(d){
  d.addEventListener('pointerdown', e=>{ const g=e.target.closest('.colgrip'); if(!g||e.button!==0) return; e.preventDefault(); e.stopPropagation();
    const k=g.dataset.col, l=COL_LIMITS[k], cell=g.parentElement, x0=e.clientX, w0=Math.round(cell.getBoundingClientRect().width), dir=k==='proj'?1:-1; let w=null, raf=0; // the width on screen, fitted or not
    try{ g.setPointerCapture(e.pointerId); }catch(err){} document.body.classList.add('resizing'); g.classList.add('on');
    const fitted=d.querySelector(':scope > .main'); if(fitted&&fitted.style.getPropertyValue('--col-'+k)){ fitted.style.removeProperty('--col-'+k); d.style.setProperty('--col-'+k, w0+'px'); } // v0.37.2: the width fitCols gave it starts the drag and no longer covers the person's
    const put=()=>{ raf=0; if(w==null) return; d.style.setProperty('--col-'+k, w+'px'); if(k==='rem') d.classList.add('colw-rem'); };
    const mv=ev=>{ w=Math.round(Math.max(l[0], Math.min(l[1], w0+dir*(ev.clientX-x0)))); if(!raf) raf=requestAnimationFrame(put); };
    const up=()=>{ g.removeEventListener('pointermove', mv); g.removeEventListener('pointerup', up); g.removeEventListener('pointercancel', up); if(raf){ cancelAnimationFrame(raf); put(); }
      document.body.classList.remove('resizing'); g.classList.remove('on');
      if(w!=null&&w!==(colWidths()[k]||null)){ DB.settings.colWidths=Object.assign(colWidths(), {[k]:w}); save(); log('info','Ancho de columna', {col:k, w}); } applyColWidths(d); fitCols(d); };
    g.addEventListener('pointermove', mv); g.addEventListener('pointerup', up); g.addEventListener('pointercancel', up); });
  d.addEventListener('dblclick', e=>{ const g=e.target.closest('.colgrip'); if(!g) return; e.preventDefault(); const c=colWidths(); if(!(g.dataset.col in c)) return;
    delete c[g.dataset.col]; DB.settings.colWidths=c; save(); applyColWidths(d); fitCols(d); });
  d.addEventListener('click', e=>{ if(e.target.closest('.colhead')) e.stopPropagation(); }, true); } // the header is not a row: a click on it does nothing
function deskMain(){
  const v=UI.deskView; let title='', body='', search=true, pf=false, seg='', notes=false, pit=null, pitProj=false, ph=null;
  if(v==='hoy') focusCheck(); const foco=v==='hoy'&&focusOn(); // decision 65d: focus mode, the list area shows only Ahora
  if(foco){ title='Ahora'; search=false; body=focusRowsHTML(); }
  else if(v==='hoy'||v==='todas'){ const f=v; title=f==='hoy'?(isClosed()?'Mañana':'Hoy'):'Todas'; pf=true; // the day closed: Hoy shows tomorrow
    body = addBarHTML(null)+colHeadHTML()+(UI.query||f==='hoy'&&isClosed()?'':ahoraHTML())+
      listHTML(UI.query?'todas':f); }
  else if(v==='ahora'){ title='Ahora'; body=colHeadHTML()+ahoraViewHTML(); } // decision 39
  else if(v==='waiting'){ title='Por confirmar'; body=colHeadHTML()+waitingViewHTML(); } // decision 41
  else if(v==='received'){ title='Recibidas'; search=false; body='<div class="recvview">'+recvListHTML()+'</div>'; } // decision 63b: tasks sent with Avisar a…
  else if(v.startsWith('person:')){ ph=personHeadHTML(v.slice(7)); title=personLabel(v.slice(7)); body=colHeadHTML()+personListHTML(v.slice(7)); } // decision 65a
  else if(isCalView(v)){ title={day:'Día',week:'Semana',month:'Mes'}[v]; pf=true; body=weekHTML(); } // the project filter applies here too, so it stays visible and clearable
  else if(v.startsWith('project:')){ const id=v.slice(8); const p=id==='none'?null:proj(id); if(id!=='none'&&(!p||p.archived||p.spaceId!==space().id)){ UI.deskView=DB.settings.filter||'hoy'; return deskMain(); } /* gone, archived or in another space */ title=p?p.name:'Sin proyecto';
    if(p){ notes=projTab(p.id)==='notes'; seg=projSegHTML(p)+(notes?pitBackHTML(p):''); pitProj=true; } body=notes?deskNotesHTML(p):addBarHTML(p?p.id:null)+colHeadHTML()+listHTML('todas', p?p.id:null); // decision 47: Tareas or Notas
    if(p&&!notes) pit=p; } // decision 59: the post-it column beside the tasks (the stylesheet shows it from 1300 px, without the inspector)
  else if(v==='settings'){ title='Ajustes'; search=false; const h=viewAjustes(); body=h.slice(h.indexOf('<div class="scroll">')); }
  const cal=isCalView(v);
  const pitOn=pit&&!pitFolded();
  if(foco) return '<main class="main focusmain"><div class="mhead"><h1>'+I.starF.replace('class="i-star on"','class="i-star on fstar"')+'Ahora<span class="fn">'+ahoraTasks().length+'</span></h1><button class="btn focusoff" data-act="focusOff">Salir del foco</button></div><div class="mbody"><div class="inner focusinner">'+body+'</div></div></main>';
  return '<main class="main'+(v==='hoy'?' with-agenda':'')+(pitOn?' with-pit':'')+(pitProj?' pit-proj':'')+'"><div class="mhead'+(cal?' wide-head':'')+(ph?' phead':'')+'">'+(ph?ph.title:'<h1>'+esc(title)+(v==='hoy'&&!UI.query?hoyLoadHTML():'')+'</h1>')+seg+(pf?'<span class="pfslot">'+pfDropHTML()+rfDropHTML()+'</span>':'')+(search?'<div class="searchbar"><div class="search">'+I.search+'<input type="search" placeholder="Buscar" value="'+esc(UI.query)+'" data-role="search" autocomplete="off"></div>'+(UI.query?'<button class="cancel" data-act="clearSearch">Cancelar</button>':'')+'</div>':'')+(pit?pitOpenBtnHTML(pit):'')+(ph?ph.btn:'')+(v==='hoy'||v==='todas'||(v.startsWith('project:')&&!notes)?'<button class="mopts" data-act="viewMenu" aria-label="Opciones de vista" title="Opciones de vista">'+I.more+'</button>':'')+'</div><div class="mbody'+(cal?' calbody':notes?' notesbody':'')+'"><div class="inner'+(cal?' week-inner':v==='settings'?' settings':notes?' notes-inner':'')+'">'+body+'</div></div>'+(v==='hoy'?agendaHTML():'')+(pitOn?pitColHTML(pit):'')+'</main>';
}
