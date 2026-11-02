'use strict';
/* Tareas. Interaction: shared click and input events, search, stack navigation, row gestures and bottom sheets.
   A classic script: index.html loads every file of js/ in order and they share their global names. Only declarations and
   listeners run at load; the start itself (first screen, timers, sync, service worker) is in boot.js, the last file. */
/* ---------- Shared events ---------- */
function bindRows(box){
  if(!UI.select) box.querySelectorAll('.row:not(.first .row)').forEach(bindRowGestures);
  box.querySelectorAll('[data-day-head]').forEach(h=>bindLongPress(h, ()=>dayHeadMenu(h))); // R14: a long press on a day header moves its tasks
  bindNoteRows(box); // decision 47: the rows of the project notes (and the notes a search found)
  box.querySelectorAll('.first .row').forEach(r=>{ if(r._fc) return; r._fc=1; r.addEventListener('click',e=>{ if(e.target.closest('[data-act=check]')) return; if(HELD.has(r.dataset.id)) toggleHold(r.dataset.id); else openDetail(r.dataset.id); }); }); }
function bindCommon(scr){
  scr.addEventListener('click', onClick);
  bindRows(scr);
  if(!UI.wide) scr.querySelectorAll('.vn[data-vn], .vn[data-au], .vn[data-bk]').forEach(bindVnGestures); // voice notes, recordings (decision 29) and local copies (decision 34)
  if(!UI.wide) scr.querySelectorAll('.vn[data-bk] .cell').forEach(c=>bindLongPress(c, ()=>backupMenu(c.dataset.restore, {anchor:c}))); // decision 34: a copy's menu
  scr.querySelectorAll('[data-open-project]').forEach(b=>bindLongPress(b, src=>{ if(b.dataset.openProject!=='none') projectMenu(b.dataset.openProject, src); }));
  const s=$('[data-role=search]',scr); if(s) bindSearch(s, ()=>searchAround(s));
  bindBackSwipe(scr);
}
/* Search. The list follows the typing a moment after the last key, and the search field itself is never rebuilt:
   only what is around it changes (summary, filters, Cancelar and the list), so the keyboard stays open on the iPhone
   and the caret, an accent typed with a dead key or IME text being composed are never cut off. */
let searchT=null;
function bindSearch(s, around){
  s.dataset.shown=UI.query; // the query the screen around the field was drawn with
  if(s._sb) return; s._sb=1; let composing=false; // a field kept by a merge (R18) is bound once
  const go=()=>{ searchT=null; if(composing||!s.isConnected||s.closest('.hidden-tab')) return; if(UI.query===s.dataset.shown) return;
    if(!UI.query) UI.searchDone=false;
    if(around()){ s.dataset.shown=UI.query; return; }
    render(); }; // not expected: the screen has no search field where it should be
  const typed=()=>{ composing=false; UI.query=s.value; clearTimeout(searchT); searchT=setTimeout(go, 120); };
  s.addEventListener('compositionstart', ()=>{ composing=true; });
  s.addEventListener('input', e=>{ if(!e.isComposing) typed(); });
  s.addEventListener('compositionend', typed); // Chrome sends the last input of a composition before this event, still marked as composing
}
// iPhone: the Tareas screen is merged around the live field (R18): rows that still match stay where they are, the others go,
// and the summary, filters, Cancelar and the count follow; the field is never touched
function searchAround(s){ return drawing(()=>searchAroundNow(s)); }
function searchAroundNow(s){ const bar=s.closest('.searchbar'), sc=bar&&bar.parentElement, scr=sc&&sc.closest('.screen.root'); if(!scr||!sc.classList.contains('scroll')) return false;
  const html=lazyRows(viewTareas(), sc.scrollTop, innerHeight), stash=rowStash; if(!morphInto(scr, html, {keep:s})||!s.isConnected||!sc.isConnected) return false; rowStash=stash;
  armRows(sc); delete scr.dataset.dirty; scr.dataset.ver=dataVer;
  if(openRow&&!openRow.isConnected) openRow=null;
  bindRows(sc); const pc=sc.querySelector('.pchips'); if(pc) chipInView(pc);
  return true; }
function onClick(e){
  const scr=e.currentTarget;
  const entry=UI.wide?null:UI.stack.find(x=>x.el===scr); if(!UI.wide&&scr.classList.contains('pushed-screen')&&!entry) return; // a popped screen still sliding out takes no taps
  if(noteClick(e)) return; // decision 47: the segment Tareas and Notas, the notes' rows, boxes and buttons
  const f=e.target.closest('[data-filter]'); if(f){ DB.settings.filter=f.dataset.filter; UI.sumFilter=null; if(UI.wide) UI.deskView=f.dataset.filter; save(); render(); return; }
  const sm=e.target.closest('[data-sum]'); if(sm){ const k=sm.dataset.sum; UI.sumFilter=(k==='all'||UI.sumFilter===k)?null:k; haptic(6); render(); return; }
  const th=e.target.closest('button[data-theme]'); if(th){ DB.settings.theme=th.dataset.theme; save(); applyTheme(); render(); return; } // only the Tema buttons: <html> carries data-theme too
  const op=e.target.closest('[data-open-project]'); if(op){ if(UI.wide){ setDeskView('project:'+op.dataset.openProject); } else push('project', op.dataset.openProject); return; }
  const dv=e.target.closest('[data-view]'); if(dv){ setDeskView(dv.dataset.view); return; }
  const wk=e.target.closest('[data-week]'); if(wk){ calNav(wk.dataset.week); return; }
  const cv=e.target.closest('[data-cal-view]'); if(cv){ if(UI.deskView!==cv.dataset.calView) setDeskView(cv.dataset.calView); return; } // R19, R20: Día, Semana, Mes
  const cm=e.target.closest('[data-cal-mode]'); if(cm){ if(calMode()!==cm.dataset.calMode){ DB.settings.calMode=cm.dataset.calMode; save(); render(); } return; } // Lista or Horas
  const ow=e.target.closest('[data-open-week]'); if(ow){ openCalWeek(ow.dataset.openWeek); return; }
  const od=e.target.closest('[data-open-day]'); if(od){ openCalDay(od.dataset.openDay); return; }
  const mn=e.target.closest('[data-mini]'); if(mn){ openCalWeek(mn.dataset.mini); return; } // the sidebar's mini month
  const mc=e.target.closest('.minical [data-cal]'); if(mc){ UI.miniYM=shiftMonth(UI.miniYM||calAnchor().slice(0,7), +mc.dataset.cal); render(); return; }
  const wa=e.target.closest('[data-add-date]'); if(wa){ addSheet(wa.dataset.project||null,'',{date:wa.dataset.addDate}); return; } // R14: a day header in a project adds to that project
  const es=e.target.closest('[data-edit-space]'); if(es){ spaceSheet(es.dataset.editSpace); return; }
  const bka=e.target.closest('[data-bkact]'); if(bka){ const r=bka.closest('[data-bk]'); if(r){ closeVn(r); deleteBackup(r.dataset.bk); } return; } // decision 34
  const bkr=e.target.closest('.vn[data-bk]'); if(bkr&&bkr.dataset.open){ closeVn(bkr); return; } // a row showing Eliminar: a tap closes it
  const rb=e.target.closest('[data-restore]'); if(rb){ restoreBackup(rb.dataset.restore); return; }
  const pr=e.target.closest('[data-push-revoke]'); if(pr){ pushRevokeSheet(pr.dataset.pushRevoke); return; }
  const ua=e.target.closest('[data-unarchive]'); if(ua){ const p=proj(ua.dataset.unarchive); p.archived=false; p.modified=new Date().toISOString(); save(); render(); return; }
  const pf=e.target.closest('[data-pf]'); if(pf){ const v=pf.dataset.pf; UI.projFilter=(v===''||UI.projFilter===v)?null:v; haptic(4); render(); return; }
  // Decision 29: a photo opens the viewer (on the desktop a click; Comando or the right button offer its menu); a recording plays, seeks or goes
  const aa=e.target.closest('[data-aact]'); if(aa){ const el=aa.closest('.vn[data-au]'), id=el&&el.dataset.au; if(!id) return;
    if(aa.dataset.aact==='del'){ closeVn(el); deleteAttachment(id); return; } if(el.dataset.open){ closeVn(el); return; }
    if(aa.dataset.aact==='play'){ apToggle(id); return; }
    if(aa.dataset.aact==='seek'){ if(AP.id!==id){ apToggle(id); return; } const r=aa.getBoundingClientRect(); apSeek(id, (e.clientX-r.left)/r.width); return; } }
  const auEl=e.target.closest('.vn[data-au]'); if(auEl){ if(auEl.dataset.open){ closeVn(auEl); return; } if(UI.wide) audioMenu(auEl.dataset.au, e); return; }
  const ph=e.target.closest('.att-ph[data-att]'); if(ph){ const a=att(ph.dataset.att); if(a){ if(UI.wide&&(e.metaKey||e.ctrlKey)) photoMenu(a.id, e); else openViewer(a.taskId, a.id); } return; }
  const va=e.target.closest('[data-vact]'); if(va){ const el=va.closest('.vn'); const vid=el&&el.dataset.vn; closeVn(el); if(va.dataset.vact==='del') deleteVoiceNote(vid); else editVoiceNote(vid); return; }
  const vnEl=e.target.closest('.vn[data-vn]'); if(vnEl&&!e.target.closest('a')){ if(vnEl.dataset.open){ closeVn(vnEl); return; } if(UI.wide) voiceNoteMenu(vnEl.dataset.vn, e); return; }
  if(UI.select){ const row=e.target.closest('.row'); if(row && !row.closest('.first')){ toggleSelected(row); return; } }
  if(UI.wide){ const row=e.target.closest('.main .mbody .row[data-id]'); if(row && deskRowClick(e, row)) return; } // R16: Comando, Mayúsculas or the selection mode
  const act=e.target.closest('[data-act]'); if(!act) { const row=e.target.closest('.row');
    if(row && row.closest('.first')){ if(UI.wide){ if(HELD.has(row.dataset.id)) toggleHold(row.dataset.id); else openDetail(row.dataset.id); } return; } // on the iPhone bindCommon opens "Lo primero" rows; the desktop has only this handler
    if(row) { if(row.dataset.open==='1'){ closeRow(row); return; } if(HELD.has(row.dataset.id)){ toggleHold(row.dataset.id); return; } openDetail(row.dataset.id); } return; } // a tap on a marked row unmarks it
  const row=act.closest('.row'); const a=act.dataset.act;
  const detailId = UI.wide ? detailTaskId() : (entry&&entry.kind==='detail'?entry.id:null); // the task of the screen that was tapped, not of the stack top
  switch(a){
    case 'check': if(row) toggleHold(row.dataset.id); break; // R1: marked now, leaves with the others a moment later
    case 'tomorrow': { const id=row.dataset.id; releaseHold(id); closeRow(row); leaveRows(id); setTimeout(()=>{ tomorrowTask(id); renderAnimated(); },200); break; }
    case 'delete': if(row){ closeRow(row); confirmDelete(row.dataset.id); } else if(detailId){ confirmDelete(detailId, closeDetailOf(detailId)); } break;
    case 'clearSearch': UI.query=''; UI.searchDone=false; render(); break;
    case 'selDone': endSelect(); break;
    case 'closeDay': closeDaySheet(); break;
    case 'plan': planStart(); break;
    case 'review': reviewStart('carried'); break;
    case 'viewMenu': viewMenu(act); break;
    case 'exportCSV': exportCSV(); break;
    case 'selAll': selectAllVisible(); break;
    case 'bulkComplete': bulkComplete(); break;
    case 'bulkPostpone': bulkPostponeSheet(act); break;
    case 'bulkMove': bulkMoveSheet(act); break;
    case 'bulkDelete': bulkDelete(); break;
    case 'bulkDate': bulkDateMenu(act); break; // R16, desktop pane
    case 'bulkPriority': bulkPriorityMenu(act); break;
    case 'bulkSpace': bulkSpaceMenu(act); break;
    case 'searchDone': UI.searchDone=true; render(); break;
    case 'toggleSummary': toggleSummary(); break;
    case 'allDayMore': UI.allDayOpen=act.dataset.dayMore||null; render(); break; // decision 28d, the Día view
    case 'toggleDone': DB.settings.doneOpen=!DB.settings.doneOpen; save(); render(); break;
    case 'add': if(act.dataset.project!==undefined) addSheet(act.dataset.project||null); else addFromList(); break; // a project screen keeps its project
    case 'convertLines': { const id=detailTaskId(); if(id){ flushEdits(); convertNoteLines(id); } break; }
    case 'spaceMenu': spaceMenu(act); break;
    case 'back': pop(); break;
    case 'rowMenu': if(row) rowMenu(row.dataset.id, {anchor:act}); break; // the desktop three dots: the menu hangs from them (R17)
    case 'projFilterMenu': projFilterMenu(act); break;
    case 'weekModeMenu': weekModeMenu(act); break;
    case 'toggleTray': DB.settings.weekTray=DB.settings.weekTray===false; save(); render(); break;
    case 'setPri': if(detailId) setPriority(detailId, act.dataset.pr); break;
    case 'wcheck': { const c=act.closest('.wcard'); if(c){ act.classList.toggle('done'); act.classList.add('just'); setTimeout(()=>{ completeTask(c.dataset.id); renderAnimated(); },220); } break; }
    case 'newProject': projectSheet(null); break;
    case 'newSpace': spaceSheet(null); break;
    case 'menu': detailMenu(detailId, act); break;
    case 'share': shareTask(detailId); break;
    case 'pickProject': pickProjectSheet(detailId, UI.wide?act:act.querySelector('.val')||act); break; // R10: the menu hangs from the value, as an iOS pop-up button
    case 'pickPriority': priorityMenu(detailId, act.querySelector('.val')||act); break;
    case 'postpone': closeRow(row); postponeSheet(row.dataset.id, row); break;
    case 'pickDate': dateSheet(detailId, act); break; // on the desktop a popover anchored to the control (R17)
    case 'pickReminder': reminderSheet(detailId, act); break;
    case 'pickWaiting': if(detailId) waitingMenu(detailId, UI.wide?act:act.querySelector('.val')||act); break; // decision 41
    case 'toggleWaiting': UI.waitOpen=!UI.waitOpen; render(); break;
    case 'pickRepeat': if(detailId) repeatMenu(detailId, UI.wide?act:act.querySelector('.val')||act); break; // decision 38
    case 'focus': if(detailId) toggleFocus(detailId); break; // decision 39: the star of the detail and of the inspector
    case 'voice': voiceSheet(detailId); break;
    case 'attPhoto': if(detailId) pickPhotos(detailId); break; // decision 29: inside the tap, so iOS offers the camera or the library
    case 'attAudio': if(detailId) recordSheet(detailId); break;
    case 'export': exportJSON(); break;
    case 'backupNow': dailyBackup(true); toast('Creando copia'); break;
    case 'backupsClear': deleteAllBackups(); break;
    case 'shakeToggle': toggleShake(); break;
    case 'import': importSheet(); break;
    case 'exportFile': exportFile(); break;
    case 'importFile': pickImportFile(); break;
    case 'demo': generateDemo(); break;
    case 'demoClear': clearDemo(); break;
    case 'log': logSheet(); break;
    case 'logCopy': copyText(logText(),'Registro copiado'); break;
    case 'update': applyUpdate(); break;
    case 'signIn': syncSignIn(); break;
    case 'syncNow': syncRun('manual'); break;
    case 'signOut': syncSignOutSheet(); break;
    case 'pushEnable': pushEnable(); break; // block 9: inside the tap, so iOS shows the permission prompt
    case 'pushTest': pushTest(); break;
  }
}

/* ---------- Stack navigation ---------- */
// While a screen slides in or out, taps on the screens are ignored (as in UIKit): a double tap cannot hit the incoming detail or pop twice
let navT=0; function navLock(){ app.classList.add('navigating'); clearTimeout(navT); navT=setTimeout(()=>app.classList.remove('navigating'),520); }
function push(kind,id){
  const el=document.createElement('div'); el.className='screen pushed-screen pushed '+kind; el.dataset.kind=kind;
  // Only the new screen is drawn: the one it covers has not changed, so the slide starts right after the tap
  const below=underScreen(); app.appendChild(el); navLock(); const s={kind,id,el}; UI.stack.push(s); renderPushed(s); if(below) below.classList.add('under');
  requestAnimationFrame(()=>requestAnimationFrame(()=>{ el.classList.remove('pushed'); el.classList.add('shown'); }));
}
function openDetail(id){ if(UI.wide){ const ds=UI.dsel, plain=deskPlain()&&!!deskRow(id); UI.deskDetail=id; ds.cur=ds.anchor=id; ds.ids.clear(); ds.mode=false; if(plain) deskSelPane(); else render(); return; } push('detail', id); } // R15: the task in the inspector is the selected row
// R18: a desktop list with one selected row at most and no title being edited: opening, closing or moving the inspector changes only it and the highlight
function deskPlain(){ return UI.wide && deskListView() && !deskMulti() && !UI.dsel.mode && !UI.dsel.edit && !!$('#desk .main .mbody') && $('#desk')._mainKind==='list'; }
// The task the open detail shows: the desktop pane, or the top pushed screen on the iPhone
function detailTaskId(){ if(UI.wide) return UI.deskDetail; const cur=UI.stack[UI.stack.length-1]; return cur&&cur.kind==='detail'?cur.id:null; }
function pop(){
  if(UI.wide){ const plain=deskPlain(); UI.deskDetail=null; if(plain) deskSelPane(); else render(); return; }
  if(UI.select&&UI.select.scope==='project'){ UI.select=null; app.classList.remove('selecting'); }
  const s=UI.stack.pop(); if(!s) return; navLock();
  s.el.classList.remove('shown','dragging'); if(!RM.matches) s.el.style.transform=''; s.el.classList.add('pushed'); // with Reduce Motion it fades where the finger left it
  // The screen below shows again: drawn now if a render was asked while it was covered; if only the data changed (typing in the detail), after the slide
  let under = underScreen(); if(!under){ under=rootScreen(UI.tab); under.classList.remove('hidden-tab'); restoreRootScroll(under); } // never a blank screen behind
  if(s.kind==='note'){ noteLeft(s.id); if(UI.noteEdit===s.id) UI.noteEdit=null; under.dataset.dirty='1'; } // decision 47: a note left empty goes; the list behind shows the note as it is now, in its place
  drawIfDirty(under); under.classList.remove('under','dragging-under','dragging'); under.style.transform='';
  setTimeout(()=>{ s.el.remove(); fuGCSoon(); const u=underScreen(); if(!UI.stack.length&&typingIn(u)){ renderTabbar(); return; } if(u&&(u.dataset.dirty||+u.dataset.ver!==dataVer)) render(); },RM.matches?220:520); // a search tapped meanwhile keeps its keyboard
}
function underScreen(){ return UI.stack.length? UI.stack[UI.stack.length-1].el : app.querySelector('.screen.root:not(.hidden-tab)'); }
function bindBackSwipe(scr){
  if(!scr.classList.contains('pushed-screen')||scr.dataset.bs) return; scr.dataset.bs='1'; // once per screen: render() runs bindCommon on the same element again
  // live: this touch may move the screen; drag: it is moving it; pend (R4, detail only): it started away from the edge and waits for a sideways move
  let x0=0,y0=0,drag=false,live=false,pend=false,w=innerWidth,lastX=0,lastT=0,vx=0;
  const anywhere=scr.classList.contains('detail'); // R4: the detail goes back from anywhere, except from a text field or a voice note (its sideways swipe edits or deletes it)
  const isTop=()=>{ const t=UI.stack[UI.stack.length-1]; return !!t&&t.el===scr; };
  const under=()=>UI.stack.length>1?UI.stack[UI.stack.length-2].el:app.querySelector('.screen.root:not(.hidden-tab)');
  const reset=()=>{ const u=under(); scr.classList.remove('dragging'); scr.style.transform=''; if(u){ u.classList.remove('dragging-under'); u.style.transform=''; } };
  scr.addEventListener('touchstart',e=>{ const t=e.touches[0]; x0=lastX=t.clientX;y0=t.clientY; lastT=e.timeStamp; vx=0; w=innerWidth; pend=false;
    drag=live=x0<EDGE&&isTop()&&e.touches.length===1;
    if(!live&&anywhere&&isTop()&&e.touches.length===1&&!e.target.closest('input,textarea,select,[contenteditable],.vn')){ live=pend=true; }
    if(live) dragStart(); },{passive:true});
  scr.addEventListener('touchmove',e=>{ if(!live) return; const t=e.touches[0];
    if(pend){ const mx=t.clientX-x0, my=t.clientY-y0; if(Math.abs(my)>8&&Math.abs(my)>=Math.abs(mx)){ pend=false; return; } /* a scroll: the screen stays */ if(Math.abs(mx)<10) return; pend=false; if(mx<0) return; drag=true; }
    if(!drag) return; const dx=Math.max(0,t.clientX-x0); if(Math.abs(t.clientY-y0)>40&&dx<20){ drag=false; reset(); return; } /* it became a scroll: put both screens back */
    if(e.cancelable) e.preventDefault(); const now=e.timeStamp; if(now>lastT){ vx=0.6*(t.clientX-lastX)/(now-lastT)+0.4*vx; lastX=t.clientX; lastT=now; }
    const u=under(); if(!scr.classList.contains('dragging')) drawIfDirty(u); /* the screen behind shows from the first move: current, if a render waited for it */ scr.classList.add('dragging'); scr.style.transform='translate3d('+dx+'px,0,0)'; if(!RM.matches){ u.classList.add('dragging-under'); u.style.transform='translate3d('+(-33+33*dx/w)+'%,0,0)'; } },{passive:false}); // with Reduce Motion the screen behind stays still
  // R4: past a third of the width, or a quick flick to the right (a finger that stopped before lifting has no speed left)
  scr.addEventListener('touchend',e=>{ if(!live) return; live=pend=false; const was=drag; drag=false; if(!was){ dragEnd(true); return; } const dx=e.changedTouches[0].clientX-x0, v=e.timeStamp-lastT>80?0:vx, go=(dx>w/3||(v>FLICK&&dx>30))&&isTop(); if(go&&RM.matches) scr.classList.remove('dragging'); else reset(); if(go){ dragEnd(false); haptic(6); pop(); } else dragEnd(true); }); // with Reduce Motion a screen let go past a third fades out where it is
  scr.addEventListener('touchcancel',()=>{ if(!live) return; live=drag=pend=false; reset(); dragEnd(true); }); // a cancelled touch puts the screens back and never pops
}

/* ---------- Row gestures ---------- */
let openRow=null;
// A render that waited for a left swipe has replaced the row: open the new one in place, without sliding again
function reopenRow(old){ const id=old.dataset.id, scr=old.closest('.screen'); dragEnd(true); openRow=null;
  const r=scr&&[...scr.querySelectorAll('.row[data-id="'+id+'"]')].find(x=>x.querySelector('.row-bg')); if(!r) return;
  const c=r.querySelector('.row-content'); c.classList.add('drag'); r.classList.add('swiping','dir-l'); c.style.transform='translate3d(-160px,0,0)'; r.dataset.open='1'; openRow=r; requestAnimationFrame(()=>c.classList.remove('drag')); }
function closeRow(row){ if(!row) return; const c=row.querySelector('.row-content'); c.classList.remove('drag'); c.style.transform=''; row.classList.remove('armed'); const ic=row.querySelector('.row-bg.left span'); if(ic) ic.style.transform=''; row.dataset.open='0'; if(openRow===row) openRow=null; setTimeout(()=>{ if(row.dataset.open!=='1'&&!c.classList.contains('drag')) row.classList.remove('swiping','dir-l','dir-r'); },320); }
function bindRowGestures(row){
  const c=row.querySelector('.row-content'); if(!c||!row.querySelector('.row-bg')||row._gb) return; row._gb=1; // once per row: a merge (R18) keeps rows that are bound
  let x0=0,y0=0,dx=0,mode=null,lp=null,thr=false,edge=false,lastX=0,lastT=0,vx=0; // vx: the finger's speed in px/ms (R4)
  row.addEventListener('touchstart',e=>{ const t=e.touches[0]; x0=lastX=t.clientX;y0=t.clientY;dx=0;thr=false;vx=0;lastT=e.timeStamp; if(row.closest('.hidden-tab')){ mode='off'; return; } mode=null; dragStart(); // a row on a screen just put away (a tab slide settled by this touch) acts on nothing unseen
    edge=x0<EDGE&&!!row.closest('.pushed-screen'); // the left edge of a pushed screen belongs to the back swipe
    if(openRow&&openRow!==row) closeRow(openRow);
    lp=setTimeout(()=>{ if(mode===null){ mode='lp'; haptic(15); rowMenu(row.dataset.id, {row, x:x0, y:y0}); } },500); },{passive:true});
  row.addEventListener('touchmove',e=>{ const t=e.touches[0]; const mx=t.clientX-x0, my=t.clientY-y0;
    if(mode==='lp'){ e.preventDefault(); menuTrack(t.clientX, t.clientY); return; } // R10: the same finger slides over the menu's options
    if(mode===null){ if(Math.abs(my)>8){ mode='scroll'; clearTimeout(lp); } else if(Math.abs(mx)>10){ clearTimeout(lp); if(edge){ mode='edge'; return; } mode='swipe'; row.classList.add('swiping'); c.classList.add('drag'); } }
    if(mode!=='swipe') return;
    e.preventDefault(); const now=e.timeStamp; if(now>lastT){ vx=0.6*(t.clientX-lastX)/(now-lastT)+0.4*vx; lastX=t.clientX; lastT=now; }
    const base=row.dataset.open==='1'?-160:0; let raw=base+mx;
    if(raw<-160) raw=-160+(raw+160)*0.15; // elastic stop at the buttons
    if(raw>110) raw=110+(raw-110)*0.25;   // and a softer one past the complete threshold
    dx=Math.max(-176,Math.min(150, raw));
    c.style.transform='translate3d('+dx+'px,0,0)'; row.classList.toggle('dir-r', dx>0); row.classList.toggle('dir-l', dx<0);
    if(dx>0){ const ic=row.querySelector('.row-bg.left span'); if(ic) ic.style.transform='translate3d('+Math.max(10,dx-40)+'px,0,0) scale('+(0.6+0.4*Math.min(1,dx/90)).toFixed(3)+')'; }
    const passed = dx>90; if(passed&&!thr){thr=true;haptic(8);} if(!passed) thr=false; row.classList.toggle('armed', passed);
  },{passive:false});
  const end=e=>{ clearTimeout(lp); if(mode==='off'){ mode=null; return; } if(mode==='lp'&&e.cancelable) e.preventDefault(); // the menu is open: lifting the finger must not click it closed
    if(mode==='lp'){ const t=e.changedTouches[0]; mode=null; dragEnd(true); if(t) menuRelease(t.clientX, t.clientY); return; } // R10: lifted on an option, it runs
    if(mode!=='swipe'){ mode=null; dragEnd(true); return; } c.classList.remove('drag'); mode=null;
    // R4: a quick flick counts like a long drag. A finger that stopped before lifting has no speed left
    const v=e.timeStamp-lastT>80?0:vx, open=row.dataset.open==='1';
    if(dx>90 || (!open && v>FLICK && dx>40)){ // R1: the row slides back and stays, marked, while the circle fills; it leaves with the other marks
      const id=row.dataset.id; dragEnd(false); closeRow(row); toggleHold(id);
      setTimeout(()=>{ if(renderPending&&!touchDrag) render(); },330); } // a render that waited for the gesture runs once the row is back in place
    else if(open ? (dx<-70 && !(v>FLICK)) : (dx<-70 || (v<-FLICK && dx<-30))){ c.style.transform='translate3d(-160px,0,0)'; row.dataset.open='1'; openRow=row; dragEnd(false); if(renderPending) reopenRow(row); }
    else { closeRow(row); dragEnd(true); }
  };
  row.addEventListener('touchend',end);
  row.addEventListener('touchcancel',()=>{ clearTimeout(lp); const was=mode; mode=null; if(was==='off') return; if(was==='swipe') closeRow(row); dragEnd(true); }); // a cancelled touch never completes the task or opens the buttons
}
// Voice note rows: right reveals Editar (a long swipe opens it), left reveals Eliminar and stops there, like task rows.
// A recording (decision 29) has no Editar: it only slides to the left
let openVn=null;
function closeVn(el){ if(!el) return; const c=el.querySelector('.vn-c'); c.classList.remove('drag'); c.style.transform=''; delete el.dataset.open; if(openVn===el) openVn=null; setTimeout(()=>{ if(!el.dataset.open) el.classList.remove('dir-l','dir-r'); },300); }
function bindVnGestures(el){ if(el._vnb) return; el._vnb=1; let c=null,x0=0,y0=0,dx=0,mode=null,edge=false,thr=false; const left=!!el.querySelector('.vn-bg.l'); // once per element, as bindLongPress (R18)
  el.addEventListener('touchstart',e=>{ c=el.querySelector('.vn-c'); if(!c){ mode='off'; return; } const t=e.touches[0]; x0=t.clientX; y0=t.clientY; dx=0; mode=null; thr=false; edge=x0<EDGE&&!!el.closest('.pushed-screen'); if(openVn&&openVn!==el) closeVn(openVn); if(openRow) closeRow(openRow); },{passive:true});
  el.addEventListener('touchmove',e=>{ const t=e.touches[0], mx=t.clientX-x0, my=t.clientY-y0;
    if(mode===null){ if(Math.abs(my)>8) mode='scroll'; else if(Math.abs(mx)>10){ if(edge){ mode='edge'; return; } mode='swipe'; c.classList.add('drag'); } }
    if(mode!=='swipe') return; e.preventDefault();
    const base=el.dataset.open==='l'?-88:el.dataset.open==='r'?88:0; let raw=base+mx;
    if(raw<-88) raw=-88+(raw+88)*0.15; // stops at Eliminar
    if(raw>150) raw=150+(raw-150)*0.25;
    if(!left&&raw>0) raw=0;
    dx=Math.max(-104,Math.min(190,raw)); c.style.transform='translate3d('+dx+'px,0,0)'; el.classList.toggle('dir-r',dx>0); el.classList.toggle('dir-l',dx<0);
    const passed=dx>150; if(passed&&!thr){ thr=true; haptic(8); } if(!passed) thr=false; },{passive:false});
  const end=()=>{ if(mode!=='swipe'){ mode=null; return; } mode=null; c.classList.remove('drag');
    if(dx>150){ closeVn(el); editVoiceNote(el.dataset.vn); }
    else if(dx>50){ c.style.transform='translate3d(88px,0,0)'; el.dataset.open='r'; openVn=el; }
    else if(dx<-50){ c.style.transform='translate3d(-88px,0,0)'; el.dataset.open='l'; openVn=el; }
    else closeVn(el); };
  el.addEventListener('touchend',end); el.addEventListener('touchcancel',()=>{ mode=null; closeVn(el); }); }
/* Decision 27c: while a row's buttons (or a voice note's) are showing, the first touch anywhere else only closes it, as on iOS. That touch
   reaches no other handler (no detail, filter, figure, tab, button, long press, row swipe, tab slide or pull to refresh) and its click is
   dropped; the list may still scroll under it (native scrolling is left alone), but nothing acts on it. The open row's own buttons, and a
   sheet or menu on top, work as usual */
const shut={on:false, x:0, y:0, moved:false, t:0};
function shutOpen(){ if(UI.wide) return null; if(openRow&&!openRow.isConnected) openRow=null; if(openVn&&!openVn.isConnected) openVn=null; return openRow||openVn; }
window.addEventListener('touchstart', e=>{ shut.t=0; // the click of the last tap, if any, came already
  if(shut.on){ e.stopPropagation(); return; } // a second finger during that touch
  const o=shutOpen(); if(!o||o.contains(e.target)) return;
  if(sheet.classList.contains('on')||asheet.classList.contains('on')||PM) return;
  const t=e.touches[0]; Object.assign(shut, {on:true, x:t.clientX, y:t.clientY, moved:false});
  if(o===openRow) closeRow(o); else closeVn(o); e.stopPropagation(); }, {capture:true, passive:true});
window.addEventListener('touchmove', e=>{ if(!shut.on) return; const t=e.touches[0]; if(t&&Math.hypot(t.clientX-shut.x, t.clientY-shut.y)>10) shut.moved=true; e.stopPropagation(); }, {capture:true, passive:true});
const shutEnd=e=>{ if(!shut.on) return; e.stopPropagation(); if(e.touches.length) return; shut.on=false;
  if(e.type==='touchend'&&!shut.moved){ if(e.cancelable) e.preventDefault(); shut.t=performance.now(); } }; // a tap: no click, no focus
window.addEventListener('touchend', shutEnd, {capture:true, passive:false}); window.addEventListener('touchcancel', shutEnd, {capture:true, passive:true});
document.addEventListener('click', e=>{ if(shut.t&&performance.now()-shut.t<500){ shut.t=0; e.stopPropagation(); e.preventDefault(); } }, true); // a browser that still sends the click
function deleteVoiceNote(vid){ const i=DB.voiceNotes.findIndex(v=>v.id===vid); if(i<0) return; const [v]=DB.voiceNotes.splice(i,1); if(task(v.taskId)) updTask(v.taskId,{}); else save(); haptic(14); render(); log('info','Nota de voz eliminada');
  toast('Nota de voz eliminada', ()=>{ if(!DB.voiceNotes.some(x=>x.id===v.id)) DB.voiceNotes.push(v); save(); render(); }); }
function editVoiceNote(vid){ const v=DB.voiceNotes.find(x=>x.id===vid); if(v) voiceSheet(v.taskId, v.id); }
// R17: on the desktop a Mac menu at the pointer (popMenu draws it as macMenu); the iPhone has the swipes, and the same menu anchored to the note if called there
function voiceNoteMenu(vid, ev){ const el=document.querySelector('.vn[data-vn="'+CSS.escape(vid)+'"]'); const at=ev&&ev.clientX!=null&&UI.wide?{x:ev.clientX, y:ev.clientY}:{anchor:el};
  popMenu(Object.assign(at, {groups:[[{label:'Editar nota', icon:MI.pencil, fn:()=>editVoiceNote(vid)}],[{label:'Eliminar nota', icon:MI.trash, red:true, fn:()=>deleteVoiceNote(vid)}]]})); }
// Long press on a project: same 8 and 10 px tolerance as task rows; every touch starts with the flag clear, so a tap after a cancelled menu opens the project
// R10: fn gets {row, x, y} to lift the element; once the menu is open the same finger slides over its options and lifts on one
function bindLongPress(el, fn){ if(el._lpb) return; el._lpb=1; let t=null, x0=0, y0=0, fired=false; // once per element (R18)
  el.addEventListener('touchstart',e=>{ const p=e.touches[0]; x0=p.clientX; y0=p.clientY; fired=false; el.dataset.lp='0'; clearTimeout(t); t=setTimeout(()=>{ if(el.closest('.hidden-tab')) return; /* its screen was put away meanwhile (a tab slide settled by this touch) */ fired=true; haptic(15); el.dataset.lp='1'; fn({row:el, x:x0, y:y0}); },500); },{passive:true});
  el.addEventListener('touchmove',e=>{ const p=e.touches[0]; if(fired&&menuOpen()){ if(e.cancelable) e.preventDefault(); menuTrack(p.clientX, p.clientY); return; } if(Math.abs(p.clientY-y0)>8||Math.abs(p.clientX-x0)>10) clearTimeout(t); },{passive:false});
  el.addEventListener('touchend',e=>{ clearTimeout(t); if(fired&&e.cancelable) e.preventDefault(); const p=e.changedTouches[0]; if(fired&&menuOpen()&&p) menuRelease(p.clientX, p.clientY); }); // the menu is open: lifting the finger must not click
  el.addEventListener('touchcancel',()=>clearTimeout(t));
  el.addEventListener('click',e=>{ if(el.dataset.lp==='1'){ el.dataset.lp='0'; e.stopImmediatePropagation(); e.preventDefault(); } },true); }

/* ---------- Sheets ---------- */
const sheet=$('#sheet'), scrim=$('#scrim'), asheet=$('#asheet');
const dimApp = on => app.classList.toggle('sheet-open', !!on);
/* Decision 28b: sheetGuard, set by a sheet with text that can be lost (Nueva tarea, Nota de voz), returns null when it may close or
   {title, label, field} to ask first. The closes a person makes (a drag down, the backdrop, Cancelar or Descartar, Escape) go through
   requestCloseSheet; saving calls closeSheet directly */
let sheetGuard=null;
let sheetOnClose=null; // one shot, set by the sheet's owner: runs however the sheet closes (a button, the scrim, a drag down, Escape)
// A sheet just opened ignores a stray tap on the backdrop (a repeated or ghost tap from the same touch on iOS), and an early close is logged with its caller
let sheetOpenedAt=0; const sheetFresh=()=>performance.now()-sheetOpenedAt<450;
// The same guard for the menus and popovers of popMenu. On the iPhone, a tap in the first 450 ms after a tap opened it; a menu opened by a
// long press has no such tap (the finger was held on the row), so it is not guarded. On the desktop, only the second click of the double
// click that opened it (detail 2), so a Mac menu never ignores a quick single click. pickFresh(e): the same for a picker (a sheet on the iPhone)
let pmOpenedAt=0; const menuFresh=()=>performance.now()-pmOpenedAt<450;
const ghostClick = e => UI.wide ? e.detail>1&&menuFresh() : menuFresh();
const pickFresh = e => UI.wide ? e.detail>1&&menuFresh() : sheetFresh();
const ghostSheet = e => UI.wide ? !!e&&e.detail>1&&sheetFresh() : sheetFresh(); // the sheets' own guard follows the same rule on the desktop (centred dialogs)
function noteEarlyClose(kind){ const ms=Math.round(performance.now()-sheetOpenedAt); if(sheetOpenedAt&&ms<800) log('warn','Hoja cerrada a los '+ms+' ms ('+kind+')', String((new Error()).stack||'').split('\n').slice(2,5).map(l=>l.trim().slice(0,90)).join(' | ')); }
function openSheet(html, onOpen){ sheetOpenedAt=performance.now(); sheetOnClose=null; sheetGuard=null; sheet.classList.remove('addsheet','keysheet'); sheet.innerHTML='<div class="handle"></div>'+html; sheet.classList.add('on'); scrim.classList.add('on'); dimApp(true); bindSheetDrag(); onOpen&&onOpen(sheet); }
function closeSheet(){ if(sheet.classList.contains('on')||asheet.classList.contains('on')) noteEarlyClose('cerrar'); sheetGuard=null; closeMenu(true); sheet.classList.remove('on','drag','top'); sheet.style.transform=''; const al=asheet.classList.contains('on')&&asheet.classList.contains('alert'); asheet.classList.remove('on'); asheet.onclick=null; scrim.classList.remove('on','light'); dimApp(false); if(al) alertBack(); try{ stopRec&&stopRec(); }catch(e){} setTimeout(()=>{ if(!sheet.classList.contains('on')) sheet.innerHTML=''; if(!asheet.classList.contains('on')){ asheet.innerHTML=''; asheet.classList.remove('alert'); } },520); const oc=sheetOnClose; sheetOnClose=null; if(oc) oc(); if(staleView) setTimeout(flushStale, 0); } // a closed menu keeps no buttons or handler that a stray click could fire; data reloaded meanwhile is drawn now, unless the caller already redrew
function requestCloseSheet(){ const g=sheet.classList.contains('on')&&sheetGuard&&sheetGuard(); if(!g){ closeSheet(); return; }
  const back=()=>{ const f=g.field; if(f&&f.isConnected){ f.focus(); if(f.setSelectionRange){ const l=f.value.length; f.setSelectionRange(l,l); } } }; // inside the tap that chose it: iOS opens the keyboard again
  const go=()=>{ log('info','Hoja descartada con texto', g.label); if(g.discard) g.discard(); closeSheet(); };
  if(UI.wide) macAlert({title:g.title, text:g.text||'', ok:g.label, cancel:'Seguir editando', fn:go, onCancel:back});
  else actionSheet(g.title, [{label:g.label, red:true, fn:go}], back, 'Seguir editando'); }
/* An action menu opened over an open sheet (the Proyecto and Prioridad chips of Nueva tarea) is nested:
   Cancelar, a tap outside or Escape close only the menu and give the sheet back with what was typed */
let asheetNested=false, asheetCancel=null;
function closeAction(){ const al=asheet.classList.contains('alert'); asheet.classList.remove('on'); asheet.onclick=null; scrim.classList.remove('light'); setTimeout(()=>{ if(!asheet.classList.contains('on')){ asheet.innerHTML=''; asheet.classList.remove('alert'); } },480); if(al) alertBack(); }
function alertBack(){ const f=alertFocus; alertFocus=null; if(f&&f.isConnected&&f!==document.body&&!asheet.contains(f)) try{ f.focus({preventScroll:true}); }catch(e){} } // the focus goes back where it was before the alert
function cancelAction(){ if(asheetNested&&sheet.classList.contains('on')){ const f=asheetCancel; asheetCancel=null; closeAction(); f&&f(); } else closeSheet(); }
scrim.addEventListener('click', e=>{ if(ghostSheet(e)){ log('warn','Toque en el fondo ignorado justo al abrir una hoja'); return; } if(asheet.classList.contains('on')) cancelAction(); else requestCloseSheet(); });
function bindSheetDrag(){ const h=sheet; let y0=0,dy=0,drag=false,inner=null,lastY=0,lastT=0,vy=0,hh=1;
  // A scrolled inner box (a long textarea, the log) keeps the finger until it is back at its top; only then does the sheet follow it down
  const scroller=t=>{ for(let el=t; el&&el!==h; el=el.parentElement){ if(el.scrollHeight>el.clientHeight+1){ const o=getComputedStyle(el).overflowY; if(el.tagName==='TEXTAREA'||o==='auto'||o==='scroll') return el; } } return null; };
  // R4: the dimming and the screen behind follow the finger (p: 0 open, 1 closed); let go, they return to their classes with a transition
  const follow=p=>{ scrim.style.transition='none'; scrim.style.opacity=String(1-p);
    if(!UI.wide&&!RM.matches){ app.style.transition='none'; app.style.transform='scale('+(0.96+0.04*p).toFixed(4)+')'; } };
  const unfollow=()=>{ scrim.style.transition=''; scrim.style.opacity=''; app.style.transition=''; app.style.transform=''; };
  const reset=()=>{ h.classList.remove('drag'); h.style.transform=''; unfollow(); };
  h.ontouchstart=e=>{ const onHandle=!!e.target.closest('.handle'); drag=false; dy=0; vy=0; inner=null; if(h.scrollTop>0&&!onHandle) return; if(!onHandle) inner=scroller(e.target); y0=lastY=e.touches[0].clientY; lastT=e.timeStamp; hh=h.offsetHeight||1; drag=!(inner&&inner.scrollTop>0); };
  h.ontouchmove=e=>{ const y=e.touches[0].clientY;
    if(inner&&inner.scrollTop>0){ if(drag){ drag=false; dy=0; reset(); } return; } // the inner box is scrolling
    if(!drag){ if(!inner) return; drag=true; y0=lastY=y; lastT=e.timeStamp; dy=0; } // the inner box reached its top: from here the sheet follows
    const now=e.timeStamp; if(now>lastT){ vy=0.6*(y-lastY)/(now-lastT)+0.4*vy; lastY=y; lastT=now; }
    dy=Math.max(0,y-y0); if(dy>0){ h.classList.add('drag'); h.style.transform='translate3d(0,calc('+dy+'px - var(--kb)),0)'; follow(Math.min(1,dy/hh)); } }; // keeps the keyboard offset of .sheet.on
  // R4: it closes past 110 px or on a quick flick down (a finger that stopped before lifting has no speed left)
  h.ontouchend=e=>{ inner=null; if(!drag) return; drag=false; h.classList.remove('drag'); unfollow(); const v=e.timeStamp-lastT>80?0:vy; if(dy>110||(v>FLICK&&dy>30)){ if(sheetGuard&&sheetGuard()){ h.style.transform=''; requestCloseSheet(); } else closeSheet(); } else h.style.transform=''; }; // with text to lose, the sheet goes back up and asks
  h.ontouchcancel=()=>{ inner=null; if(!drag) return; drag=false; reset(); }; }
function actionSheet(title, items, onCancel, cancelLabel){ sheetOpenedAt=performance.now(); asheetNested=sheet.classList.contains('on'); asheetCancel=onCancel||null; asheet.classList.remove('alert'); scrim.classList.remove('light'); asheet.innerHTML='<div class="grp">'+(title?'<div class="t">'+esc(title)+'</div>':'')+items.map((it,i)=>'<button class="it'+(it.red?' red':'')+'" data-i="'+i+'">'+esc(it.label)+'</button>').join('')+'</div><div class="grp"><button class="it cancel" data-i="-1">'+esc(cancelLabel||'Cancelar')+'</button></div>'; asheet.classList.add('on'); scrim.classList.add('on'); dimApp(true); asheet.onclick=asheetClick(items); }
const asheetClick = items => e=>{ const b=e.target.closest('[data-i]'); if(!b) return; if(ghostSheet(e)){ log('warn','Toque en el menú ignorado justo al abrir'); return; } const i=+b.dataset.i; if(i<0){ cancelAction(); return; } asheetDone(); items[i].fn(); };
function asheetDone(){ if(asheetNested&&sheet.classList.contains('on')) closeAction(); else closeSheet(); }
/* Decision 28c: on the desktop a confirmation is a macOS alert: a small centred panel with the app icon, a bold title, the text and two
   buttons, Cancelar and the action on the right (red when it destroys). Intro runs the action and Esc cancels; Tab stays between the two
   buttons; the backdrop dims a little. It reuses the action sheet's element, so the modal rules (Escape, the backdrop) apply as they are.
   o: {title, text, ok, cancel, red (default true), fn, onCancel, more}. more (decision 38): other actions, [{label, fn, red}]; with them the
   buttons stack as in a macOS alert with three choices: the action first, the others, Cancelar last */
let alertFocus=null;
function macAlert(o){ sheetOpenedAt=performance.now(); asheetNested=sheet.classList.contains('on'); asheetCancel=o.onCancel||null; alertFocus=document.activeElement; const more=o.more||[];
  const def='<button class="al-btn def'+(o.red===false?'':' red')+'" data-i="0">'+esc(o.ok)+'</button>', cancel='<button class="al-btn" data-i="-1">'+esc(o.cancel||'Cancelar')+'</button>';
  asheet.classList.add('alert'); asheet.innerHTML='<div class="al" role="alertdialog" aria-modal="true" aria-labelledby="alT"'+(o.text?' aria-describedby="alX"':'')+'><img class="al-icon" src="icons/icon-192.png" alt=""><div class="al-t" id="alT">'+esc(o.title)+'</div>'+(o.text?'<div class="al-x" id="alX">'+esc(o.text)+'</div>':'')+
    (more.length?'<div class="al-b al-v">'+def+more.map((m,i)=>'<button class="al-btn'+(m.red?' red':'')+'" data-i="'+(i+1)+'">'+esc(m.label)+'</button>').join('')+cancel+'</div>':'<div class="al-b">'+cancel+def+'</div>')+'</div>';
  asheet.classList.add('on'); scrim.classList.add('on','light'); dimApp(true); asheet.onclick=asheetClick([{fn:o.fn}].concat(more));
  const d=$('.al-btn.def', asheet); if(d) d.focus({preventScroll:true}); }
const alertOn = () => asheet.classList.contains('on') && asheet.classList.contains('alert');
window.addEventListener('keydown', e=>{ if(!alertOn()) return; const bs=[...asheet.querySelectorAll('.al-btn')];
  if(e.key==='Enter'&&!e.isComposing){ e.preventDefault(); e.stopPropagation(); const d=$('.al-btn.def', asheet); if(d) d.click(); return; }
  if(e.key==='Escape'){ e.preventDefault(); e.stopPropagation(); cancelAction(); return; }
  if(e.key==='Tab'){ e.preventDefault(); e.stopPropagation(); const i=bs.indexOf(document.activeElement); const n=bs[(i<0?0:i+(e.shiftKey?bs.length-1:1))%bs.length]; if(n) n.focus(); return; }
  if(e.key===' '&&bs.includes(document.activeElement)) return; // Space presses the focused button
  e.stopPropagation(); }, true); // no other key reaches the page behind the alert
asheet.addEventListener('focusout', ()=>{ setTimeout(()=>{ if(alertOn()&&!asheet.contains(document.activeElement)){ const d=$('.al-btn.def', asheet); if(d) d.focus({preventScroll:true}); } }, 0); }); // the focus stays inside
// Destructive confirmations: the bottom action sheet on the iPhone, a macOS alert on the desktop (ok: the button's word there)
function confirmSheet(title, text, fn, ok){ if(UI.wide){ macAlert({title, text, ok:ok||(/^Eliminar/.test(title)?'Eliminar':title), fn}); return; } actionSheet(text, [{label:title, red:true, fn}]); }
