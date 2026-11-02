'use strict';
/* Tareas. Desktop input: time picker (decision 32), add composer (decision 31), dropped cards, desktop events and keys.
   A classic script: index.html loads every file of js/ in order and they share their global names. Only declarations and
   listeners run at load; the start itself (first screen, timers, sync, service worker) is in boot.js, the last file. */
/* ---------- Decision 32: the desktop time picker (the iPhone keeps the native wheel) ----------
   A field that takes 9, 930, 9:30 or 21.15; under it, a list of half hours from 7:00 to 22:00 scrolled to the chosen time (or the
   current one, marked); chips for the usual hours. The arrows add or take 15 minutes; Intro keeps the time typed and calls onEnter */
var TP_CHIPS=['09:00','12:00','15:00','18:00']; // a var, as when the first render ran before this line in the single script; now boot.js draws it after every file is loaded
function hmOk(h, m){ return h>=0&&h<=23&&m>=0&&m<=59 ? {h, m} : null; }
function hmStr(o){ return String(o.h).padStart(2,'0')+':'+String(o.m).padStart(2,'0'); } // 09:30, as stored and compared
function hmShow(o){ return o.h+':'+String(o.m).padStart(2,'0'); } // 9:30, as shown
function parseHM(s){ s=String(s||'').trim().toLowerCase().replace(/\s*h(oras?)?$/,''); let m;
  if((m=s.match(/^(\d{1,2})$/))) return hmOk(+m[1], 0);
  if((m=s.match(/^(\d{1,2})\s*[:.,h ]\s*(\d{2})$/))) return hmOk(+m[1], +m[2]);
  if((m=s.match(/^(\d{1,2})(\d{2})$/))) return hmOk(+m[1], +m[2]);
  return null; }
function timePickHTML(v){ const o=parseHM(v)||{h:9, m:0}, now=new Date(), nm=Math.floor((now.getHours()*60+now.getMinutes())/30)*30, opts=[];
  for(let t=7*60; t<=22*60; t+=30) opts.push({h:Math.floor(t/60), m:t%60, now:t===nm});
  return '<div class="tpk"><div class="tpk-row"><span class="tpk-lbl">Hora</span><div class="tpk-field"><input class="tpk-in" type="text" inputmode="numeric" value="'+hmShow(o)+'" data-v="'+hmStr(o)+'" aria-label="Hora" autocomplete="off" spellcheck="false">'+
    '<button class="tpk-open" type="button" aria-label="Ver las horas" aria-expanded="false" title="Ver las horas">'+I.chevD+'</button></div></div>'+
    '<div class="tpk-list" role="listbox" aria-label="Horas" hidden>'+opts.map(x=>'<button type="button" role="option" class="tpk-o'+(x.now?' now':'')+'" data-tv="'+hmStr(x)+'"'+(x.now?' title="Ahora"':'')+'>'+hmShow(x)+'</button>').join('')+'</div>'+
    '<div class="tpk-chips">'+TP_CHIPS.map(c=>'<button type="button" class="chip" data-tq="'+c+'">'+hmShow(parseHM(c))+'</button>').join('')+'</div></div>'; }
// Returns {value(): {h, m}}; onChange runs on every valid change, onEnter on Intro
function bindTimePick(root, o){ o=o||{}; const box=$('.tpk', root); if(!box) return null; const inp=$('.tpk-in', box), list=$('.tpk-list', box), open=$('.tpk-open', box);
  const val=()=>parseHM(inp.dataset.v)||{h:9, m:0};
  const paint=()=>{ const v=inp.dataset.v; list.querySelectorAll('.tpk-o').forEach(b=>{ const on=b.dataset.tv===v; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)); });
    box.querySelectorAll('[data-tq]').forEach(b=>b.classList.toggle('on', b.dataset.tq===v)); };
  const set=(x, typing)=>{ inp.dataset.v=hmStr(x); if(!typing) inp.value=hmShow(x); box.classList.remove('bad'); paint(); if(!list.hidden) reveal(); if(o.onChange) o.onChange(x); };
  // The chosen half hour, or the nearest to it, in the middle of the list
  const reveal=()=>{ const x=val(), mm=x.h*60+x.m; let best=null, bd=1e9; list.querySelectorAll('.tpk-o').forEach(b=>{ const y=parseHM(b.dataset.tv), d=Math.abs(y.h*60+y.m-mm); if(d<bd){ bd=d; best=b; } });
    const t=list.querySelector('.tpk-o.on')||(o.fresh&&list.querySelector('.tpk-o.now'))||best; if(t) list.scrollTop=Math.max(0, t.offsetTop-list.clientHeight/2+t.offsetHeight/2); };
  // A popover that grew with the list is placed again, so it stays inside the window
  const show=on=>{ list.hidden=!on; open.setAttribute('aria-expanded', String(on)); box.classList.toggle('open', on); const L=PM&&PM.mac&&PM.levels[PM.levels.length-1]; if(L&&L.el.contains(box)) macPlace(L); if(on) reveal(); };
  paint();
  inp.addEventListener('input', ()=>{ const x=parseHM(inp.value); if(x) set(x, true); else box.classList.toggle('bad', !!inp.value.trim()); });
  inp.addEventListener('blur', ()=>{ inp.value=hmShow(val()); box.classList.remove('bad'); });
  inp.addEventListener('mousedown', ()=>{ if(list.hidden) setTimeout(()=>show(true), 0); });
  inp.addEventListener('keydown', e=>{
    if(e.key==='ArrowUp'||e.key==='ArrowDown'){ e.preventDefault(); const x=val(), t=(x.h*60+x.m+(e.key==='ArrowUp'?15:-15)+1440)%1440; set({h:Math.floor(t/60), m:t%60}); inp.select(); return; }
    if(e.key==='Enter'&&!e.isComposing){ e.preventDefault(); const x=parseHM(inp.value); if(!x&&inp.value.trim()){ box.classList.add('bad'); haptic(10); return; } if(x) set(x); show(false); if(o.onEnter) o.onEnter(val()); } });
  box.addEventListener('click', e=>{ const b=e.target.closest('[data-tv],[data-tq],.tpk-open'); if(!b) return; e.stopPropagation();
    if(b.classList.contains('tpk-open')){ show(list.hidden); inp.focus(); return; }
    set(parseHM(b.dataset.tv||b.dataset.tq)); if(b.dataset.tv) show(false); inp.focus(); });
  return {value:val, input:inp}; }

/* ---------- Decision 31: the desktop add bar opens into a composer ----------
   Once something is typed, a panel unfolds under the bar (over the list, so nothing below moves): Notas, and buttons for Fecha, Proyecto,
   Prioridad, Recordatorio and Nota de voz (dictated with the computer's microphone where the browser can, otherwise written). The words of
   the title (mañana, #proyecto, !!, a las 9) still count and show on the buttons; a button chosen by hand takes that word out of the title.
   Intro in the title or the notes adds everything (Mayúsculas e Intro is a new line in the notes); then the bar stays open and empty with
   the date and project chosen by hand, for the next one. Esc folds it, asking first when there is something written (decision 28) */
// AX: the composer's state, set up with UI (the first render reads it)
function axHasText(){ return !!((UI.addDraft||'').trim()||AX.notes.trim()||AX.voice.trim()); }
// The values chosen by hand over the view's own (deskAddBase); the title's words go over both (quickTask)
function addxBase(projectId){ const b=deskAddBase(projectId); return {date:AX.date!==undefined?AX.date:b.date, projectId:AX.projectId!==undefined?AX.projectId:b.projectId, priority:AX.priority||b.priority}; }
function addxTask(text, projectId){ const r=quickTask(text, addxBase(projectId));
  if(!r.q.time&&AX.time){ r.reminder=quickReminder(AX.time, r.date); if(r.reminder&&!r.date) r.date=localDay(r.reminder); r.lateManual=!r.reminder; }
  return r; }
function axBtnsHTML(r){ const p=r.projectId&&proj(r.projectId), pr=r.priority, b=(k, ic, l, on, cls, tip)=>'<button class="axbt'+(on?' on':'')+(cls?' '+cls:'')+'" data-ax="'+k+'" title="'+tip+'" aria-haspopup="'+(k==='voice'?'false':'dialog')+'">'+ic+'<span>'+esc(l)+'</span></button>';
  return b('date', I.cal, r.date?fmtDate(r.date):'Fecha', !!r.date, '', 'Fecha')+
    b('proj', p?'<span class="pm-dot" style="background:'+p.color+'"></span>':I.folder, p?p.name:'Proyecto', !!p, '', 'Proyecto')+
    b('pri', I.flag, pr==='high'?'Alta':pr==='mid'?'Media':'Prioridad', pr!=='none', pr==='high'?'high':pr==='mid'?'mid':'', 'Prioridad')+
    b('rem', I.bell, r.reminder?(r.date&&localDay(r.reminder)===r.date?fmtTime(r.reminder):fmtDateTime(r.reminder)):'Recordatorio', !!r.reminder, '', 'Recordatorio')+
    b('voice', I.mic, AX.rec?'Escuchando':'Nota de voz', !!(AX.rec||AX.voice.trim()), AX.rec?'rec':'', AX.rec?'Parar el dictado':'Nota de voz'); }
function addxPanelHTML(projectId){ const r=addxTask(UI.addDraft||'', projectId);
  return '<div class="axp" role="group" aria-label="Detalles de la nueva tarea"><textarea class="axn" data-role="addnotes" rows="1" placeholder="Notas">'+esc(AX.notes)+'</textarea>'+
    (AX.voiceOn||AX.voice?'<div class="axv">'+I.mic+'<textarea class="axvt" data-role="addvoice" rows="1" placeholder="'+(AX.rec?'Escuchando. Habla y se escribirá aquí':'Nota de voz')+'">'+esc(AX.voice)+'</textarea><button class="axx" data-ax="voiceClear" aria-label="Quitar la nota de voz" title="Quitar la nota de voz">'+XICON+'</button></div>':'')+
    '<div class="axb"><span class="axbs">'+axBtnsHTML(r)+'</span><span class="grow"></span><button class="axadd" data-ax="add"'+(r.title?'':' disabled')+'>Añadir</button></div><div class="addhint" id="deskSaid"></div></div>'; }
function axBar(){ return $('#desk [data-role=addbar]'); }
function axFocus(){ const n=axBar(); if(n){ n.focus({preventScroll:true}); const l=n.value.length; n.setSelectionRange(l,l); } }
// The written word of that kind leaves the title: the button chosen by hand says it now
function axStrip(kind){ const ab=axBar(); if(!ab) return; const q=parseQuick(ab.value), ts=q.tokens.filter(t=>t.kind===kind); if(!ts.length) return;
  let v=ab.value; ts.slice().reverse().forEach(t=>{ v=v.slice(0,t.start)+v.slice(t.end); }); v=v.replace(/\s{2,}/g,' ').trim(); ab.value=v; UI.addDraft=v; }
function axOpen(){ if(AX.open) return; AX.open=true; AX.opened=true; log('info','Alta ampliada abierta'); render(); }
// Folds the composer (with a short fade and lift) and forgets everything it held
function axCollapse(){ axStopVoice(); const p=$('#desk .axp'); const done=()=>{ Object.assign(AX, {open:false, notes:'', voice:'', voiceOn:false, date:undefined, projectId:undefined, priority:undefined, time:null}); UI.addDraft=''; const ab=axBar(); if(ab) ab.value=''; render(); };
  if(p&&p.animate&&!RM.matches){ try{ const a=p.animate([{opacity:1, transform:'none'},{opacity:0, transform:'translate3d(0,-6px,0)'}], {duration:140, easing:'ease-in', fill:'forwards'}); a.onfinish=done; return; }catch(e){} }
  done(); }
function axEscape(){ if(!axHasText()){ axCollapse(); const ab=axBar(); if(ab) ab.blur(); return; }
  macAlert({title:'La tarea no se ha añadido.', text:'Lo escrito se perderá.', ok:'Descartar tarea', cancel:'Seguir editando', fn:()=>{ log('info','Alta ampliada descartada con texto'); axCollapse(); }}); }
function axSubmit(projectId){ const ab=axBar(), r=addxTask(ab?ab.value:UI.addDraft||'', projectId); if(!r.title){ axFocus(); return false; }
  const x=addTask({title:r.title, date:r.date, projectId:r.projectId, priority:r.priority, reminder:r.reminder, notes:AX.notes.replace(/\s+$/,'')});
  axStopVoice(); const v=AX.voice.trim(); if(v){ DB.voiceNotes.push({id:uid(), taskId:x.id, text:v, created:new Date().toISOString()}); save(); }
  log('info','Tarea añadida desde el alta ampliada', {notas:!!x.notes, voz:!!v, recordatorio:!!x.reminder});
  // Ready for the next one: the date and project chosen by hand stay, the rest starts again
  Object.assign(AX, {notes:'', voice:'', voiceOn:false, priority:undefined, time:null}); UI.addDraft=''; if(ab) ab.value=''; document.querySelectorAll('#desk .axp textarea').forEach(t=>{ t.value=''; }); // a merge keeps a typed field's value
  haptic(6); renderAnimated(); toast('Añadida: '+x.title); axFocus(); if(x.reminder) pushOfferSoon(); return true; }
// Dictation: the browser's recognizer where it exists (Chrome, Edge, Safari); otherwise the field to write it
function axVoice(){ if(AX.rec){ axStopVoice(); render(); return; } AX.voiceOn=true;
  const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
  if(!SR){ render(); const t=$('#desk [data-role=addvoice]'); if(t) t.focus(); return; }
  let r; try{ r=new SR(); }catch(e){ render(); return; } const base=AX.voice.trim()?AX.voice.trim()+' ':''; let final='';
  r.lang='es-ES'; r.continuous=true; r.interimResults=true;
  r.onresult=ev=>{ if(AX.rec!==r) return; let interim=''; for(let i=ev.resultIndex;i<ev.results.length;i++){ const x=ev.results[i]; if(x.isFinal) final+=x[0].transcript+' '; else interim+=x[0].transcript; }
    AX.voice=(base+final+interim).trim(); const t=$('#desk [data-role=addvoice]'); if(t&&t.value!==AX.voice){ t.value=AX.voice; axFit(t); } };
  r.onerror=e=>{ if(AX.rec!==r) return; const er=e&&e.error; if(er==='no-speech') return; log('warn','Dictado de la nota de voz: '+er);
    axStopVoice(); render(); toast(er==='not-allowed'||er==='service-not-allowed'?'Sin permiso para el micrófono. Escribe la nota.':'Dictado no disponible. Escribe la nota.'); const t=$('#desk [data-role=addvoice]'); if(t) t.focus(); };
  r.onend=()=>{ if(AX.rec===r){ try{ r.start(); }catch(e){ axStopVoice(); render(); } } }; // continuous: the engine stops on its own after a silence
  try{ r.start(); AX.rec=r; log('info','Dictado de nota de voz iniciado'); }catch(e){ log('warn','Dictado no disponible: '+(e&&e.message||e)); }
  render(); }
function axStopVoice(){ const r=AX.rec; if(!r) return; AX.rec=null; try{ r.stop(); }catch(e){} }
function axFit(t){ t.style.height='auto'; t.style.height=Math.min(t.scrollHeight+2, 160)+'px'; }
// The buttons follow what is typed in the title, without a redraw
function axPaint(r){ const bs=$('#desk .axbs'); if(bs){ const h=axBtnsHTML(r); if(bs._h!==h){ bs.innerHTML=h; bs._h=h; } } const ad=$('#desk .axadd'); if(ad) ad.disabled=!r.title; }
function axPick(kind, src, projectId){ const r=addxTask((axBar()||{}).value||'', projectId), back=()=>setTimeout(axFocus, 0), redo=()=>{ render(); back(); };
  const at={anchor:src, align:'left', onClose:back};
  if(kind==='proj'){ const dot=c=>'<span class="pm-dot" style="background:'+c+'"></span>', set=v=>{ AX.projectId=v; axStrip('proj'); redo(); };
    popMenu(Object.assign(at, {groups:[[{label:'Ninguno', icon:dot('var(--ink3)'), on:!r.projectId, fn:()=>set(null)}].concat(activeProjects().map(p=>({label:p.name, icon:dot(p.color), on:r.projectId===p.id, fn:()=>set(p.id)})))]})); return; }
  if(kind==='pri'){ const set=v=>{ AX.priority=v; axStrip('pri'); redo(); };
    popMenu(Object.assign(at, {groups:[[['high','Alta',MI.p3,'1'],['mid','Media',MI.p2,'2'],['none','Ninguna',MI.p0,'0']].map(([k,l,ic,key])=>({label:l, icon:ic, key, on:r.priority===k, fn:()=>set(k)}))]})); return; }
  if(kind==='date'){ const t=todayStr(), dow=new Date(t+'T00:00:00').getDay(), chips=[[t,'Hoy'],[addDays(t,1),'Mañana']]; if(dow>=1&&dow<=4) chips.push([nextWeekday(5,true),'Este viernes']); chips.push([nextWeekday(1,true),'Próxima semana'],['','Sin fecha']);
    let ym=(r.date||t).slice(0,7);
    popMenu(Object.assign(at, {html:'<div class="chips" style="margin-top:0">'+uniqueBy(chips, c=>c[0]).map(c=>'<button class="chip'+((r.date||'')===c[0]?' on':'')+'" data-d="'+c[0]+'">'+c[1]+'</button>').join('')+'</div><div id="calwrap">'+calendarHTML(ym, r.date)+'</div>', bind:el=>{
      el.onclick=e=>{ const nav=e.target.closest('[data-cal]'); if(nav){ ym=shiftMonth(ym,+nav.dataset.cal); $('#calwrap',el).innerHTML=calendarHTML(ym, r.date); return; }
        const c=e.target.closest('[data-d]'); if(!c||ghostClick(e)) return; AX.date=c.dataset.d||null; axStrip('date'); closeMenu(false, true); redo(); }; }})); return; }
  if(kind==='rem'){ const cur=r.reminder?new Date(r.reminder):null, v=cur?hmStr({h:cur.getHours(), m:cur.getMinutes()}):'09:00';
    popMenu(Object.assign(at, {html:'<div class="axrem-day">'+(r.date?'Día de la tarea: '+fmtDate(r.date).toLowerCase():'Sin fecha: hoy, o mañana si esa hora ya ha pasado')+'</div>'+timePickHTML(v)+'<div class="sheet-actions">'+(r.reminder?'<button class="btn" data-x="clear">Quitar</button>':'')+'<span style="flex:1"></span><button class="btn primary" data-x="ok">Guardar</button></div>', bind:el=>{
      const ok=x=>{ const rem=quickReminder(x, r.date); if(!rem){ let w=$('.hint.warn',el); if(!w){ w=document.createElement('div'); w.className='hint warn'; $('.tpk',el).after(w); } w.textContent='Esa hora ya ha pasado'; haptic(10); return; }
        AX.time=x; axStrip('time'); closeMenu(false, true); redo(); };
      const tp=bindTimePick(el, {fresh:!cur, onEnter:ok, onChange:()=>{ const w=$('.hint.warn',el); if(w) w.remove(); }});
      el.onclick=e=>{ const b=e.target.closest('[data-x]'); if(!b) return; if(b.dataset.x==='clear'){ AX.time=null; axStrip('time'); closeMenu(false, true); redo(); return; } ok(tp.value()); };
      setTimeout(()=>{ tp.input.focus(); tp.input.select(); }, 0); }})); return; } }
// Once per desktop element (bindDeskEvents): clicks, typing and keys of the composer
function axBind(d){
  d.addEventListener('click', e=>{ const b=e.target.closest('.axp [data-ax]'); if(!b) return; e.stopPropagation(); const k=b.dataset.ax, pid=(axBar()||{dataset:{}}).dataset.project||null;
    if(k==='add'){ axSubmit(pid); return; }
    if(k==='voice'){ axVoice(); return; }
    if(k==='voiceClear'){ axStopVoice(); AX.voice=''; AX.voiceOn=false; render(); axFocus(); return; }
    axPick(k, b, pid); }, true);
  d.addEventListener('input', e=>{ const t=e.target, role=t.dataset&&t.dataset.role; if(role==='addnotes'){ AX.notes=t.value; axFit(t); } else if(role==='addvoice'){ if(AX.rec){ axStopVoice(); render(); } AX.voice=t.value; axFit(t); } });
  d.addEventListener('keydown', e=>{ const t=e.target, role=t.dataset&&t.dataset.role; if(!/^(addbar|addnotes|addvoice)$/.test(role||'')||e.isComposing) return;
    if(e.key==='Escape'&&AX.open){ e.preventDefault(); e.stopPropagation(); axEscape(); return; }
    if(e.key==='Enter'&&!e.shiftKey&&role!=='addbar'&&!UI.addPaste){ e.preventDefault(); e.stopPropagation(); axSubmit(axBar()&&axBar().dataset.project||null); } }, true);
  // Leaving it empty folds it; with something written it waits, as a draft
  d.addEventListener('focusout', ()=>{ setTimeout(()=>{ if(!AX.open||deskRedraw||menuOpen()||alertOn()) return; const x=$('#desk .addx'), ae=document.activeElement; if(x&&ae&&x.contains(ae)) return;
    if(!axHasText()&&!AX.rec) axCollapse(); }, 120); }); }
// A dropped card: a slot sets the date and a reminder at that time; "Todo el día" keeps the date and drops the time; a day or the mini month
// set the date and take a reminder on the old day along (decision 25, dayPatch); "Sin fecha" clears the date. All with Deshacer
function dropTask(id, z){ const x=task(id); if(!x) return; const old={date:x.date, carried:x.carried, reminder:x.reminder}; let patch, msg;
  if(z.dataset.slot){ const [day,hm]=z.dataset.slot.split('T'); const dt=new Date(day+'T'+hm+':00'), iso=dt.toISOString();
    if(x.date===day&&x.reminder&&new Date(x.reminder).getTime()===dt.getTime()){ render(); return; }
    patch={date:day, reminder:iso}; msg=(x.date===day?'A las ':'Movida a '+fmtDate(day).toLowerCase()+' a las ')+fmtTime(iso); }
  else if(z.dataset.allday){ const day=z.dataset.day, timed=remMin(x)!==null; if(x.date===day&&!timed){ render(); return; }
    patch=timed?{date:day, reminder:null}:dayPatch(x, day); msg=x.date===day?'Sin hora':'Movida a '+fmtDate(day).toLowerCase()+(timed?', sin hora':''); }
  else { const day=z.dataset.day||null; if(x.date===day){ render(); return; } patch=dayPatch(x, day); msg=day?'Movida a '+fmtDate(day).toLowerCase():'Sin fecha'; }
  releaseHold(id); updTask(id, patch); haptic(6); renderAnimated(); log('info','Tarea movida en el calendario', {date:patch.date, time:!!patch.reminder});
  toast(msg, ()=>updTask(id, old)); }
function bindDeskEvents(d){
  attBindDrop(d);
  axBind(d); // decision 31: the add bar's composer // decision 29: photos dragged from the computer onto the inspector
  // Right click opens the row menu, and on a sidebar project the project menu (the iPhone long press)
  // R17: each one opens at the pointer, as a Mac context menu; text fields keep the browser's own
  d.addEventListener('contextmenu', e=>{ if(e.target.closest('input,textarea')) return; const pt={x:e.clientX, y:e.clientY};
    const nt=e.target.closest('[data-pn]'); if(nt){ e.preventDefault(); noteMenu(nt.dataset.pn, pt); return; } // decision 47: a note of the list or of a search
    const pj=e.target.closest('.side [data-view^="project:"]'); if(pj){ e.preventDefault(); if(pj.dataset.view!=='project:none') projectMenu(pj.dataset.view.slice(8), pt); return; }
    const dh=e.target.closest('[data-day-head]'); if(dh){ e.preventDefault(); dayHeadMenu(dh, pt); return; } // R14: a day header of Todas
    const ph=e.target.closest('.att-ph[data-att]'); if(ph){ e.preventDefault(); photoMenu(ph.dataset.att, e); return; }
    const bk=e.target.closest('.vn[data-bk]'); if(bk){ e.preventDefault(); backupMenu(bk.dataset.bk, pt); return; } // decision 34: a local copy of Ajustes // decision 29: a photo or a recording of the inspector
    const au=e.target.closest('.vn[data-au]'); if(au){ e.preventDefault(); audioMenu(au.dataset.au, e); return; }
    const row=e.target.closest('.row[data-id], .wcard[data-id]'); if(!row) return; e.preventDefault(); rowMenu(row.dataset.id, pt); });
  // R17: the week popover closes on a press anywhere outside it, as a Mac popover; the click itself still acts (another card opens its own).
  // It is taken away at once, without a redraw, so the click lands on what was under the pointer
  d.addEventListener('mousedown', e=>{ const pn=d.querySelector('.pane.wpop'); if(!pn||pn.contains(e.target)) return; flushEdits(); d._popShut={id:pn.dataset.task, t:Date.now()}; pn.remove(); UI.deskDetail=null; d.querySelectorAll('.wcard.popped').forEach(c=>c.classList.remove('popped')); }, true);
  // R17: the inspector's left edge resizes it, between 320 and 600 px; the width is kept in the settings
  d.addEventListener('pointerdown', e=>{ const g=e.target.closest('.igrip'); if(!g||e.button!==0) return; e.preventDefault(); const pn=g.closest('.pane'); let w=pn.offsetWidth; const x0=e.clientX, w0=w;
    try{ g.setPointerCapture(e.pointerId); }catch(err){} document.body.classList.add('resizing');
    const mv=ev=>{ w=paneWidth(w0+(x0-ev.clientX)); d.style.setProperty('--panew', w+'px'); };
    const up=()=>{ g.removeEventListener('pointermove', mv); g.removeEventListener('pointerup', up); g.removeEventListener('pointercancel', up); document.body.classList.remove('resizing');
      if(w!==w0){ DB.settings.paneWidth=w; save(); log('info','Ancho del panel de detalle', {w}); } };
    g.addEventListener('pointermove', mv); g.addEventListener('pointerup', up); g.addEventListener('pointercancel', up); });
  d.addEventListener('dblclick', e=>{ if(!e.target.closest('.igrip')) return; DB.settings.paneWidth=400; save(); d.style.setProperty('--panew', paneWidth(400)+'px'); }); // back to the usual width
  /* The sidebar's projects reorder with a drag up or down. It uses pointer events, not the HTML5 drag of the tasks: a task dropped on a
     project (data-drop-project, R16) keeps its own drag and highlight, and a project drag shows only the line where it will go.
     Sin proyecto and archived projects do not move; near the edges the list scrolls; Esc cancels; Alt and an arrow do it from the keyboard */
  d.addEventListener('pointerdown', e=>{ const it=e.target.closest('.side .it[data-drop-project]'); if(!it||e.button!==0||!it.dataset.dropProject||e.pointerType==='touch') return;
    const side=it.closest('.side'), id=it.dataset.dropProject, y0=e.clientY, pid=e.pointerId; let on=false, to=null, lastY=y0, raf=0, line=null;
    const others=()=>[...side.querySelectorAll('.it[data-drop-project]')].filter(r=>r.dataset.dropProject&&r!==it);
    const place=()=>{ const os=others(); let k=os.findIndex(r=>{ const b=r.getBoundingClientRect(); return lastY<b.top+b.height/2; }); if(k<0) k=os.length; to=k;
      const sb=side.getBoundingClientRect(), y=k<os.length?os[k].getBoundingClientRect().top:(os.length?os[os.length-1].getBoundingClientRect().bottom:it.getBoundingClientRect().top);
      line.style.left=(sb.left+10)+'px'; line.style.width=(sb.width-20)+'px'; line.style.transform='translate3d(0,'+Math.round(Math.max(sb.top, Math.min(sb.bottom, y))-1)+'px,0)'; };
    const tick=()=>{ if(!on) return; const sb=side.getBoundingClientRect(), edge=36; let v=0; if(lastY<sb.top+edge) v=-Math.ceil((sb.top+edge-lastY)/4); else if(lastY>sb.bottom-edge) v=Math.ceil((lastY-sb.bottom+edge)/4);
      if(v){ side.scrollTop+=v; place(); } raf=requestAnimationFrame(tick); };
    const end=apply=>{ it.removeEventListener('pointermove', mv); it.removeEventListener('pointerup', up); it.removeEventListener('pointercancel', cancel); it.removeEventListener('lostpointercapture', cancel); window.removeEventListener('keydown', esc, true);
      try{ it.releasePointerCapture(pid); }catch(err){} cancelAnimationFrame(raf); const was=on; on=false; if(line) line.remove(); it.classList.remove('pdrag'); document.body.classList.remove('pdragging');
      if(!was) return; const swallow=ev=>{ ev.stopPropagation(); ev.preventDefault(); }; d.addEventListener('click', swallow, true); setTimeout(()=>d.removeEventListener('click', swallow, true), 0); // the click after a drag opens nothing
      if(apply&&to!==null) reorderProject(id, to); };
    const mv=ev=>{ lastY=ev.clientY; if(!on){ if(Math.abs(ev.clientY-y0)<5) return; on=true; it.classList.add('pdrag'); document.body.classList.add('pdragging'); line=document.createElement('div'); line.className='pline'; document.body.appendChild(line); raf=requestAnimationFrame(tick); }
      place(); };
    const up=()=>end(true), cancel=()=>end(false), esc=ev=>{ if(ev.key!=='Escape') return; ev.preventDefault(); ev.stopPropagation(); end(false); };
    try{ it.setPointerCapture(pid); }catch(err){} it.addEventListener('pointermove', mv); it.addEventListener('pointerup', up); it.addEventListener('pointercancel', cancel); it.addEventListener('lostpointercapture', cancel); window.addEventListener('keydown', esc, true); }); // a redraw that replaces the row ends the drag
  d.addEventListener('keydown', e=>{ if(!e.altKey||e.metaKey||e.ctrlKey||e.shiftKey||(e.key!=='ArrowUp'&&e.key!=='ArrowDown')) return; const it=e.target.closest&&e.target.closest('.side .it[data-drop-project]'); if(!it||!it.dataset.dropProject) return;
    e.preventDefault(); const id=it.dataset.dropProject, i=activeProjects().findIndex(p=>p.id===id);
    if(reorderProject(id, i+(e.key==='ArrowUp'?-1:1))){ const n=document.querySelector('#desk .side .it[data-drop-project="'+CSS.escape(id)+'"]'); if(n) n.focus(); } });
  // Calendar (Día, Semana, Mes, the mini month, the agenda of Hoy): drag a card onto a day, a half-hour slot, "Todo el día" or "Sin fecha"
  // Only a card drag moves a task: any other drag (a link, a file) clears dragId, so a cancelled card drag never carries over
  let dragId=null, dropped=false, refusal=null;
  let dragIds=null; // R16: the rows of a multiple selection dragged together
  const zoneOf=t=>t.closest('[data-slot],[data-day],[data-drop-project],[data-gday],[data-gproj],[data-drop-ahora]'); // decision 39: Ahora (its block, its view, its sidebar entry)
  // Decision 36: a day or project group of the lists. Its key; the elements lit with it (a gsec, or the Hoy block's title and rows); the group a drag started in
  const gkey=z=>z?(z.dataset.gday!==undefined?'d:'+z.dataset.gday:z.dataset.gproj!==undefined?'p:'+z.dataset.gproj:null):null;
  const lit=z=>{ const k=gkey(z); if(!k||z.classList.contains('gsec')) return [z]; return [...d.querySelectorAll(k[0]==='d'?'[data-gday="'+CSS.escape(z.dataset.gday)+'"]':'[data-gproj="'+CSS.escape(z.dataset.gproj)+'"]')]; };
  let dragFrom=null;
  // Why a zone takes no drop: a past day (no task is ever overdue) or a past half hour (a reminder must be ahead, as in Recordatorio)
  const refuse=z=>{ if(z.dataset.slot){ const [dy,hm]=z.dataset.slot.split('T'), dt=new Date(dy+'T'+hm+':00'); return dt.getTime()<=Date.now()?(dy<todayStr()?'No se puede mover a un día pasado':'Esa hora ya ha pasado'):null; }
    if(z.dataset.dropProject!==undefined||z.dataset.dropAhora!==undefined) return null;
    if(z.dataset.gday!==undefined) return z.dataset.gday&&z.dataset.gday<todayStr()?'No se puede mover a un día pasado':null;
    return z.dataset.day&&z.dataset.day<todayStr()?'No se puede mover a un día pasado':null; };
  d.addEventListener('dragstart', e=>{ const c=e.target.closest&&e.target.closest('[draggable="true"][data-id]'); dragId=c?c.dataset.id:null; dragIds=null; dropped=false; refusal=null; if(!c) return; dragFrom=gkey(c.closest('[data-gday],[data-gproj]')); c.classList.add('dragging'); try{ e.dataTransfer.setData('text/plain', dragId); e.dataTransfer.effectAllowed='move'; }catch(err){}
    // R16: a row of the multiple selection takes the whole selection along, under a badge with how many
    if(c.classList.contains('row')&&deskMulti()&&UI.dsel.ids.has(dragId)&&UI.dsel.ids.size>1){ dragIds=[...UI.dsel.ids]; dragIds.forEach(id=>{ const r=deskRow(id); if(r) r.classList.add('dragging'); });
      const g=document.createElement('div'); g.className='dragcount'; g.textContent=bulkN(dragIds.length); document.body.appendChild(g); try{ e.dataTransfer.setDragImage(g, 14, 14); }catch(err){} setTimeout(()=>g.remove(), 0); } });
  d.addEventListener('dragend', e=>{ const id=dragId; dragId=null; dragIds=null; d.querySelectorAll('.dragging').forEach(x=>x.classList.remove('dragging')); d.querySelectorAll('.over').forEach(x=>x.classList.remove('over'));
    if(id&&!dropped&&refusal){ toast(refusal); haptic(10); } refusal=null; }); // let go over a past day: said, not silently ignored
  d.addEventListener('dragover', e=>{ if(!dragId) return; const z=zoneOf(e.target); refusal=z?refuse(z):null; const same=!!z&&!!dragFrom&&gkey(z)===dragFrom; // its own group: nothing to do there
    if(!z||refusal||same){ d.querySelectorAll('.over').forEach(x=>x.classList.remove('over')); return; }
    e.preventDefault(); e.dataTransfer.dropEffect='move'; const L=lit(z); d.querySelectorAll('.over').forEach(x=>{ if(!L.includes(x)) x.classList.remove('over'); }); L.forEach(x=>x.classList.add('over')); });
  d.addEventListener('dragleave', e=>{ const z=zoneOf(e.target); if(z && !lit(z).some(x=>x.contains(e.relatedTarget))) lit(z).forEach(x=>x.classList.remove('over')); });
  d.addEventListener('drop', e=>{ const z=zoneOf(e.target); if(!z||!dragId||e.dataTransfer.getData('text/plain')!==dragId||refuse(z)||(dragFrom&&gkey(z)===dragFrom)) return; e.preventDefault(); dropped=true; const id=dragId, ids=dragIds||[id]; dragId=null; dragIds=null;
    if(z.dataset.dropAhora!==undefined){ addToAhora(ids); return; } // decision 39
    if(z.dataset.gday!==undefined){ dropToDay(ids, z.dataset.gday||null); return; } // decision 36: a day group of a list, or Sin fecha
    if(z.dataset.gproj!==undefined){ dropToProject(ids, z.dataset.gproj==='none'?null:z.dataset.gproj); return; } // a project group
    if(z.dataset.dropProject!==undefined) dropToProject(ids, z.dataset.dropProject||null); else dropMany(ids, z); }); // R16: a project of the sidebar, or a date
  // R15: the title edited in place (a double click, see deskRowClick) keeps what is typed across a redraw and keeps it when left
  d.addEventListener('input', e=>{ if(e.target.dataset.role==='rowedit'&&UI.dsel.edit) UI.dsel.edit.text=e.target.value; });
  d.addEventListener('focusout', e=>{ if(e.target.dataset.role!=='rowedit'||deskRedraw) return; setTimeout(()=>{ const a=document.activeElement; if(UI.dsel.edit&&!(a&&a.dataset&&a.dataset.role==='rowedit')) endRowEdit(true); }, 0); });
  // The Tab key onto a row selects it (a click selects it on its own)
  d.addEventListener('focusin', e=>{ const r=e.target; if(!r.classList||!r.classList.contains('row')||r.closest('.first')||deskMulti()||UI.dsel.cur===r.dataset.id||!r.matches(':focus-visible')) return; UI.dsel.cur=r.dataset.id; if(UI.deskDetail){ UI.deskDetail=r.dataset.id; deskSelPane(); } else paintSel(); });
  // Double click on an empty part of a month day adds a task with that date (a past day cannot take one)
  d.addEventListener('dblclick', e=>{ const md=e.target.closest('.mday'); if(!md||e.target.closest('.wcard,button')) return; const day=md.dataset.day;
    if(day<todayStr()){ toast('No se puede añadir a un día pasado'); return; } addSheet(null,'',{date:day}); });
  // Week cards open the detail on click
  // R17: in a popover beside the card; a click on the card whose popover that same press closed leaves it closed (a toggle)
  d.addEventListener('click', e=>{ const sh=d._popShut; d._popShut=null; const c=e.target.closest('.wcard'); if(!c||e.target.closest('[data-act]')) return;
    if(sh&&sh.id===c.dataset.id&&Date.now()-sh.t<800) return; openDetail(c.dataset.id); });
}
document.addEventListener('keydown', e=>{ if(!UI.wide) return; const tag=(e.target.tagName||'').toLowerCase(); const typing=tag==='input'||tag==='textarea'||tag==='select'||!!e.target.isContentEditable;
  const modal=sheet.classList.contains('on')||asheet.classList.contains('on')||menuOpen();
  // R15: the title edited in its row: Intro keeps it, Esc gives it back
  if(e.target.dataset&&e.target.dataset.role==='rowedit'){ const ed=UI.dsel.edit, id=ed&&ed.id;
    if(e.key==='Enter'&&!e.isComposing){ e.preventDefault(); endRowEdit(true); render(); revealRow(id); }
    else if(e.key==='Escape'){ e.preventDefault(); endRowEdit(false); revealRow(id); } return; }
  if(e.key==='Escape'){ if(menuOpen()){ closeMenu(); return; } if(modal){ if(asheet.classList.contains('on')) cancelAction(); else requestCloseSheet(); return; } // a menu over a sheet closes alone
    if(typing && e.target.dataset.role==='search' && UI.query){ e.preventDefault(); UI.query=''; UI.searchDone=false; render(); return; } // Escape in the search clears it first; render keeps the focus there
    if(deskMulti()||UI.dsel.ids.size){ endSelect(); revealRow(UI.dsel.cur); return; } // R16: the multiple selection goes first
    if(UI.deskDetail){ const f=!typing; pop(); if(f) revealRow(UI.dsel.cur); } else if(UI.query){ UI.query=''; UI.searchDone=false; render(); } return; }
  if(modal||typing) return; // N, / and the keys below never reach the page behind a menu or a sheet, nor a field being typed in
  const k=e.key, mod=e.metaKey||e.ctrlKey;
  if(mod){ if(e.altKey||e.shiftKey) return; // the browser keeps its own (Comando L, T, W, R...); only these two are the app's
    if(k==='z'||k==='Z'){ if(undoFn&&!toastLbl&&$('#toast').classList.contains('on')){ e.preventDefault(); $('#toastBtn').click(); } return; } // R15: the last action's Deshacer
    if((k==='a'||k==='A')&&deskListView()){ e.preventDefault(); selectAllDesk(); } return; }
  if(e.altKey) return;
  // Space and Intro on a focused button or control are that control's own
  if((k===' '||k==='Enter')&&e.target.closest&&e.target.closest('button,a,select,summary,[role=button],[role=radio],.gtap')) return;
  if(k==='n'||k==='N'){ const ab=$('#desk [data-role=addbar]'); if(ab){ e.preventDefault(); ab.focus(); } return; }
  if(k==='/'){ const s=$('#desk [data-role=search]'); if(s){ e.preventDefault(); s.focus(); } return; }
  if(k==='?'){ e.preventDefault(); shortcutsSheet(); return; }
  // R15: the selected row moves with the arrows (J and K too); with Mayúsculas the selection stretches
  if(k==='ArrowDown'||k==='ArrowUp'||(!e.shiftKey&&(k==='j'||k==='k'))){ if(!deskListView()) return; e.preventDefault(); moveSel(k==='ArrowDown'||k==='j'?1:-1, e.shiftKey); return; }
  if(k===' '){ if(!deskListView()&&!UI.deskDetail) return; e.preventDefault(); togglePane(); return; }
  if(k==='Enter'){ const id=UI.dsel.cur; if(id&&deskRow(id)&&!deskMulti()){ e.preventDefault(); startRowEdit(id); } return; }
  if(e.shiftKey&&k.length===1&&!/[A-Z]/.test(k)) return; // a shifted symbol is not one of the keys
  if(/^[chmvsfpa120]$/i.test(k)||k==='Delete'||k==='Backspace'){ if(deskShortcut(k)) e.preventDefault(); } }); // A: Ahora (decision 39)
// A project group header (R13) is a div with the button role: Enter and Space act on it as on a button
document.addEventListener('keydown', e=>{ if((e.key==='Enter'||e.key===' ')&&e.target.classList&&e.target.classList.contains('gtap')){ e.preventDefault(); e.target.click(); } });
