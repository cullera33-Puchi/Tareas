'use strict';
/* Tareas. Desktop calendar (R12, R19, R20, decision 35): Día, Semana and Mes, list and hours, mini month and agenda.
   A classic script: index.html loads every file of js/ in order and they share their global names. Only declarations and
   listeners run at load; the start itself (first screen, timers, sync, service worker) is in boot.js, the last file. */
/* ---------- R12, R19, R20: the desktop calendar. Día, Semana and Mes share the cards, the drops and the day headers; Día and Semana show
   as Lista (a column of cards per day) or Horas (a 7:00 to 21:00 grid where a reminder on the task's own date is a half-hour block).
   Blocks always last half an hour: a task has no duration. The mini month of the sidebar and the agenda of Hoy reuse the same pieces. ---------- */
// Function declarations only, from when the first render ran before this part of the single script (the constants are with UI)
function isCalView(v){ return CAL_VIEWS.includes(v); }
function calMode(){ return DB.settings.calMode==='hours'?'hours':'list'; } // view preferences, as hoyGroup
function weekMode(){ return DB.settings.weekMode==='monday'?'monday':'next7'; }
/* Decision 35: "Solo de lunes a viernes", per space (a device preference in settings.workWeek, by space id). Unset, it is on for the space
   called Trabajo and off for the rest. On, Semana shows five working days (from today, or Monday to Friday), Día skips the weekend and Mes
   has five columns; tasks dated on a Saturday or Sunday of the range show in a narrow "Fin de semana" column, which takes drops too */
function workWeekOn(){ const sp=space(), w=DB.settings.workWeek; if(w&&typeof w==='object'&&typeof w[sp.id]==='boolean') return w[sp.id]; return norm(sp.name||'').trim()==='trabajo'; }
function isWeekend(d){ const g=new Date(d+'T00:00:00').getDay(); return g===0||g===6; }
function setWorkWeek(on){ const id=space().id; DB.settings.workWeek=Object.assign({}, DB.settings.workWeek, {[id]:!!on}); save(); log('info','Calendario: '+(on?'solo de lunes a viernes':'toda la semana'), {space:space().name});
  if(on&&UI.calDay&&isWeekend(UI.calDay)){ let d=UI.calDay; while(isWeekend(d)) d=addDays(d,1); UI.calDay=d===todayStr()?null:d; } render(); }
// The first day of the week that holds d: its Monday, or in "Siete días desde hoy" a multiple of seven days from today
function weekStartFor(d){ const t=todayStr(); if(weekMode()==='monday') return mondayOf(d); const k=Math.floor(Math.round((new Date(d+'T00:00:00')-new Date(t+'T00:00:00'))/864e5)/7); return addDays(t, 7*k); }
function calStart(){ return UI.weekStart||weekStartFor(todayStr()); } // null follows today, also when the day changes with the app open
function calDays(){ const v=UI.deskView; if(v==='day') return [UI.calDay||todayStr()]; const s=calStart(), all=[...Array(7)].map((_,i)=>addDays(s,i)); return workWeekOn()?all.filter(d=>!isWeekend(d)):all; } // decision 35: seven days always hold exactly five working days
// The day the sidebar's mini month starts from: the one the calendar shows, or today
function calAnchor(){ const v=UI.deskView; return v==='week'?calStart() : v==='day'?(UI.calDay||todayStr()) : v==='month'?(UI.calMonth||todayStr().slice(0,7))+'-01' : todayStr(); }
function calNav(dir){ const v=UI.deskView, today=dir==='today';
  if(v==='month') UI.calMonth=today?null:shiftMonth(UI.calMonth||todayStr().slice(0,7), +dir);
  else if(v==='day'){ let d=today?null:addDays(UI.calDay||todayStr(), +dir); if(d&&workWeekOn()) while(isWeekend(d)) d=addDays(d, +dir); UI.calDay=d===todayStr()?null:d; } // decision 35: Día skips the weekend
  else { const s=today?null:addDays(calStart(), 7*dir); UI.weekStart=s===weekStartFor(todayStr())?null:s; }
  UI.miniYM=null; render(); }
function openCalWeek(d){ const s=weekStartFor(d); UI.weekStart=s===weekStartFor(todayStr())?null:s; UI.miniYM=null; setDeskView('week'); }
function openCalDay(d){ UI.calDay=d===todayStr()?null:d; UI.miniYM=null; setDeskView('day'); }
function setWeekMode(m){ if(weekMode()===m) return; const a=UI.weekStart; DB.settings.weekMode=m; save(); UI.weekStart=a?weekStartFor(a):null; if(UI.weekStart===weekStartFor(todayStr())) UI.weekStart=null; log('info','Semana: '+(m==='monday'?'de lunes a domingo':'siete días desde hoy')); render(); }
function weekModeMenu(src){ const ww=workWeekOn(), g=[[{label:'Solo de lunes a viernes', on:ww, fn:()=>setWorkWeek(!ww)}]];
  if(UI.deskView==='week') g.unshift([{label:ww?'Cinco días laborables desde hoy':'Siete días desde hoy', on:weekMode()==='next7', fn:()=>setWeekMode('next7')}, {label:ww?'De lunes a viernes':'De lunes a domingo', on:weekMode()==='monday', fn:()=>setWeekMode('monday')}]);
  popMenu({anchor:src, align:'right', groups:g}); }
function calModeLabel(){ const ww=workWeekOn(); if(UI.deskView!=='week') return ww?'De lunes a viernes':'Toda la semana'; return weekMode()==='monday'?(ww?'De lunes a viernes':'De lunes a domingo'):(ww?'Cinco días laborables':'Siete días desde hoy'); }
// Decision 35: the weekend days of the shown range that have tasks, in a narrow column beside the working days; each day takes a drop
function weekendHTML(start, end){ if(!workWeekOn()) return ''; const wk=[]; for(let d=start; d<=end; d=addDays(d,1)) if(isWeekend(d)) wk.push(d);
  const xs=calTasks(start, end).filter(x=>wk.includes(x.date)); if(!xs.length) return '';
  return '<aside class="wwkd" aria-label="Fin de semana"><div class="wkh"><span class="l">Fin de semana</span><span class="n">'+xs.length+'</span></div>'+wk.map(d=>{ const l=calSort(xs.filter(x=>x.date===d)), dd=new Date(d+'T00:00:00');
    return '<div class="wkd'+dayCls(d)+'" data-day="'+d+'"><div class="wkdl">'+DIAS_FULL[dd.getDay()]+' '+dd.getDate()+'</div><div class="wl" data-keep="wk'+d+'">'+l.map(x=>calCardHTML(x,'')).join('')+'</div></div>'; }).join('')+'</aside>'; }
// As in the lists, a search ignores the project filter
function calFilter(){ if(UI.query) return queryMatcher(UI.query); if(UI.projFilter!==null) return x=> UI.projFilter==='none' ? !x.projectId : x.projectId===UI.projFilter; return ()=>true; }
// The tasks dated from start to end: pending ones (and waiting ones on their review day, decision 41), and done ones completed in that span
function calTasks(start, end){ const pf=calFilter(); return spaceTasks().filter(x=>x.date&&x.date>=start&&x.date<=end&&(isOpen(x)||(x.completed&&localDay(x.completed)>=start))&&pf(x)); }
// The minute of the day of a reminder set on the task's own date; any other reminder gives the task no time in the calendar
function remMin(x){ if(!x.reminder||!x.date||localDay(x.reminder)!==x.date) return null; const d=new Date(x.reminder); return d.getHours()*60+d.getMinutes(); }
function inGrid(x){ const m=remMin(x); return m!==null&&m>=H0&&m<H1; }
// Tasks with a time first, by time; the rest in the lists' fixed order
function calSort(xs){ const tm=xs.map(x=>[x,remMin(x)]); return tm.filter(a=>a[1]!==null).sort((a,b)=>a[1]-b[1]).map(a=>a[0]).concat(orderTasks(tm.filter(a=>a[1]===null).map(a=>a[0]))); }
// A one-line card (kind ''), a month chip ('mc') or an hour block ('hb'); the full title shows on hover. Carried tasks have an orange edge
function calCardHTML(x, kind, style){ const p=x.projectId?proj(x.projectId):null, m=remMin(x), done=x.status==='done', tm=m!==null?fmtTime(x.reminder):'';
  const wt=x.status==='waiting'?'\nPor confirmar'+(x.waitingFor?', esperando a '+x.waitingFor:''):''; // decision 41
  const tip=x.title+(p?'\n'+p.name:'')+(tm?'\n'+tm:'')+(x.carried&&!done?'\nAplazada':'')+wt+(repParse(x.repeat)?'\n'+repSummary(x.repeat):'')+(stepStats(x.id)?'\n'+stepsCount(x.id)+' pasos':'');
  return '<div class="wcard'+(kind?' '+kind:'')+(done?' done':'')+(x.carried&&!done?' carried':'')+'" draggable="true" data-id="'+x.id+'" title="'+esc(tip)+'" style="'+(p?'--pc:'+p.color+';':'')+(style||'')+'">'+
    (kind==='mc'?'<span class="mdot"></span>':'<button class="check'+(done?' done':x.status==='waiting'?' waiting':'')+'" data-act="wcheck" aria-label="Completar">'+I.check+'</button>')+
    (kind==='hb'?'<span class="tm">'+tm+'</span>':'')+'<div class="t">'+(x.priority==='high'?'<span class="pri high">!!!</span>':x.priority==='mid'?'<span class="pri mid">!!</span>':'')+esc(x.title)+'</div>'+
    (x.focus&&!done?'<span class="cic ist">'+I.starF+'</span>':'')+(repParse(x.repeat)?'<span class="cic irp">'+I.repeat+'</span>':'')+(stepStats(x.id)?'<span class="cic">'+stepProgHTML(x)+'</span>':'')+(tm&&kind!=='hb'?'<span class="tm">'+tm+'</span>':'')+'</div>'; } // decisions 38, 39 and 46: repeats, in Ahora, its steps
// R12: a day's header: name and date, pending count, high-priority count and a load bar, orange above 8 tasks and red above 12
function dayHeadHTML(d, xs){ const t=todayStr(), dd=new Date(d+'T00:00:00'), pend=xs.filter(isOpen), n=pend.length, hi=pend.filter(x=>x.priority==='high').length, dn=xs.length-n;
  const what=n?n+(n===1?' tarea':' tareas'):dn?dn+(dn===1?' hecha':' hechas'):'Sin tareas'; // a past day only has done tasks
  return '<div class="dh" title="'+what+(hi?', '+hi+(hi===1?' prioritaria':' prioritarias'):'')+'"><div class="dt"><b>'+DIAS_FULL[dd.getDay()].slice(0,3)+'<small>'+dd.getDate()+(dd.getDate()===1?' '+MESES[dd.getMonth()]:'')+'</small></b>'+(d<t?'':'<button data-add-date="'+d+'" aria-label="Añadir" title="Añadir">'+I.plus+'</button>')+'</div>'+
    '<div class="dm"><span class="wc">'+what+'</span>'+(hi?'<span class="wp">'+hi+' !!!</span>':'')+'</div><div class="ld'+(n>12?' red':n>8?' orange':'')+'"><i style="transform:scaleX('+Math.min(1,n/12).toFixed(3)+')"></i></div></div>'; }
// Past days are narrower (only their done tasks show); one day alone takes the width
function calCols(days){ const t=todayStr(); return days.map(d=>days.length>1&&d<t?'minmax(0,.55fr)':'minmax(0,1fr)').join(' '); }
function dayCls(d){ const t=todayStr(); return (d===t?' today':'')+(d<t?' past':''); }
function weekListHTML(days){ const xs=calTasks(days[0], days[days.length-1]);
  return '<div class="wgrid" style="grid-template-columns:'+calCols(days)+'">'+days.map(d=>{ const l=calSort(xs.filter(x=>x.date===d));
    return '<div class="wday'+dayCls(d)+'" data-day="'+d+'">'+dayHeadHTML(d,l)+'<div class="wl" data-keep="wl'+d+'">'+l.map(x=>calCardHTML(x,'')).join('')+'</div></div>'; }).join('')+'</div>'; }
// Half-hour blocks side by side when they overlap
function layoutBlocks(list){ const out=[]; let cl=[], ends=[], end=-1;
  const flush=()=>{ const k=ends.length; cl.forEach(c=>{ c.k=k; out.push(c); }); cl=[]; ends=[]; };
  list.forEach(x=>{ const m=remMin(x); if(cl.length&&m>=end) flush(); let col=ends.findIndex(e=>e<=m); if(col<0){ col=ends.length; ends.push(0); } ends[col]=m+SLOT; end=cl.length?Math.max(end,m+SLOT):m+SLOT; cl.push({x,m,col}); });
  if(cl.length) flush(); return out; }
function nowY(){ const n=new Date(), m=n.getHours()*60+n.getMinutes()+n.getSeconds()/60; return m>=H0&&m<H1?(m-H0)/SLOT*SH:null; }
function hhmm(m){ return Math.floor(m/60)+':'+String(m%60).padStart(2,'0'); }
// R20: Horas. A "Todo el día" strip (tasks with a date and no time in the grid) over a grid of half-hour slots, with a red line at the time.
// The agenda of Hoy (agenda) shows only how many tasks have no time: the list next to it already shows them
function hoursHTML(days, agenda){ const t=todayStr(), xs=calTasks(days[0], days[days.length-1]), cols='44px '+calCols(days), now=Date.now();
  const per=d=>xs.filter(x=>x.date===d);
  const head=agenda?'':'<div class="hrow hhead" style="grid-template-columns:'+cols+'"><div class="hgut"></div>'+days.map(d=>'<div class="hdh'+dayCls(d)+'">'+dayHeadHTML(d, per(d))+'</div>').join('')+'</div>';
  const all='<div class="hrow hall" style="grid-template-columns:'+cols+'"><div class="hgut">Todo el día</div>'+days.map(d=>{ const a=calSort(per(d).filter(x=>!inGrid(x)));
    // Decision 28d: up to three tasks and "N más", which opens that day; in Día itself it shows the rest in place. The strip never scrolls inside
    const one=days.length===1, open=one&&UI.allDayOpen===d, shown=open?a:a.slice(0,3), more=a.length-shown.length;
    const link=more>0?'<button class="hmore" '+(one?'data-act="allDayMore" data-day-more="'+d+'"':'data-open-day="'+d+'" title="Abrir el día"')+'>'+more+' más</button>':open&&a.length>3?'<button class="hmore" data-act="allDayMore" data-day-more="">Mostrar menos</button>':'';
    return '<div class="hallday'+dayCls(d)+'" data-day="'+d+'" data-allday="1">'+(agenda?'<span class="hcount">'+(a.length?a.length+(a.length===1?' tarea sin hora':' tareas sin hora'):'Ninguna tarea sin hora')+'</span>':'<div class="wl" data-keep="all'+d+'">'+shown.map(x=>calCardHTML(x,'')).join('')+link+'</div>')+'</div>'; }).join('')+'</div>';
  let labels=''; for(let m=H0;m<H1;m+=60) labels+='<span style="top:'+((m-H0)/SLOT*SH)+'px">'+hhmm(m)+'</span>';
  const col=d=>{ let s=''; for(let m=H0;m<H1;m+=SLOT){ const dt=new Date(d+'T00:00:00'); dt.setHours(0,m,0,0); s+='<div class="hs'+(m%60?' half':'')+(dt.getTime()<=now?' past':'')+'" data-slot="'+d+'T'+String(Math.floor(m/60)).padStart(2,'0')+':'+String(m%60).padStart(2,'0')+'"></div>'; }
    const b=layoutBlocks(calSort(per(d).filter(inGrid))).map(c=>calCardHTML(c.x,'hb','top:'+((c.m-H0)/SLOT*SH)+'px;height:'+(SH-2)+'px;left:calc('+c.col+' * 100% / '+c.k+' + 2px);width:calc(100% / '+c.k+' - 4px);')).join('');
    const y=d===t?nowY():null; return '<div class="hcol'+dayCls(d)+'" data-hday="'+d+'">'+s+b+(d===t?'<div class="hnow" style="transform:translateY('+(y===null?0:y)+'px)'+(y===null?';display:none':'')+'"></div>':'')+'</div>'; };
  return '<div class="hours'+(agenda?' agenda':'')+'">'+head+all+'<div class="hscroll" data-keep="hours"><div class="hrow hgrid" style="grid-template-columns:'+cols+';height:'+((H1-H0)/SLOT*SH)+'px"><div class="hgut hlab">'+labels+'</div>'+days.map(col).join('')+'</div></div></div>'; }
// The red line moves with the clock without a redraw
function placeNow(){ const y=nowY(); document.querySelectorAll('#desk .hnow').forEach(e=>{ if(y===null){ e.style.display='none'; return; } e.style.display=''; e.style.transform='translateY('+y+'px)'; }); }
setInterval(placeNow, 3e4);
// A grid shown for the first time scrolls to an hour before now (or to 8:00)
function scrollHours(sc){ const y=nowY(); sc.scrollTop=Math.max(0, (y===null?SH*2:y-SH*2)); }
// R12: the undated tasks in a tray beside the days, folding to a narrow strip; open or folded it takes a drop to clear the date
function trayHTML(){ const pf=calFilter(), u=orderTasks(spaceTasks().filter(x=>x.status==='pending'&&!x.date).filter(pf)), open=DB.settings.weekTray!==false;
  return '<aside class="wundated wtray'+(open?'':' shut')+'" data-day=""><button class="trh" data-act="toggleTray" aria-expanded="'+open+'" title="'+(open?'Plegar':'Desplegar')+' Sin fecha">'+I.chevD+'<span class="l">Sin fecha</span><span class="n">'+u.length+'</span></button>'+
    (open?'<div class="wl" data-keep="tray">'+(u.length?u.map(x=>calCardHTML(x,'')).join(''):'')+'<p class="trhint">Arrastra aquí para quitar la fecha</p></div>':'')+'</aside>'; }
// R19: Mes. Six weeks from the Monday before the 1st; up to four tasks a day and, in the day's head, "N más", which opens the day
function monthHTML(){ const t=todayStr(), ym=UI.calMonth||t.slice(0,7), start=mondayOf(ym+'-01'), days=[...Array(42)].map((_,i)=>addDays(start,i)), xs=calTasks(days[0], days[41]);
  const cell=d=>{ const l=calSort(xs.filter(x=>x.date===d)), more=l.length-4, dd=new Date(d+'T00:00:00');
    return '<div class="mday'+(d.slice(0,7)!==ym?' other':'')+dayCls(d)+'" data-day="'+d+'"><div class="mh">'+(more>0?'<button class="mmore" data-open-day="'+d+'" title="Abrir el día">'+more+' más</button>':'')+'<button class="mnum" data-open-week="'+d+'" title="Abrir la semana">'+dd.getDate()+(dd.getDate()===1?' '+MESES[dd.getMonth()]:'')+'</button></div>'+l.slice(0,4).map(x=>calCardHTML(x,'mc')).join('')+'</div>'; };
  if(!workWeekOn()) return '<div class="month"><div class="mdow">'+['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'].map(d=>'<span>'+d+'</span>').join('')+'</div><div class="mgrid">'+days.map(cell).join('')+'</div></div>';
  // Decision 35: five columns; a narrow "Fin de semana" cell per week when some weekend of these six weeks has tasks, its two days each taking drops
  const wk=xs.some(x=>isWeekend(x.date)), cols='repeat(5,minmax(0,1fr))'+(wk?' minmax(70px,.45fr)':''), rows=[];
  for(let w=0; w<6; w++){ const wd=days.slice(w*7, w*7+7); rows.push(wd.slice(0,5).map(cell).join('')+(wk?'<div class="mwkd">'+wd.slice(5).map(d=>{ const l=calSort(xs.filter(x=>x.date===d)), dd=new Date(d+'T00:00:00'), more=l.length-2;
    return '<div class="mwk'+(d.slice(0,7)!==ym?' other':'')+dayCls(d)+'" data-day="'+d+'"><button class="mnum" data-open-day="'+d+'" title="Abrir el día">'+DIAS_FULL[dd.getDay()].slice(0,3)+' '+dd.getDate()+'</button>'+l.slice(0,2).map(x=>calCardHTML(x,'mc')).join('')+(more>0?'<button class="mmore" data-open-day="'+d+'">'+more+' más</button>':'')+'</div>'; }).join('')+'</div>':'')); }
  return '<div class="month workweek"><div class="mdow" style="grid-template-columns:'+cols+'">'+['Lun','Mar','Mié','Jue','Vie'].concat(wk?['Fin de semana']:[]).map(d=>'<span>'+d+'</span>').join('')+'</div><div class="mgrid" style="grid-template-columns:'+cols+'">'+rows.join('')+'</div></div>'; }
// The calendar column: its head (period, navigation, week option, Lista or Horas, Día, Semana or Mes) and the chosen view
function weekHTML(){ const v=UI.deskView, days=calDays(), start=days[0], end=days[days.length-1], mode=calMode(); let label, body;
  if(v==='month'){ const ym=UI.calMonth||todayStr().slice(0,7), n=MESES_FULL[+ym.slice(5,7)-1]; label=n[0].toUpperCase()+n.slice(1)+' de '+ym.slice(0,4); body=monthHTML(); }
  else { if(v==='day'){ const dd=new Date(start+'T00:00:00'); label=DIAS_FULL[dd.getDay()]+', '+dd.getDate()+' de '+MESES_FULL[dd.getMonth()]; }
    else { const sm=new Date(start+'T00:00:00'), em=new Date(end+'T00:00:00'); label='Semana del '+(sm.getMonth()===em.getMonth()? sm.getDate()+' al '+em.getDate()+' de '+MESES_FULL[em.getMonth()] : sm.getDate()+' de '+MESES_FULL[sm.getMonth()]+' al '+em.getDate()+' de '+MESES_FULL[em.getMonth()]); }
    body='<div class="wbody">'+(mode==='hours'?hoursHTML(days):weekListHTML(days))+(v==='week'?weekendHTML(calStart(), addDays(calStart(),6)):'')+trayHTML()+'</div>'; }
  const seg=(attr, opts, cur)=>'<div class="seg cseg" role="group">'+opts.map(([k,l])=>'<button data-'+attr+'="'+k+'"'+(k===cur?' class="on" aria-pressed="true"':' aria-pressed="false"')+'>'+l+'</button>').join('')+'</div>';
  const nav=v==='month'?['Mes anterior','Mes siguiente']:v==='day'?['Día anterior','Día siguiente']:['Semana anterior','Semana siguiente'];
  return '<div class="week cal-'+v+(v!=='month'?' mode-'+mode:'')+'"><div class="whead"><h2>'+label+'</h2><button class="nav-b" data-week="-1" aria-label="'+nav[0]+'" title="'+nav[0]+'">'+I.back+'</button><button class="today-b" data-week="today">Hoy</button><button class="nav-b" data-week="1" aria-label="'+nav[1]+'" title="'+nav[1]+'">'+I.chev+'</button><span class="grow"></span>'+
    '<button class="pfdrop wmode" data-act="weekModeMenu" aria-haspopup="menu"><span class="l">'+calModeLabel()+'</span>'+I.chevD+'</button>'+ // decision 35: in Día and Mes too, for Solo de lunes a viernes
    (v!=='month'?seg('cal-mode', [['list','Lista'],['hours','Horas']], mode):'')+seg('cal-view', [['day','Día'],['week','Semana'],['month','Mes']], v)+'</div>'+body+'</div>'; }
// R19: the sidebar's mini month under Semana: dots on days with pending tasks, a click opens that day's week, a dropped task takes that date
function miniMonthHTML(){ const ym=UI.miniYM||calAnchor().slice(0,7), v=UI.deskView, s=v==='week'?calStart():v==='day'?calAnchor():null;
  return '<div class="minical">'+calendarHTML(ym, null, {mini:true, range:s?[s, v==='week'?addDays(s,6):s]:null})+'</div>'; }
// R20: next to Hoy, on screens wider than 1400 px, the day's agenda with the same hours grid
function agendaHTML(){ return '<aside class="hagenda"><div class="ahead"><b>Agenda</b><span>'+(()=>{ const d=new Date(); return DIAS_FULL[d.getDay()]+' '+d.getDate(); })()+'</span></div>'+hoursHTML([todayStr()], true)+'</aside>'; }
