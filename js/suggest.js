'use strict';
/* Tareas. Decision 56c (design point 54): ¿Qué hago ahora? Up to three tasks that fit in the time there is, on demand only.
   A classic script: index.html loads every file of js/ in order and they share their global names. Only declarations and
   listeners run at load; the start itself (first screen, timers, sync, service worker) is in boot.js, the last file.
   - Entry points: Sugerir in the head of the Ahora block (shown only when Ahora has tasks) and «¿Qué hago ahora?» in the view menu of Hoy
     (its three dots), on the iPhone and the desktop. On the iPhone a sheet; on the desktop a popover anchored to the link or the menu button.
   - The time: 15 min, 30 min (the default), 1 h or Medio día. Changing it works the list out again.
   - Candidates: the open tasks of the active space that are in Hoy (by date or by deadline) or in Todas without a date; a waiting one only
     once its review day has come (Revisar hoy); none already in Ahora. One fits when its estimate is that time or less; one without an
     estimate only for 1 h and Medio día.
   - Order: deadline today or past, high priority, the ones that keep being put off (the most postponed first), then the quick ones (the
     smallest estimate first); ties in the order of the lists (orderTasks).
   - A reminder of an open task of the space that falls inside the time shows one line on top: «Ojo: a las 10:00 tienes "SteerCo"».
   - A tap on a suggestion puts it in Ahora (toggleFocus: its limit of five and its message, Deshacer) and closes; its chevron opens the
     task instead. A waiting task cannot be in Ahora: its tap opens it.
   - Rules on the device only, nothing stored. */
const SG_TIMES=[[15,'15 min'],[30,'30 min'],[60,'1 h'],[240,'Medio día']], SG_DEFAULT=30;
// The candidates of the space, in the order of the lists
function suggestPool(){ return orderTasks(spaceTasks().filter(x=>!x.focus && !HELD.has(x.id) && ((x.status==='pending' && (inHoy(x) || !x.date)) || (x.status==='waiting' && waitIn(x))))); }
const sgFits = (x, min) => x.estimate ? +x.estimate<=min : min>=60;
// The tier of a candidate: 0 deadline today or past, 1 high priority, 2 put off again and again, 3 the rest
const sgTier = x => dlDue(x)?0:x.priority==='high'?1:isDrag(x)?2:3;
// Why it is there, in grey under its title
function sgReason(x){ const t=todayStr();
  if(dlDue(x)) return x.deadline===t?'Entrega hoy':'Entrega vencida';
  if(x.priority==='high') return 'Prioritaria';
  if(isDrag(x)) return dragText(x);
  if(x.status==='waiting') return 'Revisar hoy';
  if(x.estimate&&+x.estimate<=30) return 'Rápida';
  return inHoy(x)?'Para hoy':'Sin fecha'; }
// The suggestions for min minutes: {list:[task, ...] (three at most), warn:{at, title} or null}
function suggestFor(min){ const pool=suggestPool(), pos=new Map(pool.map((x,i)=>[x.id,i]));
  const list=pool.filter(x=>sgFits(x, min)).sort((a,b)=>{ const ta=sgTier(a), tb=sgTier(b); if(ta!==tb) return ta-tb;
    if(ta===2){ const pa=+a.postponed||0, pb=+b.postponed||0; if(pa!==pb) return pb-pa; const ca=a.carriedSince||'9999', cb=b.carriedSince||'9999'; if(ca!==cb) return ca<cb?-1:1; }
    if(ta===3){ const ea=+a.estimate||1e9, eb=+b.estimate||1e9; if(ea!==eb) return ea-eb; }
    return pos.get(a.id)-pos.get(b.id); }).slice(0,3);
  const now=Date.now(), end=now+min*6e4; let warn=null;
  spaceTasks().forEach(x=>{ if(!isOpen(x)||!x.reminder) return; const at=Date.parse(x.reminder); if(isNaN(at)||at<now||at>end) return; if(!warn||at<warn.ms) warn={ms:at, at:x.reminder, title:x.title||'Sin título'}; });
  return {list, warn}; }
function sgBodyHTML(min){ const r=suggestFor(min);
  let h=r.warn?'<div class="sgwarn">Ojo: a las '+fmtTime(r.warn.at)+' tienes "'+esc(r.warn.title)+'"</div>':'';
  if(!r.list.length) return h+'<div class="sgempty">Nada encaja en ese tiempo</div>';
  return h+'<div class="group sglist">'+r.list.map(x=>{ const p=x.projectId?proj(x.projectId):null;
    const meta=(p?'<span class="tag" style="'+tagVars(p.color)+'">'+esc(p.name)+'</span>':'')+(x.estimate?'<span class="sgest">'+estLabel(x.estimate)+'</span>':'')+'<span class="sgwhy">'+esc(sgReason(x))+'</span>';
    return '<div class="sgrow" data-sg="'+esc(x.id)+'"><button class="sgmain" data-sg-add="'+esc(x.id)+'"><span class="sgt">'+esc(x.title||'Sin título')+'</span><span class="sgm">'+meta+'</span></button>'+
      '<button class="sgopen" data-sg-open="'+esc(x.id)+'" aria-label="Abrir la tarea" title="Abrir la tarea">'+I.chev+'</button></div>'; }).join('')+'</div>'; }
function sgChipsHTML(min){ return SG_TIMES.map(([m,l])=>'<button class="chip'+(m===min?' on':'')+'" data-sg-min="'+m+'" aria-pressed="'+(m===min)+'">'+l+'</button>').join(''); }
// src: the link or the button the desktop popover hangs from
function suggestSheet(src){ flushHeld(true); let min=SG_DEFAULT; log('info','Sugerir abierto');
  const html='<div class="sg"><div class="chips sgchips">'+sgChipsHTML(min)+'</div><div class="sgbody">'+sgBodyHTML(min)+'</div></div>';
  const bind=(s, close)=>{ s.onclick=e=>{
    const c=e.target.closest('[data-sg-min]'); if(c){ min=+c.dataset.sgMin; $('.sgchips', s).innerHTML=sgChipsHTML(min); $('.sgbody', s).innerHTML=sgBodyHTML(min); haptic(4); return; }
    const o=e.target.closest('[data-sg-open]'); if(o){ const id=o.dataset.sgOpen; close(); if(task(id)) openDetail(id); return; }
    const a=e.target.closest('[data-sg-add]'); if(a){ const id=a.dataset.sgAdd, x=task(id); if(!x) return;
      if(x.status!=='pending'){ close(); openDetail(id); return; } // Revisar hoy: a waiting task is not put in Ahora
      if(ahoraTasks(x.spaceId).length>=AHORA_MAX){ toggleFocus(id); return; } // its message; the panel stays to choose again later
      close(); toggleFocus(id); log('info','Sugerida pasada a Ahora', {min}); } }; };
  if(UI.wide){ const at=src&&src.isConnected?{anchor:src, align:'right'}:{}; popMenu(Object.assign(at, {html:'<div class="pm-title sgtitle">¿Qué hago ahora?</div>'+html, bind:el=>bind(el, ()=>closeMenu(false, true))})); return; }
  openSheet('<h2>¿Qué hago ahora?</h2>'+html, s=>bind(s, closeSheet)); }
