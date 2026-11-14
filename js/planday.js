'use strict';
/* Tareas. Decision 86 (design point 72a): Planificar el día, a short walk in the morning.
   A classic script: index.html loads every file of js/ in order and they share their global names. Only declarations and
   listeners run at load; the start itself (first screen, timers, sync, service worker) is in boot.js, the last file.
   - Entry points: «Planificar el día» in the view menu of Hoy (its three dots), on the iPhone and the desktop, while the day is open; and a
     cell on top of Hoy until 12:00 while it has not been done that day on this device (settings.planDay, the day it was last opened) and
     Hoy or the next days have something to plan. Opening it counts as done: the cell goes away.
   - Steps, in one sheet; each can be passed with Seguir, and a step with nothing to do is left out:
       1. Aplazadas: «Repasar una a una» runs the review of the carried tasks (reviewStart('carried')) and comes back; «Dejarlas para hoy»
          confirms them all for today (the Aplazada mark goes).
       2. Entregas próximas: the pending tasks whose deadline is in the next three days and that are not in Hoy, each with «Hoy».
       3. Carga: the hours of Hoy against the space's working hours (decision 60a). A task without an estimate offers the four values.
          Over the limit, the tasks that can move (pending, not due by their deadline) get a box, and those that are not a priority are
          ticked from the end of the list until the load fits; «Pasar N a mañana» moves the ticked ones (counted as postponed, 56b).
       4. Ahora: the pending tasks of Hoy, from three to five; the ones already in Ahora ticked, and up to three ticked when there are fewer,
          in the order of ¿Qué hago ahora? (decision 56c). Listo puts the ticked ones in Ahora and takes the others out.
   - At the end (or when the sheet is closed) one line, «Día planificado: 4 en Ahora, 5 h 30 de 6 h», with Deshacer for the whole walk.
   - Nothing new is stored but the day of settings.planDay, a setting of this device. */
const PD_NOON_H=12, PD_DL_DAYS=3, PD_AHORA_MIN=3;
const pdMorning = () => new Date().getHours()<PD_NOON_H;
// The pending tasks with a deadline in the next three days that Hoy does not show yet, the nearest first
function pdDeadlines(){ const t=todayStr(), lim=addDays(t, PD_DL_DAYS);
  return orderTasks(spaceTasks().filter(x=>x.status==='pending'&&x.deadline&&x.deadline>t&&x.deadline<=lim&&!inHoy(x))).sort((a,b)=>a.deadline<b.deadline?-1:a.deadline>b.deadline?1:0); }
const pdHoy = () => pendingFor('hoy'); // what Hoy lists (Revisar hoy too), whatever the project filter
const pdPending = () => pdHoy().filter(x=>x.status==='pending');
// The cell on top of Hoy: in the morning, not done today, the day open, something to plan
function pdShown(){ return !isClosed() && DB.settings.planDay!==todayStr() && pdMorning() && (pdHoy().length>0 || pdDeadlines().length>0); }
const PD_STEP={carried:'Aplazadas', dl:'Entregas próximas', load:'Carga de hoy', ahora:'Ahora'};
function planDayStart(){ flushHeld(true); if(isClosed()) return; closeMenu(true);
  const st={prev:new Map(), removed:[], steps:[], i:0, moved:0, sel:null, touched:false, aSel:null};
  if(pdHoy().some(carriedOn)) st.steps.push('carried');
  if(pdDeadlines().length) st.steps.push('dl');
  st.steps.push('load', 'ahora');
  DB.settings.planDay=todayStr(); save(); log('info','Planificar el día', {steps:st.steps.join()}); render();
  pdStep(st); }
// Each task the walk changes, as it was before it (the same shape as the reviews', with the estimate, Ahora and Algún día), for Deshacer
function pdKeep(st, x){ let o=st.prev.get(x.id);
  if(!o){ o={date:x.date, carried:x.carried, reminder:x.reminder||null, status:x.status, completed:x.completed, postponed:x.postponed||null, carriedSince:x.carriedSince||null}; if(x.repeat) o.repeat=x.repeat; st.prev.set(x.id, o); }
  ['estimate','focus','someday'].forEach(k=>{ if(!(k in o)) o[k]=x[k]||null; }); }
function pdEmpty(k){ return k==='carried'?!pdHoy().some(carriedOn) : k==='dl'?!pdDeadlines().length : k==='load'?!pdHoy().length : !pdPending().length; }
function pdStep(st){
  while(st.i<st.steps.length && pdEmpty(st.steps[st.i])) st.i++;
  if(st.i>=st.steps.length){ pdEnd(st, true); return; }
  const k=st.steps[st.i], last=st.steps.slice(st.i+1).every(pdEmpty);
  const head='<h2>Planificar el día</h2><div class="hint pdstep">Paso '+(st.i+1)+' de '+st.steps.length+': '+PD_STEP[k]+'</div>';
  const foot=()=>'<div class="sheet-actions"><button class="btn" data-pd="end">Terminar</button><button class="btn primary" data-pd="next">'+(k==='ahora'?'Listo':last?'Terminar':'Seguir')+'</button></div>';
  const body=()=>k==='carried'?pdCarriedHTML():k==='dl'?pdDlHTML(st):k==='load'?pdLoadHTML(st):pdAhoraHTML(st);
  if(k==='ahora'&&!st.aSel) st.aSel=pdAhoraPick();
  openSheet(head+'<div class="pdbody">'+body()+'</div>'+foot(), s=>{
    sheetOnClose=()=>pdEnd(st, false); // closed with a tap outside or a drag: what was done stays, with its Deshacer
    const redraw=()=>{ $('.pdbody', s).innerHTML=body(); };
    s.onclick=e=>{ const b=e.target.closest('[data-pd]');
      if(b){ const a=b.dataset.pd;
        if(a==='end'){ if(k==='ahora') pdApplyAhora(st); sheetOnClose=null; pdEnd(st, true); }
        else if(a==='next'){ if(k==='ahora'){ pdApplyAhora(st); sheetOnClose=null; pdEnd(st, true); return; } st.i++; pdStep(st); }
        else if(a==='review'){ sheetOnClose=null; reviewStart('carried', {all:true, prev:st.prev, removed:st.removed, after:ok=>{ if(ok){ st.i++; pdStep(st); } else pdEnd(st, false); }}); }
        else if(a==='keep'){ const xs=pdHoy().filter(carriedOn); batch(()=>xs.forEach(x=>{ pdKeep(st, x); updTask(x.id, {carried:false}); })); haptic(6); log('info','Aplazadas confirmadas para hoy', {n:xs.length}); render(); st.i++; pdStep(st); }
        else if(a==='move'){ const tm=addDays(todayStr(),1), xs=[...st.sel].map(task).filter(x=>x&&pdMovable(x)); if(!xs.length) return;
          batch(()=>xs.forEach(x=>{ pdKeep(st, x); releaseHold(x.id); updTask(x.id, dayPatch(x, tm)); })); st.moved+=xs.length; st.sel=null; st.touched=false; haptic(8); log('info','Pasadas a mañana al planificar', {n:xs.length}); render(); redraw(); }
        return; }
      const h=e.target.closest('[data-pdhoy]'); if(h){ const x=task(h.dataset.pdhoy); if(!x) return; const t=todayStr();
        if(x.date===t){ const o=st.prev.get(x.id); if(o) updTask(x.id, {date:o.date, carried:o.carried, reminder:o.reminder, postponed:o.postponed, carriedSince:o.carriedSince, someday:o.someday}); }
        else { pdKeep(st, x); updTask(x.id, dayPatch(x, t)); }
        haptic(6); render(); redraw(); return; }
      const m=e.target.closest('[data-pde]'); if(m){ const x=task(m.dataset.pde); if(!x) return; pdKeep(st, x); updTask(x.id, {estimate:+m.dataset.m}); if(!st.touched) st.sel=null; haptic(4); render(); redraw(); return; }
      const c=e.target.closest('[data-pdsel]'); if(c){ const id=c.dataset.pdsel; if(!st.sel) st.sel=pdLoadPick(); st.touched=true; if(st.sel.has(id)) st.sel.delete(id); else st.sel.add(id); haptic(4); redraw(); return; }
      const a=e.target.closest('[data-pda]'); if(a){ const id=a.dataset.pda; if(st.aSel.has(id)) st.aSel.delete(id); else if(st.aSel.size>=AHORA_MAX){ haptic(10); $('.pdahint', s).classList.add('full'); return; } else st.aSel.add(id); haptic(4); redraw(); return; } }; }); }
const pdMeta = x => { const p=x.projectId?proj(x.projectId):null; return p?esc(p.name):''; };
const pdTitle = (x, meta) => '<span class="pdt"><span class="t">'+esc(x.title||'Sin título')+'</span>'+(meta?'<span class="m">'+meta+'</span>':'')+'</span>';
// 1. The carried tasks
function pdCarriedHTML(){ const xs=pdHoy().filter(carriedOn), n=xs.length;
  return '<div class="pdlead">'+(n===1?'Una tarea viene aplazada de días anteriores.':n+' tareas vienen aplazadas de días anteriores.')+'</div>'+
    '<div class="pdlist">'+xs.map(x=>'<div class="pdi">'+pdTitle(x, [pdMeta(x), dragText(x)?'<span class="drag">'+esc(dragText(x))+'</span>':''].filter(Boolean).join(', '))+'</div>').join('')+'</div>'+
    '<div class="list pdacts"><button class="cell" data-pd="review"><span class="lbl">Repasar una a una</span>'+I.chev.replace('<svg','<svg class="chev"')+'</button><button class="cell" data-pd="keep"><span class="lbl">'+(n===1?'Dejarla para hoy':'Dejarlas todas para hoy')+'</span></button></div>'; }
// 2. The deadlines of the next days
function pdDlHTML(st){ const t=todayStr(); if(!st.dl) st.dl=pdDeadlines().map(x=>x.id); // the list as the step opened: a task put in Hoy stays, to take it back
  return '<div class="pdlead">Entregas de los próximos días que todavía no están en Hoy.</div><div class="pdlist">'+st.dl.map(task).filter(x=>x&&x.status==='pending').map(x=>{ const on=x.date===t, lv=dlLevel(x);
    return '<div class="pdi">'+pdTitle(x, ['<span class="'+(lv?'dl-'+lv:'')+'">'+dlText(x.deadline)+'</span>', pdMeta(x)].filter(Boolean).join(', '))+'<button class="pdhoy'+(on?' on':'')+'" data-pdhoy="'+esc(x.id)+'" aria-pressed="'+on+'">Hoy</button></div>'; }).join('')+'</div>'; }
// 3. The load: what can move to tomorrow, and the ticks proposed when it is over the limit
const pdMovable = x => x.status==='pending' && !dlDue(x);
function pdLoadPick(){ const lim=dayHours()*60, xs=pdHoy(); let m=estSum(xs); const sel=new Set();
  if(m<=lim) return sel;
  for(const x of xs.slice().reverse()){ if(m<=lim) break; if(!pdMovable(x)||x.priority==='high'||!x.estimate) continue; sel.add(x.id); m-=+x.estimate; }
  // then the ones that are not needed after all (a long task ticked later made room for them), so no more moves than it takes
  [...sel].forEach(id=>{ const e=+task(id).estimate; if(m+e<=lim){ sel.delete(id); m+=e; } });
  return sel; }
function pdLoadHTML(st){ const xs=pdHoy(), lim=dayHours()*60, m=estSum(xs), lv=loadLevel(m), over=m>lim; if(!st.sel||!over&&!st.touched) st.sel=over?pdLoadPick():new Set();
  const sel=st.sel, freed=[...sel].reduce((s,id)=>{ const x=task(id); return s+(x&&isOpen(x)?(+x.estimate||0):0); }, 0), none=xs.filter(x=>!x.estimate).length;
  const est=x=>x.estimate?'<span class="pdv">'+estLabel(x.estimate)+'</span>':'';
  const chips=x=>x.estimate?'':'<span class="pdests">'+EST_VALUES.map(v=>'<button class="pde" data-pde="'+esc(x.id)+'" data-m="'+v+'">'+estLabel(v)+'</button>').join('')+'</span>';
  const row=x=>{ const box=over&&pdMovable(x), on=box&&sel.has(x.id);
    return '<div class="pdi'+(on?' on':'')+'">'+(box?'<button class="pdbox" data-pdsel="'+esc(x.id)+'" aria-pressed="'+on+'" aria-label="Pasar a mañana"><span class="rbox">'+I.check+'</span></button>':'')+
      '<span class="pdt"><span class="t">'+esc(x.title||'Sin título')+(x.priority==='high'?' <span class="pri high">!!!</span>':'')+'</span>'+(pdMeta(x)?'<span class="m">'+pdMeta(x)+'</span>':'')+chips(x)+'</span>'+est(x)+'</div>'; };
  return '<div class="pdload'+(lv?' '+lv:'')+'"><b>'+(m?hoursText(m):'0 h')+'</b> de '+dayHours()+' h'+(st.moved?'<span class="pdmoved">'+st.moved+(st.moved===1?' pasada':' pasadas')+' a mañana</span>':'')+'</div>'+
    '<div class="hint pdlhint">'+(over?'Te pasas de tu jornada. Marca lo que puede esperar a mañana.':none?(none===1?'Una tarea no tiene tiempo estimado: pónselo para que cuente.':none+' tareas no tienen tiempo estimado: pónselo para que cuenten.'):'Cabe en tu jornada.')+'</div>'+
    '<div class="pdlist">'+xs.map(row).join('')+'</div>'+
    (over&&sel.size?'<div class="list pdacts"><button class="cell" data-pd="move"><span class="lbl">Pasar '+sel.size+' a mañana</span><span class="val">'+(freed?'−'+hoursText(freed):'')+'</span></button></div>':''); }
// 4. Ahora: those already there, then up to three in the order of ¿Qué hago ahora?
function pdAhoraPick(){ const xs=pdPending(), sel=new Set(xs.filter(x=>x.focus).map(x=>x.id)); if(sel.size>=PD_AHORA_MIN) return sel;
  const pos=new Map(xs.map((x,i)=>[x.id,i]));
  xs.filter(x=>!x.focus).sort((a,b)=>{ const ta=sgTier(a), tb=sgTier(b); if(ta!==tb) return ta-tb; if(ta===2){ const pa=+a.postponed||0, pb=+b.postponed||0; if(pa!==pb) return pb-pa; }
    if(ta===3){ const ea=+a.estimate||1e9, eb=+b.estimate||1e9; if(ea!==eb) return ea-eb; } return pos.get(a.id)-pos.get(b.id); })
    .slice(0, PD_AHORA_MIN-sel.size).forEach(x=>sel.add(x.id));
  return sel; }
function pdAhoraHTML(st){ const xs=pdPending(), sel=st.aSel;
  return '<div class="hint pdahint'+(sel.size>=AHORA_MAX?' full':'')+'">Elige de '+PD_AHORA_MIN+' a '+AHORA_MAX+' tareas para empezar. Marcadas: '+sel.size+'.</div>'+
    '<div class="rpick pdpick">'+xs.map(x=>'<button class="rpi'+(sel.has(x.id)?' on':'')+'" data-pda="'+esc(x.id)+'" aria-pressed="'+sel.has(x.id)+'"><span class="rbox">'+I.check+'</span>'+pdTitle(x, [pdMeta(x), sgReason(x)].filter(Boolean).join(', ')+(x.estimate?', '+estLabel(x.estimate).toLowerCase():''))+'</button>').join('')+'</div>'; }
function pdApplyAhora(st){ const sel=st.aSel; if(!sel) return; const xs=pdPending(); const t0=Date.now(); let k=0;
  batch(()=>xs.forEach(x=>{ const on=sel.has(x.id); if(on===!!x.focus) return; pdKeep(st, x); updTask(x.id, {focus:on?new Date(t0+(k++)).toISOString():null}); }));
  log('info','Ahora elegida al planificar', {n:sel.size}); }
function pdEnd(st, closeIt){ sheetOnClose=null; if(closeIt) closeSheet();
  const n=ahoraTasks().length, m=estSum(pdHoy()), changed=st.prev.size>0||st.removed.length>0;
  const parts=[]; if(n) parts.push(n+' en Ahora'); if(m) parts.push(hoursText(m)+' de '+dayHours()+' h');
  log('info','Día planificado', {ahora:n, min:m, moved:st.moved, changed:st.prev.size});
  renderAnimated();
  if(closeIt||changed) toast('Día planificado'+(parts.length?': '+parts.join(', '):''), changed?()=>batch(()=>{ restorePrev(st.prev, st.removed); save(); }):null); }
