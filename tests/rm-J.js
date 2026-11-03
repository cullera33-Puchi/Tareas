require('./lib/out.js'); // outputs (screenshots, downloads) go to tests/out
// Batch J (pre-release review of v0.15.0): end-to-end daily flows on the iPhone and the desktop with real touch events,
// plus the fixes of this batch: the count of the lit segment readable in dark mode, the screen under a pushed one hidden while a sheet
// scales the app (no column of its text at the edge) and the import summary in the singular. Port 9510. Clock: Wednesday 4 Nov 2026
const L = require('./lib/lib.js');
const PORT=9510, URL='http://localhost:'+PORT+'/';
const r={}, fails=[]; const check=(name, ok, info)=>{ r[name]=ok?true:(info===undefined?false:info); if(!ok) fails.push(name); };
const rows = '.screen.root:not(.hidden-tab) .scroll .group:not(.first) .row[data-id]';
const rowOf = id => rows.replace('[data-id]','[data-id="'+id+'"]');
const vis = (page,sel)=>page.evaluate(s=>document.querySelector(s).scrollIntoView({block:'center'}), sel).then(()=>page.waitForTimeout(150));
(async()=>{
  await L.serve(PORT); const browser = await L.chromium.launch();
  const AM = new Date(2026,10,4,10,10), PM = new Date(2026,10,4,19,30);

  /* ---------- iPhone, light ---------- */
  let {ctx, page} = await L.open(browser, URL, {demo:true, now:AM}); await page.waitForTimeout(3600);
  // R1: three circles in a row stay marked, then leave together with one toast; Deshacer brings them back
  let ids = await page.$$eval(rows, rs=>rs.slice(0,3).map(x=>x.dataset.id));
  for(const id of ids){ const b=await L.box(page, rowOf(id)+' .check'); await L.tapAt(page, b.cx, b.cy); await page.waitForTimeout(200); }
  check('R1_marked', await page.evaluate(ids=>ids.every(id=>{ const e=document.querySelector('.screen.root:not(.hidden-tab) .row[data-id="'+id+'"]'); return e&&e.classList.contains('held')&&task(id).status==='pending'; }), ids));
  await page.waitForTimeout(2300);
  r.R1 = await page.evaluate(ids=>({st:ids.map(id=>task(id).status), gone:ids.every(id=>!document.querySelector('.screen.root:not(.hidden-tab) .scroll .group:not(.first) .row[data-id="'+id+'"]')), toast:document.querySelector('#toastText').textContent}), ids);
  check('R1_leave', r.R1.st.every(s=>s==='done') && r.R1.gone && r.R1.toast==='3 tareas completadas', r.R1);
  await page.click('#toastBtn'); await page.waitForTimeout(800);
  check('R1_undo', await page.evaluate(ids=>ids.every(id=>task(id).status==='pending'), ids));
  // R2: a tap beside the circle (inside the 44 pt zone) marks the task and opens nothing
  await vis(page, rowOf(ids[1])); let b = await L.box(page, rowOf(ids[1])+' .check'); await L.tapAt(page, b.cx-16, b.cy+14); await page.waitForTimeout(200);
  check('R2_zone', await page.evaluate(id=>HELD.has(id)&&!UI.stack.length, ids[1]));
  await L.tapAt(page, b.cx, b.cy); await page.waitForTimeout(2000); // a second tap unmarks it
  check('R1_unmark', await page.evaluate(id=>task(id).status==='pending'&&!HELD.has(id), ids[1]));
  // R4: a short fast flick opens the row's buttons; R10: a long press and a slide to Media sets it on lifting
  await vis(page, rowOf(ids[2])); b = await L.box(page, rowOf(ids[2]));
  await L.touchDrag(page, b.x+250, b.cy, -50, 0, 2, 8); await page.waitForTimeout(500);
  check('R4_rowFlick', await page.evaluate(id=>document.querySelector('.screen.root:not(.hidden-tab) .row[data-id="'+id+'"]').dataset.open==='1', ids[2]));
  await L.tapAt(page, b.x+60, b.cy); await page.waitForTimeout(500); // a tap on the open row closes it
  const lpId = await page.$$eval(rows, rs=>rs.find(x=>!x.querySelector('.pri')).dataset.id);
  await vis(page, rowOf(lpId)); b = await L.box(page, rowOf(lpId)+' .row-title');
  { const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:b.cx,y:b.cy}]}); await page.waitForTimeout(800);
    const m = await page.evaluate(()=>{ const e=[...document.querySelectorAll('.pm [data-mi]')].find(x=>/Media/.test(x.textContent)); if(!e) return null; const q=e.getBoundingClientRect(); return {x:q.x+q.width/2, y:q.y+q.height/2}; });
    if(m) for(let i=1;i<=8;i++){ await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:b.cx+(m.x-b.cx)*i/8,y:b.cy+(m.y-b.cy)*i/8}]}); await page.waitForTimeout(30); }
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]}); await cdp.detach(); }
  await page.waitForTimeout(700);
  check('R10_slide', await page.evaluate(id=>task(id).priority==='mid'&&!document.querySelector('.pm.open'), lpId));
  // R5 and R7: the syntax in the title, Enter keeps the sheet for the next one, the project strip keeps the focus
  await page.click('.fab'); await page.waitForTimeout(700);
  await page.keyboard.type('Llamar a Marta #flc mañana a las 9 !!!'); await page.keyboard.press('Enter'); await page.waitForTimeout(300);
  r.R7 = await page.evaluate(()=>{ const x=DB.tasks[DB.tasks.length-1], d=x.reminder&&new Date(x.reminder); return {title:x.title, date:x.date, pri:x.priority, proj:(proj(x.projectId)||{}).name, rem:d&&d.getHours()+':'+d.getMinutes(), open:!!document.querySelector('.sheet.on'), focus:document.activeElement.className}; });
  check('R7_syntax', r.R7.title==='Llamar a Marta'&&r.R7.date==='2026-11-05'&&r.R7.pri==='high'&&r.R7.proj==='Cliente FLC'&&r.R7.rem==='9:0'&&r.R7.open&&r.R7.focus==='titlein', r.R7);
  await page.click('.qbtn[data-k=proj]'); await page.waitForTimeout(200);
  check('R5_stripFocus', await page.evaluate(()=>document.querySelector('#qstrip').children.length>1&&document.activeElement.className==='titlein'));
  await page.evaluate(()=>closeSheet()); await page.waitForTimeout(700);
  // R6: three pasted lines become three tasks, with one Deshacer
  await page.click('.fab'); await page.waitForTimeout(700);
  await page.evaluate(()=>{ const i=document.querySelector('.sheet .titlein'); const dt=new DataTransfer(); dt.setData('text/plain','- Uno mañana\n- Dos\n3. Tres !!\n'); i.dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt, bubbles:true, cancelable:true})); });
  await page.waitForTimeout(300);
  check('R6_button', await page.evaluate(()=>document.querySelector('.qadd').textContent==='Crear 3 tareas'));
  const n0 = await page.evaluate(()=>DB.tasks.length);
  await page.click('.qadd'); await page.waitForTimeout(800);
  r.R6 = await page.evaluate(n=>({n:DB.tasks.length-n, last:DB.tasks.slice(-3).map(x=>x.title+'|'+x.date+'|'+x.priority)}), n0);
  // decision 27b (changed on purpose): the + in Hoy proposes today, so the lines with no date of their own inherit it
  check('R6_created', r.R6.n===3 && r.R6.last.join()==='Uno|2026-11-05|none,Dos|2026-11-04|none,Tres|2026-11-04|mid', r.R6);
  await page.click('#toastBtn'); await page.waitForTimeout(500);
  check('R6_undo', await page.evaluate(n=>DB.tasks.length===n, n0));
  await page.waitForTimeout(3500);
  // Detail: back from the edge and with a quick flick from the middle (R4)
  const did = await page.$$eval(rows, rs=>rs[3].dataset.id);
  await page.click(rowOf(did)+' .row-title'); await page.waitForTimeout(800);
  await L.touchDrag(page, 5, 400, 250, 0, 10, 16); await page.waitForTimeout(800);
  check('detail_edgeBack', await page.evaluate(()=>UI.stack.length===0));
  await page.click(rowOf(did)+' .row-title'); await page.waitForTimeout(800);
  const py = await page.$eval('.screen.pushed-screen.detail [data-act=pickPriority]', e=>{ const b=e.getBoundingClientRect(); return Math.round(b.y+b.height/2); }); // decision 56's Tiempo row put Añadir paso, a field, where y 600 was
  await L.touchDrag(page, 150, py, 70, 0, 2, 10); await page.waitForTimeout(800);
  check('detail_flickBack', await page.evaluate(()=>UI.stack.length===0));
  // Fix: under a sheet the screen beneath the detail is hidden (it bled through the scaled app's edge), and it is back once the sheet closes
  await page.click(rowOf(did)+' .row-title'); await page.waitForTimeout(800);
  await page.click('.pushed-screen [data-act=pickDate]'); await page.waitForTimeout(800);
  check('fix_underHidden', await page.evaluate(()=>{ const u=document.querySelector('.screen.under'); return !!u && getComputedStyle(u).visibility==='hidden' && document.querySelector('.app').classList.contains('sheet-open'); }));
  await page.evaluate(()=>{ [...document.querySelectorAll('.sheet.on .chip')].find(c=>c.textContent.trim()==='Mañana').click(); }); await page.waitForTimeout(800);
  r.date = await page.evaluate(id=>({date:task(id).date, carried:task(id).carried, under:getComputedStyle(document.querySelector('.screen.under')).visibility}), did);
  check('date_tomorrow_underBack', r.date.date==='2026-11-05' && r.date.carried===false && r.date.under==='visible', r.date);
  // a back swipe shows the screen beneath again from the first move
  { const cdp = await page.context().newCDPSession(page); await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:5,y:400}]});
    for(let i=1;i<=4;i++){ await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:5+i*20,y:400}]}); await page.waitForTimeout(20); }
    check('backSwipe_underVisible', await page.evaluate(()=>{ const u=document.querySelector('.screen.under'); return !!u&&getComputedStyle(u).visibility==='visible'; }));
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]}); await cdp.detach(); await page.waitForTimeout(800); }
  // Voice notes (recordings, decision 49): a swipe right from the middle of one does nothing and never pops the detail; a swipe left and Eliminar deletes it
  if(!(await page.evaluate(()=>UI.stack.length))){ await page.click(rows+' .row-title'); await page.waitForTimeout(800); }
  const vid = await page.evaluate(()=>UI.stack[UI.stack.length-1].id);
  await page.evaluate(id=>{ const n=new Date().toISOString(); DB.attachments.push({id:'jvn1', taskId:id, kind:'audio', path:null, mime:'audio/mp4', size:4000, width:null, height:null, durationMs:5000, created:n, modified:n}); save(); render(); }, vid); await page.waitForTimeout(400);
  let vb = await L.box(page, '.pushed-screen .vn[data-au]');
  await L.touchDrag(page, vb.x+60, vb.cy, 260, 0, 12, 16); await page.waitForTimeout(900);
  check('vn_rightNotPop', await page.evaluate(()=>UI.stack.length===1 && !document.querySelector('.sheet.on') && !document.querySelector('.pushed-screen .vn[data-au]').dataset.open));
  vb = await L.box(page, '.pushed-screen .vn[data-au]'); await L.touchDrag(page, vb.x+300, vb.cy, -120, 0, 8, 16); await page.waitForTimeout(500);
  const del = await L.box(page, '.pushed-screen .vn[data-au] [data-aact=del]'); await L.tapAt(page, del.cx, del.cy); await page.waitForTimeout(700);
  check('vn_delete', await page.evaluate(()=>!DB.attachments.some(a=>a.id==='jvn1') && document.querySelector('#toastText').textContent==='Nota de voz eliminada'));
  await page.evaluate(()=>pop()); await page.waitForTimeout(800);
  // R9: review the carried ones, end, Deshacer
  const c0 = await page.evaluate(()=>pendingFor('hoy').filter(x=>x.carried).length);
  await page.click('[data-act=review]'); await page.waitForTimeout(700);
  await page.click('.sheet.on [data-rv=hoy]'); await page.waitForTimeout(700);
  await page.click('.sheet.on [data-rv=man]'); await page.waitForTimeout(700);
  await page.click('.sheet.on [data-x=end]'); await page.waitForTimeout(800);
  r.R9 = await page.evaluate(()=>document.querySelector('.sheet.on').textContent);
  check('R9_balance', /Repaso terminado/.test(r.R9) && /Para hoy1/.test(r.R9) && /A mañana1/.test(r.R9), r.R9);
  await page.click('.sheet.on [data-x=undo]'); await page.waitForTimeout(800);
  check('R9_undo', await page.evaluate(c=>pendingFor('hoy').filter(x=>x.carried).length===c, c0));
  // R14: Todas, the group header sticks to the top while its rows scroll
  await page.click('[data-filter=todas]'); await page.waitForTimeout(500);
  await page.evaluate(()=>{ document.querySelector('.screen.root:not(.hidden-tab) .scroll').scrollTop=1500; }); await page.waitForTimeout(300);
  check('R14_sticky', await page.evaluate(()=>{ const s=document.querySelector('.screen.root:not(.hidden-tab) .scroll'), st=s.getBoundingClientRect().top; return [...s.querySelectorAll('.gh')].some(h=>Math.abs(h.getBoundingClientRect().top-st)<2); }));
  // Fix: the import summary says "1 nuevo" in the singular
  await page.evaluate(()=>switchTab('ajustes')); await page.waitForTimeout(500);
  await page.evaluate(()=>{ [...document.querySelectorAll('.screen.root:not(.hidden-tab) button')].find(x=>/Importar pegando texto/.test(x.textContent)).click(); }); await page.waitForTimeout(800);
  await page.evaluate(()=>{ const ta=document.querySelector('.sheet.on textarea'); ta.value=JSON.stringify({tasks:[{id:'jimp1',title:'Importada',spaceId:space().id,status:'pending',priority:'none',created:new Date().toISOString(),modified:new Date().toISOString()}]}); ta.dispatchEvent(new Event('input',{bubbles:true})); });
  await page.click('.sheet.on [data-x=ok]'); await page.waitForTimeout(900);
  r.imp = await page.evaluate(()=>document.querySelector('#toastText').textContent);
  check('fix_importSingular', r.imp==='1 nuevo, 0 actualizados', r.imp);
  await ctx.close();

  /* ---------- iPhone at 19:30: Cerrar el día, only the non-priority ones, Deshacer ---------- */
  ({ctx, page} = await L.open(browser, URL, {demo:true, now:PM})); await page.waitForTimeout(3600);
  const h0 = await page.evaluate(()=>({n:pendingFor('hoy').length, hi:pendingFor('hoy').filter(x=>x.priority==='high').length}));
  await page.click('.closecell'); await page.waitForTimeout(800);
  await page.click('.sheet.on [data-cd=rest]'); await page.waitForTimeout(900);
  r.R8 = await page.evaluate(()=>({n:pendingFor('hoy').length, toast:document.querySelector('#toastText').textContent}));
  check('R8_rest', r.R8.n===h0.hi && r.R8.toast===(h0.n-h0.hi)+' tareas pasadas a mañana, día cerrado', {r:r.R8, h0}); // the day closed on every device (owner, 3 November)
  await page.click('#toastBtn'); await page.waitForTimeout(800);
  check('R8_undo', await page.evaluate(n=>pendingFor('hoy').length===n, h0.n));
  await ctx.close();

  /* ---------- iPhone, dark: the lit segment's count is readable (fix) ---------- */
  ({ctx, page} = await L.open(browser, URL, {theme:'dark', demo:true, now:AM})); await page.waitForTimeout(1500);
  r.seg = await page.evaluate(()=>{ const L_=c=>{ const m=c.match(/[\d.]+/g).map(Number); return m; };
    const b=document.querySelector('.screen.root:not(.hidden-tab) .seg button.on'), n=b.querySelector('.n'); const fg=L_(getComputedStyle(n).color), bg=L_(getComputedStyle(b).backgroundColor);
    const a=fg[3]===undefined?1:fg[3]; const mix=fg.slice(0,3).map((v,i)=>v*a+bg[i]*(1-a)); const f=v=>{ v/=255; return v<=.03928?v/12.92:Math.pow((v+.055)/1.055,2.4); }; const lu=c=>.2126*f(c[0])+.7152*f(c[1])+.0722*f(c[2]);
    const x=lu(mix), y=lu(bg); return +((Math.max(x,y)+.05)/(Math.min(x,y)+.05)).toFixed(2); });
  check('fix_darkSegCount', r.seg>=2.8, r.seg);
  await ctx.close();

  /* ---------- Desktop 1280x800 ---------- */
  const dRows = '#desk .main .mbody .row[data-id]:not(.first .row)';
  ({ctx, page} = await L.open(browser, URL, {desk:true, demo:true, now:AM})); await page.waitForTimeout(3600);
  ids = await page.$$eval(dRows, rs=>rs.slice(0,8).map(x=>x.dataset.id));
  // R15: the keyboard moves the selection, sets the priority and the date, Control Z undoes
  await page.click(dRows+' .row-title'); await page.waitForTimeout(300); await page.evaluate(()=>{ UI.deskDetail=null; render(); }); await page.waitForTimeout(300);
  await page.keyboard.press('ArrowDown'); await page.waitForTimeout(200);
  const cur = await page.evaluate(()=>UI.dsel.cur); const p0 = await page.evaluate(id=>task(id).date, cur);
  await page.keyboard.press('m'); await page.waitForTimeout(600);
  check('R15_key_m', await page.evaluate(id=>task(id).date==='2026-11-05', cur));
  await page.keyboard.press('Control+z'); await page.waitForTimeout(600);
  check('R15_undo', await page.evaluate(([id,d])=>task(id).date===d, [cur, p0]));
  // keys typed in the inspector's notes stay text
  await page.evaluate(id=>{ UI.deskDetail=id; render(); }, cur); await page.waitForTimeout(500);
  await page.click('#desk .pane textarea[data-role=notes]'); await page.keyboard.press('End'); await page.keyboard.type(' c1m'); await page.waitForTimeout(600);
  check('R15_keysInField', await page.evaluate(id=>{ const x=task(id); return x.status==='pending'&&x.date!=='2026-11-05'&&/ c1m$/.test(x.notes); }, cur));
  await page.evaluate(()=>{ document.activeElement.blur(); UI.deskDetail=null; render(); }); await page.waitForTimeout(400);
  // R16: Control click and Mayúsculas click select a range; dragging it to a project moves them all
  ids = await page.$$eval(dRows, rs=>rs.slice(0,8).map(x=>x.dataset.id));
  await page.click(dRows.replace('[data-id]','[data-id="'+ids[1]+'"]')+' .row-title'); await page.waitForTimeout(200);
  await page.click(dRows.replace('[data-id]','[data-id="'+ids[3]+'"]')+' .row-title', {modifiers:['Control']}); await page.waitForTimeout(200);
  await page.click(dRows.replace('[data-id]','[data-id="'+ids[5]+'"]')+' .row-title', {modifiers:['Shift']}); await page.waitForTimeout(400);
  check('R16_range', await page.evaluate(()=>UI.dsel.ids.size===3 && /3 tareas seleccionadas/.test(document.querySelector('#desk .pane.multi').textContent)));
  const target = await page.$eval('#desk .side [data-view^="project:"]', e=>e.dataset.view.slice(8));
  await page.dragAndDrop(dRows.replace('[data-id]','[data-id="'+ids[3]+'"]'), '#desk .side [data-view^="project:"]'); await page.waitForTimeout(800);
  check('R16_dragGroup', await page.evaluate(([ids,p])=>ids.every(id=>task(id).projectId===p), [[ids[3],ids[4],ids[5]], target]));
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  // R20: a Sin fecha card dropped on an 08:00 slot gets that date and time
  await page.evaluate(()=>{ DB.settings.calMode='hours'; save(); setDeskView('week'); }); await page.waitForTimeout(700);
  await page.evaluate(()=>{ document.querySelector('#desk .hscroll').scrollTop=0; }); await page.waitForTimeout(200);
  const card = await page.$eval('#desk .wtray .wcard[data-id]', e=>e.dataset.id);
  { const a=await L.box(page, '#desk .wtray .wcard[data-id="'+card+'"]'), z=await L.box(page, '#desk .hs[data-slot="2026-11-06T08:00"]');
    await page.mouse.move(a.cx, a.cy); await page.mouse.down(); await page.mouse.move(a.cx+10, a.cy+10, {steps:3}); await page.mouse.move(z.cx, z.cy, {steps:8}); await page.mouse.up(); await page.waitForTimeout(700); }
  r.slot = await page.evaluate(id=>{ const x=task(id), d=x.reminder&&new Date(x.reminder); return {date:x.date, rem:d&&d.getHours()+':'+d.getMinutes()}; }, card);
  check('R20_slot', r.slot.date==='2026-11-06' && r.slot.rem==='8:0', r.slot);
  await ctx.close();

  r.errors = L.errors;
  console.log(JSON.stringify({fails, r, errors:L.errors}, null, 1));
  await browser.close(); process.exit(fails.length||L.errors.length?1:0);
})().catch(e=>{ console.log(JSON.stringify({fails:fails.concat(['FATAL']), fatal:e.message.slice(0,600), r, errors:L.errors}, null, 1)); process.exit(1); });
