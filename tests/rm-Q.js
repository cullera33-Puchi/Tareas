require('./lib/out.js'); // outputs (screenshots, downloads) go to tests/out
// Decision 27 (quick decisions of 2 November), port 9810. Clock: Wednesday 4 Nov 2026 10:10.
//  a. The Fecha picker moves a reminder on the old day to the new day at the same time, with Deshacer (iPhone sheet, desktop inspector popover);
//     Sin fecha and a reminder on another day are left alone.
//  b. iPhone: the + and Añadir tarea with Hoy showing propose today and the filtered project as removable tokens; Todas, a search and a
//     project screen as before. Desktop: the add bar in Hoy takes the project filter too.
//  c. iPhone: with a row's buttons (or a voice note's) showing, the first touch elsewhere only closes it.
//  d. iPhone: the row's gray line has no middle dot.
const L = require('./lib/lib.js');
const path = require('path');
const PORT=9810, URL='http://localhost:'+PORT+'/', OUT=path.join(__dirname, 'out', 'Q');
const r={}, fails=[]; const check=(name, ok, info)=>{ r[name]=ok?true:(info===undefined?false:info); if(!ok) fails.push(name); };
const NOW = new Date(2026,10,4,10,10);
const iso = (...a)=>new Date(...a).toISOString();
const TODAY='2026-11-04', TOM='2026-11-05', NEXTMON='2026-11-09';
const rows = '.screen.root:not(.hidden-tab) .scroll .group:not(.first) .row[data-id]';
const rowOf = id => '.screen.root:not(.hidden-tab) .scroll .group:not(.first) .row[data-id="'+id+'"]';

async function seed(page){
  await page.evaluate(({TODAY,TOM,rem})=>{
    const a=addProject('FLC','#FF3B30'), b=addProject('Obra','#34C759');
    const T=(id,title,o)=>addTask(Object.assign({id,title},o));
    T('q1','Revisar contrato',{date:TODAY, projectId:a.id, priority:'high'});
    T('q2','Llamar a Marta',{date:TODAY, carried:true, projectId:b.id, reminder:rem.today18});
    T('q3','Preparar comité',{date:TOM, projectId:a.id, reminder:rem.tom9});
    T('q4','Enviar acta',{date:TOM, reminder:rem.fri12});
    T('q5','Pedir presupuesto',{date:TODAY});
    T('q6','Revisar planos',{date:TODAY, projectId:b.id});
    T('q7','Cerrar pedido',{date:TODAY, projectId:a.id});
    T('q8','Tarea sin fecha',{reminder:rem.tom9});
    { const t=new Date().toISOString(); DB.attachments.push({id:'vq1', taskId:'q1', kind:'audio', path:null, mime:'audio/mp4', size:4000, width:null, height:null, durationMs:5000, created:t, modified:t}); } // decision 49: a voice note is a recording
    window.__P={flc:a.id, obra:b.id}; save(); render();
  }, {TODAY, TOM, rem:{today18:iso(2026,10,4,18,0), tom9:iso(2026,10,5,9,0), fri12:iso(2026,10,6,12,0)}});
  await page.waitForTimeout(400); return page.evaluate(()=>window.__P);
}
const st = (page,id)=>page.evaluate(id=>{ const x=task(id); return {date:x.date, reminder:x.reminder, sent:x.reminderSent||null, carried:!!x.carried, projectId:x.projectId}; }, id);
const sheetOn = page=>page.evaluate(()=>document.querySelector('#sheet').classList.contains('on'));
const toastText = page=>page.evaluate(()=>document.querySelector('#toast').classList.contains('on')?document.querySelector('#toastText').textContent:'');
async function tapSel(page, sel){ const b=await L.box(page, sel); if(!b) throw new Error('no '+sel); await L.tapAt(page, b.cx, b.cy); }
async function closeSheetNow(page){ await page.evaluate(()=>closeSheet()); await page.waitForTimeout(650); }
async function openRowSwipe(page, id){ await page.evaluate(s=>document.querySelector(s).scrollIntoView({block:'center'}), rowOf(id)); await page.waitForTimeout(150);
  const b=await L.box(page, rowOf(id)); await L.touchDrag(page, b.x+b.w-40, b.cy, -150, 0, 10, 16); await page.waitForTimeout(500);
  return page.evaluate(id=>!!openRow&&openRow.dataset.id===id&&openRow.dataset.open==='1', id); }

(async()=>{
  await L.serve(PORT); const browser = await L.chromium.launch();

  /* ================= iPhone ================= */
  let {ctx, page} = await L.open(browser, URL, {now:NOW}); const P = await seed(page);

  // ---- (a) Fecha sheet in the detail ----
  await page.evaluate(()=>openDetail('q3')); await page.waitForTimeout(700);
  await tapSel(page, '.pushed-screen [data-act=pickDate]'); await page.waitForTimeout(600);
  await tapSel(page, '#sheet .chips [data-d="'+NEXTMON+'"]'); await page.waitForTimeout(700);
  let s = await st(page,'q3'); let tt = await toastText(page);
  check('a_moved', s.date===NEXTMON && s.reminder===iso(2026,10,9,9,0) && !s.sent, s);
  check('a_toast', /^Movida a .*, recordatorio a las 0?9:00$/.test(tt), tt);
  await page.click('#toastBtn'); await page.waitForTimeout(500);
  s = await st(page,'q3'); check('a_undo', s.date===TOM && s.reminder===iso(2026,10,5,9,0) && !s.sent, s);
  // A calendar day: same rule
  await tapSel(page, '.pushed-screen [data-act=pickDate]'); await page.waitForTimeout(600);
  await page.evaluate(()=>{ const b=document.querySelector('#sheet .cal [data-d="2026-11-20"]')||document.querySelector('#sheet [data-d="2026-11-20"]'); b.scrollIntoView({block:'center'}); }); await page.waitForTimeout(200);
  await tapSel(page, '#sheet [data-d="2026-11-20"]'); await page.waitForTimeout(700);
  s = await st(page,'q3'); check('a_calendar', s.date==='2026-11-20' && s.reminder===iso(2026,10,20,9,0), s);
  // Hoy: the reminder lands at 9:00 today, already past at 10:10, kept but marked as sent
  await tapSel(page, '.pushed-screen [data-act=pickDate]'); await page.waitForTimeout(600);
  await tapSel(page, '#sheet .chips [data-d="'+TODAY+'"]'); await page.waitForTimeout(700);
  s = await st(page,'q3'); check('a_today_past', s.date===TODAY && s.reminder===iso(2026,10,4,9,0) && !!s.sent, s);
  // Sin fecha leaves the reminder as it is, with no reminder toast
  await page.evaluate(()=>document.querySelector('#toast').classList.remove('on'));
  await tapSel(page, '.pushed-screen [data-act=pickDate]'); await page.waitForTimeout(600);
  await tapSel(page, '#sheet .chips [data-d=""]'); await page.waitForTimeout(700);
  s = await st(page,'q3'); tt = await toastText(page); check('a_nodate', s.date===null && s.reminder===iso(2026,10,4,9,0) && !/recordatorio/.test(tt), {s, tt});
  await page.evaluate(()=>pop()); await page.waitForTimeout(700);
  // A reminder on another day than the task's date stays put
  await page.evaluate(()=>openDetail('q4')); await page.waitForTimeout(700);
  await tapSel(page, '.pushed-screen [data-act=pickDate]'); await page.waitForTimeout(600);
  await tapSel(page, '#sheet .chips [data-d="'+NEXTMON+'"]'); await page.waitForTimeout(700);
  s = await st(page,'q4'); check('a_otherday', s.date===NEXTMON && s.reminder===iso(2026,10,6,12,0), s);
  // A task with no date gets one: nothing to move
  await page.evaluate(()=>pop()); await page.waitForTimeout(700);
  await page.evaluate(()=>openDetail('q8')); await page.waitForTimeout(700);
  await tapSel(page, '.pushed-screen [data-act=pickDate]'); await page.waitForTimeout(600);
  await tapSel(page, '#sheet .chips [data-d="'+NEXTMON+'"]'); await page.waitForTimeout(700);
  s = await st(page,'q8'); check('a_undated', s.date===NEXTMON && s.reminder===iso(2026,10,5,9,0), s);
  await page.evaluate(()=>pop()); await page.waitForTimeout(700);
  await page.evaluate(()=>{ updTask('q3',{date:'2026-11-05', reminder:new Date(2026,10,5,9,0).toISOString()}); updTask('q4',{date:'2026-11-05'}); updTask('q8',{date:null}); render(); }); await page.waitForTimeout(300);

  // ---- (b) the + and Añadir tarea ----
  const addState = ()=>page.evaluate(()=>({on:document.querySelector('#sheet').classList.contains('on'), toks:[...document.querySelectorAll('#qtoks [data-tok]')].map(t=>t.dataset.tok+':'+t.textContent.replace('×','').trim())}));
  const typeAdd = async (title)=>{ await page.keyboard.type(title); await page.keyboard.press('Enter'); await page.waitForTimeout(250); };
  const lastTask = ()=>page.evaluate(()=>{ const x=DB.tasks[DB.tasks.length-1]; return {title:x.title, date:x.date, projectId:x.projectId}; });
  await tapSel(page, '.screen.root:not(.hidden-tab) .fab'); await page.waitForTimeout(700);
  let as = await addState(); check('b_hoy_tokens', as.on && as.toks.length===1 && as.toks[0]==='date:Hoy', as);
  await typeAdd('Alta rápida'); let lt = await lastTask(); check('b_hoy_task', lt.title==='Alta rápida' && lt.date===TODAY && !lt.projectId, lt);
  await typeAdd('Segunda alta'); lt = await lastTask(); check('b_hoy_series', lt.date===TODAY, lt); // alta en serie keeps the proposal
  await page.screenshot({path:path.join(OUT,'q-m-add-hoy.png')});
  await closeSheetNow(page);
  // With a project filter: today and the project, both removable
  await page.evaluate(id=>{ UI.projFilter=id; render(); }, P.flc); await page.waitForTimeout(400);
  await tapSel(page, '.screen.root:not(.hidden-tab) .fab'); await page.waitForTimeout(700);
  as = await addState(); check('b_filter_tokens', as.toks.join('|')==='date:Hoy|proj:FLC', as);
  await page.screenshot({path:path.join(OUT,'q-m-add-filter.png')});
  await typeAdd('Con filtro'); lt = await lastTask(); check('b_filter_task', lt.date===TODAY && lt.projectId===P.flc, lt);
  await page.click('#sheet [data-untok=proj]'); await page.waitForTimeout(200);
  await typeAdd('Sin el proyecto'); lt = await lastTask(); check('b_untok_proj', lt.date===TODAY && !lt.projectId, lt);
  await page.click('#sheet [data-untok=date]'); await page.waitForTimeout(200);
  as = await addState(); await typeAdd('Sin nada'); lt = await lastTask(); check('b_untok_date', as.toks.length===0 && !lt.date && !lt.projectId, {as, lt});
  await closeSheetNow(page);
  // Filter 'none' (Sin proyecto): today only
  await page.evaluate(()=>{ UI.projFilter='none'; render(); }); await page.waitForTimeout(300);
  await tapSel(page, '.screen.root:not(.hidden-tab) .fab'); await page.waitForTimeout(700);
  as = await addState(); check('b_filter_none', as.toks.join('|')==='date:Hoy', as); await closeSheetNow(page);
  await page.evaluate(()=>{ UI.projFilter=null; render(); }); await page.waitForTimeout(300);
  // Todas: nothing proposed
  await tapSel(page, '.screen.root:not(.hidden-tab) [data-filter=todas]'); await page.waitForTimeout(500);
  await tapSel(page, '.screen.root:not(.hidden-tab) .fab'); await page.waitForTimeout(700);
  as = await addState(); check('b_todas', as.on && as.toks.length===0, as); await closeSheetNow(page);
  await tapSel(page, '.screen.root:not(.hidden-tab) [data-filter=hoy]'); await page.waitForTimeout(500);
  // A search in Hoy: nothing proposed
  await page.evaluate(()=>{ UI.query='revisar'; render(); }); await page.waitForTimeout(400);
  await tapSel(page, '.screen.root:not(.hidden-tab) .fab'); await page.waitForTimeout(700);
  as = await addState(); check('b_search', as.on && as.toks.length===0, as); await closeSheetNow(page);
  await page.evaluate(()=>{ UI.query=''; render(); }); await page.waitForTimeout(300);
  // A project screen: its project, no date (as before)
  await page.evaluate(id=>push('project', id), P.obra); await page.waitForTimeout(800);
  await tapSel(page, '.pushed-screen .fab'); await page.waitForTimeout(700);
  as = await addState(); check('b_project_screen', as.toks.join('|')==='proj:Obra', as); await closeSheetNow(page);
  await page.evaluate(()=>pop()); await page.waitForTimeout(700);
  // Añadir tarea in an empty Hoy (Personal has nothing)
  await page.evaluate(()=>{ DB.settings.activeSpace='personal'; resetListState(); save(); render(); }); await page.waitForTimeout(400);
  const hasLink = await page.$('.screen.root:not(.hidden-tab) .btn-link[data-act=add]');
  if(hasLink){ await tapSel(page, '.screen.root:not(.hidden-tab) .btn-link[data-act=add]'); await page.waitForTimeout(700); }
  as = await addState(); check('b_link_empty_hoy', !!hasLink && as.toks.join('|')==='date:Hoy', as); await closeSheetNow(page);
  await page.evaluate(()=>{ DB.settings.activeSpace='trabajo'; resetListState(); save(); render(); }); await page.waitForTimeout(400);

  // ---- (d) the row's gray line ----
  r.d = await page.evaluate(()=>{ const out={}; const m=document.querySelector('.screen.root:not(.hidden-tab) .row[data-id="q2"] .row-meta');
    out.text=m?m.textContent:null; out.sep=document.querySelectorAll('.row-meta .sep').length; const sp=m?[...m.children]:[]; out.n=sp.length; out.gap=sp.length>1?parseFloat(getComputedStyle(sp[1]).marginLeft):0;
    out.dots=[...document.querySelectorAll('.row-meta')].filter(e=>e.textContent.includes('·')).length; return out; });
  check('d_no_dot', r.d.text && !r.d.text.includes('·') && r.d.sep===0 && r.d.dots===0 && r.d.n>=2 && r.d.gap>=6, r.d);
  await page.screenshot({path:path.join(OUT,'q-m-hoy.png')});

  // ---- (c) the first touch only closes an open row ----
  await page.evaluate(()=>{ UI.tab='tareas'; render(); }); await page.waitForTimeout(300);
  check('c_open1', await openRowSwipe(page,'q5'));
  await page.screenshot({path:path.join(OUT,'q-m-row-open.png')});
  await tapSel(page, rowOf('q6')+' .row-title'); await page.waitForTimeout(700);
  r.c1 = await page.evaluate(()=>({stack:UI.stack.length, open:!!openRow, q5:document.querySelector('.screen.root:not(.hidden-tab) .row[data-id="q5"]').dataset.open}));
  check('c_row_tap_closes_only', r.c1.stack===0 && !r.c1.open && r.c1.q5!=='1', r.c1);
  await tapSel(page, rowOf('q6')+' .row-title'); await page.waitForTimeout(800); // the next tap acts
  check('c_next_tap_opens', await page.evaluate(()=>UI.stack.length===1&&UI.stack[0].id==='q6'));
  await page.evaluate(()=>pop()); await page.waitForTimeout(700);
  // The circle of another row does not complete it
  check('c_open2', await openRowSwipe(page,'q5'));
  await tapSel(page, rowOf('q6')+' .check'); await page.waitForTimeout(400);
  check('c_check_ignored', await page.evaluate(()=>!HELD.has('q6')&&task('q6').status==='pending'&&!openRow));
  // Segment, figure, tab, + and the search field
  const probes = [
    ['c_segment', '.screen.root:not(.hidden-tab) [data-filter=todas]', ()=>DB.settings.filter==='hoy'],
    ['c_figure', '.screen.root:not(.hidden-tab) [data-sum]', ()=>UI.sumFilter===null],
    ['c_tab', '#tabbar [data-tab=proyectos]', ()=>UI.tab==='tareas'],
    ['c_fab', '.screen.root:not(.hidden-tab) .fab', ()=>!document.querySelector('#sheet').classList.contains('on')],
    ['c_chip', '.screen.root:not(.hidden-tab) .pchips [data-pf]', ()=>UI.projFilter===null],
    ['c_search', '.screen.root:not(.hidden-tab) [data-role=search]', ()=>document.activeElement===document.body||!document.activeElement.matches('[data-role=search]')],
  ];
  for(const [name, sel, fn] of probes){
    await page.evaluate(()=>document.querySelector('.screen.root:not(.hidden-tab) .scroll').scrollTo(0,0)); await page.waitForTimeout(150);
    const ok1 = await openRowSwipe(page,'q5'); await page.evaluate(()=>document.querySelector('.screen.root:not(.hidden-tab) .scroll').scrollTo(0,0)); await page.waitForTimeout(150);
    const has = await page.$(sel); if(!has){ check(name, false, 'no '+sel); continue; }
    await tapSel(page, sel); await page.waitForTimeout(600);
    const ok = await page.evaluate(fn); const closed = await page.evaluate(()=>!openRow);
    check(name, ok1 && ok && closed, {ok1, ok, closed});
    await page.evaluate(()=>{ if(document.querySelector('#sheet').classList.contains('on')) closeSheet(); if(document.activeElement) document.activeElement.blur(); }); await page.waitForTimeout(400);
  }
  // A scroll with that first touch closes the row and acts on nothing; the list may scroll
  check('c_open3', await openRowSwipe(page,'q5'));
  { const b=await L.box(page, rowOf('q7')); await L.touchDrag(page, b.cx, b.cy, 0, -120, 8, 16); await page.waitForTimeout(600); }
  r.c3 = await page.evaluate(()=>({open:!!openRow, stack:UI.stack.length, pm:!!PM}));
  check('c_scroll_closes', !r.c3.open && r.c3.stack===0 && !r.c3.pm, r.c3);
  // A long press on another row: no menu
  check('c_open4', await openRowSwipe(page,'q5'));
  { const b=await L.box(page, rowOf('q6')); await L.longPress(page, b.cx, b.cy, 800); await page.waitForTimeout(400); }
  r.c4 = await page.evaluate(()=>({open:!!openRow, pm:!!PM, stack:UI.stack.length}));
  check('c_longpress_ignored', !r.c4.open && !r.c4.pm && r.c4.stack===0, r.c4);
  await page.evaluate(()=>{ if(PM) closeMenu(true); }); await page.waitForTimeout(300);
  // A swipe on another row with that first touch does not open it
  check('c_open5', await openRowSwipe(page,'q5'));
  { const b=await L.box(page, rowOf('q6')); await L.touchDrag(page, b.x+b.w-40, b.cy, -150, 0, 10, 16); await page.waitForTimeout(500); }
  check('c_swipe_other_closes_only', await page.evaluate(()=>!openRow && document.querySelector('.screen.root:not(.hidden-tab) .row[data-id="q6"]').dataset.open!=='1'));
  // The open row's own buttons keep working
  check('c_open6', await openRowSwipe(page,'q5'));
  await tapSel(page, rowOf('q5')+' .b-delete'); await page.waitForTimeout(700);
  check('c_own_delete', await page.evaluate(()=>document.querySelector('#asheet').classList.contains('on')));
  await page.evaluate(()=>closeSheet()); await page.waitForTimeout(600);
  check('c_open7', await openRowSwipe(page,'q5'));
  await tapSel(page, rowOf('q5')+' .b-tomorrow'); await page.waitForTimeout(700);
  check('c_own_postpone', await page.evaluate(()=>!!PM));
  await page.evaluate(()=>closeMenu(true)); await page.waitForTimeout(400);
  // A tap on the open row's content closes it (as before) and opens nothing
  check('c_open8', await openRowSwipe(page,'q5'));
  await tapSel(page, rowOf('q5')+' .row-title'); await page.waitForTimeout(600);
  check('c_own_content_closes', await page.evaluate(()=>!openRow&&!UI.stack.length));
  // Voice notes (recordings, decision 49) in the detail
  await page.evaluate(()=>openDetail('q1')); await page.waitForTimeout(800);
  { const b=await L.box(page, '.pushed-screen .vn[data-au=vq1]'); await L.touchDrag(page, b.x+b.w-40, b.cy, -100, 0, 8, 16); await page.waitForTimeout(500); }
  check('c_vn_open', await page.evaluate(()=>!!openVn&&openVn.dataset.open==='l'));
  await tapSel(page, '.pushed-screen textarea'); await page.waitForTimeout(500);
  r.c5 = await page.evaluate(()=>({open:!!openVn, focus:document.activeElement&&document.activeElement.tagName}));
  check('c_vn_tap_closes_only', !r.c5.open && r.c5.focus!=='TEXTAREA', r.c5);
  { const b=await L.box(page, '.pushed-screen .vn[data-au=vq1]'); await L.touchDrag(page, b.x+b.w-40, b.cy, -100, 0, 8, 16); await page.waitForTimeout(500); }
  await tapSel(page, '.pushed-screen .vn[data-au=vq1] [data-aact=del]'); await page.waitForTimeout(500);
  check('c_vn_own_button', await page.evaluate(()=>!DB.attachments.some(a=>a.id==='vq1')));
  await page.evaluate(()=>pop()); await page.waitForTimeout(700);
  await ctx.close();

  // Dark iPhone screenshot of the rows (d)
  ({ctx, page} = await L.open(browser, URL, {now:NOW, theme:'dark'})); await seed(page);
  await page.screenshot({path:path.join(OUT,'q-m-hoy-dark.png')});
  check('d_dark_no_dot', await page.evaluate(()=>![...document.querySelectorAll('.row-meta')].some(e=>e.textContent.includes('·'))));
  await ctx.close();

  /* ================= Desktop ================= */
  ({ctx, page} = await L.open(browser, URL, {now:NOW, desk:true})); const PD = await seed(page);
  // (a) the inspector's Fecha popover
  await page.evaluate(()=>{ openDetail('q3'); }); await page.waitForTimeout(600);
  await page.click('#desk .pane [data-act=pickDate]'); await page.waitForTimeout(600);
  await page.click('.pm [data-d="'+NEXTMON+'"]'); await page.waitForTimeout(600);
  s = await st(page,'q3'); tt = await toastText(page);
  check('D_a_moved', s.date===NEXTMON && s.reminder===iso(2026,10,9,9,0), s); check('D_a_toast', /recordatorio a las 0?9:00$/.test(tt), tt);
  await page.screenshot({path:path.join(OUT,'q-d-moved.png')});
  await page.click('#toastBtn'); await page.waitForTimeout(500);
  s = await st(page,'q3'); check('D_a_undo', s.date===TOM && s.reminder===iso(2026,10,5,9,0), s);
  await page.click('#desk .pane [data-act=pickDate]'); await page.waitForTimeout(600);
  await page.click('.pm [data-d=""]'); await page.waitForTimeout(600);
  s = await st(page,'q3'); check('D_a_nodate', s.date===null && s.reminder===iso(2026,10,5,9,0), s);
  // (b) the add bar in Hoy takes the project filter; Todas proposes nothing
  await page.evaluate(id=>{ UI.deskDetail=null; setDeskView('hoy'); UI.projFilter=id; render(); }, PD.obra); await page.waitForTimeout(500);
  await page.click('#desk [data-role=addbar]'); await page.keyboard.type('Desde la barra'); await page.waitForTimeout(200);
  r.D_said = await page.evaluate(()=>document.querySelector('#deskSaid').textContent);
  await page.keyboard.press('Enter'); await page.waitForTimeout(500);
  let x = await page.evaluate(()=>{ const x=DB.tasks[DB.tasks.length-1]; return {title:x.title, date:x.date, projectId:x.projectId}; });
  check('D_b_filter', x.title==='Desde la barra' && x.date===TODAY && x.projectId===PD.obra, x);
  await page.click('#desk [data-role=addbar]'); await page.keyboard.type('Otra #flc'); await page.keyboard.press('Enter'); await page.waitForTimeout(500);
  x = await page.evaluate(()=>{ const x=DB.tasks[DB.tasks.length-1]; return {title:x.title, date:x.date, projectId:x.projectId}; });
  check('D_b_title_wins', x.title==='Otra' && x.projectId===PD.flc, x);
  await page.evaluate(()=>{ setDeskView('todas'); UI.projFilter=null; render(); }); await page.waitForTimeout(400);
  await page.click('#desk [data-role=addbar]'); await page.keyboard.type('En todas'); await page.keyboard.press('Enter'); await page.waitForTimeout(500);
  x = await page.evaluate(()=>{ const x=DB.tasks[DB.tasks.length-1]; return {title:x.title, date:x.date, projectId:x.projectId}; });
  check('D_b_todas', x.title==='En todas' && !x.date && !x.projectId, x);
  await page.screenshot({path:path.join(OUT,'q-d-todas.png')});
  await ctx.close();

  await browser.close();
  const errors = L.errors.slice();
  console.log(JSON.stringify({r, fails, errors}, null, 1));
  process.exit(fails.length||errors.length?1:0);
})().catch(e=>{ console.log(JSON.stringify({fatal:String(e&&e.stack||e), errors:['fatal']})); process.exit(2); });
