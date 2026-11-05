require('./lib/out.js'); // outputs (screenshots, downloads) go to tests/out
// Decision 65a: the view «Por persona», approved by the owner on 5 November. Port 8800. Screenshots in tests/out/PP.
//  1. Data rules (in the page): the people of the active space only, only with open tasks (pending or waiting; a waitingFor left on a
//     pending task does not count), the busiest first and then by name, names matched without accents or case, the contact's spelling;
//     the two groups (Le toca a, Esperando a) ordered by date (no date last) then priority; a task in both groups only in Esperando a.
//  2. iPhone, clock at Wednesday 4 November 2026 9:00 (light and dark): Personas in the Proyectos tab under Sin proyecto, the pushed screen
//     (title, Recordar todo with how it goes, the two groups and their rows), back with Atrás; completing from the screen updates the counts
//     and, with the last task, the empty state «Nada pendiente con Luis» and the person leaves the list; Recordar todo by WhatsApp (phone),
//     mail (email) and the share sheet (no contact), one message with every task, to the person of the view even when the tasks share
//     another person; a space change lists only that space's people; the long press selection works on the screen.
//  3. Desktop (light and dark): the sidebar section under Proyectos with icons and counts, the view in the column (name, phone or mail
//     under it, Recordar todo, the column header, the two groups with the desktop rows), the person highlighted; the inspector, the
//     selected row and J, Comando clic selection; completing the last task: the empty state and the sidebar row gone; a contact renamed in
//     Ajustes keeps the view; the search filters the groups.
const { chromium } = require('playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = path.resolve(__dirname, '..'), PORT = 8800, URL0 = 'http://localhost:'+PORT+'/';
const OUT = path.join(__dirname, 'out', 'PP'); fs.mkdirSync(OUT, {recursive:true});
const TYPES = {'.html':'text/html','.css':'text/css','.js':'application/javascript','.webmanifest':'application/manifest+json','.png':'image/png','.json':'application/json'};
const srv = http.createServer((req,res)=>{ let p = decodeURIComponent(req.url.split('?')[0]); if(p==='/') p='/index.html';
  if(p==='/config.js'){ res.writeHead(200,{'Content-Type':'application/javascript'}); res.end('window.TAREAS_CONFIG = {"url":null,"anonKey":null};\n'); return; }
  const f=path.join(ROOT,p); if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){ res.writeHead(404,{'Content-Type':'text/html'}); res.end('<h1>404</h1>'); return; }
  res.writeHead(200,{'Content-Type':TYPES[path.extname(f)]||'application/octet-stream'}); res.end(fs.readFileSync(f)); });
const r={}, fails=[], errors=[]; const check=(name, ok, info)=>{ r[name]=ok?true:(info===undefined?false:info); if(!ok) fails.push(name); };
const sleep=ms=>new Promise(res=>setTimeout(res,ms));
const shot=(page, name)=>page.screenshot({path:path.join(OUT, name+'.png')});

const NOW = new Date(2026, 10, 4, 9, 0, 0); // Wednesday 4 November 2026, 9:00 local, before the evening rule
const T0 = '2026-11-01T08:00:00.000Z';
const cr = n => new Date(Date.UTC(2026, 10, 1, 8, n)).toISOString(); // creation order
const tk = (id, n, o) => Object.assign({id, title:id.toUpperCase(), spaceId:'trabajo', projectId:null, date:null, reminder:null, priority:'none', status:'pending', notes:'', carried:false, created:cr(n), modified:cr(n), completed:null}, o);
const SEED = () => ({ spaces:[{id:'trabajo',name:'Trabajo',order:0,created:T0},{id:'personal',name:'Personal',order:1,created:T0}],
  projects:[{id:'p1', spaceId:'trabajo', name:'FLC', color:'#007AFF', order:0, archived:false, created:T0, modified:T0}],
  tasks:[
    tk('t13', 1, {title:'Acta del comité', responsible:'Susana Pérez', date:'2026-11-04'}),
    tk('t1', 2, {title:'Preparar SteerCo', responsible:'Susana Pérez', date:'2026-11-04', priority:'high', projectId:'p1'}),
    tk('t2', 3, {title:'Revisar SOW', responsible:'susana perez', date:'2026-11-10'}),                 // case and accents differ
    tk('t3', 4, {title:'Plan de pruebas', responsible:'Susana Pérez', priority:'high'}),              // no date: last
    tk('t4', 5, {title:'Firma del anexo', status:'waiting', waitingFor:'SUSANA PÉREZ', date:'2026-11-06'}),
    tk('t5', 6, {title:'Datos de cierre', status:'waiting', waitingFor:'Susana Pérez', responsible:'Susana Pérez'}), // in both: only Esperando a
    tk('t6', 7, {title:'Hecha ya', responsible:'Susana Pérez', status:'done', completed:'2026-11-03T10:00:00.000Z'}),
    tk('t7', 8, {title:'Llamar al banco', responsible:'angel martin', date:'2026-11-04'}),            // the contact's spelling
    tk('t8', 9, {title:'Presupuesto', status:'waiting', waitingFor:'Raúl'}),
    tk('t9', 10, {title:'Contrato marco', status:'waiting', waitingFor:'raul', responsible:'Ángel Martín'}),
    tk('t10', 11, {title:'Sin esperar', waitingFor:'Pepe'}),                                          // pending: Pepe is not listed
    tk('t11', 12, {title:'Cumpleaños', spaceId:'personal', responsible:'Susana Pérez'}),
    tk('t12', 13, {title:'Informe', responsible:'Raúl', date:'2026-11-05'}),
    tk('t14', 14, {title:'Factura de octubre', status:'waiting', waitingFor:'Luis', responsible:'Ángel Martín'}) ],
  voiceNotes:[], attachments:[], subtasks:[], projectNotes:[],
  contacts:[ {id:'c1', name:'Susana Pérez', email:null, phone:'612 111 222', created:T0, modified:T0}, {id:'c2', name:'Ángel Martín', email:'angel@example.com', phone:null, created:T0, modified:T0},
    {id:'c3', name:'Marta', email:null, phone:'600 000 000', created:T0, modified:T0} ],
  settings:{tipsSeen:true} });
// window.open, the mailto link and the share sheet, caught instead of leaving the page
function stubs(){ window.__sent=[]; window.open=(u)=>{ window.__sent.push({via:'open', u}); return null; };
  document.addEventListener('click', e=>{ const a=e.target.closest&&e.target.closest('a[href^="mailto:"]'); if(a){ e.preventDefault(); window.__sent.push({via:'mailto', u:a.getAttribute('href')}); } }, true);
  Object.defineProperty(navigator, 'share', {configurable:true, value:o=>{ window.__sent.push({via:'share', text:o.text}); return Promise.resolve(); }}); }
async function open(browser, o){
  const vp = o.desk ? {viewport:{width:1280,height:800}, deviceScaleFactor:1} : {viewport:{width:390,height:844}, deviceScaleFactor:2, isMobile:true, hasTouch:true};
  const ctx = await browser.newContext(Object.assign(vp, {colorScheme:o.theme||'light'})); const page = await ctx.newPage();
  await page.clock.install({time:NOW});
  page.on('pageerror', e=>errors.push(o.tag+' pageerror: '+e.message)); page.on('console', m=>{ if(m.type()==='error') errors.push(o.tag+' console: '+m.text()); });
  await page.addInitScript(stubs);
  await page.addInitScript(s=>{ if(!localStorage.getItem('tareas-v1')) localStorage.setItem('tareas-v1', s); }, JSON.stringify(o.seed||SEED()));
  await page.goto(URL0); await until(page, ()=>typeof DB!=='undefined'&&!!document.querySelector(UI.wide?'#desk .main':'.screen.root')); return {ctx, page};
}
const ev = (page, fn, arg) => page.evaluate(fn, arg);
const until = async (page, fn, arg, ms=8000)=>{ const t0=Date.now(); for(;;){ let v=false; try{ v=await page.evaluate(fn, arg); }catch(e){} if(v) return true; if(Date.now()-t0>ms) return false; await sleep(80); } };
// The held rows leave 1.5 s after the last mark (R1): the clock is installed, so it is run forward
const calm = async page => { for(let i=0;i<40;i++){ const busy=await ev(page, ()=>app.classList.contains('navigating')||HELD.size>0||!!document.querySelector('.row.leaving, .flip, .enter, .pushed-screen.pushed')||touchDrag||document.getAnimations().some(a=>a.playState==='running'&&!(a.effect&&a.effect.getComputedTiming().iterations===Infinity))); if(!busy) return true; await page.clock.runFor(200); await sleep(30); } return false; };
const sheetUp = page => until(page, ()=>{ const s=document.querySelector('#sheet'); return s.classList.contains('on') && !sheetFresh(); });
const sheetGone = page => until(page, ()=>!document.querySelector('#sheet').classList.contains('on'));
const sent = page => ev(page, ()=>window.__sent.splice(0));
const hideToast = page => ev(page, ()=>{ document.querySelector('#toast').classList.remove('on'); undoFn=null; });
const settle = async page => { for(let i=0;i<6;i++){ await page.clock.runFor(150); await sleep(40); } await calm(page); }; // the sheet's own timers (sheetFresh, slides)
const groupRows = (page, scope) => ev(page, sc=>{ const g=k=>{ const h=document.querySelector(sc+' [data-pgroup='+k+']'); return h?[...h.parentElement.querySelectorAll('.row[data-id]')].map(r=>r.dataset.id).join():null; };
  const t=k=>{ const h=document.querySelector(sc+' [data-pgroup='+k+'] .gl'); return h?h.textContent:null; }; return {mine:g('mine'), wait:g('wait'), tm:t('mine'), tw:t('wait')}; }, scope);
const peopleCells = page => ev(page, ()=>[...document.querySelectorAll('.screen.root[data-root=proyectos] .group.people .cell')].map(c=>c.querySelector('.lbl').textContent+':'+c.querySelector('.count').textContent).join());
const sidePeople = page => ev(page, ()=>[...document.querySelectorAll('#desk .side .it.iperson')].map(b=>b.querySelector('span').textContent+':'+b.querySelector('.n').textContent+(b.classList.contains('on')?'*':'')).join());
const top = '.pushed-screen.person:not(.pushed)';

/* ======================= 1. Data rules ======================= */
async function rules(browser){
  const {ctx, page} = await open(browser, {tag:'R'}); let x;
  x = await ev(page, ()=>peopleList().map(p=>p.name+':'+p.n).join());
  check('list', x==='Susana Pérez:6,Ángel Martín:3,Raúl:3,Luis:1', x); // Pepe (pending task) and Marta (no task) are not listed; Ángel before Raúl at 3
  x = await ev(page, ()=>{ const g=personGroups('susana PEREZ'); return {mine:g.mine.map(x=>x.id).join(), wait:g.wait.map(x=>x.id).join()}; });
  check('groups_susana', x.mine==='t1,t13,t2,t3' && x.wait==='t4,t5', x); // by date, then priority; t5 (in both) only waits; t6 done
  x = await ev(page, ()=>{ const g=personGroups('Raul'); return {mine:g.mine.map(x=>x.id).join(), wait:g.wait.map(x=>x.id).join(), lbl:personLabel('raul'), a:personLabel('ANGEL MARTIN')}; });
  check('groups_raul', x.mine==='t12' && x.wait==='t8,t9' && x.lbl==='Raúl' && x.a==='Ángel Martín', x);
  x = await ev(page, ()=>{ DB.settings.activeSpace='personal'; const l=peopleList().map(p=>p.name+':'+p.n).join(); DB.settings.activeSpace='trabajo'; return l; });
  check('list_space', x==='Susana Pérez:1', x);
  await ctx.close(); }

/* ======================= 2. iPhone ======================= */
async function iphone(browser, theme){
  const {ctx, page} = await open(browser, {tag:'M'+theme, theme}); let x; const T=theme==='dark'?'-dark':'';
  await calm(page);
  await ev(page, ()=>switchTab('proyectos')); await calm(page);
  x = await ev(page, ()=>{ const s=document.querySelector('.screen.root[data-root=proyectos] .scroll'); const tt=[...s.querySelectorAll('.group-title')].map(e=>e.textContent), gs=[...s.children];
    const none=s.querySelector('[data-open-project=none]'), pg=s.querySelector('.group.people'); return {tt, after:!!(none&&pg&&(none.compareDocumentPosition(pg)&Node.DOCUMENT_POSITION_FOLLOWING)), icon:!!(pg&&pg.querySelector('.picon.pperson svg'))}; });
  check('i_section'+T, x.tt.includes('Personas') && x.after && x.icon, x);
  check('i_cells'+T, await peopleCells(page)==='Susana Pérez:6,Ángel Martín:3,Raúl:3,Luis:1', await peopleCells(page));
  await shot(page, 'i1-proyectos'+T);
  // --- The pushed screen
  await page.tap('[data-open-person="Susana Pérez"]'); await calm(page);
  x = await ev(page, sel=>{ const s=document.querySelector(sel); return s&&{title:s.querySelector('.nav-title').textContent, back:!!s.querySelector('[data-act=back]'), rem:(s.querySelector('[data-act=remindAll]')||{}).textContent, via:(s.querySelector('.premind+.footnote')||{}).textContent}; }, top);
  check('i_screen'+T, x && x.title==='Susana Pérez' && x.back && x.rem==='Recordar todo6 tareas' && x.via==='Por WhatsApp a 612 111 222', x);
  x = await groupRows(page, top);
  check('i_groups'+T, x.mine==='t1,t13,t2,t3' && x.wait==='t4,t5' && x.tm==='Le toca a Susana Pérez4' && x.tw==='Esperando a Susana Pérez2', x);
  x = await ev(page, sel=>{ const r=document.querySelector(sel+' .row[data-id=t1]'); const w=document.querySelector(sel+' .row[data-id=t4]'); return {tag:(r.querySelector('.tag')||{}).textContent, bg:!!r.querySelector('.row-bg'), check:!!r.querySelector('[data-act=check]'), resp:!!r.querySelector('.resp'), wait:!!w.querySelector('.waitfor'), date:w.querySelector('.row-meta').textContent}; }, top);
  check('i_rows'+T, x.tag==='FLC' && x.bg && x.check && !x.resp && !x.wait && x.date==='Viernes', x); // the usual rows, with their gestures; Susana is not repeated on them
  await shot(page, 'i2-susana'+T);
  if(theme==='dark'){ await ctx.close(); return; }
  // --- Recordar todo: WhatsApp, one message with all six
  await page.tap(top+' [data-act=remindAll]'); await sheetUp(page);
  x = await ev(page, ()=>({to:(document.querySelector('#sheet .rto')||{}).textContent, msg:document.querySelector('#sheet [data-role=rmsg]').value, via:document.querySelector('#sheet .rvia').textContent}));
  const msgS = 'Hola Susana, te recuerdo estas tareas:\n\n• Preparar SteerCo (para hoy)\n• Acta del comité (para hoy)\n• Revisar SOW (para el martes 10)\n• Plan de pruebas\n• Firma del anexo\n• Datos de cierre\n\nGracias.';
  check('i_remind_text', x.to==='Para Susana Pérez' && x.msg===msgS && x.via==='Por WhatsApp a 612 111 222', x);
  await shot(page, 'i3-remind');
  // --- Decision 73: untick two tasks, the message follows; Seleccionar todo brings them back
  x = await ev(page, ()=>{ const b=[...document.querySelectorAll('#sheet [data-rpick]')]; return {n:b.length, on:b.filter(e=>e.classList.contains('on')).length, h:document.querySelector('#sheet .rpickh span').textContent}; });
  check('i_pick_all', x.n===6 && x.on===6 && x.h==='6 de 6 tareas', x);
  await page.tap('#sheet [data-rpick]:nth-of-type(1)'); await page.tap('#sheet .rpi:nth-of-type(2)');
  x = await ev(page, ()=>({h:document.querySelector('#sheet .rpickh span').textContent, all:document.querySelector('#sheet [data-rall]').textContent, msg:document.querySelector('#sheet [data-role=rmsg]').value}));
  check('i_pick_two_off', x.h==='4 de 6 tareas' && x.all==='Seleccionar todo' && x.msg.startsWith('Hola Susana, te recuerdo estas tareas:\n\n• ') && x.msg.split('• ').length===5 && x.msg.endsWith('\n\nGracias.'), x);
  await page.tap('#sheet [data-rall]');
  x = await ev(page, ()=>({h:document.querySelector('#sheet .rpickh span').textContent, msg:document.querySelector('#sheet [data-role=rmsg]').value}));
  check('i_pick_back', x.h==='6 de 6 tareas' && x.msg===msgS, x);
  await shot(page, 'i3-remind-pick');
  await page.tap('#sheet [data-x=ok]'); await sheetGone(page);
  x = await sent(page); check('i_remind_wa', x.length===1 && x[0].via==='open' && x[0].u==='https://wa.me/34612111222?text='+encodeURIComponent(msgS), x);
  // --- Completing from the screen: the counts follow
  await page.tap(top+' .row[data-id=t1] [data-act=check]'); await calm(page); await hideToast(page);
  x = await groupRows(page, top);
  check('i_complete', x.mine==='t13,t2,t3' && await ev(page, sel=>document.querySelector(sel+' [data-act=remindAll]').textContent==='Recordar todo5 tareas', top), x);
  await page.tap(top+' [data-act=back]'); await calm(page);
  check('i_back', await ev(page, ()=>!UI.stack.length && UI.tab==='proyectos') && await peopleCells(page)==='Susana Pérez:5,Ángel Martín:3,Raúl:3,Luis:1', await peopleCells(page));
  // --- Luis: the tasks share Ángel too, the message still goes to Luis; no contact: the share sheet
  await page.tap('[data-open-person="Luis"]'); await calm(page);
  check('i_luis_via', await ev(page, sel=>document.querySelector(sel+' .premind+.footnote').textContent==='Con la hoja de compartir', top));
  await page.tap(top+' [data-act=remindAll]'); await sheetUp(page);
  x = await ev(page, ()=>({to:(document.querySelector('#sheet .rto')||{}).textContent, who:document.querySelectorAll('#sheet [data-who]').length, msg:document.querySelector('#sheet [data-role=rmsg]').value}));
  check('i_luis_sheet', x.to==='Para Luis' && !x.who && x.msg==='Hola Luis, te recuerdo esta tarea:\n\n• Factura de octubre\n\nGracias.', x);
  await page.tap('#sheet [data-x=ok]'); await sheetGone(page);
  x = await sent(page); check('i_luis_share', x.length===1 && x[0].via==='share' && x[0].text==='Hola Luis, te recuerdo esta tarea:\n\n• Factura de octubre\n\nGracias.', x);
  // The last task done: the empty state, no Recordar todo, and Luis leaves the list
  await page.tap(top+' .row[data-id=t14] [data-act=check]'); await calm(page); await hideToast(page);
  x = await ev(page, sel=>{ const s=document.querySelector(sel); return {b:(s.querySelector('.empty b')||{}).textContent, rem:!!s.querySelector('[data-act=remindAll]'), rows:s.querySelectorAll('.row').length}; }, top);
  check('i_empty', x.b==='Nada pendiente con Luis' && !x.rem && !x.rows, x);
  await shot(page, 'i4-empty');
  await page.tap(top+' [data-act=back]'); await calm(page);
  check('i_left', await peopleCells(page)==='Susana Pérez:5,Raúl:3,Ángel Martín:2', await peopleCells(page));
  // --- Ángel: mail with his email
  await page.tap('[data-open-person="Ángel Martín"]'); await calm(page);
  await page.tap(top+' [data-act=remindAll]'); await sheetUp(page);
  x = await ev(page, ()=>({msg:document.querySelector('#sheet [data-role=rmsg]').value, via:document.querySelector('#sheet .rvia').textContent}));
  const msgA = 'Hola Ángel, te recuerdo estas tareas:\n\n• Llamar al banco (para hoy)\n• Contrato marco\n\nGracias.';
  check('i_angel_text', x.msg===msgA && x.via==='Por correo a angel@example.com', x);
  await page.tap('#sheet [data-x=ok]'); await sheetGone(page);
  x = await sent(page); check('i_angel_mail', x.length===1 && x[0].via==='mailto' && x[0].u==='mailto:angel@example.com?subject='+encodeURIComponent('Recordatorio: 2 tareas')+'&body='+encodeURIComponent(msgA), x);
  // --- The selection on the screen (long press menu's Seleccionar): its rows, then OK
  await ev(page, ()=>startSelect('t7')); await calm(page);
  x = await ev(page, sel=>({scope:UI.select.scope, title:(document.querySelector(sel+' #selTitle')||{}).textContent, rows:document.querySelectorAll(sel+' .row[data-id]').length}), top);
  check('i_select', x.scope==='project' && x.title==='1 seleccionada' && x.rows===2, x);
  await ev(page, ()=>endSelect()); await calm(page);
  await page.tap(top+' [data-act=back]'); await calm(page);
  // --- Another space: only its people
  await ev(page, ()=>{ DB.settings.activeSpace='personal'; save(); render(); }); await calm(page);
  check('i_space', await peopleCells(page)==='Susana Pérez:1', await peopleCells(page));
  await ev(page, ()=>{ DB.settings.activeSpace='trabajo'; save(); render(); }); await calm(page);
  // --- The person screen survives a widen and a narrow (applyWide)
  await page.tap('[data-open-person="Raúl"]'); await calm(page);
  await page.setViewportSize({width:1280, height:800}); await until(page, ()=>UI.wide && UI.deskView==='person:Raúl');
  await page.setViewportSize({width:390, height:844}); await until(page, ()=>!UI.wide && UI.stack.length===1 && UI.stack[0].kind==='person' && UI.stack[0].id==='Raúl'); await calm(page);
  check('i_wide_back', await ev(page, ()=>UI.tab==='proyectos' && UI.stack[0].kind==='person' && !!document.querySelector('.pushed-screen.person .nav-title') && document.querySelector('.pushed-screen.person .nav-title').textContent==='Raúl'));
  await ctx.close(); }

/* ======================= 3. Desktop ======================= */
async function desktop(browser, theme){
  const {ctx, page} = await open(browser, {tag:'D'+theme, desk:true, theme}); let x; const T=theme==='dark'?'-dark':'';
  await ev(page, ()=>setDeskView('hoy')); await calm(page);
  x = await ev(page, ()=>{ const side=document.querySelector('#desk .side'), secs=[...side.querySelectorAll('.sec')].map(s=>s.textContent), sec=[...side.querySelectorAll('.sec')].find(s=>s.textContent==='Personas'), np=side.querySelector('[data-act=newProject]');
    return {secs, after:!!(sec&&np&&(np.compareDocumentPosition(sec)&Node.DOCUMENT_POSITION_FOLLOWING)), icon:!!side.querySelector('.it.iperson svg.i-person')}; });
  check('d_section'+T, x.secs.join()==='Proyectos,Personas' && x.after && x.icon, x);
  check('d_side'+T, await sidePeople(page)==='Susana Pérez:6,Ángel Martín:3,Raúl:3,Luis:1', await sidePeople(page));
  await page.click('#desk .side .it.iperson[data-view="person:Susana Pérez"]'); await calm(page);
  x = await ev(page, ()=>({v:UI.deskView, h1:document.querySelector('#desk .main .mhead h1').textContent, sub:(document.querySelector('#desk .main .mhead .psub')||{}).textContent, btn:(document.querySelector('#desk .main .mhead [data-act=remindAll]')||{}).textContent, head:!!document.querySelector('#desk .main .colhead'), per:document.querySelector('#desk .main .row[data-id=t1] .rc-per').textContent+document.querySelector('#desk .main .row[data-id=t4] .rc-per').textContent}));
  check('d_view'+T, x.v==='person:Susana Pérez' && x.h1==='Susana Pérez' && x.sub==='612 111 222' && x.btn==='Recordar todo' && x.head && x.per==='', x); // Susana is not repeated on the rows
  check('d_on'+T, await sidePeople(page)==='Susana Pérez:6*,Ángel Martín:3,Raúl:3,Luis:1', await sidePeople(page));
  x = await groupRows(page, '#desk .main');
  check('d_groups'+T, x.mine==='t1,t13,t2,t3' && x.wait==='t4,t5' && x.tm==='Le toca a Susana Pérez4', x);
  await shot(page, 'd1-susana'+T);
  // The inspector opens on a row, and the selection follows J
  await page.click('#desk .main .row[data-id=t13] .row-title'); await until(page, ()=>UI.deskDetail==='t13' && !!document.querySelector('#desk .pane'));
  await shot(page, 'd2-inspector'+T);
  if(theme==='dark'){ await ctx.close(); return; }
  await page.keyboard.press('j'); await until(page, ()=>UI.dsel.cur==='t2');
  check('d_keys', await ev(page, ()=>UI.dsel.cur==='t2' && !!document.querySelector('#desk .main .row[data-id=t2].cur')));
  await page.keyboard.press('Escape'); await calm(page);
  await page.click('#desk .main .row[data-id=t3] .row-title', {modifiers:['Meta']}); await page.click('#desk .main .row[data-id=t4] .row-title', {modifiers:['Meta']});
  x = await ev(page, ()=>({multi:deskMulti(), n:UI.dsel.ids.size, pane:!!document.querySelector('#desk .pane, #desk .mpane, #desk [data-act=bulkComplete]')}));
  check('d_multi', x.multi && x.n>=2 && x.pane, x);
  await ev(page, ()=>{ UI.dsel.ids.clear(); UI.dsel.mode=false; UI.deskDetail=null; render(); }); await calm(page);
  // Recordar todo from the head: WhatsApp
  await page.click('#desk .main .mhead [data-act=remindAll]'); await sheetUp(page);
  x = await ev(page, ()=>document.querySelector('#sheet [data-role=rmsg]').value.split('\n').length);
  check('d_remind', x===10, x); // intro, blank line, six bullets, blank line, thanks (decision 73)
  await page.click('#sheet [data-x=ok]'); await sheetGone(page);
  x = await sent(page); check('d_remind_wa', x.length===1 && x[0].u.startsWith('https://wa.me/34612111222?text='), x);
  // The search filters the groups
  await page.fill('#desk .main [data-role=search]', 'anexo'); await until(page, ()=>UI.query==='anexo'); await settle(page);
  x = await groupRows(page, '#desk .main'); check('d_search', x.mine===null && x.wait==='t4', x);
  await page.click('#desk .main [data-act=clearSearch]'); await calm(page);
  // A contact renamed in Ajustes: the view follows the new name
  await ev(page, ()=>saveContact(contactRec('c1'), {name:'Susana P.', email:null, phone:'612 111 222'})); await calm(page); await hideToast(page);
  x = await ev(page, ()=>({v:UI.deskView, h1:document.querySelector('#desk .main .mhead h1').textContent, n:document.querySelectorAll('#desk .main .row[data-id]').length}));
  check('d_rename', x.v==='person:Susana P.' && x.h1==='Susana P.' && x.n===6, x);
  // Luis: completing the last task, the empty state and the sidebar row gone
  await page.click('#desk .side .it.iperson[data-view="person:Luis"]'); await calm(page);
  x = await ev(page, ()=>({sub:document.querySelector('#desk .main .mhead .psub'), btn:document.querySelector('#desk .main .mhead [data-act=remindAll]').title}));
  check('d_luis', !x.sub && x.btn==='Con la hoja de compartir', x);
  await page.click('#desk .main .row[data-id=t14] [data-act=check]'); await calm(page); await hideToast(page);
  x = await ev(page, ()=>({b:(document.querySelector('#desk .main .empty b')||{}).textContent, btn:!!document.querySelector('#desk .main .mhead [data-act=remindAll]'), side:!!document.querySelector('#desk .side .it.iperson[data-view="person:Luis"]')}));
  check('d_empty', x.b==='Nada pendiente con Luis' && !x.btn && !x.side, x);
  await shot(page, 'd3-empty');
  // A space where the person has nothing: back to the list. Raúl's view shows the other person of a task (Ángel, its responsible)
  await page.click('#desk .side .it.iperson[data-view="person:Raúl"]'); await calm(page);
  x = await ev(page, ()=>({t9:document.querySelector('#desk .main .row[data-id=t9] .rc-per').textContent, t8:document.querySelector('#desk .main .row[data-id=t8] .rc-per').textContent}));
  check('d_other_person', x.t9==='Ángel Martín' && x.t8==='', x);
  await shot(page, 'd4-raul');
  await ev(page, ()=>spaceMenu(document.querySelector('#desk .side .sp'))); await until(page, ()=>menuOpen()&&!menuFresh());
  await page.locator('#pmenu .pm-it').filter({has: page.locator('.pm-l', {hasText:/^Personal$/})}).first().click(); await calm(page);
  check('d_space', await ev(page, ()=>!UI.deskView.startsWith('person:')) && await sidePeople(page)==='Susana P.:1', {v:await ev(page, ()=>UI.deskView), s:await sidePeople(page)});
  await ctx.close(); }

(async()=>{
  await new Promise(res=>srv.listen(PORT,res)); const browser = await chromium.launch();
  try{ await rules(browser); }catch(e){ fails.push('rules_exception'); errors.push('rules: '+String(e&&e.stack||e)); }
  for(const th of ['light','dark']){ try{ await iphone(browser, th); }catch(e){ fails.push('iphone_exception_'+th); errors.push('iphone '+th+': '+String(e&&e.stack||e)); } }
  for(const th of ['light','dark']){ try{ await desktop(browser, th); }catch(e){ fails.push('desktop_exception_'+th); errors.push('desktop '+th+': '+String(e&&e.stack||e)); } }
  console.log(JSON.stringify({r, fails, errors}, null, 1));
  await browser.close(); srv.close(); process.exit(fails.length||errors.length?1:0);
})();
