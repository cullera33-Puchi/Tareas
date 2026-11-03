require('./lib/out.js'); // outputs (screenshots, downloads) go to tests/out
// Decision 52 (no day summary), port 10550. Screenshots in tests/out/ns.
//  Clock at Tuesday 3 November 2026, 10:00 and 19:30. Seed: a carried task, a high priority one, one with its deadline today, a waiting one
//  to review today, one in Ahora, a plain one, one for tomorrow and one done today; the old summary settings stored (summaryState,
//  summaryCollapsed) must be harmless and dropped.
//  1. iPhone light and dark at 10:00 and 19:30: no summary card, no figures, no «Lo primero», no «Resumen del día» anywhere, no summary
//     option in the view menu; still there: the Hoy count of the segment, the Ahora block (its task once), Revisar hoy, Aplazadas with
//     Repasar (1) that opens the review, Hoy, «Mañana: 1 tarea», and only at 19:30 «Cerrar el día» as one cell after the rows; no task
//     listed twice outside Ahora. With Hoy all done, «Todo hecho por hoy» as the empty state.
//  2. Desktop light and dark: the same in the column (no figures line, no «Lo primero» block), the Cerrar el día cell at 19:30.
const { chromium } = require('playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = path.resolve(__dirname, '..'), PORT = 10550, URL0 = 'http://localhost:'+PORT+'/';
const OUT = path.join(__dirname, 'out', 'ns'); fs.mkdirSync(OUT, {recursive:true});
const TYPES = {'.html':'text/html','.css':'text/css','.js':'application/javascript','.webmanifest':'application/manifest+json','.png':'image/png'};
const srv = http.createServer((req,res)=>{ let p = decodeURIComponent(req.url.split('?')[0]); if(p==='/') p='/index.html';
  if(p==='/config.js'){ res.writeHead(200,{'Content-Type':'application/javascript'}); res.end('window.TAREAS_CONFIG = {"url":null,"anonKey":null};\n'); return; }
  const f=path.join(ROOT,p); if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){ res.writeHead(404,{'Content-Type':'text/html'}); res.end('<h1>404</h1>'); return; }
  res.writeHead(200,{'Content-Type':TYPES[path.extname(f)]||'application/octet-stream'}); res.end(fs.readFileSync(f)); });
const r={}, fails=[], errors=[]; const check=(name, ok, info)=>{ r[name]=ok?true:(info===undefined?false:info); if(!ok) fails.push(name); };
const sleep=ms=>new Promise(res=>setTimeout(res,ms));
const shot=(page, name)=>page.screenshot({path:path.join(OUT, name+'.png')});

const AT = (h, m) => new Date(2026, 10, 3, h, m, 0); // Tuesday 3 November 2026, local
const T0 = '2026-11-02T08:00:00.000Z';
const tk = (id, o) => Object.assign({id, title:id, spaceId:'trabajo', projectId:'p1', date:'2026-11-03', reminder:null, priority:'none', status:'pending', notes:'', carried:false, created:T0, modified:T0, completed:null}, o);
const SEED = () => ({ spaces:[{id:'trabajo',name:'Trabajo',order:0,created:T0},{id:'personal',name:'Personal',order:1,created:T0}],
  projects:[{id:'p1', spaceId:'trabajo', name:'FLC', color:'#007AFF', order:0, archived:false, created:T0, modified:T0},{id:'p2', spaceId:'trabajo', name:'OCA', color:'#34C759', order:1, archived:false, created:T0, modified:T0}],
  tasks:[ tk('c1', {title:'Llamar a Luis', date:'2026-11-02'}), // yesterday's: rollOver carries it
    tk('h1', {title:'Preparar comité', priority:'high'}),
    tk('d1', {title:'Entregar informe', date:'2026-11-10', deadline:'2026-11-03', projectId:'p2'}), // deadline today
    tk('w1', {title:'Firma del contrato', status:'waiting', waitingFor:'Ramiro'}), // review today
    tk('a1', {title:'Revisar acta', focus:new Date(2026,10,3,8,0).toISOString(), reminder:new Date(2026,10,3,10,40).toISOString()}), // in Ahora, a reminder soon
    tk('n2', {title:'Enviar agenda', projectId:'p2'}),
    tk('t1', {title:'Plan de pruebas', date:'2026-11-04'}), // tomorrow
    tk('x1', {title:'Hecha hoy', status:'done', completed:new Date(2026,10,3,9,0).toISOString()}) ],
  voiceNotes:[], attachments:[], subtasks:[], projectNotes:[], settings:{tipsSeen:true, summaryState:'closed', summaryCollapsed:true} });
async function open(browser, o){
  const vp = o.desk ? {viewport:{width:1280,height:800}, deviceScaleFactor:1} : {viewport:{width:390,height:844}, deviceScaleFactor:2, isMobile:true, hasTouch:true};
  const ctx = await browser.newContext(Object.assign(vp, {colorScheme:o.theme||'light'})); const page = await ctx.newPage();
  await page.clock.install({time:o.now});
  page.on('pageerror', e=>errors.push(o.tag+' pageerror: '+e.message)); page.on('console', m=>{ if(m.type()==='error') errors.push(o.tag+' console: '+m.text()); });
  await page.addInitScript(s=>{ if(!localStorage.getItem('tareas-v1')) localStorage.setItem('tareas-v1', s); }, JSON.stringify(SEED()));
  await page.goto(URL0); await until(page, ()=>typeof DB!=='undefined'&&!!document.querySelector(UI.wide?'#desk .main':'.screen.root')); return {ctx, page};
}
const ev = (page, fn, arg) => page.evaluate(fn, arg);
const until = async (page, fn, arg, ms=8000)=>{ const t0=Date.now(); for(;;){ let v=false; try{ v=await page.evaluate(fn, arg); }catch(e){} if(v) return true; if(Date.now()-t0>ms) return false; await sleep(80); } };
const calm = page => until(page, ()=>!app.classList.contains('navigating') && !HELD.size && !document.querySelector('.row.leaving, .flip, .enter') && !touchDrag && !sheet.classList.contains('closing'));
// The list as the eye reads it: each group title with the ids of the rows under it (Ahora left out)
const groups = (page, root) => ev(page, root=>{ const out=[]; let cur=null;
  document.querySelectorAll(root+' .group-title, '+root+' .group').forEach(e=>{ if(e.closest('.ahora')) return;
    if(e.classList.contains('group-title')){ const gl=e.querySelector('.gl'); cur={t:[...(gl||e).childNodes].filter(n=>n.nodeType===3).map(n=>n.textContent).join('').trim(), x:(e.querySelector('.gx')||{}).textContent||'', ids:[]}; out.push(cur); }
    else { const ids=[...e.querySelectorAll('.row')].map(r=>r.dataset.id); if(!cur){ cur={t:'', ids:[]}; out.push(cur); } cur.ids.push(...ids); } });
  return out; }, root);
// What the summary used to draw, and what stays: one look at the screen
const look = (page, root) => ev(page, root=>{ const sc=document.querySelector(root); const txt=sc.textContent;
  const ids=[...sc.querySelectorAll('.row[data-id]')].filter(r=>!r.closest('.ahora')).map(r=>r.dataset.id);
  const cd=[...sc.querySelectorAll('[data-act=closeDay]')], cell=sc.querySelector('.closecell'), rows=[...sc.querySelectorAll('.row[data-id]')];
  return { summary:!!sc.querySelector('.summary,.dsum,.summary-head,.nums,.num,[data-sum],[data-act=toggleSummary],.sumclose,.closeday,.alldone,.soonl,.firsthead'),
    firstOutsideAhora:[...sc.querySelectorAll('.first')].filter(e=>!e.closest('.ahora')).length,
    words:['Lo primero','Resumen del día','para hoy','prioritarias','Recordatorio a las'].filter(w=>txt.includes(w)),
    ahora:[...sc.querySelectorAll('.ahora .row[data-id]')].map(r=>r.dataset.id).join(), ahoraN:(sc.querySelector('.ahora .gn')||{}).textContent,
    dup:ids.filter((x,i)=>ids.indexOf(x)!==i), ids:ids.slice().sort().join(),
    seg:(document.querySelector('.screen.root:not(.hidden-tab) .seg [data-filter=hoy] .n')||document.querySelector('#desk .side [data-view=hoy] .n')||{}).textContent,
    review:(sc.querySelector('[data-act=review]')||{}).textContent, preview:(sc.querySelector('.preview')||{}).textContent,
    closeDay:cd.length, cellText:cell&&cell.textContent, cellAfterRows:!!cell&&!!rows.length&&!!(rows[rows.length-1].compareDocumentPosition(cell)&Node.DOCUMENT_POSITION_FOLLOWING),
    settings:'summaryState' in DB.settings || 'summaryCollapsed' in DB.settings }; }, root);
const menuLabels = page => ev(page, ()=>[...document.querySelectorAll('#pmenu .pm-it .pm-l')].map(b=>b.firstChild.textContent));

function common(tag, x, late){
  check(tag+'_no_summary', !x.summary && !x.firstOutsideAhora && !x.words.length, x);
  check(tag+'_old_settings_dropped', !x.settings, x.settings);
  check(tag+'_ahora', x.ahora==='a1' && x.ahoraN==='1', x);
  check(tag+'_once', !x.dup.length && x.ids==='a1,c1,d1,h1,n2,w1', x);
  check(tag+'_hoy_count', x.seg==='6', x.seg); // decision 52: the Hoy count stays (segment on the iPhone, sidebar on the desktop): w1, c1, h1, d1, a1, n2
  check(tag+'_kept', x.review==='Repasar (1)' && x.preview==='Mañana: 1 tarea', x);
  if(late) check(tag+'_close_cell', x.closeDay===1 && x.cellText==='Cerrar el día6 pendientes' && x.cellAfterRows, x);
  else check(tag+'_no_close_before_19', x.closeDay===0, x);
}

/* ======================= 1. iPhone ======================= */
const L = '.screen.root[data-root=tareas] .scroll';
async function iphone(browser, h, m, theme){
  const tag='I'+h+(theme==='dark'?'d':''); const {ctx, page} = await open(browser, {tag, now:AT(h,m), theme}); let x, g;
  await calm(page);
  x = await look(page, L); common(tag, x, h>=19);
  g = await groups(page, L);
  check(tag+'_groups', g[0].t==='Revisar hoy' && g[0].ids.join()==='w1' && g[1].t==='Aplazadas' && g[1].ids.join()==='c1' && g[2].t==='Hoy' && g[2].ids.slice().sort().join()==='a1,d1,h1,n2', g);
  // The Ahora card sits right above the search, where the summary was below it
  check(tag+'_ahora_above_search', await ev(page, L=>{ const sc=document.querySelector(L); return sc.firstElementChild.classList.contains('ahora') && sc.firstElementChild.nextElementSibling.classList.contains('searchbar'); }, L));
  await shot(page, 'm-hoy-'+(h>=19?'1930':'1000')+'-'+(theme||'light'));
  if(h>=19){ await ev(page, L=>document.querySelector(L+' .closecell').scrollIntoView({block:'center'}), L); await shot(page, 'm-hoy-1930-'+(theme||'light')+'-cell');
    await page.tap(L+' .closecell'); await until(page, ()=>sheet.classList.contains('on') && (document.querySelector('#sheet h2')||{}).textContent==='Cerrar el día');
    check(tag+'_close_sheet', await ev(page, ()=>document.querySelectorAll('#sheet [data-cd]').length>=2)); await ev(page, ()=>closeSheet()); await calm(page); }
  if(theme){ await ctx.close(); return; }
  // The view menu: no summary option
  await page.tap('.screen.root[data-root=tareas] .nav .vopts'); await until(page, ()=>menuOpen()); x = await menuLabels(page);
  check(tag+'_view_menu', x.length===6 && x[4]==='¿Qué hago ahora?' && /^Compartir estado de la semana/.test(x[5]) && !x.some(l=>/resumen/i.test(l)), x); await ev(page, ()=>closeMenu()); await until(page, ()=>!menuOpen()); await sleep(500);
  // Repasar still opens the review of the carried tasks, one by one
  await ev(page, L=>document.querySelector(L+' [data-act=review]').scrollIntoView({block:'center'}), L); await page.tap(L+' [data-act=review]');
  check(tag+'_repasar', await until(page, ()=>sheet.classList.contains('on') && /Llamar a Luis/.test((document.querySelector('#sheet .plan-title')||{}).textContent||'')));
  await ev(page, ()=>closeSheet()); await calm(page);
  // Hoy all done: the empty state says so (it was a line of the summary)
  await ev(page, ()=>{ ['c1','h1','d1','a1','n2'].forEach(id=>completeTask(id,true)); task('w1').status='done'; task('w1').completed=new Date().toISOString(); save(); render(); }); await calm(page);
  // Owner, 3 November: one discreet line, no icon and no links
  x = await ev(page, L=>({line:(document.querySelector(L+' .hoydone')||{}).textContent, big:!!document.querySelector(L+' .empty'), summary:!!document.querySelector(L+' .summary')}), L);
  check(tag+'_all_done', x.line==='Todo hecho por hoy, 7 completadas' && !x.big && !x.summary, x);
  await shot(page, 'm-hoy-done');
  await ctx.close();
}

/* ======================= 2. Desktop ======================= */
const M = '#desk .main .mbody';
async function desktop(browser, h, m, theme){
  const tag='D'+h+(theme==='dark'?'d':''); const {ctx, page} = await open(browser, {tag, now:AT(h,m), theme, desk:true}); let x, g;
  await calm(page);
  x = await look(page, M); common(tag, x, h>=19);
  g = await groups(page, M);
  check(tag+'_groups', g.some(o=>o.t==='Revisar hoy'&&o.ids.join()==='w1') && g.some(o=>o.t==='Aplazadas'&&o.ids.join()==='c1') && g.some(o=>o.t==='Hoy'&&o.ids.slice().sort().join()==='a1,d1,h1,n2'), g);
  check(tag+'_ahora_after_addbar', await ev(page, ()=>{ const a=document.querySelector('#desk .main .ahora'); return !!a && a.previousElementSibling && a.previousElementSibling.matches('.addbar,.addwrap,form,div') && !a.nextElementSibling.matches('.summary'); }));
  await sleep(2000); /* for the picture only: a fade of the first paint settles */ await shot(page, 'd-hoy-'+(h>=19?'1930':'1000')+'-'+(theme||'light'));
  if(!theme && h<19){ await page.click('#desk .mhead .mopts'); await until(page, ()=>menuOpen()); x = await menuLabels(page);
    check(tag+'_view_menu', x.length===6 && x[4]==='¿Qué hago ahora?' && /^Compartir estado de la semana/.test(x[5]) && !x.some(l=>/resumen/i.test(l)), x); await ev(page, ()=>closeMenu()); }
  if(h>=19){ await page.click('#desk .closecell'); check(tag+'_close_sheet', await until(page, ()=>sheet.classList.contains('on') && (document.querySelector('#sheet h2')||{}).textContent==='Cerrar el día')); }
  await ctx.close();
}

(async()=>{
  await new Promise(res=>srv.listen(PORT,res));
  const browser = await chromium.launch();
  try {
    await iphone(browser, 10, 0); await iphone(browser, 10, 0, 'dark'); await iphone(browser, 19, 30); await iphone(browser, 19, 30, 'dark');
    await desktop(browser, 10, 0); await desktop(browser, 10, 0, 'dark'); await desktop(browser, 19, 30); await desktop(browser, 19, 30, 'dark');
  } catch(e){ errors.push('exception: '+(e.stack||e.message)); }
  await browser.close(); srv.close();
  console.log(JSON.stringify({r, fails, errors}, null, 1));
  process.exit(fails.length||errors.length?1:0);
})();
