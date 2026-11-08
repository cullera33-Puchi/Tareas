require('./lib/out.js'); // outputs (screenshots, downloads) go to tests/out
// Decision 79: the project on the cards of the desktop calendar. Port 8831 (8830 to 8839: rm-NF, rm-PC). Screenshots in tests/out/PC.
//  1. The short name: the first word of the project's name (letters and digits), up to 6 characters; 4 in the month.
//  2. Semana (list), Día, the hours view (Todo el día and the blocks), the weekend column and Mes: a capsule with that name before the title,
//     with the project's colors (the list's capsule, tagVars); none without a project; the full name in the tooltip; cards still draggable.
//  3. Within a day: the tasks with a time first, by time; the rest by project in the sidebar's order (no project last), each project in
//     the lists' order, with no headers.
//  4. Desktop light and dark screenshots of Semana, the hours view and Mes; the iPhone has no calendar and nothing changes there.
const { chromium } = require('playwright');
const fs = require('fs'); const path = require('path');
const TF = require('./lib/team-fake.js'); const { until, today } = TF;
const PORT = 8831, OUT = path.join(__dirname, 'out', 'PC'); fs.mkdirSync(OUT, {recursive:true});
const r={}, fails=[], errors=[]; const check=(name, ok, info)=>{ r[name]=ok?true:(info===undefined?false:info); if(!ok) fails.push(name); };
const shot=(page, name)=>page.screenshot({path:path.join(OUT, name+'.png')});
const addDays=(d,n)=>{ const x=new Date(d+'T12:00:00'); x.setDate(x.getDate()+n); return x.toISOString().slice(0,10); };
const T0='2026-11-01T08:00:00.000Z';
const P=(id, name, color, order, o)=>Object.assign({id, spaceId:'trabajo', name, color, order, archived:false, created:T0, modified:T0}, o||{});
// The reminder of a task at hh:mm on its own day, as an ISO time of this machine's zone
const at=(d, hm)=>new Date(d+'T'+hm+':00').toISOString();

async function open(browser, o){
  const ctx = await browser.newContext({viewport:{width:1440, height:900}, deviceScaleFactor:1, colorScheme:o.dark?'dark':'light'}); const page = await ctx.newPage();
  page.on('pageerror', e=>errors.push(o.tag+' pageerror: '+e.message)); page.on('console', m=>{ if(m.type()==='error') errors.push(o.tag+' console: '+m.text()); });
  await page.addInitScript(s=>{ if(!localStorage.getItem('tareas-v1')) localStorage.setItem('tareas-v1', s); }, JSON.stringify(o.seed));
  await page.goto('http://localhost:'+PORT+'/'); await until(page, ()=>typeof DB!=='undefined'&&!!document.querySelector('#desk .main')); return {ctx, page}; }
const calm = page => page.waitForTimeout(450);

async function run(browser){
  const t=today(), D1=addDays(t,1), D2=addDays(t,2);
  const projects=[P('p1', 'FLC Comité', '#007AFF', 0), P('p2', 'Transformación digital', '#FF9500', 1), P('p3', 'Oca', '#34C759', 2), P('p4', '#2026 Plan anual', '#AF52DE', 3), P('pa', 'Archivado viejo', '#8E8E93', 9, {archived:true})];
  const tk=(id, o)=>TF.tk(id, Object.assign({title:id}, o));
  const tasks=[
    // today: two with a time (9:30 Oca, 8:15 no project), then by project: p1 (two, the high one first), p2, p3, archived, none
    tk('n1', {title:'Sin proyecto, sin hora', date:t}),
    tk('c1', {title:'Llamar a Oca', projectId:'p3', date:t}),
    tk('b1', {title:'Plan de la transformación', projectId:'p2', date:t}),
    tk('a2', {title:'Acta del comité', projectId:'p1', date:t}),
    tk('a1', {title:'Preparar el comité de seguimiento con el cliente', projectId:'p1', date:t, priority:'high'}),
    tk('z1', {title:'De un proyecto archivado', projectId:'pa', date:t}),
    tk('h2', {title:'Revisión con Oca', projectId:'p3', date:t, reminder:at(t,'09:30')}),
    tk('h1', {title:'Café sin proyecto', date:t, reminder:at(t,'08:15')}),
    tk('d1', {title:'Plan anual', projectId:'p4', date:D1}),
    tk('d2', {title:'Revisar la hoja de ruta', projectId:'p2', date:D1, estimate:60, reminder:at(D1,'11:00')}),
    tk('d3', {title:'Mandar presupuesto', projectId:'p1', date:D2, deadline:D2}),
    tk('u1', {title:'Sin fecha de la transformación digital', projectId:'p2', date:null}),
    tk('d4', {title:'Hecha ya', projectId:'p3', date:t, status:'done', completed:new Date().toISOString()}) ];
  const seed=TF.seed(tasks, {projects, settings:{tipsSeen:true, weekMode:'next7', workWeek:{trabajo:false}}});

  const L = await open(browser, {tag:'L', seed}); const pg=L.page;
  /* ---------- 1. The short name ---------- */
  const sn = await pg.evaluate(()=>[projShort('FLC Comité'), projShort('Transformación digital'), projShort('Oca'), projShort('#2026 Plan anual'), projShort('Ñandú-Sur'), projShort(''), projShort('  --  '), projShort('Transformación digital', 4), projShort('Oca', 4)]);
  check('short_rule', JSON.stringify(sn)===JSON.stringify(['FLC','Transf','Oca','2026','Ñandú','','','Tran','Oca']), sn);

  /* ---------- 2 and 3. Semana (list) ---------- */
  await pg.evaluate(()=>{ DB.settings.calMode='list'; save(); setDeskView('week'); }); await calm(pg);
  const card = id => pg.evaluate(id=>{ const c=document.querySelector('#desk .main .wcard[data-id="'+id+'"]'); if(!c) return null; const g=c.querySelector('.ctag');
    const t=c.querySelector('.t'), top=c.querySelector('.wctop'), cs=getComputedStyle(c), inner=c.clientWidth-parseFloat(cs.paddingLeft)-parseFloat(cs.paddingRight)-c.querySelector('.check').offsetWidth-parseFloat(cs.columnGap||cs.gap||0);
    return {two:c.classList.contains('two'), inTop:!!g&&!!top&&top.contains(g), second:!!top&&top.nextElementSibling===t, tm:top&&(top.querySelector('.tm')||{}).textContent||null,
      tw:t.getBoundingClientRect().width, inner, h:c.getBoundingClientRect().height, cap:g?g.textContent:null, before:!!g&&g.nextElementSibling===t, color:g?getComputedStyle(g).color:null, bg:g?getComputedStyle(g).backgroundColor:null, tip:c.title, drag:c.getAttribute('draggable')}; }, id);
  const a1=await card('a1'), b1=await card('b1'), n1=await card('n1'), h1=await card('h1'), z1=await card('z1'), d1=await card('d1'), u1=await card('u1');
  // Two lines with a project or a time: the capsule (and the time on the right) over the title, which takes the card's whole width;
  // none of either: one line (7 days and the Sin fecha tray open at 1440 px)
  check('two_lines', a1.two && !n1.two && n1.h<32 && a1.h>=38 && h1.two && h1.tm==='08:15' && h1.cap===null && u1&&u1.two&&u1.cap==='Transf'
    && [a1, b1, d1, u1].every(c=>Math.abs(c.tw-c.inner)<=2) && a1.tw>=70, {a1, n1, h1, u1});
  check('week_caps', a1&&a1.cap==='FLC'&&a1.two&&a1.inTop&&a1.second&&b1.cap==='Transf'&&d1.cap==='2026'&&z1.cap==='Archiv'&&n1&&n1.cap===null&&h1.cap===null, {a1, b1, n1, h1, z1, d1});
  check('week_tooltip_drag', /\nFLC Comité/.test(a1.tip) && /\nTransformación digital/.test(b1.tip) && a1.drag==='true', {a1, b1});
  // The list capsule's colors: the project's tag colors, not a plain grey
  const tagC = await pg.evaluate(()=>{ const s=document.createElement('span'); s.className='tag'; s.textContent='x'; const w=document.createElement('div'); w.setAttribute('style', tagVars('#FF9500')); w.appendChild(s); document.body.appendChild(w); const o={c:getComputedStyle(s).color, b:getComputedStyle(s).backgroundColor}; w.remove(); return o; });
  check('week_cap_colors', b1.color===tagC.c && b1.bg===tagC.b && b1.color!==a1.color, {b1, a1, tagC});
  const dayOrder = d => pg.evaluate(d=>[...document.querySelectorAll('#desk .main [data-day="'+d+'"] .wcard')].map(c=>c.dataset.id), d);
  // The rule: the timed ones first by time (h1 8:15, h2 9:30), then the ranks of the sidebar never go back (archived, then no project last);
  // within FLC the high one first (the lists' order)
  const rank = id => { if(id==='c2') return 2; const x=tasks.find(k=>k.id===id), p=x&&projects.find(q=>q.id===x.projectId); return !x.projectId?99:p.archived?50:p.order; };
  const ranked = ids => ids.every((id,i)=>i===0||rank(ids[i-1])<=rank(id));
  const o0 = await dayOrder(t);
  check('week_order_today', o0.slice(0,2).join()==='h1,h2' && ranked(o0.slice(2)) && o0.indexOf('a1')<o0.indexOf('a2') && o0[o0.length-1]==='n1' && o0.length===9, o0);
  const o1 = await dayOrder(D1);
  check('week_order_tomorrow', o1.join()==='d2,d1', o1);
  await shot(pg, 'pc-desk-light-semana');
  await pg.evaluate(()=>{ DB.settings.calMode='list'; save(); setDeskView('day'); }); await calm(pg); await shot(pg, 'pc-desk-light-dia');
  await pg.evaluate(()=>{ setDeskView('week'); }); await calm(pg);

  /* ---------- Día and the hours view ---------- */
  await pg.evaluate(()=>{ DB.settings.calMode='hours'; save(); setDeskView('day'); }); await calm(pg);
  const hrs = await pg.evaluate(()=>[...document.querySelectorAll('#desk .main .wcard:not(.wtray .wcard)')].map(c=>({id:c.dataset.id, hb:c.classList.contains('hb'), cap:(c.querySelector('.ctag')||{}).textContent||null})));
  const allDay = hrs.filter(x=>!x.hb).map(x=>x.id), blocks = hrs.filter(x=>x.hb);
  const oldFirst3 = await pg.evaluate(()=>calTimeSort(calTasks(todayStr(), todayStr()).filter(x=>x.date===todayStr()&&!inGrid(x))).slice(0,3).map(x=>x.id));
  check('hours_allday_order', allDay.length===3 && allDay.includes('a1') && oldFirst3.every(id=>allDay.includes(id)) && ranked(allDay) && !allDay.includes('h1') && !allDay.includes('h2'), {allDay, oldFirst3, hrs});
  check('hours_caps', blocks.length===2 && blocks.find(x=>x.id==='h2').cap==='Oca' && blocks.find(x=>x.id==='h1').cap===null && hrs.find(x=>x.id==='a1').cap==='FLC', hrs);
  await pg.evaluate(()=>document.querySelector('#desk .wcard.hb[data-id=h2]').scrollIntoView({block:'center'})); await pg.waitForTimeout(200);
  await shot(pg, 'pc-desk-light-horas');
  await pg.evaluate(()=>{ DB.settings.calMode='list'; save(); setDeskView('day'); }); await calm(pg);
  const dayList = await pg.evaluate(()=>[...document.querySelectorAll('#desk .main .wcard:not(.wtray .wcard)')].map(c=>c.dataset.id+':'+((c.querySelector('.ctag')||{}).textContent||'')));
  const dIds = dayList.map(x=>x.split(':')[0]), dCap = Object.fromEntries(dayList.map(x=>x.split(':')));
  check('day_list', dIds.slice(0,2).join()==='h1,h2' && ranked(dIds.slice(2)) && dIds[dIds.length-1]==='n1' && dCap.h1==='' && dCap.h2==='Oca' && dCap.a1==='FLC' && dCap.b1==='Transf' && dCap.c1==='Oca' && dCap.z1==='Archiv' && dCap.n1==='', dayList);
  // Semana in the hours view: the blocks of tomorrow too
  await pg.evaluate(()=>{ DB.settings.calMode='hours'; save(); setDeskView('week'); }); await calm(pg);
  const wh = await pg.evaluate(()=>{ const c=document.querySelector('#desk .main .wcard.hb[data-id=d2]'); return c&&(c.querySelector('.ctag')||{}).textContent; });
  check('week_hours_block_cap', wh==='Transf', wh);

  /* ---------- Mes: 4 letters ---------- */
  await pg.evaluate(()=>{ DB.settings.calMode='list'; save(); setDeskView('month'); }); await calm(pg);
  const mo = await pg.evaluate(t=>[...document.querySelectorAll('#desk .main .mday[data-day="'+t+'"] .wcard.mc')].map(c=>c.dataset.id+':'+((c.querySelector('.ctag')||{}).textContent||'')), t);
  // Four of the day: chosen in the previous order (time, then the lists' order), shown grouped by project
  const mo4 = await pg.evaluate(t=>calSort(calTimeSort(calTasks(t, t).filter(x=>x.date===t)).slice(0,4)).map(x=>x.id+':'+(x.projectId?projShort(proj(x.projectId).name, 4):'')), t);
  check('month_caps', mo.join()===mo4.join() && mo.slice(0,3).join()==='h1:,h2:Oca,a1:FLC', {mo, mo4});
  const mb = await pg.evaluate(d=>{ const c=document.querySelector('#desk .main .wcard.mc[data-id=b1]')||document.querySelector('#desk .main .mday[data-day="'+d+'"] .wcard.mc[data-id=d2]'); return c&&(c.querySelector('.ctag')||{}).textContent; }, D1);
  check('month_cap_4', mb==='Tran', mb);
  await shot(pg, 'pc-desk-light-mes');

  /* ---------- A day that shows only some of its tasks picks them in the previous order (time, then priority), then groups them ---------- */
  // A second high priority in Oca (third in the sidebar): grouped first, it would fall behind «N más»
  await pg.evaluate(t=>{ DB.tasks.push({id:'c2', title:'Urgente de Oca', spaceId:'trabajo', projectId:'p3', date:t, reminder:null, priority:'high', status:'pending', notes:'', carried:false, created:new Date().toISOString(), modified:new Date().toISOString(), completed:null}); render(); }, t); await calm(pg);
  const mo2 = await pg.evaluate(t=>{ const c=document.querySelector('#desk .main .mday[data-day="'+t+'"]'); return {ids:[...c.querySelectorAll('.wcard.mc')].map(x=>x.dataset.id), more:(c.querySelector('.mmore')||{}).textContent||''}; }, t);
  check('month_pick_priority', mo2.ids.join()==='h1,h2,a1,c2' && mo2.more==='6 más', mo2);
  await pg.evaluate(()=>{ DB.settings.calMode='hours'; save(); setDeskView('day'); }); await calm(pg);
  const ad2 = await pg.evaluate(()=>({ids:[...document.querySelectorAll('#desk .main .hallday .wcard')].map(c=>c.dataset.id), more:(document.querySelector('#desk .main .hallday .hmore')||{}).textContent||''}));
  check('allday_pick_priority', ad2.ids.length===3 && ad2.ids.includes('a1') && ad2.ids.includes('c2') && ranked(ad2.ids) && ad2.more==='5 más', ad2);
  await pg.evaluate(()=>{ UI.allDayOpen=todayStr(); render(); }); await calm(pg);
  const ad3 = await pg.evaluate(()=>[...document.querySelectorAll('#desk .main .hallday .wcard')].map(c=>c.dataset.id));
  check('allday_open_grouped', ad3.length===8 && ranked(ad3), ad3);
  // Week and Day lists are not cut: grouped by project as before
  await pg.evaluate(()=>{ UI.allDayOpen=null; DB.settings.calMode='list'; save(); setDeskView('week'); }); await calm(pg);
  const wk2 = await dayOrder(t); check('week_not_cut_grouped', wk2.length===10 && ranked(wk2.slice(2)) && wk2.indexOf('c2')>wk2.indexOf('b1'), wk2);
  await pg.evaluate(()=>{ DB.tasks=DB.tasks.filter(x=>x.id!=='c2'); render(); }); await calm(pg);

  /* ---------- The weekend column (Solo de lunes a viernes) keeps the rule ---------- */
  const wk = await pg.evaluate(()=>{ const sat=(()=>{ let d=todayStr(); while(!isWeekend(d)) d=addDays(d,1); return d; })();
    DB.tasks.push({id:'w1', title:'Sábado de FLC', spaceId:'trabajo', projectId:'p1', date:sat, reminder:null, priority:'none', status:'pending', notes:'', carried:false, created:new Date().toISOString(), modified:new Date().toISOString(), completed:null});
    DB.tasks.push({id:'w2', title:'Sábado sin proyecto', spaceId:'trabajo', projectId:null, date:sat, reminder:null, priority:'none', status:'pending', notes:'', carried:false, created:new Date().toISOString(), modified:new Date().toISOString(), completed:null});
    setWorkWeek(true); DB.settings.calMode='list'; save(); setDeskView('week');
    return [...document.querySelectorAll('#desk .wwkd .wcard')].filter(c=>/^w\d$/.test(c.dataset.id)).map(c=>c.dataset.id+':'+((c.querySelector('.ctag')||{}).textContent||'')); });
  check('weekend_caps', wk.join()==='w1:FLC,w2:', wk);
  await pg.evaluate(()=>{ DB.tasks=DB.tasks.filter(x=>!/^w\d$/.test(x.id)); setWorkWeek(false); save(); }); await calm(pg);

  /* ---------- Dragging still works: a card dropped on another day takes that date ---------- */
  await pg.evaluate(()=>{ DB.settings.calMode='list'; save(); setDeskView('week'); }); await calm(pg);
  await pg.dragAndDrop('#desk .main .wcard[data-id=c1]', '#desk .main [data-day="'+D2+'"] .wl');
  check('drag_still_works', await until(pg, d=>task('c1').date===d, D2, 4000), await pg.evaluate(()=>task('c1').date));
  const o2 = await dayOrder(D2); check('drag_order', o2.join()==='d3,c1', o2);
  await pg.evaluate(()=>{ updTask('c1', {date:todayStr()}); render(); }); await calm(pg);
  await L.ctx.close();

  /* ---------- Dark ---------- */
  const Dk = await open(browser, {tag:'D', seed, dark:true}); const dp=Dk.page;
  await dp.evaluate(()=>{ DB.settings.calMode='list'; save(); setDeskView('week'); }); await calm(dp);
  const dk = await dp.evaluate(()=>{ const g=document.querySelector('#desk .main .wcard[data-id=b1] .ctag'), w=document.createElement('div'), s=document.createElement('span'); s.className='tag'; w.setAttribute('style', tagVars('#FF9500')); w.appendChild(s); document.body.appendChild(w);
    const o={c:getComputedStyle(g).color, ref:getComputedStyle(s).color}; w.remove(); return o; });
  check('dark_cap_colors', dk.c===dk.ref, dk);
  await shot(dp, 'pc-desk-dark-semana');
  await dp.evaluate(()=>{ DB.settings.calMode='list'; save(); setDeskView('day'); }); await calm(dp); await shot(dp, 'pc-desk-dark-dia');
  await dp.evaluate(()=>{ DB.settings.calMode='hours'; save(); setDeskView('week'); }); await calm(dp); await dp.evaluate(()=>document.querySelector('#desk .wcard.hb[data-id=h2]').scrollIntoView({block:'center'})); await dp.waitForTimeout(200);
  await shot(dp, 'pc-desk-dark-horas');
  await dp.evaluate(()=>{ DB.settings.calMode='list'; save(); setDeskView('month'); }); await calm(dp); await shot(dp, 'pc-desk-dark-mes');
  await Dk.ctx.close();
}

(async()=>{
  const srv = await TF.serve(PORT); const browser = await chromium.launch();
  try { await run(browser); } catch(e){ errors.push(e.stack||e.message); }
  await browser.close(); srv.close();
  console.log(JSON.stringify({r, fails, errors}, null, 1)); process.exit(fails.length||errors.length?1:0);
})();
