require('./lib/out.js'); // outputs (screenshots, downloads) go to tests/out
// Roadmap M4 (status summary to share), port 10610. Clock at Thursday 5 November 2026 10:00. Screenshots in tests/out/m4.
//  1. The text: the exact text of a seeded project for «Esta semana» (done on Monday and Wednesday, one done last week left out, a
//     carried task, today's tasks, one in Ahora, a deadline, steps, waiting tasks with and without a review day, the next 14 days, at most
//     five undated), «Últimos 7 días» (last week's Saturday comes in), the space text (two projects in Proyectos order, Sin proyecto, an
//     empty project and the other space left out). No «·», «—» or «→» anywhere.
//  2. iPhone: the project's «...» has Compartir estado, the Tareas «...» Compartir estado de la semana, the project's long press menu too;
//     the sheet with its header (Copiar, Compartir), the period chips that redo the text, an edited text is what is copied; share falls back
//     to copy when navigator.share is missing; the log line Estado compartido. Light and dark screenshots.
//  3. Desktop: the column's «...» (space and project) and the sidebar project's right click; the centred dialog with Cerrar, Copiar and
//     Compartir; navigator.share used when present. Screenshots.
const { chromium } = require('playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = path.resolve(__dirname, '..'), PORT = 10610, URL0 = 'http://localhost:'+PORT+'/';
const OUT = path.join(__dirname, 'out', 'm4'); fs.mkdirSync(OUT, {recursive:true});
const TYPES = {'.html':'text/html','.css':'text/css','.js':'application/javascript','.webmanifest':'application/manifest+json','.png':'image/png'};
const srv = http.createServer((req,res)=>{ let p = decodeURIComponent(req.url.split('?')[0]); if(p==='/') p='/index.html';
  if(p==='/config.js'){ res.writeHead(200,{'Content-Type':'application/javascript'}); res.end('window.TAREAS_CONFIG = {"url":null,"anonKey":null};\n'); return; }
  const f=path.join(ROOT,p); if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){ res.writeHead(404,{'Content-Type':'text/html'}); res.end('<h1>404</h1>'); return; }
  res.writeHead(200,{'Content-Type':TYPES[path.extname(f)]||'application/octet-stream'}); res.end(fs.readFileSync(f)); });
const r={}, fails=[], errors=[]; const check=(name, ok, info)=>{ r[name]=ok?true:(info===undefined?false:info); if(!ok) fails.push(name); };
const sleep=ms=>new Promise(res=>setTimeout(res,ms));
const shot=async (page, name)=>{ await page.evaluate(()=>document.querySelector('#toast').classList.remove('on')); await page.waitForTimeout(400); return page.screenshot({path:path.join(OUT, name+'.png')}); }; // the toast hidden (and its fade over) so it does not cover the sheet

const NOW = new Date(2026, 10, 5, 10, 0, 0); // Thursday 5 November 2026, 10:00 local
const T0 = '2026-10-01T08:00:00.000Z';
const cr = k => new Date(Date.parse(T0)+k*60000).toISOString(); // created, in a known order
const at = (d, h) => new Date(+d.slice(0,4), +d.slice(5,7)-1, +d.slice(8,10), h, 0, 0).toISOString(); // a local time
let K=0; const tk = (id, o) => Object.assign({id, title:id, spaceId:'trabajo', projectId:'p1', date:null, reminder:null, priority:'none', status:'pending', notes:'', carried:false, created:cr(++K), modified:T0, completed:null}, o);
const done = (id, title, d, o) => tk(id, Object.assign({title, status:'done', completed:at(d, 11), date:d}, o));
const st = (id, i, d) => ({id, taskId:'t2', title:'Paso '+i, done:d, order:i*1024, created:cr(200+i), modified:T0});
const SEED = () => ({ spaces:[{id:'trabajo',name:'Trabajo',order:0,created:T0},{id:'personal',name:'Personal',order:1,created:T0}],
  projects:[{id:'p1', spaceId:'trabajo', name:'OCA', color:'#007AFF', order:0, archived:false, created:T0, modified:T0},
    {id:'p2', spaceId:'trabajo', name:'FLC', color:'#34C759', order:1, archived:false, created:T0, modified:T0},
    {id:'p3', spaceId:'trabajo', name:'Vacío', color:'#FF9500', order:2, archived:false, created:T0, modified:T0},
    {id:'p4', spaceId:'trabajo', name:'Archivado', color:'#AF52DE', order:3, archived:true, created:T0, modified:T0},
    {id:'p9', spaceId:'personal', name:'Casa', color:'#FF2D55', order:0, archived:false, created:T0, modified:T0}],
  tasks:[ done('d9', 'Informe de septiembre', '2026-10-29'), // Thursday of the week before last: never
    done('d0', 'Informe de octubre', '2026-10-31'), // last week's Saturday: only in Últimos 7 días
    done('d1', 'Kick-off con el cliente', '2026-11-02', {priority:'high'}), // Monday
    done('d2', 'Revisión de diseño', '2026-11-04'), // Wednesday
    tk('c1', {title:'Llamar a Luis', date:'2026-11-04'}), // yesterday's: rollOver carries it to today
    tk('t1', {title:'Preparar SteerCo', date:'2026-11-05', priority:'high', deadline:'2026-11-06', notes:'Notas que no salen'}),
    tk('t2', {title:'Plan de pruebas', date:'2026-11-05'}), // 3 of 5 steps
    tk('a1', {title:'Cerrar actas', date:'2026-11-12', focus:'2026-11-05T08:30:00.000Z'}), // in Ahora: En curso, not Próximos pasos
    tk('w1', {title:'Firma del contrato', status:'waiting', waitingFor:'Ramiro', date:'2026-11-06'}),
    tk('w2', {title:'Presupuesto', status:'waiting', waitingFor:'Marta'}),
    tk('n1', {title:'Workshop de finanzas', date:'2026-11-09', deadline:'2026-12-03'}),
    tk('n2', {title:'Go-live', date:'2026-11-19'}), // today + 14: in
    tk('n3', {title:'Hypercare', date:'2026-11-20'}), // today + 15: out
    tk('u1', {title:'Revisar SOW'}), tk('u2', {title:'Matriz RACI'}), tk('u3', {title:'Definir alcance', priority:'high'}),
    tk('u4', {title:'Plan de formación'}), tk('u5', {title:'Riesgos'}), tk('u6', {title:'Sexta sin fecha'}),
    tk('f1', {title:'Revisar facturas', projectId:'p2', date:'2026-11-05', priority:'mid'}),
    done('f0', 'Cierre de septiembre', '2026-10-20', {projectId:'p3'}), // the empty project's only task: long ago
    tk('ar', {title:'Tarea archivada', projectId:'p4', date:'2026-11-05'}), // an archived project stays out of the space text
    tk('s1', {title:'Renovar pasaporte', projectId:null, date:'2026-11-10'}),
    tk('x1', {title:'Comprar pintura', spaceId:'personal', projectId:'p9', date:'2026-11-05'}) ],
  voiceNotes:[{id:'v1', taskId:'t1', text:'Nota de voz que no sale', created:T0}], attachments:[], projectNotes:[{id:'pn1', projectId:'p1', title:'Acuerdos', body:'No sale', pinned:false, created:T0, modified:T0}],
  subtasks:[st('s1a',1,true), st('s1b',2,true), st('s1c',3,true), st('s1d',4,false), st('s1e',5,false)],
  settings:{tipsSeen:true, activeSpace:'trabajo'} });

const OCA_WEEK = `Estado OCA, semana del 2 al 5 de noviembre de 2026

Hecho
- Kick-off con el cliente
- Revisión de diseño

En curso
- Preparar SteerCo, entrega viernes 6 (prioritaria)
- Llamar a Luis
- Plan de pruebas (3 de 5 pasos)
- Cerrar actas

Por confirmar
- Firma del contrato, esperando a Ramiro, revisar el viernes 6
- Presupuesto, esperando a Marta

Próximos pasos
- Workshop de finanzas, lunes 9, entrega jueves 3 de diciembre
- Go-live, jueves 19
- Definir alcance (prioritaria)
- Revisar SOW
- Matriz RACI
- Plan de formación
- Riesgos`;
const OCA_7D = OCA_WEEK.replace('Estado OCA, semana del 2 al 5 de noviembre de 2026', 'Estado OCA, del 30 de octubre al 5 de noviembre de 2026').replace('Hecho\n', 'Hecho\n- Informe de octubre\n');
const OCA_BODY = OCA_WEEK.split('\n').slice(2).join('\n');
const SPACE_WEEK = `Estado de la semana del 2 al 5 de noviembre de 2026

OCA

${OCA_BODY}


FLC

En curso
- Revisar facturas


Sin proyecto

Próximos pasos
- Renovar pasaporte, martes 10`;

async function open(browser, o){
  const vp = o.desk ? {viewport:{width:1280,height:800}, deviceScaleFactor:1} : {viewport:{width:390,height:844}, deviceScaleFactor:2, isMobile:true, hasTouch:true};
  const ctx = await browser.newContext(Object.assign(vp, {colorScheme:o.theme||'light'})); const page = await ctx.newPage();
  await page.clock.install({time:NOW});
  page.on('pageerror', e=>errors.push(o.tag+' pageerror: '+e.message)); page.on('console', m=>{ if(m.type()==='error') errors.push(o.tag+' console: '+m.text()); });
  // The clipboard and the share sheet, watched: share present (o.share) or missing
  await page.addInitScript(share=>{ window.__copied=[]; window.__shared=[];
    try{ Object.defineProperty(navigator, 'clipboard', {configurable:true, value:{writeText:t=>{ window.__copied.push(t); return Promise.resolve(); }}}); }catch(e){}
    try{ Object.defineProperty(navigator, 'share', {configurable:true, value:share?(d=>{ window.__shared.push(d); return Promise.resolve(); }):undefined}); }catch(e){} }, !!o.share);
  await page.addInitScript(s=>{ if(!localStorage.getItem('tareas-v1')) localStorage.setItem('tareas-v1', s); }, JSON.stringify(SEED()));
  await page.goto(URL0); await until(page, ()=>typeof DB!=='undefined'&&!!document.querySelector(UI.wide?'#desk .main':'.screen.root')); return {ctx, page};
}
const ev = (page, fn, arg) => page.evaluate(fn, arg);
const until = async (page, fn, arg, ms=8000)=>{ const t0=Date.now(); for(;;){ let v=false; try{ v=await page.evaluate(fn, arg); }catch(e){} if(v) return true; if(Date.now()-t0>ms) return false; await sleep(80); } };
const calm = page => until(page, ()=>!app.classList.contains('navigating') && !HELD.size && !document.querySelector('.row.leaving, .flip, .enter') && !touchDrag);
// The sheet is up and still (its transition over), and the menu gone
const sheetUp = page => until(page, ()=>{ const s=document.querySelector('#sheet'); return s.classList.contains('on') && !!s.querySelector('.sttext') && !document.querySelector('#pmenu.on') && !s.getAnimations().some(a=>a.playState==='running'); });
const sheetDown = page => until(page, ()=>!document.querySelector('#sheet').classList.contains('on'));
const menuItem = (page, label) => page.locator('#pmenu .pm-it').filter({has: page.locator('.pm-l', {hasText: new RegExp('^'+label+'$')})}).first();
const menuLabels = page => ev(page, ()=>[...document.querySelectorAll('#pmenu .pm-it .pm-l')].map(e=>e.textContent).join());
const menuOpen = page => until(page, ()=>!!document.querySelector('#pmenu .pm-it'));
const sheetInfo = page => ev(page, ()=>{ const s=document.querySelector('#sheet'); return {h2:(s.querySelector('h2')||{}).textContent, text:s.querySelector('.sttext').value,
  chips:[...s.querySelectorAll('[data-per]')].map(b=>b.textContent+(b.classList.contains('on')?'*':'')).join(), btns:[...s.querySelectorAll('[data-x]')].map(b=>b.textContent).join(), head:!!s.querySelector('.shead [data-x=share]')}; });
const logged = page => ev(page, ()=>LOG.filter(l=>l.m==='Estado compartido').length);
const toastText = page => ev(page, ()=>document.querySelector('#toast').classList.contains('on')?document.querySelector('#toastText').textContent:'');
const clean = t => !/[·—→]/.test(t);

/* ======================= 1. The text ======================= */
async function texts(browser){
  const {ctx, page} = await open(browser, {tag:'T'}); let x;
  x = await ev(page, ()=>statusText('p1','week')); check('t_project_week', x===OCA_WEEK, x);
  x = await ev(page, ()=>statusText('p1','7d')); check('t_project_7d', x===OCA_7D, x);
  x = await ev(page, ()=>spaceStatusText('week')); check('t_space_week', x===SPACE_WEEK, x);
  x = await ev(page, ()=>spaceStatusText('7d')); check('t_space_7d', x.startsWith('Estado del 30 de octubre al 5 de noviembre de 2026\n\nOCA\n\nHecho\n- Informe de octubre\n') && !/Vacío|Archivado|Casa|pintura/.test(x), x);
  x = await ev(page, ()=>statusText('p3','week')); check('t_empty_project', x==='Estado Vacío, semana del 2 al 5 de noviembre de 2026\n\nNada que contar en este periodo.', x);
  x = await ev(page, ()=>[statusText('p1','week'), statusText('p1','7d'), spaceStatusText('week'), spaceStatusText('7d')].join('\n'));
  check('t_clean', clean(x) && !/Notas que no salen|Nota de voz que no sale|No sale|\*\*|Sexta sin fecha|Hypercare|Informe de septiembre/.test(x), x.match(/[·—→]/g));
  // On a Monday the week is one day
  await page.clock.setFixedTime(new Date(2026, 10, 2, 10, 0, 0));
  x = await ev(page, ()=>[statusText('p1','week').split('\n')[0], spaceStatusText('week').split('\n')[0]]);
  check('t_monday', x[0]==='Estado OCA, lunes 2 de noviembre de 2026' && x[1]==='Estado del lunes 2 de noviembre de 2026', x);
  await ctx.close();
}

/* ======================= 2. iPhone ======================= */
async function iphone(browser, theme){
  const tag='I'+(theme==='dark'?'d':''); const {ctx, page} = await open(browser, {tag, theme}); let x;
  await calm(page);
  // The Tareas «...»: Compartir estado de la semana
  await page.tap('.screen.root[data-root=tareas] .vopts'); await menuOpen(page);
  x = await menuLabels(page); check(tag+'_tareas_menu', /Compartir estado de la semana$/.test(x), x);
  await menuItem(page, 'Compartir estado de la semana').tap(); await sheetUp(page);
  x = await sheetInfo(page);
  check(tag+'_space_sheet', x.h2==='Estado de la semana' && x.text===SPACE_WEEK && x.chips==='Esta semana*,Últimos 7 días' && x.head && x.btns==='Copiar,Compartir', x);
  await shot(page, 'm-space-'+(theme||'light'));
  // Compartir without navigator.share: copies, with the log line
  await page.tap('#sheet [data-x=share]'); await until(page, ()=>window.__copied.length===1);
  x = {copied:await ev(page, ()=>window.__copied[0]), toast:await toastText(page), log:await logged(page)};
  check(tag+'_share_fallback', x.copied===SPACE_WEEK && x.toast==='Texto copiado. Pégalo en Teams, el correo o Claude.' && x.log===1, x);
  await ev(page, ()=>closeSheet()); await sheetDown(page); await calm(page);
  // The project's screen: its «...» has Compartir estado
  await page.tap('.tabbar [data-tab=proyectos]'); await calm(page);
  await page.tap('.screen.root [data-open-project=p1]'); await calm(page);
  await ev(page, ()=>UI.stack[UI.stack.length-1].el.querySelector('.vopts').setAttribute('data-test','pv')); await page.tap('[data-test=pv]');
  await menuOpen(page); x = await menuLabels(page); check(tag+'_project_menu', /Compartir estado$/.test(x) && !/de la semana/.test(x), x);
  await menuItem(page, 'Compartir estado').tap(); await sheetUp(page);
  x = await sheetInfo(page); check(tag+'_project_sheet', x.h2==='Estado de OCA' && x.text===OCA_WEEK, x);
  await shot(page, 'm-project-'+(theme||'light'));
  // Últimos 7 días redoes the text
  await page.tap('#sheet [data-per="7d"]');
  x = await sheetInfo(page); check(tag+'_7d', x.text===OCA_7D && x.chips==='Esta semana,Últimos 7 días*', x);
  if(theme!=='dark'){
    // The text is editable: what is copied is what the sheet shows
    await page.fill('#sheet .sttext', 'Texto tocado a mano');
    await page.tap('#sheet [data-x=copy]'); await until(page, ()=>window.__copied.length===2);
    x = {copied:await ev(page, ()=>window.__copied[1]), log:await logged(page)}; check(tag+'_copy_edited', x.copied==='Texto tocado a mano' && x.log===2, x);
    await ev(page, ()=>closeSheet()); await sheetDown(page); await calm(page);
    // The project's long press menu (Proyectos tab) has it too
    await ev(page, ()=>{ while(UI.stack.length) pop(); }); await calm(page);
    await until(page, ()=>!UI.stack.length);
    await ev(page, ()=>projectMenu('p2', {})); await menuOpen(page); x = await menuLabels(page);
    check(tag+'_project_long_press', /Compartir estado/.test(x), x);
    await menuItem(page, 'Compartir estado').tap(); await sheetUp(page);
    x = await sheetInfo(page); check(tag+'_flc_sheet', x.h2==='Estado de FLC' && x.text==='Estado FLC, semana del 2 al 5 de noviembre de 2026\n\nEn curso\n- Revisar facturas', x);
  }
  await ctx.close();
}

/* ======================= 3. Desktop ======================= */
async function desktop(browser, theme){
  const tag='D'+(theme==='dark'?'d':''); const {ctx, page} = await open(browser, {tag, theme, desk:true, share:true}); let x;
  await calm(page);
  // The column's «...» in Hoy: Compartir estado de la semana…
  await page.click('#desk .main [data-act=viewMenu]'); await menuOpen(page);
  x = await menuLabels(page); check(tag+'_view_menu', /Compartir estado de la semana…/.test(x), x);
  await menuItem(page, 'Compartir estado de la semana…').click(); await sheetUp(page);
  x = await sheetInfo(page); check(tag+'_space_dialog', x.h2==='Estado de la semana' && x.text===SPACE_WEEK && !x.head && x.btns==='Cerrar,Copiar,Compartir', x);
  x = await ev(page, ()=>{ const b=document.querySelector('#sheet').getBoundingClientRect(); return {cx:Math.round(b.left+b.width/2), w:Math.round(b.width)}; });
  check(tag+'_centred', Math.abs(x.cx-640)<=2 && x.w>=600, x);
  await shot(page, 'd-space-'+(theme||'light'));
  // Compartir with navigator.share: the share sheet gets the text
  await page.click('#sheet [data-x=share]'); await until(page, ()=>window.__shared.length===1);
  x = await ev(page, ()=>window.__shared[0]); check(tag+'_share', x && x.title==='Estado de la semana' && x.text===SPACE_WEEK && await logged(page)===1, x);
  await page.click('#sheet [data-x=close]'); await sheetDown(page);
  // The sidebar project's right click
  await page.click('#desk .side [data-view="project:p1"]', {button:'right'}); await menuOpen(page);
  x = await menuLabels(page); check(tag+'_side_menu', /Compartir estado…/.test(x), x);
  await menuItem(page, 'Compartir estado…').click(); await sheetUp(page);
  x = await sheetInfo(page); check(tag+'_project_dialog', x.h2==='Estado de OCA' && x.text===OCA_WEEK, x);
  await page.click('#sheet [data-per="7d"]'); x = await sheetInfo(page); check(tag+'_project_7d', x.text===OCA_7D, x);
  await shot(page, 'd-project-'+(theme||'light'));
  await page.keyboard.press('Escape'); await sheetDown(page);
  // The project's column «...»: Compartir estado…
  await page.click('#desk .side [data-view="project:p1"]'); await calm(page);
  await page.click('#desk .main [data-act=viewMenu]'); await menuOpen(page);
  x = await menuLabels(page); check(tag+'_project_view_menu', /Compartir estado…/.test(x) && !/de la semana/.test(x), x);
  await page.keyboard.press('Escape');
  await ctx.close();
}

(async()=>{
  await new Promise(res=>srv.listen(PORT, res));
  const browser = await chromium.launch();
  try{
    await texts(browser);
    await iphone(browser); await iphone(browser, 'dark');
    await desktop(browser); await desktop(browser, 'dark');
  }catch(e){ errors.push('exception: '+(e&&e.stack||e)); }
  await browser.close(); srv.close();
  console.log(JSON.stringify({r, fails, errors}, null, 1));
  process.exit(fails.length||errors.length?1:0);
})();
