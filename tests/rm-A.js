require('./lib/out.js'); // outputs (screenshots, downloads) go to tests/out
// Roadmap batch A: R1 (held completions), R2 (44 pt hit areas), R3 (rows without repeated data, readable capsules), R4 (velocity-aware gestures)
const { chromium } = require('playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = path.resolve(__dirname, '..'); const OUT = path.join(__dirname, 'out', 'A'); fs.mkdirSync(OUT, {recursive:true});
const TYPES = {'.html':'text/html','.css':'text/css','.js':'application/javascript','.webmanifest':'application/manifest+json','.png':'image/png'};
const srv = http.createServer((req,res)=>{ let p = decodeURIComponent(req.url.split('?')[0]); if(p==='/') p='/index.html'; const f=path.join(ROOT,p); if(!fs.existsSync(f)){res.writeHead(404);res.end();return;} res.writeHead(200,{'Content-Type':TYPES[path.extname(f)]||'application/octet-stream'}); res.end(fs.readFileSync(f)); });
const PORT=9101, URL='http://localhost:'+PORT+'/';
const SEED = JSON.stringify({spaces:[{id:'trabajo',name:'Trabajo',order:0},{id:'personal',name:'Personal',order:1}],projects:[],tasks:[],voiceNotes:[],settings:{tipsSeen:true}});
// Updated by batch C: groups of Todas, a project and Completadas now sit in a .gsec wrapper (R14 sticky headers), so the
// selectors say '.scroll .group' instead of '.scroll > .group'; the grouping is picked from the view menu (R13), not a segment;
// and a row in the Mañana day group no longer repeats "Mañana" (R14 day groups, in the spirit of R3)
const r={}, fails=[]; const check=(name, ok, info)=>{ r[name]=ok?true:(info===undefined?false:info); if(!ok) fails.push(name); };
const wait=ms=>new Promise(res=>setTimeout(res,ms));

async function mobile(browser, scheme){
  const ctx = await browser.newContext({ viewport:{width:390,height:844}, deviceScaleFactor:2, isMobile:true, hasTouch:true, colorScheme:scheme });
  // Today at 10:10 local: from 19:00 Hoy gains «Cerrar el día» (R8) and the rows move under the taps measured before; the clock is fixed so the
  // test does not depend on the hour it runs at (it failed after 19:00, with v0.21.0 too)
  const d0=new Date(); d0.setHours(10,10,0,0);
  const page = await ctx.newPage(); await page.clock.install({time:d0}); await page.addInitScript(s=>{ if(!localStorage.getItem('tareas-v1')) localStorage.setItem('tareas-v1', s); }, SEED);
  const errors=[]; page.on('pageerror', e=>errors.push(e.message)); page.on('console', m=>{ if(m.type()==='error') errors.push(m.text()); });
  await page.goto(URL); await page.waitForTimeout(400);
  const cdp = await ctx.newCDPSession(page);
  return {ctx, page, cdp, errors};
}
// A touch drag: n moves of step px each, gap ms apart, an optional pause before lifting
async function drag(cdp, page, x, y, sx, sy, n, gap, pause){
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
  for(let i=1;i<=n;i++){ await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+sx*i,y:y+sy*i}]}); await page.waitForTimeout(gap); }
  if(pause) await page.waitForTimeout(pause);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
}
// center: scrolls the element's own list (never the page) so it is well inside the screen, and returns its centre
const center = async (page, sel) => { await page.$eval(sel, e=>{ const sc=e.closest('.scroll'); if(!sc) return; const b=e.getBoundingClientRect(), r=sc.getBoundingClientRect(); if(b.top<r.top+60||b.bottom>r.bottom-120) sc.scrollTop+=b.top-(r.top+r.height/2); }); await page.waitForTimeout(60); return page.$eval(sel, e=>{ const b=e.getBoundingClientRect(); return {x:b.x+b.width/2, y:b.y+b.height/2, w:b.width, h:b.height}; }); };

(async()=>{
  await new Promise(res=>srv.listen(PORT,res));
  const browser = await chromium.launch();

  /* ---------- Mobile, light ---------- */
  let {ctx, page, cdp, errors} = await mobile(browser, 'light');
  await page.evaluate(()=>{ const t=todayStr(); const p=addProject('FLC','#FFCC00'); const q=addProject('Casa','#34C759');
    addTask({title:'Uno',date:t,projectId:p.id}); addTask({title:'Dos',date:t}); addTask({title:'Tres',date:t,notes:'algo'}); addTask({title:'Cuatro',date:t,projectId:q.id});
    addTask({title:'Arrastrada',date:t,carried:true,projectId:p.id}); addTask({title:'Prioritaria',date:t,priority:'high',projectId:p.id});
    addTask({title:'Suelta'}); addTask({title:'Mañana tarea',date:addDays(t,1),projectId:p.id});
    const d=addTask({title:'Hecha ayer',projectId:p.id}); d.status='done'; d.completed=new Date(Date.now()-3600e3).toISOString();
    { const n=new Date().toISOString(); DB.attachments.push({id:uid(),taskId:DB.tasks.find(x=>x.title==='Dos').id,kind:'audio',path:null,mime:'audio/mp4',size:4000,width:null,height:null,durationMs:5000,created:n,modified:n}); } save(); render(); }); // decision 49: a voice note is a recording, shown by the paperclip
  await page.waitForTimeout(300);
  const HOY='.screen.root[data-root=tareas]';
  const rowSel = title => HOY+' .scroll .group .row:has(.row-title:text-is("'+title+'"))';

  // R3 in Hoy: two groups (Aplazadas, Hoy); no "Hoy" and no "Aplazada" under the Aplazadas title
  r.hoyMeta = await page.$$eval(HOY+' .scroll .group .row', rs=>rs.map(x=>({t:x.querySelector('.row-title').textContent, m:(x.querySelector('.row-meta')||{}).textContent||''})));
  check('R3_noHoyInHoy', r.hoyMeta.every(o=>!/\bHoy\b/.test(o.m)), r.hoyMeta);
  check('R3_aplazadasGroupNoLabel', r.hoyMeta.find(o=>o.t==='Arrastrada').m.indexOf('Aplazada')<0, r.hoyMeta);
  // Indicators on the right, outside the meta line
  r.inds = await page.$eval(rowSel('Tres'), x=>({inMeta:!!x.querySelector('.row-meta .inds, .row-meta svg'), right:!!x.querySelector('.row-content > .inds'), after:x.querySelector('.row-content > .inds').previousElementSibling.className}));
  check('R3_indsRight', !r.inds.inMeta && r.inds.right && r.inds.after==='row-text', r.inds);
  r.voiceInd = await page.$eval(rowSel('Dos'), x=>x.querySelectorAll('.row-content > .inds svg').length);
  check('R3_voiceInd', r.voiceInd===1, r.voiceInd);
  // Single line: "Dos" has no project, the date is today: no meta line, about 52 pt
  r.oneLine = await page.$eval(rowSel('Dos'), x=>({meta:!!x.querySelector('.row-meta'), h:x.getBoundingClientRect().height}));
  check('R3_oneLine', !r.oneLine.meta && r.oneLine.h<=53, r.oneLine);
  // Capsule contrast, light theme
  const contrast = () => page.evaluate(()=>{ const parse=s=>s.match(/[\d.]+/g).slice(0,3).map(Number); const lin=u=>{ u/=255; return u<=.03928?u/12.92:Math.pow((u+.055)/1.055,2.4); }; const L=a=>.2126*lin(a[0])+.7152*lin(a[1])+.0722*lin(a[2]);
    return COLORS.map(c=>{ const el=document.createElement('div'); el.className='row'; el.setAttribute('style', tagVars(c)); el.innerHTML='<span class="tag">X</span>'; document.querySelector('.group').appendChild(el); const cs=getComputedStyle(el.querySelector('.tag')); const a=parse(cs.color), b=parse(cs.backgroundColor); el.remove(); const x=L(a), y=L(b); return {c, ratio:+((Math.max(x,y)+.05)/(Math.min(x,y)+.05)).toFixed(2), bgAlpha:(cs.backgroundColor.match(/[\d.]+/g)||[])[3]}; }); });
  r.contrastLight = await contrast();
  check('R3_contrastLight', r.contrastLight.every(o=>o.ratio>4.4&&o.bgAlpha===undefined), r.contrastLight);
  check('R3_storedColour', await page.evaluate(()=>DB.projects.find(p=>p.name==='FLC').color==='#FFCC00'));
  await page.screenshot({path:OUT+'/a-light-hoy.png'});

  // R2: hit areas
  const ck = await center(page, rowSel('Dos')+' .check');
  r.checkHit = await page.evaluate(({x,y})=>[[-20,0],[20,0],[0,-20],[0,20],[-18,-18]].map(([dx,dy])=>{ const e=document.elementFromPoint(x+dx,y+dy); return !!e&&!!e.closest('.check'); }), ck);
  check('R2_checkDrawn22', Math.round(ck.w)===22, ck);
  check('R2_checkHit44', r.checkHit.every(Boolean), r.checkHit);
  const fc = await center(page, HOY+' .first .row .check');
  r.firstHit = await page.evaluate(({x,y})=>[[-20,0],[20,0],[0,-20],[0,20]].map(([dx,dy])=>{ const e=document.elementFromPoint(x+dx,y+dy); return !!e&&!!e.closest('.check'); }), fc);
  check('R2_firstHit44', r.firstHit.every(Boolean), r.firstHit);
  r.fold = await page.$eval(HOY+' .summary-head button', b=>{ const q=b.getBoundingClientRect(); return {w:q.width,h:q.height}; });
  check('R2_fold44', r.fold.w>=44&&r.fold.h>=44, r.fold);

  // R1: a tap 18 pt off the circle (inside its 44 pt) marks the row; it stays, dimmed; the data waits
  await page.touchscreen.tap(ck.x+18, ck.y); await page.waitForTimeout(300);
  r.held1 = await page.evaluate(()=>{ const row=document.querySelector('.screen.root[data-root=tareas] .scroll .group .row[data-id="'+DB.tasks.find(x=>x.title==='Dos').id+'"]'); return {stack:UI.stack.length, held:!!row&&row.classList.contains('held'), done:!!row&&row.querySelector('.check').classList.contains('done'), status:DB.tasks.find(x=>x.title==='Dos').status, op:row&&getComputedStyle(row.querySelector('.row-text')).opacity}; });
  check('R1_heldStays', r.held1.stack===0&&r.held1.held&&r.held1.done&&r.held1.status==='pending'&&+r.held1.op<0.6, r.held1);
  await page.waitForTimeout(500);
  // A second mark (swipe right, about 1.1 s after the first) restarts the wait. CDP touch events land about 45 ms apart
  const uno = await center(page, rowSel('Uno'));
  await drag(cdp, page, uno.x-100, uno.y, 30, 0, 4, 10);
  await page.waitForTimeout(800); // about 2 s after the first mark: both still there
  r.afterReset = await page.evaluate(()=>['Dos','Uno'].map(t=>{ const x=DB.tasks.find(y=>y.title===t); const row=document.querySelector('.screen.root[data-root=tareas] .scroll .group .row[data-id="'+x.id+'"]'); return {t, status:x.status, held:!!row&&row.classList.contains('held')}; }));
  check('R1_timerRestarts', r.afterReset.every(o=>o.status==='pending'&&o.held), r.afterReset);
  // A third mark and a tap that unmarks it again
  await page.tap(rowSel('Tres')+' .check'); await page.waitForTimeout(150);
  await page.tap(rowSel('Tres')+' .row-title'); await page.waitForTimeout(150);
  r.unmarked = await page.evaluate(()=>{ const x=DB.tasks.find(y=>y.title==='Tres'); const row=document.querySelector('.screen.root[data-root=tareas] .scroll .group .row[data-id="'+x.id+'"]'); return {held:row.classList.contains('held'), done:row.querySelector('.check').classList.contains('done'), stack:UI.stack.length}; });
  check('R1_tapUnmarks', !r.unmarked.held&&!r.unmarked.done&&r.unmarked.stack===0, r.unmarked);
  await page.screenshot({path:OUT+'/a-light-held.png'});
  await page.waitForTimeout(1900);
  r.flushed = await page.evaluate(()=>({st:['Dos','Uno','Tres'].map(t=>DB.tasks.find(y=>y.title===t).status), toast:document.querySelector('#toastText').textContent, on:document.querySelector('#toast').classList.contains('on'), rows:[...document.querySelectorAll('.screen.root[data-root=tareas] .scroll .group .row:not(.done) .row-title')].map(e=>e.textContent)}));
  check('R1_flushTogether', r.flushed.st.join()==='done,done,pending' && r.flushed.toast==='2 tareas completadas' && r.flushed.on && !r.flushed.rows.includes('Dos') && !r.flushed.rows.includes('Uno'), r.flushed);
  await page.tap('#toastBtn'); await page.waitForTimeout(400);
  r.undo = await page.evaluate(()=>['Dos','Uno'].map(t=>DB.tasks.find(y=>y.title===t).status));
  check('R1_undoAll', r.undo.join()==='pending,pending', r.undo);

  // R4: a quick short flick to the right completes (marks) the row; a quick short flick left opens the buttons
  const cua = await center(page, rowSel('Cuatro'));
  await drag(cdp, page, cua.x-100, cua.y, 35, 0, 2, 5); await page.waitForTimeout(200); // 70 px, fast (under the 90 px of a slow drag)
  r.flickRight = await page.evaluate(()=>HELD.has(DB.tasks.find(y=>y.title==='Cuatro').id));
  check('R4_rowFlickRight', r.flickRight===true, r.flickRight);
  await page.waitForTimeout(1800);
  const tres = await center(page, rowSel('Tres'));
  await drag(cdp, page, tres.x, tres.y, -25, 0, 2, 5); await page.waitForTimeout(350); // 50 px, fast (under the 70 px of a slow drag)
  r.flickLeft = await page.$eval(rowSel('Tres'), x=>x.dataset.open);
  check('R4_rowFlickLeft', r.flickLeft==='1', r.flickLeft);
  await page.tap(HOY+' .nav'); await page.waitForTimeout(350);
  // A slow short drag right does nothing
  const tres2 = await center(page, rowSel('Tres'));
  await drag(cdp, page, tres2.x-100, tres2.y, 6, 0, 10, 40, 150); await page.waitForTimeout(400);
  r.slowRight = await page.evaluate(()=>({held:HELD.size, status:DB.tasks.find(y=>y.title==='Tres').status}));
  check('R4_rowSlowNoCommit', r.slowRight.held===0&&r.slowRight.status==='pending', r.slowRight);

  // R3 in Todas: the Hoy group says no "Hoy", a carried task says "Aplazada" in orange; one-line "Suelta"
  await page.tap(HOY+' .seg button[data-filter=todas]'); await page.waitForTimeout(300);
  r.todas = await page.evaluate(()=>[...document.querySelectorAll('.screen.root[data-root=tareas] .scroll .group .row')].map(x=>({t:x.querySelector('.row-title').textContent, m:(x.querySelector('.row-meta')||{}).textContent||'', orange:!!x.querySelector('.row-meta .carried')&&getComputedStyle(x.querySelector('.row-meta .carried')).color})));
  check('R3_todasHoyGroup', r.todas.every(o=>!/\bHoy\b/.test(o.m)) && !/Mañana/.test(r.todas.find(o=>o.t==='Mañana tarea').m), r.todas); // batch C: the Mañana group says it
  check('R3_aplazadaOrange', r.todas.find(o=>o.t==='Arrastrada').orange==='rgb(255, 149, 0)', r.todas.find(o=>o.t==='Arrastrada'));
  r.suelta = await page.$eval(rowSel('Suelta'), x=>({meta:!!x.querySelector('.row-meta'), h:x.getBoundingClientRect().height}));
  check('R3_oneLineNoDate', !r.suelta.meta && r.suelta.h<=53, r.suelta);
  // By project: no capsules
  await page.tap(HOY+' .nav .vopts'); await page.waitForTimeout(500); await page.evaluate(()=>[...document.querySelectorAll('#pmenu .pm-it')].find(b=>b.textContent.startsWith('Agrupar por proyecto')).click()); await page.waitForTimeout(300); // batch C: R13 view menu; batch D: anchored (#pmenu) /* batch I: menus ignore taps for 450 ms after opening (v0.14.1 guard), so the test waits 500 */
  r.byProjTags = await page.$$eval(HOY+' .scroll .group .row .tag', t=>t.length);
  check('R3_byProjectNoTag', r.byProjTags===0, r.byProjTags);
  await page.tap(HOY+' .nav .vopts'); await page.waitForTimeout(500); await page.evaluate(()=>[...document.querySelectorAll('#pmenu .pm-it')].find(b=>b.textContent.startsWith('Agrupar por fecha')).click()); await page.waitForTimeout(300); /* batch I: menus ignore taps for 450 ms after opening (v0.14.1 guard), so the test waits 500 */
  r.byDateTags = await page.$$eval(HOY+' .scroll .group .row .tag', t=>t.length);
  check('R3_byDateHasTags', r.byDateTags>0, r.byDateTags);
  // Project filter: no capsules
  await page.tap(HOY+' .pchips .chip'); await page.waitForTimeout(300);
  r.filterTags = await page.$$eval(HOY+' .scroll .group .row .tag', t=>t.length);
  check('R3_filterNoTag', r.filterTags===0, r.filterTags);
  await page.tap(HOY+' .pchips .chip.on'); await page.waitForTimeout(300);
  // Search shows them again
  await page.evaluate(()=>{ UI.query='a'; render(); }); await page.waitForTimeout(200);
  r.searchTags = await page.$$eval(HOY+' .scroll .group .row .tag', t=>t.length);
  check('R3_searchHasTag', r.searchTags>0, r.searchTags);
  await page.evaluate(()=>{ UI.query=''; render(); }); await page.waitForTimeout(200);

  // Project screen: no capsule, held completion works there too, completed by day shows the time only, not struck through
  await page.tap('.tabbar [data-tab=proyectos]'); await page.waitForTimeout(250);
  await page.tap('.screen.root[data-root=proyectos] [data-open-project]'); await page.waitForTimeout(500);
  const PR='.screen.pushed-screen.project';
  r.projTags = await page.$$eval(PR+' .row .tag', t=>t.length);
  check('R3_projectNoTag', r.projTags===0, r.projTags);
  await page.evaluate(()=>{ DB.settings.doneOpen=true; save(); render(); }); await page.waitForTimeout(300);
  r.byDay = await page.$$eval(PR+' .row.done', rs=>rs.map(x=>({m:(x.querySelector('.row-meta')||{}).textContent||'', deco:getComputedStyle(x.querySelector('.row-title')).textDecorationLine, byday:x.classList.contains('byday')})));
  check('R3_doneByDay', r.byDay.length>0 && r.byDay.every(o=>/^\d\d:\d\d$/.test(o.m)&&o.deco==='none'&&o.byday), r.byDay);
  const pfirst = PR+' .scroll .group .row:not(.done)';
  const pid = await page.$eval(pfirst, x=>x.dataset.id);
  await page.tap(pfirst+' .check'); await page.waitForTimeout(400);
  r.projHeld = await page.evaluate(id=>({held:HELD.has(id), status:task(id).status, row:!!document.querySelector('.screen.pushed-screen.project .row.held[data-id="'+id+'"]')}), pid);
  check('R1_projectHeld', r.projHeld.held&&r.projHeld.status==='pending'&&r.projHeld.row, r.projHeld);
  await page.screenshot({path:OUT+'/a-light-project.png'});
  await page.waitForTimeout(1700);
  r.projDone = await page.evaluate(id=>({status:task(id).status, toast:document.querySelector('#toastText').textContent}), pid);
  check('R1_projectFlush', r.projDone.status==='done'&&r.projDone.toast==='Tarea completada', r.projDone);

  // R4: back swipe. A quick flick from the middle of the detail goes back; a slow short drag does not; a drag that starts in a text field does not
  await page.tap(pfirst+' .row-title'); await page.waitForTimeout(600);
  r.inDetail = await page.evaluate(()=>UI.stack.map(s=>s.kind).join());
  await drag(cdp, page, 150, 600, 6, 0, 10, 50, 200); await page.waitForTimeout(500);
  r.slowBack = await page.evaluate(()=>UI.stack.map(s=>s.kind).join());
  check('R4_slowShortNoBack', r.slowBack==='project,detail', r.slowBack);
  const notes = await center(page, '.screen.pushed-screen.detail textarea[data-role=notes]');
  await drag(cdp, page, notes.x-60, notes.y, 20, 0, 6, 16); await page.waitForTimeout(500);
  r.fieldBack = await page.evaluate(()=>UI.stack.map(s=>s.kind).join());
  check('R4_fieldNoBack', r.fieldBack==='project,detail', r.fieldBack);
  // Mid drag: the detail follows the finger from the middle of the screen
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:150,y:600}]});
  for(let i=1;i<=6;i++){ await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:150+i*10,y:600}]}); await page.waitForTimeout(30); }
  r.midBack = await page.$eval('.screen.pushed-screen.detail', e=>e.style.transform);
  check('R4_detailFollows', /translate3d\((4|5|6)\dpx/.test(r.midBack), r.midBack);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:240,y:600}]}); await page.waitForTimeout(5);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:270,y:600}]}); await page.waitForTimeout(5); // 120 px in all: under a third of the width, released fast
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]}); await page.waitForTimeout(650); /* batch I: v0.14.5 pop takes 520 ms (navLock) */
  r.flickBack = await page.evaluate(()=>UI.stack.map(s=>s.kind).join());
  check('R4_flickBack', r.flickBack==='project', r.flickBack);
  // The project screen keeps the edge-only back swipe (its rows have their own gestures); a flick from the edge goes back
  await drag(cdp, page, 10, 500, 40, 0, 2, 5); await page.waitForTimeout(650); // 80 px, fast (batch I: 650 ms, the v0.14.5 pop)
  r.edgeFlick = await page.evaluate(()=>UI.stack.length);
  check('R4_edgeFlickBack', r.edgeFlick===0, r.edgeFlick);

  // R4: sheets. While dragged, the dimming and the screen behind follow; a slow short drag stays open; a quick flick closes
  await page.tap('.tabbar [data-tab=tareas]'); await page.waitForTimeout(300);
  await page.tap(HOY+' .fab'); await page.evaluate(()=>document.activeElement&&document.activeElement.blur()); await page.waitForTimeout(500); // batch I: headless Chromium reports no keyboard, so with the field focused v0.14.2 kbFallback would move the sheet to the top (no handle) after 1.2 s
  const hd = await center(page, '#sheet .handle');
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:hd.x,y:hd.y}]});
  for(let i=1;i<=8;i++){ await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:hd.x,y:hd.y+i*10}]}); await page.waitForTimeout(40); }
  r.sheetMid = await page.evaluate(()=>({scrim:+document.querySelector('#scrim').style.opacity, app:document.querySelector('#app').style.transform}));
  await page.waitForTimeout(200); await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]}); await page.waitForTimeout(600); /* batch I: the sheet settles in 0.5 s (v0.14.5) */
  r.sheetAfterSlow = await page.evaluate(()=>({on:document.querySelector('#sheet').classList.contains('on'), scrim:document.querySelector('#scrim').style.opacity, app:document.querySelector('#app').style.transform}));
  check('R4_sheetFollows', r.sheetMid.scrim>0 && r.sheetMid.scrim<0.95 && /scale\(0\.9[6-9]/.test(r.sheetMid.app), r.sheetMid);
  check('R4_sheetSlowStays', r.sheetAfterSlow.on && r.sheetAfterSlow.scrim==='' && r.sheetAfterSlow.app==='', r.sheetAfterSlow);
  const hd2 = await center(page, '#sheet .handle');
  await drag(cdp, page, hd2.x, hd2.y, 0, 35, 2, 5); await page.waitForTimeout(450); // 70 px, fast (under the 110 px of a slow drag)
  r.sheetFlick = await page.evaluate(()=>document.querySelector('#sheet').classList.contains('on'));
  check('R4_sheetFlickCloses', r.sheetFlick===false, r.sheetFlick);

  // R2: the selection box takes 44 pt too
  await page.evaluate(()=>{ DB.settings.filter='todas'; save(); startSelect(); }); await page.waitForTimeout(300);
  const sb = await center(page, HOY+' .row .selbox');
  r.selHit = await page.evaluate(({x,y})=>[[-20,0],[20,0],[0,-20],[0,20]].map(([dx,dy])=>{ const e=document.elementFromPoint(x+dx,y+dy); return !!e&&!!e.closest('.selbox'); }), sb);
  check('R2_selbox44', r.selHit.every(Boolean)&&Math.round(sb.w)===22, {hit:r.selHit, w:sb.w});
  await page.evaluate(()=>{ endSelect(); DB.settings.filter='hoy'; save(); render(); });
  r.errorsLight = errors.slice();
  await ctx.close();

  /* ---------- Mobile, dark: capsule contrast and a look ---------- */
  ({ctx, page, cdp, errors} = await mobile(browser, 'dark'));
  await page.evaluate(()=>{ const t=todayStr(); COLORS.forEach((c,i)=>{ const p=addProject('Proyecto '+i, c); addTask({title:'Tarea '+i, date:i%2?t:addDays(t,i), projectId:p.id, notes:i===2?'n':''}); }); addTask({title:'Aplazada vieja', date:t, carried:true}); DB.settings.filter='todas'; save(); render(); });
  await page.waitForTimeout(300);
  r.contrastDark = await contrast();
  check('R3_contrastDark', r.contrastDark.every(o=>o.ratio>4.4&&o.bgAlpha===undefined), r.contrastDark);
  await page.screenshot({path:OUT+'/a-dark-todas.png'});
  await page.evaluate(()=>{ DB.settings.theme='light'; save(); applyTheme(); render(); }); await page.waitForTimeout(200);
  r.contrastForcedLight = await contrast();
  check('R3_contrastForcedLight', r.contrastForcedLight.every(o=>o.ratio>4.4), r.contrastForcedLight);
  await page.screenshot({path:OUT+'/a-light-todas.png'});
  r.errorsDark = errors.slice();
  await ctx.close();

  /* ---------- Desktop ---------- */
  const dctx = await browser.newContext({ viewport:{width:1280,height:800}, deviceScaleFactor:1 });
  const dp = await dctx.newPage(); await dp.addInitScript(s=>{ if(!localStorage.getItem('tareas-v1')) localStorage.setItem('tareas-v1', s); }, SEED);
  const derr=[]; dp.on('pageerror', e=>derr.push(e.message)); dp.on('console', m=>{ if(m.type()==='error') derr.push(m.text()); });
  await dp.goto(URL); await dp.waitForTimeout(500);
  await dp.evaluate(()=>{ const t=todayStr(); const p=addProject('FLC','#FF9500'); ['A','B','C'].forEach(n=>addTask({title:'Tarea '+n, date:t, projectId:p.id})); render(); }); await dp.waitForTimeout(300);
  const drow = n => '#desk .main .group .row:has(.row-title:text-is("Tarea '+n+'"))';
  await dp.click(drow('A')+' .check'); await dp.waitForTimeout(500); await dp.click(drow('B')+' .check'); await dp.waitForTimeout(400);
  r.deskHeld = await dp.evaluate(()=>({held:[...document.querySelectorAll('#desk .row.held')].length, pending:DB.tasks.filter(x=>x.status==='pending').length}));
  check('R1_deskHeld', r.deskHeld.held===2&&r.deskHeld.pending===3, r.deskHeld);
  await dp.screenshot({path:OUT+'/a-desk-held.png'});
  await dp.waitForTimeout(1700);
  r.deskFlush = await dp.evaluate(()=>({pending:DB.tasks.filter(x=>x.status==='pending').length, toast:document.querySelector('#toastText').textContent, rows:document.querySelectorAll('#desk .main .scroll .group .row:not(.done), #desk .main .group .row:not(.done)').length}));
  check('R1_deskFlush', r.deskFlush.pending===1&&r.deskFlush.toast==='2 tareas completadas', r.deskFlush);
  r.deskNoHoy = await dp.$$eval('#desk .main .group .row:not(.done) .row-meta', ms=>ms.map(m=>m.textContent));
  check('R3_deskNoHoy', r.deskNoHoy.every(m=>!/\bHoy\b/.test(m)), r.deskNoHoy);
  // A click on a marked row unmarks it instead of opening the pane
  await dp.click(drow('C')+' .check'); await dp.waitForTimeout(200); await dp.click(drow('C')+' .row-title'); await dp.waitForTimeout(300);
  r.deskUnmark = await dp.evaluate(()=>({held:HELD.size, pane:UI.deskDetail}));
  check('R1_deskTapUnmarks', r.deskUnmark.held===0&&!r.deskUnmark.pane, r.deskUnmark);
  r.errorsDesk = derr.slice();
  await dctx.close();

  r.errors = [...r.errorsLight, ...r.errorsDark, ...r.errorsDesk, ...fails.map(f=>'check failed: '+f)];
  console.log(JSON.stringify(r,null,1));
  await browser.close(); srv.close(); process.exit(r.errors.length?1:0);
})().catch(e=>{ console.error(e); console.log(JSON.stringify(r,null,1)); console.log('FAILS', fails); process.exit(1); });
