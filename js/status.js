'use strict';
/* Tareas. Roadmap M4: a status summary to share. A ready text per project (or one for every active project of the space) with what was
   done in the period, what is under way, what waits for someone and the next steps, to paste in Teams, an email or Claude.
   A classic script: index.html loads every file of js/ in order and they share their global names. Only declarations and
   listeners run at load; the start itself (first screen, timers, sync, service worker) is in boot.js, the last file.
   - Nothing is stored: the text is worked out from the tasks when the sheet opens or the period changes, and can be touched up in place.
   - The text is plain, in the owner's style: dates in words, no symbols between ideas, no markdown. Notes, voice notes, attachments and
     project notes stay out.
   - Entry points: the project's «...» (viewMenu) and its menu (projectMenu, the desktop sidebar's right click) for one project; the
     Tareas «...» (viewMenu) for the whole space. On the iPhone a sheet with the actions in its header (decision 18); on the desktop a
     centred dialog with the buttons at its foot. */

/* ---------- Dates in words ---------- */
const stDate = d => new Date(d+'T00:00:00');
// "jueves 5 de noviembre", with the year when it is not this year's
function stDayLong(d){ const x=stDate(d), y=x.getFullYear(); return DIAS_L[x.getDay()]+' '+x.getDate()+' de '+MESES_FULL[x.getMonth()]+(String(y)===todayStr().slice(0,4)?'':' de '+y); }
// "jueves 6" this month, "jueves 3 de diciembre" in another one
function stDayShort(d){ const x=stDate(d); return d.slice(0,7)===todayStr().slice(0,7) ? DIAS_L[x.getDay()]+' '+x.getDate() : stDayLong(d); }
// The period in words: "del 2 al 5 de noviembre de 2026", "del 30 de octubre al 5 de noviembre de 2026", "lunes 2 de noviembre de 2026"
function stRange(a, b){ const A=stDate(a), B=stDate(b), md=x=>x.getDate()+' de '+MESES_FULL[x.getMonth()];
  if(a===b) return DIAS_L[A.getDay()]+' '+md(A)+' de '+A.getFullYear();
  if(A.getFullYear()!==B.getFullYear()) return 'del '+md(A)+' de '+A.getFullYear()+' al '+md(B)+' de '+B.getFullYear();
  if(A.getMonth()!==B.getMonth()) return 'del '+md(A)+' al '+md(B)+' de '+B.getFullYear();
  return 'del '+A.getDate()+' al '+md(B)+' de '+B.getFullYear(); }
// The period: 'week' from Monday to today, '7d' the last seven days with today
function stPeriod(key){ const t=todayStr(); return {key, from:key==='7d'?addDays(t,-6):addDays(t,-monFirst(stDate(t).getDay())), to:t}; }

/* ---------- The text ---------- */
// One line of a list: the title and what matters about it, in words
function stLine(x, kind){ const t=todayStr(); let s=String(x.title||'').replace(/\s+/g,' ').trim()||'Sin título';
  if(kind==='done') return '- '+s;
  if(kind==='next'&&x.date) s+=', '+stDayShort(x.date);
  if(kind==='wait'){ if(x.waitingFor&&x.waitingFor.trim()) s+=', esperando a '+x.waitingFor.trim(); if(x.date) s+=x.date<=t?', revisar hoy':', revisar el '+stDayShort(x.date); }
  if(x.deadline) s+=x.deadline<t?', entrega vencida el '+stDayShort(x.deadline):x.deadline===t?', entrega hoy':', entrega '+stDayShort(x.deadline);
  const extra=[], c=stepStats(x.id); if(c&&c.n) extra.push(c.done+' de '+c.n+' pasos'); if(x.priority==='high') extra.push('prioritaria');
  return '- '+s+(extra.length?' ('+extra.join(', ')+')':''); }
// The four sections of one project (pid) or of the tasks without a project (pid null) of a space, each a list of lines; empty ones left out
function stSections(spaceId, pid, per){ const t=todayStr(), end=addDays(t,14);
  const xs=DB.tasks.filter(x=>x.spaceId===spaceId && (pid ? x.projectId===pid : !x.projectId || !proj(x.projectId)));
  const done=xs.filter(x=>x.status==='done'&&x.completed&&localDay(x.completed)>=per.from&&localDay(x.completed)<=per.to).sort((a,b)=>a.completed<b.completed?-1:1);
  const pend=xs.filter(x=>x.status==='pending');
  const now=orderTasks(pend.filter(inHoy)); // the tasks of Hoy (carried ones and a deadline that has come included), then those in Ahora
  pend.filter(x=>x.focus&&!now.includes(x)).sort((a,b)=>a.focus<b.focus?-1:1).forEach(x=>now.push(x));
  const wait=xs.filter(x=>x.status==='waiting').sort((a,b)=>(a.date||'9999')<(b.date||'9999')?-1:(a.date||'9999')>(b.date||'9999')?1:a.created<b.created?-1:1);
  const rest=pend.filter(x=>!now.includes(x)), byDate=(a,b)=>a.date<b.date?-1:a.date>b.date?1:0;
  const soon=orderTasks(rest.filter(x=>x.date&&x.date>t&&x.date<=end)).sort(byDate); // stable: the app's order inside a day
  const undated=orderTasks(rest.filter(x=>!x.date)).slice(0,5);
  return [['Hecho', done.map(x=>stLine(x,'done'))], ['En curso', now.map(x=>stLine(x,'now'))], ['Por confirmar', wait.map(x=>stLine(x,'wait'))],
    ['Próximos pasos', soon.map(x=>stLine(x,'next')).concat(undated.map(x=>stLine(x,'next')))]].filter(s=>s[1].length); }
const stBlock = secs => secs.map(s=>s[0]+'\n'+s[1].join('\n')).join('\n\n');
const ST_EMPTY = 'Nada que contar en este periodo.';
// The text for one project
function statusText(pid, key){ const p=proj(pid); if(!p) return ''; const per=stPeriod(key||'week'), secs=stSections(p.spaceId, p.id, per);
  const head='Estado '+p.name.trim()+', '+(per.key==='week'&&per.from!==per.to?'semana ':'')+stRange(per.from, per.to);
  return head+'\n\n'+(secs.length?stBlock(secs):ST_EMPTY); }
// The text for every active project of the active space, in the order of Proyectos, then Sin proyecto; a project with nothing is left out
function spaceStatusText(key){ const per=stPeriod(key||'week'), sp=space().id;
  const head='Estado '+(per.from===per.to?'del ':per.key==='week'?'de la semana ':'')+stRange(per.from, per.to);
  const parts=activeProjects().map(p=>[p.name.trim(), stSections(sp, p.id, per)]).concat([['Sin proyecto', stSections(sp, null, per)]]).filter(o=>o[1].length);
  return head+'\n\n'+(parts.length?parts.map(o=>o[0]+'\n\n'+stBlock(o[1])).join('\n\n\n'):ST_EMPTY); }

/* ---------- The sheet ---------- */
// pid: a project's id, or null for the whole space
function statusSheet(pid){ if(pid&&!proj(pid)) return; if(typeof flushHeld==='function') flushHeld(false); flushEdits();
  let key='week'; const gen=()=>pid?statusText(pid, key):spaceStatusText(key);
  const title=pid?'Estado de '+esc(proj(pid).name):'Estado de la semana';
  const chips='<div class="chips stchips" role="radiogroup" aria-label="Periodo">'+[['week','Esta semana'],['7d','Últimos 7 días']].map(c=>'<button class="chip'+(c[0]===key?' on':'')+'" data-per="'+c[0]+'" role="radio" aria-checked="'+(c[0]===key)+'">'+c[1]+'</button>').join('')+'</div>';
  const area='<textarea class="sttext" spellcheck="false" aria-label="Texto del estado"></textarea>';
  const html=UI.wide ? '<h2>'+title+'</h2>'+chips+area+'<div class="sheet-actions"><span style="flex:1"></span><button class="btn" data-x="close">Cerrar</button><button class="btn" data-x="copy">Copiar</button><button class="btn primary" data-x="share">Compartir</button></div>'
    : '<div class="shead"><button class="hbtn" data-x="copy">Copiar</button><h2>'+title+'</h2><button class="hbtn ok" data-x="share">Compartir</button></div>'+chips+area;
  openSheet(html, s=>{ s.classList.add('stsheet'); if(UI.wide) s.classList.add('keysheet'); const ta=$('.sttext', s); ta.value=gen();
    s.onclick=e=>{ const c=e.target.closest('[data-per]'); if(c){ if(c.dataset.per===key) return; key=c.dataset.per; s.querySelectorAll('[data-per]').forEach(b=>{ const on=b.dataset.per===key; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); }); ta.value=gen(); ta.scrollTop=0; haptic(4); return; }
      const b=e.target.closest('[data-x]'); if(!b) return; const x=b.dataset.x;
      if(x==='close'){ closeSheet(); return; }
      if(x==='copy'){ statusCopy(ta.value); return; }
      if(x==='share'){ statusShare(pid?proj(pid)&&proj(pid).name:null, ta.value); } }; }); }
async function statusShare(name, text){ const t=String(text||'').trim(); if(!t) return;
  try{ if(navigator.share){ await navigator.share({title:name?'Estado de '+name:'Estado de la semana', text:t}); log('info','Estado compartido', {via:'compartir'}); return; } }catch(e){ if(e&&e.name==='AbortError') return; }
  statusCopy(t); }
function statusCopy(text){ const t=String(text||'').trim(); if(!t) return; log('info','Estado compartido', {via:'copiar'}); copyText(t, 'Texto copiado. Pégalo en Teams, el correo o Claude.'); }
