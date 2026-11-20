'use strict';
/* Tareas. Shared tasks (decision 88; design point 43 closed again with the owner on 18 November).
   A classic script: index.html loads every file of js/ in order and they share their global names. Only declarations and
   listeners run at load; the start itself (first screen, timers, sync, service worker) is in boot.js, the last file.
   - Only with members of the team (js/team.js): «Compartir con…» (it replaces «Avisar a…») on any open task that does not repeat. The task
     becomes one task for everyone in it: whoever is in it edits and completes it; only who shared it (its owner) adds or removes people and
     deletes it for everyone; the others leave it («Salir de la tarea»).
   - Common to all (0016_shared.sql, shared_tasks): title, notes, steps, date, deadline, priority, estimate, status and the Aplazada mark and
     counters. Each person's own (shared_views): space, project, Ahora, reminder, responsible and Esperando a. Photos and audio stay with
     who added them (a second version). A task in DB.tasks with x.share (its owner's id) is shared; x.vmod is when its own part last changed
     (x.modified stays the common part's).
   - The sync (js/sync.js) treats the shared tasks as the rows of shared_tasks and shared_views, derived from the tasks (shTaskRecs,
     shViewRecs) and folded back after their merge (shFold); the rows of tasks and subtasks with their ids are left alone (shExcluded). Who
     is in each task is DB.shareMembers (shared_members), synced as any table.
   - Encryption: each task has its own AES-GCM key (32 random bytes), sealed for every person in it with their team key ('t1:', teamSeal,
     kind 'share') in their member row. Title, notes and steps go up as 's1:' + IV and ciphertext, with 'shared_tasks.<column>' as
     additional data; the server reads none of it. The opened keys stay in memory (SHK) and, as keys that cannot be read back, in IndexedDB
     ('share:<id>') for the service worker's reminders.
   - Received: a task shared with this person waits in Recibidas (with the old notices) until «Añadir a mis tareas» gives it a project in
     the active space (its view), or «No, gracias» leaves it.
   - Never logged: any text of a task or a key. */
const SHARE_RT=['shared_tasks','shared_members','shared_views','shared_comments']; // v0.40.0: the comments (decision 90)
const SH_COMMON=['title','notes','date','deadline','priority','estimate','status','completed','carried','postponed','carriedSince'];
const SH_OWN=['spaceId','projectId','focus','reminder','reminderSent','responsible','waitingFor','readAt']; // readAt: the comments read (decision 90)
const SH_PREFIX='s1:';
const SHK={raw:new Map(), key:new Map()}; // the opened keys of the shared tasks (SH is the hours grid's slot height)
const shMe = () => SY&&SY.user?SY.user.id:null;
const shIds = tasks => { const out=new Set(); (tasks||[]).forEach(x=>{ if(x&&x.share) out.add(x.id); }); return out; };
// Sharing is offered: a member of the team with their keys here, and a database with 0016
const shOn = () => teamOn() && !!TM.priv && !!SY.remote && !syncMissing('shared_tasks');
const isShared = x => !!(x&&x.share);
const shMine = x => !!x && !!x.share && x.share===shMe();
const shMembersOf = id => DB.shareMembers.filter(m=>m&&m.taskId===id);
const shActive = id => shMembersOf(id).filter(m=>!m.leftAt&&!m.removed);
// The others in a task (the owner included when it is not me), active ones
const shOthers = x => { const me=shMe(); return x?shActive(x.id).filter(m=>m.userId!==me):[]; };
// A task shared with me that I have not added to my tasks yet: it waits in Recibidas
const shPending = x => !!x && !!x.share && x.share!==shMe() && !x.spaceId && isOpenShare(x);
const isOpenShare = x => { const m=DB.shareMembers.find(r=>r&&r.id===x.id+':'+shMe()); return !m||(!m.leftAt&&!m.removed); };
const shPendingList = () => shMe()?DB.tasks.filter(shPending).sort((a,b)=>(a.modified||'')<(b.modified||'')?1:-1):[];

/* ---------- The rows of the sync ---------- */
const shStepCmp = (a,b) => (+a.order||0)-(+b.order||0) || String(a.id).localeCompare(String(b.id));
const shStepsJSON = steps => JSON.stringify((steps||[]).filter(s=>s&&s.id).slice().sort(shStepCmp).map(s=>({id:String(s.id), title:String(s.title||''), done:!!s.done, order:+s.order||0})));
function shTaskRecs(tasks, subtasks){ const ids=shIds(tasks); if(!ids.size) return []; const by=new Map();
  (subtasks||[]).forEach(s=>{ if(s&&ids.has(s.taskId)){ let a=by.get(s.taskId); if(!a) by.set(s.taskId, a=[]); a.push(s); } });
  return tasks.filter(x=>x&&x.share).map(x=>{ const r={id:x.id, share:x.share, created:x.created, modified:x.modified, steps:shStepsJSON(by.get(x.id))}; SH_COMMON.forEach(k=>{ r[k]=x[k]; }); r.status=shCommonStatus(r.status); if(x.status==='waiting'&&'cdate' in x) r.date=x.cdate;
    if(x.cxBad&&x.cxBad.length){ r.cxBad=x.cxBad.slice(); r.cxBad.forEach(f=>{ r[f]=CRYPTO_PLACEHOLDER; }); } return r; }); } // a text that did not open here never goes up (syncNoPlaceholder)
// v0.39.1: Por confirmar is each person's own (shared_views.waiting); the common part says pending. A common 'waiting' (written by v0.39.0) reads as pending
const shCommonStatus = s => s==='waiting'?'pending':s;
/* v0.40.0: the review day is this person's own too. While a shared task waits here, x.date is this person's review day (every list reads
   it as for any task) and x.cdate keeps the common date, which is what goes up; back to pending or done, the common date returns.
   cdate exists only then. A task that waited before this version has no cdate: its date was the common one and stays so */
function shViewRecs(tasks){ const me=shMe(); if(!me) return [];
  return tasks.filter(x=>x&&x.share&&x.spaceId).map(x=>{ const v={id:x.id+':'+me, taskId:x.id, created:x.vcreated||x.created, modified:x.vmod||x.modified}; SH_OWN.forEach(k=>{ v[k]=x[k]==null?null:x[k]; }); v.waiting=x.status==='waiting'; v.review=x.status==='waiting'&&x.date||null; return v; }); }
function shDerive(W){ W.shareTasks=shTaskRecs(W.tasks, W.subtasks); W.shareViews=shViewRecs(W.tasks); }
// A step changed after the task's common part: the task is newer (its steps go up with it). Called before the upload is collected
function shStepsBump(D){ let n=0; const by=new Map(); const ids=shIds(D.tasks); if(!ids.size) return 0;
  D.subtasks.forEach(s=>{ if(s&&ids.has(s.taskId)&&s.modified&&(!by.has(s.taskId)||s.modified>by.get(s.taskId))) by.set(s.taskId, s.modified); });
  D.tasks.forEach(x=>{ const m=x&&by.get(x.id); if(m&&m>(x.modified||'')){ x.modified=m; n++; } });
  if(n){ SY.quiet=true; try{ save(); } finally{ SY.quiet=false; } } return n; }
// A step deleted (or a deletion undone) has no time of its own left: the task's common part takes now
function stepTouch(taskId){ const x=task(taskId); if(x&&x.share) x.modified=new Date().toISOString(); }
// The rows of tasks and subtasks that belong to a shared task: never merged as such (a copy of before it was shared, its deletion)
function shExcluded(W, table){ if(table!=='tasks'&&table!=='subtasks') return null; const ids=shIds(W.tasks); if(!ids.size) return null;
  return table==='tasks' ? {rec:r=>ids.has(r.id), row:r=>ids.has(r.id)} : {rec:r=>ids.has(r.taskId), row:r=>ids.has(r.task_id)}; }
/* After the merge of the three tables: the common part into each task (new ones made), its steps replaced by the list, this person's part,
   and the tasks this person left or was taken out of (or that their owner deleted) gone, with their steps */
function shFold(W, st, stats){ const me=shMe(); let n=0; const gone=[];
  const recs=new Map((W.shareTasks||[]).filter(Boolean).map(r=>[r.id,r]));
  const views=new Map((W.shareViews||[]).filter(Boolean).map(v=>[v.taskId,v]));
  const mine=new Map((W.shareMembers||[]).filter(m=>m&&m.userId===me).map(m=>[m.taskId,m]));
  const idx=new Map(); W.tasks.forEach((x,i)=>{ if(x) idx.set(x.id,i); });
  const stepsOf=id=>W.subtasks.filter(s=>s&&s.taskId===id);
  recs.forEach((r,id)=>{ let x=idx.has(id)?W.tasks[idx.get(id)]:null;
    if(x&&x.share){ const now=shTaskRecs([x], stepsOf(id))[0]; if(syncSig(syncToRow('shared_tasks', now))===syncSig(syncToRow('shared_tasks', r))&&x.modified===r.modified) return; }
    if(!x){ x={id, spaceId:null, projectId:null, reminder:null, notes:'', status:'pending', priority:'none', carried:false, completed:null, created:r.created||r.modified}; W.tasks.push(x); idx.set(id, W.tasks.length-1); }
    const ow=x.status==='waiting', rd=x.date; // v0.39.1: this person's own Por confirmar stays (the view below may change it); v0.40.0: and their review day
    SH_COMMON.forEach(k=>{ x[k]=r[k]==null?(k==='notes'||k==='title'?'':null):r[k]; }); x.share=r.share||x.share; x.modified=r.modified; if(!x.created) x.created=r.created||r.modified;
    if(r.cxBad&&r.cxBad.length) x.cxBad=r.cxBad.slice(); else delete x.cxBad; // its texts that did not open (crUnread), kept as a local mark
    if(x.status!=='done'){ x.status=ow?'waiting':'pending'; if(ow){ x.cdate=x.date; x.date=rd; } } else delete x.cdate;
    if(x.repeat) x.repeat=null; if(x.someday) x.someday=null; // a shared task never repeats nor waits for some day
    let list=null; try{ list=JSON.parse(r.steps||'[]'); }catch(e){ list=null; } // a list that did not open (another key): the steps stay
    if(Array.isArray(list)&&shStepsJSON(stepsOf(id))!==shStepsJSON(list)){ const was=new Map(stepsOf(id).map(s=>[s.id,s]));
      W.subtasks=W.subtasks.filter(s=>!s||s.taskId!==id).concat(list.filter(s=>s&&s.id).map(s=>({id:String(s.id), taskId:id, title:String(s.title||''), done:!!s.done, order:+s.order||0, created:(was.get(String(s.id))||{}).created||r.modified, modified:r.modified}))); }
    n++; });
  // Deleted by its owner (the merge took it out of the list)
  W.tasks.forEach((x,i)=>{ if(x&&x.share&&!recs.has(x.id)){ W.tasks[i]=null; W.subtasks=W.subtasks.filter(s=>!s||s.taskId!==x.id); n++; if(x.share!==me&&x.spaceId) gone.push({title:x.title, by:x.share, why:'deleted'}); } });
  views.forEach((v,tid)=>{ const x=idx.has(tid)?W.tasks[idx.get(tid)]:null; if(!x||!x.share) return;
    const vw=!!v.waiting, wsame=x.status==='done'||((x.status==='waiting')===vw&&(!vw||!v.review||x.date===v.review)); // v0.39.1: Por confirmar, this person's own; v0.40.0: with their review day
    if(wsame&&SH_OWN.every(k=>(x[k]==null?null:x[k])===(v[k]==null?null:v[k]))&&x.vmod===v.modified) return;
    SH_OWN.forEach(k=>{ x[k]=v[k]==null?null:v[k]; });
    if(x.status!=='done'){ if(vw){ if(x.status!=='waiting') x.cdate=x.date; if(v.review) x.date=v.review; x.status='waiting'; }
      else { if(x.status==='waiting'&&'cdate' in x) x.date=x.cdate; delete x.cdate; x.status='pending'; } }
    x.vmod=v.modified; x.vcreated=v.created; n++; });
  // Left, or taken out by its owner
  W.tasks.forEach((x,i)=>{ if(!x||!x.share||x.share===me) return; const m=mine.get(x.id); if(!m||!(m.leftAt||m.removed)) return;
    W.tasks[i]=null; W.subtasks=W.subtasks.filter(s=>!s||s.taskId!==x.id); delete st.known.shared_tasks[x.id]; n++;
    if(m.removed&&!m.leftAt&&x.spaceId) gone.push({title:x.title, by:x.share, why:'removed'}); });
  W.tasks=W.tasks.filter(Boolean);
  if(n){ stats.shared=(stats.shared||0)+n; } if(gone.length) stats.shGone=(stats.shGone||[]).concat(gone); }
// What the fold took away from this person, said once (the first) and logged
function shNews(stats){ const g=stats&&stats.shGone; if(!g||!g.length) return; log('info','Compartidas: tareas que ya no están', {n:g.length});
  const o=g[0], who=teamFirst(teamMember(o.by)); toast(g.length>1?g.length+' tareas compartidas ya no están':(o.why==='deleted'?who+' ha eliminado «'+clipTitle(o.title)+'»':who+' ha dejado de compartir «'+clipTitle(o.title)+'»')); }
const clipTitle = t => { t=String(t||'Sin título'); return t.length>40?t.slice(0,39)+'…':t; };
/* A shared task gone from this device: only its owner deletes it for everyone. Anyone else leaves it (their member row, sent in the same
   upload); nothing is deleted on the server. Returns whether the deletion may go up */
function shMayDelete(id, dry, st){ const me=shMe(), ms=DB.shareMembers.filter(m=>m&&m.taskId===id), owner=(ms.find(m=>m.addedBy)||{}).addedBy||null;
  if(!owner||owner===me) return true;
  if(!dry){ delete st.known.shared_tasks[id]; const m=ms.find(r=>r.userId===me); if(m&&!m.leftAt){ m.leftAt=m.modified=new Date().toISOString(); log('info','Compartidas: tarea dejada'); } }
  return false; }

/* ---------- Keys ---------- */
// The keys of the shared tasks kept on this device go with the account: «Cerrar sesión» and a change of account (decision 75.8)
const shKeysForget = () => { SHK.raw.clear(); SHK.key.clear();
  return cryptoKdbDo('readwrite', st=>{ const q=st.openCursor(); q.onsuccess=()=>{ const c=q.result; if(!c) return; if(String(c.key).startsWith('share:')) c.delete(); c.continue(); }; }); };
const SH_AAD = (c, t) => cryptoTE.encode((t||'shared_tasks')+'.'+c);
async function shSetKey(id, raw){ const k=await cryptoSubtle().importKey('raw', cryptoUnb64(raw), {name:'AES-GCM', length:256}, false, ['encrypt','decrypt']);
  SHK.raw.set(id, raw); SHK.key.set(id, k); cryptoKdbDo('readwrite', s=>s.put({id:'share:'+id, key:k, owner:shMe()})).catch(()=>{}); return k; }
async function shEnc(k, v, c, t){ if(v==null||v===''||(typeof v==='string'&&v.startsWith(SH_PREFIX))) return v;
  const iv=cryptoRandom(12), ct=new Uint8Array(await cryptoSubtle().encrypt({name:'AES-GCM', iv, additionalData:SH_AAD(c, t)}, k, cryptoTE.encode(String(v))));
  const out=new Uint8Array(12+ct.length); out.set(iv); out.set(ct, 12); return SH_PREFIX+cryptoB64(out); }
async function shDec(k, v, c, t){ if(typeof v!=='string'||!v.startsWith(SH_PREFIX)) return v; const b=cryptoUnb64(v.slice(SH_PREFIX.length));
  return cryptoTD.decode(await cryptoSubtle().decrypt({name:'AES-GCM', iv:b.subarray(0,12), additionalData:SH_AAD(c, t)}, k, b.subarray(12))); }
// The keys of these tasks: here already, or opened from this person's member rows (here, or asked to the server)
async function shKeysFor(inner, ids){ const me=shMe(), miss=[...new Set(ids)].filter(id=>!SHK.key.has(id)); if(!miss.length||!me) return;
  if(!TM.priv) await teamKeys(); if(!TM.priv) throw new Error('Las claves del equipo no están todavía en este dispositivo');
  let rows=DB.shareMembers.filter(m=>m&&m.userId===me&&m.key&&miss.includes(m.taskId)).map(m=>({taskId:m.taskId, key:m.key}));
  const have=new Set(rows.map(m=>m.taskId)), ask=miss.filter(id=>!have.has(id));
  if(ask.length&&inner&&inner.byIds) rows=rows.concat(((await inner.byIds('shared_members', ask.map(id=>id+':'+me)))||[]).map(r=>({taskId:r.task_id, key:r.key})));
  for(const m of rows){ if(SHK.key.has(m.taskId)||!m.key) continue;
    try{ const o=await teamOpen(m.key, 'share'); if(o&&o.k) await shSetKey(m.taskId, o.k); }catch(e){ log('warn','Compartidas: la clave de una tarea no se puede abrir'); } } }
const SH_COLS=['title','notes','steps'];
// The tables sealed with a task's key: their columns and the task a row belongs to (v0.40.0: the comments, decision 90)
const SH_SEALED={shared_tasks:{cols:SH_COLS, tid:r=>r.id}, shared_comments:{cols:['body'], tid:r=>r.task_id}};
// Rows from the server, opened with their task's key; a value that does not open is marked unreadable (the merge keeps this device's)
async function shOpenRows(inner, rows, table){ if(!Array.isArray(rows)||!rows.length) return rows; const T=SH_SEALED[table||'shared_tasks'];
  const need=rows.filter(r=>r&&!r.deleted&&T.cols.some(c=>typeof r[c]==='string'&&r[c].startsWith(SH_PREFIX))).map(T.tid);
  if(need.length) await shKeysFor(inner, need);
  const out=[]; for(const r of rows){ if(!r||r.deleted||!need.includes(T.tid(r))){ out.push(r); continue; } const k=SHK.key.get(T.tid(r)), o=Object.assign({}, r);
    for(const c of T.cols){ if(typeof r[c]!=='string'||!r[c].startsWith(SH_PREFIX)) continue; try{ if(!k) throw new Error('sin clave'); o[c]=await shDec(k, r[c], c, table); }catch(e){ o[c]=CRYPTO_UNREAD; } }
    out.push(o); }
  return out; }
// Rows up, sealed with their task's key. A row whose task's key is not here is left out (the server answers without it and it is asked for again): one task never stops the whole pass
const SH_NOKEY=new Set();
async function shSealRows(inner, rows, table){ const T=SH_SEALED[table||'shared_tasks']; await shKeysFor(inner, rows.filter(r=>r&&!SHK.key.has(T.tid(r))).map(T.tid)); const out=[];
  for(const r of rows){ const k=SHK.key.get(T.tid(r)); if(!k){ if(!SH_NOKEY.has(T.tid(r))){ SH_NOKEY.add(T.tid(r)); log('warn','Compartidas: falta la clave de una tarea; sus cambios esperan', {table, id:T.tid(r)}); } continue; } const o=Object.assign({}, r);
    for(const c of T.cols) if(c in o) o[c]=await shEnc(k, o[c], c, table); out.push(o); }
  return out; }

/* ---------- Sharing, leaving, taking out ---------- */
async function shShare(id, userIds){ const x=task(id), me=shMe(); if(!x||!shOn()||!isOpen(x)) return false; flushEdits();
  const peers=userIds.map(teamMember).filter(m=>m&&m.pub&&m.id!==me); if(!peers.length) return false;
  if(x.share&&x.share!==me) return false;
  if(!x.share&&repParse(x.repeat)){ toast('Una tarea que se repite no se puede compartir'); return false; }
  let raw=SHK.raw.get(id);
  if(!x.share){ raw=cryptoB64(cryptoRandom(32)); await shSetKey(id, raw); }
  else if(!raw){ try{ await shKeysFor(SY.remote&&SY.remote.inner||SY.remote, [id]); }catch(e){} raw=SHK.raw.get(id); if(!raw){ toast('No se puede compartir ahora'); return false; } }
  const now=new Date().toISOString(), rows=[], back=[];
  const row=async(uid, pub)=>({id:id+':'+uid, taskId:id, userId:uid, key:await teamSeal(pub, {k:raw}, 'share'), leftAt:null, removed:null, addedBy:me, created:now, modified:now});
  if(!x.share) rows.push(await row(me, TM.pub));
  for(const m of peers){ const ex=DB.shareMembers.find(r=>r&&r.id===id+':'+m.id);
    if(ex){ if(ex.removed||ex.leftAt){ back.push(Object.assign({}, ex)); ex.removed=null; ex.leftAt=null; ex.modified=now; } continue; }
    rows.push(await row(m.id, m.pub)); }
  const was=x.share?null:{share:null, vmod:x.vmod, vcreated:x.vcreated, modified:x.modified, someday:x.someday||null};
  batch(()=>{ if(was){ x.share=me; x.vmod=now; x.vcreated=x.created; x.modified=now; if(x.someday) x.someday=null; } DB.shareMembers.push(...rows); save(); });
  haptic(8); log('info', was?'Compartidas: tarea compartida':'Compartidas: personas añadidas', {n:peers.length});
  toast(was?'Compartida con '+listY(peers.map(teamFirst)):listY(peers.map(teamFirst))+(peers.length===1?' se ha añadido':' se han añadido')); render(); return true; }
// The owner takes someone out; the task goes from their app with a notice
function shRemove(id, uid){ const x=task(id), m=DB.shareMembers.find(r=>r&&r.id===id+':'+uid); if(!shMine(x)||!m||m.removed) return;
  m.removed=m.modified=new Date().toISOString(); save(); log('info','Compartidas: persona quitada'); render();
  toast(teamFirst(teamMember(uid))+' ya no está en la tarea', ()=>{ m.removed=null; m.modified=new Date().toISOString(); save(); }); }
// This person leaves a task shared with them (or does not add it): gone from their app, nothing changes for the others
function shLeave(id, quiet){ const x=task(id), me=shMe(); if(!x||!x.share||x.share===me) return; const m=DB.shareMembers.find(r=>r&&r.id===id+':'+me);
  const now=new Date().toISOString(), i=DB.tasks.indexOf(x), ss=cutSteps(new Set([id]));
  batch(()=>{ if(i>=0) DB.tasks.splice(i,1); if(m){ m.leftAt=now; m.modified=now; } save(); }); log('info','Compartidas: tarea dejada'); render();
  if(!quiet) toast(x.spaceId?'Has salido de la tarea':'Tarea rechazada', ()=>{ batch(()=>{ if(!task(id)) DB.tasks.push(x); putSteps(ss); if(m){ m.leftAt=null; m.modified=new Date().toISOString(); } save(); }); render(); }); }
/* A deletion of several tasks (a selection, a space) with shared ones among them: what it means for them, said before (as confirmDelete
   does for one), and its Deshacer. Its owner deletes a task for everyone in it; anyone else leaves it (shMayDelete) */
function shDeleteText(xs){ const me=shMe(); if(!me) return ''; const own=xs.filter(x=>x&&x.share===me&&shOthers(x).length), got=xs.filter(x=>x&&x.share&&x.share!==me), a=[];
  if(own.length) a.push(own.length===1?'"'+clipTitle(own[0].title)+'" se eliminará también para '+listY(shOthers(own[0]).map(m=>teamFirst(teamMember(m.userId)))):own.length+' tareas compartidas se eliminarán también para las personas con las que las compartiste');
  if(got.length) a.push(got.length===1?'Saldrás de "'+clipTitle(got[0].title)+'", que te compartió '+teamFirst(teamMember(got[0].share))+'; para los demás no cambia nada':'Saldrás de '+got.length+' tareas que te compartieron; para los demás no cambia nada');
  return a.length?a.join('. ')+'. ':''; }
// Deshacer of such a deletion: the tasks shared with this person come back to it (the member row left meanwhile is taken back, as in shLeave)
function shUnleave(xs){ const me=shMe(), now=new Date().toISOString(); if(!me) return;
  xs.forEach(x=>{ if(!x||!x.share||x.share===me) return; const m=DB.shareMembers.find(r=>r&&r.id===x.id+':'+me); if(m&&m.leftAt){ m.leftAt=null; m.modified=now; } }); }
// Recibidas: added to this person's tasks, in the active space, with the project chosen
function shAccept(id, projectId){ const x=task(id); if(!shPending(x)) return; const now=new Date().toISOString();
  x.spaceId=space().id; x.projectId=projectId||null; x.vmod=now; x.vcreated=now; save(); haptic(8); log('info','Compartidas: tarea añadida'); teamRepaint(); // the Recibidas sheet loses its card too
  toast('Añadida a tus tareas', ()=>{ x.spaceId=null; x.projectId=null; x.vmod=new Date().toISOString(); save(); teamRepaint(); }); }

/* ---------- The sheet: who is in the task ---------- */
const canShare = x => !!x && shOn() && isOpen(x) && !repParse(x.repeat) && (!x.share||x.share===shMe()) && teamPeers().length>0;
const shPeopleText = x => { const o=shOthers(x); if(!o.length) return ''; return x.share===shMe()?'Compartida con '+listY(o.map(m=>teamFirst(teamMember(m.userId)))):'Compartida por '+teamFirst(teamMember(x.share))+(o.length>1?' con '+listY(o.filter(m=>m.userId!==x.share).map(m=>teamFirst(teamMember(m.userId)))):''); };
// The menu entries (iPhone long press, detail and desktop menus): «Compartir con…» or, in a task shared with me, «Personas de la tarea»
const shareItems = (x, icon) => !x ? [] : x.share&&x.share!==shMe() ? [{label:UI.wide?'Personas de la tarea…':'Personas de la tarea', icon:icon?TI.share:undefined, fn:()=>shareSheet(x.id)}]
  : canShare(x) ? [{label:UI.wide?'Compartir con…':'Compartir con', icon:icon?TI.share:undefined, fn:()=>shareSheet(x.id)}] : [];
// The detail and the inspector: the action and who is in it; the lines of the old notices (Avisar a…) under it
function shareCellHTML(x){ const ls=teamOn()?noticeLines(x):[], ppl=shPeopleText(x), act=x&&(x.share&&x.share!==shMe()||canShare(x)); if(!act&&!ppl&&!ls.length) return '';
  const lines=ls.map(l=>'<div class="ntline">'+esc(l)+'</div>').join(''), label=ppl||'Compartir con…';
  if(UI.wide) return (act?'<span></span><button class="iremind inotice ishare" data-act="tmShare">'+TI.share+esc(label)+'</button>':'')+(lines?'<span></span><div class="intnotes">'+lines+'</div>':'');
  return (act?'<div class="group"><button class="cell link remcell shcell" data-act="tmShare">'+TI.share+'<span class="lbl">'+esc(label)+'</span>'+(ppl?I.chev.replace('<svg','<svg class="chev"'):'')+'</button></div>':'')+(lines?'<div class="footnote ntnote">'+lines+'</div>':''); }
function shareSheet(id){ const x=task(id); if(!x) return; flushEdits(); const me=shMe(), owner=!x.share||x.share===me;
  const peers=teamPeers(), cur=new Set(shActive(id).map(m=>m.userId)); const pick=new Set([...cur].filter(u=>u!==me));
  const rowHTML=m=>{ const on=pick.has(m.id), ok=!!m.pub; return '<button type="button" class="pprow'+(ok?'':' off')+'" data-sh="'+esc(m.id)+'" role="option" aria-selected="'+on+'"'+(ok&&owner?'':' aria-disabled="true"')+'><span class="ppck">'+(on?MI.check:'')+'</span><span class="ppl">'+esc(teamName(m))+'<small>'+esc(ok?m.email:'Todavía no ha entrado en la app')+'</small></span></button>'; };
  if(!owner){ // a task shared with me: who is in it, and leaving
    const ppl=[x.share].concat([...cur].filter(u=>u!==x.share&&u!==me)).map(u=>teamMember(u)).filter(Boolean);
    const body='<div class="wsheet shsheet"><div class="hint">Compartida por '+esc(teamName(teamMember(x.share)))+'. Todos podéis editarla y completarla.</div><div class="pplist">'+ppl.map(m=>'<div class="pprow"><span class="ppck"></span><span class="ppl">'+esc(teamName(m))+'<small>'+esc(m.email)+(m.id===x.share?', la compartió':'')+'</small></span></div>').join('')+'</div>'+
      '<button class="wback red" data-x="leave">Salir de la tarea</button></div>';
    if(UI.wide) return pickerPanel('Personas de la tarea', body, id, null, 'tmShare', (s, done)=>{ s.onclick=e=>{ if(e.target.closest('[data-x=leave]')){ done(); shLeaveAsk(id); } }; });
    openSheet(sheadHTML('Personas de la tarea', '', 'Hecho')+body, s=>{ s.onclick=e=>{ const b=e.target.closest('[data-x]'); if(!b) return; if(b.dataset.x==='leave'){ closeSheet(); shLeaveAsk(id); } else closeSheet(); }; }); return; }
  const body='<div class="wsheet ntsheet shsheet"><div class="pplist" role="listbox">'+(peers.length?peers.map(rowHTML).join(''):'<div class="hint">No hay nadie más en el Equipo.</div>')+'</div>'+
    '<div class="hint">'+(x.share?'Todos pueden editarla y completarla. Solo tú puedes añadir o quitar personas, y eliminarla para todos.':'La tarea será la misma para todos: podéis editarla y completarla. Cada uno la guarda en su proyecto y con su recordatorio. Las fotos y audios no se comparten.')+'</div></div>';
  const save=async(close)=>{ const add=[...pick].filter(u=>!cur.has(u)), out=[...cur].filter(u=>u!==me&&!pick.has(u)); close();
    if(add.length) await shShare(id, add); out.forEach(u=>shRemove(id, u)); };
  const bind=(s, close)=>{ s.onclick=e=>{ const r=e.target.closest('[data-sh]'); if(r){ const m=teamMember(r.dataset.sh); if(!m||!m.pub){ toast('Todavía no puede recibir tareas'); return; }
      if(pick.has(m.id)) pick.delete(m.id); else pick.add(m.id); haptic(4); $('.pplist', s).innerHTML=peers.map(rowHTML).join(''); return; }
    const b=e.target.closest('[data-x]'); if(!b) return; if(b.dataset.x==='ok') save(close); else close(); }; };
  openSheet(sheadHTML(x.share?'Personas de la tarea':'Compartir con', 'Cancelar', 'Guardar')+body, s=>bind(s, closeSheet)); }
function shLeaveAsk(id){ const x=task(id); if(!x) return;
  const go=()=>shLeave(id), text='"'+(x.title||'Sin título')+'" desaparecerá de tus tareas. Para los demás no cambia nada.';
  if(UI.wide){ macAlert({title:'Salir de la tarea', text, ok:'Salir', fn:go}); return; }
  actionSheet(text, [{label:'Salir de la tarea', red:true, fn:go}]); }

/* ---------- Recibidas: the tasks shared with this person, waiting ---------- */
function shRecvCardHTML(x){ const by=teamMember(x.share), meta=recvMeta({date:x.date, deadline:x.deadline, priority:x.priority, estimate:x.estimate, steps:stepsOf(x.id)});
  return '<div class="recv shrecv" data-shrecv="'+esc(x.id)+'"><div class="rv-h"><b>'+esc(teamFirst(by))+' ha compartido contigo</b><span>'+esc(syncAgo(x.vcreated||x.modified))+'</span></div><div class="rv-t">'+esc(x.title||'Sin título')+'</div>'+
    (meta?'<div class="rv-m">'+esc(meta)+'</div>':'')+(x.notes?'<div class="rv-n">'+esc(x.notes.length>280?x.notes.slice(0,279)+'…':x.notes)+'</div>':'')+
    '<div class="rv-acts"><button class="btn" data-act="tmShDrop" data-id="'+esc(x.id)+'">No, gracias</button><button class="btn primary" data-act="tmShAdd" data-id="'+esc(x.id)+'">Añadir a mis tareas</button></div></div>'; }
function shAddMenu(id, src){ const x=task(id); if(!shPending(x)) return; const dot=c=>'<span class="pm-dot" style="background:'+c+'"></span>';
  popMenu({anchor:src, align:UI.wide?'right':undefined, title:UI.wide?'':'Añadir al proyecto', groups:[activeProjects().map(p=>({label:p.name, icon:dot(p.color), fn:()=>shAccept(id, p.id)})), [{label:'Sin proyecto', icon:dot('var(--ink3)'), fn:()=>shAccept(id, null)}]]}); }

// The rows: two people in grey on a task shared with someone (iPhone, after the notes icon; desktop, a column of its own)
/* v0.39.1: who else is in a shared task, by first name, on the row (Enric, 19 November): «Jorge», «Jorge y Ana», «Jorge y 2 más»; in a task
   shared with me, whoever shared it first. The tooltip says it in full (shPeopleText). On the desktop in the column Persona (shtag), on the
   iPhone on the grey line (shn) */
const shNames = x => { const o=shOthers(x).map(m=>m.userId); if(x&&x.share&&x.share!==shMe()) o.sort((a,b)=>(b===x.share)-(a===x.share)); return o.map(u=>teamFirst(teamMember(u))); };
const shShort = ns => ns.length<=2 ? listY(ns) : ns[0]+' y '+(ns.length-1)+' más';
function shTagHTML(x, cls){ if(!x||!x.share) return ''; const ns=shNames(x); if(!ns.length) return '';
  return '<span class="'+(cls||'shtag')+'" title="'+esc(shPeopleText(x))+'">'+TI.share+esc(shShort(ns))+'</span>'; }
function shIconHTML(x){ if(!x||!x.share) return ''; const t=shPeopleText(x); return t?'<span class="ish" title="'+esc(t)+'">'+TI.share+'</span>':''; }
