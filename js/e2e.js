'use strict';
/* Tareas. End-to-end encryption, the app side (decision 63a): the layer around the remote adapter, the gate of each sync pass, activation
   and the encryption of what the server already holds, unlocking on another device, changing the password, and the Cifrado section.
   A classic script: index.html loads every file of js/ in order and they share their global names. Only declarations and
   listeners run at load; the start itself (first screen, timers, sync, service worker) is in boot.js, the last file.
   - The data on the device stays plain (localStorage, IndexedDB, exports, local backups): the protection is for the server copy.
   - cryptoRemote wraps SY.remote, whatever it is (supabaseRemote or a test's fake): rows are encrypted on the way up and opened on the
     way down, so the merge, the signatures (known) and the rest of the sync work on plain rows as before. Files too.
   - The account's state comes from the row crypto_keys (CR.row): undefined while unknown, null when encryption is off, the row when on.
     On, with no key on this device (CR.key), the sync stops: no pull, no push, nothing merged; Ajustes and the account line say so
     and the unlock sheet opens once per session.
   - Activation keeps a local flag (CR_FLAG) 'migrating' until every row, file and Siri phrase on the server is encrypted; a pass that
     finds it continues the work (cryptoResume). Every step is idempotent: what is already encrypted is skipped.
   - Never logged: the password, the key or any text. */
const CR_FLAG='tareas-crypto';
// CRYPTO_REFUSED: the message of the server's trigger (0012_encryption.sql) when a device on an older version sends plain text
const CRYPTO_REFUSED=/tareas_plaintext_refused/;
const CR={ key:null, kid:null, owner:null, keyP:null, row:undefined, for:null, at:0, force:false, absent:false, loading:false, asked:false, busy:false, migrating:false, prog:null, bad:new Set(), timer:0, lockLogged:false, resumeAt:0, wait:0 };
const crFlag = () => { try{ const v=JSON.parse(localStorage.getItem(CR_FLAG)||'null'); return v&&typeof v==='object'?v:null; }catch(e){ return null; } };
const crFlagWrite = v => { try{ if(v) localStorage.setItem(CR_FLAG, JSON.stringify(v)); else localStorage.removeItem(CR_FLAG); }catch(e){} };
// Encryption on for the signed-in account (as last read from the server)
const crOn = () => !!(SY&&SY.user&&CR.for===SY.user.id&&CR.row);
// The data key, only when it is this account's
const crKey = () => crOn()&&CR.key&&CR.owner===SY.user.id&&CR.kid===CR.row.kid ? CR.key : null;
const cryptoLocked = () => crOn() && !crKey();
const crErr = (msg, code) => { const e=new Error(msg); e.code=code; return e; };
const crLockedErr = () => crErr('Falta la contraseña de cifrado', 'tareas_locked');
// A row that does not open with this key: left out, said once per table (never shown as e1:...)
function crBad(table, row){ if(CR.bad.has(table)) return; CR.bad.add(table); log('error','Cifrado: una fila de '+table+' no se puede descifrar y se deja fuera', {id:row&&row.id}); }
// The file as Storage has it, through the adapter's own download or its signed URL
async function crRawDownload(R, path, ttl){ if(R.fileDownload) return R.fileDownload(path, ttl);
  const r=await fetch(await R.fileUrl(path, ttl), {cache:'no-store'}); if(!r.ok) throw new Error('HTTP '+r.status); return r.blob(); }

/* ---------- The layer around the remote adapter ---------- */
function cryptoRemote(inner){ if(!inner||inner.__crypto) return inner;
  const w=Object.create(inner); w.__crypto=true; w.inner=inner;
  /* Rows from the server, opened. Without the key the account is read again first: on (another device has just turned it on), the pass
     stops before anything is merged; off, a text that starts with 'e1:' is only text. With the key, a value that does not open leaves its
     row out (a text typed as 'e1:...' before activation that the encryption of the server copy has not reached yet comes back with it) */
  const open=async(table, rows)=>{ if(!CRYPTO_COLS[table]||!Array.isArray(rows)||!rows.some(r=>cryptoRowEnc(table, r))) return rows;
    let k=crKey();
    if(!k){ if(SY&&SY.user&&!CR.busy) await crFetch(SY.user); k=crKey(); if(!k&&(crOn()||!SY||!SY.user||CR.for!==SY.user.id)){ CR.force=true; throw crLockedErr(); } if(!k) return rows; }
    const out=[]; for(const r of rows){ try{ out.push(await cryptoDecRow(k, table, r)); }catch(e){ crBad(table, r); } } return out; };
  w.pull=async(table, after, limit)=>open(table, await inner.pull(table, after, limit));
  w.byIds=async(table, ids)=>open(table, await inner.byIds(table, ids));
  // Rows up: the listed columns encrypted. On without the key nothing plain may leave (the gate stops the pass before this)
  w.upsert=async(table, rows)=>{ if(!CRYPTO_COLS[table]) return inner.upsert(table, rows); const k=crKey();
    if(!k){ if(crOn()) throw crLockedErr(); return inner.upsert(table, rows); }
    const send=[]; for(const r of rows) send.push(await cryptoEncRow(k, table, r)); return inner.upsert(table, send); };
  // Realtime: opened in order, one after another
  if(inner.subscribe) w.subscribe=(uid, onRow, onStatus)=>{ let chain=Promise.resolve();
    return inner.subscribe(uid, (table, row)=>{ chain=chain.then(async()=>{
      if(!cryptoRowEnc(table, row)){ onRow(table, row); return; }
      const k=crKey(); if(!k){ CR.force=true; crCheckSoon(); return; } // another device turned encryption on: this one asks for the password
      let r; try{ r=await cryptoDecRow(k, table, row); }catch(e){ crBad(table, row); return; } onRow(table, r); }).catch(e=>log('error','Tiempo real: '+(e&&e.message||e))); }, onStatus); };
  if(inner.fileUpload) w.fileUpload=async(path, blob, mime)=>{ const k=crKey();
    if(!k){ if(crOn()) throw crLockedErr(); return inner.fileUpload(path, blob, mime); }
    const enc=await cryptoEncFile(k, new Uint8Array(await blob.arrayBuffer()), path); return inner.fileUpload(path, new Blob([enc], {type:mime||blob.type}), mime); };
  if(inner.fileDownload||inner.fileUrl) w.fileDownload=async(path, ttl)=>{ const blob=await crRawDownload(inner, path, ttl), u=new Uint8Array(await blob.arrayBuffer());
    if(!cryptoFileEnc(u)) return blob; const k=crKey(); if(!k){ CR.force=true; throw crLockedErr(); }
    return new Blob([await cryptoDecFile(k, u, path)], {type:blob.type}); };
  // Siri (decision 62): with encryption on, the phrase leaves the server when its task is made; the task goes up encrypted
  if(inner.inboxTake) w.inboxTake=(ids, ts)=>inner.inboxTake(ids, ts, crOn()?{clear:true}:undefined);
  return w; }

/* ---------- The account's state and the gate of each pass ---------- */
function cryptoBoot(){ crKeyBoot(); }
function crKeyBoot(){ if(!CR.keyP) CR.keyP=cryptoKeyLoad().then(r=>{ if(r&&!CR.key){ CR.key=r.key; CR.kid=r.kid; CR.owner=r.owner; } })
  .catch(e=>log('warn','Clave de cifrado de este dispositivo no disponible: '+(e&&e.message||e))); return CR.keyP; }
// The row of the server. Throws on a network error (the pass fails and is retried, as any other)
async function crFetch(user){ const R=SY.remote; if(!R.__crypto||!R.cryptoGet){ CR.row=null; CR.for=user.id; return null; }
  const row=await R.cryptoGet(); if(!SY.user||SY.user.id!==user.id) return null;
  CR.absent=syncMissing('crypto_keys'); CR.row=row&&row.kid?{kid:row.kid, salt:row.salt, iterations:+row.iterations||CRYPTO_ITER, wrapped:row.wrapped, created:row.created||null, modified:row.modified||null}:null;
  CR.for=user.id; CR.at=Date.now(); CR.force=false; return CR.row; }
// 'off', 'on' or 'locked'. Read again after a minute without the key, after ten with it, or when something said it may have changed
async function cryptoGate(user){ const R=SY.remote; if(!R.__crypto||!R.cryptoGet) return 'off'; // an adapter without encryption (a test's stand-in)
  await crKeyBoot();
  if(CR.for!==user.id){ CR.row=undefined; CR.asked=false; CR.lockLogged=false; }
  if(CR.row===undefined||CR.force||Date.now()-CR.at>(CR.key?600e3:60e3)) await crFetch(user);
  if(!CR.row){ const f=crFlag(); if(f&&f.state==='migrating'&&f.owner===user.id&&!CR.busy) crFlagWrite(null); return 'off'; } // an activation that never reached the server
  if(CR.key&&(CR.kid!==CR.row.kid||CR.owner!==user.id)){ log('warn','La clave de cifrado de este dispositivo no es la de la cuenta: se pide la contraseña'); await crForget(); }
  if(!crKey()){ const r=await cryptoKeyLoad().catch(()=>null); if(r&&r.owner===user.id&&r.kid===CR.row.kid){ CR.key=r.key; CR.kid=r.kid; CR.owner=r.owner; } } // unlocked or activated in another window
  if(crKey()){ CR.lockLogged=false; return 'on'; }
  if(!CR.lockLogged){ CR.lockLogged=true; log('info','Cifrado activado en la cuenta y sin contraseña en este dispositivo: la sincronización espera'); }
  return 'locked'; }
// A failed pass caused by encryption: rows that need the key, or plain text refused by the server. Returns true when handled
function cryptoFailed(e){ const m=String(e&&(e.message||e.code)||e)+' '+String(e&&e.code||'');
  if(e&&e.code==='tareas_locked'){ SY.status='locked'; SY.error=''; CR.force=true; if(!CR.lockLogged){ CR.lockLogged=true; log('info','Datos cifrados en el servidor y sin contraseña en este dispositivo'); } cryptoAskUnlock(); return true; }
  if(CRYPTO_REFUSED.test(m)){ CR.force=true;
    // This version without the key: encryption was turned on elsewhere since the account was last read. A pass soon reads it and asks for the password
    if(SY.remote.__crypto&&!crKey()&&Date.now()-(CR.refusedAt||0)>30e3){ CR.refusedAt=Date.now(); SY.status='syncing'; SY.error=''; log('info','El servidor pide texto cifrado: se comprueba el estado del cifrado'); crCheckSoon(); return true; }
    SY.status='error'; SY.error=m; log('error','Actualiza la app: el cifrado está activado. El servidor ha rechazado texto sin cifrar'); return true; }
  return false; }
// Realtime brought encrypted rows and this device has no key: a pass soon reads the account and asks for the password
function crCheckSoon(){ clearTimeout(CR.timer); CR.timer=setTimeout(()=>syncRun('cifrado'), 300); }
// Once per session the unlock sheet opens by itself; afterwards, from Ajustes
function cryptoAskUnlock(){ if(CR.asked||!cryptoLocked()) return; if(sheet.classList.contains('on')||asheet.classList.contains('on')||busyEditing()||touchDrag) return;
  CR.asked=true; cryptoUnlockSheet(); }
async function crForget(why){ CR.key=null; CR.kid=null; CR.owner=null; CR.keyP=Promise.resolve();
  try{ await cryptoKeyForget(); }catch(e){} const f=crFlag(); if(f&&f.state!=='migrating') crFlagWrite(null);
  log('info','Clave de cifrado olvidada en este dispositivo'+(why?' ('+why+')':'')); }
// Only from «Cerrar sesión» (syncSignOutSheet): a session that ends without asking keeps the key, checked against the account at the next sign-in
async function cryptoSignedOut(){ CR.keyP=Promise.resolve(); CR.row=undefined; CR.for=null; CR.asked=false; CR.lockLogged=false; CR.bad.clear(); if(CR.key||CR.owner) await crForget('sesión cerrada'); else await cryptoKeyForget().catch(()=>{}); }
const crPaint = () => { if(CR.prog) crProgPaint(); if(onSettings()&&!busyEditing()&&!touchDrag) render(); };
// Ajustes reads the state while it is on screen, at most once a minute
function cryptoLoad(force){ if(!SY||!SY.user||!SY.remote.__crypto||!SY.remote.cryptoGet||CR.loading||!navigator.onLine) return;
  if(!force&&CR.for===SY.user.id&&CR.row!==undefined&&Date.now()-CR.at<60e3) return;
  CR.loading=true; const user=SY.user; crKeyBoot().then(()=>crFetch(user)).catch(e=>log('warn','Estado del cifrado no disponible: '+(e&&e.message||e))).finally(()=>{ CR.loading=false; crPaint(); }); }

/* ---------- Passwords ---------- */
const CR_RULES=[{k:'len', t:'Al menos 12 caracteres', ok:p=>[...p].length>=12}, {k:'let', t:'Letras', ok:p=>/\p{L}/u.test(p)}, {k:'num', t:'Números', ok:p=>/\p{N}/u.test(p)},
  {k:'sym', t:'Algún símbolo', ok:p=>/[^\p{L}\p{N}\s]/u.test(p)}];
const crRulesOk = p => CR_RULES.every(r=>r.ok(p));
const crRulesHTML = () => '<ul class="cx-rules">'+CR_RULES.map(r=>'<li data-rule="'+r.k+'">'+I.check+'<span>'+r.t+'</span></li>').join('')+'<li data-rule="same">'+I.check+'<span>Las dos son iguales</span></li></ul>';
// Ticks the rules met by the two fields; returns whether all are
function crRulesPaint(s, a, b){ const p=a.value, q=b.value; let all=true;
  CR_RULES.forEach(r=>{ const ok=r.ok(p); all=all&&ok; s.querySelector('[data-rule="'+r.k+'"]').classList.toggle('ok', ok); });
  const same=!!p&&p===q; s.querySelector('[data-rule="same"]').classList.toggle('ok', same); return all&&same; }
const crField = (role, ph, auto) => '<input class="wfor" data-role="'+role+'" type="password" placeholder="'+ph+'" autocomplete="'+(auto||'new-password')+'" autocapitalize="off" autocorrect="off" spellcheck="false">';

/* ---------- Activation ---------- */
function cryptoActivateSheet(){ if(!SY||!SY.user) return; if(!navigator.onLine){ toast('Sin conexión'); return; } if(CR.busy||CR.migrating) return;
  openSheet(sheadHTML('Activar cifrado', 'Cancelar', 'Activar')+'<div class="wsheet cxsheet">'+crField('cx1','Contraseña de cifrado')+crField('cx2','Repite la contraseña')+crRulesHTML()+
    '<div class="cx-warn">Si olvidas esta contraseña, los datos guardados en el servidor no se pueden recuperar. No hay código de recuperación.</div>'+
    '<label class="cx-check"><input type="checkbox" data-role="cxok"><span>Entiendo que no se puede recuperar</span></label>'+
    '<div class="cx-note">Actualiza la app en todos tus dispositivos antes de activarlo.</div></div>', s=>{
    const a=$('[data-role=cx1]', s), b=$('[data-role=cx2]', s), chk=$('[data-role=cxok]', s), okb=$('.hbtn.ok', s);
    const paint=()=>{ const v=crRulesPaint(s, a, b); okb.disabled=!(v&&chk.checked); return v; };
    const go=()=>{ if(!paint()){ toast(crRulesOk(a.value)?'Las dos contraseñas no son iguales':'La contraseña no cumple las reglas'); return; } if(!chk.checked){ toast('Marca que entiendes que no se puede recuperar'); return; }
      const pw=a.value; a.value=b.value=''; cryptoActivate(pw); };
    [a,b].forEach(i=>{ i.addEventListener('input', paint); i.addEventListener('keydown', e=>{ if(e.key==='Enter'&&!e.isComposing){ e.preventDefault(); if(i===a) b.focus(); else go(); } }); });
    chk.addEventListener('change', paint);
    s.onclick=e=>{ const x=e.target.closest('[data-x]'); if(!x) return; if(x.dataset.x==='ok') go(); else if(x.dataset.x==='cancel') closeSheet(); };
    paint(); a.focus(); }); }
// The progress sheet: «Cifrando 120 de 840». It can be closed; the work goes on and Ajustes shows it
function crProgSheet(){ openSheet('<div class="wsheet cxprog"><h2>Cifrado</h2><div class="cx-line" data-role="cxline">Preparando</div><div class="cx-bar"><i data-role="cxbar"></i></div>'+
    '<div class="hint" data-role="cxhint">Puedes seguir usando la app mientras tanto.</div><button class="wback" data-x="close">Cerrar</button></div>', s=>{
    s.onclick=e=>{ const x=e.target.closest('[data-x]'); if(x) closeSheet(); }; crProgPaint(); }); }
const crProgText = () => { const p=CR.prog; if(!p) return ''; if(p.done) return 'Cifrado activado'; if(p.step) return p.step; return p.of?'Cifrando '+Math.min(p.n, p.of)+' de '+p.of:'Cifrando'; };
function crProgPaint(){ const l=document.querySelector('#sheet [data-role=cxline]'); if(!l) return; l.textContent=crProgText();
  const p=CR.prog, bar=document.querySelector('#sheet [data-role=cxbar]'); if(bar) bar.style.transform='scaleX('+(p&&p.done?1:p&&p.of?Math.min(1, p.n/p.of):0)+')';
  if(p&&p.done){ const h=document.querySelector('#sheet [data-role=cxhint]'); if(h) h.textContent='Lo que escribas se cifra en este dispositivo antes de guardarse en tu cuenta.'; const c=document.querySelector('#sheet .cxprog [data-x=close]'); if(c) c.textContent='Hecho'; } }
const crLock = fn => (navigator.locks&&navigator.locks.request) ? navigator.locks.request('tareas-sync', fn) : fn();
/* Turns encryption on: a full pass, a local backup, the data key made and stored here and on the server, then the server copy encrypted.
   No pass runs from the moment the key is made until the server row is stored (CR.busy) */
async function cryptoActivate(pw){ if(CR.busy||CR.migrating||!SY||!SY.user) return; const user=SY.user;
  CR.prog={n:0, of:0, step:'Sincronizando'}; crProgSheet(); log('info','Activación del cifrado: inicio');
  let stored=false, kid=null;
  try{ flushHeld(true); flushEdits();
    if(!await syncRun('cifrado')) throw new Error(navigator.onLine?'No se pudo sincronizar':'Sin conexión');
    CR.busy=true;
    if(await crFetch(user)) throw crErr('El cifrado ya está activado en esta cuenta', 'tareas_on');
    if(CR.absent) throw crErr('Falta 0012_encryption.sql en Supabase', 'tareas_absent');
    CR.prog.step='Copia de seguridad'; crProgPaint();
    try{ await BK.put(todayStr()); await refreshBackups(); log('info','Copia local antes de cifrar', {tasks:DB.tasks.length, projects:DB.projects.length}); }
    catch(e){ log('warn','Copia local antes de cifrar no disponible: '+(e&&e.message||e)); }
    CR.prog.step='Creando la clave'; crProgPaint();
    const dk=await cryptoNewKey(), seal=await cryptoSeal(pw, dk), key=await cryptoUnwrap(seal.wrapped, seal.kek, false); // the copy this device keeps cannot be extracted
    kid=cryptoB64(cryptoRandom(12));
    try{ await cryptoKeySave(key, kid, user.id); }catch(e){ log('warn','La clave de cifrado no se pudo guardar en este dispositivo: se pedirá la contraseña al volver a abrir la app'); }
    crFlagWrite({owner:user.id, state:'migrating', kid, files:[]});
    const now=new Date().toISOString(), row={owner_id:user.id, kid, salt:seal.salt, iterations:seal.iterations, wrapped:seal.wrapped, created:now, modified:now};
    try{ await SY.remote.cryptoPut(row); }
    catch(e){ const got=await crFetch(user).catch(()=>null); if(!got||got.kid!==kid) throw e; } // the answer was lost but the row is there
    stored=true; CR.row={kid, salt:row.salt, iterations:row.iterations, wrapped:row.wrapped, created:now, modified:now}; CR.for=user.id; CR.at=Date.now();
    CR.key=key; CR.kid=kid; CR.owner=user.id; CR.keyP=Promise.resolve(); CR.asked=true;
    log('info','Cifrado activado en la cuenta: clave creada'); }
  catch(e){ CR.busy=false;
    if(!stored){ if(kid){ try{ await cryptoKeyForget(); }catch(x){} crFlagWrite(null); } CR.key=null; CR.kid=null; CR.owner=null; CR.keyP=null; }
    log('error','Activación del cifrado: '+(e&&e.message||e)); CR.prog=null; closeSheet(); render();
    toast(e&&e.code==='tareas_on'?'El cifrado ya está activado en tu cuenta':e&&e.code==='tareas_absent'?'Falta poner al día Supabase':syncOffline(e)?'Sin conexión':'No se pudo activar el cifrado');
    if(e&&e.code==='tareas_on') syncRun('cifrado'); return; }
  CR.busy=false; CR.prog.step=null; crPaint();
  await cryptoMigrate(); }
// Every row of a table on the server, as the server holds it (paged like syncPull)
async function crPullAll(R, table){ const rows=[]; let after=null;
  for(;;){ const page=await R.pull(table, after, SYNC_PAGE); if(page.length<SYNC_PAGE){ rows.push(...page); break; }
    const last=page[page.length-1].server_ts, keep=page.filter(r=>r.server_ts!==last);
    if(!keep.length){ rows.push(...page); after=last; continue; } rows.push(...keep); after=keep[keep.length-1].server_ts; }
  return rows; }
/* The row to send again to encrypt a server row, or null when every value is empty or already opens with the key. A value that starts
   with 'e1:' and does not open was written before activation (no key existed then): it is plain text and gets encrypted */
async function crSealRow(k, table, r){ let out=null;
  for(const c of CRYPTO_COLS[table]){ const v=r[c]; if(v==null||v==='') continue;
    if(cryptoIsEnc(v)){ try{ await cryptoDec(k, v, cryptoAad(table, c, r.id)); continue; }catch(e){} }
    if(!out){ out=Object.assign({}, r); delete out.owner_id; delete out.server_ts; }
    out[c]=await cryptoEnc(k, String(v), cryptoAad(table, c, r.id)); }
  return out; }
/* Encrypts in place what the server holds for the account: every row of every listed table, deleted ones and voice notes included, sent
   again with the same modified and deleted (the write trigger takes an equal modified); every attachment file without the magic; the
   Siri phrases already taken are emptied. Skips what is already encrypted, so it can run again after a cut */
async function cryptoMigrate(){ const f=crFlag(), user=SY&&SY.user;
  if(CR.migrating||!f||f.state!=='migrating'||!user||f.owner!==user.id) return; const k=crKey(); if(!k) return;
  const inner=SY.remote.inner||SY.remote, t0=Date.now(), stats={filas:0, archivos:0, frases:0, sinArchivo:0};
  CR.migrating=true; CR.busy=true; CR.prog=Object.assign(CR.prog||{}, {n:0, of:0, step:null, done:false}); crPaint();
  try{ await crLock(async()=>{
      const todo={}; for(const table of Object.keys(CRYPTO_COLS)){ if(syncMissing(table)) continue; todo[table]=[];
        for(const r of await crPullAll(inner, table)){ const o=await crSealRow(k, table, r); if(o) todo[table].push(o); } }
      const done=new Set(f.files||[]), atts=syncMissing('attachments')||!inner.fileUpload?[]:(await crPullAll(inner, 'attachments')).filter(a=>a.path&&!a.purged&&!done.has(a.path));
      CR.prog.of=Object.values(todo).reduce((n,l)=>n+l.length, 0)+atts.length; crPaint();
      log('info','Cifrado: datos del servidor por cifrar', {filas:CR.prog.of-atts.length, archivos:atts.length});
      for(const table of Object.keys(todo)){ const list=todo[table];
        for(let i=0;i<list.length;i+=100){ const part=list.slice(i, i+100);
          await inner.upsert(table, part); stats.filas+=part.length; CR.prog.n+=part.length; crPaint(); } }
      for(const a of atts){ let blob=null;
        try{ blob=await crRawDownload(inner, a.path, SIGN_TTL); }catch(e){ if(syncOffline(e)) throw e; stats.sinArchivo++; log('warn','Cifrado: archivo no encontrado en el servidor, se deja', {id:a.id}); }
        if(blob){ const u=new Uint8Array(await blob.arrayBuffer());
          if(!cryptoFileEnc(u)){ await inner.fileUpload(a.path, new Blob([await cryptoEncFile(k, u, a.path)], {type:a.mime||blob.type}), a.mime||blob.type); stats.archivos++; } }
        done.add(a.path); f.files=[...done]; crFlagWrite(f); CR.prog.n++; crPaint(); }
      if(inner.inboxClear&&!syncMissing('inbox')) stats.frases=((await inner.inboxClear())||[]).length; });
    crFlagWrite({owner:user.id, state:'on', kid:f.kid}); CR.prog.done=true; CR.wait=0; CR.resumeAt=0;
    log('info','Cifrado completado', Object.assign(stats, {ms:Date.now()-t0})); toast('Cifrado activado'); }
  catch(e){ CR.prog=null; CR.wait=Math.min(600e3, CR.wait?CR.wait*2:30e3); CR.resumeAt=Date.now()+CR.wait; // the next try waits longer each time, so a file that keeps failing never loops
    log(syncOffline(e)?'warn':'error','Cifrado interrumpido: '+(e&&e.message||e)+'. Continuará en la próxima sincronización');
    const l=document.querySelector('#sheet .cxprog'); if(l) closeSheet(); toast('El cifrado se completará en la próxima sincronización'); }
  finally{ CR.migrating=false; CR.busy=false; const p=CR.prog; crPaint(); if(p&&p.done) setTimeout(()=>{ if(CR.prog===p) CR.prog=null; }, 0); syncRun('cifrado'); } }
// After a pass that reached the server: an activation cut before it finished goes on
function cryptoResume(){ const f=crFlag(); if(!f||f.state!=='migrating'||!SY||!SY.user||f.owner!==SY.user.id||CR.migrating||CR.busy||!crKey()||Date.now()<CR.resumeAt) return;
  setTimeout(()=>{ if(!CR.migrating&&!CR.busy){ log('info','Cifrado: se continúa el cifrado del servidor'); cryptoMigrate(); } }, 0); }

/* ---------- Unlock on another device ---------- */
async function cryptoUnlock(pw){ const user=SY&&SY.user; if(!user) return 'off';
  const row=await crFetch(user); if(!row) return 'off';
  let key; try{ key=await cryptoOpen(pw, row, false); }catch(e){ log('info','Contraseña de cifrado incorrecta'); return 'wrong'; }
  if(!SY.user||SY.user.id!==user.id) return 'off';
  CR.key=key; CR.kid=row.kid; CR.owner=user.id; CR.keyP=Promise.resolve(); CR.lockLogged=false; CR.bad.clear();
  try{ await cryptoKeySave(key, row.kid, user.id); }catch(e){ log('warn','La clave de cifrado no se pudo guardar en este dispositivo: se pedirá la contraseña al volver a abrir la app'); }
  log('info','Cifrado desbloqueado en este dispositivo'); SY.retry=0; syncRun('desbloqueo'); return 'ok'; }
function cryptoUnlockSheet(){ if(!SY||!SY.user) return; const dev=UI.wide?'este dispositivo':'este iPhone';
  openSheet(sheadHTML('Contraseña de cifrado', 'Cancelar', 'Desbloquear')+'<div class="wsheet cxsheet">'+crField('cxpw','Contraseña de cifrado','current-password')+
    '<div class="cx-err" data-role="cxerr" role="alert"></div><div class="cx-note">El cifrado está activado en tu cuenta. Escribe su contraseña para ver y sincronizar tus datos en '+dev+'.</div></div>', s=>{
    const a=$('[data-role=cxpw]', s), err=$('[data-role=cxerr]', s), okb=$('.hbtn.ok', s); let busy=false;
    const go=async()=>{ if(busy) return; if(!a.value){ a.focus(); return; } if(!navigator.onLine){ err.textContent='Sin conexión'; return; }
      busy=true; okb.disabled=true; okb.textContent='Comprobando'; err.textContent=''; let r;
      try{ r=await cryptoUnlock(a.value); }catch(e){ r='fail'; log('warn','Desbloquear el cifrado: '+(e&&e.message||e)); }
      busy=false; okb.disabled=false; okb.textContent='Desbloquear'; if(!sheet.contains(a)) return;
      if(r==='ok'){ a.value=''; closeSheet(); toast('Cifrado desbloqueado'); return; }
      if(r==='off'){ closeSheet(); return; }
      err.textContent=r==='wrong'?'Contraseña incorrecta':'No se pudo comprobar. Inténtalo de nuevo'; a.select(); };
    a.addEventListener('keydown', e=>{ if(e.key==='Enter'&&!e.isComposing){ e.preventDefault(); go(); } });
    a.addEventListener('input', ()=>{ err.textContent=''; });
    s.onclick=e=>{ const x=e.target.closest('[data-x]'); if(!x) return; if(x.dataset.x==='ok') go(); else if(x.dataset.x==='cancel') closeSheet(); };
    a.focus(); }); }

/* ---------- Change the password ---------- */
// The same data key, wrapped again: the other devices keep theirs, and a new one unlocks only with the new password
async function cryptoChangePassword(cur, nw){ const user=SY&&SY.user; if(!user) return 'off';
  const row=await crFetch(user); if(!row) return 'off';
  let dk; try{ dk=await cryptoOpen(cur, row, true); }catch(e){ log('info','Cambiar contraseña de cifrado: la actual no es correcta'); return 'wrong'; }
  const seal=await cryptoSeal(nw, dk), now=new Date().toISOString(), patch={salt:seal.salt, iterations:seal.iterations, wrapped:seal.wrapped, modified:now};
  const ok=await SY.remote.cryptoPatch(user.id, row.kid, patch); if(Array.isArray(ok)&&!ok.length) throw new Error('La clave de la cuenta ha cambiado');
  CR.row=Object.assign({}, row, patch); CR.at=Date.now(); log('info','Contraseña de cifrado cambiada'); return 'ok'; }
function cryptoPassSheet(){ if(!SY||!SY.user||!crKey()) return; if(!navigator.onLine){ toast('Sin conexión'); return; }
  openSheet(sheadHTML('Cambiar contraseña', 'Cancelar', 'Guardar')+'<div class="wsheet cxsheet">'+crField('cx0','Contraseña actual','current-password')+'<div class="cx-err" data-role="cxerr" role="alert"></div>'+
    crField('cx1','Contraseña nueva')+crField('cx2','Repite la contraseña nueva')+crRulesHTML()+
    '<div class="cx-note">Tus otros dispositivos siguen funcionando. En uno nuevo se pedirá la contraseña nueva.</div></div>', s=>{
    const c=$('[data-role=cx0]', s), a=$('[data-role=cx1]', s), b=$('[data-role=cx2]', s), err=$('[data-role=cxerr]', s), okb=$('.hbtn.ok', s); let busy=false;
    const paint=()=>{ const v=crRulesPaint(s, a, b); if(!busy) okb.disabled=!(v&&c.value); return v; };
    const go=async()=>{ if(busy) return; if(!c.value){ c.focus(); return; } if(!paint()){ toast(crRulesOk(a.value)?'Las dos contraseñas no son iguales':'La contraseña no cumple las reglas'); return; }
      busy=true; okb.disabled=true; okb.textContent='Guardando'; err.textContent=''; let r;
      try{ r=await cryptoChangePassword(c.value, a.value); }catch(e){ r='fail'; log('error','Cambiar contraseña de cifrado: '+(e&&e.message||e)); }
      busy=false; okb.textContent='Guardar'; paint(); if(!sheet.contains(c)) return;
      if(r==='ok'){ c.value=a.value=b.value=''; closeSheet(); toast('Contraseña cambiada'); render(); return; }
      if(r==='wrong'){ err.textContent='Contraseña incorrecta'; c.select(); return; }
      err.textContent=navigator.onLine?'No se pudo cambiar. Inténtalo de nuevo':'Sin conexión'; };
    [c,a,b].forEach((i,n)=>{ i.addEventListener('input', ()=>{ if(i===c) err.textContent=''; paint(); }); i.addEventListener('keydown', e=>{ if(e.key==='Enter'&&!e.isComposing){ e.preventDefault(); if(n<2) [c,a,b][n+1].focus(); else go(); } }); });
    s.onclick=e=>{ const x=e.target.closest('[data-x]'); if(!x) return; if(x.dataset.x==='ok') go(); else if(x.dataset.x==='cancel') closeSheet(); };
    paint(); c.focus(); }); }

/* ---------- Ajustes, Cifrado ---------- */
const crDay = iso => { const d=new Date(iso); return isNaN(d)?'':d.getDate()+' de '+MESES_FULL[d.getMonth()]+(d.getFullYear()!==new Date().getFullYear()?' de '+d.getFullYear():''); };
function cryptoSectionHTML(dev){
  const g=(cells, foot)=>'<div class="group-title">Cifrado</div><div class="group cx-acc">'+cells+'</div>'+(foot?'<div class="footnote">'+foot+'</div>':'');
  const cell=(l,v,warn)=>'<div class="cell"><span class="lbl'+(warn?' sync-line warn':'')+'">'+l+'</span>'+(v?'<span class="val">'+v+'</span>':'')+'</div>';
  const btn=(act,l,dis)=>'<button class="cell link" data-act="'+act+'"'+(dis?' disabled':'')+'><span class="lbl">'+l+'</span></button>';
  if(!SY) return g(cell('Cifrado','No disponible'), 'Necesita la cuenta, que no está disponible en esta versión.');
  if(!SY.user) return g(cell('Cifrado','Sin cuenta'), 'Inicia sesión primero. El cifrado protege la copia de tus datos que se guarda en tu cuenta.');
  if(!SY.remote.__crypto||!SY.remote.cryptoGet||CR.absent||syncMissing('crypto_keys')) return g(cell('Cifrado','No disponible'), 'Falta poner al día Supabase con 0012_encryption.sql. Hasta entonces no se puede activar.');
  cryptoLoad(false);
  if(CR.for!==SY.user.id||CR.row===undefined) return g(cell('Cifrado', CR.loading||navigator.onLine?'Comprobando':'Sin conexión'));
  if(!CR.row) return g(btn('cxOn', CR.busy||CR.migrating?'Activando cifrado':'Activar cifrado', CR.busy||CR.migrating),
    'Con el cifrado, lo que escribes se cifra en '+dev+' antes de guardarse en tu cuenta: el servidor solo guarda texto ilegible. Se protege con una contraseña que solo sabes tú.');
  if(!crKey()) return g(cell('Falta la contraseña de cifrado', '', true)+btn('cxUnlock','Desbloquear'),
    'El cifrado está activado en tu cuenta. Escribe su contraseña para ver y sincronizar tus datos en '+dev+'.');
  const f=crFlag(), mig=CR.migrating||(f&&f.state==='migrating'&&f.owner===SY.user.id);
  if(mig) return g(cell(CR.migrating?crProgText()||'Cifrando':'Cifrado sin terminar'), 'Se están cifrando los datos que ya había en tu cuenta. Si se interrumpe, continúa en la próxima sincronización.');
  return g(cell('Cifrado activado'+(CR.row.created?' el '+crDay(CR.row.created):''))+btn('cxPass','Cambiar contraseña'),
    'Lo que escribes se cifra en '+dev+' antes de guardarse en tu cuenta. Sin la contraseña nadie puede leerlo, tampoco el servidor.'); }
