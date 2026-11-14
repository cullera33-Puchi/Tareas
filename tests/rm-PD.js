require('./lib/out.js'); // outputs (screenshots, downloads) go to tests/out
// Decision 86: Planificar el día, approved by the owner on 14 November. Port 8835. Screenshots in tests/out/PD.
//  1. iPhone at 9:00 on Monday 16 November 2026: the cell on top of Hoy and the item of the view menu; the walk: Aplazadas (Dejarlas todas
//     para hoy), Entregas próximas (Hoy on and off), Carga (an estimate set from its chips, the ticks proposed over the limit with no more
//     moves than needed, Pasar N a mañana counted as postponed), Ahora (three ticked in the order of Sugerir, a sixth refused) and the
//     closing line with Deshacer of the whole walk. The cell is gone once it is done, and at noon.
//  2. The review of the carried tasks inside the walk: its decisions join the walk's Deshacer, the walk goes on to the next step, and a
//     sheet closed half way ends the walk with its line.
//  3. Desktop: the cell, the sheet in the centre (light and dark), nothing offered with the day closed.
const H = require('./lib/pdharness.js'); const { ev, until, calm, sheetUp, settle } = H;
const fs = require('fs'); const path = require('path');
const PORT = 8835, OUT = path.join(__dirname, 'out', 'PD'); fs.mkdirSync(OUT, {recursive:true});
const r={}, fails=[], errors=[]; const check=(name, ok, info)=>{ r[name]=ok?true:(info===undefined?false:info); if(!ok) fails.push(name); };
const shot=(page, name)=>page.screenshot({path:path.join(OUT, name+'.png')});
const NOW = new Date(2026, 10, 16, 9, 0, 0); // Monday 16 November 2026, 9:00
const T0 = '2026-10-01T08:00:00.000Z';
const cr = n => new Date(Date.UTC(2026, 9, 20, 8, n)).toISOString();
const tk = (id, n, o) => Object.assign({id, title:id.toUpperCase(), spaceId:'trabajo', projectId:null, date:null, reminder:null, priority:'none', status:'pending', notes:'', carried:false, created:cr(n), modified:cr(n), completed:null}, o);
const SEED = () => ({ spaces:[{id:'trabajo',name:'Trabajo',order:0,created:T0},{id:'personal',name:'Personal',order:1,created:T0}],
  projects:[{id:'p1', spaceId:'trabajo', name:'FLC', color:'#007AFF', order:0, archived:false, created:T0, modified:T0}],
  tasks:[
    tk('a1', 1, {title:'Revisar acta', date:'2026-11-13', projectId:'p1', estimate:30}),                // carried by rollOver
    tk('a2', 2, {title:'Llamar a Susana', date:'2026-11-14', estimate:15}),
    tk('h1', 3, {title:'Preparar comité', date:'2026-11-16', projectId:'p1', priority:'high', estimate:120}),
    tk('h2', 4, {title:'Validar mapeo SII', date:'2026-11-16', estimate:240}),
    tk('h3', 5, {title:'Correo a Francia', date:'2026-11-16'}),
    tk('h4', 6, {title:'Plan de pruebas', date:'2026-11-16', estimate:60}),
    tk('d1', 7, {title:'Entregar SOW', date:'2026-11-20', deadline:'2026-11-18', projectId:'p1'}),
    tk('d2', 8, {title:'Propuesta Polonia', deadline:'2026-11-17'}),
    tk('d3', 9, {title:'Lejana', deadline:'2026-11-25'}) ],
  voiceNotes:[], attachments:[], subtasks:[], projectNotes:[], contacts:[], settings:{tipsSeen:true} });
const step = page => ev(page, ()=>{ const s=document.querySelector('#sheet.on .pdstep'); return s?s.textContent:null; });
const tap = async (page, sel) => { await page.tap(sel); await settle(page); };

/* ======================= 1. iPhone, the whole walk ======================= */
async function walk(browser){
  const {ctx, page} = await H.open(browser, {tag:'M', port:PORT, now:NOW, seed:SEED()}, errors); let x;
  x = await ev(page, ()=>({cell:!!document.querySelector('.screen.root[data-root=tareas] .pdcell'), pd:pdShown(), carried:pendingFor('hoy').filter(carriedOn).map(x=>x.id).join()}));
  check('i_cell', x.cell && x.pd && x.carried==='a1,a2', x);
  await shot(page, 'i1-hoy');
  await page.tap('.screen.root[data-root=tareas] .vopts'); await until(page, ()=>menuOpen()&&!menuFresh());
  x = await ev(page, ()=>[...document.querySelectorAll('#pmenu .pm-l')].map(e=>e.textContent));
  check('i_menu', x.includes('Planificar el día') && x.includes('¿Qué hago ahora?'), x);
  await ev(page, ()=>closeMenu(true)); await calm(page);
  await tap(page, '.screen.root[data-root=tareas] .pdcell'); await sheetUp(page);
  check('i_step1', await step(page)==='Paso 1 de 4: Aplazadas', await step(page));
  check('i_cell_gone', await ev(page, ()=>!document.querySelector('.screen.root[data-root=tareas] .pdcell')&&DB.settings.planDay===todayStr()));
  await shot(page, 'i2-aplazadas');
  await tap(page, '#sheet [data-pd=keep]');
  x = await ev(page, ()=>({a1:task('a1').carried, a2:task('a2').carried}));
  check('i_keep', !x.a1 && !x.a2, x);
  check('i_step2', await step(page)==='Paso 2 de 4: Entregas próximas', await step(page));
  x = await ev(page, ()=>[...document.querySelectorAll('#sheet .pdi')].map(e=>e.querySelector('.t').textContent).join('|'));
  check('i_dl_list', x==='Propuesta Polonia|Entregar SOW', x); // 17 and 18; the 25th is too far
  await tap(page, '#sheet [data-pdhoy=d1]');
  x = await ev(page, ()=>({d1:task('d1').date, on:document.querySelector('#sheet [data-pdhoy=d1]').classList.contains('on'), n:document.querySelectorAll('#sheet .pdi').length}));
  check('i_dl_on', x.d1==='2026-11-16' && x.on && x.n===2, x);
  await tap(page, '#sheet [data-pdhoy=d1]');
  check('i_dl_off', await ev(page, ()=>task('d1').date==='2026-11-20'));
  await tap(page, '#sheet [data-pdhoy=d1]'); await shot(page, 'i3-entregas');
  await tap(page, '#sheet [data-pd=next]');
  check('i_step3', await step(page)==='Paso 3 de 4: Carga de hoy', await step(page));
  x = await ev(page, ()=>({load:document.querySelector('#sheet .pdload').textContent, cls:document.querySelector('#sheet .pdload').className, chips:[...document.querySelectorAll('#sheet [data-pde=h3]')].map(b=>b.textContent).join('|'), ticked:[...document.querySelectorAll('#sheet .pdi.on [data-pdsel]')].map(b=>b.dataset.pdsel).join()}));
  check('i_load', x.load==='7 h 45 de 6 h' && /orange/.test(x.cls) && x.chips==='15 min|30 min|1 h|Medio día' && x.ticked==='h2', x); // h2 alone is enough
  await tap(page, '#sheet [data-pde=h3][data-m="30"]');
  check('i_est', await ev(page, ()=>task('h3').estimate===30&&document.querySelector('#sheet .pdload').textContent==='8 h 15 de 6 h'));
  await shot(page, 'i4-carga');
  x = await ev(page, ()=>document.querySelector('#sheet [data-pd=move]').textContent);
  check('i_move_label', x==='Pasar 1 a mañana−4 h', x);
  await tap(page, '#sheet [data-pd=move]');
  x = await ev(page, ()=>({h2:task('h2').date, post:task('h2').postponed, load:document.querySelector('#sheet .pdload').textContent, move:!!document.querySelector('#sheet [data-pd=move]')}));
  check('i_moved', x.h2==='2026-11-17' && x.post===1 && x.load==='4 h 15 de 6 h1 pasada a mañana' && !x.move, x);
  await tap(page, '#sheet [data-pd=next]');
  check('i_step4', await step(page)==='Paso 4 de 4: Ahora', await step(page));
  x = await ev(page, ()=>[...document.querySelectorAll('#sheet .rpi.on')].map(b=>b.dataset.pda).join());
  check('i_ahora_pick', x==='h1,a1,a2', x); // the priority and the two quickest (listed in the order of Hoy)
  await shot(page, 'i5-ahora');
  for(const id of ['h3','h4','d1']) await tap(page, '#sheet [data-pda='+id+']');
  x = await ev(page, ()=>({on:document.querySelectorAll('#sheet .rpi.on').length, full:document.querySelector('#sheet .pdahint').classList.contains('full')}));
  check('i_ahora_max', x.on===5 && x.full, x);
  await tap(page, '#sheet [data-pda=d1]'); await tap(page, '#sheet [data-pda=h4]');
  await tap(page, '#sheet [data-pd=next]'); await calm(page);
  x = await ev(page, ()=>({sheet:document.querySelector('#sheet').classList.contains('on'), toast:document.querySelector('#toastText').textContent, ahora:ahoraTasks().map(x=>x.id).join(), cell:!!document.querySelector('.pdcell')}));
  check('i_end', !x.sheet && x.toast==='Día planificado: 4 en Ahora, 4 h 15 de 6 h' && x.ahora==='h1,a1,a2,h3' && !x.cell, x);
  await shot(page, 'i6-fin');
  // Deshacer: everything back as it was
  await ev(page, ()=>{ undoFn(); }); await calm(page);
  x = await ev(page, ()=>({ahora:ahoraTasks().length, a1:task('a1').carried, h2:task('h2').date+'/'+(task('h2').postponed||0), h3:task('h3').estimate||null, d1:task('d1').date}));
  check('i_undo', x.ahora===0 && x.a1===true && x.h2==='2026-11-16/0' && x.h3===null && x.d1==='2026-11-20', x);
  // Done today: no cell; a new day in the morning brings it back, and noon takes it away
  check('i_done_today', await ev(page, ()=>!pdShown()));
  await ev(page, ()=>{ DB.settings.planDay='2026-11-15'; save(); render(); }); await calm(page);
  check('i_cell_back', await ev(page, ()=>!!document.querySelector('.pdcell')));
  await page.clock.runFor(3*3600e3+60e3); await settle(page); await ev(page, ()=>window.dispatchEvent(new Event('focus'))); await calm(page);
  check('i_noon', await ev(page, ()=>new Date().getHours()===12&&!pdShown()&&!document.querySelector('.pdcell')));
  await ctx.close(); }

/* ======================= 2. The review inside the walk ======================= */
async function review(browser){
  const {ctx, page} = await H.open(browser, {tag:'V', port:PORT, now:NOW, seed:SEED()}, errors); let x;
  await ev(page, ()=>planDayStart()); await sheetUp(page);
  await tap(page, '#sheet [data-pd=review]');
  x = await ev(page, ()=>document.querySelector('#sheet h2').textContent);
  check('v_review', x==='Repasar aplazadas', x);
  await tap(page, '#sheet [data-rv=man]'); await tap(page, '#sheet [data-rv=hoy]');
  x = await ev(page, ()=>({a1:task('a1').date, a2:task('a2').date+'/'+task('a2').carried}));
  check('v_decided', x.a1==='2026-11-17' && x.a2==='2026-11-16/false', x);
  check('v_next', await step(page)==='Paso 2 de 4: Entregas próximas', await step(page));
  await tap(page, '#sheet [data-pdhoy=d2]');
  await ev(page, ()=>closeSheet()); await calm(page);
  x = await ev(page, ()=>({toast:document.querySelector('#toastText').textContent, btn:document.querySelector('#toastBtn').style.display}));
  check('v_closed', /^Día planificado/.test(x.toast) && x.btn!=='none', x);
  await ev(page, ()=>{ undoFn(); }); await calm(page);
  x = await ev(page, ()=>({a1:task('a1').date+'/'+task('a1').carried, a2:task('a2').carried, d2:task('d2').date}));
  check('v_undo', x.a1==='2026-11-16/true' && x.a2===true && x.d2===null, x);
  await ctx.close(); }

/* ======================= 3. Desktop ======================= */
async function desktop(browser, theme){
  const {ctx, page} = await H.open(browser, {tag:'D'+theme, port:PORT, now:NOW, seed:SEED(), desk:true, theme}, errors); let x; const T=theme==='dark'?'-dark':'';
  check('d_cell'+T, await ev(page, ()=>!!document.querySelector('#desk .main .pdcell')));
  await page.click('#desk .main .pdcell'); await sheetUp(page); await settle(page);
  await page.click('#sheet [data-pd=next]'); await settle(page); await page.click('#sheet [data-pd=next]'); await settle(page);
  check('d_load'+T, await step(page)==='Paso 3 de 4: Carga de hoy', await step(page));
  await shot(page, 'd1-carga'+T);
  await page.click('#sheet [data-pd=next]'); await settle(page);
  await shot(page, 'd2-ahora'+T);
  await page.click('#sheet [data-pd=end]'); await calm(page);
  x = await ev(page, ()=>({ahora:ahoraTasks().length, cell:!!document.querySelector('#desk .main .pdcell')}));
  check('d_end'+T, x.ahora===3 && !x.cell, x);
  if(theme==='light'){ await ev(page, ()=>{ DB.settings.planDay=null; setClosedDay(true); render(); }); await calm(page);
    x = await ev(page, ()=>{ planDayStart(); return {cell:!!document.querySelector('.pdcell'), sheet:document.querySelector('#sheet').classList.contains('on')}; });
    check('d_closed', !x.cell && !x.sheet, x); }
  await ctx.close(); }

(async()=>{
  const srv = await H.server(PORT); const browser = await H.chromium.launch();
  try{ await walk(browser); }catch(e){ fails.push('walk_exception'); errors.push('walk: '+String(e&&e.stack||e)); }
  try{ await review(browser); }catch(e){ fails.push('review_exception'); errors.push('review: '+String(e&&e.stack||e)); }
  for(const th of ['light','dark']){ try{ await desktop(browser, th); }catch(e){ fails.push('desktop_exception_'+th); errors.push('desktop '+th+': '+String(e&&e.stack||e)); } }
  console.log(JSON.stringify({r, fails, errors}, null, 1));
  await browser.close(); srv.close(); process.exit(fails.length||errors.length?1:0);
})();
