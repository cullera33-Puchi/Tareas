'use strict';
/* Tareas. Start: first screen, ?task and ?add entries, sync and notification checks, service worker and update notice.
   A classic script: index.html loads every file of js/ in order and they share their global names. Only declarations and
   listeners run at load; the start itself (first screen, timers, sync, service worker) is in boot.js, the last file. */
// The start, in the order it had at the end of the single script: the first screen and what follows it need every other file
(function(){ let st='?'; try{ st=(navigator.standalone===true||matchMedia('(display-mode: standalone)').matches)?'instalada':'navegador'; }catch(e){} log('info','Inicio v'+APP_VERSION+' ('+st+')', {spaces:DB.spaces.length, projects:DB.projects.length, tasks:DB.tasks.length}); })();
DB.settings.filter='hoy'; UI.sumFilter=null; // the app always opens on Hoy; the filter is kept only while it runs
// Voice notes saved without a task (an old desktop pane bug) never show anywhere: drop them
{ const n=DB.voiceNotes.length; DB.voiceNotes=DB.voiceNotes.filter(v=>v.taskId&&task(v.taskId)); if(DB.voiceNotes.length!==n){ save(); log('info','Notas de voz sin tarea eliminadas: '+(n-DB.voiceNotes.length)); } }
{ const n=rollOver(); if(n) log('info','Tareas pasadas a hoy: '+n); } if(wideMQ.matches) applyWide(); else render(); // a desktop start never builds the iPhone screens
backupChain=refreshBackups().then(()=>{ if(onSettings()) render(); return dailyBackup(false); }).catch(()=>{});
(function(){ // Entry from the iOS Shortcut: ?add=texto opens the new-task sheet with the text
  try{ const tk=new URLSearchParams(location.search).get('task'); if(tk){ history.replaceState(null,'',location.pathname); setTimeout(()=>openTaskFromPush(tk,'inicio'),300); return; } }catch(e){} // block 9: a notification tapped with the app closed (sw.js)
  try{ const q=new URLSearchParams(location.search); const add=q.get('add'); if(add!==null){ history.replaceState(null,'',location.pathname); log('info','Entrada por URL', add.slice(0,80)); setTimeout(()=>addSheet(null, add.trim()),250); return; } }catch(e){}
  if(!DB.settings.tipsSeen) setTimeout(tipsSheet, 400);
})();
wideMQ.addEventListener('change', applyWide); // first applied at start, before the first render
syncBoot(); if(SY) bindPullRefresh(); // block 8: nothing happens without config.js
pushCheck(); // block 9: a subscription the browser renewed or dropped while the app was closed

/* ---------- Service worker: offline cache and update notice ---------- */
function applyUpdate(){ if(!pendingSW) return; updateRequested=true; toast('Actualizando'); log('info','Actualización aplicada por el usuario'); pendingSW.postMessage({type:'SKIP_WAITING'}); }
if('serviceWorker' in navigator){
  let reloading=false;
  // Offer the update until it is applied: on install, on every return to the app and from Settings.
  let offerLater=null;
  const offerUpdate = sw => { if(pendingSW!==sw) log('info','Nueva versión descargada, pendiente de aplicar'); pendingSW=sw; if(onSettings()) render();
    // Never replace a live Deshacer: show the notice once that toast is gone (Ajustes offers it meanwhile)
    clearTimeout(offerLater); if(undoFn && undoFn!==applyUpdate){ offerLater=setTimeout(()=>offerUpdate(sw), 4500); return; }
    toast('Nueva versión disponible', applyUpdate, 'Actualizar'); };
  navigator.serviceWorker.register('sw.js').then(reg=>{
    if(!reg) return; // some embedded browsers resolve without a registration
    if(reg.waiting && navigator.serviceWorker.controller) offerUpdate(reg.waiting);
    reg.addEventListener('updatefound',()=>{ const nw=reg.installing; if(!nw) return; nw.addEventListener('statechange',()=>{ if(nw.state==='installed' && navigator.serviceWorker.controller) offerUpdate(nw); }); });
    document.addEventListener('visibilitychange',()=>{ if(document.visibilityState!=='visible') return; reg.update().catch(()=>{}).then(()=>{ if(reg.waiting && navigator.serviceWorker.controller) offerUpdate(reg.waiting); }); });
  }).catch(e=>log('error','Service worker no registrado: '+(e&&e.message||e)));
  // Reload only on an update: the first install also fires controllerchange (clients.claim) and must not flash the page.
  // Only that first claim is skipped; a later update, or any the user asked for, reloads.
  // Block 9: a tap on a notification while the app is open, and every push received (sw.js)
  navigator.serviceWorker.addEventListener('message', e=>{ const d=e.data||{};
    if(d.type==='openTask') openTaskFromPush(d.taskId, 'app abierta');
    else if(d.type==='push') log('info','Notificación recibida', {tarea:!!d.taskId, prueba:!!d.test}); });
  let hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange',()=>{ if(reloading) return; if(!hadController && !updateRequested){ hadController=true; return; } reloading=true; location.reload(); });
}
