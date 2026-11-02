require('./lib/out.js'); // outputs (screenshots, downloads) go to tests/out
// Roadmap batch H: R18 (repaint only what changes). Every incremental path must leave the same DOM a full rebuild of the same markup gives
// (compared after normalising what code sets at runtime on both paths: the search field's data-shown, the compact header, style text,
// the desktop ARIA of the groups and the add bar's highlight), and must keep the rows that did not change (same elements).
// Timings (CPU 4x slower) are reported, not asserted. Clock fixed on Wednesday 4 November 2026 at 10:10 (local)
const { chromium } = require('playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = path.resolve(__dirname, '..'); const OUT = path.join(__dirname, 'out', 'H'); fs.mkdirSync(OUT, {recursive:true});
const TYPES = {'.html':'text/html','.css':'text/css','.js':'application/javascript','.webmanifest':'application/manifest+json','.png':'image/png'};
const srv = http.createServer((req,res)=>{ let p = decodeURIComponent(req.url.split('?')[0]); if(p==='/') p='/index.html'; const f=path.join(ROOT,p); if(!fs.existsSync(f)){res.writeHead(404);res.end();return;} res.writeHead(200,{'Content-Type':TYPES[path.extname(f)]||'application/octet-stream'}); res.end(fs.readFileSync(f)); });
const PORT=9108, URL='http://localhost:'+PORT+'/';
const SEED = JSON.stringify({spaces:[{id:'trabajo',name:'Trabajo',order:0},{id:'personal',name:'Personal',order:1}],projects:[],tasks:[],voiceNotes:[],settings:{tipsSeen:true}});
const r={}, fails=[]; const check=(name, ok, info)=>{ r[name]=ok?true:(info===undefined?false:info); if(!ok) fails.push(name); };
let errors=[]; const timings={};
const NOW = new Date(2026, 10, 4, 10, 10, 0);

// In the page: the normalised markup of a box, the reference for a screen, row markers
const HELPERS = () => {
  window.rowSel = '.screen.root:not(.hidden-tab) .scroll .row[data-id]';
  window.snap = (root, desk) => { const c=root.cloneNode(true);
    c.querySelectorAll('[data-shown]').forEach(e=>e.removeAttribute('data-shown'));
    c.querySelectorAll('.nav.compact').forEach(e=>e.classList.remove('compact'));
    if(desk){ c.querySelectorAll('.group').forEach(g=>['role','aria-multiselectable','aria-label'].forEach(a=>g.removeAttribute(a))); c.querySelectorAll('.qhl span').forEach(e=>e.innerHTML=''); const s=c.querySelector('#deskSaid'); if(s) s.innerHTML=''; }
    c.querySelectorAll('[style]').forEach(e=>{ const v=e.getAttribute('style').split(';').map(x=>x.trim().replace(/\s*:\s*/,':')).filter(x=>x&&!/^transform:/.test(x)).join(';'); if(v) e.setAttribute('style',v); else e.removeAttribute('style'); });
    c.querySelectorAll('[class=""]').forEach(e=>e.removeAttribute('class'));
    // What a field shows is its value, not the attribute it was first drawn with (the search field is never touched while typed in);
    // the order of attributes means nothing (a kept element gets a changed one at the end)
    c.querySelectorAll('input').forEach(i=>i.setAttribute('value', i.value));
    c.querySelectorAll('*').forEach(e=>{ const as=[...e.attributes].map(a=>[a.name,a.value]).sort((x,y)=>x[0]<y[0]?-1:1); if(as.length<2) return; as.forEach(([n])=>e.removeAttribute(n)); as.forEach(([n,v])=>e.setAttribute(n,v)); });
    return c.innerHTML; };
  window.parsed = html => { const d=document.createElement('div'); d.innerHTML=html; return d; };
  window.liveRoot = () => document.querySelector('.screen.root:not(.hidden-tab)');
  window.refRoot = () => { const sc=liveRoot().querySelector('.scroll'); return snap(parsed(lazyRows(viewTareas(), sc.scrollTop, innerHeight))); };
  window.sameRoot = () => { const a=snap(liveRoot()), b=refRoot(); if(a===b) return true; let i=0; while(i<a.length&&a[i]===b[i]) i++; return {at:i, live:a.slice(Math.max(0,i-120), i+160), ref:b.slice(Math.max(0,i-120), i+160)}; };
  window.topScreen = () => UI.stack[UI.stack.length-1].el;
  window.sameProject = () => { const s=UI.stack[UI.stack.length-1], sc=s.el.querySelector('.scroll'); const a=snap(s.el), b=snap(parsed(lazyRows(viewProject(s.id), sc.scrollTop, innerHeight))); if(a===b) return true; let i=0; while(i<a.length&&a[i]===b[i]) i++; return {at:i, live:a.slice(Math.max(0,i-120), i+160), ref:b.slice(Math.max(0,i-120), i+160)}; };
  window.sameDesk = () => { const d=document.querySelector('#desk'), mb=d.querySelector('.mbody'); const out={};
    const m=parsed(lazyRows(deskMain(), mb.scrollTop, innerHeight)).firstElementChild, s=parsed(deskSide()).firstElementChild;
    const cmp=(a,b,k)=>{ if(a===b) return; let i=0; while(i<a.length&&a[i]===b[i]) i++; out[k]={at:i, live:a.slice(Math.max(0,i-120), i+160), ref:b.slice(Math.max(0,i-120), i+160)}; };
    // paintSel gives the Tab stop to the first row when none is selected: the markup leaves it to the script
    const mainLive=snap(d.querySelector(':scope > .main'), true), mainRef=snap(paintRef(m), true);
    cmp(mainLive, mainRef, 'main'); cmp(snap(d.querySelector(':scope > .side'), true), snap(s, true), 'side');
    // A pane that would be kept (its markup unchanged and nothing changed it since) must hold the current markup; a changed one is redrawn next time
    const pn=d.querySelector(':scope > .pane'); if(pn&&!pn._dirty) cmp(pn._h, (()=>{ const st={a:UI.deskDetail}; const h=deskPaneHTML(); UI.deskDetail=st.a; return h; })(), 'pane');
    return Object.keys(out).length?out:true; };
  window.paintRef = m => { const ds=UI.dsel; if(!ds.cur||!m.querySelector('.mbody .row[data-id="'+CSS.escape(ds.cur)+'"]')){ const f=[...m.querySelectorAll('.mbody .row[data-id]')].find(x=>!x.closest('.first')); if(f) f.setAttribute('tabindex','0'); } return m; };
  window.mark = sel => { document.querySelectorAll(sel).forEach(e=>{ e.__m=1; }); };
  window.fresh = sel => [...document.querySelectorAll(sel)].filter(e=>!e.__m).map(e=>e.dataset.id||e.className);
};

async function open(browser, opts, n, setup){
  const ctx = await browser.newContext(Object.assign({ viewport:{width:390,height:844}, deviceScaleFactor:2, isMobile:true, hasTouch:true }, opts||{}));
  const page = await ctx.newPage(); await page.clock.install({time:NOW});
  await page.addInitScript(s=>{ if(!localStorage.getItem('tareas-v1')) localStorage.setItem('tareas-v1', s); }, SEED);
  page.on('pageerror', e=>errors.push(e.message)); page.on('console', m=>{ if(m.type()==='error') errors.push(m.text()); });
  await page.goto(URL); await page.waitForTimeout(400);
  await page.evaluate(HELPERS);
  await page.evaluate(n=>{ generateDemo(); const base=DB.tasks.filter(x=>x.id.startsWith('demo-t-'));
    for(let k=1;k<n/150;k++) base.forEach(x=>DB.tasks.push(Object.assign({}, x, {id:x.id+'-c'+k})));
    save(); rollOver(); if(UI.wide) setDeskView('todas'); else render(); }, n||150);
  await page.waitForTimeout(500); // the demo's toast and FLIP are over
  if(setup) await page.evaluate(setup);
  return {ctx, page};
}
const rowSel = '.screen.root:not(.hidden-tab) .scroll .row[data-id]';
const pick = (page, k) => page.evaluate(k=>{ const rs=[...document.querySelectorAll('.screen.root:not(.hidden-tab) .scroll .group .row[data-id]')].filter(x=>!x.closest('.first')); return rs[k].dataset.id; }, k);
const settle = page => page.waitForTimeout(600); // a FLIP slide is over (batch I: 450 ms since v0.14.5, was 350)

async function timeIt(page, label, setup, act, fullAct){
  const cdp = await page.context().newCDPSession(page); await cdp.send('Emulation.setCPUThrottlingRate', {rate:4});
  const inc=[], full=[];
  for(let i=0;i<3;i++){
    for(const [arr, src] of [[inc, act], [full, fullAct]]){
      await page.evaluate(new Function(setup)); await page.waitForTimeout(250);
      arr.push(await page.evaluate(src=>{ const t=performance.now(); new Function(src)(); void document.body.offsetHeight; return performance.now()-t; }, src));
      await page.waitForTimeout(250); } }
  await cdp.send('Emulation.setCPUThrottlingRate', {rate:1}); await cdp.detach();
  const med=a=>{ a=a.slice().sort((x,y)=>x-y); return Math.round(a[1]); };
  timings[label]={incremental:med(inc), fullRebuild:med(full)};
}

(async()=>{
  await new Promise(res=>srv.listen(PORT,res));
  const browser = await chromium.launch();

  /* ---------- iPhone, 150 tasks ---------- */
  let {ctx, page} = await open(browser, {colorScheme:'light'});
  check('M_initial', await page.evaluate(()=>sameRoot()) === true, await page.evaluate(()=>sameRoot()));
  check('M_rowsTagged', await page.evaluate(()=>[...document.querySelectorAll('.screen.root:not(.hidden-tab) .row')].every(x=>typeof x._h==='string')));

  // Priority: one row (and "Lo primero" when it becomes high) is drawn again, the rest stay; the summary counts follow
  let id = await pick(page, 4);
  await page.evaluate(()=>mark('.screen.root .row, .screen.root .summary, .screen.root .seg, .screen.root [data-role=search]'));
  await page.evaluate(id=>setPriority(id, task(id).priority==='high'?'none':'high'), id); await settle(page);
  r.priFresh = await page.evaluate(()=>fresh(rowSel));
  check('M_priority_same', await page.evaluate(()=>sameRoot()) === true, await page.evaluate(()=>sameRoot()));
  check('M_priority_fewRows', r.priFresh.length>=1 && r.priFresh.length<=2 && r.priFresh.every(x=>x===id), r.priFresh);
  r.priSum = await page.evaluate(()=>({shown:+document.querySelector('.screen.root:not(.hidden-tab) .summary [data-sum=high] b').textContent, real:pendingFor('hoy').filter(x=>x.priority==='high').length, kept:!!document.querySelector('.screen.root:not(.hidden-tab) .summary').__m}));
  check('M_priority_counter', r.priSum.shown===r.priSum.real && r.priSum.kept, r.priSum);
  await page.click('#toastBtn'); await settle(page);
  check('M_priority_undo', await page.evaluate(()=>sameRoot()) === true, await page.evaluate(()=>sameRoot()));

  // Project: the row is drawn again in place
  id = await pick(page, 6);
  await page.evaluate(()=>mark('.screen.root .row'));
  await page.evaluate(id=>{ const ps=activeProjects(), x=task(id); moveToProject(id, (ps.find(p=>p.id!==x.projectId)||{}).id); }, id); await settle(page);
  r.projFresh = await page.evaluate(()=>fresh(rowSel));
  check('M_project_same', await page.evaluate(()=>sameRoot()) === true, await page.evaluate(()=>sameRoot()));
  check('M_project_oneRow', JSON.stringify(r.projFresh)===JSON.stringify([id]), r.projFresh);

  // Complete (R1 marks, then the exit): the row leaves, the counts drop, the other rows stay; Deshacer brings it back
  id = await pick(page, 2);
  const before = await page.evaluate(()=>({hoy:pendingFor('hoy').length, seg:document.querySelector('.screen.root:not(.hidden-tab) .seg [data-filter=hoy] .n').textContent}));
  await page.evaluate(()=>mark('.screen.root .row'));
  await page.click('.screen.root:not(.hidden-tab) .scroll .group .row[data-id="'+id+'"] .check'); await page.waitForTimeout(1500+240+450);
  r.done = await page.evaluate(id=>({gone:!document.querySelector('.screen.root:not(.hidden-tab) .scroll .group .row[data-id="'+id+'"]'), status:task(id).status, seg:document.querySelector('.screen.root:not(.hidden-tab) .seg [data-filter=hoy] .n').textContent, hoy:pendingFor('hoy').length, fresh:fresh('.screen.root:not(.hidden-tab) .scroll .group:not(.first) .row[data-id]').length, toast:document.querySelector('#toastText').textContent}), id);
  check('M_complete_same', await page.evaluate(()=>sameRoot()) === true, await page.evaluate(()=>sameRoot()));
  check('M_complete_incremental', r.done.gone && r.done.status==='done' && +r.done.seg===before.hoy-1 && r.done.hoy===before.hoy-1 && r.done.fresh<=1 && r.done.toast==='Tarea completada', {r:r.done, before});
  await page.click('#toastBtn'); await settle(page);
  check('M_complete_undo', await page.evaluate(id=>task(id).status==='pending' && !!document.querySelector('.screen.root:not(.hidden-tab) .row[data-id="'+id+'"]'), id) && await page.evaluate(()=>sameRoot())===true, await page.evaluate(()=>sameRoot()));

  // Postpone to tomorrow: the row moves out of Hoy, the segment counts follow (FLIP as before)
  id = await pick(page, 3);
  await page.evaluate(id=>{ tomorrowTask(id); renderAnimated(); }, id); await settle(page);
  check('M_postpone_same', await page.evaluate(()=>sameRoot()) === true, await page.evaluate(()=>sameRoot()));
  r.post = await page.evaluate(id=>({inHoy:!!document.querySelector('.screen.root:not(.hidden-tab) .scroll .group .row[data-id="'+id+'"]'), todas:+document.querySelector('.screen.root:not(.hidden-tab) .seg [data-filter=todas] .n').textContent, real:pendingFor('todas').length}), id);
  check('M_postpone_counts', !r.post.inHoy && r.post.todas===r.post.real, r.post);

  // A row changed by code after it was drawn (swiped, held, lifted) is drawn again, never reused as it is
  id = await pick(page, 1);
  await page.evaluate(id=>{ const row=document.querySelector('.screen.root:not(.hidden-tab) .scroll .group .row[data-id="'+id+'"]'); row.classList.add('swiping','dir-l'); row.dataset.open='1'; row.querySelector('.row-content').style.transform='translate3d(-160px,0,0)'; render(); }, id);
  check('M_dirtyRowRedrawn', await page.evaluate(()=>sameRoot()) === true, await page.evaluate(()=>sameRoot()));

  // Views and filters: Todas by date, by project, the summary figures, a project chip, completed shown, the summary folded
  for(const [name, src] of [['todas', "DB.settings.filter='todas'; render()"], ['todasProject', "DB.settings.allGroup='project'; render()"], ['todasDate', "DB.settings.allGroup='date'; render()"],
    ['hoy', "DB.settings.filter='hoy'; render()"], ['hoyProject', "DB.settings.hoyGroup='project'; render()"], ['hoyPlain', "DB.settings.hoyGroup=null; render()"],
    ['sumHigh', "UI.sumFilter='high'; render()"], ['sumCarried', "UI.sumFilter='carried'; render()"], ['sumOff', "UI.sumFilter=null; render()"],
    ['chip', "UI.projFilter=activeProjects()[1].id; render()"], ['chipNone', "UI.projFilter='none'; render()"], ['chipOff', "UI.projFilter=null; render()"],
    ['doneOpen', "DB.settings.doneOpen=true; render()"], ['doneClosed', "DB.settings.doneOpen=false; render()"], ['fold', "toggleSummary()"], ['unfold', "toggleSummary()"],
    ['select', "startSelect(null)"], ['selectEnd', "endSelect()"]]){
    try{ await page.evaluate(new Function(src)); }catch(e){ check('M_view_'+name+'_ran', false, e.message); continue; }
    await settle(page); const s = await page.evaluate(()=>sameRoot()); check('M_view_'+name, s===true, s); }

  // Search: typing keeps the very same field (focus, caret); narrowing keeps the rows that still match; accents do not count; Cancelar as before
  // From the top of the list: a list that gets shorter would clamp the scroll, and the reference is drawn at the scroll it finds
  await page.evaluate(()=>{ DB.settings.filter='hoy'; render(); liveRoot().querySelector('.scroll').scrollTop=0; mark('.screen.root [data-role=search]'); });
  await page.click('.screen.root:not(.hidden-tab) [data-role=search]'); await page.keyboard.type('re'); await page.waitForTimeout(350);
  r.s1 = await page.evaluate(()=>{ const s=document.querySelector('.screen.root:not(.hidden-tab) [data-role=search]'); return {same:!!s.__m, focus:document.activeElement===s, value:s.value, cancel:!!document.querySelector('.screen.root:not(.hidden-tab) .searchbar .cancel'), count:(document.querySelector('.screen.root:not(.hidden-tab) .scroll .group-title')||{}).textContent, real:pendingFor('todas',undefined,'re').length}; });
  check('M_search_field', r.s1.same && r.s1.focus && r.s1.value==='re' && r.s1.cancel && r.s1.count===r.s1.real+' resultados', r.s1);
  check('M_search_same', await page.evaluate(()=>sameRoot()) === true, await page.evaluate(()=>sameRoot()));
  await page.evaluate(()=>mark('.screen.root .row'));
  await page.keyboard.type('v'); await page.waitForTimeout(350);
  r.s2 = await page.evaluate(()=>{ const s=document.querySelector('.screen.root:not(.hidden-tab) [data-role=search]'); return {same:!!s.__m, focus:document.activeElement===s, fresh:fresh('.screen.root:not(.hidden-tab) .scroll .row[data-id]').length, rows:document.querySelectorAll('.screen.root:not(.hidden-tab) .scroll .row[data-id]').length, count:(document.querySelector('.screen.root:not(.hidden-tab) .scroll .group-title')||{}).textContent, real:pendingFor('todas',undefined,'rev').length}; });
  check('M_search_narrowKeepsRows', r.s2.same && r.s2.focus && r.s2.fresh===0 && r.s2.rows===r.s2.real && r.s2.count===r.s2.real+' resultados', r.s2);
  check('M_search_narrow_same', await page.evaluate(()=>sameRoot()) === true, await page.evaluate(()=>sameRoot()));
  await page.keyboard.press('Backspace'); await page.waitForTimeout(350);
  check('M_search_widen_same', await page.evaluate(()=>sameRoot()) === true, await page.evaluate(()=>sameRoot()));
  await page.fill('.screen.root:not(.hidden-tab) [data-role=search]', 'comite'); await page.waitForTimeout(350);
  r.s3 = await page.evaluate(()=>({rows:document.querySelectorAll('.screen.root:not(.hidden-tab) .scroll .row[data-id]').length, titles:[...document.querySelectorAll('.screen.root:not(.hidden-tab) .scroll .row-title')].every(t=>/comité/.test(t.textContent))}));
  check('M_search_accents', r.s3.rows>0 && r.s3.titles, r.s3);
  await page.click('.screen.root:not(.hidden-tab) .searchbar .cancel'); await page.waitForTimeout(300);
  r.s4 = await page.evaluate(()=>{ const s=document.querySelector('.screen.root:not(.hidden-tab) [data-role=search]'); return {q:UI.query, value:s.value, focus:document.activeElement===s, summary:!!document.querySelector('.screen.root:not(.hidden-tab) .summary'), cancel:!!document.querySelector('.screen.root:not(.hidden-tab) .searchbar .cancel')}; });
  check('M_search_cancel', r.s4.q==='' && r.s4.value==='' && !r.s4.focus && r.s4.summary && !r.s4.cancel, r.s4);
  check('M_search_cancel_same', await page.evaluate(()=>sameRoot()) === true, await page.evaluate(()=>sameRoot()));

  // Pushed screens: a detail draws only itself, going back draws nothing when nothing changed
  id = await pick(page, 2);
  await page.evaluate(()=>mark('.screen.root .row, .screen.root .summary'));
  await page.evaluate(id=>openDetail(id), id); await page.waitForTimeout(450);
  await page.evaluate(()=>pop()); await page.waitForTimeout(500);
  r.nav = await page.evaluate(()=>({fresh:fresh(rowSel).length, summary:!!document.querySelector('.screen.root:not(.hidden-tab) .summary').__m}));
  check('M_detail_noRootRepaint', r.nav.fresh===0 && r.nav.summary, r.nav);
  // A change in the detail: the list behind follows, with the other rows kept
  await page.evaluate(id=>openDetail(id), id); await page.waitForTimeout(450);
  await page.evaluate(id=>setPriority(id, task(id).priority==='mid'?'none':'mid'), id); await page.waitForTimeout(500);
  await page.evaluate(()=>pop()); await page.waitForTimeout(500);
  r.nav2 = await page.evaluate(()=>fresh(rowSel));
  check('M_detail_change_same', await page.evaluate(()=>sameRoot()) === true, await page.evaluate(()=>sameRoot()));
  check('M_detail_change_fewRows', r.nav2.length<=2 && r.nav2.every(x=>x===r.nav2[0]), r.nav2);
  // A project screen is merged too
  await page.evaluate(()=>push('project', activeProjects()[0].id)); await page.waitForTimeout(450);
  check('M_project_screen', await page.evaluate(()=>sameProject()) === true, await page.evaluate(()=>sameProject()));
  await page.evaluate(()=>{ mark('.pushed-screen .row'); const rs=[...topScreen().querySelectorAll('.scroll .row[data-id]')]; const x=task(rs[1].dataset.id); setPriority(x.id, x.priority==='high'?'none':'high'); }); await settle(page);
  r.pf = await page.evaluate(()=>[...topScreen().querySelectorAll('.scroll .row[data-id]')].filter(e=>!e.__m).length);
  check('M_project_screen_priority', await page.evaluate(()=>sameProject()) === true && r.pf<=1, {s:await page.evaluate(()=>sameProject()), fresh:r.pf});
  // Row gestures still work on kept and new rows: swipe right completes (R1), the left buttons open
  await page.evaluate(()=>pop()); await page.waitForTimeout(500);
  await page.screenshot({path:path.join(OUT,'h-mobile-light.png')});
  await ctx.close();

  /* ---------- iPhone, dark, gestures on merged rows ---------- */
  ({ctx, page} = await open(browser, {colorScheme:'dark'}));
  const cdp = await ctx.newCDPSession(page);
  id = await pick(page, 3);
  await page.evaluate(id=>setPriority(id, task(id).priority==='mid'?'none':'mid'), id); await settle(page); // id's row is new, its neighbours kept
  const swipe = async (rid, dx) => { const b = await page.$eval('.screen.root:not(.hidden-tab) .scroll .group .row[data-id="'+rid+'"]', e=>{ const sc=e.closest('.scroll'); const b0=e.getBoundingClientRect(), s0=sc.getBoundingClientRect(); sc.scrollTop+=b0.top-(s0.top+s0.height/2); const r=e.getBoundingClientRect(); return {x:r.left+r.width/2, y:r.top+r.height/2}; });
    await page.waitForTimeout(120);
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:b.x,y:b.y}]});
    for(let i=1;i<=8;i++){ await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:b.x+dx*i/8,y:b.y}]}); await page.waitForTimeout(16); }
    await page.waitForTimeout(120); await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]}); await page.waitForTimeout(350); };
  const kept = await pick(page, 4);
  await swipe(id, -120);
  r.g1 = await page.evaluate(id=>document.querySelector('.screen.root:not(.hidden-tab) .row[data-id="'+id+'"]').dataset.open, id);
  await page.evaluate(()=>{ if(openRow) closeRow(openRow); }); await page.waitForTimeout(350);
  await swipe(kept, 140);
  r.g2 = await page.evaluate(id=>HELD.has(id), kept);
  check('M_gestures_onMergedRows', r.g1==='1' && r.g2===true, {open:r.g1, held:r.g2});
  await page.waitForTimeout(1500+240+450);
  check('M_gestures_after', await page.evaluate(id=>task(id).status==='done', kept) && await page.evaluate(()=>sameRoot())===true, await page.evaluate(()=>sameRoot()));
  await page.screenshot({path:path.join(OUT,'h-mobile-dark.png')});
  await ctx.close();

  /* ---------- iPhone, 600 tasks: windowed lists ---------- */
  ({ctx, page} = await open(browser, {}, 600, ()=>{ DB.settings.filter='todas'; render(); }));
  r.win = await page.evaluate(()=>({rows:document.querySelectorAll('.screen.root:not(.hidden-tab) .scroll .row[data-id]').length, ph:document.querySelectorAll('.screen.root:not(.hidden-tab) .rph').length}));
  check('W_windowed', r.win.ph>100, r.win);
  check('W_initial', await page.evaluate(()=>sameRoot()) === true, await page.evaluate(()=>sameRoot()));
  await page.evaluate(()=>{ const sc=liveRoot().querySelector('.scroll'); sc.scrollTop=3000; }); await page.waitForTimeout(300);
  await page.evaluate(()=>{ const sc=liveRoot().querySelector('.scroll'); sc.scrollTop=6000; }); await page.waitForTimeout(300);
  id = await page.evaluate(()=>{ const sc=liveRoot().querySelector('.scroll'), b=sc.getBoundingClientRect(); return [...sc.querySelectorAll('.group .row[data-id]')].find(x=>{ const y=x.getBoundingClientRect().top; return y>b.top+100&&y<b.bottom-100; }).dataset.id; });
  await page.evaluate(()=>mark('.screen.root .row'));
  await page.evaluate(id=>setPriority(id, task(id).priority==='high'?'none':'high'), id); await settle(page);
  check('W_priority_same', await page.evaluate(()=>sameRoot()) === true, await page.evaluate(()=>sameRoot()));
  r.wf = await page.evaluate(()=>{ const sc=liveRoot().querySelector('.scroll'), b=sc.getBoundingClientRect(); return [...sc.querySelectorAll('.row[data-id]')].filter(x=>!x.__m&&x.getBoundingClientRect().bottom>b.top&&x.getBoundingClientRect().top<b.bottom).map(x=>x.dataset.id); });
  check('W_priority_visibleRowsKept', r.wf.length<=1, r.wf);
  await timeIt(page, 'iPhone600_priority', "window.__id=pendingFor('todas')[5].id; window.__p=task(window.__id).priority==='mid'?'none':'mid';", "updTask(window.__id,{priority:window.__p}); render()", "updTask(window.__id,{priority:window.__p}); liveRoot().replaceChildren(); render()");
  await ctx.close();

  /* ---------- Timings, iPhone 150 ---------- */
  ({ctx, page} = await open(browser, {}));
  await timeIt(page, 'iPhone150_priority', "window.__id=pendingFor('hoy')[4].id; window.__p=task(window.__id).priority==='mid'?'none':'mid';", "updTask(window.__id,{priority:window.__p}); render()", "updTask(window.__id,{priority:window.__p}); liveRoot().replaceChildren(); render()");
  await timeIt(page, 'iPhone150_completeExit', "window.__id=pendingFor('hoy')[4].id; if(task(window.__id).status!=='pending') updTask(window.__id,{status:'pending', completed:null}); render();", "applyDone(window.__id,true); renderAnimated()", "applyDone(window.__id,true); liveRoot().replaceChildren(); render()");
  await timeIt(page, 'iPhone150_searchNarrow', "UI.query='re'; render(); window.__s=liveRoot().querySelector('[data-role=search]'); __s.value='re';", "__s.value='rev'; UI.query='rev'; searchAround(__s)", "__s.value='rev'; UI.query='rev'; liveRoot().replaceChildren(); render()");
  await page.evaluate(()=>{ UI.query=''; render(); });
  await ctx.close();

  /* ---------- Desktop ---------- */
  ({ctx, page} = await open(browser, {viewport:{width:1280,height:800}, deviceScaleFactor:1, isMobile:false, hasTouch:false}));
  check('D_initial', await page.evaluate(()=>sameDesk()) === true, await page.evaluate(()=>sameDesk()));
  const drow = k => page.evaluate(k=>[...document.querySelectorAll('#desk .main .mbody .row[data-id]')].filter(x=>!x.closest('.first'))[k].dataset.id, k);
  id = await drow(2);
  await page.click('#desk .main .mbody .row[data-id="'+id+'"] .row-title'); await page.waitForTimeout(400);
  r.pane = await page.evaluate(()=>{ const pn=document.querySelector('#desk > .pane'); const a=pn&&pn.getAnimations?pn.getAnimations():[]; const kf=a[0]&&a[0].effect.getKeyframes(); return {task:pn&&pn.dataset.task, anim:a.length, tr:kf?kf[0].transform:null}; });
  check('D_paneOpens', r.pane.task===id, r.pane);
  await page.evaluate(()=>{ const pn=document.querySelector('#desk > .pane'); pn.remove(); UI.deskDetail=null; document.querySelector('#desk')._mainKind='list'; app.classList.remove('has-pane'); });
  await page.evaluate(()=>{ window.__anims=[]; const orig=Element.prototype.animate; Element.prototype.animate=function(k,o){ if(this.classList.contains('pane')) window.__anims.push(k); return orig.call(this,k,o); }; });
  await page.click('#desk .main .mbody .row[data-id="'+id+'"] .row-title'); await page.waitForTimeout(400);
  r.slide = await page.evaluate(()=>window.__anims);
  check('D_paneSlidesIn', r.slide.length===1 && /translate3d\(24px/.test(r.slide[0][0].transform) && r.slide[0][0].opacity===0, r.slide);
  check('D_open_same', await page.evaluate(()=>sameDesk()) === true, await page.evaluate(()=>sameDesk()));
  // Arrows: only the highlight and the inspector change; the rows, the column and the sidebar stay, the focus follows
  await page.evaluate(()=>{ mark('#desk .row, #desk .side, #desk .main, #desk .mhead, #desk [data-role=search]'); window.__anims=[]; });
  const cur0 = await page.evaluate(()=>UI.dsel.cur);
  await page.keyboard.press('ArrowDown'); await page.waitForTimeout(250); await page.keyboard.press('ArrowDown'); await page.waitForTimeout(250);
  r.arrow = await page.evaluate(()=>({cur:UI.dsel.cur, pane:document.querySelector('#desk > .pane').dataset.task, focus:document.activeElement.dataset.id, fresh:fresh('#desk .main .row[data-id]').length, side:!!document.querySelector('#desk .side').__m, main:!!document.querySelector('#desk .main').__m,
    curRows:[...document.querySelectorAll('#desk .main .mbody .row.cur')].map(x=>x.dataset.id), anims:window.__anims.length}));
  r.order = await page.evaluate(()=>deskOrder());
  check('D_arrows_paneOnly', r.arrow.cur===r.order[r.order.indexOf(cur0)+2] && r.arrow.pane===r.arrow.cur && r.arrow.focus===r.arrow.cur && r.arrow.fresh===0 && r.arrow.side && r.arrow.main && JSON.stringify(r.arrow.curRows)===JSON.stringify([r.arrow.cur]) && r.arrow.anims===0, r.arrow);
  check('D_arrows_same', await page.evaluate(()=>sameDesk()) === true, await page.evaluate(()=>sameDesk()));
  // A render while the pane shows the same task keeps the pane as it is
  await page.evaluate(()=>{ mark('#desk > .pane'); render(); });
  check('D_paneKept', await page.evaluate(()=>!!document.querySelector('#desk > .pane').__m));
  // ...but not when its task is another object (data replaced by an import or a restore): its fields are bound to the task they edit
  r.rebind = await page.evaluate(()=>{ const id=UI.deskDetail, i=DB.tasks.findIndex(x=>x.id===id); DB.tasks[i]=Object.assign({}, DB.tasks[i]); render();
    const pn=document.querySelector('#desk > .pane'), ti=pn.querySelector('[data-role=title]'); ti.value='Título nuevo'; ti.dispatchEvent(new Event('input')); flushEdits();
    const ok={replaced:!pn.__m, title:task(id).title}; updTask(id,{title:'Título nuevo'}); return ok; });
  check('D_paneRebound', r.rebind.replaced && r.rebind.title==='Título nuevo', r.rebind);
  // Priority from the shortcut: the row changes in place, the rest stays
  await page.evaluate(()=>mark('#desk .row'));
  const pid = await page.evaluate(()=>UI.dsel.cur);
  await page.keyboard.press('1'); await page.waitForTimeout(300);
  r.dpri = await page.evaluate(()=>({fresh:fresh('#desk .main .mbody .row[data-id]'), pri:task(UI.dsel.cur).priority}));
  check('D_priority', r.dpri.pri==='high' && r.dpri.fresh.length<=2 && r.dpri.fresh.every(x=>x===pid), r.dpri);
  check('D_priority_same', await page.evaluate(()=>sameDesk()) === true, await page.evaluate(()=>sameDesk()));
  // Complete from the keyboard (C): the row leaves after its wait; the inspector moves to the next one (as before)
  await page.keyboard.press('c'); await page.waitForTimeout(1500+240+400);
  r.dc = await page.evaluate(id=>({status:task(id).status, row:!!document.querySelector('#desk .main .mbody .row[data-id="'+id+'"]'), focusRow:document.activeElement.classList.contains('row')}), pid);
  check('D_complete', r.dc.status==='done' && !r.dc.row, r.dc);
  check('D_complete_same', await page.evaluate(()=>sameDesk()) === true, await page.evaluate(()=>sameDesk()));
  // Escape closes the inspector without drawing the column again
  await page.evaluate(()=>mark('#desk .row, #desk .main'));
  await page.keyboard.press('Escape'); await page.waitForTimeout(250);
  r.esc = await page.evaluate(()=>({pane:!!document.querySelector('#desk > .pane'), has:app.classList.contains('has-pane'), main:!!document.querySelector('#desk .main').__m, fresh:fresh('#desk .main .row[data-id]').length}));
  check('D_escClosesPane', !r.esc.pane && !r.esc.has && r.esc.main && r.esc.fresh<=1, r.esc);
  check('D_esc_same', await page.evaluate(()=>sameDesk()) === true, await page.evaluate(()=>sameDesk()));
  // Search: the same field throughout, the rows that still match kept, Cancelar as before
  await page.evaluate(()=>mark('#desk [data-role=search]'));
  await page.click('#desk [data-role=search]'); await page.keyboard.type('re'); await page.waitForTimeout(350);
  await page.evaluate(()=>mark('#desk .row'));
  await page.keyboard.type('v'); await page.waitForTimeout(350);
  r.ds = await page.evaluate(()=>{ const s=document.querySelector('#desk [data-role=search]'); return {same:!!s.__m, focus:document.activeElement===s, fresh:fresh('#desk .main .mbody .row[data-id]').length, rows:document.querySelectorAll('#desk .main .mbody .row[data-id]').length, real:pendingFor('todas',undefined,'rev').length}; });
  check('D_search', r.ds.same && r.ds.focus && r.ds.fresh===0 && r.ds.rows===r.ds.real, r.ds);
  check('D_search_same', await page.evaluate(()=>sameDesk()) === true, await page.evaluate(()=>sameDesk()));
  await page.click('#desk .searchbar .cancel'); await page.waitForTimeout(300);
  r.dsc = await page.evaluate(()=>({q:UI.query, v:document.querySelector('#desk [data-role=search]').value, cancel:!!document.querySelector('#desk .searchbar .cancel')}));
  check('D_search_cancel', r.dsc.q==='' && r.dsc.v==='' && !r.dsc.cancel, r.dsc);
  check('D_search_cancel_same', await page.evaluate(()=>sameDesk()) === true, await page.evaluate(()=>sameDesk()));
  // Other views keep working: Hoy, a project, Semana and back
  for(const v of ['hoy', 'project:'+await page.evaluate(()=>activeProjects()[0].id), 'week', 'todas']){
    await page.evaluate(v=>setDeskView(v), v); await page.waitForTimeout(250);
    if(v!=='week'){ const s=await page.evaluate(()=>sameDesk()); check('D_view_'+v.split(':')[0], s===true, s); } }
  await page.evaluate(()=>{ const rs=[...document.querySelectorAll('#desk .main .mbody .row[data-id]')]; openDetail(rs[1].dataset.id); });
  await page.waitForTimeout(400); await page.screenshot({path:path.join(OUT,'h-desk.png')});
  await timeIt(page, 'desk150_arrowWithPane', "const o=deskOrder(); openDetail(o[3]);", "moveSel(1)", "moveSel(1); render()");
  await timeIt(page, 'desk150_priority', "window.__id=deskOrder()[4]; window.__p=task(window.__id).priority==='mid'?'none':'mid';", "updTask(window.__id,{priority:window.__p}); render()", "updTask(window.__id,{priority:window.__p}); document.querySelector('#desk .main').replaceChildren(); render()");
  await ctx.close();

  // Reduce Motion: the inspector fades in, without sliding
  ({ctx, page} = await open(browser, {viewport:{width:1280,height:800}, deviceScaleFactor:1, isMobile:false, hasTouch:false, reducedMotion:'reduce'}));
  await page.evaluate(()=>{ window.__anims=[]; const orig=Element.prototype.animate; Element.prototype.animate=function(k,o){ if(this.classList.contains('pane')) window.__anims.push(k); return orig.call(this,k,o); }; });
  id = await drow(1); await page.click('#desk .main .mbody .row[data-id="'+id+'"] .row-title'); await page.waitForTimeout(400);
  r.rm = await page.evaluate(()=>window.__anims);
  check('D_reduceMotionFade', r.rm.length===1 && !r.rm[0].some(k=>k.transform) && r.rm[0][0].opacity===0, r.rm);
  await ctx.close();

  await browser.close(); srv.close();
  r.timings = timings;
  console.log(JSON.stringify({fails, results:r, timings, errors}, null, 1));
  process.exit(fails.length||errors.length?1:0);
})().catch(e=>{ console.log(JSON.stringify({fatal:e.message, stack:e.stack, fails, results:r, errors:errors.concat([e.message])}, null, 1)); process.exit(1); });
