'use strict';
/* Tareas. Notifications (block 9): Web Push subscription, devices, Ajustes section and opening a task from a notification.
   A classic script: index.html loads every file of js/ in order and they share their global names. Only declarations and
   listeners run at load; the start itself (first screen, timers, sync, service worker) is in boot.js, the last file. */
/* ======================= PUSH (block 9): reminders as notifications =======================
   The server sends them: supabase/functions/send-reminders, called every minute by pg_cron, sends each due reminder once to every
   device of its owner. This block only gets this device ready and shows the state; nothing here blocks a tap.
   - The permission is asked inside a tap (iOS asks only then): the first time a reminder is set (pushOfferSoon, a short sheet that
     says why) or from Ajustes, Notificaciones (Activar notificaciones).
   - The subscription is made with the function's VAPID public key and saved for the account through SY.remote.pushSave. Offline,
     or before the first sync, it waits in 'tareas-push' (this device only, never synced or exported) and goes up after the next sync
     run (pushFlush).
   - On the iPhone, Web Push exists only in the app installed on the home screen (iOS 16.4 or later): a Safari tab explains it.
     Signed out there is no account to receive for, so that is explained too. Signing out takes this device off the account.
   - Ajustes, Notificaciones: the state, Activar, Probar notificación, and the account's devices with Revocar (a soft delete).
   - A tap on a notification opens the task (sw.js: a message to the open app, or ?task=id when it starts). */
const PUSH_KEY='tareas-push';
const PS=(()=>{ let s=null; try{ s=JSON.parse(localStorage.getItem(PUSH_KEY)||'null'); }catch(e){} s=s&&typeof s==='object'?s:{};
  return {id:s.id||null, sub:s.sub||null, savedFor:s.savedFor||null, asked:!!s.asked, key:s.key||null, devices:null, devFor:null, devAt:0, devLoading:false, busy:false, testing:false, flushing:false}; })();
function pushWrite(){ try{ localStorage.setItem(PUSH_KEY, JSON.stringify({id:PS.id, sub:PS.sub, savedFor:PS.savedFor, asked:PS.asked, key:PS.key})); }catch(e){} }
const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform==='MacIntel' && navigator.maxTouchPoints>1);
const pushCapable = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
function pushPerm(){ try{ return Notification.permission; }catch(e){ return 'default'; } }
// unsupported, notInstalled (an iPhone in a Safari tab), noSync (no config.js), signedOut, denied, off (not asked yet, or no subscription), on
function pushStatus(){
  if(isIOS() && !isStandalone()) return 'notInstalled';
  if(!pushCapable()) return 'unsupported';
  if(!SY) return 'noSync';
  if(!SY.user) return 'signedOut';
  const p=pushPerm(); if(p==='denied') return 'denied';
  return p==='granted' && PS.sub ? 'on' : 'off'; }
// The name shown in the list of devices: iPhone or iPad in the installed app, otherwise the computer and its browser
function deviceName(){ const ua=navigator.userAgent;
  const dev=/iPhone/.test(ua)?'iPhone':(/iPad/.test(ua)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1))?'iPad':/Android/.test(ua)?'Android':/Macintosh|Mac OS X/.test(ua)?'Mac':/Windows/.test(ua)?'Windows':/Linux|CrOS/.test(ua)?'Linux':'';
  if((dev==='iPhone'||dev==='iPad') && isStandalone()) return dev;
  const br=/Edg\//.test(ua)?'Edge':/Firefox\//.test(ua)?'Firefox':/Chrome\//.test(ua)?'Chrome':/Safari\//.test(ua)?'Safari':'';
  return dev ? (br?dev+' con '+br:dev) : (br||'Navegador'); }
const b64uBytes = s => { const t=atob(String(s).replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-String(s).length%4)%4)); const u=new Uint8Array(t.length); for(let i=0;i<t.length;i++) u[i]=t.charCodeAt(i); return u; };
const bytesB64u = b => { const u=new Uint8Array(b); let s=''; for(let i=0;i<u.length;i++) s+=String.fromCharCode(u[i]); return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,''); };
function pushPaint(){ if(busyEditing() || touchDrag) return; if(onSettings() || detailTaskId()) render(); }

/* ---------- Turning it on ---------- */
// After a reminder is set in Recordatorio: the first time only, once its sheet or popover has gone
function pushOfferSoon(){ if(PS.asked || ['on','unsupported','noSync','denied'].includes(pushStatus())) return;
  setTimeout(()=>{ if(sheet.classList.contains('on') || asheet.classList.contains('on') || menuOpen()) return; pushOffer(); }, 560); }
function pushOffer(){ const st=pushStatus(); if(PS.asked || ['on','unsupported','noSync','denied'].includes(st)) return;
  PS.asked=true; pushWrite(); const dev=UI.wide?'este dispositivo':'este iPhone';
  const info=(text)=>openSheet('<h2>Notificaciones</h2><div class="hint">'+text+'</div><div class="sheet-actions"><span style="flex:1"></span><button class="btn primary" data-x="ok">Entendido</button></div>', s=>{ s.onclick=e=>{ if(e.target.closest('[data-x]')&&!ghostSheet(e)) closeSheet(); }; });
  log('info','Notificaciones: explicación mostrada', {estado:st});
  if(st==='notInstalled'){ info('Los recordatorios solo avisan con Tareas instalada en la pantalla de inicio. En Safari, toca Compartir y Añadir a pantalla de inicio, y abre la app desde allí.'); return; }
  if(st==='signedOut'){ info('Los recordatorios avisan a través de tu cuenta. Inicia sesión en Ajustes para recibirlos en '+dev+'.'); return; }
  openSheet('<h2>Notificaciones</h2><div class="hint">Para avisarte a la hora de cada recordatorio, aunque la app esté cerrada, Tareas necesita permiso para enviar notificaciones a '+dev+'.</div>'+
    '<div class="sheet-actions"><button class="btn" data-x="no">Ahora no</button><button class="btn primary" data-x="yes">Permitir</button></div>', s=>{
    s.onclick=e=>{ const b=e.target.closest('[data-x]'); if(!b||ghostSheet(e)) return; closeSheet(); if(b.dataset.x==='yes') pushEnable(); else log('info','Notificaciones: ahora no'); }; }); }
// Inside a tap: the permission prompt, then the subscription in the background
function pushEnable(){ if(pushStatus()!=='off' || PS.busy) return;
  if(!navigator.onLine && !PS.key){ toast('Sin conexión'); return; }
  let req; try{ req=Notification.requestPermission(); }catch(e){ req=Promise.reject(e); }
  PS.busy=true; pushPaint();
  Promise.resolve(req).then(p=>{ log('info','Permiso de notificaciones: '+p);
    if(p!=='granted'){ toast(p==='denied'?'Sin permiso de notificaciones':'Notificaciones sin activar'); return; }
    return pushSubscribe().then(()=>toast('Notificaciones activadas'));
  }).catch(e=>{ log('error','Notificaciones: no se pudieron activar: '+(e&&e.message||e)); toast(syncOffline(e)?'Sin conexión':'No se pudieron activar las notificaciones'); })
  .finally(()=>{ PS.busy=false; pushPaint(); }); }
// The function's public key; kept, so a later subscription works offline
async function pushPublicKey(){
  try{ const k=await SY.remote.pushKey(); if(!k) throw new Error('sin clave pública'); if(k!==PS.key){ PS.key=k; pushWrite(); } }
  catch(e){ if(!PS.key) throw e; log('warn','Clave pública de notificaciones no disponible, se usa la guardada: '+(e&&e.message||e)); }
  return PS.key; }
async function pushSubscribe(){ const reg=await navigator.serviceWorker.ready; const key=await pushPublicKey();
  let sub=await reg.pushManager.getSubscription();
  const k=sub&&sub.options&&sub.options.applicationServerKey; if(sub && k && bytesB64u(k)!==key){ log('info','Suscripción con otra clave: se renueva'); await sub.unsubscribe().catch(()=>{}); sub=null; }
  if(!sub){ try{ sub=await reg.pushManager.subscribe({userVisibleOnly:true, applicationServerKey:b64uBytes(key)}); }
    catch(e){ log('error','Suscripción a notificaciones fallida: '+(e&&e.message||e)); throw e; } }
  pushAdopt(sub, 'creada'); await pushFlush(); }
function pushAdopt(sub, how){ const j=sub.toJSON(), was=PS.sub&&PS.sub.endpoint;
  if(!PS.id) PS.id=uid(); PS.sub={endpoint:j.endpoint, p256dh:j.keys&&j.keys.p256dh, auth:j.keys&&j.keys.auth}; if(was!==j.endpoint) PS.savedFor=null; pushWrite();
  log('info','Suscripción a notificaciones '+how, {device:deviceName(), host:(()=>{ try{ return new URL(j.endpoint).host; }catch(e){ return ''; } })()}); }
// This device's subscription to the account; called after each sync run, so one made offline goes up later
async function pushFlush(){ if(!SY||!SY.user||!SY.remote.pushSave||!PS.sub||PS.savedFor===SY.user.id||PS.flushing||!navigator.onLine) return;
  PS.flushing=true; const user=SY.user.id;
  try{ await SY.remote.pushSave({id:PS.id, endpoint:PS.sub.endpoint, p256dh:PS.sub.p256dh, auth:PS.sub.auth, device:deviceName()}); PS.savedFor=user; pushWrite(); log('info','Suscripción guardada en la cuenta'); pushDevices(true); }
  catch(e){ log(syncOffline(e)?'warn':'error','Suscripción no guardada en la cuenta: '+(e&&e.message||e)); }
  finally{ PS.flushing=false; pushPaint(); } }
// This device no longer receives: the browser's subscription goes too, so turning it on again starts clean
function pushDrop(){ PS.sub=null; PS.savedFor=null; pushWrite();
  if('serviceWorker' in navigator) navigator.serviceWorker.ready.then(r=>r.pushManager&&r.pushManager.getSubscription()).then(s=>s&&s.unsubscribe()).catch(()=>{}); }
// At start: the browser may have renewed or dropped the subscription meanwhile
function pushCheck(){ if(pushStatus()!=='on') return;
  navigator.serviceWorker.ready.then(reg=>reg.pushManager.getSubscription()).then(sub=>{
    if(!sub){ log('warn','La suscripción a notificaciones ya no está en el navegador: se crea otra');
      return pushSubscribe().catch(e=>{ log('warn','No se pudo renovar la suscripción: '+(e&&e.message||e)); pushDrop(); pushPaint(); }); } // Ajustes offers Activar again, inside a tap
    if(sub.endpoint!==PS.sub.endpoint) pushAdopt(sub, 'renovada');
    return pushFlush(); }).catch(e=>log('warn','Comprobación de notificaciones: '+(e&&e.message||e))); }
async function pushSignOut(){ if(!PS.sub) return;
  try{ if(SY&&SY.user&&PS.savedFor===SY.user.id&&navigator.onLine) await SY.remote.pushRevoke(PS.id); log('info','Notificaciones de este dispositivo desactivadas al cerrar sesión'); }
  catch(e){ log('warn','Al cerrar sesión no se pudo quitar este dispositivo de la cuenta: '+(e&&e.message||e)); }
  pushDrop(); PS.devices=null; PS.devFor=null; }

/* ---------- Devices, revoke and test ---------- */
function pushDevices(force){ if(!SY||!SY.user||!SY.remote.pushList||!navigator.onLine||PS.devLoading) return; if(!force && Date.now()-PS.devAt<60e3) return;
  PS.devLoading=true; PS.devAt=Date.now(); const user=SY.user.id;
  SY.remote.pushList().then(list=>{ if(!SY.user||SY.user.id!==user) return; PS.devices=list||[]; PS.devFor=user;
    // Revoked from another device, or removed by the server because its push service no longer knows it
    if(PS.sub && PS.savedFor===user && !PS.flushing && !PS.devices.some(d=>d.id===PS.id)){ log('info','Este dispositivo ya no está en la cuenta: notificaciones desactivadas'); pushDrop(); } })
  .catch(e=>log('warn','Dispositivos con notificaciones no disponibles: '+(e&&e.message||e))).finally(()=>{ PS.devLoading=false; pushPaint(); }); }
function pushRevokeSheet(id){ const d=(PS.devices||[]).find(x=>x.id===id); if(!d) return; const me=id===PS.id;
  confirmSheet('Revocar', (me?'Este dispositivo':(d.device||'Ese dispositivo'))+' dejará de recibir notificaciones.', async()=>{
    try{ await SY.remote.pushRevoke(id); log('info','Dispositivo revocado', {device:d.device||'', este:me}); if(me) pushDrop(); PS.devices=(PS.devices||[]).filter(x=>x.id!==id); toast('Dispositivo revocado'); }
    catch(e){ log('error','No se pudo revocar el dispositivo: '+(e&&e.message||e)); toast(syncOffline(e)?'Sin conexión':'No se pudo revocar'); }
    pushPaint(); }); }
async function pushTest(){ if(PS.testing) return; PS.testing=true; pushPaint();
  try{ await pushFlush(); const r=await SY.remote.pushTest(PS.id)||{}, gone=!r.sent&&(!r.devices||r.gone);
    log(r.sent?'info':'error','Notificación de prueba', r); // the function's counts: devices, sent, failed, gone
    toast(r.sent?'Notificación de prueba enviada':gone?'Este dispositivo ya no está en la cuenta':'No se pudo enviar la prueba');
    if(gone) pushDevices(true); }
  catch(e){ log('error','Notificación de prueba: '+(e&&e.message||e)); toast(syncOffline(e)?'Sin conexión':'No se pudo enviar la prueba'); }
  finally{ PS.testing=false; pushPaint(); } }

/* ---------- Ajustes, Notificaciones, and the line under Recordatorio ---------- */
function pushSectionHTML(dev){ const st=pushStatus();
  const g=(cells, foot)=>'<div class="group-title">Notificaciones</div><div class="group push-acc">'+cells+'</div>'+(foot?'<div class="footnote">'+foot+'</div>':'');
  const cell=(l,v,warn)=>'<div class="cell"><span class="lbl">'+l+'</span><span class="val'+(warn?' warn':'')+'">'+v+'</span></div>';
  const btn=(act,l,dis)=>'<button class="cell link" data-act="'+act+'"'+(dis?' disabled':'')+'><span class="lbl">'+l+'</span></button>';
  if(st==='unsupported') return g(cell('Notificaciones','No disponibles'), 'Este navegador no puede recibir notificaciones.');
  if(st==='notInstalled') return g(cell('Notificaciones','Sin instalar'), 'Los recordatorios solo avisan con Tareas instalada en la pantalla de inicio. En Safari, toca Compartir y Añadir a pantalla de inicio, y abre la app desde allí.');
  if(st==='noSync') return g(cell('Notificaciones','No disponibles'), 'Los recordatorios avisan a través de la cuenta, que no está disponible en esta versión.');
  if(st==='signedOut') return g(cell('Notificaciones','Sin cuenta'), 'Inicia sesión para que los recordatorios avisen en '+dev+'. Las notificaciones llegan a través de tu cuenta.');
  if(st==='denied') return g(cell('Permiso','Denegado',true), UI.wide?'Para recibirlas, permite las notificaciones de esta página en los ajustes del navegador.':'Para recibirlas, activa las notificaciones de Tareas en la app Ajustes del iPhone, en Notificaciones.')+pushDevicesHTML();
  if(st==='off') return g(cell('Permiso', pushPerm()==='granted'?'Concedido':'Sin pedir')+btn('pushEnable', PS.busy?'Activando':'Activar notificaciones', PS.busy), 'Avisan a la hora de cada recordatorio, aunque la app esté cerrada.')+pushDevicesHTML();
  const pend=PS.savedFor!==SY.user.id;
  return g(cell('Permiso','Concedido')+cell('Este dispositivo', esc(deviceName()))+btn('pushTest', PS.testing?'Enviando':'Probar notificación', PS.testing||pend),
    pend?'Este dispositivo se añadirá a tu cuenta al sincronizar.':'Avisan a la hora de cada recordatorio, aunque la app esté cerrada.')+pushDevicesHTML(); }
function pushDevicesHTML(){ if(!SY||!SY.user) return ''; setTimeout(()=>pushDevices(false), 0); // fetched while Ajustes is on screen, at most once a minute
  const l=PS.devFor===SY.user.id?PS.devices:null; if(!l||!l.length) return ''; // none yet: nothing to list or revoke
  return '<div class="group-title">Dispositivos con notificaciones</div><div class="group push-acc">'+(l.length?l.map(d=>'<div class="cell"><span class="lbl">'+esc(d.device||'Dispositivo')+'</span><span class="val">'+(d.id===PS.id?'Este':d.created?pushSince(d.created):'')+'</span><button class="rvk" data-push-revoke="'+esc(d.id)+'">Revocar</button></div>').join('')
    :'<div class="cell"><span class="lbl" style="color:var(--ink2)">Ninguno</span></div>')+'</div>'; }
const pushSince = iso => { const f=fmtDate(localDay(iso)); return /^\d/.test(f)?'Desde el '+f:'Desde '+f.toLowerCase(); }; // Desde hoy, Desde ayer, Desde el 28 oct
// Under Recordatorio, when this device will not notify. Empty when it will, or without a reminder
function pushNote(x){ if(!x||!x.reminder||x.status==='done') return ''; const dev=UI.wide?'este dispositivo':'este iPhone';
  return {unsupported:'Este navegador no recibe notificaciones: el recordatorio no avisará aquí.', notInstalled:'El recordatorio solo avisa con Tareas instalada en la pantalla de inicio.',
    signedOut:'Inicia sesión en Ajustes para que el recordatorio avise.', denied:'Sin permiso de notificaciones: el recordatorio no avisará en '+dev+'.', off:'Activa las notificaciones en Ajustes para que el recordatorio avise.'}[pushStatus()]||''; }

/* ---------- A tap on a notification ---------- */
// snz: the minutes of a desktop notification's action (10 or 60, sw.js), applied here with Deshacer since the service worker has no localStorage.
// A plain tap opens the task with the bar Posponer recordatorio (decision 55), until a choice or until the task is left
function openTaskFromPush(id, how, snz){ if(!id) return; log('info','Notificación abierta', Object.assign({how}, snz?{posponer:snz}:{})); hiddenAt=0; // a tap on a notification is no return after hours away
  const go=()=>{ const x=task(id); if(!x) return false; closeSheet(); closeMenu(true); if(UI.select) endSelect();
    const bar=!snz&&!!x.reminder&&isOpen(x);
    if(detailTaskId()===id){ UI.snooze=bar?id:null; render(); }
    else { if(UI.wide && UI.deskView==='settings') setDeskView('hoy'); openDetail(id, {snooze:bar}); }
    if(snz) snoozeFromPush(id, snz); return true; };
  if(go()) return;
  // Made on another device and not here yet: after a sync
  if(SY&&SY.user) syncRun('notificación').then(()=>{ if(!go()) toast('La tarea ya no existe'); }); else toast('La tarea ya no existe'); }

/* ---------- Decision 55: Posponer recordatorio ----------
   One tap moves the reminder to 10 minutos, 1 hora, Esta tarde a las 17:00 (until 16:30) or Mañana a las 9:00 from now; Elegir opens the
   Recordatorio picker. It rewrites reminder and empties reminderSent, so send-reminders notifies again at the new time; Deshacer puts both
   back. The task's date never changes, as in the Recordatorio picker, where a reminder may fall on another day than the task.
   From the bar of a task opened from its notification (snoozeBarHTML), the row menu (iPhone) and the task menu (desktop), and the actions
   10 min and 1 h of a desktop notification (sw.js, ?snooze=) */
const SNOOZE_LATE=16*60+30; // from 16:30, Esta tarde a las 17:00 is not offered
const snoozeIn = m => new Date(Math.floor((Date.now()+m*6e4)/6e4)*6e4).toISOString(); // m minutes from now, on the minute
function snoozeOpts(){ const n=new Date(), o=[['10','10 minutos',snoozeIn(10)],['60','1 hora',snoozeIn(60)]];
  if(n.getHours()*60+n.getMinutes()<SNOOZE_LATE){ const e=new Date(); e.setHours(17,0,0,0); o.push(['pm','Esta tarde a las 17:00',e.toISOString()]); }
  const tm=new Date(); tm.setDate(tm.getDate()+1); tm.setHours(9,0,0,0); o.push(['tm','Mañana a las 9:00',tm.toISOString()]); return o; }
const canSnooze = x => !!x && !!x.reminder && isOpen(x);
const remWords = iso => { const d=localDay(iso), t=todayStr(); return (d===t?'':d===addDays(t,1)?'mañana ':fmtDate(d).toLowerCase()+' ')+'a las '+fmtTime(iso); }; // "a las 10:20", "mañana a las 09:00"
function snoozeReminder(id, iso, how){ const x=task(id); if(!canSnooze(x)||!iso) return false; const old={reminder:x.reminder||null, reminderSent:x.reminderSent||null};
  releaseHold(id); UI.snooze=null; updTask(id, {reminder:iso, reminderSent:null}); haptic(6); render();
  log('info','Recordatorio pospuesto', {how, de:fmtDateTime(old.reminder), a:fmtDateTime(iso)});
  toast('Recordatorio '+remWords(iso), ()=>{ updTask(id, old); log('info','Recordatorio pospuesto deshecho'); }); return true; }
function snoozeFromPush(id, snz){ const m=Math.round(+snz); if(!(m>0&&m<=1440)) return; if(!snoozeReminder(id, snoozeIn(m), 'aviso, '+m+' min')) log('warn','Posponer desde el aviso: la tarea no tiene recordatorio'); }
// A choice of the bar: an option, or Elegir (the picker anchored to the chip on the desktop)
function snoozePick(id, key, src){ if(key==='pick'){ UI.snooze=null; reminderSheet(id, UI.wide?src:undefined); return; } // the bar goes with the redraw once the picker saves
  const o=snoozeOpts().find(q=>q[0]===key); if(o) snoozeReminder(id, o[2], o[1]); }
// The submenu Posponer recordatorio of the row menu (iPhone) and of the task menu (desktop)
function snoozeMenu(id){ const x=task(id); if(!canSnooze(x)) return null;
  return {title:'Posponer recordatorio', groups:[snoozeOpts().map(o=>({label:o[1], icon:MI.bell, fn:()=>snoozeReminder(id, o[2], o[1])})), [{label:UI.wide?'Elegir…':'Elegir', icon:MI.calPick, fn:()=>reminderSheet(id)}]]}; }
// The bar on top of the detail and the inspector of a task opened from its notification; leaving the task (pop, another one) drops it
function snoozeBarHTML(x){ if(UI.snooze&&(UI.snooze!==x.id||detailTaskId()!==x.id)) UI.snooze=null; if(!UI.snooze||!canSnooze(x)) return '';
  return '<div class="snzbar" role="group" aria-label="Posponer recordatorio"><div class="snzh">'+I.bell+'<b>Posponer recordatorio</b><span class="snzt">'+esc(fmtDateTime(x.reminder))+'</span></div><div class="chips">'+
    snoozeOpts().map(o=>'<button class="chip" data-act="snooze" data-snz="'+o[0]+'">'+o[1]+'</button>').join('')+'<button class="chip" data-act="snooze" data-snz="pick">Elegir…</button></div></div>'; }
