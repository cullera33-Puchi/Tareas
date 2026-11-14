require('./lib/out.js'); const { openSetting } = require('./lib/settings.js'); // v0.37.4: Ajustes in subscreens on the iPhone // outputs (screenshots, downloads) go to tests/out
const { chromium } = require('playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const TYPES = {'.html':'text/html','.css':'text/css','.js':'application/javascript','.webmanifest':'application/manifest+json','.png':'image/png'};
const srv = http.createServer((req,res)=>{ let p = decodeURIComponent(req.url.split('?')[0]); if(p==='/') p='/index.html'; const f=path.join(ROOT,p); if(!fs.existsSync(f)){res.writeHead(404);res.end();return;} res.writeHead(200,{'Content-Type':TYPES[path.extname(f)]||'application/octet-stream'}); res.end(fs.readFileSync(f)); });
(async()=>{
  await new Promise(r=>srv.listen(8783,r));
  const browser = await chromium.launch(); const r={};
  // 1) First run: tips sheet, then dismiss
  let ctx = await browser.newContext({ viewport:{width:390,height:844}, deviceScaleFactor:2, isMobile:true, hasTouch:true });
  let page = await ctx.newPage(); const errors=[]; page.on('pageerror', e=>errors.push(e.message)); page.on('console', m=>{ if(m.type()==='error') errors.push(m.text()); });
  await page.goto('http://localhost:8783/'); await page.waitForTimeout(900);
  r.tipsShown = await page.$eval('#sheet', e=>e.classList.contains('on')&&/Tres gestos/.test(e.textContent)); await page.screenshot({path:'29-tips.png'});
  await page.click('#sheet [data-x=ok]'); await page.waitForTimeout(400); r.tipsSeen = await page.evaluate(()=>DB.settings.tipsSeen);
  // Backups: daily one created at start
  await page.waitForTimeout(400); r.backups = await page.evaluate(()=>BACKUPS.map(b=>b.date===todayStr()?'today:'+b.tasks:b.date));
  // 2) URL entry with ?add=
  await page.goto('http://localhost:8783/?add=Llamar%20a%20Marta%20ma%C3%B1ana'); await page.waitForTimeout(900);
  r.urlAdd = await page.evaluate(()=>({open:document.querySelector('#sheet').classList.contains('on'), value:(document.querySelector('#sheet .titlein')||{}).value, chip:!!document.querySelector('#sheet .qbtn[data-k=date].set') /* R5: the date chip is now the lit date icon */, url:location.search}));
  await page.click('#sheet [data-x=ok]'); await page.waitForTimeout(400); r.urlTask = await page.evaluate(()=>DB.tasks.map(x=>x.title+'|'+(x.date===addDays(todayStr(),1)?'tomorrow':x.date)));
  // 3) Detail title grows; reminder chips
  await page.evaluate(()=>{ addTask({title:'Hoy uno',date:todayStr()}); DB.tasks[0].title='Un título bastante largo que no cabe en una sola línea del detalle de la tarea'; save(); render(); openDetail(DB.tasks[0].id); }); await page.waitForTimeout(500);
  r.titleTextarea = await page.$eval('.pushed-screen [data-role=title]', e=>e.tagName+' h='+parseInt(e.style.height));
  await page.click('.pushed-screen [data-act=pickReminder]'); await page.waitForTimeout(300); r.reminderChips = await page.$$eval('#sheet .chip', c=>c.map(x=>x.textContent)); await page.evaluate(()=>closeSheet()); await page.waitForTimeout(300);
  await page.evaluate(()=>pop()); await page.waitForTimeout(500);
  // 4) Done today + all done + tomorrow preview
  await page.click('.screen.root[data-root=tareas] [data-filter=hoy]'); await page.waitForTimeout(200);
  r.preview = await page.$eval('.screen.root[data-root=tareas] .preview', e=>e.textContent).catch(()=>null);
  await page.evaluate(()=>{ completeTask(DB.tasks[1].id,true); render(); }); await page.waitForTimeout(200);
  r.doneLabel = await page.$eval('.screen.root[data-root=tareas] [data-act=toggleDone] span', e=>e.textContent);
  // Decision 52: the day done is said by the empty state of Hoy (the summary line is gone)
  // Owner, 3 November: one discreet line, no icon and no links
  r.allDone = await page.evaluate(()=>({left:pendingFor('hoy').length, line:(document.querySelector('.screen.root[data-root=tareas] .hoydone')||{}).textContent||null, big:!!document.querySelector('.screen.root[data-root=tareas] .empty')}));
  if(r.allDone.left===0 && !(r.allDone.line==='Todo hecho por hoy, 1 completada' && !r.allDone.big)) errors.push('all done: '+JSON.stringify(r.allDone));
  await page.screenshot({path:'30-alldone.png'});
  // 5) Shake toggle (Chromium: no requestPermission -> enables)
  await page.click('#tabbar [data-tab=ajustes]'); await page.waitForTimeout(200);
  await page.evaluate(()=>{ DeviceMotionEvent.requestPermission=()=>Promise.resolve('granted'); document.querySelector('.screen.root[data-root=ajustes] [data-act=shakeToggle]').scrollIntoView({block:'center'}); }); await page.waitForTimeout(100); await page.click('.screen.root[data-root=ajustes] [data-act=shakeToggle]'); await page.waitForTimeout(400);
  r.shake = await page.evaluate(()=>({on:DB.settings.shakeUndo, armed:shakeArmed, sw:document.querySelector('.screen.root[data-root=ajustes] .switch').classList.contains('on')}));
  // Simulate a shake while a toast with undo is showing
  await page.evaluate(()=>{ toast('prueba', ()=>{ window.__undone=true; }); onMotion({accelerationIncludingGravity:{x:0,y:0,z:9.8}}); onMotion({accelerationIncludingGravity:{x:25,y:20,z:9.8}}); }); await page.waitForTimeout(200);
  r.shakeUndid = await page.evaluate(()=>window.__undone===true);
  // 6) Backup now + restore
  await openSetting(page, 'datos'); await page.evaluate(()=>document.querySelector('.screen.settings [data-act=backupNow]').scrollIntoView({block:'center'})); await page.click('.screen.settings [data-act=backupNow]'); await page.waitForTimeout(600);
  const before = await page.evaluate(()=>DB.tasks.length);
  await page.evaluate(()=>{ DB.tasks=[]; save(); render(); }); await page.waitForTimeout(200);
  await page.evaluate(()=>document.querySelector('.screen.settings [data-restore]').scrollIntoView({block:'center'})); await page.click('.screen.settings [data-restore]'); await page.waitForTimeout(300); await page.click('#asheet .it.red'); await page.waitForTimeout(800);
  r.restored = (await page.evaluate(()=>DB.tasks.length))===before; r.restoreToast = await page.$eval('#toastText', e=>e.textContent);
  await page.screenshot({path:'31-settings-backups.png'});
  r.errors=errors; console.log(JSON.stringify(r,null,1)); await browser.close(); srv.close();
})().catch(e=>{ console.error(e); process.exit(1); });
