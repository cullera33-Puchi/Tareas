/* ---------- Comments and reminders in shared tasks (decision 90, v0.40.0) ----------
   A shared task carries a conversation: comments, with their author and time, and reminders sent through the app («En Tareas» in the sheet
   Enviar recordatorio), which are comments of kind 'nudge' addressed to one person. Both live in DB.shareComments and travel as
   shared_comments (0018_shared_comments.sql), sealed with the task's key like its title. No notification on the phone:
   - a comment shows as a count of unread ones on the row (the comments newer than this person's readAt, their own part of the task);
     opening the task reads them;
   - a reminder shows as a window when the person reminded opens the app (or at once if it is open), once on all their devices (seen);
     closed without Entendido, a line «N recordatorios» stays at the top of Hoy. The sender sees in the task whether it was seen.
   Each person edits and deletes only their own; one reminder every 4 hours per task and person. Not in the status summary nor in the
   text of the task shared */
const CMI={ bubble:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12.5a7.5 7.5 0 01-11.2 6.5L4 20l1.2-4.1A7.5 7.5 0 1120 12.5z"/></svg>',
  send:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5.5 11.5L12 5l6.5 6.5"/></svg>' };
const NUDGE_GAP=4*3600e3; // decision 43(3): one reminder every 4 hours per task and person
const cmRec = id => DB.shareComments.find(c=>c&&c.id===id)||null;
const cmCmp = (a,b) => (a.created||'')<(b.created||'')?-1:(a.created||'')>(b.created||'')?1:String(a.id).localeCompare(String(b.id));
const cmOf = id => DB.shareComments.filter(c=>c&&c.taskId===id).sort(cmCmp);
const cmWho = uid => uid&&uid===shMe()?'Tú':teamFirst(teamMember(uid));
// The comments of others this person has not read (a reminder has its own window, it does not count here)
function cmUnread(x){ if(!x||!x.share) return 0; const me=shMe(), r=x.readAt||''; if(!me) return 0;
  return DB.shareComments.reduce((n,c)=>n+(c&&c.taskId===x.id&&c.kind!=='nudge'&&c.addedBy&&c.addedBy!==me&&(c.created||'')>r?1:0), 0); }
// The row: a bubble with the count while something is unread (iPhone on the grey line, desktop in its own slot)
function cmBadgeHTML(x){ const n=cmUnread(x); return n?'<span class="icm" title="'+(n===1?'1 comentario sin leer':n+' comentarios sin leer')+'">'+CMI.bubble+'<b>'+n+'</b></span>':''; }

/* ---------- Actions ---------- */
function cmMarkRead(x){ if(!x||!x.share||!cmUnread(x)) return; const now=new Date().toISOString(); x.readAt=now; x.vmod=now; save(); }
function addComment(taskId, text){ const x=task(taskId), me=shMe(), v=String(text||'').trim(); if(!x||!x.share||!me||!v) return null;
  const now=new Date().toISOString(), c={id:uid(), taskId, kind:'comment', body:v, toUser:null, groupId:null, seen:null, addedBy:me, created:now, modified:now};
  batch(()=>{ DB.shareComments.push(c); x.readAt=now; x.vmod=now; save(); }); haptic(6); log('info','Comentario añadido'); return c; }
function editComment(id){ const c=cmRec(id); if(!c||c.addedBy!==shMe()||c.kind==='nudge') return; flushEdits();
  openSheet(sheadHTML('Editar comentario', 'Cancelar', 'Guardar')+'<div class="wsheet"><textarea class="wfor rmsg" data-role="cmedit" rows="4">'+esc(c.body||'')+'</textarea></div>', s=>{ const ta=$('[data-role=cmedit]', s); ta.focus();
    s.onclick=e=>{ const b=e.target.closest('[data-x]'); if(!b) return; if(b.dataset.x!=='ok'){ closeSheet(); return; }
      const v=ta.value.trim(); if(!v){ ta.focus(); return; } closeSheet(); if(v===c.body) return; const old=c.body;
      c.body=v; c.modified=new Date().toISOString(); save(); render(); log('info','Comentario editado');
      toast('Comentario editado', ()=>{ const r=cmRec(id); if(!r) return; r.body=old; r.modified=new Date().toISOString(); save(); render(); }); }; }); }
function deleteComment(id){ const c=cmRec(id); if(!c||c.addedBy!==shMe()) return; const i=DB.shareComments.indexOf(c);
  DB.shareComments.splice(i,1); save(); render(); haptic(6); log('info','Comentario eliminado');
  toast('Comentario eliminado', ()=>{ if(cmRec(id)) return; c.modified=new Date().toISOString(); DB.shareComments.push(c); save(); render(); }); }
function cmMenu(id, at){ const c=cmRec(id); if(!c||c.addedBy!==shMe()) return;
  popMenu(Object.assign(at, {groups:[c.kind==='nudge'?[]:[{label:'Editar', fn:()=>editComment(id)}], [{label:'Eliminar', icon:MI.trash, red:true, fn:()=>deleteComment(id)}]].filter(g=>g.length)})); }

/* ---------- Reminders through the app ---------- */
// The member of the team a name stands for (whole name, first name or the contact's mail), not this person
const cmMemberOf = name => { const k=personKey(name), me=shMe(); return k ? TM.dir.find(m=>m.id!==me&&memberIs(m, k))||null : null; };
// Whether the reminder can go through the app: a member of the team, and every task shared with them
function cmCanNudge(name, xs){ const m=cmMemberOf(name); return !!m && !!xs&&xs.length>0 && xs.every(x=>x&&x.share&&shOthers(x).some(o=>o.userId===m.id)) ? m : null; }
const cmRecent = (taskId, uidTo) => { const me=shMe(), lim=new Date(Date.now()-NUDGE_GAP).toISOString(); return DB.shareComments.some(c=>c&&c.kind==='nudge'&&c.taskId===taskId&&c.toUser===uidTo&&c.addedBy===me&&(c.created||'')>lim); };
function cmNudge(name, phrase, xs){ const m=cmCanNudge(name, xs), me=shMe(); if(!m||!me) return 0;
  const go=xs.filter(x=>!cmRecent(x.id, m.id)); if(!go.length){ toast('Ya se lo recordaste hace menos de 4 horas'); return 0; }
  const now=new Date().toISOString(), gid=uid(), body=String(phrase||'').trim()||null;
  batch(()=>{ go.forEach(x=>DB.shareComments.push({id:uid(), taskId:x.id, kind:'nudge', body, toUser:m.id, groupId:gid, seen:null, addedBy:me, created:now, modified:now})); save(); });
  log('info','Recordatorio enviado', {via:'app', n:go.length}); render();
  toast(go.length<xs.length?'Recordado a '+teamFirst(m)+'. '+(xs.length-go.length)+' ya lo estaban hace menos de 4 horas':'Recordado a '+teamFirst(m)+' en Tareas'); return go.length; }
// The reminders to this person not seen yet, by sending (a group sent together is one entry)
const cmNudgesForMe = () => { const me=shMe(); if(!me) return []; return DB.shareComments.filter(c=>c&&c.kind==='nudge'&&c.toUser===me&&!c.seen&&c.addedBy!==me).sort(cmCmp); };
function cmNudgeGroups(){ const by=new Map(); cmNudgesForMe().forEach(c=>{ const k=c.groupId||c.id; let g=by.get(k); if(!g) by.set(k, g=[]); g.push(c); }); return [...by.values()]; }
function cmSeen(list){ if(!list.length) return; const now=new Date().toISOString(); batch(()=>{ list.forEach(c=>{ c.seen=now; c.modified=now; }); save(); }); log('info','Recordatorio visto', {n:list.length}); }
// iPhone and desktop: a line at the top of Hoy while a reminder waits to be seen
function nudgeBannerHTML(){ const n=cmNudgeGroups().length; if(!n) return '';
  return '<div class="group recvban nudgeban"><button class="cell link" data-act="tmNudges">'+I.bell.replace('<svg','<svg class="rb-ic"')+'<span class="lbl">'+(n===1?'1 recordatorio':n+' recordatorios')+'</span>'+I.chev.replace('<svg','<svg class="chev"')+'</button></div>'; }
const NUDGE_SHOWN=new Set(); // the reminders already shown in this session: the window opens once by itself, then from the line
// After a pass, or when the app opens: the window, if a new reminder came and nothing is being typed or picked
function cmNudgeCheck(){ const fresh=cmNudgesForMe().filter(c=>!NUDGE_SHOWN.has(c.id)); if(!fresh.length) return;
  if(document.hidden||busyEditing()){ clearTimeout(cmNudgeCheck.t); cmNudgeCheck.t=setTimeout(cmNudgeCheck, 4000); return; }
  fresh.forEach(c=>NUDGE_SHOWN.add(c.id)); nudgeSheet(); }
function nudgeSheet(){ const gs=cmNudgeGroups(); if(!gs.length) return; flushEdits();
  const html=gs.map(g=>{ const c=g[0], who=teamFirst(teamMember(c.addedBy));
    return '<div class="ngrp"><div class="nh"><b>'+esc(who)+'</b> te ha recordado '+(g.length===1?'esta tarea':'estas tareas')+'<span class="nd">'+esc(fmtDateTime(c.created))+'</span></div>'+
      (c.body&&c.body!==CRYPTO_UNREAD?'<div class="nb">«'+esc(c.body)+'»</div>':'')+
      g.map(n=>{ const x=task(n.taskId); return '<button class="cell link ntask" data-ntask="'+esc(n.taskId)+'">'+esc(x?x.title||'Sin título':'Tarea compartida')+I.chev.replace('<svg','<svg class="chev"')+'</button>'; }).join('')+'</div>'; }).join('');
  openSheet(sheadHTML('Recordatorio', 'Cerrar', 'Entendido')+'<div class="wsheet nudgesheet">'+html+'</div>', s=>{ s.onclick=e=>{
    const t=e.target.closest('[data-ntask]'); if(t){ const id=t.dataset.ntask, x=task(id); cmSeen(cmNudgesForMe().filter(c=>c.taskId===id)); closeSheet(); render();
      if(x&&shPending(x)) setTimeout(()=>recvSheet(), 520); else if(x) setTimeout(()=>openDetail(id), 520); return; }
    const b=e.target.closest('[data-x]'); if(!b) return; if(b.dataset.x==='ok') cmSeen(cmNudgesForMe()); closeSheet(); render(); }; }); }

/* ---------- The group Comentarios of the detail and the inspector ---------- */
function cmRowHTML(c){ const me=shMe(), mine=c.addedBy===me, body=c.body===CRYPTO_UNREAD?'<i>(texto no legible)</i>':esc(c.body||'').replace(/\n/g,'<br>');
  if(c.kind==='nudge') return '<div class="cmt nudge'+(mine?' mine':'')+'" data-cm="'+esc(c.id)+'"><div class="cmh">'+I.bell+'<span><b>'+esc(cmWho(c.addedBy))+'</b> '+(mine?'recordaste':'recordó')+' a <b>'+esc(cmWho(c.toUser))+'</b></span><span class="cmd">'+esc(fmtDateTime(c.created))+'</span>'+
    '<span class="cms'+(c.seen?' on':'')+'">'+(c.seen?'visto':'sin ver')+'</span></div>'+(c.body?'<div class="cmb">'+body+'</div>':'')+'</div>';
  return '<div class="cmt'+(mine?' mine':'')+'" data-cm="'+esc(c.id)+'"><div class="cmh"><b>'+esc(cmWho(c.addedBy))+'</b><span class="cmd">'+esc(fmtDateTime(c.created))+(c.modified&&c.created&&c.modified>c.created&&c.kind==='comment'&&c.modified.slice(0,16)!==c.created.slice(0,16)?', editado':'')+'</span>'+
    (mine&&UI.wide?'<button class="cmore" data-cact="menu" aria-label="Opciones del comentario" title="Opciones">'+I.more+'</button>':'')+'</div><div class="cmb">'+body+'</div></div>'; }
function commentsGroupHTML(x){ if(!x||!x.share) return ''; const list=cmOf(x.id);
  return '<div class="group-title cmt-title">Comentarios'+(list.length?'<span class="steps-count">'+list.length+'</span>':'')+'</div>'+
    '<div class="group cmts" data-cmts="'+esc(x.id)+'">'+list.map(cmRowHTML).join('')+
    '<div class="cmt-add"><textarea class="cmtin" data-role="cmtadd" rows="1" enterkeyhint="send" placeholder="Escribe un comentario…" aria-label="Escribe un comentario"></textarea><button class="cmt-send" data-cact="send" aria-label="Enviar comentario" title="Enviar">'+CMI.send+'</button></div></div>'; }
const cmGrow = ta => { if(!ta||!ta.isConnected) return; ta.style.height='auto'; ta.style.height=Math.min(ta.scrollHeight, 160)+'px'; };
function cmSend(box){ const ta=box.querySelector('[data-role=cmtadd]'); if(!ta) return; const c=addComment(box.dataset.cmts, ta.value); if(!c) { ta.focus(); return; }
  ta.value=''; cmGrow(ta); const id=box.dataset.cmts; render();
  const again=document.querySelector('.cmts[data-cmts="'+CSS.escape(id)+'"] [data-role=cmtadd]'); if(again&&again!==document.activeElement) again.focus(); } // the field stays ready for the next one
function bindComments(scope){ const box=scope.querySelector('.cmts[data-cmts]'); if(!box) return; const x=task(box.dataset.cmts);
  if(x&&cmUnread(x)) setTimeout(()=>{ const y=task(box.dataset.cmts); if(y&&cmUnread(y)){ cmMarkRead(y); render(); } }, 400); // opening the task reads its comments
  if(box._cb) return; box._cb=1;
  box.addEventListener('input', e=>{ if(e.target.matches('[data-role=cmtadd]')) cmGrow(e.target); });
  box.addEventListener('keydown', e=>{ if(e.target.matches('[data-role=cmtadd]')&&e.key==='Enter'&&!e.shiftKey&&!e.isComposing){ e.preventDefault(); cmSend(box); } });
  box.addEventListener('click', e=>{ const s=e.target.closest('[data-cact=send]'); if(s){ e.preventDefault(); cmSend(box); return; }
    const row=e.target.closest('.cmt.mine[data-cm]'); if(!row) return; const m=e.target.closest('[data-cact=menu]');
    if(UI.wide&&!m) return; const r=(m||row).getBoundingClientRect(); cmMenu(row.dataset.cm, UI.wide?{x:r.left, y:r.bottom}:{anchor:row}); });
  if(UI.wide) box.addEventListener('contextmenu', e=>{ const row=e.target.closest('.cmt.mine[data-cm]'); if(!row) return; e.preventDefault(); cmMenu(row.dataset.cm, {x:e.clientX, y:e.clientY}); }); }
// The sync (syncCollect): a comment gone from this device goes up as deleted. Only its author removes one here (deleteComment); the
// server keeps anyone else's as it is (0018_shared_comments.sql), so this asks nothing more
const cmMayDelete = () => true;
