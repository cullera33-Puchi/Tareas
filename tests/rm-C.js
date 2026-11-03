require('./lib/out.js'); // outputs (screenshots, downloads) go to tests/out
// Roadmap batch C: R8 (close the day), R9 (review the carried tasks), R13 (view options, Hoy by project), R14 (Todas day by day, sticky headers, calendar load)
const { chromium } = require('playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = path.resolve(__dirname, '..'); const OUT = path.join(__dirname, 'out', 'C'); fs.mkdirSync(OUT, {recursive:true});
const TYPES = {'.html':'text/html','.css':'text/css','.js':'application/javascript','.webmanifest':'application/manifest+json','.png':'image/png'};
const srv = http.createServer((req,res)=>{ let p = decodeURIComponent(req.url.split('?')[0]); if(p==='/') p='/index.html'; const f=path.join(ROOT,p); if(!fs.existsSync(f)){res.writeHead(404);res.end();return;} res.writeHead(200,{'Content-Type':TYPES[path.extname(f)]||'application/octet-stream'}); res.end(fs.readFileSync(f)); });
const PORT=9303, URL='http://localhost:'+PORT+'/';
const SEED = JSON.stringify({spaces:[{id:'trabajo',name:'Trabajo',order:0},{id:'personal',name:'Personal',order:1}],projects:[],tasks:[],voiceNotes:[],settings:{tipsSeen:true}});
const r={}, fails=[]; const check=(name, ok, info)=>{ r[name]=ok?true:(info===undefined?false:info); if(!ok) fails.push(name); };
const HOY='.screen.root[data-root=tareas]';

async function open(browser, opts){
  const ctx = await browser.newContext(Object.assign({ viewport:{width:390,height:844}, deviceScaleFactor:2, isMobile:true, hasTouch:true, colorScheme:'light' }, opts||{}));
  const page = await ctx.newPage(); await page.addInitScript(s=>{ if(!localStorage.getItem('tareas-v1')) localStorage.setItem('tareas-v1', s); }, SEED);
  const errors=[]; page.on('pageerror', e=>errors.push(e.message)); page.on('console', m=>{ if(m.type()==='error') errors.push(m.text()); });
  await page.goto(URL); await page.waitForTimeout(400);
  return {ctx, page, errors, cdp: opts&&opts.isMobile===false ? null : await ctx.newCDPSession(page)};
}
// The fixture: today, carried, tomorrow, days within two weeks, later months, no date, one done today, and a calendar load of 1, 3 and 6
const FIXTURE = ()=>{ const t=todayStr(); const p=addProject('FLC','#FFCC00'), q=addProject('Casa','#34C759');
  addTask({title:'Uno',date:t,projectId:p.id}); addTask({title:'Dos',date:t}); addTask({title:'Prioritaria',date:t,priority:'high',projectId:p.id});
  addTask({title:'Arrastrada FLC',date:t,carried:true,projectId:p.id}); addTask({title:'Arrastrada suelta',date:t,carried:true});
  addTask({title:'Mañana tarea',date:addDays(t,1),projectId:q.id});
  addTask({title:'Dia2',date:addDays(t,2)}); ['A','B','C'].forEach(n=>addTask({title:'Dia4 '+n,date:addDays(t,4),projectId:p.id})); [1,2,3,4,5,6].forEach(n=>addTask({title:'Dia5 '+n,date:addDays(t,5)}));
  addTask({title:'Dia10',date:addDays(t,10)}); addTask({title:'Dia20',date:addDays(t,20)}); addTask({title:'Dia60',date:addDays(t,60)});
  addTask({title:'Suelta 1'}); addTask({title:'Suelta 2',projectId:q.id});
  const d=addTask({title:'Hecha hoy',projectId:p.id}); d.status='done'; d.completed=new Date().toISOString(); save(); render(); };
// Updated by batch D (R10): on the iPhone these menus are anchored (#pmenu), with no Cancelar; a checked option reads "label  ✓" here, as it did in the sheet
const sheetItems = page => page.evaluate(()=>{ const pm=[...document.querySelectorAll('#pmenu .pm-it')]; if(pm.length) return pm.map(x=>x.querySelector('.pm-l').firstChild.textContent+(x.querySelector('.pm-ck svg')?'  ✓':'')); return [...document.querySelectorAll('#asheet .it')].map(x=>x.textContent.trim()); });
const clickItem = async (page, text) => { await page.waitForFunction(()=>typeof menuFresh!=='function'||!menuFresh()); /* batch I: a tap-opened menu ignores taps for 450 ms (v0.14.1 guard) */ await page.evaluate(t=>{ const b=[...document.querySelectorAll(document.querySelector('#pmenu .pm-it')?'#pmenu .pm-it':'#asheet .it')].find(x=>x.textContent.trim().startsWith(t)); if(!b) throw new Error('no item '+t); b.click(); }, text); await page.waitForTimeout(350); };
async function longPress(cdp, page, x, y){ await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]}); await page.waitForTimeout(650); await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]}); await page.waitForTimeout(350); }
// The clock at 19:30 today (as four.js does); restore() gives the real one back
const at1930 = page => page.evaluate(()=>{ window.__RD=window.__RD||Date; const RD=window.__RD; const fixed=new RD(); fixed.setHours(19,30,0,0); window.Date=class extends RD{ constructor(...a){ super(...(a.length?a:[fixed.getTime()])); } static now(){ return fixed.getTime(); } }; render(); });
const realClock = page => page.evaluate(()=>{ if(window.__RD) window.Date=window.__RD; render(); });

(async()=>{
  await new Promise(res=>srv.listen(PORT,res));
  const browser = await chromium.launch();

  /* ---------- Mobile, light ---------- */
  let {ctx, page, cdp, errors} = await open(browser);
  await page.evaluate(FIXTURE); await page.waitForTimeout(300);

  // R13: three dots on the right of the bar; the second segment is gone
  r.vopts = await page.$eval(HOY+' .nav .vopts', b=>{ const q=b.getBoundingClientRect(); return {right:Math.round(innerWidth-q.right), w:q.width, h:q.height}; }).catch(()=>null);
  check('R13_button', !!r.vopts && r.vopts.right<=20 && r.vopts.w>=44 && r.vopts.h>=44, r.vopts);
  await page.tap(HOY+' .seg button[data-filter=todas]'); await page.waitForTimeout(300);
  check('R13_noMiniSeg', !(await page.$(HOY+' .seg.mini')) && !(await page.$('[data-group]')));
  await page.tap(HOY+' .seg button[data-filter=hoy]'); await page.waitForTimeout(300);
  await page.tap(HOY+' .nav .vopts'); await page.waitForTimeout(350);
  r.menuHoy = await sheetItems(page);
  check('R13_menuHoy', JSON.stringify(r.menuHoy.slice(0,4))===JSON.stringify(['Seleccionar tareas','Mostrar completadas','Agrupar por fecha  ✓','Agrupar por proyecto']) && r.menuHoy.length===4, r.menuHoy); // decision 52: no Mostrar resumen del día
  // Hoy by project
  await clickItem(page, 'Agrupar por proyecto');
  r.hoyByProj = await page.evaluate(()=>{ const sc=document.querySelector('.screen.root[data-root=tareas] .scroll'); return {settings:[DB.settings.hoyGroup, DB.settings.allGroup],
    heads:[...sc.querySelectorAll('.gsec > .group-title')].map(h=>({pf:h.dataset.pf, text:h.textContent.trim(), dot:(h.querySelector('.gdot')||{}).style&&h.querySelector('.gdot').style.background})),
    carried:[...sc.querySelectorAll('.gsec .row')].filter(x=>/Arrastrada/.test(x.textContent)).map(x=>(x.querySelector('.row-meta .carried')||{}).textContent||''), tags:sc.querySelectorAll('.gsec .row .tag').length,
    hoyWord:[...sc.querySelectorAll('.gsec .row .row-meta')].some(m=>/\bHoy\b/.test(m.textContent)) }; });
  check('R13_hoyByProject', r.hoyByProj.settings[0]==='project' && r.hoyByProj.settings[1]==='date' && r.hoyByProj.heads.length===2 && /^FLC\s*3/.test(r.hoyByProj.heads[0].text) && /^Sin proyecto\s*2/.test(r.hoyByProj.heads[1].text) && r.hoyByProj.heads[1].pf==='none', r.hoyByProj);
  check('R13_hoyByProjectRows', r.hoyByProj.carried.length===2 && r.hoyByProj.carried.every(c=>c==='Aplazada') && r.hoyByProj.tags===0 && !r.hoyByProj.hoyWord, r.hoyByProj);
  await page.screenshot({path:OUT+'/c-light-hoy-proyecto.png'});
  // Tapping a group header filters by its project; a second tap clears it
  await page.tap(HOY+' .gsec > .group-title[data-pf]:not([data-pf=none])'); await page.waitForTimeout(300);
  r.headFilter = await page.evaluate(()=>({pf:UI.projFilter===DB.projects.find(p=>p.name==='FLC').id, heads:document.querySelectorAll('.screen.root[data-root=tareas] .gsec').length, rows:[...document.querySelectorAll('.screen.root[data-root=tareas] .gsec .row-title')].map(x=>x.textContent)}));
  check('R13_headFilters', r.headFilter.pf && r.headFilter.heads===1 && r.headFilter.rows.length===3, r.headFilter);
  await page.tap(HOY+' .gsec > .group-title[data-pf]'); await page.waitForTimeout(300);
  check('R13_headUnfilters', await page.evaluate(()=>UI.projFilter===null));
  // Back to by date; Todas keeps its own setting
  await page.tap(HOY+' .nav .vopts'); await page.waitForTimeout(350); await clickItem(page, 'Agrupar por fecha');
  check('R13_backToDate', await page.evaluate(()=>DB.settings.hoyGroup==='date' && !!document.querySelector('.screen.root[data-root=tareas] [data-act=review]')));
  // Mostrar completadas from the menu
  await page.tap(HOY+' .nav .vopts'); await page.waitForTimeout(350); await clickItem(page, 'Mostrar completadas');
  r.doneShown = await page.evaluate(()=>({open:DB.settings.doneOpen, gsec:[...document.querySelectorAll('.screen.root[data-root=tareas] .gsec > .group-title')].map(h=>h.textContent.trim())}));
  check('R13_showDone', r.doneShown.open && r.doneShown.gsec.some(t=>/^Hoy\s*1$/.test(t)), r.doneShown);
  await page.tap(HOY+' .nav .vopts'); await page.waitForTimeout(350); r.menuHoy2 = await sheetItems(page); await clickItem(page, 'Ocultar completadas');
  check('R13_hideDone', r.menuHoy2[1]==='Ocultar completadas' && await page.evaluate(()=>!DB.settings.doneOpen), r.menuHoy2);
  // Seleccionar tareas: selection mode without a long press
  await page.tap(HOY+' .nav .vopts'); await page.waitForTimeout(350); await clickItem(page, 'Seleccionar tareas');
  r.sel = await page.evaluate(()=>({selecting:document.querySelector('#app').classList.contains('selecting'), n:UI.select&&UI.select.ids.size, title:(document.querySelector('#selTitle')||{}).textContent, review:!!document.querySelector('.screen.root[data-root=tareas] [data-act=review]')}));
  check('R13_select', r.sel.selecting && r.sel.n===0 && r.sel.title==='Seleccionar' && !r.sel.review, r.sel);
  await page.tap(HOY+' [data-act=selDone]'); await page.waitForTimeout(300);
  // Decision 52: no day summary on Hoy and nothing to fold
  check('R13_noSummary', await page.evaluate(H=>!document.querySelector(H+' .summary') && !document.querySelector(H+' [data-sum]'), HOY));

  // R9: Repasar (N) on the Aplazadas group
  r.reviewLink = await page.$eval(HOY+' [data-act=review]', e=>({text:e.textContent, head:e.closest('.group-title').textContent}));
  check('R9_link', r.reviewLink.text==='Repasar (2)' && /^Aplazadas/.test(r.reviewLink.head), r.reviewLink);
  await page.tap(HOY+' [data-act=review]'); await page.waitForTimeout(400);
  r.walk1 = await page.evaluate(()=>({h:document.querySelector('#sheet h2').textContent, hint:document.querySelector('#sheet .hint').textContent, title:document.querySelector('#sheet .plan-title').textContent, chips:[...document.querySelectorAll('#sheet [data-rv]')].map(b=>b.textContent), btns:[...document.querySelectorAll('#sheet [data-x]')].map(b=>b.textContent)}));
  check('R9_walk', r.walk1.h==='Repasar aplazadas' && /^1 de 2/.test(r.walk1.hint) && r.walk1.chips[0]==='Hoy' && r.walk1.chips.includes('Mañana') && r.walk1.chips[r.walk1.chips.length-1]==='Sin fecha' && JSON.stringify(r.walk1.btns)===JSON.stringify(['Completar','Eliminar','Saltar','Terminar']), r.walk1);
  await page.screenshot({path:OUT+'/c-light-repasar.png'});
  await page.tap('#sheet [data-rv=hoy]'); await page.waitForTimeout(300);
  r.afterHoy = await page.evaluate(t=>{ const x=DB.tasks.find(y=>y.title===t); return {date:x.date===todayStr(), carried:x.carried, hint:document.querySelector('#sheet .hint').textContent}; }, r.walk1.title);
  check('R9_hoyClearsCarried', r.afterHoy.date && r.afterHoy.carried===false && /^2 de 2/.test(r.afterHoy.hint), r.afterHoy);
  const second = await page.$eval('#sheet .plan-title', e=>e.textContent);
  await page.tap('#sheet [data-rv=man]'); await page.waitForTimeout(400);
  r.balance = await page.evaluate(()=>({h:document.querySelector('#sheet h2').textContent, cells:[...document.querySelectorAll('#sheet .list .cell')].map(c=>c.textContent), foot:document.querySelector('#sheet .cdfoot').textContent}));
  check('R9_balance', r.balance.h==='Repaso terminado' && r.balance.cells.join('|')==='Para hoy1|A mañana1' && /^Mañana empieza con 2 tareas\.$/.test(r.balance.foot), r.balance);
  await page.screenshot({path:OUT+'/c-light-balance.png'});
  await page.tap('#sheet [data-x=undo]'); await page.waitForTimeout(400);
  r.undone = await page.evaluate(ts=>ts.map(t=>{ const x=DB.tasks.find(y=>y.title===t); return x.date===todayStr()&&x.carried===true; }), [r.walk1.title, second]);
  check('R9_undoAll', r.undone.every(Boolean) && await page.evaluate(()=>!document.querySelector('#sheet').classList.contains('on')), r.undone);
  // Completar and Eliminar, then one Deshacer for both
  await page.tap(HOY+' [data-act=review]'); await page.waitForTimeout(400);
  await page.tap('#sheet [data-x=done]'); await page.waitForTimeout(300); await page.tap('#sheet [data-x=del]'); await page.waitForTimeout(400);
  r.balance2 = await page.evaluate(ts=>({cells:[...document.querySelectorAll('#sheet .list .cell')].map(c=>c.textContent), a:(DB.tasks.find(y=>y.title===ts[0])||{}).status, b:!!DB.tasks.find(y=>y.title===ts[1]), carriedLeft:pendingFor('hoy').filter(x=>x.carried).length}), [r.walk1.title, second]);
  check('R9_completeDelete', r.balance2.cells.join('|')==='Completadas1|Eliminadas1' && r.balance2.a==='done' && !r.balance2.b && r.balance2.carriedLeft===0, r.balance2);
  await page.tap('#sheet [data-x=undo]'); await page.waitForTimeout(400);
  r.undone2 = await page.evaluate(ts=>ts.map(t=>{ const x=DB.tasks.find(y=>y.title===t); return !!x&&x.status==='pending'&&x.carried===true&&x.date===todayStr(); }), [r.walk1.title, second]);
  check('R9_undoCompleteDelete', r.undone2.every(Boolean), r.undone2);
  // Closed with a tap outside: the balance comes as a toast with Deshacer
  await page.tap(HOY+' [data-act=review]'); await page.waitForTimeout(400);
  const vie = await page.$('#sheet [data-rv=vie]'); await page.tap(vie?'#sheet [data-rv=vie]':'#sheet [data-rv=nsem]'); await page.waitForTimeout(500); // batch I: each step opens its sheet again; the scrim ignores taps for 450 ms (v0.14.1)
  await page.evaluate(()=>document.querySelector('#scrim').click()); await page.waitForTimeout(400);
  r.toastBal = await page.evaluate(()=>({text:document.querySelector('#toastText').textContent, btn:getComputedStyle(document.querySelector('#toastBtn')).display!=='none', sheet:document.querySelector('#sheet').classList.contains('on')}));
  check('R9_dismissToast', /^1 (al viernes|a la próxima semana), 1 saltada$/.test(r.toastBal.text) && r.toastBal.btn && !r.toastBal.sheet, r.toastBal);
  await page.tap('#toastBtn'); await page.waitForTimeout(300);
  check('R9_dismissUndo', await page.evaluate(()=>pendingFor('hoy').filter(x=>x.carried).length===2));
  // Terminar at once: nothing decided, no balance
  await page.tap(HOY+' [data-act=review]'); await page.waitForTimeout(400); await page.tap('#sheet [data-x=end]'); await page.waitForTimeout(400);
  check('R9_endNothing', await page.evaluate(()=>!document.querySelector('#sheet').classList.contains('on') && pendingFor('hoy').filter(x=>x.carried).length===2));
  // No new data field
  check('R9_noNewField', await page.evaluate(()=>DB.tasks.every(x=>Object.keys(x).every(k=>['id','title','spaceId','projectId','date','reminder','priority','status','notes','carried','created','modified','completed'].includes(k)))));

  // R8: before 19:00 nothing new; at 19:30 the cell at the end of Hoy (decision 52: the only entry)
  await page.evaluate(()=>{ window.__RD=Date; const RD=Date; const fixed=new RD(); fixed.setHours(12,0,0,0); window.Date=class extends RD{ constructor(...a){ super(...(a.length?a:[fixed.getTime()])); } static now(){ return fixed.getTime(); } }; render(); });
  check('R8_notBefore19', await page.evaluate(()=>!document.querySelector('.screen.root[data-root=tareas] [data-act=closeDay]')));
  await at1930(page);
  await page.evaluate(()=>render()); await page.waitForTimeout(200);
  r.r8 = await page.evaluate(()=>{ const sc=document.querySelector('.screen.root[data-root=tareas] .scroll'); const cell=sc.querySelector('.closecell'); const all=[...sc.children]; return {summary:!!sc.querySelector('.summary'), entries:sc.querySelectorAll('[data-act=closeDay]').length, cell:cell&&cell.textContent, cellAfterRows:!!cell&&all.indexOf(cell.closest('.group'))>all.indexOf([...sc.querySelectorAll('.scroll > .group')].find(g=>g.querySelector('.row'))) }; });
  check('R8_entries', !r.r8.summary && r.r8.entries===1 && /^Cerrar el día5 pendientes$/.test(r.r8.cell) && r.r8.cellAfterRows, r.r8);
  await page.screenshot({path:OUT+'/c-light-hoy-1930.png'});
  await page.evaluate(H=>document.querySelector(H+' .closecell').scrollIntoView({block:'center'}), HOY); await page.tap(HOY+' .closecell'); await page.waitForTimeout(400);
  r.cd = await page.evaluate(()=>({h:document.querySelector('#sheet h2').textContent, nums:[...document.querySelectorAll('#sheet .cdnums div')].map(d=>d.textContent), left:document.querySelectorAll('#sheet .cdlist:not(.done) .pl').length, done:[...document.querySelectorAll('#sheet .cdlist.done .pl')].map(x=>x.textContent), acts:[...document.querySelectorAll('#sheet [data-cd]')].map(b=>b.textContent), foot:document.querySelector('#sheet .cdfoot').textContent}));
  check('R8_sheet', r.cd.h==='Cerrar el día' && r.cd.nums.join('|')==='1hecha hoy|5quedan|1prioritarias' && r.cd.left===5 && r.cd.done.join()==='Hecha hoy' && r.cd.acts.join('|')==='Todo a mañana5 tareas|Solo las no prioritarias4 tareas|Decidir una a una' && r.cd.foot==='Mañana empieza con 1 tarea.', r.cd);
  await page.screenshot({path:OUT+'/c-light-cerrar.png'});
  await page.tap('#sheet [data-cd=rest]'); await page.waitForTimeout(500);
  r.cdRest = await page.evaluate(()=>({hoy:pendingFor('hoy').map(x=>x.title), toast:document.querySelector('#toastText').textContent, tm:DB.tasks.filter(x=>x.date===addDays(todayStr(),1)).length}));
  check('R8_rest', r.cdRest.hoy.join()==='Prioritaria' && r.cdRest.tm===5 && r.cdRest.toast==='4 tareas pasadas a mañana', r.cdRest);
  await page.tap('#toastBtn'); await page.waitForTimeout(300);
  check('R8_restUndo', await page.evaluate(()=>pendingFor('hoy').length===5 && pendingFor('hoy').filter(x=>x.carried).length===2));
  // One by one from the cell at the end of Hoy
  await page.$eval(HOY+' .closecell', e=>e.scrollIntoView()); await page.tap(HOY+' .closecell'); await page.waitForTimeout(400); await page.tap('#sheet [data-cd=one]'); await page.waitForTimeout(400);
  r.cdOne = await page.evaluate(()=>({h:document.querySelector('#sheet h2').textContent, hint:document.querySelector('#sheet .hint').textContent}));
  check('R8_oneByOne', r.cdOne.h==='Cerrar el día' && /^1 de 5/.test(r.cdOne.hint), r.cdOne);
  for(let i=0;i<5;i++){ await page.tap('#sheet [data-rv=man]'); await page.waitForTimeout(250); }
  r.cdOneEnd = await page.evaluate(()=>({h:document.querySelector('#sheet h2').textContent, cells:[...document.querySelectorAll('#sheet .list .cell')].map(c=>c.textContent), foot:document.querySelector('#sheet .cdfoot').textContent, hoy:pendingFor('hoy').length}));
  check('R8_oneByOneBalance', r.cdOneEnd.h==='Día cerrado' && r.cdOneEnd.cells.join()==='A mañana5' && r.cdOneEnd.foot==='Mañana empieza con 6 tareas, 1 prioritaria.' && r.cdOneEnd.hoy===0, r.cdOneEnd);
  await page.tap('#sheet [data-x=undo]'); await page.waitForTimeout(400);
  check('R8_oneByOneUndo', await page.evaluate(()=>pendingFor('hoy').length===5 && pendingFor('hoy').filter(x=>x.carried).length===2));
  await realClock(page);

  // R14: Todas day by day
  await page.tap(HOY+' .seg button[data-filter=todas]'); await page.waitForTimeout(300);
  r.todas = await page.evaluate(()=>{ const t=todayStr(); const sc=document.querySelector('.screen.root[data-root=tareas] .scroll');
    const heads=[...sc.querySelectorAll('.gsec > .group-title')].map(h=>({gl:h.querySelector('.gl').textContent.trim(), day:h.dataset.dayHead||null, add:(h.querySelector('.gadd')||{}).dataset&&h.querySelector('.gadd').dataset.addDate, plan:(h.querySelector('[data-act=plan]')||{}).textContent||null, sticky:getComputedStyle(h).position}));
    const exp=[['Hoy',5],['Mañana',1],[dayTitle(addDays(t,2)),1],[dayTitle(addDays(t,4)),3],[dayTitle(addDays(t,5)),6],[dayTitle(addDays(t,10)),1]];
    const m20=monthTitle(addDays(t,20).slice(0,7)), m60=monthTitle(addDays(t,60).slice(0,7));
    const mrow=[...sc.querySelectorAll('.gsec .row')].find(x=>x.querySelector('.row-title').textContent==='Mañana tarea'), drow=[...sc.querySelectorAll('.gsec .row')].find(x=>x.querySelector('.row-title').textContent==='Dia20');
    return {heads, exp:exp.map(e=>e[0]+e[1]).concat(m20===m60?[m20+'2']:[m20+'1', m60+'1']).concat(['Sin fecha']), mMeta:(mrow.querySelector('.row-meta')||{}).textContent||'', d20Meta:(drow.querySelector('.row-meta')||{}).textContent||''}; });
  check('R14_groups', JSON.stringify(r.todas.heads.map(h=>h.gl))===JSON.stringify(r.todas.exp), {got:r.todas.heads.map(h=>h.gl), exp:r.todas.exp});
  check('R14_dayHeads', r.todas.heads.slice(0,6).every(h=>h.day&&h.add===h.day) && r.todas.heads.slice(6).every(h=>!h.day&&!h.add) && r.todas.heads[r.todas.heads.length-1].plan==='Planificar (2)', r.todas.heads);
  check('R14_sticky', r.todas.heads.every(h=>h.sticky==='sticky'), r.todas.heads.map(h=>h.sticky));
  check('R14_rowNoDateInDayGroup', !/Mañana/.test(r.todas.mMeta) && /\d/.test(r.todas.d20Meta), r.todas);
  await page.screenshot({path:OUT+'/c-light-todas.png'});
  // The + of a day header adds with that date
  const d4 = await page.evaluate(()=>addDays(todayStr(),4));
  await page.$eval(HOY+' .gadd[data-add-date="'+d4+'"]', e=>e.closest('.gsec').scrollIntoView()); await page.waitForTimeout(150);
  await page.tap(HOY+' .gadd[data-add-date="'+d4+'"]'); await page.waitForTimeout(400);
  await page.keyboard.type('Nueva del día'); await page.keyboard.press('Enter'); await page.waitForTimeout(200); await page.evaluate(()=>closeSheet()); await page.waitForTimeout(400);
  check('R14_addWithDate', await page.evaluate(d=>{ const x=DB.tasks.find(y=>y.title==='Nueva del día'); return !!x&&x.date===d&&!x.projectId; }, d4));
  // Long press on that day header: "Mover estas 4" to tomorrow, with Deshacer
  await page.$eval(HOY+' [data-day-head="'+d4+'"]', e=>e.closest('.gsec').scrollIntoView()); await page.waitForTimeout(200);
  const hb = await page.$eval(HOY+' [data-day-head="'+d4+'"] .gl', e=>{ const q=e.getBoundingClientRect(); return {x:q.x+20, y:q.y+q.height/2}; });
  await longPress(cdp, page, hb.x, hb.y);
  r.dayMenu = await sheetItems(page);
  check('R14_longPressMenu', r.dayMenu[0]==='Mover estas 4', r.dayMenu);
  await clickItem(page, 'Mover estas');
  r.moveSheet = await page.evaluate(()=>({h:document.querySelector('#sheet h2').textContent, chips:[...document.querySelectorAll('#sheet .chips [data-d]')].map(b=>b.textContent), cal:!!document.querySelector('#sheet .cal')}));
  check('R14_moveSheet', r.moveSheet.h==='Mover 4 tareas' && r.moveSheet.chips[0]==='Hoy' && r.moveSheet.chips.includes('Sin fecha') && r.moveSheet.cal, r.moveSheet);
  await page.tap('#sheet .chips [data-d]:nth-child(2)'); await page.waitForTimeout(500);
  r.moved = await page.evaluate(d=>({left:DB.tasks.filter(x=>x.date===d).length, tm:DB.tasks.filter(x=>x.date===addDays(todayStr(),1)).length, toast:document.querySelector('#toastText').textContent}), d4);
  check('R14_moved', r.moved.left===0 && r.moved.tm===5 && r.moved.toast==='4 tareas pasadas a mañana', r.moved);
  await page.tap('#toastBtn'); await page.waitForTimeout(400);
  check('R14_moveUndo', await page.evaluate(d=>DB.tasks.filter(x=>x.date===d).length===4, d4));
  // Calendar load: 1, 3 and 6 tasks give one, two and three dots
  await page.evaluate(()=>dateSheet(DB.tasks.find(x=>x.title==='Suelta 1').id)); await page.waitForTimeout(400);
  r.dots = await page.evaluate(()=>{ const t=todayStr(); const n=d=>{ const c=document.querySelector('#sheet .cal-d[data-d="'+d+'"]'); return c?c.querySelectorAll('i b').length:null; }; return [n(addDays(t,2)), n(addDays(t,4)), n(addDays(t,5)), n(addDays(t,3)), n(t)]; });
  // the days may fall in next month's page: then they are missing from this one (null), which is not a failure
  check('R14_calendarDots', (r.dots[0]===null||r.dots[0]===1) && (r.dots[1]===null||r.dots[1]===2) && (r.dots[2]===null||r.dots[2]===3) && (r.dots[3]===null||r.dots[3]===0) && r.dots[4]===2, r.dots);
  await page.screenshot({path:OUT+'/c-light-calendar.png'});
  await page.evaluate(()=>closeSheet()); await page.waitForTimeout(400);
  // A project screen: sticky day headers, and its + adds to that project
  await page.tap('.tabbar [data-tab=proyectos]'); await page.waitForTimeout(300);
  await page.tap('.screen.root[data-root=proyectos] [data-open-project]'); await page.waitForTimeout(600);
  r.proj = await page.evaluate(()=>{ const s=document.querySelector('.screen.pushed-screen.project'); return {heads:[...s.querySelectorAll('.gsec > .group-title')].map(h=>h.querySelector('.gl').textContent.trim()), proj:(s.querySelector('.gadd')||{dataset:{}}).dataset.project, sticky:getComputedStyle(s.querySelector('.gsec > .group-title')).position, vopts:!!s.querySelector('.nav .vopts')}; });
  check('R14_projectScreen', r.proj.heads[0]==='Hoy3' && r.proj.proj===await page.evaluate(()=>DB.projects.find(p=>p.name==='FLC').id) && r.proj.sticky==='sticky' && r.proj.vopts, r.proj);
  await page.tap('.screen.pushed-screen.project .gadd'); await page.waitForTimeout(400);
  r.projAdd = await page.$$eval('#sheet .tok', t=>t.map(x=>x.textContent.replace('×','').trim()));
  check('R14_projectAddPreset', r.projAdd.includes('FLC') && r.projAdd.includes('Hoy'), r.projAdd);
  await page.evaluate(()=>closeSheet()); await page.waitForTimeout(400);
  await page.tap('.screen.pushed-screen.project .nav .vopts'); await page.waitForTimeout(350); r.menuProj = await sheetItems(page);
  check('R13_menuProject', r.menuProj.join('|')==='Seleccionar tareas|Mostrar completadas', r.menuProj);
  await page.evaluate(()=>closeSheet()); await page.waitForTimeout(300);
  await page.tap('.screen.pushed-screen.project [data-act=back]'); await page.waitForTimeout(500);
  await page.tap('.tabbar [data-tab=tareas]'); await page.waitForTimeout(300);

  // R14 sticky with a long list (deferred rows past 200) and FLIP
  await page.evaluate(()=>{ const t=todayStr(); batch(()=>{ for(let i=0;i<260;i++) addTask({title:'Carga '+i, date:i%5===0?null:addDays(t,1+(i%40)), priority:i%17===0?'high':'none'}); }); DB.settings.filter='todas'; save(); render(); }); await page.waitForTimeout(400);
  r.lazy = await page.evaluate(()=>document.querySelectorAll('.screen.root[data-root=tareas] .rph').length);
  check('R14_lazyActive', r.lazy>0, r.lazy);
  // Scroll in steps down to the end. At each stop while the list shows sections, one header covers the top line of the list
  // (stuck, or being pushed away by the next one), and what shows right under it is its own section or the next header
  r.stuck = await page.evaluate(async()=>{ const sc=document.querySelector('.screen.root[data-root=tareas] .scroll'); const out=[]; const top=()=>sc.getBoundingClientRect().top;
    for(let k=0;k<40;k++){ sc.scrollTop+=537; await new Promise(res=>requestAnimationFrame(()=>requestAnimationFrame(res)));
      const T=top(), secs=[...sc.querySelectorAll('.gsec')]; const at=secs.find(g=>{ const q=g.getBoundingClientRect(); return q.top<=T+0.5&&q.bottom>T+0.5; }); if(!at) continue; // past the last section
      const cover=[...sc.querySelectorAll('.gsec > .group-title')].filter(h=>{ const q=h.getBoundingClientRect(); return q.top<=T+0.5&&q.bottom>T+0.5; });
      const H=cover[0], y=H?H.getBoundingClientRect().bottom+1:T; const under=secs.find(g=>{ const q=g.getBoundingClientRect(); return q.top<=y&&q.bottom>y; });
      out.push({n:cover.length, ok:cover.length===1 && H.closest('.gsec')===at && (!under || under===at || Math.abs(under.getBoundingClientRect().top-H.getBoundingClientRect().bottom)<2)}); }
    return {stops:out.length, bad:out.filter(o=>!o.ok), left:sc.querySelectorAll('.rph').length}; });
  check('R14_stickyLong', r.stuck.stops>5 && r.stuck.bad.length===0 && r.stuck.left===0, r.stuck);
  await page.evaluate(()=>{ const sc=document.querySelector('.screen.root[data-root=tareas] .scroll'); sc.scrollTop=900; }); await page.waitForTimeout(200);
  await page.screenshot({path:OUT+'/c-light-sticky.png'});
  // Completing from a deferred list animates (FLIP) with no error, and the stuck header stays right
  await page.evaluate(()=>{ const sc=document.querySelector('.screen.root[data-root=tareas] .scroll'); const row=[...sc.querySelectorAll('.gsec .row')].find(x=>x.getBoundingClientRect().top>sc.getBoundingClientRect().top+200); toggleHold(row.dataset.id); }); await page.waitForTimeout(2200);
  r.afterFlip = await page.evaluate(()=>{ const sc=document.querySelector('.screen.root[data-root=tareas] .scroll'); const top=sc.getBoundingClientRect().top; return {stuck:[...sc.querySelectorAll('.gsec > .group-title')].filter(h=>Math.abs(h.getBoundingClientRect().top-top)<1).length, st:sc.scrollTop}; });
  check('R14_flipKeepsSticky', r.afterFlip.stuck===1 && r.afterFlip.st>800, r.afterFlip);
  // Completadas: sticky day headers with a count
  await page.evaluate(()=>{ DB.settings.doneOpen=true; save(); render(); }); await page.waitForTimeout(300);
  r.doneHeads = await page.evaluate(()=>{ const sc=document.querySelector('.screen.root[data-root=tareas] .scroll'); const tg=sc.querySelector('[data-act=toggleDone]').closest('.group'); const hs=[]; for(let n=tg.nextElementSibling;n;n=n.nextElementSibling){ const h=n.querySelector(':scope > .group-title'); if(h) hs.push({t:h.textContent.trim(), sticky:getComputedStyle(h).position}); } return hs; });
  check('R14_doneSticky', r.doneHeads.length>=1 && r.doneHeads.every(h=>h.sticky==='sticky'&&/\d$/.test(h.t)), r.doneHeads);
  r.errors=errors.slice(); await ctx.close();

  /* ---------- Mobile, dark: screenshots and a quick look ---------- */
  ({ctx, page, cdp, errors} = await open(browser, {colorScheme:'dark'}));
  await page.evaluate(FIXTURE); await page.evaluate(()=>{ generateDemo(); DB.settings.filter='todas'; save(); render(); }); await page.waitForTimeout(400);
  await page.evaluate(()=>{ document.querySelector('.screen.root[data-root=tareas] .scroll').scrollTop=600; }); await page.waitForTimeout(200);
  await page.screenshot({path:OUT+'/c-dark-todas.png'});
  await page.evaluate(()=>{ DB.settings.filter='hoy'; DB.settings.hoyGroup='project'; save(); render(); }); await page.waitForTimeout(300); await page.screenshot({path:OUT+'/c-dark-hoy-proyecto.png'});
  await page.evaluate(()=>{ DB.settings.hoyGroup='date'; save(); render(); }); await at1930(page); await page.tap(HOY+' [data-act=closeDay]'); await page.waitForTimeout(400); await page.screenshot({path:OUT+'/c-dark-cerrar.png'});
  await page.evaluate(()=>closeSheet()); await page.waitForTimeout(300); await realClock(page);
  await page.evaluate(H=>document.querySelector(H+' [data-act=review]').scrollIntoView({block:'center'}), HOY); // decision 52: Cerrar el día is the cell at the foot, so the list was scrolled down
  await page.tap(HOY+' [data-act=review]'); await page.waitForTimeout(400); await page.screenshot({path:OUT+'/c-dark-repasar.png'});
  r.errors_dark=errors.slice(); await ctx.close();

  /* ---------- Desktop ---------- */
  ({ctx, page, errors} = await open(browser, {viewport:{width:1280,height:800}, deviceScaleFactor:1, isMobile:false, hasTouch:false}));
  await page.evaluate(FIXTURE); await page.waitForTimeout(300);
  check('D_noMiniSeg', !(await page.$('#desk .seg.mini')));
  r.dMopts = await page.$eval('#desk .mhead .mopts', b=>{ const q=b.getBoundingClientRect(); return {w:q.width, h:q.height}; }).catch(()=>null);
  check('D_R13_button', !!r.dMopts, r.dMopts);
  await page.click('#desk .mhead .mopts'); await page.waitForTimeout(350); r.dMenu = await sheetItems(page);
  // Batch G (R16) gives the desktop its own multiple selection, so its view menu now starts with Seleccionar tareas too
  check('D_R13_menu', r.dMenu[0]==='Seleccionar tareas' && r.dMenu[1]==='Mostrar completadas' && r.dMenu[2]==='Agrupar por fecha  ✓' && r.dMenu[3]==='Agrupar por proyecto' && r.dMenu.length===4, r.dMenu);
  await clickItem(page, 'Agrupar por proyecto');
  r.dHoyProj = await page.$$eval('#desk .gsec > .group-title', h=>h.map(x=>x.textContent.trim()));
  check('D_R13_hoyByProject', r.dHoyProj.length===2 && /^FLC/.test(r.dHoyProj[0]), r.dHoyProj);
  await page.click('#desk .gsec > .group-title[data-pf]'); await page.waitForTimeout(300);
  check('D_R13_headFilter', await page.evaluate(()=>UI.projFilter===DB.projects.find(p=>p.name==='FLC').id && document.querySelectorAll('#desk .gsec').length===1));
  await page.click('#desk .gsec > .group-title[data-pf]'); await page.waitForTimeout(300);
  await page.screenshot({path:OUT+'/c-desk-hoy-proyecto.png'});
  await page.evaluate(()=>{ DB.settings.hoyGroup='date'; save(); render(); });
  // R9 and R8 on the desktop
  check('D_R9_link', await page.evaluate(()=>(document.querySelector('#desk [data-act=review]')||{}).textContent==='Repasar (2)'));
  await at1930(page); await page.evaluate(()=>render()); await page.waitForTimeout(200);
  check('D_R8_entries', await page.evaluate(()=>!document.querySelector('#desk .summary') && document.querySelectorAll('#desk [data-act=closeDay]').length===1 && !!document.querySelector('#desk .closecell')));
  await page.click('#desk .closecell'); await page.waitForTimeout(400);
  check('D_R8_sheet', await page.evaluate(()=>document.querySelector('#sheet h2').textContent==='Cerrar el día' && document.querySelectorAll('#sheet [data-cd]').length===3));
  await page.screenshot({path:OUT+'/c-desk-cerrar.png'});
  await page.evaluate(()=>closeSheet()); await page.waitForTimeout(300); await realClock(page);
  // R14 on the desktop: Todas by day, sticky in the column, right click on a day header
  await page.click('#desk .side [data-view=todas]'); await page.waitForTimeout(300);
  r.dTodas = await page.$$eval('#desk .gsec > .group-title', h=>h.map(x=>({t:x.querySelector('.gl').textContent.trim(), s:getComputedStyle(x).position})));
  check('D_R14_groups', r.dTodas[0].t==='Hoy5' && r.dTodas[1].t==='Mañana1' && r.dTodas.every(h=>h.s==='sticky'), r.dTodas);
  const d4d = await page.evaluate(()=>addDays(todayStr(),4));
  await page.click('#desk [data-day-head="'+d4d+'"] .gl', {button:'right'}); await page.waitForTimeout(350);
  r.dDayMenu = await sheetItems(page);
  check('D_R14_rightClick', r.dDayMenu[0]==='Mover estas 3', r.dDayMenu);
  await page.evaluate(()=>closeSheet()); await page.waitForTimeout(300);
  await page.evaluate(()=>{ generateDemo(); render(); }); await page.waitForTimeout(300);
  r.dStick = await page.evaluate(async()=>{ const b=document.querySelector('#desk .mbody'); b.scrollTop=1200; await new Promise(res=>requestAnimationFrame(()=>requestAnimationFrame(res))); const top=b.getBoundingClientRect().top; return [...b.querySelectorAll('.gsec > .group-title')].filter(h=>Math.abs(h.getBoundingClientRect().top-top)<1).length; });
  check('D_R14_stuck', r.dStick===1, r.dStick);
  await page.screenshot({path:OUT+'/c-desk-todas.png'});
  r.errors_desk=errors.slice(); await ctx.close();

  await browser.close(); srv.close();
  r.fails=fails; r.errors=r.errors.concat(r.errors_dark, r.errors_desk, fails.map(f=>'FAIL '+f));
  console.log(JSON.stringify(r,null,1));
  process.exit(fails.length||r.errors.length?1:0);
})().catch(e=>{ console.log(JSON.stringify({errors:['crash: '+(e&&e.stack||e)], partial:r, fails})); process.exit(2); });
