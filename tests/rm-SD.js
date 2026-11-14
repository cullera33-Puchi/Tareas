require('./lib/out.js'); // outputs (screenshots, downloads) go to tests/out
// Decision 85: Algún día, approved by the owner on 14 November. Port 8834. Screenshots in tests/out/SD.
//  1. Data rules (in the page): a task in Algún día is out of Hoy, Todas, Sin fecha, the projects' counts, the forgotten ones, Sugerir,
//     Planificar, Por persona and the status text; a search finds it. setSomeday clears the date, the reminder and Ahora, with Deshacer;
//     not for a task that repeats or waits. A date (also through dayPatch), Ahora or Por confirmar take it out; Deshacer of a date puts it
//     back. A deadline that has come brings it to Hoy. Synced as tasks.someday (a dayN, left out while null).
//  2. iPhone: the cell Algún día in Proyectos (only with something in it), its screen grouped by project, the row's Aplazar menu with
//     Algún día and, for one there, Sacar de Algún día; the Fecha sheet's chip; the detail says Algún día; the search row says it.
//  3. Desktop: the sidebar entry with its count, the view, the Fecha submenu with Algún día, the inspector.
//  4. The forgotten review and Planificar sin fecha offer Algún día, counted in their balance.
const H = require('./lib/pdharness.js'); const { ev, until, calm, sheetUp, settle } = H;
const fs = require('fs'); const path = require('path');
const PORT = 8834, OUT = path.join(__dirname, 'out', 'SD'); fs.mkdirSync(OUT, {recursive:true});
const r={}, fails=[], errors=[]; const check=(name, ok, info)=>{ r[name]=ok?true:(info===undefined?false:info); if(!ok) fails.push(name); };
const shot=(page, name)=>page.screenshot({path:path.join(OUT, name+'.png')});
const NOW = new Date(2026, 10, 16, 9, 0, 0); // Monday 16 November 2026, 9:00
const T0 = '2026-10-01T08:00:00.000Z', OLD = '2026-09-01T08:00:00.000Z';
const cr = n => new Date(Date.UTC(2026, 9, 20, 8, n)).toISOString();
const tk = (id, n, o) => Object.assign({id, title:id.toUpperCase(), spaceId:'trabajo', projectId:null, date:null, reminder:null, priority:'none', status:'pending', notes:'', carried:false, created:cr(n), modified:cr(n), completed:null}, o);
const SEED = () => ({ spaces:[{id:'trabajo',name:'Trabajo',order:0,created:T0},{id:'personal',name:'Personal',order:1,created:T0}],
  projects:[{id:'p1', spaceId:'trabajo', name:'FLC', color:'#007AFF', order:0, archived:false, created:T0, modified:T0}],
  tasks:[
    tk('s1', 1, {title:'Plantilla de cierre de mes', someday:'2026-11-10', projectId:'p1', responsible:'Luis'}),
    tk('s2', 2, {title:'Leer guía de Italia', someday:'2026-11-12'}),
    tk('s3', 3, {title:'Entrega olvidada', someday:'2026-11-01', deadline:'2026-11-16'}),     // its deadline has come: in Hoy
    tk('h1', 4, {title:'Comité', date:'2026-11-16', projectId:'p1'}),
    tk('n1', 5, {title:'Ordenar carpeta', projectId:'p1'}),
    tk('n2', 6, {title:'Idea vieja', created:OLD, modified:OLD}),                             // forgotten
    tk('r1', 7, {title:'Semanal', date:'2026-11-17', repeat:'W1:TU@2026-11-17#abc12345'}),
    tk('w1', 8, {title:'Esperando', status:'waiting', waitingFor:'Ana', date:'2026-11-20'}),
    tk('f1', 9, {title:'Con todo', date:'2026-11-18', reminder:'2026-11-18T08:00:00.000Z', projectId:'p1'}) ],
  voiceNotes:[], attachments:[], subtasks:[], projectNotes:[], contacts:[], settings:{tipsSeen:true} });

/* ======================= 1. Data rules ======================= */
async function rules(browser){
  const {ctx, page} = await H.open(browser, {tag:'R', port:PORT, now:NOW, seed:SEED()}, errors); let x;
  x = await ev(page, ()=>({hoy:pendingFor('hoy').map(x=>x.id).join(), todas:pendingFor('todas').map(x=>x.id).join(), some:somedayList().map(x=>x.id).join(),
    q:pendingFor('todas', undefined, 'plantilla').map(x=>x.id).join(), proj:pendingFor('todas','p1').map(x=>x.id).join(), forgot:DB.tasks.filter(isForgot).map(x=>x.id).join(),
    sg:suggestPool().map(x=>x.id).join(), people:peopleList().map(p=>p.name).join(), st:statusText('p1'), csv:csvText().includes('Algún día') }));
  check('lists', x.hoy==='s3,h1' && x.todas==='s3,h1,r1,f1,n2,n1' && x.some==='s1,s2' && x.q==='s1' && x.proj==='h1,f1,n1', x);
  check('others', x.forgot==='n2' && !/s1|s2/.test(x.sg) && x.people==='Ana' && !/Plantilla/.test(x.st) && x.csv, x);
  // Put aside: date, reminder and Ahora go; Deshacer brings them back
  x = await ev(page, ()=>{ toggleFocus('f1'); const ok=setSomeday('f1', true); const f=task('f1'); const a={ok, some:f.someday, date:f.date, rem:f.reminder, focus:f.focus, inSome:isSomeday(f)}; undoFn(); const g=task('f1'); a.back=[g.someday||null, g.date, g.reminder, !!g.focus].join(); return a; });
  check('put_aside', x.ok && x.some==='2026-11-16' && x.date===null && x.rem===null && x.focus===null && x.inSome && x.back===',2026-11-18,2026-11-18T08:00:00.000Z,true', x);
  x = await ev(page, ()=>({r:setSomeday('r1', true), w:setSomeday('w1', true), c:canSomeday(task('n1')), cs:canSomeday(task('s1'))}));
  check('not_offered', !x.r && !x.w && x.c && !x.cs, x);
  // A date takes it out (and Deshacer of the date puts it back); Ahora and Por confirmar too
  x = await ev(page, ()=>{ setTaskDate('s2', addDays(todayStr(),1)); const a={out:!isSomeday(task('s2')), some:task('s2').someday||null}; undoFn(); a.back=isSomeday(task('s2'));
    toggleFocus('s2'); a.focus=!isSomeday(task('s2'))&&!task('s2').someday; undoFn(); setSomeday('s2', true, true);
    setWaiting('s2', 'Ana', addDays(todayStr(),2)); a.wait=task('s2').someday===null&&task('s2').status==='waiting'; return a; });
  check('taken_out', x.out && x.some===null && x.back && x.focus && x.wait, x);
  // Sync: the column goes up while set, and is left out while null
  x = await ev(page, ()=>({a:syncToRow('tasks', task('s1')).someday, b:'someday' in syncToRow('tasks', task('h1')), f:SYNC_FIELDS.tasks.some(f=>f[1]==='someday'&&f[2]==='dayN')}));
  check('sync_row', x.a==='2026-11-10' && !x.b && x.f, x);
  await ctx.close(); }

/* ======================= 2. iPhone ======================= */
async function iphone(browser, theme){
  const {ctx, page} = await H.open(browser, {tag:'M'+theme, port:PORT, now:NOW, seed:SEED(), theme}, errors); let x; const T=theme==='dark'?'-dark':'';
  await ev(page, ()=>switchTab('proyectos')); await calm(page);
  x = await ev(page, ()=>{ const c=document.querySelector('.screen.root[data-root=proyectos] [data-open-someday]'); return c&&{lbl:c.querySelector('.lbl').textContent, n:c.querySelector('.count').textContent, icon:!!c.querySelector('.picon.sdicon svg'), flc:document.querySelector('[data-open-project=p1] .count').textContent}; });
  check('i_cell'+T, x && x.lbl==='Algún día' && x.n==='2' && x.icon && x.flc==='3', x); // FLC: h1, f1 and n1, not s1
  await shot(page, 'i1-proyectos'+T);
  await page.tap('[data-open-someday]'); await calm(page);
  x = await ev(page, ()=>{ const s=document.querySelector('.pushed-screen.someday:not(.pushed)'); return s&&{title:s.querySelector('.nav-title').textContent, heads:[...s.querySelectorAll('.group-title .gl')].map(e=>e.textContent).join('|'), rows:[...s.querySelectorAll('.row[data-id]')].map(r=>r.dataset.id).join(), meta:!!s.querySelector('.row .sday')}; });
  check('i_screen'+T, x && x.title==='Algún día' && x.heads==='FLC1|Sin proyecto1' && x.rows==='s1,s2' && !x.meta, x);
  await shot(page, 'i2-someday'+T);
  if(theme==='dark'){ await ctx.close(); return; }
  // The row's Aplazar menu: Sacar de Algún día for one there
  x = await ev(page, ()=>postponeMenu('s2').groups[1].map(i=>i.label).join('|'));
  check('i_menu_out', x==='Elegir fecha|Sacar de Algún día', x);
  await ev(page, ()=>{ postponeMenu('s2').groups[1][1].fn(); }); await calm(page);
  x = await ev(page, ()=>({s2:isSomeday(task('s2')), rows:[...document.querySelectorAll('.pushed-screen.someday .row[data-id]')].map(r=>r.dataset.id).join(), toast:document.querySelector('#toastText').textContent}));
  check('i_out', !x.s2 && x.rows==='s1' && x.toast==='Sacada de Algún día, sin fecha', x);
  await ev(page, ()=>pop()); await calm(page); await ev(page, ()=>switchTab('tareas')); await calm(page);
  // The Aplazar menu of a task in Todas: Algún día
  x = await ev(page, ()=>postponeMenu('n1').groups[1].map(i=>i.label).join('|'));
  check('i_menu_in', x==='Elegir fecha|Algún día', x);
  // The Fecha sheet from the detail: the chip Algún día
  await ev(page, ()=>openDetail('n1')); await calm(page);
  await ev(page, ()=>dateSheet('n1')); await sheetUp(page);
  x = await ev(page, ()=>[...document.querySelectorAll('#sheet .chip')].map(c=>c.textContent+(c.classList.contains('on')?'*':'')).join('|'));
  check('i_date_chips', /Sin fecha\*\|Algún día$/.test(x), x);
  await shot(page, 'i3-fecha');
  await page.tap('#sheet [data-sd]'); await settle(page);
  x = await ev(page, ()=>({some:isSomeday(task('n1')), val:[...document.querySelectorAll('.pushed-screen.detail .cell')].map(c=>c.textContent).find(t=>/^Fecha/.test(t))}));
  check('i_date_sd', x.some && x.val==='FechaAlgún día', x);
  await shot(page, 'i4-detalle');
  await ev(page, ()=>pop()); await calm(page);
  // A search finds it and says so
  await ev(page, ()=>{ UI.query='ordenar'; render(); }); await calm(page);
  x = await ev(page, ()=>{ const r=document.querySelector('.screen.root[data-root=tareas] .row[data-id=n1]'); return r&&r.querySelector('.row-meta').textContent; });
  check('i_search', x==='FLCAlgún día', x);
  await ctx.close(); }

/* ======================= 3. Desktop ======================= */
async function desktop(browser, theme){
  const {ctx, page} = await H.open(browser, {tag:'D'+theme, port:PORT, now:NOW, seed:SEED(), desk:true, theme}, errors); let x; const T=theme==='dark'?'-dark':'';
  x = await ev(page, ()=>{ const b=document.querySelector('#desk .side [data-view=someday]'); return b&&b.textContent; });
  check('d_side'+T, x==='Algún día2', x);
  await ev(page, ()=>setDeskView('someday')); await calm(page);
  x = await ev(page, ()=>({h:document.querySelector('#desk .main h1').textContent, rows:[...document.querySelectorAll('#desk .main .row[data-id]')].map(r=>r.dataset.id).join(), on:document.querySelector('#desk .side [data-view=someday]').classList.contains('on')}));
  check('d_view'+T, x.h==='Algún día' && x.rows==='s1,s2' && x.on, x);
  await shot(page, 'd1-someday'+T);
  if(theme==='dark'){ await ctx.close(); return; }
  // The Fecha submenu of a task in Todas
  x = await ev(page, ()=>dateMenu('n1').groups[1].map(i=>i.label+(i.on?'*':'')).join('|'));
  check('d_datemenu', x==='Sin fecha*|Algún día', x);
  await ev(page, ()=>dateMenu('n1').groups[1][1].fn()); await page.clock.runFor(400); await calm(page);
  x = await ev(page, ()=>({some:isSomeday(task('n1')), side:document.querySelector('#desk .side [data-view=someday]').textContent, rows:[...document.querySelectorAll('#desk .main .row[data-id]')].map(r=>r.dataset.id).join()}));
  check('d_put', x.some && x.side==='Algún día3' && x.rows==='s1,n1,s2', x);
  await ev(page, ()=>openDetail('n1')); await calm(page);
  x = await ev(page, ()=>{ const b=document.querySelector('#desk .pane [data-act=pickDate] .val'); return b&&b.textContent; });
  check('d_inspector', x==='Algún día', x);
  await shot(page, 'd2-inspector');
  // Sacar from the Fecha submenu (Sin fecha)
  await ev(page, ()=>dateMenu('n1').groups[1][0].fn()); await calm(page);
  check('d_out', await ev(page, ()=>!isSomeday(task('n1'))&&!task('n1').someday));
  await ctx.close(); }

/* ======================= 4. Reviews ======================= */
async function reviews(browser){
  const {ctx, page} = await H.open(browser, {tag:'V', port:PORT, now:NOW, seed:SEED()}, errors); let x;
  await ev(page, ()=>reviewStart('forgot')); await sheetUp(page);
  x = await ev(page, ()=>!!document.querySelector('#sheet [data-x=some]'));
  check('v_forgot_btn', x);
  await shot(page, 'v1-olvidadas');
  await page.tap('#sheet [data-x=some]'); await settle(page);
  x = await ev(page, ()=>({some:isSomeday(task('n2')), cells:[...document.querySelectorAll('#sheet .cell')].map(c=>c.textContent).join('|')}));
  check('v_forgot_some', x.some && x.cells==='A Algún día1', x);
  await page.tap('#sheet [data-x=undo]'); await settle(page);
  check('v_forgot_undo', await ev(page, ()=>!isSomeday(task('n2'))&&!task('n2').someday));
  await ev(page, ()=>planStart()); await sheetUp(page);
  x = await ev(page, ()=>document.querySelector('#sheet .plan-title').textContent);
  await page.tap('#sheet [data-x=some]'); await settle(page);
  x = await ev(page, ()=>({n2:isSomeday(task('n2')), title:(document.querySelector('#sheet .plan-title')||{}).textContent}));
  check('v_plan_some', x.n2 && x.title==='Ordenar carpeta', x); // the oldest first
  await page.tap('#sheet [data-x=end]'); await settle(page);
  x = await ev(page, ()=>document.querySelector('#toastText').textContent);
  check('v_plan_toast', x==='0 planificadas, 1 a Algún día, 1 saltada', x);
  await ctx.close(); }

(async()=>{
  const srv = await H.server(PORT); const browser = await H.chromium.launch();
  try{ await rules(browser); }catch(e){ fails.push('rules_exception'); errors.push('rules: '+String(e&&e.stack||e)); }
  for(const th of ['light','dark']){ try{ await iphone(browser, th); }catch(e){ fails.push('iphone_exception_'+th); errors.push('iphone '+th+': '+String(e&&e.stack||e)); } }
  for(const th of ['light','dark']){ try{ await desktop(browser, th); }catch(e){ fails.push('desktop_exception_'+th); errors.push('desktop '+th+': '+String(e&&e.stack||e)); } }
  try{ await reviews(browser); }catch(e){ fails.push('reviews_exception'); errors.push('reviews: '+String(e&&e.stack||e)); }
  console.log(JSON.stringify({r, fails, errors}, null, 1));
  await browser.close(); srv.close(); process.exit(fails.length||errors.length?1:0);
})();
