require('./lib/out.js'); // outputs (screenshots, downloads) go to tests/out
// Decision 51 («Revisar hoy» and «Por confirmar más adelante»), port 10450. Screenshots in tests/out/rh.
//  1. iPhone, clock at Tuesday 3 November 2026 0:10 (the owner's case) and 10:00: in Hoy the waiting tasks to review today (review day
//     reached, or deadline reached) go first in their own group «Revisar hoy (N)», without the word Revisar on the row and with Esperando a;
//     they count in para hoy; the rest of Hoy follows (Aplazadas, Hoy); the foot block «Por confirmar más adelante (N)» with «Mostrar las que
//     esperan» or «Ocultar las que esperan» lists only the others, each with its review day; no task twice. Hoy grouped by project keeps
//     Revisar hoy first. The swipe of a waiting row still offers Pendiente, the circle is half filled. Todas: no waiting task in the day
//     groups, its foot block «Por confirmar (N)» lists them all (Revisar hoy first). A search still finds them. Light and dark screenshots.
//  2. Desktop: the same in the column; Revisar hoy takes no drop; the Hoy group below still does; the sidebar view Por confirmar lists all.
const { chromium } = require('playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = path.resolve(__dirname, '..'), PORT = 10450, URL0 = 'http://localhost:'+PORT+'/';
const OUT = path.join(__dirname, 'out', 'rh'); fs.mkdirSync(OUT, {recursive:true});
const TYPES = {'.html':'text/html','.css':'text/css','.js':'application/javascript','.webmanifest':'application/manifest+json','.png':'image/png'};
const srv = http.createServer((req,res)=>{ let p = decodeURIComponent(req.url.split('?')[0]); if(p==='/') p='/index.html';
  if(p==='/config.js'){ res.writeHead(200,{'Content-Type':'application/javascript'}); res.end('window.TAREAS_CONFIG = {"url":null,"anonKey":null};\n'); return; }
  const f=path.join(ROOT,p); if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){ res.writeHead(404,{'Content-Type':'text/html'}); res.end('<h1>404</h1>'); return; }
  res.writeHead(200,{'Content-Type':TYPES[path.extname(f)]||'application/octet-stream'}); res.end(fs.readFileSync(f)); });
const r={}, fails=[], errors=[]; const check=(name, ok, info)=>{ r[name]=ok?true:(info===undefined?false:info); if(!ok) fails.push(name); };
const sleep=ms=>new Promise(res=>setTimeout(res,ms));
const shot=(page, name)=>page.screenshot({path:path.join(OUT, name+'.png')});

const AT = h => new Date(2026, 10, 3, h, 10, 0); // Tuesday 3 November 2026, h:10 local
const T0 = '2026-11-02T08:00:00.000Z';
const tk = (id, o) => Object.assign({id, title:id, spaceId:'trabajo', projectId:'p1', date:'2026-11-03', reminder:null, priority:'none', status:'pending', notes:'', carried:false, created:T0, modified:T0, completed:null}, o);
const SEED = () => ({ spaces:[{id:'trabajo',name:'Trabajo',order:0,created:T0},{id:'personal',name:'Personal',order:1,created:T0}],
  projects:[{id:'p1', spaceId:'trabajo', name:'FLC', color:'#007AFF', order:0, archived:false, created:T0, modified:T0},{id:'p2', spaceId:'trabajo', name:'OCA', color:'#34C759', order:1, archived:false, created:T0, modified:T0}],
  tasks:[ tk('w1', {title:'Firma del contrato', status:'waiting', waitingFor:'Ramiro', date:'2026-11-03'}), // review today
    tk('w2', {title:'Datos del cliente', status:'waiting', waitingFor:'Cliente', date:'2026-11-04', projectId:'p2'}), // review tomorrow
    tk('w3', {title:'Presupuesto', status:'waiting', waitingFor:'Marta', date:null}), // no review day
    tk('w4', {title:'Visto bueno legal', status:'waiting', waitingFor:'Legal', date:'2026-11-10', deadline:'2026-11-03', projectId:'p2'}), // deadline today
    tk('n1', {title:'Preparar comité', priority:'high'}), // a normal task of today
    tk('c1', {title:'Llamar a Luis', date:'2026-11-02', carried:true}), // yesterday's: rollOver carries it
    tk('f1', {title:'Plan de pruebas', date:'2026-11-05'}) ],
  voiceNotes:[], attachments:[], subtasks:[], projectNotes:[], settings:{tipsSeen:true} });
async function open(browser, o){
  const vp = o.desk ? {viewport:{width:1280,height:800}, deviceScaleFactor:1} : {viewport:{width:390,height:844}, deviceScaleFactor:2, isMobile:true, hasTouch:true};
  const ctx = await browser.newContext(Object.assign(vp, {colorScheme:o.theme||'light'})); const page = await ctx.newPage();
  await page.clock.install({time:o.now});
  page.on('pageerror', e=>errors.push(o.tag+' pageerror: '+e.message)); page.on('console', m=>{ if(m.type()==='error') errors.push(o.tag+' console: '+m.text()); });
  await page.addInitScript(s=>{ if(!localStorage.getItem('tareas-v1')) localStorage.setItem('tareas-v1', s); }, JSON.stringify(o.seed||SEED()));
  await page.goto(URL0); await until(page, ()=>typeof DB!=='undefined'&&!!document.querySelector(UI.wide?'#desk .main':'.screen.root')); return {ctx, page};
}
const ev = (page, fn, arg) => page.evaluate(fn, arg);
const until = async (page, fn, arg, ms=8000)=>{ const t0=Date.now(); for(;;){ let v=false; try{ v=await page.evaluate(fn, arg); }catch(e){} if(v) return true; if(Date.now()-t0>ms) return false; await sleep(80); } };
const calm = page => until(page, ()=>!app.classList.contains('navigating') && !HELD.size && !document.querySelector('.row.leaving, .flip, .enter') && !touchDrag);
// The list as the eye reads it: each group title with the ids of the rows under it, until the next title ("Lo primero" and Ahora left out)
const groups = (page, root) => ev(page, root=>{ const out=[]; let cur=null;
  document.querySelectorAll(root+' .group-title, '+root+' .group').forEach(e=>{ if(e.closest('.first,.ahora,.summary')) return;
    if(e.classList.contains('group-title')){ const gl=e.querySelector('.gl'); cur={t:[...(gl||e).childNodes].filter(n=>n.nodeType===3).map(n=>n.textContent).join('').trim(), n:(e.querySelector('.gn')||{}).textContent||'', x:(e.querySelector('.gx')||{}).textContent||'', ids:[]}; out.push(cur); }
    else { const ids=[...e.querySelectorAll('.row')].map(r=>r.dataset.id); if(!cur){ cur={t:'', ids:[]}; out.push(cur); } cur.ids.push(...ids); } });
  return out; }, root);
const rowMeta = (page, root, id) => ev(page, ([root,id])=>{ const r=document.querySelector(root+' .row[data-id="'+id+'"]'); if(!r) return null;
  return UI.wide ? {date:r.querySelector('.rc-date').textContent, tag:(r.querySelector('.wtag')||{}).textContent||'', half:r.querySelector('.check').classList.contains('waiting')}
    : {meta:(r.querySelector('.row-meta')||{}).textContent||'', half:r.querySelector('.check').classList.contains('waiting'), swipe:(r.querySelector('.row-bg.right button')||{}).textContent||''}; }, [root,id]);
const dupIds = (page, root) => ev(page, root=>{ const ids=[...document.querySelectorAll(root+' .row[data-id]')].filter(r=>!r.closest('.first,.ahora,.summary')).map(r=>r.dataset.id); return ids.filter((x,i)=>ids.indexOf(x)!==i); }, root);
const L = '.screen.root .scroll';

/* ======================= 1. iPhone ======================= */
async function iphone(browser, h, theme){
  const tag='I'+h+(theme==='dark'?'d':''); const {ctx, page} = await open(browser, {tag, now:AT(h), theme}); let x, g;
  await calm(page);
  g = await groups(page, L);
  check(tag+'_hoy_groups', g.length>=4 && g[0].t==='Revisar hoy' && g[0].n==='2' && g[0].ids.join()==='w1,w4' && g[1].t==='Aplazadas' && g[1].ids.join()==='c1' && g[2].t==='Hoy' && g[2].ids.join()==='n1'
    && g[3].t==='Por confirmar más adelante' && g[3].n==='2' && g[3].x==='Mostrar las que esperan' && !g[3].ids.length, g);
  x = {w1:await rowMeta(page, L, 'w1'), w4:await rowMeta(page, L, 'w4')};
  check(tag+'_review_rows', x.w1.meta==='FLCEsperando a Ramiro' && x.w4.meta==='OCAEntrega hoyEsperando a Legal' && !/Revisar/.test(x.w4.meta) && x.w1.half && x.w1.swipe==='Pendiente', x);
  x = await ev(page, ()=>({nums:[...document.querySelectorAll('.screen.root .summary .num b')].map(b=>b.textContent), hoy:pendingFor('hoy').map(x=>x.id).sort().join()}));
  check(tag+'_para_hoy', x.nums[0]==='4' && x.hoy==='c1,n1,w1,w4', x);
  if(h===0 && theme!=='dark') await shot(page, 'm-hoy-0010');
  // Unfold: only the two waiting tasks not in Hoy, each with its review day
  await page.tap(L+' .wblock [data-act=toggleWaiting]'); await calm(page);
  g = await groups(page, L); const wb=g.find(o=>o.t==='Por confirmar más adelante');
  x = {w2:await rowMeta(page, L, 'w2'), w3:await rowMeta(page, L, 'w3'), dup:await dupIds(page, L)};
  check(tag+'_later_block', wb && wb.x==='Ocultar las que esperan' && wb.ids.join()==='w2,w3' && x.w2.meta==='OCAMañanaEsperando a Cliente' && x.w3.meta==='FLCEsperando a Marta' && !x.dup.length, {wb, x});
  await ev(page, ()=>{ const e=document.querySelector('.screen.root .wblock'); e&&e.scrollIntoView({block:'center'}); });
  await shot(page, 'm-hoy-'+(h===0?'0010':'1010')+'-'+(theme||'light')+'-open');
  await ev(page, ()=>document.querySelector('.screen.root .scroll').scrollTop=0); await shot(page, 'm-hoy-'+(h===0?'0010':'1010')+'-'+(theme||'light'));
  if(h===0){ await ctx.close(); return; }
  // Hoy grouped by project: Revisar hoy still first
  await ev(page, ()=>{ DB.settings.hoyGroup='project'; save(); render(); }); await calm(page);
  g = await groups(page, L);
  check(tag+'_by_project', g[0].t==='Revisar hoy' && g[0].ids.join()==='w1,w4' && g[1].t==='FLC' && g[1].ids.join()===['n1','c1'].filter(i=>g[1].ids.includes(i)).join() && g[1].ids.length===2 && !g.slice(1).some(o=>o.t!=='Por confirmar más adelante'&&(o.ids.includes('w1')||o.ids.includes('w4'))) && !(await dupIds(page, L)).length, g);
  if(!theme) await shot(page, 'm-hoy-by-project');
  await ev(page, ()=>{ DB.settings.hoyGroup='date'; save(); render(); }); await calm(page);
  // The summary filter high: only n1, no Revisar hoy group
  await ev(page, ()=>{ UI.sumFilter='high'; render(); }); await calm(page); g = await groups(page, L);
  check(tag+'_sum_high', !g.some(o=>o.t==='Revisar hoy') && g[0].ids.join()==='n1', g);
  await ev(page, ()=>{ UI.sumFilter=null; UI.waitOpen=false; render(); }); await calm(page);
  // Todas: no waiting task in the day groups; the foot block has them all, those of today first, with Revisar hoy or their day
  await page.tap('.screen.root [data-filter=todas]'); await calm(page);
  g = await groups(page, L); const fb=g.find(o=>o.t==='Por confirmar');
  check(tag+'_todas_closed', fb && fb.n==='4' && fb.x==='Mostrar por confirmar' && !g.some(o=>o.t!=='Por confirmar'&&o.ids.some(i=>i[0]==='w')), g);
  await page.tap(L+' .wblock [data-act=toggleWaiting]'); await calm(page);
  g = await groups(page, L); const fo=g.find(o=>o.t==='Por confirmar');
  x = {w1:await rowMeta(page, L, 'w1'), w4:await rowMeta(page, L, 'w4'), w2:await rowMeta(page, L, 'w2'), dup:await dupIds(page, L)};
  check(tag+'_todas_open', fo && fo.x==='Ocultar por confirmar' && fo.ids.join()==='w1,w4,w2,w3' && x.w1.meta==='FLCRevisar hoyEsperando a Ramiro' && /^OCARevisar hoyEntrega hoy/.test(x.w4.meta) && x.w2.meta==='OCAMañanaEsperando a Cliente' && !x.dup.length, {fo, x});
  await ev(page, ()=>{ const e=document.querySelector('.screen.root .wblock'); e&&e.scrollIntoView({block:'start'}); }); await shot(page, 'm-todas-'+(theme||'light'));
  // A search finds a waiting task of today, said Revisar hoy
  await ev(page, ()=>{ UI.query='Ramiro'; render(); }); await calm(page);
  x = await rowMeta(page, L, 'w1');
  check(tag+'_search', !!x && x.meta==='FLCRevisar hoyEsperando a Ramiro' && await ev(page, ()=>!document.querySelector('.screen.root .wblock')), x);
  await ev(page, ()=>{ UI.query=''; render(); }); await calm(page);
  // Pendiente from the swipe button of a row in Revisar hoy (the action unwait), with Deshacer
  await page.tap('.screen.root [data-filter=hoy]'); await calm(page);
  await ev(page, ()=>{ unWait('w1'); render(); }); await calm(page);
  g = await groups(page, L);
  check(tag+'_unwait_moves', g[0].t==='Revisar hoy' && g[0].ids.join()==='w4' && g.find(o=>o.t==='Hoy').ids.includes('w1'), g);
  await ctx.close();
}

/* ======================= 2. Desktop ======================= */
async function desktop(browser, theme){
  const tag='D'+(theme==='dark'?'d':''); const {ctx, page} = await open(browser, {tag, now:AT(10), desk:true, theme}); let x, g;
  await calm(page); const M='#desk .main .mbody';
  g = await groups(page, M);
  check(tag+'_hoy_groups', g[0].t==='Revisar hoy' && g[0].n==='2' && g[0].ids.join()==='w1,w4' && g[1].t==='Aplazadas' && g[2].t==='Hoy' && g[2].ids.join()==='n1' && g[3].t==='Por confirmar más adelante' && g[3].x==='Mostrar las que esperan', g);
  x = {w1:await rowMeta(page, M, 'w1'), w4:await rowMeta(page, M, 'w4')};
  check(tag+'_review_rows', x.w1.date==='' && x.w1.tag==='Ramiro' && x.w1.half && x.w4.date==='' && x.w4.tag==='Legal', x);
  x = await ev(page, ()=>{ const h=document.querySelector('#desk .main [data-review-head]'), gr=document.querySelector('#desk .main .group[data-review]'); return {head:!!h, noDrop:!h.closest('[data-gday],[data-gproj]')&&!gr.closest('[data-gday],[data-gproj]')&&!gr.querySelector('[data-gday],[data-gproj]')&&h.dataset.gday===undefined}; });
  check(tag+'_review_no_drop', x.head && x.noDrop, x);
  await page.click(M+' .wblock [data-act=toggleWaiting]'); await calm(page);
  g = await groups(page, M); const wb=g.find(o=>o.t==='Por confirmar más adelante');
  x = await rowMeta(page, M, 'w2');
  check(tag+'_later_block', wb && wb.ids.join()==='w2,w3' && wb.x==='Ocultar las que esperan' && x.date==='Mañana' && !(await dupIds(page, M)).length, {wb, x});
  await shot(page, 'd-hoy-'+(theme||'light'));
  if(!theme){
    // Dragging n1 onto Revisar hoy does nothing; onto the Hoy title of the list it is already in, nothing either; w1 dragged to Aplazadas' neighbour Hoy is dated today
    const drag = async (src, dst) => { for(const s of [src,dst]) await page.$eval(s, e=>e.scrollIntoView({block:'center'}));
      const a=await (await page.$(src)).boundingBox(), b=await (await page.$(dst)).boundingBox();
      await page.mouse.move(a.x+a.width/3, a.y+a.height/2); await page.mouse.down();
      await page.mouse.move(b.x+b.width/2, b.y+b.height/2, {steps:10}); await page.mouse.move(b.x+b.width/2+2, b.y+b.height/2+1, {steps:3});
      const over = await ev(page, ()=>document.querySelectorAll('#desk .over').length); await page.mouse.up(); await calm(page); return over; };
    const before = await ev(page, ()=>JSON.stringify(DB.tasks.map(x=>[x.id,x.date,x.status,x.projectId])));
    const over = await drag(M+' .row[data-id=n1]', M+' .group[data-review] .row[data-id=w4]');
    const after = await ev(page, ()=>JSON.stringify(DB.tasks.map(x=>[x.id,x.date,x.status,x.projectId])));
    check(tag+'_drop_refused', over===0 && before===after, {over, same:before===after});
    const over2 = await drag(M+' .row[data-id=w2]', M+' .group-title[data-gday="2026-11-03"]');
    x = await ev(page, ()=>({d:task('w2').date, st:task('w2').status}));
    check(tag+'_drop_on_hoy', over2>0 && x.d==='2026-11-03' && x.st==='waiting', {over2, x});
    g = await groups(page, M);
    check(tag+'_after_drop', g[0].t==='Revisar hoy' && g[0].ids.slice().sort().join()==='w1,w2,w4', g);
    await ev(page, ()=>{ updTask('w2',{date:'2026-11-04'}); render(); }); await calm(page);
  }
  // The sidebar view Por confirmar lists them all, those of today first, said Revisar hoy
  await page.click('#desk .side [data-view=waiting]'); await calm(page);
  x = await ev(page, ()=>({ids:[...document.querySelectorAll('#desk .main .mbody .row')].map(r=>r.dataset.id).join(), n:document.querySelector('#desk .side [data-view=waiting] .n').textContent, d1:document.querySelector('#desk .main .row[data-id=w1] .rc-date').textContent, foot:(document.querySelector('#desk .main .footnote')||{}).textContent}));
  check(tag+'_sidebar_view', x.ids==='w1,w4,w2,w3' && x.n==='4' && x.d1==='Revisar hoy' && /Revisar hoy/.test(x.foot), x);
  // Todas: none in the day groups, all in the foot block
  await page.click('#desk .side [data-view=todas]'); await calm(page); await ev(page, ()=>{ UI.waitOpen=true; render(); }); await calm(page);
  g = await groups(page, M); const fo=g.find(o=>o.t==='Por confirmar');
  check(tag+'_todas', fo && fo.ids.join()==='w1,w4,w2,w3' && fo.x==='Ocultar por confirmar' && !g.some(o=>o.t!=='Por confirmar'&&o.ids.some(i=>i[0]==='w')) && !(await dupIds(page, M)).length, g);
  await shot(page, 'd-todas-'+(theme||'light'));
  await ctx.close();
}

(async()=>{
  await new Promise(res=>srv.listen(PORT,res));
  const browser = await chromium.launch();
  try {
    await iphone(browser, 0); await iphone(browser, 10); await iphone(browser, 10, 'dark');
    await desktop(browser); await desktop(browser, 'dark');
  } catch(e){ errors.push('exception: '+(e.stack||e.message)); }
  await browser.close(); srv.close();
  console.log(JSON.stringify({r, fails, errors}, null, 1));
  process.exit(fails.length||errors.length?1:0);
})();
