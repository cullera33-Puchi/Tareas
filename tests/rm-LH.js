require('./lib/out.js'); const { openSetting, closeSetting } = require('./lib/settings.js'); // v0.37.4: Ajustes in subscreens on the iPhone // outputs (screenshots, downloads) go to tests/out
// Batch LH (owner, 3 November), port 10810:
//  1. Carga del día en horas (decision 60a): the format, the hours of Hoy beside its count (iPhone segment, desktop title), the working hours
//     per space in Ajustes (orange from them, red from half as much again) and the Semana day head (its bar, line and tooltip).
//  2. Tareas olvidadas (decision 60b): "Repasar N olvidadas" in Sin fecha beside Planificar, the walk (a day, Completar, the balance, Deshacer).
//  3. Posponer recordatorio (decision 55): the bar of a task opened from its notification, the row menu (iPhone), the task menu (desktop),
//     the ?snooze= entry of a desktop notification's action, Deshacer, reminderSent cleared, 17:00 left out from 16:30.
//  4. The evening rule: from 18:30 Hoy proposes tomorrow for a new task (iPhone and desktop), a typed «hoy» wins, the toast says so, and
//     Cerrar el día shows from 18:30.
//  5. The compact empty Hoy: one line, «Todo hecho por hoy, N completadas».
//  6. The day closed on every device: Cerrar el día sets the space's closedDay, Hoy shows tomorrow under «Día cerrado», Reabrir hoy with
//     Deshacer, a closedDay of yesterday is open, two devices with a fake server, a server without the column (0009 not run), and the SQL.
const { chromium } = require('playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = path.resolve(__dirname, '..'), PORT = 10810, URL0 = 'http://localhost:'+PORT+'/';
const OUT = path.join(__dirname, 'out', 'LH'); fs.mkdirSync(OUT, {recursive:true});
const DEPS = path.join(ROOT, 'node_modules');
const TYPES = {'.html':'text/html','.css':'text/css','.js':'application/javascript','.webmanifest':'application/manifest+json','.png':'image/png'};
const srv = http.createServer((req,res)=>{ let p = decodeURIComponent(req.url.split('?')[0]); if(p==='/') p='/index.html';
  if(p==='/config.js'){ res.writeHead(200,{'Content-Type':'application/javascript'}); res.end('window.TAREAS_CONFIG = {"url":null,"anonKey":null};\n'); return; }
  const f=path.join(ROOT,p); if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){ res.writeHead(404,{'Content-Type':'text/html'}); res.end('<h1>404</h1>'); return; }
  res.writeHead(200,{'Content-Type':TYPES[path.extname(f)]||'application/octet-stream'}); res.end(fs.readFileSync(f)); });
const r={}, fails=[], errors=[]; const check=(name, ok, info)=>{ r[name]=ok?true:(info===undefined?false:info); if(!ok) fails.push(name); };
const sleep=ms=>new Promise(res=>setTimeout(res,ms));
const shot=(page, name)=>page.screenshot({path:path.join(OUT, name+'.png')});

const AT = (h, m) => new Date(2026, 10, 4, h, m, 0); // Wednesday 4 November 2026, local
const T0 = '2026-11-03T08:00:00.000Z', OLD = '2026-09-20T08:00:00.000Z', RECENT = '2026-10-30T08:00:00.000Z';
const C = n => new Date(Date.UTC(2026, 10, 3, 8, n)).toISOString();
const tk = (id, o) => Object.assign({id, title:id, spaceId:'trabajo', projectId:null, date:'2026-11-04', reminder:null, priority:'none', status:'pending', notes:'', carried:false, created:T0, modified:T0, completed:null}, o);
const SEED = () => ({ spaces:[{id:'trabajo',name:'Trabajo',order:0,created:T0},{id:'personal',name:'Personal',order:1,created:T0}],
  projects:[{id:'p1', spaceId:'trabajo', name:'FLC', color:'#007AFF', order:0, archived:false, created:T0, modified:T0}],
  tasks:[ tk('h1', {title:'Informe mensual', estimate:240, created:C(1)}),
    tk('h2', {title:'Revisar contrato', estimate:60, projectId:'p1', created:C(2)}),
    tk('h3', {title:'Correo al cliente', estimate:30, reminder:new Date(2026,10,4,9,55).toISOString(), reminderSent:new Date(2026,10,4,9,55).toISOString(), created:C(3)}),
    tk('h4', {title:'Sin estimar', created:C(4)}),
    tk('w1', {title:'Firma pendiente', estimate:15, status:'waiting', waitingFor:'Cliente', created:C(5)}), // Revisar hoy: counts too
    tk('d1', {title:'Hecha hoy', estimate:60, status:'done', completed:new Date(2026,10,4,9,0).toISOString(), created:C(6)}), // done: never counts
    tk('m1', {title:'Para mañana', estimate:30, date:'2026-11-05', created:C(7)}),
    tk('m2', {title:'Entrega mañana', date:null, deadline:'2026-11-05', created:C(8)}),
    tk('f1', {title:'Olvidada uno', date:null, created:OLD, modified:OLD}),
    tk('f2', {title:'Olvidada dos', date:null, created:OLD, modified:null}),
    tk('f3', {title:'Sin fecha reciente', date:null, created:OLD, modified:RECENT}),
    tk('f4', {title:'Vieja con entrega', date:null, deadline:'2026-12-01', created:OLD, modified:OLD}),
    tk('f5', {title:'Vieja en Ahora', date:null, focus:new Date(2026,10,4,8,0).toISOString(), created:OLD, modified:OLD}),
    tk('f6', {title:'Vieja por confirmar', date:null, status:'waiting', created:OLD, modified:OLD}),
    tk('a1', {title:'En Ahora hoy', focus:new Date(2026,10,4,8,0).toISOString(), created:C(9)}),
    tk('x1', {title:'Personal', spaceId:'personal', estimate:240, created:C(10)}) ],
  voiceNotes:[], attachments:[], subtasks:[], projectNotes:[], settings:{tipsSeen:true} });
async function open(browser, o){
  const vp = o.desk ? {viewport:{width:1280,height:800}, deviceScaleFactor:1} : {viewport:{width:390,height:844}, deviceScaleFactor:2, isMobile:true, hasTouch:true};
  const ctx = await browser.newContext(Object.assign(vp, {colorScheme:o.theme||'light'})); const page = await ctx.newPage();
  if(o.clock!==false) await page.clock.install({time:o.now||AT(10,0)});
  page.on('pageerror', e=>errors.push(o.tag+' pageerror: '+e.message)); page.on('console', m=>{ if(m.type()==='error') errors.push(o.tag+' console: '+m.text()); });
  if(o.fake){ await page.exposeBinding('fakeServer', (src, op, a)=>o.fake.handle(src.page, op, a)); await page.addInitScript(fakeAdapter); await page.addInitScript(u=>{ window.__fakeUser=u; }, USER); }
  await page.addInitScript(s=>{ if(!localStorage.getItem('tareas-v1')) localStorage.setItem('tareas-v1', s); }, JSON.stringify(o.seed||SEED()));
  await page.goto(URL0+(o.query||'')); await until(page, ()=>typeof DB!=='undefined'&&!!document.querySelector(UI.wide?'#desk .main':'.screen.root')); return {ctx, page};
}
const ev = (page, fn, arg) => page.evaluate(fn, arg);
const until = async (page, fn, arg, ms=8000)=>{ const t0=Date.now(); for(;;){ let v=false; try{ v=await page.evaluate(fn, arg); }catch(e){} if(v) return true; if(Date.now()-t0>ms) return false; await sleep(80); } };
const calm = page => until(page, ()=>!app.classList.contains('navigating') && !HELD.size && !document.querySelector('.row.leaving, .flip, .enter') && !touchDrag);
const sheetUp = page => until(page, ()=>{ const s=document.querySelector('#sheet'); return s.classList.contains('on') && !sheetFresh(); });
const sheetGone = page => until(page, ()=>!document.querySelector('#sheet').classList.contains('on'));
const menuSettled = page => until(page, ()=>menuOpen() && !menuFresh() && !document.querySelector('#pmenu').getAnimations({subtree:true}).some(a=>a.playState==='running'));
const toastText = page => ev(page, ()=>document.querySelector('#toast').classList.contains('on')?document.querySelector('#toastText').textContent:'');
const menuLabels = page => ev(page, ()=>[...document.querySelectorAll('#pmenu .pm-it')].map(b=>b.querySelector('.pm-l').firstChild.textContent));
async function clickItem(page, label){ await menuSettled(page); const ok=await ev(page, l=>{ const b=[...document.querySelectorAll('#pmenu .pm-it')].reverse().find(x=>x.querySelector('.pm-l').firstChild.textContent===l); if(!b) return false; b.click(); return true; }, label); if(!ok) throw new Error('no menu item '+label); }
const undo = async page => { await ev(page, ()=>document.querySelector('#toastBtn').click()); await calm(page); }; // the desktop pane may sit over the toast's spot
const seg = page => ev(page, ()=>{ const b=document.querySelector('.screen.root .seg [data-filter=hoy]'); const l=b&&b.querySelector('.lh'); return b&&{label:b.firstChild.textContent, n:b.querySelector('.n').textContent, lh:l?l.textContent:'', cls:l?l.className:'', tip:l?l.title:''}; });
const rootSel = s => '.screen.root:not(.hidden-tab) '+s;

/* ======================= 1, 4, 5 and 6 on the iPhone ======================= */
async function iphone(browser){ let x;
  const {ctx, page} = await open(browser, {tag:'I'});
  x = await ev(page, ()=>[hoursText(0), hoursText(45), hoursText(60), hoursText(330), hoursText(360), hoursText(375), hoursText(-5)]);
  check('fmt', x.join('|')==='|45 min|1 h|5 h 30|6 h|6 h 15|', x);
  // h1 240 + h2 60 + h3 30 + w1 15 (Revisar hoy) = 345 = 5 h 45; h4 none; d1 done; x1 in Personal
  x = await seg(page); check('hoy_hours', x && x.label==='Hoy' && x.n==='6' && x.lh==='5 h 45' && x.cls==='lh' && /5 h 45 estimadas en 6 tareas; 6 h de trabajo al día/.test(x.tip), x);
  await shot(page, 'i-hoy-light');
  // Ajustes: Horas de trabajo al día per space
  await openSetting(page, 'espacios'); await calm(page); // v0.37.4: Espacios y horas
  x = await ev(page, ()=>[...document.querySelectorAll('[data-day-hours]')].map(c=>c.dataset.dayHours+':'+c.querySelector('.lbl').textContent+':'+c.querySelector('.val').textContent));
  check('settings_rows', x.join()==='trabajo:Trabajo:6 h,personal:Personal:6 h', x);
  await page.evaluate(()=>document.querySelector('[data-day-hours=trabajo]').scrollIntoView({block:'center'}));
  await shot(page, 'i-ajustes-light');
  await page.click('[data-day-hours=trabajo]'); await menuSettled(page);
  x = await menuLabels(page); check('settings_menu', x.join()==='4 h,5 h,6 h,7 h,8 h,9 h,10 h', x);
  await clickItem(page, '5 h'); await calm(page);
  x = await ev(page, ()=>({set:DB.settings.dayHours, val:document.querySelector('[data-day-hours=trabajo] .val').textContent, log:LOG.some(e=>/Horas de trabajo al día: 5/.test(e.m))}));
  check('settings_set', x.set && x.set.trabajo===5 && !('personal' in x.set) && x.val==='5 h' && x.log, x);
  await (await closeSetting(page), page.click('#tabbar [data-tab=tareas]')); await calm(page);
  x = await seg(page); check('hoy_orange', x.cls==='lh orange', x); // 345 >= 300, < 450
  await ev(page, ()=>{ setDayHours('trabajo', 4); }); x = await seg(page); check('hoy_orange_4', x.cls==='lh orange', x); // 345 < 360
  await ev(page, ()=>{ updTask('h4', {estimate:15}); render(); }); x = await seg(page); check('hoy_red', x.cls==='lh red' && x.lh==='6 h', x); // 360 = 4 h and a half again
  await shot(page, 'i-hoy-red-light');
  await ev(page, ()=>{ setDayHours('trabajo', 6); updTask('h4', {estimate:null}); render(); });
  // Personal has its own hours and its own load
  x = await ev(page, ()=>{ DB.settings.activeSpace='personal'; save(); render(); const l=document.querySelector('.screen.root .seg [data-filter=hoy] .lh'); const o={lh:l&&l.textContent, cls:l&&l.className}; DB.settings.activeSpace='trabajo'; save(); render(); return o; });
  check('hoy_space', x.lh==='4 h' && x.cls==='lh', x);
  // Nothing estimated: nothing shown
  x = await ev(page, ()=>{ const keep=DB.tasks.map(t=>[t.id,t.estimate]); DB.tasks.forEach(t=>{ t.estimate=null; }); render(); const none=!document.querySelector('.screen.root .seg .lh'); keep.forEach(([id,e])=>{ task(id).estimate=e; }); render(); return none; });
  check('hoy_none', x);

  /* ---------- 2. Tareas olvidadas ---------- */
  await page.click(rootSel('.seg [data-filter=todas]')); await calm(page);
  x = await ev(page, ()=>{ const g=[...document.querySelectorAll('.screen.root .gsec')].find(s=>s.querySelector('.gl').textContent.startsWith('Sin fecha')); return g&&[...g.querySelectorAll('.gh .gx')].map(b=>b.textContent); });
  check('forgot_link', x && x.join('|')==='Repasar 2 olvidadas|Planificar (6)', x);
  x = await ev(page, ()=>({f:DB.tasks.filter(isForgot).map(t=>t.id).sort().join(), mark:[...document.querySelectorAll('.screen.root .row[data-id=f1]')].map(r=>r.className).join()}));
  check('forgot_rule', x.f==='f1,f2', x);
  await ev(page, ()=>document.querySelector('.screen.root [data-act=forgot]').scrollIntoView({block:'center'}));
  await shot(page, 'i-forgot-light');
  await page.click(rootSel('[data-act=forgot]')); await sheetUp(page);
  x = await ev(page, ()=>({h:document.querySelector('#sheet h2').textContent, of:document.querySelector('#sheet .hint').textContent, t:document.querySelector('#sheet .plan-title').textContent, since:(document.querySelector('#sheet .rvsince')||{}).textContent, chips:[...document.querySelectorAll('#sheet [data-rv]')].map(b=>b.textContent), cal:!!document.querySelector('#sheet #calwrap [data-d]')}));
  check('forgot_sheet', x.h==='Repasar olvidadas' && x.of==='1 de 2' && x.t==='Olvidada uno' && x.since==='Sin cambios desde el 20 de septiembre' && !x.chips.includes('Sin fecha') && x.chips[1]==='Mañana' && x.cal, x);
  await shot(page, 'i-forgot-walk-light');
  await page.click('#sheet [data-rv=man]'); await sheetUp(page);
  await page.click('#sheet [data-x=done]'); await until(page, ()=>document.querySelector('#sheet h2')&&document.querySelector('#sheet h2').textContent==='Repaso terminado'); await sheetUp(page);
  x = await ev(page, ()=>({f1:task('f1').date, f2:task('f2').status, cells:[...document.querySelectorAll('#sheet .list .cell')].map(c=>c.textContent).join('|')}));
  check('forgot_done', x.f1==='2026-11-05' && x.f2==='done' && /A mañana1/.test(x.cells) && /Completadas1/.test(x.cells), x);
  await page.click('#sheet [data-x=undo]'); await sheetGone(page); await calm(page);
  x = await ev(page, ()=>({f1:task('f1').date, f2:task('f2').status, t:document.querySelector('#toastText').textContent}));
  check('forgot_undo', x.f1===null && x.f2==='pending' && x.t==='Repaso deshecho', x);

  /* ---------- 3. Posponer from the row menu (iPhone) ---------- */
  await page.click(rootSel('.seg [data-filter=hoy]')); await calm(page);
  await ev(page, ()=>rowMenu('h3')); await menuSettled(page);
  x = await menuLabels(page); check('menu_item', x.includes('Posponer recordatorio'), x);
  x = await ev(page, ()=>{ const m=snoozeMenu('h4'); return m; }); check('menu_none_without', x===null, x); // no reminder: no submenu
  await clickItem(page, 'Posponer recordatorio'); await menuSettled(page);
  x = await menuLabels(page); check('menu_sub', x.join('|')==='10 minutos|1 hora|Esta tarde a las 17:00|Mañana a las 9:00|Elegir', x);
  await shot(page, 'i-snooze-menu-light');
  await clickItem(page, '1 hora'); await calm(page);
  x = await ev(page, ()=>({r:task('h3').reminder, s:task('h3').reminderSent, t:document.querySelector('#toastText').textContent, log:LOG.some(e=>/Recordatorio pospuesto/.test(e.m))}));
  check('menu_snooze', x.r===new Date(2026,10,4,11,0).toISOString() && x.s===null && x.t==='Recordatorio a las 11:00' && x.log, x);
  await undo(page);
  x = await ev(page, ()=>({r:task('h3').reminder, s:task('h3').reminderSent}));
  check('menu_undo', x.r===new Date(2026,10,4,9,55).toISOString() && x.s===new Date(2026,10,4,9,55).toISOString(), x);

  /* ---------- 3. The bar of a task opened from its notification ---------- */
  await ev(page, ()=>openTaskFromPush('h3', 'prueba')); await calm(page);
  x = await ev(page, ()=>{ const b=document.querySelector('.screen.pushed-screen .snzbar'); return b&&{h:b.querySelector('b').textContent, t:b.querySelector('.snzt').textContent, chips:[...b.querySelectorAll('.chip')].map(c=>c.textContent)}; });
  check('bar_shown', x && x.h==='Posponer recordatorio' && x.chips.join('|')==='10 minutos|1 hora|Esta tarde a las 17:00|Mañana a las 9:00|Elegir…', x);
  await shot(page, 'i-snooze-bar-light');
  await page.click('.screen.pushed-screen .snzbar [data-snz="10"]'); await calm(page);
  x = await ev(page, ()=>({r:task('h3').reminder, s:task('h3').reminderSent, bar:!!document.querySelector('.screen.pushed-screen .snzbar'), t:document.querySelector('#toastText').textContent}));
  check('bar_snooze', x.r===new Date(2026,10,4,10,10).toISOString() && x.s===null && !x.bar && x.t==='Recordatorio a las 10:10', x);
  await undo(page);
  check('bar_undo', await ev(page, ()=>task('h3').reminder===new Date(2026,10,4,9,55).toISOString()&&!!task('h3').reminderSent));
  // Leaving the task drops the bar; opening it again from the list shows none
  await ev(page, ()=>openTaskFromPush('h3', 'prueba')); await calm(page);
  check('bar_again', await ev(page, ()=>!!document.querySelector('.screen.pushed-screen .snzbar')));
  await ev(page, ()=>pop()); await calm(page); await ev(page, ()=>openDetail('h3')); await calm(page);
  check('bar_left', await ev(page, ()=>!document.querySelector('.screen.pushed-screen .snzbar') && UI.snooze===null));
  await ev(page, ()=>pop()); await calm(page);

  /* ---------- 5. The compact empty Hoy ---------- */
  x = await ev(page, ()=>{ const keep=DB.tasks.map(t=>[t.id, t.status, t.completed]); DB.tasks.filter(t=>t.spaceId==='trabajo'&&isOpen(t)&&inHoy(t)).forEach(t=>{ t.status='done'; t.completed=new Date().toISOString(); }); render();
    const o={line:(document.querySelector('.screen.root .hoydone')||{}).textContent, big:!!document.querySelector('.screen.root .empty'), prev:(document.querySelector('.screen.root .preview')||{}).textContent};
    keep.forEach(([id,s,c])=>{ Object.assign(task(id), {status:s, completed:c}); }); render(); return o; });
  check('empty_line', x.line==='Todo hecho por hoy, 7 completadas' && !x.big && /Mañana: 2 tareas/.test(x.prev||''), x);
  x = await ev(page, ()=>{ const keep=JSON.stringify(DB.tasks); DB.tasks=DB.tasks.filter(t=>!(t.spaceId==='trabajo'&&inHoy(t))); render(); const o=(document.querySelector('.screen.root .hoydone')||{}).textContent; DB.tasks=JSON.parse(keep); render(); return o; });
  check('empty_zero', x==='Todo hecho por hoy', x);

  /* ---------- 4. The evening rule ---------- */
  await page.clock.setSystemTime(AT(18,29)); await ev(page, ()=>render()); await calm(page);
  x = await ev(page, ()=>({cell:!!document.querySelector('.screen.root .closecell'), date:hoyAddDate()}));
  check('eve_1829', !x.cell && x.date==='2026-11-04', x);
  await page.click(rootSel('.fab')); await sheetUp(page);
  x = await ev(page, ()=>(document.querySelector('#sheet [data-tok=date]')||{}).textContent); check('eve_1829_token', /Hoy/.test(x||''), x);
  await ev(page, ()=>{ sheetGuard=null; closeSheet(); }); await sheetGone(page);
  await page.clock.setSystemTime(AT(18,31)); await ev(page, ()=>render()); await calm(page);
  x = await ev(page, ()=>({cell:(document.querySelector('.screen.root .closecell')||{}).textContent, date:hoyAddDate()}));
  check('eve_1831', /Cerrar el día/.test(x.cell||'') && x.date==='2026-11-05', x);
  await page.click(rootSel('.fab')); await sheetUp(page);
  x = await ev(page, ()=>(document.querySelector('#sheet [data-tok=date]')||{}).textContent); check('eve_token', /Mañana/.test(x||''), x);
  await shot(page, 'i-evening-add-light');
  await page.fill('#sheet .titlein', 'Preparar la reunión'); await page.click('#sheet [data-x=ok]'); await sheetGone(page); await calm(page);
  x = await ev(page, ()=>{ const t=DB.tasks.find(q=>q.title==='Preparar la reunión'); return {d:t&&t.date, toast:document.querySelector('#toastText').textContent, inList:!!document.querySelector('.screen.root .row[data-id="'+(t&&t.id)+'"]')}; });
  check('eve_added', x.d==='2026-11-05' && x.toast==='Añadida para mañana' && !x.inList, x);
  // A typed «hoy» wins
  await page.click(rootSel('.fab')); await sheetUp(page);
  await page.fill('#sheet .titlein', 'Llamar a Pepe hoy'); await page.click('#sheet [data-x=ok]'); await sheetGone(page); await calm(page);
  x = await ev(page, ()=>{ const t=DB.tasks.find(q=>q.title==='Llamar a Pepe'); return {d:t&&t.date, toast:document.querySelector('#toastText').textContent}; });
  check('eve_typed_hoy', x.d==='2026-11-04' && x.toast==='Tarea añadida', x);
  // Todas proposes no date, as before
  x = await ev(page, ()=>{ DB.settings.filter='todas'; render(); addFromList(); const tok=document.querySelector('#sheet [data-tok=date]'); sheetGuard=null; closeSheet(); DB.settings.filter='hoy'; render(); return !tok; });
  check('eve_todas', x); await sheetGone(page);

  /* ---------- 6. Close the day ---------- */
  await shot(page, 'i-evening-hoy-light');
  await page.click(rootSel('.closecell')); await sheetUp(page);
  await page.click('#sheet [data-cd=all]'); await sheetGone(page); await calm(page);
  x = await ev(page, ()=>({closed:space().closedDay, isC:isClosed(), mod:space().modified>'2026-11-04', h1:task('h1').date, toast:document.querySelector('#toastText').textContent,
    head:(document.querySelector('.screen.root .dayclosed .dcl')||{}).textContent, link:(document.querySelector('.screen.root .dayclosed .gx')||{}).textContent,
    ahora:!!document.querySelector('.screen.root .ahora'), rows:[...document.querySelectorAll('.screen.root .scroll > .group .row, .screen.root .scroll > .tlist > .group .row')].map(r=>r.dataset.id), cell:!!document.querySelector('.screen.root .closecell'), prev:!!document.querySelector('.screen.root .preview'), log:LOG.some(e=>e.m==='Día cerrado')}));
  const sg = await seg(page);
  check('close_sets', x.closed==='2026-11-04' && x.isC && x.mod && x.h1==='2026-11-05' && /pasadas a mañana, día cerrado$/.test(x.toast) && x.log, x);
  check('close_view', x.head==='Día cerrado. Mañana, jueves 5' && x.link==='Reabrir hoy' && !x.ahora && !x.cell && !x.prev && ['m1','m2','h1','w1','a1'].every(k=>x.rows.includes(k)) && !x.rows.includes('f1') && !x.rows.includes('x1'), x);
  check('close_segment', sg.label==='Mañana' && sg.n===String(x.rows.length), sg);
  x = await ev(page, ()=>{ updTask('f3', {date:'2026-11-04'}); render(); return {hoy:pendingFor('hoy').map(t=>t.id).join(), shown:!!document.querySelector('.screen.root .row[data-id=f3]')}; }); // the badge still counts today (pendingFor), the list shows tomorrow
  check('close_today_hidden', x.hoy==='f3' && !x.shown, x); await ev(page, ()=>{ updTask('f3', {date:null}); render(); });
  await ev(page, ()=>{ document.querySelector('.screen.root .scroll').scrollTop=0; }); await shot(page, 'i-closed-light');
  await page.click(rootSel('.dayclosed .gx')); await calm(page);
  x = await ev(page, ()=>({c:space().closedDay, t:document.querySelector('#toastText').textContent, head:!!document.querySelector('.screen.root .dayclosed'), ahora:!!document.querySelector('.screen.root .ahora'), log:LOG.some(e=>e.m==='Día reabierto')}));
  check('reopen', x.c===null && x.t==='Día reabierto' && !x.head && x.log, x);
  await undo(page); check('reopen_undo', await ev(page, ()=>isClosed()&&!!document.querySelector('.screen.root .dayclosed')));
  // Nothing pending: the cell still shows and its sheet just closes the day
  x = await ev(page, ()=>{ space().closedDay=null; DB.tasks.filter(t=>t.spaceId==='trabajo'&&isOpen(t)&&inHoy(t)).forEach(t=>{ t.date='2026-11-06'; }); render(); return {cell:(document.querySelector('.screen.root .closecell')||{}).textContent, line:(document.querySelector('.screen.root .hoydone')||{}).textContent}; });
  check('close_empty_cell', x.cell==='Cerrar el día' && /^Todo hecho por hoy/.test(x.line||''), x);
  await page.click(rootSel('.closecell')); await sheetUp(page);
  x = await ev(page, ()=>[...document.querySelectorAll('#sheet [data-cd]')].map(b=>b.dataset.cd+':'+b.textContent).join('|')+' '+(document.querySelectorAll('#sheet .cdfoot')[0]||{}).textContent);
  check('close_empty_sheet', /^close:Cerrar el día Mañana empieza con/.test(x), x);
  await page.click('#sheet [data-cd=close]'); await sheetGone(page); await calm(page);
  check('close_empty_done', await ev(page, ()=>isClosed()&&document.querySelector('#toastText').textContent==='Día cerrado'));
  // A closedDay of yesterday is open
  x = await ev(page, ()=>{ space().closedDay='2026-11-03'; render(); return {c:isClosed(), head:!!document.querySelector('.screen.root .dayclosed'), label:document.querySelector('.screen.root .seg [data-filter=hoy]').firstChild.textContent}; });
  check('closed_yesterday_open', !x.c && !x.head && x.label==='Hoy', x);
  await ev(page, ()=>{ space().closedDay='2026-11-04'; render(); });
  await page.emulateMedia({colorScheme:'dark'}); await calm(page); await shot(page, 'i-closed-dark');
  await ev(page, ()=>{ space().closedDay=null; render(); }); await shot(page, 'i-hoy-dark');
  await ev(page, ()=>openTaskFromPush('h3', 'prueba')); await calm(page); await shot(page, 'i-snooze-bar-dark');
  await ctx.close();
}

/* ======================= 1, 3, 4 and 6 on the desktop ======================= */
async function desktop(browser){ let x;
  const {ctx, page} = await open(browser, {tag:'D', desk:true});
  x = await ev(page, ()=>{ const l=document.querySelector('#desk .mhead h1 .lh'); return {h1:document.querySelector('#desk .mhead h1').firstChild.textContent, lh:l&&l.textContent, cls:l&&l.className}; });
  check('d_hoy_hours', x.h1==='Hoy' && x.lh==='5 h 45' && x.cls==='lh', x);
  await ev(page, ()=>setDayHours('trabajo', 5)); x = await ev(page, ()=>document.querySelector('#desk .mhead h1 .lh').className); check('d_hoy_orange', x==='lh orange', x);
  await shot(page, 'd-hoy-light');
  // Ajustes on the desktop: the same rows, a Mac menu
  await ev(page, ()=>setDeskView('settings')); await calm(page);
  await page.click('#desk [data-day-hours=personal]'); await menuSettled(page);
  await clickItem(page, '8 h'); await calm(page);
  check('d_settings', await ev(page, ()=>DB.settings.dayHours.personal===8&&DB.settings.dayHours.trabajo===5&&document.querySelector('#desk [data-day-hours=personal] .val').textContent==='8 h'));
  // Semana: the day head says the hours, the bar measures them, the tooltip says hours and tasks
  // 2. Repasar olvidadas in the desktop's Todas, beside Planificar
  await ev(page, ()=>setDeskView('todas')); await calm(page);
  x = await ev(page, ()=>[...document.querySelectorAll('#desk .gh .gx')].map(b=>b.textContent).join('|')); check('d_forgot_link', /Repasar 2 olvidadas\|Planificar \(6\)/.test(x), x);
  await ev(page, ()=>document.querySelector('#desk [data-act=forgot]').scrollIntoView({block:'center'})); await shot(page, 'd-forgot-light');
  await page.click('#desk [data-act=forgot]'); await sheetUp(page);
  check('d_forgot_sheet', await ev(page, ()=>document.querySelector('#sheet h2').textContent==='Repasar olvidadas'));
  await ev(page, ()=>{ sheetOnClose=null; closeSheet(); }); await sheetGone(page);
  await ev(page, ()=>{ DB.settings.workWeek={trabajo:false}; save(); setDeskView('week'); }); await calm(page);
  x = await ev(page, ()=>{ const d=document.querySelector('#desk .wday[data-day="2026-11-04"]'); return {wh:d.querySelector('.wh').textContent, whc:d.querySelector('.wh').className, ld:d.querySelector('.ld').className, sc:+d.querySelector('.ld i').style.transform.replace(/[^0-9.]/g,''), tip:d.querySelector('.dh').title,
    tm:(()=>{ const e=document.querySelector('#desk .wday[data-day="2026-11-05"]'); return {wh:(e.querySelector('.wh')||{}).textContent, ld:e.querySelector('.ld').className}; })()}; });
  check('d_week_head', x.wh==='5 h 45' && x.whc==='wh orange' && x.ld==='ld orange' && Math.abs(x.sc-345/450)<.01 && x.tip==='6 tareas, 5 h 45 estimadas de 5 h' && x.tm.wh==='30 min' && x.tm.ld==='ld', x);
  await shot(page, 'd-week-light');
  await ev(page, ()=>setDeskView('hoy')); await calm(page);
  // 3. Posponer from the desktop menu
  await ev(page, ()=>{ const r=document.querySelector('#desk .row[data-id=h3]').getBoundingClientRect(); rowMenu('h3', {x:r.left+200, y:r.top+10}); }); await menuSettled(page);
  x = await menuLabels(page); check('d_menu_item', x.includes('Posponer recordatorio'), x);
  await ev(page, ()=>{ const b=[...document.querySelectorAll('#pmenu .pm-it')].find(q=>q.querySelector('.pm-l').textContent==='Posponer recordatorio'); b.click(); });
  await until(page, ()=>document.querySelectorAll('#pmenu .pm-menu').length===2);
  x = await menuLabels(page); check('d_menu_sub', x.slice(-5).join('|')==='10 minutos|1 hora|Esta tarde a las 17:00|Mañana a las 9:00|Elegir…', x);
  await shot(page, 'd-snooze-menu-light');
  await clickItem(page, 'Mañana a las 9:00'); await calm(page);
  x = await ev(page, ()=>({r:task('h3').reminder, s:task('h3').reminderSent, d:task('h3').date, t:document.querySelector('#toastText').textContent}));
  check('d_menu_snooze', x.r===new Date(2026,10,5,9,0).toISOString() && x.s===null && x.d==='2026-11-04' && x.t==='Recordatorio mañana a las 09:00', x); // the task's date stays
  await undo(page);
  // The bar in the inspector
  await ev(page, ()=>openTaskFromPush('h3', 'prueba')); await calm(page);
  check('d_bar', await ev(page, ()=>!!document.querySelector('#desk .pane .snzbar')));
  await shot(page, 'd-snooze-bar-light');
  await page.click('#desk .pane .snzbar [data-snz=pm]'); await calm(page);
  x = await ev(page, ()=>({r:task('h3').reminder, bar:!!document.querySelector('#desk .pane .snzbar')})); check('d_bar_pm', x.r===new Date(2026,10,4,17,0).toISOString() && !x.bar, x);
  await undo(page);
  // From 16:30 there is no Esta tarde a las 17:00
  await page.clock.setSystemTime(AT(16,31));
  x = await ev(page, ()=>snoozeOpts().map(o=>o[1])); check('late_no_pm', x.join('|')==='10 minutos|1 hora|Mañana a las 9:00', x);
  await page.clock.setSystemTime(AT(16,29));
  x = await ev(page, ()=>snoozeOpts().map(o=>o[1])); check('early_pm', x.includes('Esta tarde a las 17:00'), x);
  // The action of a notification while the app is open: the service worker's message
  await page.clock.setSystemTime(AT(10,0));
  await ev(page, ()=>openTaskFromPush('h3', 'app abierta', 10)); await calm(page);
  x = await ev(page, ()=>({r:task('h3').reminder, s:task('h3').reminderSent, t:document.querySelector('#toastText').textContent, bar:!!document.querySelector('#desk .pane .snzbar')}));
  check('d_action_10', x.r===new Date(2026,10,4,10,10).toISOString() && x.s===null && x.t==='Recordatorio a las 10:10' && !x.bar, x);
  await undo(page);
  // 4. The evening rule on the desktop
  await ev(page, ()=>pop()); await page.clock.setSystemTime(AT(18,29)); await ev(page, ()=>render()); await calm(page);
  x = await ev(page, ()=>({d:deskAddBase(null).date, cell:!!document.querySelector('#desk .closecell')})); check('d_eve_1829', x.d==='2026-11-04' && !x.cell, x);
  await page.clock.setSystemTime(AT(18,31)); await ev(page, ()=>render()); await calm(page);
  x = await ev(page, ()=>({d:deskAddBase(null).date, cell:!!document.querySelector('#desk .closecell'), todas:(()=>{ UI.deskView='todas'; const v=deskAddBase(null).date; UI.deskView='hoy'; return v; })()}));
  check('d_eve_1831', x.d==='2026-11-05' && x.cell && x.todas===null, x);
  await page.click('#desk [data-role=addbar]'); await page.keyboard.type('Enviar acta'); await until(page, ()=>AX.open);
  x = await ev(page, ()=>(document.querySelector('#desk .axb [data-ax=date]')||document.querySelector('#desk .axb button')||{}).textContent); check('d_eve_chip', /Mañana/.test(x||''), x);
  await shot(page, 'd-evening-add-light');
  await page.keyboard.press('Enter'); await calm(page);
  x = await ev(page, ()=>{ const t=DB.tasks.find(q=>q.title==='Enviar acta'); return {d:t&&t.date, toast:document.querySelector('#toastText').textContent}; });
  check('d_eve_added', x.d==='2026-11-05' && x.toast==='Añadida para mañana: Enviar acta', x);
  // 6. Closed on the desktop: the title and the sidebar say Mañana
  await ev(page, ()=>{ setClosedDay(true, 'prueba'); render(); }); await calm(page);
  x = await ev(page, ()=>({h1:document.querySelector('#desk .mhead h1').firstChild.textContent, side:document.querySelector('#desk .side [data-view=hoy]').textContent, sideDay:document.querySelector('#desk .side [data-view=hoy]').dataset.day, head:(document.querySelector('#desk .dayclosed .dcl')||{}).textContent, ahora:!!document.querySelector('#desk .main .ahora')}));
  check('d_closed', x.h1==='Mañana' && /^Mañana/.test(x.side) && x.sideDay==='2026-11-05' && x.head==='Día cerrado. Mañana, jueves 5' && !x.ahora, x);
  await shot(page, 'd-closed-light');
  await page.emulateMedia({colorScheme:'dark'}); await calm(page); await shot(page, 'd-closed-dark');
  await ctx.close();
  // ?task=&snooze= : a notification's action with the app closed
  const s2 = await open(browser, {tag:'Q', desk:true, query:'?task=h3&snooze=60'});
  check('q_snooze', await until(s2.page, ()=>task('h3').reminder===new Date(2026,10,4,11,0).toISOString()&&task('h3').reminderSent===null), await ev(s2.page, ()=>task('h3')));
  x = await ev(s2.page, ()=>({t:document.querySelector('#toastText').textContent, url:location.search, log:LOG.some(e=>/Recordatorio pospuesto/.test(e.m)&&/aviso, 60 min/.test(JSON.stringify(e)))}));
  check('q_snooze_toast', x.t==='Recordatorio a las 11:00' && x.url==='' && x.log, x);
  await ev(s2.page, ()=>document.querySelector('#toastBtn').click()); check('q_undo', await until(s2.page, ()=>task('h3').reminder===new Date(2026,10,4,9,55).toISOString()&&!!task('h3').reminderSent));
  await s2.ctx.close();
}

/* ======================= 6. Sync and SQL ======================= */
const TABLES = ['spaces','projects','tasks','voice_notes','attachments','subtasks','project_notes','contacts'];
class Fake {
  constructor(noCol){ this.noCol=!!noCol; this.t={}; TABLES.forEach(x=>this.t[x]=new Map()); this.last=0; this.subs=new Map(); this.ups=[]; }
  ts(){ this.last=Math.max(Date.now(), this.last+1); return new Date(this.last).toISOString(); }
  write(owner, table, rows){ if(!owner) throw new Error('JWT required'); const ts=this.ts(), out=[], changed=[], m=this.t[table];
    if(this.noCol&&table==='spaces'&&rows.some(r=>'closed_day' in r)) throw new Error("Could not find the 'closed_day' column of 'spaces' in the schema cache");
    rows.forEach(r=>{ const ex=m.get(r.id);
      if(!ex){ const row=Object.assign({created:null, deleted:null}, r, {owner_id:owner, server_ts:ts}); m.set(r.id,row); out.push({id:r.id}); changed.push(row); return; }
      if(Date.parse(r.modified) < Date.parse(ex.modified)) return;
      Object.assign(ex, r, {owner_id:ex.owner_id, server_ts:ts}); out.push({id:r.id}); changed.push(ex); });
    changed.forEach(row=>this.notify(table, row)); return out; }
  notify(table, row){ const copy=JSON.parse(JSON.stringify(row)); for(const [page, uid] of this.subs){ if(uid!==row.owner_id) continue; setTimeout(()=>{ page.evaluate(([t,r])=>window.__fakeRT&&window.__fakeRT(t,r), [table, copy]).catch(()=>{}); }, 40); } }
  rows(owner, table){ return [...this.t[table].values()].filter(r=>r.owner_id===owner); }
  handle(page, op, a){ const own=a&&a.owner;
    switch(op){
      case 'signIn': return {id:a.uid, email:a.email};
      case 'pull': { let rs=this.rows(own, a.table); if(a.after) rs=rs.filter(x=>Date.parse(x.server_ts)>Date.parse(a.after)); rs.sort((x,y)=>x.server_ts<y.server_ts?-1:x.server_ts>y.server_ts?1:x.id<y.id?-1:1); return JSON.parse(JSON.stringify(rs.slice(0,a.limit))); }
      case 'byIds': return JSON.parse(JSON.stringify(this.rows(own, a.table).filter(x=>a.ids.includes(x.id))));
      case 'upsert': this.ups.push({table:a.table, rows:a.rows}); return this.write(own, a.table, a.rows);
      case 'markDeleted': return this.write(own, a.table, a.items.map(x=>({id:x.id, deleted:x.ts, modified:x.ts})));
      case 'subscribe': this.subs.set(page, a.uid); return true;
      case 'unsubscribe': this.subs.delete(page); return true;
    } throw new Error('op '+op); }
}
const USER = {uid:'9b2f6d3e-0000-4000-8000-00000000e0a9', email:'enric@example.com'};
function fakeAdapter(){
  const call=(op,a)=>{ if(!navigator.onLine) return Promise.reject(new TypeError('Failed to fetch')); return window.fakeServer(op,a); };
  const owner=()=>{ const s=JSON.parse(localStorage.getItem('fake-session')||'null'); return s&&s.id; };
  window.__tareasRemote = {
    async init(){ return JSON.parse(localStorage.getItem('fake-session')||'null'); },
    onAuth(cb){ window.__fakeAuth=cb; },
    async signIn(){ const u=await window.fakeServer('signIn', {uid:window.__fakeUser.uid, email:window.__fakeUser.email}); localStorage.setItem('fake-session', JSON.stringify(u)); setTimeout(()=>window.__fakeAuth&&window.__fakeAuth(u,'SIGNED_IN'),0); },
    async signOut(){ localStorage.removeItem('fake-session'); },
    pull:(table, after, limit)=>call('pull',{owner:owner(), table, after, limit}),
    byIds:(table, ids)=>call('byIds',{owner:owner(), table, ids}),
    upsert:(table, rows)=>call('upsert',{owner:owner(), table, rows}),
    markDeleted:(table, items)=>call('markDeleted',{owner:owner(), table, items}),
    subscribe(uid, onRow, onStatus){ window.__fakeRT=(t,r)=>onRow(t,r); window.fakeServer('subscribe',{uid}); setTimeout(()=>onStatus('SUBSCRIBED'),0); return ()=>{ window.__fakeRT=null; window.fakeServer('unsubscribe',{}); }; }
  };
}
const synced = page => until(page, ()=>SY&&SY.user&&!SY.running&&SY.status==='ok'&&syncCollect(true).count===0);
async function syncTests(browser){ let x;
  const T = '2026-11-01T10:00:00.000Z', seed = { spaces:[{id:'trabajo',name:'Trabajo',order:0,created:T},{id:'personal',name:'Personal',order:1,created:T}], projects:[], tasks:[], voiceNotes:[], attachments:[], settings:{tipsSeen:true, dayHours:{trabajo:7}} };
  const fake = new Fake(false);
  const A = await open(browser, {tag:'SA', fake, seed, clock:false}), B = await open(browser, {tag:'SB', fake, seed, clock:false, desk:true});
  await ev(A.page, ()=>syncSignIn()); check('sync_A', await synced(A.page));
  // The first sync gives Trabajo its own id: its working hours follow it (as Solo de lunes a viernes)
  x = await ev(A.page, ()=>({id:space().id, h:dayHours(), set:DB.settings.dayHours}));
  check('sync_hours_follow', x.id!=='trabajo' && x.h===7 && !('trabajo' in x.set), x);
  await ev(B.page, ()=>syncSignIn()); check('sync_B', await synced(B.page));
  x = await ev(A.page, ()=>Object.keys(syncToRow('spaces', space())).join()); check('sync_sig', x==='id,created,name,sort_order,modified,deleted', x); // open: the signature of before
  await ev(A.page, ()=>{ setClosedDay(true, 'prueba'); render(); }); check('sync_A_up', await synced(A.page));
  const sid = await ev(A.page, ()=>space().id);
  check('sync_server', fake.t.spaces.get(sid).closed_day===await ev(A.page, ()=>todayStr()), fake.t.spaces.get(sid));
  check('sync_B_closed', await until(B.page, ()=>isClosed()&&!!document.querySelector('#desk .dayclosed')&&document.querySelector('#desk .mhead h1').firstChild.textContent==='Mañana'), await ev(B.page, ()=>space()));
  await ev(B.page, ()=>reopenDay()); check('sync_B_up', await synced(B.page));
  check('sync_A_open', await until(A.page, ()=>!isClosed()&&!document.querySelector('.screen.root .dayclosed')) && fake.t.spaces.get(sid).closed_day===null);
  await A.ctx.close(); await B.ctx.close();
  // A database without the column: one line in the log, the day stays closed on the device, the rest syncs, no upload loop
  const nf = new Fake(true), Cx = await open(browser, {tag:'SC', fake:nf, seed, clock:false});
  await ev(Cx.page, ()=>syncSignIn()); check('nocol_synced', await synced(Cx.page));
  await ev(Cx.page, ()=>{ setClosedDay(true, 'prueba'); render(); }); await synced(Cx.page);
  const n1 = nf.ups.length; await sleep(3000); await ev(Cx.page, ()=>syncRun('manual')); await synced(Cx.page);
  x = await ev(Cx.page, ()=>({c:isClosed(), warns:LOG.filter(e=>/0009_closed_day/.test(e.m)).map(e=>e.m), errs:LOG.filter(e=>e.l==='error').map(e=>e.m), pend:syncCollect(true).count, id:space().id}));
  const row = nf.t.spaces.get(x.id);
  check('nocol_tolerated', x.c && x.warns.length===1 && /spaces\.closed_day/.test(x.warns[0]) && /El día cerrado se queda en este dispositivo/.test(x.warns[0]) && !x.errs.length && x.pend===0 && row && !('closed_day' in row), {x, row});
  check('nocol_no_loop', nf.ups.length===n1, {n1, n:nf.ups.length});
  await Cx.ctx.close();
}
async function pgSetup(){
  const { PGlite } = await import(path.join(DEPS, '@electric-sql/pglite/dist/index.js'));
  const db = new PGlite();
  await db.exec(`
    create role authenticated; create role anon; create role service_role; create schema auth; create schema extensions;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
    grant usage on schema auth to authenticated, anon; grant execute on function auth.uid() to authenticated, anon;
    create schema cron; create table cron.job (jobid serial primary key, jobname text unique, schedule text, command text);
    create function cron.schedule(n text, s text, c text) returns bigint language sql as $$ insert into cron.job (jobname, schedule, command) values (n, s, c) returning jobid $$;
    create function cron.unschedule(n text) returns boolean language sql as $$ delete from cron.job where jobname = n returning true $$;
    create schema net; create function net.http_post(url text, body jsonb default '{}', params jsonb default '{}', headers jsonb default '{}', timeout_milliseconds int default 5000) returns bigint language sql as $$ select 1::bigint $$;
    create schema storage;
    create table storage.buckets (id text primary key, name text not null, public boolean default false, file_size_limit bigint, allowed_mime_types text[], created_at timestamptz default now());
    create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets (id), name text, owner uuid, created_at timestamptz default now(), unique (bucket_id, name));
    create function storage.foldername(name text) returns text[] language plpgsql as $$ declare p text[]; begin p := string_to_array(name, '/'); return p[1:array_length(p, 1) - 1]; end $$;
    alter table storage.objects enable row level security;
    grant usage on schema storage to authenticated, anon; grant select, insert, update, delete on storage.objects to authenticated;
    grant usage on schema public to service_role, authenticated;
  `);
  return db; }
const strip = s => s.replace(/^create extension if not exists pg_(cron|net).*$/mg, '-- (extension stand-in)');
async function sqlTests(){
  const rd = f => fs.readFileSync(path.join(ROOT, 'supabase/migrations', f), 'utf8'), mig = rd('0009_closed_day.sql');
  check('sql_no_drop_delete', !/drop|delete/i.test(mig));
  let db = await pgSetup();
  for(const f of fs.readdirSync(path.join(ROOT,'supabase/migrations')).filter(f=>f.endsWith('.sql')&&f<'0009').sort()) await db.exec(strip(rd(f)));
  let err = null; try { await db.exec(mig); await db.exec(mig); } catch(e){ err = e.message; }
  check('sql_runs_twice', !err, err);
  const q = async (sql) => (await db.query(sql)).rows;
  const cols = await q(`select data_type, is_nullable, col_description('public.spaces'::regclass, (select attnum from pg_attribute where attrelid='public.spaces'::regclass and attname='closed_day')) d from information_schema.columns where table_schema='public' and table_name='spaces' and column_name='closed_day'`);
  check('sql_column', cols.length===1 && cols[0].data_type==='date' && cols[0].is_nullable==='YES' && /Cerrar el día/.test(cols[0].d||''), cols);
  const A = '00000000-0000-4000-8000-0000000000a9';
  await db.exec(`insert into auth.users values ('${A}')`);
  const as = async (fn) => { await db.exec(`set test.uid = '${A}'; set role authenticated;`); try { return await fn(); } finally { await db.exec(`reset role; reset test.uid;`); } };
  await as(() => q(`insert into public.spaces (id, name, sort_order, closed_day, modified) values ('s1', 'Trabajo', 0, '2026-11-04', '2026-11-04T18:31:00Z')`));
  const older = await as(() => q(`update public.spaces set closed_day = null, modified = '2026-11-04T10:00:00Z' where id = 's1' returning id`));
  const newer = await as(() => q(`update public.spaces set closed_day = null, modified = '2026-11-04T19:00:00Z' where id = 's1' returning id`));
  const s1 = (await q(`select closed_day from public.spaces where id = 's1'`))[0];
  check('sql_newest_wins', !older.length && newer.length===1 && s1.closed_day===null, {older, newer, s1});
  await db.close();
  db = await pgSetup(); const all = strip(fs.readFileSync(path.join(ROOT, 'supabase/all.sql'), 'utf8'));
  err = null; try { await db.exec(all); await db.exec(all); } catch(e){ err = e.message; }
  check('sql_all_twice', !err && /0001 a 00\d\d/.test(all.split('\n')[0]) && /migrations\/0009_closed_day\.sql/.test(all), err);
  let rows = []; try { rows = (await db.query(fs.readFileSync(path.join(ROOT, 'supabase/check.sql'), 'utf8'))).rows; } catch(e){ err = e.message; }
  check('sql_check_all_ok', rows.length>=24 && rows.every(x=>x.Estado==='OK') && rows.some(x=>/spaces\.closed_day \(0009\)/.test(x.Pieza)), {err, bad:rows.filter(x=>x.Estado!=='OK'), n:rows.length});
  const readme = fs.readFileSync(path.join(ROOT, 'supabase/README.md'), 'utf8');
  check('sql_readme', /`migrations\/0009_closed_day\.sql`/.test(readme) && /suma de las \w+ en orden/.test(readme));
  await db.close();
}
// The service worker: the actions of a desktop notification and the ?snooze= it opens (read from the source, the worker needs HTTPS push)
function swTests(){ const s=fs.readFileSync(path.join(ROOT,'sw.js'),'utf8');
  check('sw_actions', /action: 'snooze10', title: '10 min'/.test(s) && /action: 'snooze60', title: '1 h'/.test(s) && /Notification\.maxActions > 0/.test(s) && /'&snooze=' \+ snooze/.test(s) && /type: 'openTask', taskId: id, snooze/.test(s));
  const f=fs.readFileSync(path.join(ROOT,'supabase/functions/send-reminders/index.ts'),'utf8');
  check('server_resends', /reminder_sent: 'is\.null'/.test(f) && /reminder: 'lte\.' \+ nowIso/.test(f)); // a reminder rewritten with reminder_sent emptied notifies again
}

(async()=>{
  await new Promise(res=>srv.listen(PORT,res)); const browser = await chromium.launch();
  try{ swTests(); }catch(e){ fails.push('sw_exception'); errors.push('sw: '+String(e&&e.stack||e)); }
  try{ await sqlTests(); }catch(e){ fails.push('sql_exception'); errors.push('sql: '+String(e&&e.stack||e)); }
  try{ await iphone(browser); }catch(e){ fails.push('iphone_exception'); errors.push('iphone: '+String(e&&e.stack||e)); }
  try{ await desktop(browser); }catch(e){ fails.push('desktop_exception'); errors.push('desktop: '+String(e&&e.stack||e)); }
  try{ await syncTests(browser); }catch(e){ fails.push('sync_exception'); errors.push('sync: '+String(e&&e.stack||e)); }
  console.log(JSON.stringify({r, fails, errors}, null, 1));
  await browser.close(); srv.close(); process.exit(fails.length||errors.length?1:0);
})();
