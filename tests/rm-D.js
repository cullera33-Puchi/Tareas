require('./lib/out.js'); // outputs (screenshots, downloads) go to tests/out
// Roadmap batch D: R10, anchored menus on the iPhone (long press lifts the row; buttons anchor the menu; slide to choose)
const { chromium } = require('playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = path.resolve(__dirname, '..'); const OUT = path.join(__dirname, 'out', 'D'); fs.mkdirSync(OUT, {recursive:true});
const TYPES = {'.html':'text/html','.css':'text/css','.js':'application/javascript','.webmanifest':'application/manifest+json','.png':'image/png'};
const srv = http.createServer((req,res)=>{ let p = decodeURIComponent(req.url.split('?')[0]); if(p==='/') p='/index.html'; const f=path.join(ROOT,p); if(!fs.existsSync(f)){res.writeHead(404);res.end();return;} res.writeHead(200,{'Content-Type':TYPES[path.extname(f)]||'application/octet-stream'}); res.end(fs.readFileSync(f)); });
const PORT=9104, URL='http://localhost:'+PORT+'/';
const SEED = JSON.stringify({spaces:[{id:'trabajo',name:'Trabajo',order:0},{id:'personal',name:'Personal',order:1}],projects:[],tasks:[],voiceNotes:[],settings:{tipsSeen:true}});
const r={}, fails=[]; const check=(name, ok, info)=>{ r[name]=ok?true:(info===undefined?false:info); if(!ok) fails.push(name); };
const HOY='.screen.root[data-root=tareas]';

async function mobile(browser, scheme, extra){
  const ctx = await browser.newContext(Object.assign({ viewport:{width:390,height:844}, deviceScaleFactor:2, isMobile:true, hasTouch:true, colorScheme:scheme }, extra||{}));
  const page = await ctx.newPage(); await page.addInitScript(s=>{ if(!localStorage.getItem('tareas-v1')) localStorage.setItem('tareas-v1', s); }, SEED);
  const errors=[]; page.on('pageerror', e=>errors.push(e.message)); page.on('console', m=>{ if(m.type()==='error') errors.push(m.text()); });
  await page.goto(URL); await page.waitForTimeout(400);
  const cdp = await ctx.newCDPSession(page);
  return {ctx, page, cdp, errors};
}
const T = (cdp, type, pts) => cdp.send('Input.dispatchTouchEvent', {type, touchPoints:pts});
// Long press at (x,y): the finger stays down; returns once the menu had time to open
async function press(cdp, page, x, y){ await T(cdp,'touchStart',[{x,y}]); await page.waitForTimeout(700); }
async function slide(cdp, page, x0, y0, x1, y1, n){ for(let i=1;i<=n;i++){ await T(cdp,'touchMove',[{x:x0+(x1-x0)*i/n, y:y0+(y1-y0)*i/n}]); await page.waitForTimeout(25); } }
const lift = (cdp) => T(cdp,'touchEnd',[]);
const center = async (page, sel) => { await page.$eval(sel, e=>{ const sc=e.closest('.scroll'); if(!sc) return; const b=e.getBoundingClientRect(), r=sc.getBoundingClientRect(); if(b.top<r.top+60||b.bottom>r.bottom-120) sc.scrollTop+=b.top-(r.top+r.height/2); }); await page.waitForTimeout(80); return page.$eval(sel, e=>{ const b=e.getBoundingClientRect(); return {x:b.x+b.width/2, y:b.y+b.height/2}; }); };
const rowSel = title => HOY+' .scroll .group .row:has(.row-title:text-is("'+title+'"))';
const menuState = page => page.evaluate(()=>{ const pm=document.querySelector('#pmenu'); const mn=pm.querySelector('.pm-menu'); if(!mn) return {open:false};
  const b=mn.getBoundingClientRect(), lf=pm.querySelector('.pm-lift'), lb=lf&&lf.getBoundingClientRect();
  return {open:pm.classList.contains('on'), lift:!!lf, items:[...mn.querySelectorAll('.pm-it')].map(x=>x.querySelector('.pm-l').firstChild.textContent), checked:[...mn.querySelectorAll('.pm-it')].filter(x=>x.querySelector('.pm-ck svg')).map(x=>x.querySelector('.pm-l').firstChild.textContent),
    prio:[...mn.querySelectorAll('.pm-prio button')].map(x=>x.textContent+(x.classList.contains('on')?'*':'')), head:(mn.querySelector('.pm-head')||{}).textContent||null, title:(mn.querySelector('.pm-title')||{}).textContent||null,
    groups:mn.querySelectorAll('.pm-grp').length, icons:[...mn.querySelectorAll('.pm-it')].every(x=>!!x.querySelector('.pm-ic svg, .pm-ic .pm-dot')),
    box:{top:b.top,bottom:b.bottom,left:b.left,right:b.right,h:b.height}, liftBox:lb&&{top:lb.top,bottom:lb.bottom}, vh:innerHeight, vw:innerWidth, bg:getComputedStyle(mn).backgroundColor, tf:getComputedStyle(mn).transform}; });
const itemCenter = (page, label) => page.evaluate(l=>{ const b=[...document.querySelectorAll('#pmenu .pm-it, #pmenu .pm-prio button, #pmenu .pm-head')].find(x=>x.textContent.trim().startsWith(l)); if(!b) return null; const q=b.getBoundingClientRect(); return {x:q.x+q.width/2, y:q.y+q.height/2}; }, label);
const tapItem = async (page, label) => { await page.waitForFunction(()=>typeof menuFresh!=='function'||!menuFresh()); /* batch I: a tap-opened menu ignores taps for 450 ms (v0.14.1 guard) */ const c=await itemCenter(page, label); if(!c) throw new Error('no menu item '+label); await page.touchscreen.tap(c.x, c.y); await page.waitForTimeout(400); };
const rowHidden = (page, title) => page.$eval(rowSel(title), e=>getComputedStyle(e).visibility==='hidden');

(async()=>{
  await new Promise(res=>srv.listen(PORT,res));
  const browser = await chromium.launch();

  /* ---------- Mobile, light ---------- */
  let {ctx, page, cdp, errors} = await mobile(browser, 'light');
  await page.evaluate(()=>{ const t=todayStr(); const p=addProject('FLC','#FF9500'); addProject('Casa','#34C759');
    ['Uno','Dos','Tres','Cuatro','Cinco','Seis','Siete'].forEach((n,i)=>addTask({title:n, date:t, projectId:i===0?p.id:null})); addTask({title:'Prioritaria', date:t, priority:'mid'}); save(); render(); });
  await page.waitForTimeout(300);

  // Long press lifts the row and opens the menu next to it
  let c = await center(page, rowSel('Dos'));
  await press(cdp, page, c.x, c.y);
  let m = await menuState(page);
  check('lp_opens', m.open && m.lift, m);
  check('lp_rowHidden', await rowHidden(page, 'Dos'));
  // Updated by decisions 39 (Ahora) and 41 (Por confirmar): two items after Completar; 48a: Fecha límite after Aplazar
  // v0.37.4 (decision 84, U7): Mover a otro espacio, Duplicar and Seleccionar under Más
  check('lp_items', JSON.stringify(m.items)===JSON.stringify(['Aplazar','Fecha límite','Tiempo','Responsable','Mover a proyecto','Completar','Ahora','Por confirmar','Más','Eliminar']), m.items);
  check('lp_prio', JSON.stringify(m.prio)===JSON.stringify(['Alta','Media','Ninguna*']), m.prio);
  check('lp_groups_icons', m.groups===4 && m.icons, m);
  check('lp_onScreen', m.box.top>=8 && m.box.bottom<=m.vh-8 && m.box.left>=8 && m.box.right<=m.vw-8, m.box);
  check('lp_noOverlap', m.box.top>=m.liftBox.bottom-1 || m.box.bottom<=m.liftBox.top+1, {box:m.box, lift:m.liftBox});
  check('lp_blur', await page.$eval('#pmenu', e=>e.classList.contains('lift') && /blur/.test(getComputedStyle(e.querySelector('.pm-back')).backdropFilter||getComputedStyle(e.querySelector('.pm-back')).webkitBackdropFilter||'')));
  await page.screenshot({path:OUT+'/d-light-rowmenu.png'});
  // Lifting without moving keeps it open
  await lift(cdp); await page.waitForTimeout(300);
  check('lp_staysOpen', (await menuState(page)).open);
  // Tap outside closes it and the row shows again
  await page.touchscreen.tap(4, 420); await page.waitForTimeout(450);
  check('tapOutsideCloses', !(await menuState(page)).open && !(await rowHidden(page,'Dos')) && await page.evaluate(()=>!menuOpen()));

  // Slide to choose: long press, slide to Ahora without lifting, lift (v0.37.4: Duplicar is under Más now)
  c = await center(page, rowSel('Tres'));
  await press(cdp, page, c.x, c.y);
  let it = await itemCenter(page, 'Ahora');
  await slide(cdp, page, c.x, c.y, it.x, it.y, 8);
  r.hl = await page.evaluate(()=>{ const h=document.querySelector('#pmenu .hl'); return h&&h.textContent.trim(); });
  check('slide_highlights', r.hl==='Ahora', r.hl);
  await lift(cdp); await page.waitForTimeout(600);
  check('slide_runs', await page.evaluate(()=>!!DB.tasks.find(x=>x.title==='Tres').focus) && !(await menuState(page)).open);
  // duplicateTask opens the copy: back to Tareas
  await page.evaluate(()=>{ while(UI.stack.length) pop(); }); await page.waitForTimeout(500);

  // Slide to a priority button
  c = await center(page, rowSel('Cuatro'));
  await press(cdp, page, c.x, c.y); it = await itemCenter(page, 'Alta');
  await slide(cdp, page, c.x, c.y, it.x, it.y, 8); await lift(cdp); await page.waitForTimeout(500);
  check('slide_priority', await page.evaluate(()=>DB.tasks.find(x=>x.title==='Cuatro').priority==='high'));
  // Slide away and lift outside: closes, nothing changes
  c = await center(page, rowSel('Cinco'));
  await press(cdp, page, c.x, c.y); await slide(cdp, page, c.x, c.y, 4, 300, 6); await lift(cdp); await page.waitForTimeout(450);
  check('slide_outsideCloses', !(await menuState(page)).open && await page.evaluate(()=>{ const x=DB.tasks.find(y=>y.title==='Cinco'); return x.priority==='none'&&x.date===todayStr(); }));

  // Submenu: Aplazar replaces the menu in place, with a header that goes back
  c = await center(page, rowSel('Cinco'));
  await press(cdp, page, c.x, c.y); await lift(cdp); await page.waitForTimeout(200);
  await tapItem(page, 'Aplazar');
  m = await menuState(page);
  check('sub_aplazar', m.open && m.head==='Aplazar' && m.items[0]==='Mañana' && m.items.length>=3 && m.items[m.items.length-1]==='Elegir fecha' && m.box.top>=8 && m.box.bottom<=m.vh-8, m);
  await page.screenshot({path:OUT+'/d-light-sub.png'});
  await tapItem(page, 'Aplazar'); // the header goes back
  m = await menuState(page);
  check('sub_back', m.open && !m.head && m.items[0]==='Aplazar', m);
  await tapItem(page, 'Aplazar'); await tapItem(page, 'Mañana'); await page.waitForTimeout(400);
  check('sub_postponed', await page.evaluate(()=>DB.tasks.find(x=>x.title==='Cinco').date===addDays(todayStr(),1)) && !(await menuState(page)).open);
  // Mover a proyecto: the current one checked
  c = await center(page, rowSel('Uno'));
  await press(cdp, page, c.x, c.y); await lift(cdp); await page.waitForTimeout(200); await tapItem(page, 'Mover a proyecto');
  m = await menuState(page);
  check('sub_projects', JSON.stringify(m.items)===JSON.stringify(['Ninguno','FLC','Casa']) && JSON.stringify(m.checked)===JSON.stringify(['FLC']), m);
  await tapItem(page, 'Casa');
  check('sub_projectMoved', await page.evaluate(()=>{ const x=DB.tasks.find(y=>y.title==='Uno'); return proj(x.projectId).name==='Casa'; }));
  // Eliminar asks in the bottom sheet (confirmations stay there)
  c = await center(page, rowSel('Seis'));
  await press(cdp, page, c.x, c.y); await lift(cdp); await page.waitForTimeout(200); await tapItem(page, 'Eliminar');
  r.confirm = await page.evaluate(()=>({on:document.querySelector('#asheet').classList.contains('on'), items:[...document.querySelectorAll('#asheet .it')].map(b=>b.textContent)}));
  check('delete_confirmSheet', r.confirm.on && r.confirm.items[0]==='Eliminar tarea', r.confirm);
  await page.click('#asheet .it.red'); await page.waitForTimeout(500);
  check('delete_done', await page.evaluate(()=>!DB.tasks.some(x=>x.title==='Seis')));

  // R1: a marked row long pressed leaves the marks, and the menu opens
  c = await center(page, rowSel('Siete')+' .check'); await page.touchscreen.tap(c.x, c.y); await page.waitForTimeout(150);
  check('hold_marked', await page.evaluate(()=>HELD.size===1));
  c = await center(page, rowSel('Siete')); await press(cdp, page, c.x+60, c.y); await lift(cdp); await page.waitForTimeout(200);
  r.hold = await page.evaluate(()=>({held:HELD.size, status:DB.tasks.find(x=>x.title==='Siete').status}));
  m = await menuState(page);
  check('hold_released', r.hold.held===0 && r.hold.status==='pending' && m.open && m.items.includes('Completar'), {hold:r.hold, m});
  await page.waitForTimeout(1700); // the hold timer would have fired: the menu is still there
  check('hold_menuStays', (await menuState(page)).open);
  // Seleccionar enters multi-select with that task
  await tapItem(page, 'Más'); await page.waitForTimeout(400); await tapItem(page, 'Seleccionar'); // v0.37.4: under Más
  check('select_starts', await page.evaluate(()=>!!UI.select && UI.select.ids.size===1 && app.classList.contains('selecting')));
  // Select bar menus hang above the bar
  await page.tap('#selbar [data-act=bulkPostpone]'); await page.waitForTimeout(450);
  m = await menuState(page); const sb = await page.$eval('#selbar', e=>e.getBoundingClientRect().top);
  check('selbar_menu', m.open && !m.lift && m.title==='Aplazar 1 tarea' && m.items[0]==='Mañana' && m.items[m.items.length-1]==='Sin fecha' && m.box.bottom<=sb, {m, sb});
  await page.screenshot({path:OUT+'/d-light-selbar.png'});
  await tapItem(page, 'Mañana');
  check('selbar_postponed', await page.evaluate(()=>!UI.select && DB.tasks.find(x=>x.title==='Siete').date===addDays(todayStr(),1)));

  // Space selector: anchored under the title, the active space checked
  await page.tap(HOY+' .nav [data-act=spaceMenu]'); await page.waitForTimeout(450);
  m = await menuState(page); const tb = await page.$eval(HOY+' .nav [data-act=spaceMenu]', e=>{ const b=e.getBoundingClientRect(); return {bottom:b.bottom, left:b.left}; });
  check('space_menu', m.open && !m.lift && JSON.stringify(m.items)===JSON.stringify(['Trabajo','Personal','Nuevo espacio']) && JSON.stringify(m.checked)===JSON.stringify(['Trabajo']) && m.box.top>=tb.bottom && Math.abs(m.box.left-Math.max(8,tb.left))<2, {m, tb});
  await page.screenshot({path:OUT+'/d-light-space.png'});
  await tapItem(page, 'Personal');
  check('space_switched', await page.evaluate(()=>DB.settings.activeSpace==='personal'));
  await page.tap(HOY+' .nav [data-act=spaceMenu]'); await page.waitForTimeout(400); await tapItem(page, 'Trabajo');

  // View menu (R13): anchored to the three dots, right aligned
  await page.tap(HOY+' .nav .vopts'); await page.waitForTimeout(450);
  m = await menuState(page); const vb = await page.$eval(HOY+' .nav .vopts', e=>{ const b=e.getBoundingClientRect(); return {bottom:b.bottom, right:b.right}; });
  check('view_menu', m.open && m.items[0]==='Seleccionar tareas' && m.items.includes('Agrupar por fecha') && JSON.stringify(m.checked)===JSON.stringify(['Agrupar por fecha']) && m.box.top>=vb.bottom && m.box.right<=vb.right+1 && m.box.right>=vb.right-12, {m, vb});
  await tapItem(page, 'Agrupar por proyecto');
  check('view_group', await page.evaluate(()=>DB.settings.hoyGroup==='project'));
  await page.tap(HOY+' .nav .vopts'); await page.waitForTimeout(400); await tapItem(page, 'Agrupar por fecha');

  // Detail: three dots, Prioridad and Proyecto rows
  await page.evaluate(()=>openDetail(DB.tasks.find(x=>x.title==='Dos').id)); await page.waitForTimeout(600);
  const D='.pushed-screen.detail';
  await page.tap(D+' [data-act=menu]'); await page.waitForTimeout(450);
  m = await menuState(page);
  check('detail_menu', m.open && JSON.stringify(m.items)===JSON.stringify(['Marcar completada','Por confirmar','Mover a otro espacio','Duplicar','Eliminar tarea']) && m.box.right<=m.vw-8, m);
  await page.screenshot({path:OUT+'/d-light-detailmenu.png'});
  await tapItem(page, 'Mover a otro espacio');
  m = await menuState(page);
  check('detail_spaceSub', m.head==='Mover a otro espacio' && JSON.stringify(m.items)===JSON.stringify(['Personal']), m);
  await page.touchscreen.tap(4, 420); await page.waitForTimeout(400);
  check('detail_closed', !(await menuState(page)).open && await page.evaluate(()=>DB.tasks.find(x=>x.title==='Dos').spaceId==='trabajo'));
  await page.tap(D+' [data-act=pickPriority]'); await page.waitForTimeout(450);
  m = await menuState(page);
  check('detail_priority', JSON.stringify(m.items)===JSON.stringify(['Alta','Media','Ninguna']) && JSON.stringify(m.checked)===JSON.stringify(['Ninguna']), m);
  await page.screenshot({path:OUT+'/d-light-priority.png'});
  await tapItem(page, 'Media');
  check('detail_prioritySet', await page.evaluate(()=>DB.tasks.find(x=>x.title==='Dos').priority==='mid') && await page.$eval(D+' [data-act=pickPriority] .val', e=>e.textContent==='Media'));
  await page.tap(D+' [data-act=pickProject]'); await page.waitForTimeout(450);
  m = await menuState(page);
  check('detail_project', JSON.stringify(m.items)===JSON.stringify(['Ninguno','FLC','Casa']) && JSON.stringify(m.checked)===JSON.stringify(['Ninguno']) && !m.title, m);
  await tapItem(page, 'FLC');
  check('detail_projectSet', await page.evaluate(()=>proj(DB.tasks.find(x=>x.title==='Dos').projectId).name==='FLC'));
  await page.evaluate(()=>{ while(UI.stack.length) pop(); }); await page.waitForTimeout(500);

  // Project long press in Proyectos: the cell lifts
  await page.tap('.tabbar [data-tab=proyectos]').catch(async()=>{ await page.evaluate(()=>{ UI.tab='proyectos'; render(); }); }); await page.waitForTimeout(400);
  const pc = await page.$eval('.screen.root[data-root=proyectos] [data-open-project]', e=>{ const b=e.getBoundingClientRect(); return {x:b.x+b.width/2, y:b.y+b.height/2}; });
  await press(cdp, page, pc.x, pc.y);
  m = await menuState(page);
  check('project_menu', m.open && m.lift && m.items[0]==='Renombrar o cambiar color' && m.items.includes('Bajar') && m.items[m.items.length-1]==='Archivar', m);
  it = await itemCenter(page, 'Bajar'); await slide(cdp, page, pc.x, pc.y, it.x, it.y, 6); await lift(cdp); await page.waitForTimeout(500);
  check('project_slideBajar', await page.evaluate(()=>activeProjects()[1].name==='FLC'));
  await page.evaluate(()=>{ UI.tab='tareas'; render(); }); await page.waitForTimeout(300);

  // Long lists with deferred rows: a row drawn while scrolling lifts like any other; a row near the bottom keeps its menu on screen
  await page.evaluate(()=>{ generateDemo(); for(let i=0;i<260;i++) addTask({title:'Larga '+i, date:todayStr()}); DB.settings.filter='todas'; save(); render(); }); await page.waitForTimeout(500);
  r.deferred = await page.evaluate(()=>document.querySelectorAll('.screen.root[data-root=tareas] .rph').length);
  await page.evaluate(()=>{ const sc=document.querySelector('.screen.root[data-root=tareas] .scroll'); sc.scrollTop=sc.scrollHeight*0.6; sc.dispatchEvent(new Event('scroll')); }); await page.waitForTimeout(400);
  const deep = await page.evaluate(()=>{ document.querySelector('#toast').classList.remove('on'); /* the demo data toast covers the bottom rows */ const sc=document.querySelector('.screen.root[data-root=tareas] .scroll'); const tb=document.querySelector('.tabbar').getBoundingClientRect().top; const rows=[...sc.querySelectorAll('.row[data-id]')].filter(x=>{ const b=x.getBoundingClientRect(); return b.bottom<tb-4&&b.top>200; }); const x=rows[rows.length-1]; const b=x.getBoundingClientRect(); return {id:x.dataset.id, x:b.x+b.width/2, y:b.y+b.height/2}; });
  await press(cdp, page, deep.x, deep.y); await lift(cdp); await page.waitForTimeout(300);
  m = await menuState(page);
  check('deep_open', r.deferred>0 && m.open && m.lift && m.box.top>=8 && m.box.bottom<=m.vh-8 && m.box.bottom<=m.liftBox.top+1, {deferred:r.deferred, m});
  await page.screenshot({path:OUT+'/d-light-bottomrow.png'});
  await page.touchscreen.tap(4, 420); await page.waitForTimeout(450);
  check('deep_closed', !(await menuState(page)).open && await page.evaluate(id=>getComputedStyle(document.querySelector('.screen.root[data-root=tareas] .row[data-id="'+id+'"]')).visibility==='visible', deep.id));
  // A render while the menu is up (another window saved) keeps the row hidden under its copy
  const top = await page.evaluate(()=>{ const sc=document.querySelector('.screen.root[data-root=tareas] .scroll'); sc.scrollTop=0; return true; }); await page.waitForTimeout(300);
  const firstRow = await page.evaluate(()=>{ const x=document.querySelector('.screen.root[data-root=tareas] .scroll .group .row[data-id]'); const b=x.getBoundingClientRect(); return {id:x.dataset.id, x:b.x+b.width/2, y:b.y+b.height/2}; });
  await press(cdp, page, firstRow.x, firstRow.y); await lift(cdp); await page.waitForTimeout(200);
  await page.evaluate(()=>render()); await page.waitForTimeout(150);
  m = await menuState(page);
  check('render_keepsHidden', m.open && await page.evaluate(id=>getComputedStyle(document.querySelector('.screen.root[data-root=tareas] .row[data-id="'+id+'"]')).visibility==='hidden', firstRow.id) && m.box.top>=m.liftBox.bottom-1, m);
  await page.touchscreen.tap(4, 420); await page.waitForTimeout(450);
  check('noErrorsLight', errors.length===0, errors);
  await ctx.close();

  /* ---------- Mobile, dark ---------- */
  ({ctx, page, cdp, errors} = await mobile(browser, 'dark'));
  await page.evaluate(()=>{ const t=todayStr(); const p=addProject('FLC','#FF9500'); ['Uno','Dos','Tres'].forEach(n=>addTask({title:n, date:t, projectId:p.id, priority:n==='Dos'?'high':'none'})); save(); render(); }); await page.waitForTimeout(300);
  c = await center(page, rowSel('Dos'));
  await press(cdp, page, c.x, c.y); await lift(cdp); await page.waitForTimeout(250);
  m = await menuState(page);
  const lum = s=>{ const v=s.match(/[\d.]+/g).map(Number); return (v[0]+v[1]+v[2])/3; };
  check('dark_menu', m.open && JSON.stringify(m.prio)===JSON.stringify(['Alta*','Media','Ninguna']) && lum(m.bg)<90, m);
  await page.screenshot({path:OUT+'/d-dark-rowmenu.png'});
  await page.touchscreen.tap(4, 420); await page.waitForTimeout(400);
  await page.tap(HOY+' .nav [data-act=spaceMenu]'); await page.waitForTimeout(450);
  await page.screenshot({path:OUT+'/d-dark-space.png'});
  await page.touchscreen.tap(4, 420); await page.waitForTimeout(400);
  check('noErrorsDark', errors.length===0, errors);
  await ctx.close();

  /* ---------- Reduce Motion: the menu fades, never scales ---------- */
  ({ctx, page, cdp, errors} = await mobile(browser, 'light', {reducedMotion:'reduce'}));
  await page.evaluate(()=>{ addTask({title:'Uno', date:todayStr()}); save(); render(); }); await page.waitForTimeout(300);
  c = await center(page, rowSel('Uno'));
  await press(cdp, page, c.x, c.y);
  r.rmTf = await page.evaluate(()=>{ const mn=document.querySelector('#pmenu .pm-menu'), lf=document.querySelector('#pmenu .pm-lift'); return {menu:getComputedStyle(mn).transform, menuTr:getComputedStyle(mn).transitionProperty, lift:getComputedStyle(lf).transform}; });
  check('rm_noScale', r.rmTf.menu==='none' && r.rmTf.menuTr==='opacity' && /^(none|matrix\(1, 0, 0, 1, 0, [-\d.]+\))$/.test(r.rmTf.lift), r.rmTf);
  await lift(cdp); await page.waitForTimeout(200); await tapItem(page, 'Completar'); await page.waitForTimeout(400);
  check('rm_complete', await page.evaluate(()=>DB.tasks[0].status==='done'));
  check('noErrorsRM', errors.length===0, errors);
  await ctx.close();

  /* ---------- Small screen: the lifted row moves out of the menu's way ---------- */
  ({ctx, page, cdp, errors} = await mobile(browser, 'light', {viewport:{width:320,height:568}}));
  await page.evaluate(()=>{ for(let i=0;i<12;i++) addTask({title:'T'+i, date:todayStr()}); save(); render(); }); await page.waitForTimeout(300);
  c = await center(page, rowSel('T3'));
  await press(cdp, page, c.x, c.y); await lift(cdp); await page.waitForTimeout(500);
  m = await menuState(page);
  check('small_fits', m.open && m.box.top>=8 && m.box.bottom<=m.vh-8 && m.box.right<=m.vw-8 && m.box.left>=8 && (m.box.top>=m.liftBox.bottom-1 || m.box.bottom<=m.liftBox.top+1) && m.liftBox.top>=0, m);
  await page.screenshot({path:OUT+'/d-small.png'});
  check('noErrorsSmall', errors.length===0, errors);
  await ctx.close();

  /* ---------- Desktop: a macOS menu since batch E (R17) ---------- */
  ctx = await browser.newContext({viewport:{width:1280,height:800}}); page = await ctx.newPage(); errors=[];
  page.on('pageerror', e=>errors.push(e.message)); await page.addInitScript(s=>{ if(!localStorage.getItem('tareas-v1')) localStorage.setItem('tareas-v1', s); }, SEED);
  await page.goto(URL); await page.waitForTimeout(400);
  await page.evaluate(()=>{ addTask({title:'Uno', date:todayStr()}); save(); render(); }); await page.waitForTimeout(300);
  await page.click('#desk .group .row .row-title', {button:'right'}); await page.waitForTimeout(300);
  // Updated by batch E (R17): the desktop menus are now macOS menus at the pointer (#pmenu.mac), no longer the centred action sheet
  r.desk = await page.evaluate(()=>({asheet:document.querySelector('#asheet').classList.contains('on'), pm:menuOpen(), mac:document.querySelector('#pmenu').classList.contains('mac'), lift:!!document.querySelector('#pmenu .pm-lift'), items:[...document.querySelectorAll('#pmenu .pm-it .pm-l')].map(b=>b.textContent)}));
  check('desk_macMenu', !r.desk.asheet && r.desk.pm && r.desk.mac && !r.desk.lift && r.desk.items[0]==='Completar', r.desk);
  check('noErrorsDesk', errors.length===0, errors);
  await ctx.close();

  await browser.close(); srv.close();
  console.log(JSON.stringify(Object.assign(r, {errors:fails}), null, 1));
  process.exit(fails.length?1:0);
})().catch(e=>{ console.error(e); console.log(JSON.stringify(Object.assign(r,{errors:fails.concat(['crash: '+e.message])}),null,1)); process.exit(1); });
