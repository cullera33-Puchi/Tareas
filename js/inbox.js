'use strict';
/* Tareas. Siri and the iOS Shortcut (0010_inbox.sql, Edge Function add-task): the spoken words, the pickup of the inbox and the section
   Atajo de iOS of Ajustes.
   A classic script: index.html loads every file of js/ in order and they share their global names. Only declarations and
   listeners run at load; the start itself (first screen, timers, sync, service worker) is in boot.js, the last file.
   - Why an inbox: a Shortcut cannot reach the installed app (it opens Safari, whose storage is another one). It sends the phrase to the
     function add-task with a personal key; the function keeps it in the table inbox; every sync pass (and a realtime insert while the app
     is open) turns the rows not taken yet into tasks here, and marks them taken.
   - The task of a row has the id 'ib-' plus the row id: two devices that take the same row make the same task, which the sync keeps once.
   - Its space is the one chosen in Ajustes (shortcut_keys.space_id, the same on every device), or the active space when that one is gone.
   - The words of the phrase (spokenParse) are read from its end, in any order: urgente, prioridad alta or media, proyecto <name>, the time
     (15 minutos, media hora, una hora, medio día), the date and «a las 9», plus what a typed title already understands (#pro, !!!, 15m). */

/* ---------- The spoken words ---------- */
// The projects of a space whose whole name or one of its words starts with tok (accents ignored); a whole-name match wins (as projectMatches)
function spokenProjects(spaceId, tok){ const k=projKey(tok); if(!k) return [];
  const ps=DB.projects.filter(p=>p.spaceId===spaceId && !p.archived), exact=ps.filter(p=>projKey(p.name)===k); if(exact.length===1) return exact;
  return ps.filter(p=>projKey(p.name).startsWith(k) || norm(p.name).split(/[^a-z0-9]+/).some(w=>w&&w.startsWith(k))); }
// The time estimate said aloud at the end: «15 minutos», «media hora», «30 minutos», «una hora», «1 hora»; the typed forms and «medio día» by estMatch.
// «en una hora» and «dentro de una hora» say when, not how long: left in the title
const SPOKEN_EST=[[/\s+(?:15|quince)\s+minutos$/i,15],[/\s+media\s+hora$/i,30],[/\s+(?:30|treinta)\s+minutos$/i,30],[/\s+(?:una|1)\s+hora$/i,60]];
function spokenEst(work){ for(const [re,min] of SPOKEN_EST){ const m=work.match(re); if(m){ if(min===60 && /(?:^|\s)(?:en|dentro\s+de)$/i.test(work.slice(0, m.index))) return null; return {index:m.index, len:m[0].length, min}; } }
  return estMatch(work); }
/* A phrase from the inbox, read as the app reads a typed title and more. o.spaceId: the space whose projects «proyecto <name>» looks in;
   o.base: the day the phrase was said, which «mañana» or «el viernes» count from. A project not found, or found twice, is left in the title
   (and the reading goes on before it), so the words show what was not understood. Returns {title, date, time, priority, estimate, projectId} */
function spokenParse(text, o){ o=o||{}; const src=String(text||'').replace(/\s+/g,' ').trim(), toks=[];
  const out={title:'', date:null, time:null, priority:null, estimate:null, projectId:null, unknown:null};
  const blank=(w,a,b)=>w.slice(0,a)+' '.repeat(b-a)+w.slice(b); let work=src;
  const take=(kind,a,b,keep)=>{ while(a<b&&/\s/.test(work[a])) a++; if(!keep) toks.push({kind, start:a, end:b}); work=blank(work,a,b); };
  // '#pro' anywhere, as in a typed title
  for(const m of src.matchAll(/(^|\s)#([\p{L}\p{N}_-]+)/gu)){ const start=m.index+m[1].length, ps=spokenProjects(o.spaceId, m[2]);
    if(ps.length===1 && !out.projectId){ out.projectId=ps[0].id; take('proj', start, start+1+m[2].length); } }
  for(let more=true; more;){ more=false; let m; const end=work.replace(/\s+$/,'').length; work=work.slice(0,end)+' '.repeat(work.length-end);
    const tail=work.slice(0,end);
    if((m=tail.match(/\s*[.,;:]+$/)) && m.index>0){ take('punct', m.index, end); more=true; continue; } // dictation ends with a full stop; commas between the words
    if(!out.time && (m=tail.match(/\s+a\s+las?\s+(\d{1,2})(?:[:.h](\d{2}))?\s*(?:h|hs|horas?)?(?:\s+de\s+la\s+(mañana|tarde|noche))?$/i))){ let h=+m[1]; const mi=m[2]?+m[2]:0, part=norm(m[3]||'');
      if(part&&part!=='manana'&&h<12) h+=12; if(h<=23&&mi<=59){ out.time={h, m:mi}; take('time', m.index, end); more=true; continue; } }
    if(!out.priority && (m=tail.match(/\s(!{2,3})$/))){ out.priority=m[1].length===3?'high':'mid'; take('pri', m.index, end); more=true; continue; }
    if(!out.priority && (m=tail.match(/\s+(urgente|prioridad\s+alta|prioridad\s+media)$/i))){ out.priority=/media$/i.test(m[1])?'mid':'high'; take('pri', m.index, end); more=true; continue; }
    if(!out.estimate && (m=spokenEst(tail))){ out.estimate=m.min; take('est', m.index, m.index+m.len); more=true; continue; }
    // «proyecto PAM»: one word, a project of the space; not found or found twice, the words stay and what comes before is read on
    if(!out.projectId && (m=tail.match(/\s+proyecto\s+([\p{L}\p{N}_-]+)$/iu))){ const ps=spokenProjects(o.spaceId, m[1]);
      if(ps.length===1){ out.projectId=ps[0].id; take('proj', m.index, end); } else { out.unknown=m[0].trim(); take('kept', m.index, end, true); } more=true; continue; }
    // A name of two words («proyecto Fase 2»), only when it is one project; otherwise the last word may be a date and is read next
    if(!out.projectId && (m=tail.match(/\s+proyecto\s+([\p{L}\p{N}_-]+\s+[\p{L}\p{N}_-]+)$/iu))){ const ps=spokenProjects(o.spaceId, m[1]);
      if(ps.length===1){ out.projectId=ps[0].id; take('proj', m.index, end); more=true; continue; } }
    if(!out.date){ const d=quickDateMatch(tail, o.base); if(d){ out.date=d.date; take('date', d.index, d.index+tail.substr(d.index,d.len).trimEnd().length); more=true; } } }
  toks.sort((a,b)=>a.start-b.start);
  out.title=quickTitle(src, toks).replace(/\s*[,;:]+$/,'').replace(/\s+([,;:.])/g,'$1').trim()||src;
  return out; }
/* The task a row of the inbox becomes. created: the moment it arrived. Without a spoken date: the day it was said, or the next one when that
   space's day was closed then (decision 61e); a time already past that day moves it to the next. Never before today: a past day becomes
   today, and its reminder comes along at the same time (marked sent when that time has passed, as decision 25) */
function inboxTask(row, spaceId){ const at=Date.parse(row.created)||Date.now(), cday=localDay(new Date(at).toISOString()), sp=DB.spaces.find(s=>s.id===spaceId);
  const q=spokenParse(row.text, {spaceId, base:cday}); let date=q.date; const said=!!date;
  if(!date) date=sp&&sp.closedDay===cday?addDays(cday,1):cday;
  const on=d=>{ const x=new Date(d+'T00:00:00'); x.setHours(q.time.h, q.time.m, 0, 0); return x; };
  let rem=null; if(q.time){ let x=on(date); if(!said && x.getTime()<=at){ date=addDays(date,1); x=on(date); } rem=x; }
  const t=todayStr(); if(date<t){ date=t; if(rem) rem=on(t); }
  const reminder=rem?rem.toISOString():null, url=String(row.url||'').trim();
  return {id:'ib-'+row.id, title:q.title, spaceId, projectId:q.projectId, date, reminder, reminderSent:reminder?sentStamp(reminder):null, priority:q.priority||'none', estimate:q.estimate||null,
    notes:row.source==='share'&&url&&url!==String(row.text||'').trim()?url:'', created:new Date(at).toISOString(), _q:q}; }

/* ---------- Pickup ---------- */
// Rows this device made a task of and could not mark taken yet (offline): skipped next time, and marked once the server answers
const IB_KEY='tareas-inbox';
const ibDone = () => { try{ const v=JSON.parse(localStorage.getItem(IB_KEY)||'[]'); return Array.isArray(v)?v:[]; }catch(e){ return []; } };
const ibWrite = l => { try{ localStorage.setItem(IB_KEY, JSON.stringify(l.slice(-200))); }catch(e){} };
let ibWarned='';
// Runs inside a sync pass (syncRun), after the pull and before the push: the new tasks go up in the same pass
async function inboxPickup(){ const R=SY&&SY.remote; if(!R||!R.inboxList||!SY.user||syncMissing('inbox')) return 0;
  let rows; try{ rows=await R.inboxList(); }catch(e){ const m='Bandeja de Siri no disponible: '+(e&&e.message||e); if(ibWarned!==m){ ibWarned=m; log('warn', m); } return 0; }
  if(syncMissing('inbox')||!Array.isArray(rows)||!rows.length) return 0;
  let key=null; try{ key=R.keyGet?await R.keyGet():null; }catch(e){ log('warn','Clave del atajo no disponible: '+(e&&e.message||e)); }
  if(key&&SY.user) SK.row=key, SK.for=SY.user.id;
  const sid=key&&key.space_id&&DB.spaces.some(s=>s.id===key.space_id)?key.space_id:space().id;
  const done=ibDone(), known=syncState().known.tasks||{}, made=[], take=[];
  flushEdits(); SY.quiet=true; // the pass pushes them; no second pass for these saves
  try{ batch(()=>rows.forEach(row=>{ if(!row||!row.id) return; const id='ib-'+row.id; take.push(row.id);
      if(done.includes(row.id) || task(id) || known[id]!==undefined) return; // made already, here or on another device
      const x=inboxTask(row, sid), q=x._q; delete x._q; const nx=addTask(x); done.push(row.id); made.push(nx.id);
      log('info','Tarea recibida desde Siri', {id:nx.id, source:row.source||'siri', fecha:nx.date, hora:!!nx.reminder, proyecto:!!nx.projectId, prioridad:nx.priority, tiempo:nx.estimate||0, sinEntender:q.unknown?1:0}); })); }
  finally{ SY.quiet=false; }
  ibWrite(done);
  if(made.length){ const n=made.length; toast(n===1?'1 tarea recibida desde Siri':n+' tareas recibidas desde Siri', ()=>inboxUndo(made)); if(!busyEditing()&&!touchDrag) render(); }
  // Kept: the rows still waiting that the server has not marked yet. A row gone from the list was taken (here or on another device)
  try{ const ok=new Set((await R.inboxTake(take, new Date().toISOString())||[]).map(r=>r.id)); ibWrite(ibDone().filter(i=>take.includes(i)&&!ok.has(i))); }
  catch(e){ log('warn','No se pudo marcar la bandeja de Siri: '+(e&&e.message||e)); } // the next pass marks them; done keeps them from being made twice
  return made.length; }
// Deshacer: the tasks received go (the rows stay taken, so they never come back)
function inboxUndo(ids){ const s=new Set(ids); DB.tasks=DB.tasks.filter(x=>!s.has(x.id)); cutSteps(s); ids.forEach(i=>HELD.delete(i)); save(); log('info','Tareas recibidas desde Siri deshechas', {n:ids.length}); render(); }

/* ---------- Ajustes, Atajo de iOS ---------- */
// SK: the account's key row as the server has it (space_id, created, revoked; never the hash), the key just made (shown once, kept in memory only)
const SK={row:null, for:null, at:0, loading:false, newKey:null, space:null, busy:false};
const shortcutUrl = () => { const b=(SY&&SY.remote&&SY.remote.baseUrl)||normSupabaseUrl(window.TAREAS_CONFIG&&TAREAS_CONFIG.url); return b?b+'/functions/v1/add-task':''; };
const skActive = () => !!SK.row && !SK.row.revoked;
// The space chosen: the one on the key, else the one picked here, else «Deloitte» if there is one, else the active space
function shortcutSpace(){ const has=id=>DB.spaces.find(s=>s.id===id);
  return (SK.row&&SK.row.space_id&&has(SK.row.space_id)) || (SK.space&&has(SK.space)) || DB.spaces.find(s=>norm(s.name).trim()==='deloitte') || space(); }
const skPaint = () => { if(onSettings() && !busyEditing() && !touchDrag) render(); };
function shortcutLoad(force){ if(!SY||!SY.user||!SY.remote.keyGet||SK.loading||!navigator.onLine) return; if(!force && SK.for===SY.user.id && Date.now()-SK.at<60e3) return;
  SK.loading=true; SK.at=Date.now(); const user=SY.user.id;
  SY.remote.keyGet().then(row=>{ if(!SY.user||SY.user.id!==user) return; SK.row=row||null; SK.for=user; })
    .catch(e=>log('warn','Clave del atajo no disponible: '+(e&&e.message||e))).finally(()=>{ SK.loading=false; skPaint(); }); }
const b64u = u => { let s=''; for(let i=0;i<u.length;i++) s+=String.fromCharCode(u[i]); return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,''); };
async function sha256Hex(s){ const d=new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))); return Array.from(d, b=>b.toString(16).padStart(2,'0')).join(''); }
// A random 32-byte key; only its sha-256 leaves the device. A new key replaces the old one (the account's single row)
async function shortcutCreate(){ if(SK.busy||!SY||!SY.user) return; if(!navigator.onLine){ toast('Sin conexión'); return; }
  if(!(crypto&&crypto.subtle&&crypto.getRandomValues)){ toast('Este navegador no puede crear la clave'); return; }
  if(syncState().owner!==SY.user.id){ toast('Espera a que termine la primera sincronización'); return; } // the spaces get their ids first
  SK.busy=true; skPaint(); const sp=shortcutSpace();
  try{ const b=new Uint8Array(32); crypto.getRandomValues(b); const key=b64u(b), now=new Date().toISOString();
    await SY.remote.keyPut({owner_id:SY.user.id, key_hash:await sha256Hex(key), space_id:sp.id, created:now, revoked:null});
    SK.row={space_id:sp.id, created:now, revoked:null}; SK.for=SY.user.id; SK.at=Date.now(); SK.newKey=key; SK.space=null;
    log('info','Clave del atajo creada', {espacio:sp.name}); toast('Clave creada'); }
  catch(e){ log('error','No se pudo crear la clave del atajo: '+(e&&e.message||e)); toast(syncOffline(e)?'Sin conexión':'No se pudo crear la clave'); }
  finally{ SK.busy=false; skPaint(); } }
function shortcutCreateAsk(){ if(!skActive()){ shortcutCreate(); return; } confirmSheet('Crear clave nueva', 'La clave actual dejará de funcionar. Tendrás que poner la nueva en el atajo.', shortcutCreate, 'Crear'); }
function shortcutRevoke(){ confirmSheet('Revocar clave', 'El atajo dejará de añadir tareas hasta que crees una clave nueva.', async()=>{
  try{ const now=new Date().toISOString(); await SY.remote.keyPatch(SY.user.id, {revoked:now}); SK.row=Object.assign({}, SK.row, {revoked:now}); SK.newKey=null; log('info','Clave del atajo revocada'); toast('Clave revocada'); }
  catch(e){ log('error','No se pudo revocar la clave del atajo: '+(e&&e.message||e)); toast(syncOffline(e)?'Sin conexión':'No se pudo revocar'); }
  skPaint(); }, 'Revocar'); }
// Espacio: stored on the key row, so every device puts the tasks in the same space; before a key exists, kept here for its creation
async function shortcutSetSpace(id){ const sp=DB.spaces.find(s=>s.id===id); if(!sp||shortcutSpace().id===id) return;
  if(!skActive()){ SK.space=id; skPaint(); return; }
  const old=SK.row.space_id; SK.row=Object.assign({}, SK.row, {space_id:id}); skPaint();
  try{ await SY.remote.keyPatch(SY.user.id, {space_id:id}); log('info','Espacio del atajo', {espacio:sp.name}); toast('Las tareas de Siri irán a '+sp.name); }
  catch(e){ SK.row=Object.assign({}, SK.row, {space_id:old}); log('error','No se pudo cambiar el espacio del atajo: '+(e&&e.message||e)); toast(syncOffline(e)?'Sin conexión':'No se pudo cambiar el espacio'); skPaint(); } }
function shortcutSpaceMenu(src){ const cur=shortcutSpace().id;
  popMenu({anchor:src, align:'right', groups:[DB.spaces.slice().sort((a,b)=>a.order-b.order).map(s=>({label:s.name, on:s.id===cur, fn:()=>shortcutSetSpace(s.id)}))]}); }
function shortcutSectionHTML(dev){
  const g=(cells, foot)=>'<div class="group-title">Atajo de iOS</div><div class="group sc-acc">'+cells+'</div>'+(foot?'<div class="footnote">'+foot+'</div>':'');
  const cell=(l,v)=>'<div class="cell"><span class="lbl">'+l+'</span><span class="val">'+v+'</span></div>';
  const btn=(act,l,o)=>'<button class="cell'+(o&&o.red?'':' link')+'" data-act="'+act+'"'+(o&&o.dis?' disabled':'')+'><span class="lbl"'+(o&&o.red?' style="color:var(--red)"':'')+'>'+l+'</span></button>';
  if(!SY) return g(cell('Siri y Atajos','No disponible'), 'Necesita la cuenta, que no está disponible en esta versión.');
  if(!SY.user) return g(cell('Siri y Atajos','Sin cuenta'), 'Inicia sesión primero. Lo que digas a Siri llega a '+dev+' a través de tu cuenta.');
  if(syncMissing('shortcut_keys')||syncMissing('inbox')) return g(cell('Siri y Atajos','No disponible'), 'Falta poner al día Supabase con 0010_inbox.sql.');
  shortcutLoad(false); // fetched while Ajustes is on screen, at most once a minute
  if(SK.for!==SY.user.id) return g(cell('Clave', SK.loading||navigator.onLine?'Comprobando':'Sin conexión'));
  const sp=shortcutSpace(), chev=I.chev.replace('<svg','<svg class="chev"');
  const spaceCell='<button class="cell" data-act="scSpace" aria-haspopup="menu"><span class="lbl">Espacio</span><span class="val">'+esc(sp.name)+'</span>'+chev+'</button>';
  if(!skActive()) return g(cell('Clave', SK.row&&SK.row.revoked?'Revocada':'Ninguna')+spaceCell+btn('scCreate', SK.busy?'Creando clave':'Crear clave', {dis:SK.busy}),
    'Con la clave, un atajo de la app Atajos envía a Tareas lo que le dices a Siri, y la tarea aparece al sincronizar. Las tareas van al espacio elegido.');
  const since=SK.row.created?pushSince(SK.row.created).replace(/^Desde/,'Creada'):'Activa', url=shortcutUrl();
  return g(cell('Clave', esc(since))+
    (SK.newKey?'<div class="cell sc-show"><span class="lbl">Clave nueva</span><code class="sc-code" data-sc="key">'+esc(SK.newKey)+'</code></div>'+btn('scCopyKey','Copiar clave'):'')+
    (url?'<div class="cell sc-show"><span class="lbl">Dirección</span><code class="sc-code" data-sc="url">'+esc(url)+'</code></div>'+btn('scCopyUrl','Copiar dirección'):'')+
    spaceCell+btn('scCreate', SK.busy?'Creando clave':'Crear clave nueva', {dis:SK.busy})+btn('scRevoke','Revocar clave', {red:true}),
    (SK.newKey?'Copia la clave ahora y pégala en el atajo: no se volverá a mostrar. ':'')+'Una clave nueva sustituye a la anterior, que deja de funcionar.'); }
