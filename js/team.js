'use strict';
/* Tareas. The team (decision 63 b, c and d; the owner's choices of 5 November in decision 71): access only by invitation, the admin's
   Equipo section, the directory, «Avisar a…» and Recibidas, the storage quota, and the suggestions and incidents.
   A classic script: index.html loads every file of js/ in order and they share their global names. Only declarations and
   listeners run at load; the start itself (first screen, timers, sync, service worker) is in boot.js, the last file.
   - The server decides (supabase/migrations/0013_team.sql): every table asks for an active membership, so this file only follows what it
     says. A database without 0013 answers «absent» and the app works as before (one user, no Equipo section).
   - TM.state, read at the start of each sync pass (teamGate, at most once a minute unless forced): undefined while unknown, 'absent',
     'admin', 'member' or 'denied'. Denied: nothing syncs and a full screen says «Esta cuenta no tiene acceso» over the app, so nothing of
     this device is shown under that account; only «Cerrar sesión» is offered. A member without the encryption key row cannot sync either
     (decision 71.1): the activation sheet opens by itself (cryptoActivateSheet with required), nothing to migrate.
   - Each member has an ECDH P-256 key pair (teamKeys): made once by a device with the data key, the public key in crypto_keys.ecdh_pub
     (read by the others through the directory), the private key encrypted with the data key in crypto_keys.ecdh_priv; on each device a
     non-extractable copy in IndexedDB 'tareas-keys' (id 'ecdh'). A copy for someone ('t1:'): an ephemeral ECDH key with the recipient's
     public key, HKDF-SHA256 and AES-GCM (teamSeal, teamOpen); the server never reads it.
   - «Avisar a…» sends such a copy of a task (title, notes, date, priority, estimate, deadline, steps and an optional phrase); the server
     allows one every 4 hours per task and person; the sender's task keeps a local note of it (x.sentTo, never synced). The recipient's
     passes read what came (Recibidas), opened here and kept in TEAM_KEY for when there is no connection; «Añadir a mis tareas» makes an
     ordinary task of theirs, «Descartar» lets it go.
   - Never logged: any text of a task, a phrase, a suggestion or a key. */
const TEAM_KEY='tareas-team', TEAM_QUOTA_DEFAULT=52428800, TEAM_NOTICE_WAIT=4*3600e3;
const TM={ state:undefined, for:null, me:null, at:0, force:false, dir:[], dirAt:0, recv:[], recvAt:0, recvBusy:false, list:null, listAt:0, inbox:null,
  priv:null, pub:null, keyKid:null, keyOwner:null, keyBusy:false, deniedLogged:false, askedKey:false, noSpace:false, busy:false };
// Icons: «Avisar a…» (a speaker) and Recibidas (a tray with an arrow into it)
const TI={ notice:mi('<path d="M3.5 10.5v3a1 1 0 001 1h2l5 4.5V5L6.5 9.5h-2a1 1 0 00-1 1z"/><path d="M15.5 9a4.5 4.5 0 010 6M18.5 6a8.5 8.5 0 010 12"/>'),
  recv:mi('<path d="M4 13.5v5h16v-5"/><path d="M12 3.5v10M8 9.5l4 4 4-4"/>') };
const TEAM_ABSENT=/PGRST20[25]|42883|42P01|Could not find the (function|table)|does not exist/i;
const teamAbsentErr = e => !!e && TEAM_ABSENT.test(String(e.message||'')+' '+String(e.code||''));
const teamOn = () => !!(SY&&SY.user&&TM.for===SY.user.id&&(TM.state==='admin'||TM.state==='member'));
const teamAdmin = () => teamOn()&&TM.state==='admin';
const teamDenied = () => !!(SY&&SY.user&&TM.for===SY.user.id&&TM.state==='denied');

/* ---------- The device's copy: the account's state, the directory and what came, for when there is no connection ---------- */
function teamCache(){ try{ const v=JSON.parse(localStorage.getItem(TEAM_KEY)||'null'); return v&&typeof v==='object'?v:null; }catch(e){ return null; } }
function teamCacheWrite(){ if(!SY||!SY.user||TM.for!==SY.user.id) return;
  try{ localStorage.setItem(TEAM_KEY, JSON.stringify({owner:SY.user.id, state:TM.state, me:TM.me, dir:TM.dir, recv:TM.recv})); }catch(e){} }
// A new account (or none): what was known of another one goes
function teamReset(user){ Object.assign(TM, {state:undefined, for:user?user.id:null, me:null, at:0, force:false, dir:[], dirAt:0, recv:[], recvAt:0, list:null, listAt:0, inbox:null, priv:null, pub:null, keyKid:null, keyOwner:null, deniedLogged:false, askedKey:false, noSpace:false});
  const c=teamCache(); if(user&&c&&c.owner===user.id){ TM.state=['admin','member','denied'].includes(c.state)?c.state:undefined; TM.me=c.me||null; TM.dir=Array.isArray(c.dir)?c.dir:[]; TM.recv=Array.isArray(c.recv)?c.recv:[]; }
  else { try{ localStorage.removeItem(TEAM_KEY); }catch(e){} } }

// At start: an account known to have no access shows the full screen before anything else (the first pass reads it again)
function teamBoot(){ if(!SY||!SY.user) return; teamReset(SY.user); teamDeniedPaint(); }
// Decision 71.1: a member without the encryption key row sends nothing up, files included (the server refuses it too)
const teamHold = () => !!(SY&&SY.user&&(SY.status==='needkey'||SY.status==='denied'||teamDenied()||syncOtherOwner()||(TM.for===SY.user.id&&TM.state==='member'&&!crKey())));

/* ---------- The gate of each pass ---------- */
// 'absent' (no 0013, or a test's adapter without it), 'admin', 'member' or 'denied'. Throws on a network error: the pass fails and is retried
async function teamGate(user){ const R=SY.remote; if(!R.teamMe) return 'absent';
  if(TM.for!==user.id) teamReset(user);
  if(TM.state===undefined||TM.force||TM.state==='denied'||Date.now()-TM.at>60e3) await teamFetch(user);
  return TM.state||'absent'; }
async function teamFetch(user){ const t0=Date.now(), me=await SY.remote.teamMe(); if(!SY.user||SY.user.id!==user.id) return;
  const was=TM.state; TM.at=Date.now(); TM.force=false;
  if(me&&me.absent){ TM.state='absent'; TM.me=null; teamDeniedPaint(); return; }
  if(!me){ TM.state='denied'; TM.me=null; TM.recv=[]; TM.dir=[]; if(!TM.deniedLogged){ TM.deniedLogged=true; log('warn','Esta cuenta no tiene acceso: no se sincroniza nada'); } teamCacheWrite(); teamDeniedPaint(); return; }
  // An upload that ended while the answer was on its way is not in it yet: the larger of the two counts stays
  const used=Math.max(+me.used||0, TM.me&&(TM.upAt||0)>=t0?+TM.me.used||0:0);
  TM.me={id:me.id, role:me.role, name:me.name||'', email:me.email||'', quota:me.quota==null?null:+me.quota, used}; TM.state=me.role==='admin'?'admin':'member'; TM.deniedLogged=false;
  if(was!==TM.state) log('info', TM.state==='admin'?'Equipo: administrador':'Equipo: miembro');
  teamCacheWrite(); teamDeniedPaint(); }
// After a pass that reached the server: the member's keys, the directory and what came for them. Never fails the pass
async function teamAfter(){ TM.refused=false; if(!teamOn()||TM.busy) return; TM.busy=true;
  try{ await teamKeys(); if(Date.now()-TM.dirAt>180e3||TM.dirForce) await teamDirFetch(); await teamRecvFetch(); }
  catch(e){ log('warn','Equipo: '+(e&&e.message||e)); }
  finally{ TM.busy=false; } }
async function teamDirFetch(){ const rows=await SY.remote.teamDir(); TM.dirAt=Date.now(); TM.dirForce=false;
  TM.dir=(rows||[]).filter(r=>r&&r.user_id).map(r=>({id:r.user_id, name:r.name||'', email:r.email||'', pub:r.pub||null, admin:!!r.admin})); teamCacheWrite(); }
const teamMember = id => TM.dir.find(m=>m.id===id)||null;
const teamName = m => m ? (String(m.name||'').trim()||String(m.email||'').split('@')[0]) : 'Alguien';
const teamFirst = m => teamName(m).split(/\s+/)[0];
// The members someone can send a task to: the others, with their key
const teamPeers = () => SY&&SY.user ? TM.dir.filter(m=>m.id!==SY.user.id) : [];

// A pass refused by the rules of the server (row level security) while this account was a member: perhaps its access was just removed.
// Once: the next pass, soon, reads the account again (and shows the full screen if so). A second refusal while the account still has access
// is an ordinary sync error (said in Ajustes and logged as an error), retried with the usual wait. A pass that works clears it (teamAfter)
function teamRefused(e){ if(!teamOn()) return false; const m=String(e&&(e.message||e.code)||e)+' '+String(e&&e.code||''); if(!/row-level security|42501/i.test(m)) return false;
  if(TM.refused) return false; TM.refused=true;
  TM.force=true; SY.status='syncing'; SY.error=''; log('warn','Equipo: el servidor ha rechazado un cambio; se comprueba el acceso'); return true; }

/* ---------- The full screen of an account without access ---------- */
function teamDeniedPaint(){ let el=document.getElementById('noaccess'); const on=teamDenied(); app.inert=on; // nothing under it takes the focus or a key
  if(!on){ if(el) el.remove(); return; }
  if(!el){ el=document.createElement('div'); el.id='noaccess'; el.className='noaccess'; el.setAttribute('role','alertdialog'); el.setAttribute('aria-modal','true'); document.body.appendChild(el);
    el.addEventListener('click', e=>{ if(e.target.closest('[data-x=out]')) teamSignOut(); }); }
  el.innerHTML='<div class="na-box">'+I.person.replace('<svg','<svg class="na-ic"')+'<h1>Esta cuenta no tiene acceso</h1><p class="na-mail">'+esc(SY.user.email||'')+'</p>'+
    '<p>Pide acceso a quien te invitó o entra con la cuenta de Google a la que llegó la invitación.</p><button class="btn primary" data-x="out">Cerrar sesión</button></div>';
  if(sheet.classList.contains('on')) closeSheet(); closeMenu(true); }
async function teamSignOut(){ const b=document.querySelector('#noaccess [data-x=out]'); if(b) b.disabled=true; await syncSignOut(); teamReset(null); teamDeniedPaint(); render(); }

/* ---------- Keys ---------- */
const TEAM_AAD = kind => cryptoTE.encode('tareas-team.'+kind);
async function teamKdf(bits, epk, rpk, kind, use){ const s=cryptoSubtle(), ikm=await s.importKey('raw', bits, 'HKDF', false, ['deriveKey']), salt=new Uint8Array(epk.length+rpk.length); salt.set(epk); salt.set(rpk, epk.length);
  return s.deriveKey({name:'HKDF', hash:'SHA-256', salt, info:cryptoTE.encode('tareas-t1 '+kind)}, ikm, {name:'AES-GCM', length:256}, false, use); }
// A value for one member only: 't1:' + base64url(ephemeral public key (65) || IV (12) || ciphertext and tag)
async function teamSeal(pubB64, obj, kind){ const s=cryptoSubtle(), rpk=cryptoUnb64(pubB64);
  const rpub=await s.importKey('raw', rpk, {name:'ECDH', namedCurve:'P-256'}, false, []);
  const eph=await s.generateKey({name:'ECDH', namedCurve:'P-256'}, true, ['deriveBits']), epk=new Uint8Array(await s.exportKey('raw', eph.publicKey));
  const key=await teamKdf(await s.deriveBits({name:'ECDH', public:rpub}, eph.privateKey, 256), epk, rpk, kind, ['encrypt']);
  const iv=cryptoRandom(12), ct=new Uint8Array(await s.encrypt({name:'AES-GCM', iv, additionalData:TEAM_AAD(kind)}, key, cryptoTE.encode(JSON.stringify(obj))));
  const out=new Uint8Array(65+12+ct.length); out.set(epk); out.set(iv, 65); out.set(ct, 77); return 't1:'+cryptoB64(out); }
async function teamOpen(v, kind){ if(!TM.priv||!TM.pub||typeof v!=='string'||!v.startsWith('t1:')) throw new Error('Sin clave');
  const s=cryptoSubtle(), b=cryptoUnb64(v.slice(3)); if(b.length<65+12+16) throw new Error('Incompleto'); const epk=b.slice(0,65);
  const epub=await s.importKey('raw', epk, {name:'ECDH', namedCurve:'P-256'}, false, []);
  const key=await teamKdf(await s.deriveBits({name:'ECDH', public:epub}, TM.priv, 256), epk, cryptoUnb64(TM.pub), kind, ['decrypt']);
  return JSON.parse(cryptoTD.decode(await s.decrypt({name:'AES-GCM', iv:b.slice(65,77), additionalData:TEAM_AAD(kind)}, key, b.slice(77)))); }
const teamKeyLoad = () => cryptoKdbDo('readonly', st=>st.get('ecdh')).catch(()=>null);
const teamKeySave = (priv, pub, kid, owner) => cryptoKdbDo('readwrite', st=>st.put({id:'ecdh', priv, pub, kid, owner}));
const teamImportPriv = pk8 => cryptoSubtle().importKey('pkcs8', pk8, {name:'ECDH', namedCurve:'P-256'}, false, ['deriveBits']);
/* The member's key pair: here already (this account, this data key, the server's public key), opened from the server's copy, or made now.
   Made only while the server row has none (a conditional update), so two devices never make two; the one that loses reads the row again */
async function teamKeys(){ const k=crKey(); if(!k||!CR.row||TM.keyBusy) return; const user=SY.user;
  if(TM.priv&&TM.keyOwner===user.id&&TM.keyKid===CR.kid&&CR.row.ecdh_pub===TM.pub) return;
  TM.keyBusy=true;
  try{ const st=await teamKeyLoad();
    if(st&&st.priv&&st.owner===user.id&&st.kid===CR.kid&&CR.row.ecdh_pub&&st.pub===CR.row.ecdh_pub){ Object.assign(TM, {priv:st.priv, pub:st.pub, keyKid:st.kid, keyOwner:st.owner}); return; }
    if(CR.row.ecdh_pub&&CR.row.ecdh_priv){ const pk8=cryptoUnb64(await cryptoDec(k, CR.row.ecdh_priv, cryptoAad('crypto_keys','ecdh_priv'))), priv=await teamImportPriv(pk8);
      await teamKeySave(priv, CR.row.ecdh_pub, CR.kid, user.id).catch(()=>{}); Object.assign(TM, {priv, pub:CR.row.ecdh_pub, keyKid:CR.kid, keyOwner:user.id}); log('info','Equipo: claves abiertas en este dispositivo'); return; }
    const s=cryptoSubtle(), kp=await s.generateKey({name:'ECDH', namedCurve:'P-256'}, true, ['deriveBits']);
    const pub=cryptoB64(new Uint8Array(await s.exportKey('raw', kp.publicKey))), pk8=new Uint8Array(await s.exportKey('pkcs8', kp.privateKey));
    const enc=await cryptoEnc(k, cryptoB64(pk8), cryptoAad('crypto_keys','ecdh_priv'));
    const ok=await SY.remote.cryptoPatch(user.id, {kid:CR.kid, ecdh_pub:null}, {ecdh_pub:pub, ecdh_priv:enc});
    if(!Array.isArray(ok)||!ok.length){ CR.force=true; log('info','Equipo: otro dispositivo ya ha creado las claves'); return; }
    const priv=await teamImportPriv(pk8); CR.row.ecdh_pub=pub; CR.row.ecdh_priv=enc;
    await teamKeySave(priv, pub, CR.kid, user.id).catch(()=>{}); Object.assign(TM, {priv, pub, keyKid:CR.kid, keyOwner:user.id, dirForce:true}); log('info','Equipo: claves creadas'); }
  catch(e){ log('warn','Equipo: las claves no están disponibles: '+(e&&e.message||e)); }
  finally{ TM.keyBusy=false; } }

/* ---------- Recibidas ---------- */
// What came for this member, opened. A copy that does not open stays as «No se puede leer» (Descartar only)
async function teamRecvFetch(){ if(!TM.priv||TM.recvBusy) return; TM.recvBusy=true;
  try{ const rows=await SY.remote.noticeList(SY.user.id), out=[];
    for(const r of rows||[]){ const had=TM.recv.find(o=>o.id===r.id); if(had&&had.title!=null){ out.push(had); continue; }
      let c=null; try{ c=await teamOpen(r.payload, 'notice'); }catch(e){ log('warn','Equipo: una tarea recibida no se puede leer'); }
      out.push(Object.assign({id:r.id, from:r.sender_id, created:r.created}, c?{title:String(c.title||''), notes:String(c.notes||''), date:c.date||null, priority:c.priority||'none', estimate:+c.estimate||null, deadline:c.deadline||null,
        steps:Array.isArray(c.steps)?c.steps.map(s=>({title:String(s.title||''), done:!!s.done})).filter(s=>s.title):[], phrase:String(c.phrase||''), fromName:String(c.fromName||'')}:{title:null})); }
    if(out.some(o=>!teamMember(o.from))) await teamDirFetch().catch(()=>{}); // someone new in the team: the directory again, for their name
    const before=TM.recv.map(o=>o.id).join(); TM.recv=out; TM.recvAt=Date.now(); teamCacheWrite();
    if(before!==out.map(o=>o.id).join()){ if(out.length>before.split(',').filter(Boolean).length) log('info','Equipo: tareas recibidas', {n:out.length}); teamRepaint(); } }
  finally{ TM.recvBusy=false; } }
// Decision 71.1: a member without the encryption password is asked for it once a session by itself; afterwards from Ajustes, Cifrado
function teamAskKey(){ if(TM.askedKey||CR.busy||CR.migrating||CR.activating||!SY||!SY.user) return;
  if(sheet.classList.contains('on')||asheet.classList.contains('on')||menuOpen()||touchDrag){ clearTimeout(TM.askT); TM.askT=setTimeout(teamAskKey, 1500); return; }
  TM.askedKey=true; log('info','Equipo: falta crear la contraseña de cifrado'); cryptoActivateSheet({required:true}); }
// Realtime: a task sent to this member, a pass soon reads it
function teamRecvSoon(){ clearTimeout(TM.recvT); TM.recvT=setTimeout(()=>syncRun('aviso'), 300); }
const recvCount = () => teamOn()?TM.recv.length:0;
const recvFrom = o => { const m=teamMember(o.from); return m?teamFirst(m):String(o.fromName||'').split(/\s+/)[0]||'Alguien'; };
function teamRepaint(){ if(sheet.classList.contains('on')&&sheet.querySelector('.recvsheet')) recvPaintSheet(); if(busyEditing()||touchDrag){ staleView=true; return; } render(); }
// iPhone: one line at the top of Hoy while something waits
function recvBannerHTML(){ const n=recvCount(); if(!n) return '';
  return '<div class="group recvban"><button class="cell link" data-act="tmRecv">'+TI.recv.replace('<svg','<svg class="rb-ic"')+'<span class="lbl">'+(n===1?'1 tarea recibida':n+' tareas recibidas')+'</span>'+I.chev.replace('<svg','<svg class="chev"')+'</button></div>'; }
// Desktop: the sidebar's entry under Por confirmar, while something waits (or the view is open)
function recvSideHTML(){ const n=recvCount(), on=UI.deskView==='received'; if(!n&&!on) return '';
  return '<button class="it'+(on?' on':'')+'" data-view="received">'+TI.recv+'<span>Recibidas</span><span class="n">'+n+'</span></button>'; }
function recvMeta(o){ const m=[]; if(o.date) m.push(fmtDate(o.date)); if(o.deadline) m.push('Entrega '+dayWords(o.deadline)); if(o.priority==='high') m.push('Prioridad alta'); else if(o.priority==='mid') m.push('Prioridad media');
  if(o.estimate) m.push(estLabel(o.estimate)); if(o.steps&&o.steps.length) m.push(o.steps.length===1?'1 paso':o.steps.length+' pasos'); return m.join('   '); }
function recvCardHTML(o){ const when=syncAgo(o.created);
  if(o.title==null) return '<div class="recv" data-recv="'+esc(o.id)+'"><div class="rv-h"><b>De '+esc(recvFrom(o))+'</b><span>'+esc(when)+'</span></div><div class="rv-t muted">No se puede leer</div><div class="rv-acts"><button class="btn" data-act="tmRecvDrop" data-id="'+esc(o.id)+'">Descartar</button></div></div>';
  const meta=recvMeta(o);
  return '<div class="recv" data-recv="'+esc(o.id)+'"><div class="rv-h"><b>De '+esc(recvFrom(o))+'</b><span>'+esc(when)+'</span></div><div class="rv-t">'+esc(o.title||'Sin título')+'</div>'+
    (o.phrase?'<div class="rv-p">«'+esc(o.phrase)+'»</div>':'')+(meta?'<div class="rv-m">'+esc(meta)+'</div>':'')+(o.notes?'<div class="rv-n">'+esc(o.notes.length>280?o.notes.slice(0,279)+'…':o.notes)+'</div>':'')+
    '<div class="rv-acts"><button class="btn" data-act="tmRecvDrop" data-id="'+esc(o.id)+'">Descartar</button><button class="btn primary" data-act="tmRecvAdd" data-id="'+esc(o.id)+'">Añadir a mis tareas</button></div></div>'; }
function recvListHTML(){ if(!TM.recv.length) return '<div class="empty">'+TI.recv.replace('<svg','<svg style="width:44px;height:44px"')+'<b>Nada recibido</b>Aquí llegan las tareas que te envían con Avisar a.</div>';
  return '<div class="recvlist">'+TM.recv.map(recvCardHTML).join('')+'</div>'; }
// iPhone: the sheet of Recibidas; the desktop shows the same list in its column (view 'received')
function recvSheet(){ if(UI.wide){ setDeskView('received'); return; }
  openSheet('<div class="shead"><span></span><h2>Recibidas</h2><button class="hbtn ok" data-x="cancel">Hecho</button></div><div class="wsheet recvsheet">'+recvListHTML()+'</div>', s=>{
    s.onclick=e=>{ if(e.target.closest('[data-x=cancel]')){ closeSheet(); return; } const a=e.target.closest('[data-act]'); if(a) teamAct(a.dataset.act, a, null, e); }; }); }
function recvPaintSheet(){ const w=sheet.querySelector('.recvsheet'); if(!w) return; if(!TM.recv.length){ closeSheet(); return; } w.innerHTML=recvListHTML(); }
// «Añadir a mis tareas»: the project first (the active space's, or none), then an ordinary task of this member with what the copy brought
function recvAddMenu(id, src){ const o=TM.recv.find(x=>x.id===id); if(!o||o.title==null) return;
  const dot=c=>'<span class="pm-dot" style="background:'+c+'"></span>';
  popMenu({anchor:src, align:UI.wide?'right':undefined, title:UI.wide?'':'Añadir al proyecto', groups:[activeProjects().map(p=>({label:p.name, icon:dot(p.color), fn:()=>recvAdd(id, p.id)})), [{label:'Sin proyecto', icon:dot('var(--ink3)'), fn:()=>recvAdd(id, null)}]]}); }
async function recvAdd(id, projectId){ const o=TM.recv.find(x=>x.id===id); if(!o) return; if(!navigator.onLine){ toast('Sin conexión'); return; }
  const t=todayStr(), data={title:String(o.title||'').slice(0,500)||'Sin título', notes:String(o.notes||''), projectId:projectId||null, priority:['high','mid','none'].includes(o.priority)?o.priority:'none',
    date:/^\d{4}-\d{2}-\d{2}$/.test(o.date||'')?(o.date<t?t:o.date):null};
  if(/^\d{4}-\d{2}-\d{2}$/.test(o.deadline||'')) data.deadline=o.deadline; if(EST_VALUES.includes(+o.estimate)) data.estimate=+o.estimate;
  let x=null; batch(()=>{ x=addTask(data); (o.steps||[]).forEach(s=>{ const st=addStep(x.id, s.title); if(s.done) st.done=true; }); save(); });
  const ts=new Date().toISOString();
  try{ await SY.remote.noticeMark(id, {taken:ts}); }
  catch(e){ recvUnmake(x.id); log('warn','Equipo: no se pudo añadir la tarea recibida: '+(e&&e.message||e)); toast(syncOffline(e)?'Sin conexión':'No se pudo añadir'); return; }
  TM.recv=TM.recv.filter(r=>r.id!==id); teamCacheWrite(); haptic(8); log('info','Equipo: tarea recibida añadida'); teamRepaint();
  toast('Añadida a tus tareas', async()=>{ try{ await SY.remote.noticeMark(id, {taken:null}); }catch(e){ toast('Sin conexión'); return; } recvUnmake(x.id); if(!TM.recv.some(r=>r.id===id)) TM.recv.push(o); teamCacheWrite(); teamRepaint(); }); }
// The task made from a copy, gone again (its steps too), without the usual «Tarea eliminada»
function recvUnmake(id){ if(!task(id)) return; DB.tasks=DB.tasks.filter(t=>t.id!==id); cutSteps(new Set([id])); save(); render(); }
async function recvDrop(id){ const o=TM.recv.find(x=>x.id===id); if(!o) return; if(!navigator.onLine){ toast('Sin conexión'); return; }
  try{ await SY.remote.noticeMark(id, {dismissed:new Date().toISOString()}); }catch(e){ toast(syncOffline(e)?'Sin conexión':'No se pudo descartar'); return; }
  TM.recv=TM.recv.filter(r=>r.id!==id); teamCacheWrite(); log('info','Equipo: tarea recibida descartada'); teamRepaint();
  toast('Descartada', async()=>{ try{ await SY.remote.noticeMark(id, {dismissed:null}); }catch(e){ toast('Sin conexión'); return; } if(!TM.recv.some(r=>r.id===id)) TM.recv.push(o); teamCacheWrite(); teamRepaint(); }); }

/* ---------- Avisar a… ---------- */
const canNotice = x => !!x && teamOn() && !!TM.priv && isOpen(x) && teamPeers().length>0;
// «Avisado a Susana hace 2 h»: the last notice of this device for the task
function noticeNote(x){ const l=(x&&x.sentTo||[]).slice(-1)[0]; if(!l) return ''; return 'Avisado a '+String(l.name||'').split(/\s+/)[0]+' '+syncAgo(l.at); }
const noticeLast = (x, to) => (x&&x.sentTo||[]).filter(s=>s.to===to).map(s=>Date.parse(s.at)||0).sort((a,b)=>b-a)[0]||0;
const noticeAgain = t => 'Podrás volver a avisarle a las '+fmtTime(new Date(t+TEAM_NOTICE_WAIT).toISOString());
// The member list (the look of the person picker of decision 68): search, one row per member, those without keys yet shown and not choosable
function noticeSheet(id){ const x=task(id); if(!canNotice(x)) return; flushEdits(); let to=null;
  const rows=q=>{ const k=personKey(q); const ms=teamPeers().filter(m=>!k||personKey(teamName(m)+' '+m.email).includes(k));
    return ms.length?ms.map(m=>'<button type="button" class="pprow'+(m.pub?'':' off')+'" data-to="'+esc(m.id)+'" role="option" aria-selected="'+(m.id===to)+'"'+(m.pub?'':' aria-disabled="true"')+'><span class="ppck">'+(m.id===to?MI.check:'')+'</span><span class="ppl">'+esc(teamName(m))+'<small>'+esc(m.pub?m.email:'Todavía no ha entrado en la app')+'</small></span></button>').join(''):'<div class="ppnone-l">Nadie con ese nombre</div>'; };
  openSheet(sheadHTML('Avisar a', 'Cancelar', 'Enviar')+'<div class="wsheet ntsheet"><div class="ppick"><div class="ppsearch">'+I.search+'<input type="text" data-role="ntq" placeholder="Buscar" autocomplete="off" spellcheck="false" aria-label="Buscar"></div><div class="pplist" role="listbox">'+rows('')+'</div></div>'+
    '<textarea class="wfor" data-role="ntmsg" rows="2" maxlength="300" placeholder="Frase (opcional)"></textarea><div class="hint">Le llega una copia de la tarea: título, notas, fechas, prioridad, tiempo y pasos. Solo esa persona puede leerla.</div><div class="hint nt-when"></div></div>', s=>{
    const q=$('[data-role=ntq]', s), list=$('.pplist', s), okb=$('.hbtn.ok', s), when=$('.nt-when', s);
    const paint=()=>{ list.innerHTML=rows(q.value); const t=to?noticeLast(x, to):0; const soon=t&&Date.now()-t<TEAM_NOTICE_WAIT; okb.disabled=!to||!!soon;
      when.textContent=soon?'Ya le avisaste de esta tarea '+syncAgo(new Date(t).toISOString())+'. '+noticeAgain(t)+'.':''; };
    q.addEventListener('input', paint); list.addEventListener('mousedown', e=>{ if(e.target.closest('.pprow')) e.preventDefault(); });
    s.onclick=e=>{ const r=e.target.closest('[data-to]'); if(r){ if(r.classList.contains('off')){ toast('Todavía no puede recibir tareas'); return; } to=r.dataset.to; haptic(4); paint(); return; }
      const b=e.target.closest('[data-x]'); if(!b) return; if(b.dataset.x!=='ok'){ closeSheet(); return; } if(!to) return;
      const phrase=$('[data-role=ntmsg]', s).value.replace(/\s+/g,' ').trim(); okb.disabled=true; okb.textContent='Enviando';
      noticeSend(id, to, phrase).then(r=>{ okb.textContent='Enviar'; if(!sheet.contains(okb)) return; if(r==='ok'){ closeSheet(); render(); return; } paint(); }); };
    paint(); if(UI.wide) q.focus(); }); }
async function noticeSend(id, to, phrase){ const x=task(id), m=teamMember(to); if(!x||!m||!m.pub) return 'no'; if(!navigator.onLine){ toast('Sin conexión'); return 'no'; }
  const steps=stepsOf(id).map(s=>({title:s.title, done:!!s.done}));
  const copy={v:1, title:x.title||'', notes:String(x.notes||'').slice(0,50000), date:x.date||null, priority:x.priority||'none', estimate:x.estimate||null, deadline:x.deadline||null, steps, phrase:String(phrase||'').slice(0,300),
    fromName:TM.me&&TM.me.name||'', sent:new Date().toISOString()};
  try{ const payload=await teamSeal(m.pub, copy, 'notice'); await SY.remote.noticeSend({recipient_id:to, task_ref:String(id), payload}); }
  catch(e){ const msg=String(e&&(e.message||e.code)||e);
    if(/tareas_notice_too_soon/.test(msg)){ const until=Date.parse(e.details||e.detail||'')||0; toast('Ya le avisaste de esta tarea hace poco.'+(until?' Podrás volver a avisarle a las '+fmtTime(new Date(until).toISOString())+'.':'')); log('info','Equipo: aviso demasiado pronto'); return 'soon'; }
    if(/tareas_notice_too_many/.test(msg)){ toast('Has enviado muchos avisos seguidos. Prueba dentro de un rato'); log('info','Equipo: demasiados avisos en una hora'); return 'no'; }
    if(/bad_recipient/.test(msg)){ TM.dirForce=true; toast('Esa persona ya no puede recibir tareas'); log('info','Equipo: destinatario sin acceso'); return 'no'; }
    log('warn','Equipo: el aviso no se pudo enviar: '+msg); toast(syncOffline(e)?'Sin conexión':'No se pudo enviar'); return 'no'; }
  const at=new Date().toISOString(), cur=task(id); if(cur){ cur.sentTo=(cur.sentTo||[]).concat({to, name:teamName(m), at}).slice(-10); SY.quiet=true; try{ save(); } finally{ SY.quiet=false; } }
  log('info','Equipo: tarea enviada', {pasos:steps.length}); haptic(8); toast('Avisado a '+teamFirst(m)); if(!busyEditing()) render(); return 'ok'; }
// The detail (iPhone) and the inspector (desktop): the action, and the last notice of this device under it
function noticeCellHTML(x){ if(!canNotice(x)&&!(x&&x.sentTo&&x.sentTo.length&&teamOn())) return ''; const n=noticeNote(x);
  if(UI.wide) return canNotice(x)?'<span></span><button class="iremind inotice" data-act="tmNotice">'+TI.notice+'Avisar a…'+(n?'<small>'+esc(n)+'</small>':'')+'</button>':'';
  return '<div class="group"><button class="cell link remcell" data-act="tmNotice"'+(canNotice(x)?'':' disabled')+'>'+TI.notice+'<span class="lbl">Avisar a…</span></button></div>'+(n?'<div class="footnote ntnote">'+esc(n)+'</div>':''); }
// The menu entries (iPhone long press, detail and desktop menus)
const noticeItems = (x, icon) => canNotice(x)?[{label:'Avisar a…', icon:icon?TI.notice:undefined, fn:()=>noticeSheet(x.id)}]:[];

/* ---------- Storage (63c) ---------- */
const TEAM_NOSPACE='No queda espacio. Borra adjuntos o pide más al administrador';
// 0 MB, 0,8 MB, 12 MB, 1,5 GB
const fmtMB = n => { n=+n||0; const mb=n/1048576; if(mb>=1024) return String(Math.round(mb/102.4)/10).replace('.', ',')+' GB'; if(mb>0&&mb<10) return String(Math.max(0.1, Math.round(mb*10)/10)).replace('.', ',')+' MB'; return Math.round(mb)+' MB'; };
// Full: the quota is known and what is stored reaches it (with what is about to go, when given)
function teamFull(extra){ if(!teamOn()||!TM.me||TM.me.quota==null) return false; return (TM.me.used||0)+(extra||0)>TM.me.quota || (!extra&&(TM.me.used||0)>=TM.me.quota); }
// Before taking a photo or recording: said at once when there is no room
function teamRoomOk(){ if(!teamFull()) return true; toast(TEAM_NOSPACE); log('info','Equipo: sin espacio para adjuntos'); return false; }
// The upload queue (attFlush): a file that does not fit waits on the device; said once a session
function teamUploadFits(size){ if(!teamFull(size)) return true; if(!TM.noSpace){ TM.noSpace=true; toast(TEAM_NOSPACE); log('info','Equipo: sin espacio, los adjuntos esperan en el dispositivo'); } return false; }
function teamUploaded(size){ TM.upAt=Date.now(); if(TM.me){ TM.me.used=(TM.me.used||0)+(+size||0); teamCacheWrite(); } }
// An upload refused by the server: perhaps the quota (re-read it)
function teamUploadRefused(e, size){ if(!teamOn()) return false; const m=String(e&&(e.message||e.error||e.statusCode)||e); if(!/row-level security|403|Unauthorized/i.test(m)) return false;
  TM.force=true; if(SY&&SY.user) teamFetch(SY.user).then(()=>{ if(teamFull(size)&&!TM.noSpace){ TM.noSpace=true; toast(TEAM_NOSPACE); log('info','Equipo: el servidor no admite más adjuntos'); } if(onSettings()) render(); }).catch(()=>{}); return true; }

/* ---------- Sugerencia o incidencia (63d) ---------- */
function teamDevice(){ const ua=navigator.userAgent||''; const os=/iPhone/.test(ua)?'iPhone':/iPad/.test(ua)?'iPad':/Mac/.test(ua)?'Mac':/Windows/.test(ua)?'Windows':/Android/.test(ua)?'Android':/Linux/.test(ua)?'Linux':'Otro';
  const br=/Edg\//.test(ua)?'Edge':/Chrome\//.test(ua)?'Chrome':/Firefox\//.test(ua)?'Firefox':/Safari\//.test(ua)?'Safari':'navegador'; let inst=false; try{ inst=navigator.standalone===true||matchMedia('(display-mode: standalone)').matches; }catch(e){}
  return os+', '+br+(inst?', instalada':'')+', '+innerWidth+' x '+innerHeight; }
const teamAdminEntry = () => TM.dir.find(m=>m.admin)||null;
// Who sent a suggestion: the directory's name, else the one it carries, else the start of its email
const fbFrom = f => { const m=teamMember(f.from); return m?teamName(m):(f.body&&(f.body.fromName||String(f.body.email||'').split('@')[0]))||'Alguien'; };
function feedbackSheet(){ if(!teamOn()||teamAdmin()) return; let kind='sugerencia';
  openSheet(sheadHTML('Al administrador', 'Cancelar', 'Enviar')+'<div class="wsheet fbsheet"><div class="seg fbseg"><button data-k="sugerencia" class="on">Sugerencia</button><button data-k="incidencia">Incidencia</button></div>'+
    '<textarea class="wfor" data-role="fbtext" rows="5" maxlength="4000" placeholder="Cuéntalo con tus palabras"></textarea>'+
    '<label class="cx-check fblog" hidden><input type="checkbox" data-role="fblog"><span>Adjuntar el registro de la app</span></label>'+
    '<div class="hint">Se envía también la versión (v'+APP_VERSION+') y el dispositivo. Solo lo lee el administrador.</div></div>', s=>{
    const ta=$('[data-role=fbtext]', s), lg=$('.fblog', s), okb=$('.hbtn.ok', s);
    s.onclick=e=>{ const k=e.target.closest('[data-k]'); if(k){ kind=k.dataset.k; s.querySelectorAll('.fbseg button').forEach(b=>b.classList.toggle('on', b===k)); lg.hidden=kind!=='incidencia'; haptic(4); return; }
      const b=e.target.closest('[data-x]'); if(!b) return; if(b.dataset.x!=='ok'){ closeSheet(); return; }
      const text=ta.value.trim(); if(!text){ ta.focus(); toast('Escribe qué quieres contar'); return; }
      okb.disabled=true; feedbackSend(kind, text, kind==='incidencia'&&$('[data-role=fblog]', s).checked).then(ok=>{ okb.disabled=false; if(ok&&sheet.contains(okb)) closeSheet(); }); };
    sheetGuard=()=>ta.value.trim()?{title:'¿Descartar el mensaje?', label:'Descartar', field:ta}:null;
    ta.focus(); }); }
async function feedbackSend(kind, text, withLog){ const a=teamAdminEntry(); if(!navigator.onLine){ toast('Sin conexión'); return false; }
  if(!a||!a.pub){ toast('El administrador todavía no puede recibirlo'); return false; }
  const body={v:1, kind, text:text.slice(0,4000), version:APP_VERSION, device:teamDevice(), fromName:TM.me&&TM.me.name||'', email:TM.me&&TM.me.email||(SY.user&&SY.user.email)||'', at:new Date().toISOString()};
  if(withLog) body.log=logText().slice(-200000);
  try{ await SY.remote.feedbackSend({recipient_id:a.id, kind, payload:await teamSeal(a.pub, body, 'feedback')}); }
  catch(e){ log('warn','Equipo: no se pudo enviar la '+kind+': '+(e&&e.message||e)); toast(/too_many/.test(String(e&&e.message))?'Has enviado muchas seguidas. Prueba dentro de un rato':syncOffline(e)?'Sin conexión':'No se pudo enviar'); return false; }
  log('info','Equipo: '+kind+' enviada', {registro:!!withLog}); toast(kind==='incidencia'?'Incidencia enviada':'Sugerencia enviada'); return true; }

/* ---------- Equipo (admin) ---------- */
// Read when Ajustes shows Equipo, at most once a minute (a failure waits that minute too, so the screen never loops on it)
async function teamListLoad(force){ if(!teamAdmin()||TM.listBusy||!navigator.onLine) return; if(!force&&Date.now()-TM.listAt<60e3) return; TM.listBusy=true; TM.listAt=Date.now();
  try{ TM.list=(await SY.remote.teamList())||[]; TM.listErr=false; if(force) TM.dirForce=true; const fb=await SY.remote.feedbackList(); TM.inboxRaw=fb||[]; await teamInboxOpen(); }
  catch(e){ TM.listErr=true; log('warn','Equipo: lista no disponible: '+(e&&e.message||e)); }
  finally{ TM.listBusy=false; if(onSettings()&&!busyEditing()&&!touchDrag) render(); } }
async function teamInboxOpen(){ const out=[]; for(const f of TM.inboxRaw||[]){ const had=(TM.inbox||[]).find(o=>o.id===f.id&&o.body);
    let body=had?had.body:null; if(!body){ try{ body=await teamOpen(f.payload, 'feedback'); }catch(e){ body=null; } }
    out.push({id:f.id, kind:f.kind, status:f.status, created:f.created, from:f.sender_id, body}); }
  TM.inbox=out; }
const memberState = m => m.revoked?'Sin acceso':!m.joined?'Invitado':m.last_access?syncAgo(m.last_access):'Sin entrar';
function teamSectionHTML(dev){ if(!teamOn()) return '';
  const used=TM.me?TM.me.used||0:0, q=TM.me?TM.me.quota:null, chev=I.chev.replace('<svg','<svg class="chev"');
  const store='<div class="cell"><span class="lbl">Almacenamiento</span><span class="val'+(teamFull()||TM.noSpace?' warn':'')+'">'+(q==null?fmtMB(used)+', sin límite':fmtMB(used)+' de '+fmtMB(q))+'</span></div>';
  if(!teamAdmin()) return '<div class="group-title">Equipo</div><div class="group team-acc">'+store+'<button class="cell link" data-act="tmFeedback">'+MI.send+'<span class="lbl">Enviar sugerencia o incidencia</span></button></div>'+
    '<div class="footnote">'+(teamFull()||TM.noSpace?'No queda espacio para fotos y notas de voz. Borra adjuntos o pide más al administrador. ':'')+'Lo que envíes solo lo lee el administrador.</div>';
  teamListLoad(false); const ms=TM.list||[], me=SY.user.id, nNew=(TM.inbox||[]).filter(f=>f.status==='nueva').length;
  const row=m=>'<button class="cell" data-act="tmMember" data-id="'+esc(m.id)+'"><span class="lbl">'+esc(m.name||m.email)+'<small>'+esc((m.role==='admin'?'Administrador':m.name?m.email:'')+(m.revoked?'':(m.role==='admin'||m.name?', ':'')+(m.quota==null?fmtMB(m.used):fmtMB(m.used)+' de '+fmtMB(m.quota))))+'</small></span><span class="val'+(m.revoked?' warn':'')+'">'+esc(m.role==='admin'?'Tú':memberState(m))+'</span>'+chev+'</button>';
  return '<div class="group-title">Equipo</div><div class="group team-acc team-members">'+(TM.list?ms.map(row).join(''):'<div class="cell"><span class="lbl" style="color:var(--ink2)">'+(!navigator.onLine?'Sin conexión':TM.listErr?'No disponible ahora':'Cargando')+'</span></div>')+
    '<button class="cell link" data-act="tmInvite">'+I.plus.replace('<svg','<svg style="width:18px;height:18px"')+'<span class="lbl">Invitar</span></button></div>'+
    '<div class="footnote">Cada persona entra con su cuenta de Google y solo ve sus datos. Tú ves su nombre, su correo, su último acceso y lo que ocupan sus adjuntos, nunca sus tareas.</div>'+
    '<div class="group">'+store+'<button class="cell" data-act="tmInbox"><span class="lbl">Sugerencias e incidencias</span><span class="val">'+(nNew?(nNew===1?'1 nueva':nNew+' nuevas'):(TM.inbox||[]).length||'Ninguna')+'</span>'+chev+'</button></div>'; }
// The message of an invitation: the app's address, by WhatsApp, mail or the share sheet
const teamAppUrl = () => location.origin+location.pathname.replace(/index\.html$/,'');
const inviteText = () => 'Te he dado acceso a Tareas. Entra con tu cuenta de Google en '+teamAppUrl();
function inviteSend(email, kind){ const text=inviteText();
  if(kind==='wa'){ window.open('https://wa.me/?text='+encodeURIComponent(text), '_blank', 'noopener'); return; }
  if(kind==='mail'){ const a=document.createElement('a'); a.href='mailto:'+encodeURIComponent(email||'').replace(/%40/g,'@')+'?subject='+encodeURIComponent('Acceso a Tareas')+'&body='+encodeURIComponent(text); a.style.display='none'; document.body.appendChild(a); a.click(); a.remove(); return; }
  if(navigator.share){ navigator.share({text}).catch(e=>{ if(!e||e.name!=='AbortError') copyText(text, 'Invitación copiada'); }); return; }
  copyText(text, 'Invitación copiada'); }
function inviteShareSheet(email, name){ openSheet('<div class="shead"><span></span><h2>Enviar invitación</h2><button class="hbtn ok" data-x="cancel">Hecho</button></div><div class="wsheet invsheet"><div class="rto">'+esc(name||email)+' ya tiene acceso</div>'+
    '<div class="inv-msg">'+esc(inviteText())+'</div><div class="inv-acts"><button class="btn" data-inv="wa">WhatsApp</button><button class="btn" data-inv="mail">Correo</button><button class="btn" data-inv="share">'+(navigator.share?'Otras apps':'Copiar')+'</button></div>'+
    '<div class="hint">Cuando entre con su cuenta de Google, la app le pedirá crear su contraseña de cifrado.</div></div>', s=>{
    s.onclick=e=>{ const b=e.target.closest('[data-inv]'); if(b){ inviteSend(email, b.dataset.inv); log('info','Equipo: invitación enviada', {via:b.dataset.inv}); return; } if(e.target.closest('[data-x]')) closeSheet(); }; }); }
function inviteSheet(){ if(!teamAdmin()) return;
  openSheet(sheadHTML('Invitar', 'Cancelar', 'Invitar')+'<div class="wsheet csheet"><input class="wfor" data-role="ivmail" type="email" inputmode="email" autocapitalize="off" spellcheck="false" placeholder="Correo de su cuenta de Google" autocomplete="off">'+
    '<input class="wfor" data-role="ivname" type="text" autocapitalize="words" placeholder="Nombre (opcional)" autocomplete="off"><div class="hint">Tendrá '+fmtMB(TEAM_QUOTA_DEFAULT)+' para fotos y notas de voz. Lo puedes cambiar después.</div></div>', s=>{
    const em=$('[data-role=ivmail]', s), nm=$('[data-role=ivname]', s), okb=$('.hbtn.ok', s);
    const go=async()=>{ const email=em.value.trim().toLowerCase(), name=nm.value.replace(/\s+/g,' ').trim(); if(!validEmail(email)){ em.focus(); toast('Escribe un correo válido'); return; }
      if(!navigator.onLine){ toast('Sin conexión'); return; } okb.disabled=true;
      try{ await SY.remote.teamInvite(email, name||null); }catch(e){ okb.disabled=false; log('warn','Equipo: no se pudo invitar: '+(e&&e.message||e)); toast(inviteErr(e)); return; }
      log('info','Equipo: persona invitada'); await teamListLoad(true); closeSheet(); setTimeout(()=>inviteShareSheet(email, name), 520); };
    [em,nm].forEach(i=>i.addEventListener('keydown', e=>{ if(e.key==='Enter'&&!e.isComposing){ e.preventDefault(); if(i===em) nm.focus(); else go(); } }));
    s.onclick=e=>{ const b=e.target.closest('[data-x]'); if(!b) return; if(b.dataset.x==='ok') go(); else closeSheet(); };
    em.focus(); }); }
const QUOTAS=[52428800, 104857600, 262144000, 524288000, 1073741824];
function memberSheet(id){ const m=(TM.list||[]).find(o=>o.id===id); if(!m) return; const me=m.role==='admin';
  const cell=(l,v,cls)=>'<div class="cell"><span class="lbl">'+l+'</span><span class="val'+(cls?' '+cls:'')+'">'+v+'</span></div>';
  const del=m.revoked?new Date(Date.parse(m.revoked)+30*864e5).toISOString():null;
  openSheet('<div class="shead"><span></span><h2>'+esc(m.name||m.email)+'</h2><button class="hbtn ok" data-x="cancel">Hecho</button></div><div class="wsheet msheet"><div class="group">'+
    cell('Correo', esc(m.email))+cell('Último acceso', esc(m.last_access?syncAgo(m.last_access):m.joined?'Sin datos':'Todavía no ha entrado'))+
    (me?'':cell('Cifrado', m.has_key?'Activado':'Sin activar'))+cell('Almacenamiento', esc(m.quota==null?fmtMB(m.used)+', sin límite':fmtMB(m.used)+' de '+fmtMB(m.quota)), m.quota!=null&&m.used>=m.quota?'warn':'')+
    (me||m.revoked?'':'<button class="cell" data-mq><span class="lbl">Cupo</span><span class="val">'+esc(m.quota==null?'Sin límite':fmtMB(m.quota))+'</span>'+I.chev.replace('<svg','<svg class="chev"')+'</button>')+'</div>'+
    (m.revoked&&Date.parse(del)<=Date.now()?'<div class="footnote">Sin acceso desde el '+esc(crDay(m.revoked))+'. '+TEAM_REMOVING+'.</div>':
     m.revoked?'<div class="footnote">Sin acceso desde el '+esc(crDay(m.revoked))+'. Sus datos se borran el '+esc(crDay(del))+'.</div><button class="wback" data-x="again">Invitar de nuevo</button>':
     me?'<div class="footnote">Eres el administrador. No tienes límite de almacenamiento salvo que lo cambies.</div><button class="wback" data-mq>Cupo: '+esc(m.quota==null?'sin límite':fmtMB(m.quota))+'</button>':
     '<button class="wback" data-x="resend">Enviar la invitación otra vez</button><button class="wback red" data-x="revoke">Quitar acceso</button>')+'</div>', s=>{
    s.onclick=e=>{ const q=e.target.closest('[data-mq]'); if(q){ quotaMenu(m, q.querySelector('.val')||q); return; }
      const b=e.target.closest('[data-x]'); if(!b) return; const x=b.dataset.x;
      if(x==='cancel'){ closeSheet(); return; } if(x==='resend'){ closeSheet(); setTimeout(()=>inviteShareSheet(m.email, m.name), 520); return; }
      if(x==='again'){ closeSheet(); teamReinvite(m); return; } if(x==='revoke'){ closeSheet(); setTimeout(()=>revokeAsk(m), UI.wide?0:520); } }; }); }
function quotaMenu(m, src){ const cur=m.quota;
  popMenu({anchor:src, align:'right', groups:[QUOTAS.map(v=>({label:fmtMB(v), on:cur===v, fn:()=>setQuota(m, v)})), [{label:'Sin límite', on:cur==null, fn:()=>setQuota(m, null)}]]}); }
async function setQuota(m, v){ if(!navigator.onLine){ toast('Sin conexión'); return; }
  try{ await SY.remote.teamQuota(m.id, v); }catch(e){ toast('No se pudo cambiar'); log('warn','Equipo: cupo no cambiado: '+(e&&e.message||e)); return; }
  log('info','Equipo: cupo cambiado', {mb:v==null?null:Math.round(v/1048576)}); toast('Cupo: '+(v==null?'sin límite':fmtMB(v))); await teamListLoad(true);
  if(m.user_id===(SY.user&&SY.user.id)||m.role==='admin'){ TM.force=true; syncRun('equipo'); }
  const now=(TM.list||[]).find(o=>o.id===m.id); if(now&&sheet.classList.contains('on')&&sheet.querySelector('.msheet')) memberSheet(now.id); }
function revokeAsk(m){ const n=m.name||m.email;
  confirmSheet('Quitar acceso', n+' dejará de poder entrar al momento, sin recibir ningún aviso. Sus datos se borran a los 30 días. No se puede deshacer; para devolverle el acceso tendrás que invitarle de nuevo.', async()=>{
    try{ await SY.remote.teamRevoke(m.id); }catch(e){ toast(syncOffline(e)?'Sin conexión':'No se pudo quitar el acceso'); log('warn','Equipo: acceso no quitado: '+(e&&e.message||e)); return; }
    log('info','Equipo: acceso quitado'); toast('Acceso quitado a '+n); TM.dirForce=true; await teamListLoad(true); }, 'Quitar acceso'); }
// The server refuses to give back the access of someone whose data are being deleted (removed more than 30 days ago): a new invitation once it ends
const TEAM_REMOVING='Se está borrando. Invítale de nuevo cuando termine';
const inviteErr = e => /tareas_team_removing/.test(String(e&&e.message||e))?TEAM_REMOVING:/bad_email/.test(String(e&&e.message||e))?'Escribe un correo válido':syncOffline(e)?'Sin conexión':'No se pudo invitar';
async function teamReinvite(m){ try{ await SY.remote.teamInvite(m.email, null); }catch(e){ toast(inviteErr(e)); return; }
  log('info','Equipo: persona invitada de nuevo'); await teamListLoad(true); inviteShareSheet(m.email, m.name); }
// The admin's inbox: the newest first; opening one marks it vista
function inboxSheet(){ if(!teamAdmin()) return; const L=TM.inbox||[];
  const row=f=>'<button class="cell" data-fb="'+esc(f.id)+'"><span class="lbl">'+(f.kind==='incidencia'?'Incidencia':'Sugerencia')+'<small>'+esc(f.body?fbFrom(f)+', '+String(f.body.text||'').split('\n')[0].slice(0,80):'No se puede leer')+'</small></span><span class="val'+(f.status==='nueva'?' fbnew':'')+'">'+esc(f.status==='nueva'?'Nueva':f.status==='vista'?'Vista':'Resuelta')+'</span>'+I.chev.replace('<svg','<svg class="chev"')+'</button>';
  openSheet('<div class="shead"><span></span><h2>Sugerencias e incidencias</h2><button class="hbtn ok" data-x="cancel">Hecho</button></div><div class="wsheet fbinbox">'+(L.length?'<div class="group">'+L.map(row).join('')+'</div>':'<div class="empty">'+MI.send+'<b>Nada por ahora</b>Aquí llegan las sugerencias e incidencias del equipo.</div>')+'</div>', s=>{
    s.onclick=e=>{ const r=e.target.closest('[data-fb]'); if(r){ feedbackOpen(r.dataset.fb); return; } if(e.target.closest('[data-x]')) closeSheet(); }; }); }
function feedbackOpen(id){ const f=(TM.inbox||[]).find(o=>o.id===id); if(!f) return; const b=f.body;
  if(f.status==='nueva') feedbackStatus(f, 'vista', true);
  openSheet('<div class="shead"><button class="hbtn" data-x="back">Atrás</button><h2>'+(f.kind==='incidencia'?'Incidencia':'Sugerencia')+'</h2><button class="hbtn ok" data-x="cancel">Hecho</button></div><div class="wsheet fbone">'+
    (b?'<div class="fb-h">'+esc(fbFrom(f)+(b.email?', '+b.email:''))+'<br>'+esc(fmtDateTime(f.created))+'</div><div class="fb-t">'+esc(b.text||'')+'</div><div class="fb-m">v'+esc(b.version||'')+', '+esc(b.device||'')+'</div>'+
      (b.log?'<details class="fb-log"><summary>Registro de la app</summary><pre>'+esc(b.log)+'</pre></details>':''):'<div class="fb-t muted">No se puede leer con la clave de este dispositivo.</div>')+
    '<button class="wback" data-st="'+(f.status==='resuelta'?'vista':'resuelta')+'">'+(f.status==='resuelta'?'Marcar como no resuelta':'Marcar como resuelta')+'</button></div>', s=>{
    s.onclick=e=>{ const st=e.target.closest('[data-st]'); if(st){ feedbackStatus(f, st.dataset.st).then(()=>feedbackOpen(id)); return; }
      const x=e.target.closest('[data-x]'); if(!x) return; if(x.dataset.x==='back') inboxSheet(); else closeSheet(); }; }); }
async function feedbackStatus(f, st, quiet){ try{ await SY.remote.feedbackMark(f.id, st); f.status=st; log('info','Equipo: buzón '+st); if(!quiet) toast(st==='resuelta'?'Resuelta':'Sin resolver'); }
  catch(e){ if(!quiet) toast(syncOffline(e)?'Sin conexión':'No se pudo cambiar'); } }

/* ---------- Taps ---------- */
function teamAct(a, el, detailId, e){
  switch(a){
    case 'tmRecv': recvSheet(); break;
    case 'tmRecvAdd': recvAddMenu(el.dataset.id, el); break;
    case 'tmRecvDrop': recvDrop(el.dataset.id); break;
    case 'tmNotice': if(detailId) noticeSheet(detailId); break;
    case 'tmFeedback': feedbackSheet(); break;
    case 'tmInvite': inviteSheet(); break;
    case 'tmMember': memberSheet(el.dataset.id); break;
    case 'tmInbox': inboxSheet(); break;
  } }
// Opened from a notification (sw.js): ?open=received or ?open=feedback, or the message of an open app
function teamOpenFrom(what){ log('info','Equipo: abierto desde una notificación', {what});
  const go=()=>{ if(what==='received'){ if(UI.wide) setDeskView('received'); else recvSheet(); }
    else if(what==='feedback'){ if(UI.wide) setDeskView('settings'); else { if(UI.stack.length) pop(); switchTab('ajustes'); } if(teamAdmin()) teamListLoad(true).then(inboxSheet); } };
  if(SY&&SY.user){ syncRun('aviso').then(go); } else go(); }
