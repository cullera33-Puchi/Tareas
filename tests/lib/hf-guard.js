require('./out.js'); // outputs (screenshots, downloads) go to tests/out
// Adapted from the hotfix test guard.js (v0.14.1) for the merge of main into roadmap-r1-r20 (batch I).
// Same checks on the date sheet (now opened through pickerPanel), turned into assertions, plus the guard applied to the R10 anchored
// menus (mobile, 450 ms; not a long-press menu) and to the R17 date popover on the desktop (only the second click of a double click).
const { chromium } = require('playwright'); const http=require('http'),fs=require('fs'),path=require('path');
const ROOT=process.argv[2]||path.resolve(__dirname, '..', '..'), PORT=+(process.argv[3]||9413);
const srv=http.createServer((q,s)=>{let p=decodeURIComponent(q.url.split('?')[0]); if(p==='/')p='/index.html'; const f=path.join(ROOT,p); if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){s.writeHead(404);s.end();return;} s.writeHead(200,{'Content-Type':p.endsWith('.js')?'application/javascript':p.endsWith('.css')?'text/css':'text/html'}); s.end(fs.readFileSync(f));});
const errors=[]; const ok=(c,m)=>{ if(!c) errors.push(m); };
const seed=()=>{ if(!localStorage.getItem('tareas-v1')) localStorage.setItem('tareas-v1', JSON.stringify({spaces:[{id:'trabajo',name:'Trabajo',order:0}],projects:[],tasks:[],voiceNotes:[],settings:{tipsSeen:true}})); };
(async()=>{ await new Promise(r=>srv.listen(PORT,r)); const b=await chromium.launch(); const r={};
 { const page=await (await b.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true})).newPage(); await page.addInitScript(seed); page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://localhost:'+PORT+'/'); await page.waitForTimeout(400);
  await page.evaluate(()=>{ addProject('FLC','#FF9500'); addTask({title:'Uno',date:todayStr()}); render(); }); await page.tap('.screen.root[data-root=tareas] .group .row .row-title'); await page.waitForTimeout(700);
  // second tap on the same spot right after opening: must not close
  const box=await page.$eval('.pushed-screen [data-act=pickDate]', e=>{const r=e.getBoundingClientRect(); return [r.x+r.width/2, r.y+r.height/2];});
  await page.touchscreen.tap(box[0],box[1]); await page.waitForTimeout(120); await page.touchscreen.tap(box[0],box[1]); await page.waitForTimeout(300);
  r.openAfterDoubleTap=await page.evaluate(()=>sheet.classList.contains('on')); ok(r.openAfterDoubleTap,'date sheet survives a double tap');
  await page.waitForTimeout(500); await page.tap('#sheet .cal-d:not(.past):not(.other) >> nth=10'); await page.waitForTimeout(400);
  r.afterPick=await page.evaluate(()=>({open:sheet.classList.contains('on'), date:DB.tasks[0].date})); ok(!r.afterPick.open&&r.afterPick.date&&r.afterPick.date!==todayStrNode(),'a later pick works');
  await page.waitForTimeout(600); await page.tap('.pushed-screen [data-act=pickDate]'); await page.waitForTimeout(600); await page.tap('#scrim', {position:{x:200,y:60}}); await page.waitForTimeout(600);
  r.closedByScrimLater=await page.evaluate(()=>!sheet.classList.contains('on')); ok(r.closedByScrimLater,'scrim closes later');
  // R10 anchored menu (Proyecto of the detail): a double tap neither closes it nor picks an option
  const pb=await page.$eval('.pushed-screen [data-act=pickProject]', e=>{const r=e.getBoundingClientRect(); return [r.x+r.width-40, r.y+r.height/2];});
  await page.touchscreen.tap(pb[0],pb[1]); await page.waitForTimeout(120); await page.touchscreen.tap(pb[0],pb[1]); await page.waitForTimeout(250);
  r.menuAfterDouble=await page.evaluate(()=>({open:menuOpen(), proj:DB.tasks[0].projectId||null, log:LOG.slice(-3).map(e=>e.m)})); ok(r.menuAfterDouble.open&&!r.menuAfterDouble.proj,'menu survives a double tap');
  await page.waitForTimeout(400); await page.tap('#pmenu .pm-it:has-text("FLC")'); await page.waitForTimeout(500);
  r.menuPick=await page.evaluate(()=>({open:menuOpen(), proj:!!DB.tasks[0].projectId})); ok(!r.menuPick.open&&r.menuPick.proj,'menu option chosen later');
  // tap outside later closes it
  await page.tap('.pushed-screen [data-act=pickProject]'); await page.waitForTimeout(600); await page.touchscreen.tap(30,120); await page.waitForTimeout(500);
  r.menuOutside=await page.evaluate(()=>menuOpen()); ok(!r.menuOutside,'tap outside closes the menu later');
 }
 { const page=await (await b.newContext({viewport:{width:1280,height:800}})).newPage(); await page.addInitScript(seed); page.on('pageerror',e=>errors.push('desk: '+e.message));
  await page.goto('http://localhost:'+PORT+'/'); await page.waitForTimeout(400);
  await page.evaluate(()=>{ const x=addTask({title:'Dos'}); render(); openDetail(x.id); }); await page.waitForTimeout(500);
  // a double click on Fecha: the second click (detail 2) lands on the backdrop of the popover just opened and must not close it
  await page.dblclick('.pane [data-act=pickDate]'); await page.waitForTimeout(150);
  r.deskDouble=await page.evaluate(()=>({open:menuOpen(), date:DB.tasks[0].date})); ok(r.deskDouble.open&&!r.deskDouble.date,'popover survives a double click');
  await page.evaluate(()=>closeMenu(true)); await page.waitForTimeout(100);
  // a single quick click is never ignored on the desktop: a day picked 100 ms after the popover opened
  await page.click('.pane [data-act=pickDate]'); await page.waitForTimeout(100); const d=await page.$eval('#pmenu .pm-pop .cal-d:not(.past):not(.other):not(.sel)', e=>{const r=e.getBoundingClientRect(); return [r.x+r.width/2, r.y+r.height/2];});
  await page.mouse.click(d[0],d[1]); await page.waitForTimeout(400);
  r.deskPick=await page.evaluate(()=>({open:menuOpen(), date:DB.tasks[0].date})); ok(!r.deskPick.open&&!!r.deskPick.date,'quick single click picks');
 }
 console.log(JSON.stringify(r,null,1)); console.log(JSON.stringify({errors})); await b.close(); srv.close(); process.exit(errors.length?1:0); })().catch(e=>{console.error(e);process.exit(1)});
function todayStrNode(){ const d=new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
