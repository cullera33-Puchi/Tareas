require('./lib/out.js'); // outputs (screenshots, downloads) go to tests/out
// Roadmap batch F: R12 (Semana legible with a heavy load), R19 (Mes and the sidebar's mini month), R20 (Horas in Semana and Día, the agenda of Hoy).
// Desktop only; the iPhone is checked unchanged. The clock is fixed on Wednesday 4 November 2026 at 10:10 (local), so past days and slots are known
const { chromium } = require('playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = path.resolve(__dirname, '..'); const OUT = path.join(__dirname, 'out', 'F'); fs.mkdirSync(OUT, {recursive:true});
const TYPES = {'.html':'text/html','.css':'text/css','.js':'application/javascript','.webmanifest':'application/manifest+json','.png':'image/png'};
const srv = http.createServer((req,res)=>{ let p = decodeURIComponent(req.url.split('?')[0]); if(p==='/') p='/index.html'; const f=path.join(ROOT,p); if(!fs.existsSync(f)){res.writeHead(404);res.end();return;} res.writeHead(200,{'Content-Type':TYPES[path.extname(f)]||'application/octet-stream'}); res.end(fs.readFileSync(f)); });
const PORT=9106, URL='http://localhost:'+PORT+'/';
// Updated by decision 35: "Solo de lunes a viernes" is on by default in Trabajo; these checks are about the seven-day week, so it is off here
const SEED = JSON.stringify({spaces:[{id:'trabajo',name:'Trabajo',order:0},{id:'personal',name:'Personal',order:1}],projects:[],tasks:[],voiceNotes:[],settings:{tipsSeen:true, workWeek:{trabajo:false}}});
const r={}, fails=[]; const check=(name, ok, info)=>{ r[name]=ok?true:(info===undefined?false:info); if(!ok) fails.push(name); };
let errors=[];
const NOW = new Date(2026, 10, 4, 10, 10, 0); // Wednesday

async function open(browser, opts){
  const ctx = await browser.newContext(Object.assign({ viewport:{width:1280,height:800}, deviceScaleFactor:1, colorScheme:'light' }, opts||{}));
  const page = await ctx.newPage(); await page.clock.install({time:NOW});
  await page.addInitScript(s=>{ if(!localStorage.getItem('tareas-v1')) localStorage.setItem('tareas-v1', s); }, SEED);
  page.on('pageerror', e=>errors.push(e.message)); page.on('console', m=>{ if(m.type()==='error') errors.push(m.text()); });
  await page.goto(URL); await page.waitForTimeout(400);
  await page.evaluate(()=>{ const t=todayStr(), at=(d,h,m)=>{ const x=new Date(d+'T00:00:00'); x.setHours(h,m,0,0); return x.toISOString(); };
    const p=addProject('FLC','#FF3B30'), q=addProject('Casa','#34C759');
    addTask({id:'tA', title:'Llamada con el cliente a las tres', date:t, reminder:at(t,15,0), projectId:p.id});
    addTask({id:'tF', title:'Prioritaria de hoy', date:t, priority:'high'});
    addTask({id:'tB', title:'Aplazada de ayer', date:t, carried:true, projectId:q.id});
    addTask({id:'tE', title:'Madrugón', date:t, reminder:at(t,6,0)});
    addTask({id:'tC', title:'Tarea del jueves', date:addDays(t,1)});
    for(let i=0;i<10;i++) addTask({id:'fri'+i, title:'Viernes '+i, date:addDays(t,2)});
    for(let i=0;i<25;i++) addTask({id:'sat'+i, title:'Sábado cargado número '+i+' con un título bastante largo', date:addDays(t,3), priority:i<3?'high':'none', projectId:i%2?p.id:null});
    for(let i=0;i<45;i++) addTask({id:'u'+i, title:'Sin fecha '+i});
    const d=addTask({id:'tD', title:'Hecha ayer', date:addDays(t,-1)}); d.status='done'; d.completed=new Date(Date.now()-864e5).toISOString();
    save(); setDeskView('week'); });
  await page.waitForTimeout(300);
  return {ctx, page};
}
const toastText = page => page.evaluate(()=>document.querySelector('#toast').classList.contains('on')?document.querySelector('#toastText').textContent:null);
const undo = async page => { await page.click('#toastBtn'); await page.waitForTimeout(300); };
// A native drag with the mouse, from the middle of one element to a point of another (scrolled into view first)
async function drag(page, src, dst, dy){
  for(const s of [src,dst]) await page.$eval(s, e=>e.scrollIntoView({block:'center'}));
  const a=await (await page.$(src)).boundingBox(), b=await (await page.$(dst)).boundingBox();
  await page.mouse.move(a.x+a.width/2, a.y+a.height/2); await page.mouse.down();
  await page.mouse.move(b.x+b.width/2, b.y+(dy===undefined?b.height/2:dy), {steps:10}); await page.mouse.move(b.x+b.width/2+2, b.y+(dy===undefined?b.height/2:dy)+1, {steps:3});
  await page.mouse.up(); await page.waitForTimeout(400); }
const menuItems = page => page.$$eval('#pmenu .pm-it', b=>b.map(x=>x.querySelector('.pm-l').textContent+(x.querySelector('.pm-ck svg')?' *':'')));
const clickItem = (page, label) => page.evaluate(l=>{ const b=[...document.querySelectorAll('#pmenu .pm-it')].find(x=>x.querySelector('.pm-l').textContent===l); if(!b) throw new Error('no item '+l); b.click(); }, label);

(async()=>{
  await new Promise(res=>srv.listen(PORT,res));
  const browser = await chromium.launch();
  let {ctx, page} = await open(browser);

  /* ---------- R12: Semana, seven days from today by default ---------- */
  r.wk = await page.evaluate(()=>({days:[...document.querySelectorAll('#desk .wday')].map(d=>d.dataset.day), today:todayStr(), h2:document.querySelector('#desk .whead h2').textContent, mode:document.querySelector('#desk .wmode').textContent,
    first:document.querySelector('#desk .wday').classList.contains('today'), mbody:(b=>({sh:b.scrollHeight, ch:b.clientHeight}))(document.querySelector('#desk .mbody'))}));
  check('R12_next7Default', r.wk.days.length===7 && r.wk.days[0]===r.wk.today && r.wk.first && r.wk.h2==='Semana del 4 al 10 de noviembre' && r.wk.mode==='Siete días desde hoy', r.wk);
  check('R12_columnFillsNoPageScroll', r.wk.mbody.sh<=r.wk.mbody.ch+1, r.wk.mbody);
  // Headers: count, high-priority count, load bar (orange above 8, red above 12)
  r.heads = await page.evaluate(()=>[...document.querySelectorAll('#desk .wday')].slice(0,4).map(d=>({wc:d.querySelector('.wc').textContent, wp:(d.querySelector('.wp')||{}).textContent||'', ld:d.querySelector('.ld').className, sc:+d.querySelector('.ld i').style.transform.replace(/[^0-9.]/g,'')})));
  check('R12_headCounts', r.heads[0].wc==='4 tareas' && r.heads[0].wp==='1 !!!' && r.heads[1].wc==='1 tarea' && r.heads[3].wc==='25 tareas' && r.heads[3].wp==='3 !!!', r.heads);
  check('R12_loadBar', r.heads[0].ld==='ld' && r.heads[2].ld==='ld orange' && r.heads[3].ld==='ld red' && r.heads[3].sc===1 && Math.abs(r.heads[0].sc-4/12)<.01, r.heads);
  // Each column scrolls on its own under its fixed header
  r.colScroll = await page.evaluate(()=>{ const d=[...document.querySelectorAll('#desk .wday')][3], wl=d.querySelector('.wl'), h0=d.querySelector('.dh').getBoundingClientRect().top; wl.scrollTop=200;
    return {ov:getComputedStyle(wl).overflowY, scrolls:wl.scrollHeight>wl.clientHeight, moved:wl.scrollTop>0, headStays:d.querySelector('.dh').getBoundingClientRect().top===h0, cards:wl.querySelectorAll('.wcard').length}; });
  check('R12_columnScroll', r.colScroll.ov==='auto' && r.colScroll.scrolls && r.colScroll.moved && r.colScroll.headStays && r.colScroll.cards===25, r.colScroll);
  // Cards: one line, full title on hover, the time at the right and the timed tasks first; carried ones with an orange edge
  r.cards = await page.evaluate(()=>{ const today=[...document.querySelectorAll('#desk .wday.today .wcard')]; const sat=document.querySelector('#desk .wcard[data-id=sat0]'); const b=document.querySelector('#desk .wcard[data-id=tB]');
    return {order:today.map(c=>c.dataset.id), hs:[...new Set([...document.querySelectorAll('#desk .wday .wcard')].map(c=>Math.round(c.getBoundingClientRect().height)))], ws:getComputedStyle(sat.querySelector('.t')).whiteSpace, tip:sat.title,
      tm:document.querySelector('#desk .wcard[data-id=tA] .tm').textContent, tmE:(document.querySelector('#desk .wcard[data-id=tE] .tm')||{}).textContent, carried:b.classList.contains('carried'), sh:getComputedStyle(b).boxShadow}; });
  check('R12_oneLineCards', r.cards.hs.length===1 && r.cards.hs[0]<=30 && r.cards.ws==='nowrap' && r.cards.tip.startsWith('Sábado cargado número 0 con un título bastante largo'), r.cards);
  check('R12_timeAndOrder', r.cards.tm==='15:00' && r.cards.tmE==='06:00' && r.cards.order[0]==='tE' && r.cards.order[1]==='tA', r.cards);
  check('R12_carriedOrange', r.cards.carried && /255, 149, 0/.test(r.cards.sh), r.cards);
  // Sin fecha: a side tray with every undated task (no cap), folding into a strip that still takes a drop
  r.tray = await page.evaluate(()=>{ const t=document.querySelector('#desk .wtray'); return {n:t.querySelectorAll('.wcard').length, count:t.querySelector('.trh .n').textContent, side:t.getBoundingClientRect().left>document.querySelector('#desk .wgrid').getBoundingClientRect().right-1}; });
  check('R12_trayAll', r.tray.n===45 && r.tray.count==='45' && r.tray.side, r.tray);
  await page.click('#desk .wtray .trh'); await page.waitForTimeout(250);
  r.trayShut = await page.evaluate(()=>{ const t=document.querySelector('#desk .wtray'); return {shut:t.classList.contains('shut'), w:Math.round(t.getBoundingClientRect().width), cards:t.querySelectorAll('.wcard').length, set:DB.settings.weekTray, day:t.dataset.day}; });
  check('R12_trayFolds', r.trayShut.shut && r.trayShut.w<=40 && r.trayShut.cards===0 && r.trayShut.set===false && r.trayShut.day==='', r.trayShut);
  await drag(page, '#desk .wcard[data-id=tC]', '#desk .wtray');
  r.toTray = await page.evaluate(()=>task('tC').date); r.toTrayT = await toastText(page);
  check('R12_dropOnFoldedTray', r.toTray===null && r.toTrayT==='Sin fecha', {d:r.toTray, t:r.toTrayT});
  await undo(page);
  await page.click('#desk .wtray .trh'); await page.waitForTimeout(250);
  check('R12_trayOpens', await page.evaluate(()=>!document.querySelector('#desk .wtray').classList.contains('shut') && DB.settings.weekTray===true && task('tC').date===addDays(todayStr(),1)));
  await page.screenshot({path:OUT+'/f-week-list.png'});
  // Drag between days, with Deshacer
  await drag(page, '#desk .wcard[data-id=tC]', '#desk .wday[data-day="2026-11-06"] .wl');
  r.dragDay = {d:await page.evaluate(()=>task('tC').date), t:await toastText(page)};
  check('R12_dragDay', r.dragDay.d==='2026-11-06' && r.dragDay.t==='Movida a viernes', r.dragDay);
  await undo(page); check('R12_dragUndo', await page.evaluate(()=>task('tC').date==='2026-11-05'));

  // The option Monday to Sunday: past days narrower; refused drop on a past day, with a toast
  await page.click('#desk .wmode'); await page.waitForTimeout(250);
  r.wmMenu = await menuItems(page);
  check('R12_modeMenu', JSON.stringify(r.wmMenu)===JSON.stringify(['Siete días desde hoy *','De lunes a domingo','Solo de lunes a viernes']), r.wmMenu); // decision 35 adds its option to this menu
  await clickItem(page, 'De lunes a domingo'); await page.waitForTimeout(300);
  r.mon = await page.evaluate(()=>{ const ds=[...document.querySelectorAll('#desk .wday')]; return {days:ds.map(d=>d.dataset.day), w:ds.map(d=>Math.round(d.getBoundingClientRect().width)), past:ds.map(d=>d.classList.contains('past')), set:DB.settings.weekMode, h2:document.querySelector('#desk .whead h2').textContent, done:(ds[1].querySelector('.wc')||{}).textContent}; });
  check('R12_mondayMode', r.mon.set==='monday' && r.mon.days[0]==='2026-11-02' && r.mon.days[6]==='2026-11-08' && r.mon.h2==='Semana del 2 al 8 de noviembre', r.mon);
  check('R12_pastNarrower', r.mon.past[0] && r.mon.past[1] && !r.mon.past[2] && r.mon.w[0]<r.mon.w[2]*0.7 && r.mon.w[2]===r.mon.w[3], r.mon.w);
  check('R12_pastDone', r.mon.done==='1 hecha' && await page.evaluate(()=>!!document.querySelector('#desk .wday[data-day="2026-11-03"] .wcard.done[data-id=tD]')), r.mon.done);
  await drag(page, '#desk .wcard[data-id=tC]', '#desk .wday[data-day="2026-11-02"] .wl');
  r.pastDrop = {d:await page.evaluate(()=>task('tC').date), t:await toastText(page)};
  check('R12_pastRefused', r.pastDrop.d==='2026-11-05' && r.pastDrop.t==='No se puede mover a un día pasado', r.pastDrop);
  await page.click('#desk [data-week="1"]'); await page.waitForTimeout(200);
  r.monNext = await page.evaluate(()=>document.querySelector('#desk .wday').dataset.day);
  await page.click('#desk [data-week=today]'); await page.waitForTimeout(200);
  check('R12_mondayNav', r.monNext==='2026-11-09' && await page.evaluate(()=>document.querySelector('#desk .wday').dataset.day==='2026-11-02' && UI.weekStart===null), r.monNext);
  await page.screenshot({path:OUT+'/f-week-monday.png'});
  await page.click('#desk .wmode'); await page.waitForTimeout(200); await clickItem(page, 'Siete días desde hoy'); await page.waitForTimeout(300);
  check('R12_backToNext7', await page.evaluate(()=>DB.settings.weekMode==='next7' && document.querySelector('#desk .wday').dataset.day===todayStr()));

  /* ---------- R20: Horas ---------- */
  await page.click('#desk [data-cal-mode=hours]'); await page.waitForTimeout(300);
  r.hours = await page.evaluate(()=>{ const col=document.querySelector('#desk .hcol.today'), a=col.querySelector('.wcard.hb[data-id=tA]'), all=document.querySelector('#desk .hallday.today'); const now=col.querySelector('.hnow');
    return {mode:DB.settings.calMode, cols:document.querySelectorAll('#desk .hcol').length, slots:col.querySelectorAll('.hs').length, first:col.querySelector('.hs').dataset.slot, last:[...col.querySelectorAll('.hs')].pop().dataset.slot,
      aTop:a&&parseFloat(a.style.top), aH:a&&Math.round(a.getBoundingClientRect().height), allIds:[...all.querySelectorAll('.wcard')].map(c=>c.dataset.id).sort(), eTm:(all.querySelector('[data-id=tE] .tm')||{}).textContent,
      now:now&&now.style.transform, past:[...col.querySelectorAll('.hs.past')].map(s=>s.dataset.slot.slice(11)), tray:!!document.querySelector('#desk .wtray'), heads:document.querySelectorAll('#desk .hhead .dh').length,
      gridH:Math.round(document.querySelector('#desk .hgrid').getBoundingClientRect().height)}; });
  check('R20_hoursGrid', r.hours.mode==='hours' && r.hours.cols===7 && r.hours.slots===28 && r.hours.first==='2026-11-04T07:00' && r.hours.last==='2026-11-04T20:30' && r.hours.heads===7 && r.hours.tray, r.hours);
  check('R20_blockHalfHour', r.hours.aTop===(15*60-420)/30*22 && r.hours.aH===20, r.hours);
  check('R20_allDayStrip', JSON.stringify(r.hours.allIds)===JSON.stringify(['tB','tE','tF']) && r.hours.eTm==='06:00', r.hours); // 6:00 is outside the grid: shown with its time in Todo el día
  check('R20_nowLine', /translateY\(139\.\d+px\)/.test(r.hours.now) && JSON.stringify(r.hours.past)===JSON.stringify(['07:00','07:30','08:00','08:30','09:00','09:30','10:00']), r.hours);
  await page.screenshot({path:OUT+'/f-week-hours.png'});
  // Drag an all-day task to a slot: date and reminder at that time, with Deshacer
  await drag(page, '#desk .wcard[data-id=tC]', '#desk .hs[data-slot="2026-11-06T09:00"]');
  r.toSlot = await page.evaluate(()=>{ const x=task('tC'); return {d:x.date, t:x.reminder&&fmtTime(x.reminder), day:x.reminder&&localDay(x.reminder), block:!!document.querySelector('#desk .hcol[data-hday="2026-11-06"] .wcard.hb[data-id=tC]')}; }); r.toSlotT=await toastText(page);
  check('R20_dropOnSlot', r.toSlot.d==='2026-11-06' && r.toSlot.t==='09:00' && r.toSlot.day==='2026-11-06' && r.toSlot.block && r.toSlotT==='Movida a viernes a las 09:00', {s:r.toSlot, t:r.toSlotT});
  await undo(page); check('R20_slotUndo', await page.evaluate(()=>task('tC').date==='2026-11-05' && task('tC').reminder===null));
  // A block back to Todo el día loses its time, keeps its date
  await drag(page, '#desk .wcard.hb[data-id=tA]', '#desk .hallday.today', 10);
  r.toAll = await page.evaluate(()=>({d:task('tA').date, r:task('tA').reminder})); r.toAllT=await toastText(page);
  check('R20_backToAllDay', r.toAll.d==='2026-11-04' && r.toAll.r===null && r.toAllT==='Sin hora', {a:r.toAll, t:r.toAllT});
  await undo(page); check('R20_allDayUndo', await page.evaluate(()=>fmtTime(task('tA').reminder)==='15:00'));
  // Same day, another time
  await drag(page, '#desk .wcard.hb[data-id=tA]', '#desk .hs[data-slot="2026-11-04T16:30"]');
  r.moveTime = {t:await page.evaluate(()=>fmtTime(task('tA').reminder)), toast:await toastText(page)};
  check('R20_moveTime', r.moveTime.t==='16:30' && r.moveTime.toast==='A las 16:30', r.moveTime);
  await undo(page);
  // A past slot takes no drop
  await drag(page, '#desk .wcard[data-id=tF]', '#desk .hs[data-slot="2026-11-04T08:00"]');
  r.pastSlot = {r:await page.evaluate(()=>task('tF').reminder), t:await toastText(page)};
  check('R20_pastSlotRefused', r.pastSlot.r===null && r.pastSlot.t==='Esa hora ya ha pasado', r.pastSlot);
  // Overlapping blocks share the width
  await page.evaluate(()=>{ const t=todayStr(), x=new Date(t+'T00:00:00'); x.setHours(15,15,0,0); updTask('tF',{reminder:x.toISOString()}); render(); });
  r.overlap = await page.evaluate(()=>{ const a=document.querySelector('#desk .hb[data-id=tA]').getBoundingClientRect(), f=document.querySelector('#desk .hb[data-id=tF]').getBoundingClientRect(), c=document.querySelector('#desk .hcol.today').getBoundingClientRect();
    return {aw:Math.round(a.width), fw:Math.round(f.width), cw:Math.round(c.width), apart:a.right<=f.left+1||f.right<=a.left+1}; });
  check('R20_overlap', r.overlap.apart && r.overlap.aw<r.overlap.cw/2+1 && r.overlap.fw<r.overlap.cw/2+1, r.overlap);
  await page.evaluate(()=>{ updTask('tF',{reminder:null}); render(); });
  // Día: the same engine with one column
  await page.click('#desk [data-cal-view=day]'); await page.waitForTimeout(300);
  r.day = await page.evaluate(()=>({view:UI.deskView, cols:document.querySelectorAll('#desk .hcol').length, h2:document.querySelector('#desk .whead h2').textContent, block:!!document.querySelector('#desk .hcol .hb[data-id=tA]'), title:document.querySelector('#desk .mhead h1').textContent}));
  check('R20_dayView', r.day.view==='day' && r.day.cols===1 && r.day.h2==='Miércoles, 4 de noviembre' && r.day.block && r.day.title==='Día', r.day);
  await page.screenshot({path:OUT+'/f-day-hours.png'});
  await page.click('#desk [data-week="1"]'); await page.waitForTimeout(200);
  r.dayNext = await page.evaluate(()=>({h2:document.querySelector('#desk .whead h2').textContent, d:document.querySelector('#desk .hcol').dataset.hday, past:document.querySelectorAll('#desk .hcol .hs.past').length}));
  check('R20_dayNav', r.dayNext.h2==='Jueves, 5 de noviembre' && r.dayNext.d==='2026-11-05' && r.dayNext.past===0, r.dayNext);
  await page.click('#desk [data-cal-mode=list]'); await page.waitForTimeout(200);
  check('R20_dayList', await page.evaluate(()=>document.querySelectorAll('#desk .wday').length===1 && !!document.querySelector('#desk .wday .wcard[data-id=tC]')));
  await page.click('#desk [data-week=today]'); await page.waitForTimeout(200);
  check('R20_dayToday', await page.evaluate(()=>UI.calDay===null && document.querySelector('#desk .wday').dataset.day===todayStr()));
  // The detail opens as the week's popover beside the card, in Día too
  await page.click('#desk .wcard[data-id=tA] .t'); await page.waitForTimeout(300);
  check('R20_popover', await page.evaluate(()=>!!document.querySelector('#desk .pane.wpop[data-task=tA]') && !document.querySelector('#app').classList.contains('has-pane')));
  await page.keyboard.press('Escape'); await page.waitForTimeout(250);

  /* ---------- R19: Mes ---------- */
  await page.click('#desk [data-cal-view=month]'); await page.waitForTimeout(300);
  r.month = await page.evaluate(()=>{ const ds=[...document.querySelectorAll('#desk .mday')]; const sat=document.querySelector('#desk .mday[data-day="2026-11-07"]'); const today=document.querySelector('#desk .mday.today');
    return {n:ds.length, first:ds[0].dataset.day, last:ds[41].dataset.day, h2:document.querySelector('#desk .whead h2').textContent, satChips:sat.querySelectorAll('.wcard.mc').length, more:(sat.querySelector('.mmore')||{}).textContent,
      todayChips:[...today.querySelectorAll('.wcard')].map(c=>c.dataset.id), tm:(today.querySelector('[data-id=tA] .tm')||{}).textContent, dot:today.querySelector('[data-id=tA] .mdot')&&getComputedStyle(today.querySelector('[data-id=tA] .mdot')).backgroundColor,
      pri:!!sat.querySelector('.pri.high'), other:ds[0].classList.contains('other'), noMode:!document.querySelector('#desk [data-cal-mode]'), fits:ds.every(d=>d.scrollHeight<=d.clientHeight+1), mb:(b=>b.scrollHeight<=b.clientHeight+1)(document.querySelector('#desk .mbody'))}; });
  check('R19_sixWeeks', r.month.n===42 && r.month.first==='2026-10-26' && r.month.last==='2026-12-06' && r.month.h2==='Noviembre de 2026' && r.month.other && r.month.noMode && r.month.mb, r.month);
  check('R19_fourAndMore', r.month.satChips===4 && r.month.more==='21 más' && r.month.pri && r.month.fits, r.month);
  check('R19_chipData', r.month.todayChips.length===4 && r.month.todayChips[0]==='tE' && r.month.todayChips[1]==='tA' && r.month.tm==='15:00' && r.month.dot==='rgb(255, 59, 48)', r.month);
  await page.screenshot({path:OUT+'/f-month.png'});
  // Drag a chip to another day, with Deshacer; a past day refuses
  await drag(page, '#desk .mday[data-day="2026-11-05"] .wcard[data-id=tC]', '#desk .mday[data-day="2026-11-12"]');
  r.mDrag = {d:await page.evaluate(()=>task('tC').date), t:await toastText(page)};
  check('R19_dragDay', r.mDrag.d==='2026-11-12' && /^Movida a /.test(r.mDrag.t), r.mDrag);
  await undo(page); check('R19_dragUndo', await page.evaluate(()=>task('tC').date==='2026-11-05'));
  await drag(page, '#desk .mday[data-day="2026-11-05"] .wcard[data-id=tC]', '#desk .mday[data-day="2026-11-03"]');
  r.mPast = {d:await page.evaluate(()=>task('tC').date), t:await toastText(page)};
  check('R19_pastRefused', r.mPast.d==='2026-11-05' && r.mPast.t==='No se puede mover a un día pasado', r.mPast);
  // Double click on an empty day adds a task with that date; on a past day it is refused
  const e20 = await (await page.$('#desk .mday[data-day="2026-11-20"]')).boundingBox();
  await page.mouse.dblclick(e20.x+e20.width/2, e20.y+e20.height-12); await page.waitForTimeout(400);
  await page.keyboard.type('Nueva desde el mes'); await page.keyboard.press('Enter'); await page.waitForTimeout(300);
  r.dbl = await page.evaluate(()=>{ const x=DB.tasks.find(t=>t.title==='Nueva desde el mes'); return x&&x.date; });
  check('R19_dblclickAdds', r.dbl==='2026-11-20', r.dbl);
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  const e27 = await (await page.$('#desk .mday[data-day="2026-10-27"]')).boundingBox();
  await page.mouse.dblclick(e27.x+e27.width/2, e27.y+e27.height-10); await page.waitForTimeout(300);
  check('R19_dblclickPast', await toastText(page)==='No se puede añadir a un día pasado' && await page.evaluate(()=>!document.querySelector('#sheet').classList.contains('on')));
  // "N más" opens the day; the day number opens its week
  await page.click('#desk .mday[data-day="2026-11-07"] .mmore'); await page.waitForTimeout(300);
  check('R19_moreOpensDay', await page.evaluate(()=>UI.deskView==='day' && UI.calDay==='2026-11-07'));
  await page.click('#desk [data-cal-view=month]'); await page.waitForTimeout(300);
  await page.click('#desk .mday[data-day="2026-11-19"] .mnum'); await page.waitForTimeout(300);
  r.numWeek = await page.evaluate(()=>({v:UI.deskView, days:[...document.querySelectorAll('#desk .wday')].map(d=>d.dataset.day)}));
  check('R19_numberOpensWeek', r.numWeek.v==='week' && r.numWeek.days[0]==='2026-11-18' && r.numWeek.days.includes('2026-11-19'), r.numWeek); // seven days from today: the 18th starts the third week

  /* ---------- R19: the mini month in the sidebar ---------- */
  r.mini = await page.evaluate(()=>{ const m=document.querySelector('#desk .side .minical'); const sem=document.querySelector('#desk .side [data-view=week]');
    return {after:sem.nextElementSibling===m, head:m.querySelector('.cal-head span').textContent, today:m.querySelector('.cal-d.today').dataset.mini, inr:[...m.querySelectorAll('.cal-d.inr')].map(c=>c.dataset.mini),
      dots:m.querySelector('[data-mini="2026-11-07"] i.ld').children.length, none:!m.querySelector('[data-mini="2026-11-25"] i.ld'), past:!m.querySelector('[data-mini="2026-11-02"]').disabled}; });
  check('R19_miniMonth', r.mini.after && r.mini.head==='Noviembre 2026' && r.mini.today==='2026-11-04' && r.mini.dots===3 && r.mini.none && r.mini.past, r.mini);
  check('R19_miniRange', r.mini.inr.length===7 && r.mini.inr[0]==='2026-11-18' && r.mini.inr[6]==='2026-11-24', r.mini.inr);
  await page.click('#desk .minical [data-mini="2026-11-09"]'); await page.waitForTimeout(300);
  r.miniWeek = await page.evaluate(()=>({v:UI.deskView, first:document.querySelector('#desk .wday').dataset.day}));
  check('R19_miniOpensWeek', r.miniWeek.v==='week' && r.miniWeek.first==='2026-11-04', r.miniWeek); // the 9th is in the default seven days
  await page.click('#desk .minical [data-cal="1"]'); await page.waitForTimeout(200);
  check('R19_miniNav', await page.evaluate(()=>document.querySelector('#desk .minical .cal-head span').textContent==='Diciembre 2026' && UI.deskView==='week'));
  await page.click('#desk .minical [data-cal="-1"]'); await page.waitForTimeout(200);
  // Dropping a card on a mini day sets that date; a past mini day refuses
  await drag(page, '#desk .wcard[data-id=tC]', '#desk .minical [data-mini="2026-11-27"]');
  r.miniDrop = {d:await page.evaluate(()=>task('tC').date), t:await toastText(page)};
  check('R19_miniDrop', r.miniDrop.d==='2026-11-27' && /^Movida a /.test(r.miniDrop.t), r.miniDrop);
  await undo(page);
  await drag(page, '#desk .wcard[data-id=tC]', '#desk .minical [data-mini="2026-11-02"]');
  check('R19_miniPastRefused', await page.evaluate(()=>task('tC').date==='2026-11-05') && await toastText(page)==='No se puede mover a un día pasado');
  // In Hoy the mini month is there too; at 1280 px there is no agenda
  await page.click('#desk [data-view=hoy]'); await page.waitForTimeout(300);
  check('R20_noAgendaAt1280', await page.evaluate(()=>!!document.querySelector('#desk .side .minical') && getComputedStyle(document.querySelector('#desk .hagenda')).display==='none' && Math.round(document.querySelector('#desk .main .inner').getBoundingClientRect().width)===900));
  check('noErrorsLight', errors.length===0, errors.slice());
  await ctx.close();

  /* ---------- R20: the agenda of Hoy on a screen wider than 1400 px ---------- */
  ({ctx, page} = await open(browser, {viewport:{width:1500,height:900}, colorScheme:'dark'}));
  await page.click('#desk [data-view=hoy]'); await page.waitForTimeout(300);
  r.ag = await page.evaluate(()=>{ const a=document.querySelector('#desk .hagenda'), b=a.getBoundingClientRect(), l=document.querySelector('#desk .main .inner').getBoundingClientRect();
    return {disp:getComputedStyle(a).display, right:b.left>=l.right-1, w:Math.round(b.width), cols:a.querySelectorAll('.hcol').length, block:!!a.querySelector('.hb[data-id=tA]'), count:a.querySelector('.hcount').textContent, list:document.querySelectorAll('#desk .main .mbody .row').length, now:!!a.querySelector('.hnow')}; });
  check('R20_agenda', r.ag.disp==='flex' && r.ag.right && r.ag.cols===1 && r.ag.block && r.ag.count==='3 tareas sin hora' && r.ag.list>=4 && r.ag.now, r.ag);
  await page.screenshot({path:OUT+'/f-hoy-agenda-dark.png'});
  await drag(page, '#desk .hagenda .hb[data-id=tA]', '#desk .hagenda .hs[data-slot="2026-11-04T17:00"]');
  r.agDrop = {t:await page.evaluate(()=>fmtTime(task('tA').reminder)), toast:await toastText(page)};
  check('R20_agendaDrop', r.agDrop.t==='17:00' && r.agDrop.toast==='A las 17:00', r.agDrop);
  await undo(page);
  await page.evaluate(()=>openDetail('tB')); await page.waitForTimeout(300);
  check('R20_agendaGivesWayToPane', await page.evaluate(()=>getComputedStyle(document.querySelector('#desk .hagenda')).display==='none' && !!document.querySelector('#desk .pane')));
  await page.evaluate(()=>pop()); await page.waitForTimeout(250);
  // Dark calendar views render
  await page.evaluate(()=>{ DB.settings.calMode='hours'; setDeskView('week'); }); await page.waitForTimeout(300); await page.screenshot({path:OUT+'/f-week-hours-dark.png'});
  await page.evaluate(()=>setDeskView('month')); await page.waitForTimeout(300); await page.screenshot({path:OUT+'/f-month-dark.png'});
  check('noErrorsDark', errors.length===0, errors.slice());
  await ctx.close();

  /* ---------- The iPhone is unchanged ---------- */
  ({ctx, page} = await open(browser, {viewport:{width:390,height:844}, deviceScaleFactor:2, isMobile:true, hasTouch:true}));
  r.mob = await page.evaluate(()=>({wide:UI.wide, desk:!!document.querySelector('#desk'), mini:!!document.querySelector('.minical'), tab:UI.tab, rows:document.querySelectorAll('.screen.root[data-root=tareas] .row').length}));
  check('iPhone_unchanged', !r.mob.wide && !r.mob.desk && !r.mob.mini && r.mob.tab==='tareas' && r.mob.rows>=4, r.mob);
  // The calendar views have no iPhone screen: widening from the iPhone keeps the list, narrowing from Mes goes to Tareas
  await page.setViewportSize({width:1280, height:800}); await page.waitForTimeout(300);
  await page.evaluate(()=>setDeskView('month')); await page.waitForTimeout(200);
  await page.setViewportSize({width:390, height:844}); await page.waitForTimeout(300);
  check('iPhone_fromMonth', await page.evaluate(()=>!UI.wide && UI.tab==='tareas' && !document.querySelector('#desk')));
  await page.setViewportSize({width:1280, height:800}); await page.waitForTimeout(300);
  check('desk_keepsMonth', await page.evaluate(()=>UI.deskView==='month' && !!document.querySelector('#desk .month')));
  check('noErrorsMobile', errors.length===0, errors.slice());
  await ctx.close();

  await browser.close(); srv.close();
  console.log(JSON.stringify(Object.assign(r, {errors:fails.concat(errors.map(e=>'page: '+e))}), null, 1));
  process.exit(fails.length||errors.length?1:0);
})().catch(e=>{ console.error(e); console.log(JSON.stringify(Object.assign(r,{errors:fails.concat(['crash: '+e.message])}),null,1)); process.exit(1); });
