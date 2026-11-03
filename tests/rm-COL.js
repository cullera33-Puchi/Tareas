require('./lib/out.js'); // outputs (screenshots, downloads) go to tests/out
// Decision 58 (desktop list at full width and resizable columns), port 10700. Screenshots in tests/out/col.
//  1. The title's room grows with the window (1280 and 1920, inspector closed and open), with no 900 px cap; at 1000 nothing overflows.
//  2. One line: a 200-character title keeps the row height, with «…» and the whole title in its tooltip.
//  3. The header: once per list, above Ahora and the groups; Proyecto and Tarea, and Fecha, Entrega, Recordatorio and Tiempo only when a
//     row of the list uses them; no Proyecto inside a project; none on an empty list, in the calendar, in Ajustes or on the iPhone.
//  4. Each header cell has the left and right edges of the same cell in the rows (list, Ahora, Revisar hoy), inspector closed and open.
//  5. Dragging the Proyecto and Fecha handles changes header and rows equally; limits; double click resets; saved on drop in
//     DB.settings.colWidths and kept across a reload; bad saved values dropped; with the inspector open the pane defaults apply to the
//     columns never resized and the user's widths to the others; the reminder column shows its time once resized.
//  6. Screenshots light and dark at 1600, inspector closed and open.
const { chromium } = require('playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = path.resolve(__dirname, '..'), PORT = 10700, URL0 = 'http://localhost:'+PORT+'/';
const OUT = path.join(__dirname, 'out', 'col'); fs.mkdirSync(OUT, {recursive:true});
const TYPES = {'.html':'text/html','.css':'text/css','.js':'application/javascript','.webmanifest':'application/manifest+json','.png':'image/png'};
const srv = http.createServer((req,res)=>{ let p = decodeURIComponent(req.url.split('?')[0]); if(p==='/') p='/index.html';
  if(p==='/config.js'){ res.writeHead(200,{'Content-Type':'application/javascript'}); res.end('window.TAREAS_CONFIG = {"url":null,"anonKey":null};\n'); return; }
  const f=path.join(ROOT,p); if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){ res.writeHead(404,{'Content-Type':'text/html'}); res.end('<h1>404</h1>'); return; }
  res.writeHead(200,{'Content-Type':TYPES[path.extname(f)]||'application/octet-stream'}); res.end(fs.readFileSync(f)); });
const r={}, fails=[], errors=[]; const check=(name, ok, info)=>{ r[name]=ok?true:(info===undefined?false:info); if(!ok) fails.push(name); };
const sleep=ms=>new Promise(res=>setTimeout(res,ms));
const shot=(page, name)=>page.screenshot({path:path.join(OUT, name+'.png')});

const NOW = new Date(2026, 10, 4, 10, 0, 0); // Wednesday 4 November 2026, 10:00
const T0 = '2026-11-03T08:00:00.000Z';
const C = n => new Date(Date.UTC(2026, 10, 3, 8, n)).toISOString();
const LONG = ('Preparar el comité de seguimiento con el cliente y revisar el presupuesto, el plan de pruebas, los riesgos abiertos, '+
  'las dependencias del equipo de sistemas y el calendario del go-live antes de enviar el acta a todos los participantes del').slice(0,200);
const tk = (id, o) => Object.assign({id, title:id, spaceId:'trabajo', projectId:'p1', date:'2026-11-04', reminder:null, priority:'none', status:'pending', notes:'', carried:false, created:T0, modified:T0, completed:null}, o);
const SEED = () => ({ spaces:[{id:'trabajo',name:'Trabajo',order:0,created:T0},{id:'personal',name:'Personal',order:1,created:T0}],
  projects:[{id:'p1', spaceId:'trabajo', name:'FLC', color:'#007AFF', order:0, archived:false, created:T0, modified:T0},{id:'p2', spaceId:'trabajo', name:'Transformación digital OCA', color:'#34C759', order:1, archived:false, created:T0, modified:T0},
    {id:'p9', spaceId:'personal', name:'Casa', color:'#FF9500', order:0, archived:false, created:T0, modified:T0}],
  tasks:[ tk('a1', {title:'Enviar acta', estimate:15, notes:'Ver correo', created:C(1)}),
    tk('a2', {title:LONG, projectId:'p2', priority:'high', focus:new Date(2026,10,4,8,0).toISOString(), notes:'Con notas', created:C(2)}),
    tk('a3', {title:'Informe mensual', date:'2026-11-10', deadline:'2026-11-04', estimate:60, created:C(3)}), // in Hoy by its deadline: the Fecha column shows
    tk('a4', {title:'Reunión SteerCo', reminder:new Date(2026,10,4,16,30).toISOString(), created:C(4)}),
    tk('a5', {title:'Llamar al banco', carried:true, created:C(5)}), // Aplazada: the Fecha column shows
    tk('a6', {title:'En Ahora', focus:new Date(2026,10,4,8,0).toISOString(), estimate:30, created:C(6)}),
    tk('a7', {title:'Firma del cliente', status:'waiting', waitingFor:'Cliente', created:C(7)}), // Revisar hoy
    tk('a8', {title:'Más adelante', date:'2026-11-12', projectId:'p2', created:C(8)}),
    tk('h1', {title:'Comprar pintura', spaceId:'personal', projectId:'p9', created:C(30)}) ],
  voiceNotes:[], attachments:[], subtasks:[], projectNotes:[], settings:{tipsSeen:true} });
async function open(browser, o){
  const vp = o.phone ? {viewport:{width:390,height:844}, deviceScaleFactor:2, isMobile:true, hasTouch:true} : {viewport:{width:o.w||1280,height:o.h||800}, deviceScaleFactor:1};
  const ctx = await browser.newContext(Object.assign(vp, {colorScheme:o.theme||'light'})); const page = await ctx.newPage();
  await page.clock.install({time:NOW});
  page.on('pageerror', e=>errors.push(o.tag+' pageerror: '+e.message)); page.on('console', m=>{ if(m.type()==='error') errors.push(o.tag+' console: '+m.text()); });
  await page.addInitScript(s=>{ if(!localStorage.getItem('tareas-v1')) localStorage.setItem('tareas-v1', s); }, JSON.stringify(o.seed||SEED()));
  await page.goto(URL0); await until(page, ()=>typeof DB!=='undefined'&&!!document.querySelector(UI.wide?'#desk .main':'.screen.root')); return {ctx, page};
}
const ev = (page, fn, arg) => page.evaluate(fn, arg);
const until = async (page, fn, arg, ms=8000)=>{ const t0=Date.now(); for(;;){ let v=false; try{ v=await page.evaluate(fn, arg); }catch(e){} if(v) return true; if(Date.now()-t0>ms) return false; await sleep(80); } };
const calm = page => until(page, ()=>!app.classList.contains('navigating') && !HELD.size && !document.querySelector('.row.leaving, .flip, .enter') && !document.querySelector('#desk .pane')?.getAnimations().some(a=>a.playState==='running'));
// The geometry of the list: the header's cells and, per row, the same cells
const geo = page => ev(page, ()=>{ const m=document.querySelector('#desk .main'), hs=m.querySelectorAll('.colhead'), h=hs[0];
  const box=e=>{ if(!e) return null; const cs=getComputedStyle(e); if(cs.display==='none') return {shown:false}; const b=e.getBoundingClientRect(); return {shown:true, l:Math.round(b.left*2)/2, r:Math.round(b.right*2)/2, w:Math.round(b.width*2)/2}; };
  const cells=['pcol','row-text','rc-date','rc-dl','rc-rem','rc-est'];
  const one=el=>{ const o={}; cells.forEach(c=>o[c]=box(el.querySelector('.'+c))); return o; };
  const rows={}; m.querySelectorAll('.mbody .row[data-id]').forEach(el=>{ const k=el.dataset.id+(el.closest('.ahora')?'@ahora':''); rows[k]=Object.assign(one(el), {h:Math.round(el.getBoundingClientRect().height), title:(el.querySelector('.row-title')||{}).title}); });
  const labels=h?[...h.querySelectorAll('.chl')].filter(e=>getComputedStyle(e.parentElement).display!=='none'&&e.offsetParent).map(e=>e.textContent):[];
  const first=m.querySelector('.mbody .inner > :is(.ahora,.group,.gsec,.group-title,.wblock)'); // the header is above Ahora and the first group
  return {n:hs.length, head:h&&one(h), labels, rows, above:!!(h&&first&&(h.compareDocumentPosition(first)&Node.DOCUMENT_POSITION_FOLLOWING)), scrollW:m.querySelector('.mbody').scrollWidth, clientW:m.querySelector('.mbody').clientWidth, mainW:Math.round(m.getBoundingClientRect().width)}; });
// Every shown header cell has the edges of the same cell in each row that shows it
function aligned(g){ const bad=[]; Object.entries(g.rows).forEach(([id,row])=>{ ['pcol','rc-date','rc-dl','rc-rem','rc-est'].forEach(c=>{ const a=g.head[c], b=row[c]; if(!a||!b||!a.shown||!b.shown) return; if(Math.abs(a.l-b.l)>0.6||Math.abs(a.r-b.r)>0.6) bad.push({id, c, head:a, row:b}); }); }); return bad; }
const grip = (page, col) => ev(page, c=>{ const g=document.querySelector('#desk .main .colhead .colgrip[data-col='+c+']'); const b=g.getBoundingClientRect(); return {x:b.left+b.width/2, y:b.top+b.height/2}; }, col);
async function drag(page, col, dx){ const p=await grip(page, col); await page.mouse.move(p.x, p.y); await page.mouse.down(); for(let i=1;i<=6;i++){ await page.mouse.move(p.x+dx*i/6, p.y); await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>r()))); } await page.mouse.up(); }
const W = (g, id, c) => g.rows[id]&&g.rows[id][c]&&g.rows[id][c].w;
const openPane = async (page, id) => { await ev(page, id=>{ UI.dsel.cur=id; UI.deskDetail=id; render(); }, id); await until(page, ()=>app.classList.contains('has-pane')); await calm(page); };
const closePane = async page => { await ev(page, ()=>{ UI.deskDetail=null; render(); }); await until(page, ()=>!app.classList.contains('has-pane')); await calm(page); };

async function widths(browser){
  const res={};
  for(const w of [1000, 1280, 1600, 1920]){ const {ctx, page}=await open(browser, {tag:'W'+w, w}); await ev(page, ()=>setDeskView('hoy')); await calm(page);
    const hoy=(await geo(page)).rows.a1['row-text'].w; await ev(page, ()=>setDeskView('todas')); await calm(page); // Todas: Hoy adds its agenda column from 1400 px
    let g=await geo(page); res[w]={hoy, closed:g.rows.a1['row-text'].w, longH:g.rows.a2.h, shortH:g.rows.a1.h, over:g.scrollW>g.clientW, bad:aligned(g).length};
    await openPane(page, 'a1'); g=await geo(page); res[w].open=g.rows.a1['row-text'].w; res[w].overOpen=g.scrollW>g.clientW; res[w].badOpen=aligned(g).length; res[w].mainOpen=g.mainW;
    await ctx.close(); }
  // At 1280 the main column is 1060 px: the row takes it minus the padding (no 900 px cap)
  check('grows_closed', res[1920].closed - res[1280].closed >= 600 && res[1920].hoy - res[1280].hoy >= 300, res);
  check('grows_open', res[1920].open - res[1280].open >= 600, res);
  check('no_cap', res[1920].closed > 900, res[1920]); // the old list stopped at 900 px, its title at about 310
  check('no_overflow', [1000,1280,1600,1920].every(w=>!res[w].over&&!res[w].overOpen), res);
  check('one_line', [1000,1280,1600,1920].every(w=>res[w].longH===res[w].shortH&&res[w].shortH<=34), res);
  check('aligned_all_widths', [1000,1280,1600,1920].every(w=>!res[w].bad&&!res[w].badOpen), res);
}

async function main(browser){
  const {ctx, page} = await open(browser, {tag:'D', w:1280}); let g, x;
  await ev(page, ()=>setDeskView('hoy')); await calm(page);
  g = await geo(page);
  check('head_once', g.n===1 && g.above, {n:g.n, above:g.above});
  check('head_labels_hoy', JSON.stringify(g.labels)===JSON.stringify(['Proyecto','Tarea','Fecha','Entrega','Recordatorio','Tiempo']), g.labels);
  check('tooltip_full', g.rows.a2.title===LONG, g.rows.a2.title);
  x = await ev(page, ()=>{ const t=document.querySelector('#desk .main .row[data-id=a2] .row-title'); return {ellipsis:t.scrollWidth>t.clientWidth, ws:getComputedStyle(t).whiteSpace, to:getComputedStyle(t).textOverflow}; });
  check('title_ellipsis', x.ellipsis && x.ws==='nowrap' && x.to==='ellipsis', x);
  check('ahora_review_rows', !!g.rows['a6@ahora'] && !!g.rows.a7, Object.keys(g.rows));
  check('aligned_closed', aligned(g).length===0, aligned(g));
  // v0.29.3: the indicators keep fixed slots, so the star of Ahora and the notes icon sit in the same column on every row
  x = await ev(page, ()=>{ const L='#desk .mbody .row[data-id]:not(.first .row)', m=(id,s)=>{ const e=document.querySelector(L.replace('[data-id]','[data-id='+id+']')+' '+s); if(!e) return null; const b=e.getBoundingClientRect(); return Math.round(b.left+b.width/2); };
    return {starA2:m('a2','.ist svg'), starA6:m('a6','.ist svg'), noteA1:m('a1','.is-nt svg'), noteA2:m('a2','.is-nt svg')}; });
  check('ind_slots', x.starA2!==null && x.starA2===x.starA6 && x.noteA1!==null && x.noteA1===x.noteA2 && x.noteA1>x.starA2, x);
  const h0 = g.head;
  // The header follows the rows: a list without reminders, estimates or deadlines shows none of them
  await ev(page, ()=>{ DB.settings.activeSpace='personal'; resetListState(); save(); setDeskView('hoy'); }); await calm(page);
  g = await geo(page); check('head_labels_personal', JSON.stringify(g.labels)===JSON.stringify(['Proyecto','Tarea']), g.labels);
  await ev(page, ()=>{ task('h1').reminder=new Date(2026,10,4,18,0).toISOString(); save(); render(); }); await calm(page);
  g = await geo(page); check('head_labels_rem', JSON.stringify(g.labels)===JSON.stringify(['Proyecto','Tarea','Recordatorio']) && aligned(g).length===0, {labels:g.labels, bad:aligned(g)});
  // An empty list has no header
  await ev(page, ()=>{ task('h1').status='done'; task('h1').completed=new Date().toISOString(); save(); render(); }); await calm(page);
  g = await geo(page); x = await ev(page, ()=>{ const h=document.querySelector('#desk .main .colhead'); return h?getComputedStyle(h).display:'absent'; });
  check('head_empty_hidden', x==='none' || x==='absent', x);
  await ev(page, ()=>{ DB.settings.activeSpace='trabajo'; resetListState(); save(); setDeskView('project:p1'); }); await calm(page);
  g = await geo(page); check('head_project_noproj', g.n===1 && !g.labels.includes('Proyecto') && g.labels.includes('Tarea') && aligned(g).length===0, {labels:g.labels, bad:aligned(g)});
  // Other views: Todas, Ahora, Por confirmar have it; calendar and Ajustes do not; Ajustes keeps its 900 px
  for(const v of ['todas','ahora','waiting']){ await ev(page, v=>setDeskView(v), v); await calm(page); g=await geo(page); check('head_'+v, g.n===1 && g.labels.includes('Tarea') && aligned(g).length===0, {n:g.n, labels:g.labels, bad:aligned(g)}); }
  await ev(page, ()=>{ setDeskView('todas'); UI.query='informe'; render(); }); await calm(page); g=await geo(page);
  check('head_search', g.n===1 && Object.keys(g.rows).length===1 && aligned(g).length===0, {n:g.n, rows:Object.keys(g.rows)});
  await ev(page, ()=>{ UI.query=''; render(); });
  for(const v of ['week','month','day','settings']){ await ev(page, v=>setDeskView(v), v); await calm(page); x=await ev(page, ()=>document.querySelectorAll('#desk .colhead').length); check('nohead_'+v, x===0, x); }
  x = await ev(page, ()=>Math.round(document.querySelector('#desk .main .inner.settings').getBoundingClientRect().width)); check('settings_width', x<=900, x);

  // Dragging: Proyecto right edge, Fecha left edge (to the left widens it), the limits, double click
  await ev(page, ()=>setDeskView('hoy')); await calm(page);
  await drag(page, 'proj', 60); g = await geo(page);
  check('drag_proj', g.head.pcol.w===h0.pcol.w+60 && W(g,'a1','pcol')===h0.pcol.w+60 && W(g,'a6@ahora','pcol')===h0.pcol.w+60 && aligned(g).length===0, {head:g.head.pcol, row:g.rows.a1.pcol, h0:h0.pcol});
  x = await ev(page, ()=>JSON.stringify(DB.settings.colWidths)+'|'+JSON.parse(localStorage.getItem('tareas-v1')).settings.colWidths.proj);
  check('drag_saved', x===JSON.stringify({proj:192})+'|192', x);
  await drag(page, 'date', -40); g = await geo(page);
  check('drag_date', g.head['rc-date'].w===h0['rc-date'].w+40 && W(g,'a5','rc-date')===h0['rc-date'].w+40 && W(g,'a7','rc-date')===h0['rc-date'].w+40 && aligned(g).length===0, {head:g.head['rc-date'], row:g.rows.a5['rc-date']});
  check('title_shrinks', W(g,'a1','row-text') <= h0['row-text'].w-100+1, {now:W(g,'a1','row-text'), was:h0['row-text'].w});
  await drag(page, 'proj', 1000); g = await geo(page); const pmax=g.head.pcol.w;
  await drag(page, 'proj', -1000); g = await geo(page); const pmin=g.head.pcol.w;
  await drag(page, 'date', -1000); g = await geo(page); const dmax=g.head['rc-date'].w;
  await drag(page, 'est', 1000); g = await geo(page); const emin=g.head['rc-est'].w;
  check('limits', pmax===300 && pmin===60 && dmax===200 && emin===44 && W(g,'a1','rc-est')===44, {pmax, pmin, dmax, emin});
  const gp=await grip(page, 'proj'); await page.mouse.dblclick(gp.x, gp.y); g = await geo(page);
  check('dblclick_reset', g.head.pcol.w===132 && W(g,'a1','pcol')===132 && await ev(page, ()=>!('proj' in DB.settings.colWidths)), g.head.pcol);
  x = await ev(page, ()=>({sel:UI.dsel.cur, pane:UI.deskDetail})); check('head_no_row_action', !x.pane, x);

  // Kept across a reload: Proyecto 180, Fecha 120, Tiempo 44 (from above)
  await drag(page, 'proj', 48); await ev(page, ()=>{ flushEdits&&flushEdits(); });
  await page.reload(); await until(page, ()=>typeof DB!=='undefined'&&!!document.querySelector('#desk .main')); await ev(page, ()=>setDeskView('hoy')); await calm(page);
  g = await geo(page); x = await ev(page, ()=>DB.settings.colWidths);
  check('reload_kept', g.head.pcol.w===180 && W(g,'a1','pcol')===180 && g.head['rc-date'].w===200 && g.head['rc-est'].w===44 && x.proj===180, {pcol:g.head.pcol, date:g.head['rc-date'], x});

  // The inspector open: the user's widths stay, the others take the narrower defaults of point 22; the reminder shows its bell only
  await openPane(page, 'a1'); g = await geo(page);
  check('pane_widths', g.head.pcol.w===180 && g.head['rc-date'].w===200 && g.head['rc-dl'].w===100 && g.head['rc-rem'].w===18 && g.head['rc-est'].w===44 && aligned(g).length===0, {head:g.head, bad:aligned(g)});
  x = await ev(page, ()=>getComputedStyle(document.querySelector('#desk .main .row[data-id=a4] .rc-rem')).fontSize); check('pane_rem_bell', x==='0px', x);
  await drag(page, 'rem', -20); g = await geo(page);
  x = await ev(page, ()=>({fs:getComputedStyle(document.querySelector('#desk .main .row[data-id=a4] .rc-rem')).fontSize, w:DB.settings.colWidths.rem}));
  check('pane_rem_resized', g.head['rc-rem'].w===60 && W(g,'a4','rc-rem')===60 && x.fs!=='0px' && x.w===60 && aligned(g).length===0, {head:g.head['rc-rem'], x});
  await drag(page, 'dl', -30); g = await geo(page);
  check('pane_drag_dl', g.head['rc-dl'].w===130 && W(g,'a3','rc-dl')===130 && aligned(g).length===0, g.head['rc-dl']);
  await closePane(page); g = await geo(page);
  check('closed_keeps_user', g.head['rc-dl'].w===130 && g.head['rc-rem'].w===60 && g.head.pcol.w===180 && aligned(g).length===0, g.head);
  // Bad saved values are dropped on load
  await ev(page, ()=>{ const d=JSON.parse(localStorage.getItem('tareas-v1')); d.settings.colWidths={proj:5000, date:'x', foo:90, est:50, dl:-3}; localStorage.setItem('tareas-v1', JSON.stringify(d)); });
  await page.reload(); await until(page, ()=>typeof DB!=='undefined'&&!!document.querySelector('#desk .main')); await ev(page, ()=>setDeskView('hoy')); await calm(page);
  g = await geo(page); x = await ev(page, ()=>DB.settings.colWidths);
  check('bad_dropped', JSON.stringify(x)==='{"est":50}' && g.head.pcol.w===132 && g.head['rc-est'].w===50 && g.head['rc-date'].w===84, {x, head:g.head});
  check('no_iphone_style_leak', await ev(page, ()=>!document.querySelector('.app:not(.desktop)')), true);
  await ctx.close();
}

async function shots(browser){
  for(const theme of ['light','dark']){ const {ctx, page}=await open(browser, {tag:'S'+theme, w:1600, h:900, theme}); await ev(page, ()=>setDeskView('hoy')); await calm(page);
    await page.mouse.move(1200, 10); await shot(page, 'desk-1600-'+theme);
    const p=await grip(page, 'proj'); await page.mouse.move(p.x, p.y);
    const lit=await until(page, ()=>getComputedStyle(document.querySelector('#desk .colhead .colgrip[data-col=proj]'), '::after').opacity==='1'); check('hover_line_'+theme, lit); await shot(page, 'desk-1600-hover-'+theme);
    await openPane(page, 'a2'); await page.mouse.move(800, 10); await shot(page, 'desk-1600-pane-'+theme);
    await closePane(page); await ev(page, ()=>setDeskView('todas')); await calm(page); await shot(page, 'desk-1600-todas-'+theme);
    await ctx.close(); }
  // The iPhone: no header, the rows as before
  const {ctx, page}=await open(browser, {tag:'P', phone:true}); await until(page, ()=>!!document.querySelector('.screen.root .row'));
  const x = await ev(page, ()=>({head:document.querySelectorAll('.colhead').length, desk:!!document.querySelector('#desk'), rows:document.querySelectorAll('.screen.root .row').length}));
  check('iphone_unchanged', x.head===0 && !x.desk && x.rows>3, x);
  await shot(page, 'iphone-light'); await ctx.close();
}

(async()=>{
  await new Promise(res=>srv.listen(PORT,res)); const browser = await chromium.launch();
  try{ await widths(browser); }catch(e){ fails.push('widths_exception'); errors.push('widths: '+String(e&&e.stack||e)); }
  try{ await main(browser); }catch(e){ fails.push('main_exception'); errors.push('main: '+String(e&&e.stack||e)); }
  try{ await shots(browser); }catch(e){ fails.push('shots_exception'); errors.push('shots: '+String(e&&e.stack||e)); }
  console.log(JSON.stringify({r, fails, errors}, null, 1));
  await browser.close(); srv.close(); process.exit(fails.length||errors.length?1:0);
})();
