'use strict';
/* Tareas. Life of the app: pull to refresh, shake to undo, keyboard, badge, day change, return to Hoy and reload when another window writes.
   A classic script: index.html loads every file of js/ in order and they share their global names. Only declarations and
   listeners run at load; the start itself (first screen, timers, sync, service worker) is in boot.js, the last file. */
/* ---------- Pull to refresh (iPhone: Tareas and a project) ---------- */
const SPIN='<svg viewBox="0 0 24 24" aria-hidden="true">'+[0,1,2,3,4,5,6,7].map(i=>'<rect x="11" y="2" width="2" height="6" rx="1" fill="currentColor" opacity="'+(0.25+i*0.107).toFixed(2)+'" transform="rotate('+(i*45)+' 12 12)"/>').join('')+'</svg>';
function bindPullRefresh(){
  const el=document.createElement('div'); el.className='ptr'; el.setAttribute('aria-hidden','true'); el.innerHTML='<span class="ptr-spin">'+SPIN+'</span><span class="ptr-text"></span>'; document.body.appendChild(el);
  const TH=110; let mode=null, x0=0, y0=0, sc=null, scr=null, dist=0, busy=false;
  const target=t=>{ if(UI.wide||!SY||!SY.user||UI.select||busy) return null; const s=t.closest&&t.closest('.screen'); if(!s) return null;
    const top=UI.stack.length?UI.stack[UI.stack.length-1]:null;
    const ok=top ? (top.kind==='project' && top.el===s) : (s.classList.contains('root') && s.dataset.root==='tareas' && UI.tab==='tareas');
    const c=ok&&t.closest('.scroll'); return c&&s.contains(c)?{s,c}:null; };
  const place=()=>{ const h=scr.querySelector('.nav'); el.style.setProperty('--ptr-y', ((h?h.getBoundingClientRect().bottom:0)+12)+'px'); };
  const show=f=>{ el.style.opacity=String(f); el.querySelector('.ptr-spin').style.transform='rotate('+Math.round(f*270)+'deg)'; };
  const hide=()=>{ el.classList.remove('on','spin','done'); el.style.opacity='0'; const s=scr; if(s&&s.classList.contains('ptr-hold')){ s.classList.remove('ptr-hold'); setTimeout(()=>s.classList.remove('ptr-anim'), 450); } };
  app.addEventListener('touchstart', e=>{ mode=null; if(e.touches.length!==1) return; const h=target(e.target); if(!h||h.c.scrollTop>0) return;
    scr=h.s; sc=h.c; x0=e.touches[0].clientX; y0=e.touches[0].clientY; dist=0; mode='pending'; }, {passive:true});
  app.addEventListener('touchmove', e=>{ if(!mode) return; const t=e.touches[0], dx=t.clientX-x0, dy=t.clientY-y0;
    if(mode==='pending'){ if(Math.abs(dx)>10&&Math.abs(dx)>Math.abs(dy)){ mode=null; return; } if(dy<-4||sc.scrollTop>0){ mode=null; return; } if(dy<12) return;
      mode='pull'; place(); el.querySelector('.ptr-text').textContent=''; el.classList.add('on'); }
    dist=Math.max(0, dy); show(Math.min(1, dist/TH)); if(dist>=TH && !el.dataset.armed){ el.dataset.armed='1'; haptic(8); } else if(dist<TH) delete el.dataset.armed; }, {passive:true});
  const end=()=>{ const m=mode; mode=null; delete el.dataset.armed; if(m!=='pull') return; if(dist<TH){ hide(); return; }
    busy=true; el.classList.add('spin'); show(1); scr.classList.add('ptr-anim','ptr-hold'); const t0=Date.now(), held=scr;
    syncRun('tirar').then(ok=>{ setTimeout(()=>{ el.classList.remove('spin'); el.classList.add('done');
      el.querySelector('.ptr-text').textContent = ok ? 'Sincronizado a las '+fmtTime(SY.lastSync) : SY.status==='offline' ? 'Sin conexión' : 'No se pudo sincronizar';
      setTimeout(()=>{ scr=held; hide(); busy=false; }, 1400); }, Math.max(0, 600-(Date.now()-t0))); }); };
  app.addEventListener('touchend', end, {passive:true}); app.addEventListener('touchcancel', ()=>{ if(mode==='pull') hide(); mode=null; }, {passive:true}); }

/* Log sheet */
function logSheet(){
  openSheet('<h2>Registro</h2><div class="hint">'+LOG.length+' entradas. Cópialo y pégalo en el chat.</div><textarea readonly style="min-height:260px;font-size:12px;line-height:1.35;font-family:ui-monospace,Menlo,monospace">'+esc(logText())+'</textarea><div class="sheet-actions"><button class="btn" data-x="clear">Borrar</button><button class="btn primary" data-x="copy">Copiar</button></div>'+(navigator.share?'<div class="sheet-actions" style="margin-top:10px"><button class="btn" data-x="share">Compartir</button></div>':''), s=>{
    s.onclick=e=>{ const b=e.target.closest('[data-x]'); if(!b) return;
      if(b.dataset.x==='copy'){ copyText(logText(),'Registro copiado'); return; }
      if(b.dataset.x==='share'){ navigator.share({title:'Registro de Tareas', text:logText()}).catch(()=>{}); return; }
      if(b.dataset.x==='clear'){ LOG=[]; try{ localStorage.removeItem(LOGKEY); }catch(err){} closeSheet(); render(); toast('Registro borrado'); } };
  });
}

/* Shake to undo (optional): undoes the action whose toast is still showing */
let shakeArmed=false, lastShake=0, lastAcc=null;
function onMotion(e){ const a=e.accelerationIncludingGravity; if(!a) return; if(lastAcc){ const d=Math.abs(a.x-lastAcc.x)+Math.abs(a.y-lastAcc.y)+Math.abs(a.z-lastAcc.z); if(d>30 && Date.now()-lastShake>1200){ lastShake=Date.now(); if(undoFn && !toastLbl){ haptic(15); $('#toastBtn').click(); } } } lastAcc={x:a.x,y:a.y,z:a.z}; } // a shake undoes an action, never installs an update
function armShake(){ if(shakeArmed) return; shakeArmed=true; window.addEventListener('devicemotion', onMotion); }
function disarmShake(){ shakeArmed=false; window.removeEventListener('devicemotion', onMotion); }
async function toggleShake(){
  if(DB.settings.shakeUndo){ DB.settings.shakeUndo=false; save(); disarmShake(); render(); return; }
  try{ if(typeof DeviceMotionEvent!=='undefined' && typeof DeviceMotionEvent.requestPermission==='function'){ const st=await DeviceMotionEvent.requestPermission(); if(st!=='granted'){ toast('Sin permiso de movimiento'); log('warn','Permiso de movimiento: '+st); return; } } }
  catch(e){ toast('Sin permiso de movimiento'); log('warn','Permiso de movimiento: '+(e&&e.message||e)); return; }
  DB.settings.shakeUndo=true; save(); armShake(); haptic(8); render(); toast('Agitar para deshacer activado');
}
if(DB.settings.shakeUndo){ armShake(); // iOS asks again per launch: re-request on the first touch
  if(typeof DeviceMotionEvent!=='undefined' && typeof DeviceMotionEvent.requestPermission==='function'){ const once=()=>{ document.removeEventListener('touchend', once); DeviceMotionEvent.requestPermission().catch(()=>{}); }; document.addEventListener('touchend', once); } }

/* Keyboard: reposition sheets */
let kbNow=0;
// iOS 26 can shrink the whole window with the keyboard instead of the visual viewport: the page then already fits above it
const kbShrunk=()=>!UI.wide && screen.height>0 && innerHeight < screen.height*0.75 && innerWidth < screen.width+2;
if(window.visualViewport){ const vv=window.visualViewport; const f=()=>{ const kb=Math.max(0, innerHeight - vv.height - vv.offsetTop); kbNow=kb; document.documentElement.style.setProperty('--kb', kb+'px'); document.documentElement.classList.toggle('kbup', kb>=60||kbShrunk()); if(kb>=60) sheet.classList.remove('top'); }; vv.addEventListener('resize',f); vv.addEventListener('scroll',f); }
// Some iOS versions do not shrink the visual viewport of an installed web app when the keyboard opens: --kb stays 0 and a
// bottom sheet stays hidden behind the keyboard. If a field in the sheet has the focus and no keyboard has been reported
// shortly after, the sheet moves to the top of the screen. The measures are logged once per launch to tune this on the device.
let kbLogs=0;
function kbFallback(when){ if(UI.wide||!sheet.classList.contains('on')) return; const ae=document.activeElement;
  if(!ae||!sheet.contains(ae)||!/^(INPUT|TEXTAREA)$/.test(ae.tagName)||/^(date|time|datetime-local|checkbox|file)$/.test(ae.type||'')) return;
  const vv=window.visualViewport, shrunk=kbShrunk();
  document.documentElement.classList.toggle('kbup', kbNow>=60||shrunk);
  const top = when==='late' && kbNow<60 && !shrunk; // decided only once the keyboard has settled
  if(kbLogs<4){ kbLogs++; const r=sheet.getBoundingClientRect(); log('info','Teclado ('+when+'): pantalla '+screen.height+', ventana '+innerHeight+', visible '+(vv?Math.round(vv.height):'?')+', desplazado '+(vv?Math.round(vv.offsetTop):'?')+', scroll '+Math.round(scrollY)+', teclado '+Math.round(kbNow)+', hoja '+Math.round(r.top)+' a '+Math.round(r.bottom)+(top?', hoja arriba':'')); }
  if(top) sheet.classList.add('top'); }
sheet.addEventListener('focusin', ()=>{ setTimeout(()=>kbFallback('early'), 400); setTimeout(()=>kbFallback('late'), 1200); });
sheet.addEventListener('focusout', ()=>{ setTimeout(()=>{ if(!sheet.contains(document.activeElement)){ sheet.classList.remove('top'); if(!(kbNow>=60)) document.documentElement.classList.remove('kbup'); } }, 60); });
document.addEventListener('gesturestart',e=>e.preventDefault());
document.addEventListener('touchmove',e=>{ if(e.touches.length>1) e.preventDefault(); },{passive:false});

/* Badge (when the browser supports it) */
function badge(){ try{ if(!navigator.setAppBadge) return; const t=todayStr(); const n=DB.tasks.filter(x=>x.status!=='done'&&x.date&&x.date<=t).length; /* pending, and waiting on its review day (decision 41), as send-reminders counts */ n?navigator.setAppBadge(n):navigator.clearAppBadge(); }catch(e){} }
/* Day change while the app stays open: pending tasks roll over to today and the daily backup is taken.
   render() checks first, so whatever redraws after midnight already shows the new day. */
let renderedDay='', renderedClock='', backupChain=Promise.resolve();
function queueDailyBackup(){ backupChain=backupChain.then(()=>dailyBackup(false)).catch(()=>{}); return backupChain; }
function checkDay(){ if(DB.settings.summaryDay===todayStr()) return false; const n=rollOver(); if(n) log('info','Tareas pasadas a hoy: '+n); queueDailyBackup(); return true; }
const _render=render; render=function(){ staleView=false; checkDay(); _render(); badge(); renderedDay=todayStr(); renderedClock=clockKey(); fuGCSoon(); }; // decision 29: object URLs no screen shows are let go
// A redraw while something is being typed or picked would close the keyboard or the sheet
const busyEditing=()=>sheet.classList.contains('on')||asheet.classList.contains('on')||menuOpen()||!!UI.select||/^(INPUT|TEXTAREA)$/.test((document.activeElement||{}).tagName||'');
// Checked every minute rather than with one timer at midnight, which a computer asleep at that hour would delay
// A summary line that went stale with the clock is redrawn too, unless something is being typed, picked or swiped
const clockStale=()=>(clockKey()!==renderedClock||staleView) && !busyEditing() && !openRow;
setInterval(()=>{ if(todayStr()!==renderedDay){ checkDay(); if(!busyEditing()) render(); } else if(!document.hidden && clockStale()) render(); }, 6e4);
window.addEventListener('focus',()=>{ if((todayStr()!==renderedDay && !busyEditing()) || clockStale()) render(); });

/* Desktop layout from 900 px wide. The height condition keeps phones in landscape (at most about 440 px tall) on the iPhone layout. */
const wideMQ = matchMedia('(min-width: 900px) and (min-height: 500px)');
function tipsSheet(){ // the desktop has no swipes or long presses: it explains its own clicks and keys
  const how = UI.wide
    ? '<h2>En el escritorio</h2><div class="tips"><p><b>Haz clic en una tarea</b> para abrirla en el panel de la derecha; arrastra su borde para cambiar el ancho. En Semana se abre junto a la tarjeta.</p><p><b>Clic derecho</b> en una tarea, o en sus tres puntos, para cambiar prioridad, fecha o proyecto sin abrirla. En un proyecto de la barra lateral, para renombrarlo, ordenarlo o archivarlo.</p><p><b>Teclas:</b> N añade una tarea, / busca y Esc cierra.</p><p><b>En Semana y Mes</b>, arrastra una tarea a otro día o al calendario pequeño de la barra lateral para cambiarle la fecha. En Horas, suéltala en una hora para ponerle recordatorio.</p>'
    : '<h2>Tres gestos</h2><div class="tips"><p><b>Desliza una tarea</b> a la derecha para completarla y a la izquierda para aplazarla o eliminarla.</p><p><b>Mantén pulsada</b> una tarea para cambiar prioridad, fecha o proyecto sin abrirla.</p>';
  openSheet(how+'<p><b>Escribe la fecha al final</b> del título al crear una tarea: "Llamar a Marta mañana", "Enviar acta el 12", "Revisar SOW viernes".</p></div><div class="sheet-actions"><button class="btn primary" data-x="ok">Entendido</button></div>', s=>{ s.onclick=e=>{ if(e.target.closest('[data-x=ok]')){ DB.settings.tipsSeen=true; save(); closeSheet(); } }; }); }
let hiddenAt=0;
function returnHome(){
  if(UI.select){ UI.select=null; app.classList.remove('selecting'); } openRow=null; UI.projFilter=null; UI.searchDone=false; // back to Hoy as on a fresh start
  if(UI.wide){ closeSheet(); setDeskView('hoy'); log('info','Vuelta a Hoy tras más de dos horas fuera'); return; } // the desktop returns through its own view; it has no iPhone stack
  UI.stack.forEach(s=>s.el.remove()); UI.stack=[]; UI.tab='tareas'; UI.query=''; UI.sumFilter=null; DB.settings.filter='hoy'; save(); closeSheet(); render(); const sc=rootScreen('tareas').querySelector('.scroll'); if(sc) sc.scrollTop=0; log('info','Vuelta a Hoy tras más de dos horas fuera'); }
window.addEventListener('pagehide', ()=>{ flushHeld(true); flushEdits(); });
document.addEventListener('visibilitychange',()=>{ if(document.visibilityState==='hidden'){ hiddenAt=Date.now(); closeMenu(true); flushHeld(true); flushEdits(); return; } reloadIfChanged(); const n=rollOver(); if(n) log('info','Tareas pasadas a hoy: '+n); queueDailyBackup();
  const away=hiddenAt && Date.now()-hiddenAt>2*36e5;
  if(away && !sheetBusy()) returnHome();
  else { if(away) log('info','Vuelta a Hoy omitida: hoja con texto sin guardar'); if(n || todayStr()!==renderedDay || clockStale()) render(); } });
// An open sheet holding text the user typed (a new task, a voice note, a pasted import) is never thrown away by the return to Hoy
function sheetBusy(){ return sheet.classList.contains('on') && [...sheet.querySelectorAll('input:not([type=date]):not([type=time]):not([readonly]),textarea:not([readonly])')].some(i=>i.value.trim() && i.value!==i.defaultValue); }

/* Another tab or window of the app wrote the data: reload it, so this one never saves a stale copy over those changes.
   The stored values are copied onto the records this window already holds, so an open sheet or a detail being typed in
   keeps working on live data. While something is being typed or picked nothing is redrawn: that waits until it ends (flushStale). */
let reloadLoggedAt=0;
function adoptList(cur, next){ const m=new Map(); cur.forEach(o=>{ if(o&&o.id!=null) m.set(o.id,o); });
  const out=next.map(n=>{ const o=n&&n.id!=null?m.get(n.id):null; if(!o) return n; m.delete(n.id); Object.keys(o).forEach(k=>{ if(!(k in n)) delete o[k]; }); return Object.assign(o,n); });
  cur.length=0; out.forEach(o=>cur.push(o)); }
// The desktop add bar and search keep their focus and caret across a redraw (renderDesktop); any other field or open sheet would lose it
const holdRedraw=()=>{ const ae=document.activeElement||{}; return sheet.classList.contains('on')||asheet.classList.contains('on')||menuOpen()||(/^(INPUT|TEXTAREA)$/.test(ae.tagName||'') && !(UI.wide && /^(addbar|search)$/.test((ae.dataset&&ae.dataset.role)||''))); };
function flushStale(){ if(!staleView || holdRedraw()) return; if(app.classList.contains('navigating')){ setTimeout(flushStale, 400); return; } render(); } // a screen sliding in is drawn after its slide
function reloadFromStorage(src){ // src 'sync': the data came from the server (block 8), which logs it on its own
  const keep={activeSpace:DB.settings.activeSpace, filter:DB.settings.filter}; // what this window is showing stays put
  const ep=editPatch, f=load();
  Object.keys(f).forEach(k=>{ const a=DB[k], b=f[k];
    if(Array.isArray(a)&&Array.isArray(b)) adoptList(a,b);
    else if(k==='settings'&&a&&typeof a==='object'){ Object.keys(a).forEach(j=>{ if(!(j in b)) delete a[j]; }); Object.assign(a,b); }
    else DB[k]=b; });
  applyTheme(); dataVer++; // screens drawn before this show stale data
  // Typing still waiting for its save is put back and saved as planned. Not saved here: a second write from the other window
  // may already be on its way, and this one would cover it
  if(ep){ const rec=ep.step?stepRec(ep.id):ep.note?noteRec(ep.id):task(ep.id); if(rec) Object.assign(rec, ep.patch); else { clearTimeout(editSaveT); editSaveT=null; editPatch=null; } } // a step's title too (decision 46), and a project note (decision 47)
  if(DB.spaces.some(sp=>sp.id===keep.activeSpace)) DB.settings.activeSpace=keep.activeSpace;
  else if(DB.spaces.length&&!DB.spaces.some(sp=>sp.id===DB.settings.activeSpace)){ DB.settings.activeSpace=DB.spaces.slice().sort((a,b)=>a.order-b.order)[0].id; resetListState(); } // decision 28a: the space on screen was deleted elsewhere
  DB.settings.filter=keep.filter;
  const n=UI.stack.length;
  UI.stack=UI.stack.filter(s=>{ const ok=s.kind==='detail'?!!task(s.id):s.kind==='note'?!!noteRec(s.id):(s.id==='none'||!!proj(s.id)); if(!ok) s.el.remove(); return ok; });
  if(UI.select) UI.select.ids.forEach(id=>{ if(!task(id)) UI.select.ids.delete(id); });
  if(UI.projFilter && UI.projFilter!=='none' && !proj(UI.projFilter)) UI.projFilter=null;
  if(src!=='sync' && Date.now()-reloadLoggedAt>6e4){ reloadLoggedAt=Date.now(); log('info','Datos recargados: otra ventana los ha cambiado'); }
  // A screen whose task or project the other window removed goes at once; otherwise an open sheet and a focused field are kept
  if(UI.stack.length===n && !(UI.wide&&UI.deskDetail&&!task(UI.deskDetail)) && holdRedraw()){ staleView=true; return; }
  render();
}
document.addEventListener('focusout', ()=>{ if(staleView) setTimeout(flushStale, 300); }); // after the click that took the focus, which usually redraws anyway
function reloadIfChanged(){ let raw; try{ raw=localStorage.getItem(KEY); }catch(e){ return; } if(raw!==lastRaw) reloadFromStorage(); }
window.addEventListener('storage', e=>{
  if(e.key===LOGKEY){ try{ const l=JSON.parse(e.newValue||'[]'); if(Array.isArray(l)) LOG=l; }catch(err){} return; }
  if(e.key===KEY || e.key===null) reloadIfChanged();
});
window.addEventListener('pageshow', e=>{ if(e.persisted) reloadIfChanged(); });
