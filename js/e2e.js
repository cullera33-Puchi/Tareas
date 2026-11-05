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
   - Activation: the key row of the server says when every row, file and Siri phrase of the account is encrypted (migrated); until then,
     any device with the key goes on with the work after a pass (cryptoResume). Every step is idempotent: what already opens is skipped.
   - A device on an older version may have kept server ciphertext as text: the first pass with the key pulls the encrypted tables whole
     again and turns such values back into text here (crFirstOn); the upload layer never encrypts a value that already opens.
   - Never logged: the password, the key or any text. */
const CR_FLAG='tareas-crypto', CR_OUT='tareas-signout';
// CR_FLAG: {owner, kid, at}, an activation of this device whose server row is not confirmed yet (the key is already in IndexedDB).
// CR_OUT: the moment «Cerrar sesión» was used here, so the other windows of the app forget the key too and do not call it a lost session.
// CRYPTO_REFUSED: the message of the server's trigger (0012_encryption.sql) when a device on an older version sends plain text
const CRYPTO_REFUSED=/tareas_plaintext_refused/;
const CR={ key:null, kid:null, owner:null, keyP:null, row:undefined, for:null, at:0, force:false, absent:false, loading:false, asked:false, busy:false, migrating:false, activating:false,
  prog:null, bad:new Set(), timer:0, lockLogged:false, resumeAt:0, wait:0, refusedAt:0, repaired:null, skipLogged:false };
const crFlag = () => { try{ const v=JSON.parse(localStorage.getItem(CR_FLAG)||'null'); return v&&typeof v==='object'?v:null; }catch(e){ return null; } };
const crFlagWrite = v => { try{ if(v) localStorage.setItem(CR_FLAG, JSON.stringify(v)); else localStorage.removeItem(CR_FLAG); }catch(e){} };
const crSleep = ms => new Promise(r=>setTimeout(r, ms));
// Encryption on for the signed-in account (as last read from the server)
const crOn = () => !!(SY&&SY.user&&CR.for===SY.user.id&&CR.row);
// The data key, only when it is this account's
const crKey = () => crOn()&&CR.key&&CR.owner===SY.user.id&&CR.kid===CR.row.kid ? CR.key : null;
const cryptoLocked = () => crOn() && !crKey();
const crErr = (msg, code) => { const e=new Error(msg); e.code=code; return e; };
const crLockedErr = () => crErr('Falta la contraseña de cifrado', 'tareas_locked');
// A row with a text that does not open with this key: kept, that text marked (CRYPTO_UNREAD, see crUnread); said once per table
function crBad(table, row){ if(CR.bad.has(table)) return; CR.bad.add(table); log('error','Cifrado: un texto de '+table+' no se puede descifrar; la fila se conserva sin él', {id:row&&row.id}); }
async function crOpenRow(k, table, r){ const o=await cryptoDecRow(k, table, r); if(cryptoRowUnread(table, o)) crBad(table, r); return o; }
/* A record from the server whose text could not be opened (sync.js calls it before comparing): this device's value stays when it has one;
   else CRYPTO_PLACEHOLDER, and the field is listed in cxBad, a local mark that keeps it from ever going up (syncCollect) */
function crUnread(table, rec, local){ const bad=[]; if(!rec) return rec;
  (SYNC_FIELDS[table]||[]).forEach(([f])=>{ if(rec[f]!==CRYPTO_UNREAD) return;
    const lv=local&&local[f], mine=lv!=null&&lv!==''&&lv!==CRYPTO_PLACEHOLDER&&lv!==CRYPTO_UNREAD&&!cryptoIsEnc(lv); // a ciphertext kept here as text is not a value
    rec[f]=mine?lv:CRYPTO_PLACEHOLDER; if(!mine) bad.push(f); });
  rec.cxBad=bad.length?bad:undefined; return rec; }
// The file as Storage has it, through the adapter's own download or its signed URL
async function crRawDownload(R, path, ttl){ if(R.fileDownload) return R.fileDownload(path, ttl);
  const r=await fetch(await R.fileUrl(path, ttl), {cache:'no-store'}); if(!r.ok) throw new Error('HTTP '+r.status); return r.blob(); }
// The key kept in IndexedDB, when it is this account's (and the server row's, once known): unlocked or activated in another window
async function crLoadStored(user){ if(crKey()) return; const r=await cryptoKeyLoad().catch(()=>null);
  if(r&&r.owner===user.id&&(!CR.row||r.kid===CR.row.kid)){ CR.key=r.key; CR.kid=r.kid; CR.owner=r.owner; } }

/* ---------- The layer around the remote adapter ---------- */
function cryptoRemote(inner){ if(!inner||inner.__crypto) return inner;
  const w=Object.create(inner); w.__crypto=true; w.inner=inner;
  /* Rows from the server, opened. Without the key: the stored one is tried, and the account is read again (at most every few seconds); on,
     the pass stops before anything is merged (locked). Off, read just now, with no key of this user anywhere: a text that starts with 'e1:'
     is somebody's text and comes as it is. Off with a key of this user: it opens what it can. Otherwise such rows are left out (the first
     pass with the key pulls them whole again). With the key, a text that does not open is marked and its row kept (crUnread) */
  const open=async(table, rows)=>{ if(!CRYPTO_COLS[table]||!Array.isArray(rows)||!rows.some(r=>cryptoRowEnc(table, r))) return rows;
    let k=crKey();
    if(!k&&SY&&SY.user){ await crLoadStored(SY.user); if(!crKey()&&!CR.busy&&!(CR.for===SY.user.id&&CR.row!==undefined&&Date.now()-CR.at<5e3)) await crFetch(SY.user); await crLoadStored(SY.user); k=crKey(); }
    if(!k&&(crOn()||!SY||!SY.user)){ CR.force=true; throw crLockedErr(); }
    const k2=k||(CR.key&&CR.owner===SY.user.id?CR.key:null);
    if(!k2&&CR.row===null&&CR.for===SY.user.id&&Date.now()-CR.at<5e3) return rows; // off for sure, and no key ever here: plain text
    const out=[];
    for(const r of rows){ if(!cryptoRowEnc(table, r)){ out.push(r); continue; }
      if(!k2){ CR.force=true; if(!CR.skipLogged){ CR.skipLogged=true; log('warn','Cifrado: filas cifradas y sin clave en este dispositivo; se dejan fuera', {table}); } continue; }
      out.push(await crOpenRow(k2, table, r)); }
    return out; };
  w.pull=async(table, after, limit)=>open(table, await inner.pull(table, after, limit));
  w.byIds=async(table, ids)=>open(table, await inner.byIds(table, ids));
  // Rows up: the listed columns encrypted (a value already encrypted with this key goes as it is). On without the key nothing plain may leave
  w.upsert=async(table, rows)=>{ if(!CRYPTO_COLS[table]) return inner.upsert(table, rows); const k=crKey();
    if(!k){ if(crOn()) throw crLockedErr(); return inner.upsert(table, rows); }
    const send=[]; for(const r of rows) send.push(await cryptoSealRow(k, table, r)); return inner.upsert(table, send); };
  // Realtime: opened in order, one after another
  if(inner.subscribe) w.subscribe=(uid, onRow, onStatus)=>{ let chain=Promise.resolve();
    return inner.subscribe(uid, (table, row)=>{ chain=chain.then(async()=>{
      if(!cryptoRowEnc(table, row)){ onRow(table, row); return; }
      const k=crKey(); if(!k){ CR.force=true; crCheckSoon(); return; } // another device turned encryption on: a pass reads the account
      onRow(table, await crOpenRow(k, table, row)); }).catch(e=>log('error','Tiempo real: '+(e&&e.message||e))); }, onStatus); };
  /* Files up: encrypted with the key. Without it, nothing goes while an activation is under way here (it would escape the encryption of the
     server copy), and the account is read again first, so a file never goes up plain to an account that has just turned encryption on */
  if(inner.fileUpload) w.fileUpload=async(path, blob, mime)=>{ let k=crKey();
    if(!k){ const user=SY&&SY.user, f=crFlag();
      if(CR.busy||CR.migrating||CR.activating||(f&&user&&f.owner===user.id)) throw crErr('Cifrado en curso: el archivo se subirá después', 'tareas_wait');
      if(user){ await crFetch(user); await crLoadStored(user); k=crKey(); }
      if(!k&&crOn()) throw crLockedErr(); }
    if(!k) return inner.fileUpload(path, blob, mime);
    const enc=await cryptoEncFile(k, new Uint8Array(await blob.arrayBuffer()), path); return inner.fileUpload(path, new Blob([enc], {type:mime||blob.type}), mime); };
  /* Files down: opened with the key. A plain one found while the account is on (uploaded by a device on an older version) is encrypted and
     put back at the same path */
  if(inner.fileDownload||inner.fileUrl) w.fileDownload=async(path, ttl)=>{ const blob=await crRawDownload(inner, path, ttl), u=new Uint8Array(await blob.arrayBuffer());
    if(!cryptoFileEnc(u)){ const k=crKey();
      if(k&&inner.fileUpload&&!CR.migrating){ try{ await inner.fileUpload(path, new Blob([await cryptoEncFile(k, u, path)], {type:blob.type}), blob.type); log('info','Cifrado: un archivo sin cifrar en el servidor se ha cifrado'); }
        catch(e){ log('warn','Cifrado: no se pudo cifrar un archivo sin cifrar del servidor: '+(e&&e.message||e)); } }
      return blob; } let k=crKey(); if(!k&&SY&&SY.user){ await crLoadStored(SY.user); k=crKey()||(CR.key&&CR.owner===SY.user.id?CR.key:null); }
    if(!k){ CR.force=true; throw crLockedErr(); }
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
  CR.absent=syncMissing('crypto_keys'); CR.row=row&&row.kid?{kid:row.kid, salt:row.salt, iterations:+row.iterations||CRYPTO_ITER, wrapped:row.wrapped, created:row.created||null, modified:row.modified||null, migrated:row.migrated||null}:null;
  CR.for=user.id; CR.at=Date.now(); CR.force=false; return CR.row; }
/* An activation flag left here: confirmed once the server row carries its kid. Cleared only when the server holds no row with its kid and
   it is not an activation in progress (in this window, or another one in the last two minutes); its key then goes too */
async function crFlagCheck(user){ const f=crFlag(); if(!f||f.owner!==user.id||CR.row===undefined) return;
  if(CR.row&&CR.row.kid===f.kid){ crFlagWrite(null); return; }
  if(CR.busy||CR.activating||Date.now()-(Date.parse(f.at)||0)<120e3) return;
  crFlagWrite(null); const r=await cryptoKeyLoad().catch(()=>null); if(r&&r.kid===f.kid) await cryptoKeyForget().catch(()=>{});
  if(CR.kid===f.kid){ CR.key=null; CR.kid=null; CR.owner=null; }
  log('warn','Cifrado: una activación que no llegó al servidor se descarta en este dispositivo'); }
// 'off', 'on' or 'locked'. Read again after a minute without the key, after ten with it, or when something said it may have changed
async function cryptoGate(user){ const R=SY.remote; if(!R.__crypto||!R.cryptoGet) return 'off'; // an adapter without encryption (a test's stand-in)
  await crKeyBoot();
  if(CR.for!==user.id){ CR.row=undefined; CR.asked=false; CR.lockLogged=false; }
  if(CR.row===undefined||CR.force||Date.now()-CR.at>(CR.key?600e3:60e3)) await crFetch(user);
  await crFlagCheck(user);
  if(!CR.row) return 'off';
  if(CR.key&&(CR.kid!==CR.row.kid||CR.owner!==user.id)){ log('warn','La clave de cifrado de este dispositivo no es la de la cuenta: se pide la contraseña'); await crForget(); }
  await crLoadStored(user);
  if(crKey()){ CR.lockLogged=false; await crFirstOn(); return 'on'; }
  if(!CR.lockLogged){ CR.lockLogged=true; log('info','Cifrado activado en la cuenta y sin contraseña en este dispositivo: la sincronización espera'); }
  return 'locked'; }
/* The first pass with a key (per kid): the encrypted tables are pulled whole again, so a copy that a device on an older version kept as
   'e1:...' text gets the server's opened copy (same modified, not changed here: it wins); and on each unlock in a session, values kept
   here as 'e1:...' that open with the key go back to text, without touching modified */
async function crFirstOn(){ const st=syncState();
  if(st.cryptoKid!==CR.kid){ Object.keys(CRYPTO_COLS).forEach(t=>{ delete st.cursor[t]; }); st.cryptoKid=CR.kid; syncWrite(st); log('info','Cifrado: las tablas cifradas se descargan enteras una vez'); }
  if(CR.repaired!==CR.kid){ CR.repaired=CR.kid; await cryptoRepairLocal(CR.key); } }
const CR_LISTS={tasks:'tasks', projects:'projects', spaces:'spaces', subtasks:'subtasks', project_notes:'projectNotes', contacts:'contacts', voice_notes:'voiceNotes'};
async function cryptoRepairLocal(k){ const fix=[];
  for(const table of Object.keys(CRYPTO_COLS)){ const fields=SYNC_FIELDS[table].filter(([,c])=>CRYPTO_COLS[table].includes(c));
    for(const rec of DB[CR_LISTS[table]]||[]){ if(!rec) continue;
      for(const [f,c] of fields){ if(!cryptoIsEnc(rec[f])) continue; try{ fix.push([CR_LISTS[table], rec.id, f, rec[f], await cryptoDec(k, rec[f], cryptoAad(table, c))]); }catch(e){} } } }
  let n=0; fix.forEach(([list, id, f, was, v])=>{ const rec=(DB[list]||[]).find(x=>x&&x.id===id); if(rec&&rec[f]===was){ rec[f]=v; n++; } }); // applied at once, on the current data
  if(n){ SY.quiet=true; try{ save(); } finally{ SY.quiet=false; } log('info','Cifrado: textos guardados cifrados en este dispositivo vuelven a ser texto', {n}); if(!busyEditing()&&!touchDrag) render(); }
  return n; }
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
  try{ await cryptoKeyForget(); }catch(e){}
  log('info','Clave de cifrado olvidada en este dispositivo'+(why?' ('+why+')':'')); }
// Only from «Cerrar sesión» (syncSignOutSheet): a session that ends without asking keeps the key, checked against the account at the next sign-in
async function cryptoSignedOut(){ CR.keyP=Promise.resolve(); CR.row=undefined; CR.for=null; CR.asked=false; CR.lockLogged=false; CR.bad.clear(); CR.repaired=null;
  try{ localStorage.setItem(CR_OUT, String(Date.now())); }catch(e){}
  if(CR.key||CR.owner) await crForget('sesión cerrada'); else await cryptoKeyForget().catch(()=>{});
  try{ localStorage.setItem(CR_OUT, String(Date.now())); }catch(e){} } // again, after the key left IndexedDB: the other windows drop theirs
const cryptoSignOutRecent = () => { let t=0; try{ t=+localStorage.getItem(CR_OUT)||0; }catch(e){} return Date.now()-t<60e3; };
// Another window of the app used «Cerrar sesión»: this one drops the key from memory too (IndexedDB is already empty)
window.addEventListener('storage', e=>{ if(e.key!==CR_OUT||!e.newValue) return; CR.key=null; CR.kid=null; CR.owner=null; CR.keyP=Promise.resolve(); CR.row=undefined; CR.for=null; CR.repaired=null; });
const crPaint = () => { if(CR.prog) crProgPaint(); if(onSettings()&&!busyEditing()&&!touchDrag) render(); };
// Ajustes reads the state while it is on screen, at most once a minute
function cryptoLoad(force){ if(!SY||!SY.user||!SY.remote.__crypto||!SY.remote.cryptoGet||CR.loading||!navigator.onLine) return;
  if(!force&&CR.for===SY.user.id&&CR.row!==undefined&&Date.now()-CR.at<60e3) return;
  CR.loading=true; const user=SY.user; crKeyBoot().then(()=>crFetch(user)).then(()=>crLoadStored(user)).catch(e=>log('warn','Estado del cifrado no disponible: '+(e&&e.message||e))).finally(()=>{ CR.loading=false; crPaint(); }); }

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
// The uploads of attachments under way finish before the key exists (a new one waits: the upload layer refuses while CR.busy)
// (the migration's file rounds wait for it again, and list once more after it, so a long upload is never missed)
async function crWaitUploads(){ const t0=Date.now(); while(UQ.running&&Date.now()-t0<120e3) await crSleep(100);
  if(UQ.running) log('warn','Cifrado: una subida de adjunto sigue en curso; el cifrado de archivos la espera'); }
/* Turns encryption on: a full pass, a local backup, the data key made and stored here and on the server, then the server copy encrypted.
   No pass runs from the moment the key is made until the server row is stored (CR.busy). If the server's answer is lost and the row cannot
   be read either, the key and the flag stay: the next pass decides by the kid of the server row (crFlagCheck) */
async function cryptoActivate(pw){ if(CR.busy||CR.migrating||CR.activating||!SY||!SY.user) return; const user=SY.user;
  CR.activating=true; CR.prog={n:0, of:0, step:'Sincronizando'}; crProgSheet(); log('info','Activación del cifrado: inicio');
  let kid=null, outcome='none', key=null;
  try{ flushHeld(true); flushEdits();
    if(!await syncRun('cifrado')) throw new Error(navigator.onLine?'No se pudo sincronizar':'Sin conexión');
    CR.busy=true; await crWaitUploads();
    if(await crFetch(user)) throw crErr('El cifrado ya está activado en esta cuenta', 'tareas_on');
    if(CR.absent) throw crErr('Falta 0012_encryption.sql en Supabase', 'tareas_absent');
    CR.prog.step='Copia de seguridad'; crProgPaint();
    try{ await BK.put(todayStr()); await refreshBackups(); log('info','Copia local antes de cifrar', {tasks:DB.tasks.length, projects:DB.projects.length}); }
    catch(e){ log('warn','Copia local antes de cifrar no disponible: '+(e&&e.message||e)); }
    CR.prog.step='Creando la clave'; crProgPaint();
    const dk=await cryptoNewKey(), seal=await cryptoSeal(pw, dk); key=await cryptoUnwrap(seal.wrapped, seal.kek, false); // the copy this device keeps cannot be extracted
    kid=cryptoB64(cryptoRandom(12));
    try{ await cryptoKeySave(key, kid, user.id); }catch(e){ log('warn','La clave de cifrado no se pudo guardar en este dispositivo: se pedirá la contraseña al volver a abrir la app'); }
    const now=new Date().toISOString(), row={owner_id:user.id, kid, salt:seal.salt, iterations:seal.iterations, wrapped:seal.wrapped, created:now, modified:now};
    crFlagWrite({owner:user.id, kid, at:now});
    try{ await SY.remote.cryptoPut(row); outcome='stored'; }
    catch(e){ let got; try{ got=await crFetch(user); }catch(x){ outcome='unknown'; throw e; } // the answer was lost and the row cannot be read: undecided
      if(got&&got.kid===kid) outcome='stored'; else throw e; }
    try{ await cryptoKeySave(key, kid, user.id); }catch(e){} // again, once the row is confirmed (a window may have cleared it meanwhile)
    crFlagWrite(null); CR.row={kid, salt:row.salt, iterations:row.iterations, wrapped:row.wrapped, created:now, modified:now, migrated:null}; CR.for=user.id; CR.at=Date.now();
    CR.key=key; CR.kid=kid; CR.owner=user.id; CR.keyP=Promise.resolve(); CR.asked=true; CR.repaired=kid;
    const st=syncState(); st.cryptoKid=kid; syncWrite(st); // this device's data never held server text: no need to pull it whole again
    log('info','Cifrado activado en la cuenta: clave creada'); }
  catch(e){ CR.busy=false; CR.activating=false; CR.prog=null; closeSheet(); render();
    if(outcome==='unknown'){ CR.force=true; log('warn','Activación del cifrado sin confirmar: '+(e&&e.message||e)+'. Se comprobará en la próxima sincronización'); toast('No se pudo confirmar el cifrado. Se comprobará al sincronizar'); return; }
    if(kid){ const r=await cryptoKeyLoad().catch(()=>null); if(r&&r.kid===kid) await cryptoKeyForget().catch(()=>{}); crFlagWrite(null); }
    log('error','Activación del cifrado: '+(e&&e.message||e));
    toast(e&&e.code==='tareas_on'?'El cifrado ya está activado en tu cuenta':e&&e.code==='tareas_absent'?'Falta poner al día Supabase':syncOffline(e)?'Sin conexión':'No se pudo activar el cifrado');
    if(e&&e.code==='tareas_on') syncRun('cifrado'); return; }
  CR.busy=false; CR.prog.step=null; crPaint();
  await cryptoMigrate(); CR.activating=false; }
// Every page of a table on the server, as the server holds it, in server_ts order (paged like syncPull) until an empty page; fn may write
// before the next one (what it writes comes again at the end and is skipped, as it already opens)
async function crScan(R, table, fn){ let after=null;
  for(;;){ const page=await R.pull(table, after, SYNC_PAGE); if(!page.length) return; const full=page.length>=SYNC_PAGE;
    const last=page[page.length-1].server_ts, keep=full?page.filter(r=>r.server_ts!==last):page, use=keep.length?keep:page;
    await fn(use); after=use[use.length-1].server_ts; } }
// An estimate of the rows and files the account holds, for «Cifrando N de M»: what this device knows of the server
const crEstimate = () => { const st=syncState(); return Object.keys(CRYPTO_COLS).reduce((n,t)=>n+Object.keys(st.known[t]||{}).length, 0)+DB.attachments.filter(a=>a&&a.path).length; };
/* Files of the account already encrypted (or set aside after CR_FILE_TRIES failures) by this device's migration, per kid, so a run that
   starts again does not download them all once more: {kid, done:[path], fails:{path:n}, aside:[path]} */
const CR_FILES='tareas-crypto-files', CR_FILE_TRIES=3;
function crFiles(kid){ let v=null; try{ v=JSON.parse(localStorage.getItem(CR_FILES)||'null'); }catch(e){} if(!v||v.kid!==kid) v={kid, done:[], fails:{}, aside:[]}; return v; }
const crFilesWrite = v => { try{ localStorage.setItem(CR_FILES, JSON.stringify(v)); }catch(e){} };
// The tables the migration must reach: a missing one (only a table truly absent, 42P01 or PGRST205, is noted missing) is skipped
const crMigTables = () => Object.keys(CRYPTO_COLS).filter(t=>!syncMissing(t));
/* Encrypts in place what the server holds for the account, while the key row says it is not done (migrated null). Any device with the key
   runs it, so a cut on one device (or its loss) never leaves it half done. The row is read again under the lock: done meanwhile, nothing
   to do. Page by page, each written back right after it is read: every row of every listed table, deleted ones and voice notes included,
   sent again with the same modified and deleted (the write trigger takes an equal modified); every attachment file without the magic,
   listed again (and the upload queue waited for) until none is new; the Siri phrases already taken are emptied. Any error of the server
   stops the run before the row is marked; a file that fails CR_FILE_TRIES times is set aside (logged, and Ajustes says how many) */
async function cryptoMigrate(){ const user=SY&&SY.user, k=crKey(); if(CR.migrating||!user||!k||!CR.row||CR.row.migrated) return;
  const kid=CR.kid, inner=SY.remote.inner||SY.remote, t0=Date.now(), stats={filas:0, archivos:0, frases:0, sinArchivo:0, apartados:0};
  CR.migrating=true; CR.busy=true; CR.prog=Object.assign(CR.prog||{}, {n:0, of:crEstimate(), step:null, done:false}); crPaint();
  let skipped=false;
  try{ await crLock(async()=>{
      const row=await crFetch(user); if(!row||row.kid!==kid||row.migrated){ skipped=true; return; }
      log('info','Cifrado: cifrando los datos del servidor', {estimados:CR.prog.of});
      for(const table of crMigTables()){ const seen=new Set();
        await crScan(inner, table, async page=>{ const send=[];
          for(const r of page){ if(!seen.has(r.id)){ seen.add(r.id); CR.prog.n++; }
            const o=await cryptoSealRow(k, table, r); if(o!==r){ const x=Object.assign({}, o); delete x.owner_id; delete x.server_ts; send.push(x); } }
          for(let i=0;i<send.length;i+=100) await inner.upsert(table, send.slice(i, i+100));
          stats.filas+=send.length; crPaint(); }); }
      if(!syncMissing('attachments')&&inner.fileUpload){ const F=crFiles(kid), done=new Set([...F.done, ...F.aside]); let failed=0;
        for(let round=0; round<20; round++){ while(UQ.running) await crSleep(200); // an upload started before the activation: its file is listed after it
          const todo=new Map();
          await crScan(inner, 'attachments', async page=>{ page.forEach(a=>{ if(a.path&&!a.purged&&!done.has(a.path)) todo.set(a.path, a.mime); }); });
          DB.attachments.forEach(a=>{ if(a&&a.path&&!done.has(a.path)) todo.set(a.path, a.mime); }); // uploaded from here, its row not up yet
          if(!todo.size&&!UQ.running) break; if(round) CR.prog.of+=todo.size;
          for(const [path, mime] of todo){
            try{ let blob=null;
              try{ blob=await crRawDownload(inner, path, SIGN_TTL); }catch(e){ if(syncOffline(e)) throw e; if(!/HTTP 4\d\d|not found|object not found/i.test(String(e&&e.message||e))) throw e; stats.sinArchivo++; log('warn','Cifrado: archivo no encontrado en el servidor, se deja'); }
              if(blob){ const u=new Uint8Array(await blob.arrayBuffer());
                if(!cryptoFileEnc(u)){ await inner.fileUpload(path, new Blob([await cryptoEncFile(k, u, path)], {type:mime||blob.type}), mime||blob.type); stats.archivos++; } }
              done.add(path); F.done.push(path); }
            catch(e){ if(syncOffline(e)) throw e; F.fails[path]=(F.fails[path]||0)+1;
              if(F.fails[path]>=CR_FILE_TRIES){ F.aside.push(path); done.add(path); stats.apartados++; log('error','Cifrado: un archivo no se ha podido cifrar tras '+CR_FILE_TRIES+' intentos y se deja aparte: '+(e&&e.message||e)); }
              else{ failed++; log('warn','Cifrado: un archivo no se ha podido cifrar, se intentará de nuevo: '+(e&&e.message||e)); } }
            crFilesWrite(F); CR.prog.n++; crPaint(); }
          if(failed) break; }
        if(failed) throw new Error(failed===1?'Un archivo sin cifrar':failed+' archivos sin cifrar'); }
      if(inner.inboxClear&&!syncMissing('inbox')) stats.frases=((await inner.inboxClear())||[]).length; });
    if(skipped){ CR.prog=null; log('info','Cifrado: el servidor ya estaba cifrado'); return; }
    const now=new Date().toISOString(); await inner.cryptoPatch(user.id, {kid, migrated:null}, {migrated:now});
    if(CR.row&&CR.row.kid===kid&&!CR.row.migrated) CR.row.migrated=now;
    CR.prog.done=true; CR.wait=0; CR.resumeAt=0;
    log('info','Cifrado completado', Object.assign(stats, {ms:Date.now()-t0})); if(CR.activating) toast('Cifrado activado'); }
  catch(e){ CR.prog=null; CR.wait=Math.min(600e3, CR.wait?CR.wait*2:30e3); CR.resumeAt=Date.now()+CR.wait; // the next try waits longer each time, so a file that keeps failing never loops
    log(syncOffline(e)?'warn':'error','Cifrado interrumpido: '+(e&&e.message||e)+'. Continuará en la próxima sincronización');
    const l=document.querySelector('#sheet .cxprog'); if(l) closeSheet(); if(CR.activating) toast('El cifrado se completará en la próxima sincronización'); }
  finally{ CR.migrating=false; CR.busy=false; const p=CR.prog; crPaint(); if(p&&p.done) setTimeout(()=>{ if(CR.prog===p) CR.prog=null; }, 0); syncRun('cifrado'); } }
// Files set aside by this device's migration (Ajustes says how many)
const crAside = () => CR.kid ? crFiles(CR.kid).aside.length : 0;
// After a pass that reached the server: while the account's row says the server copy is not all encrypted, this device (with the key) goes on
function cryptoResume(){ if(!SY||!SY.user||!crKey()||!CR.row||CR.row.migrated||CR.migrating||CR.busy||Date.now()<CR.resumeAt) return;
  setTimeout(()=>{ if(!CR.migrating&&!CR.busy&&crKey()&&CR.row&&!CR.row.migrated){ log('info','Cifrado: se continúa el cifrado del servidor'); cryptoMigrate(); } }, 0); }

/* ---------- Unlock on another device ---------- */
async function cryptoUnlock(pw){ const user=SY&&SY.user; if(!user) return 'off';
  const row=await crFetch(user); if(!row) return 'off';
  let key; try{ key=await cryptoOpen(pw, row, false); }catch(e){ log('info','Contraseña de cifrado incorrecta'); return 'wrong'; }
  if(!SY.user||SY.user.id!==user.id) return 'off';
  CR.key=key; CR.kid=row.kid; CR.owner=user.id; CR.keyP=Promise.resolve(); CR.lockLogged=false; CR.bad.clear(); CR.repaired=null; CR.skipLogged=false; // the next pass repairs this device's copy (crFirstOn)
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
  const mine = got => !!got && got.wrapped===seal.wrapped;
  // Only over the row as it was read: a change made meanwhile on another device is never overwritten
  let ok; try{ ok=await SY.remote.cryptoPatch(user.id, {kid:row.kid, wrapped:row.wrapped}, patch); }
  catch(e){ let got; try{ got=await crFetch(user); }catch(x){ throw e; } if(!mine(got)) throw e; ok=[{kid:row.kid}]; } // the answer was lost: the row tells
  if(Array.isArray(ok)&&!ok.length){ const got=await crFetch(user).catch(()=>null); if(!mine(got)){ log('info','Cambiar contraseña de cifrado: ya se había cambiado en otro dispositivo'); return 'other'; } }
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
      if(r==='other'){ c.value=''; err.textContent='La contraseña se ha cambiado en otro dispositivo. Escribe la nueva como actual'; c.focus(); return; }
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
  if(CR.migrating||!CR.row.migrated) return g(cell(CR.migrating?crProgText()||'Cifrando':'Cifrado sin terminar'), 'Se están cifrando los datos que ya había en tu cuenta. Si se interrumpe, continúa en la próxima sincronización.');
  const aside=crAside();
  return g(cell('Cifrado activado'+(CR.row.created?' el '+crDay(CR.row.created):''))+(aside?cell(aside===1?'1 archivo no se pudo cifrar':aside+' archivos no se pudieron cifrar', '', true):'')+btn('cxPass','Cambiar contraseña'),
    (aside?'Esos archivos siguen sin cifrar en el servidor. ':'')+'Lo que escribes se cifra en '+dev+' antes de guardarse en tu cuenta. Sin la contraseña nadie puede leerlo, tampoco el servidor.'); }
