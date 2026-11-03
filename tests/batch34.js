require('./lib/out.js'); // outputs (screenshots, downloads) go to tests/out
const { chromium } = require('playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const TYPES = {'.html':'text/html','.css':'text/css','.js':'application/javascript','.webmanifest':'application/manifest+json','.png':'image/png'};
const srv = http.createServer((req,res)=>{ let p = decodeURIComponent(req.url.split('?')[0]); if(p==='/') p='/index.html'; const f=path.join(ROOT,p); if(!fs.existsSync(f)){res.writeHead(404);res.end();return;} res.writeHead(200,{'Content-Type':TYPES[path.extname(f)]||'application/octet-stream'}); res.end(fs.readFileSync(f)); });
(async()=>{
  await new Promise(r=>srv.listen(8779,r));
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport:{width:390,height:844}, deviceScaleFactor:2, isMobile:true, hasTouch:true });
  const page = await ctx.newPage(); await page.addInitScript(()=>{ if(!localStorage.getItem('tareas-v1')) localStorage.setItem('tareas-v1', JSON.stringify({spaces:[{id:'trabajo',name:'Trabajo',order:0},{id:'personal',name:'Personal',order:1}],projects:[],tasks:[],voiceNotes:[],settings:{tipsSeen:true}})); }); const errors=[]; page.on('pageerror', e=>errors.push(e.message)); page.on('console', m=>{ if(m.type()==='error') errors.push(m.text()); });
  await page.goto('http://localhost:8779/'); await page.waitForTimeout(400); const r={}; const T='.screen.root[data-root=tareas] ';
  // Few tasks: two blocks when carried + today; decision 52: no day summary
  await page.evaluate(()=>{ const p=addProject('Comité','#FF9500'); addTask({title:'De ayer',date:addDays(todayStr(),-1),projectId:p.id}); addTask({title:'Hoy normal',date:todayStr()}); rollOver(); render(); }); await page.waitForTimeout(200);
  r.noSummary = await page.evaluate(T=>!document.querySelector(T+'.summary')&&!document.querySelector(T+'[data-sum]'), T); if(!r.noSummary) errors.push('day summary still drawn');
  r.hoyGroups = await page.$$eval(T+'.group-title', g=>g.map(x=>x.textContent));
  r.tag = await page.$eval(T+'.tag', e=>({text:e.textContent, bg:getComputedStyle(e).backgroundColor, color:getComputedStyle(e).color}));
  // Accent-insensitive search incl. project name
  await page.fill(T+'[data-role=search]','comite'); await page.waitForTimeout(250); r.searchAccent = await page.$$eval(T+'.group .row .row-title', t=>t.map(x=>x.textContent));
  await page.click(T+'[data-act=clearSearch]'); await page.waitForTimeout(200);
  // Postpone sheet from the row button
  await page.evaluate(()=>{ document.querySelector('.screen.root[data-root=tareas] .group .row [data-act=postpone]').click(); }); await page.waitForTimeout(500); /* batch I: a tap-opened menu ignores taps for 450 ms (v0.14.1 guard) */
  // Batch D (R10): on the iPhone the postpone options are an anchored menu (#pmenu .pm-it); the date shows under the label
  r.postponeItems = await page.$$eval('#pmenu .pm-it', b=>b.map(x=>x.textContent.trim()));
  // G4a (F100): an option whose date is already offered is left out, so on a Sunday "Próxima semana" (Monday) is gone and "Mañana" is that same date; pick by text, not by position
  await page.evaluate(()=>{ const its=[...document.querySelectorAll('#pmenu .pm-it')]; (its.find(b=>b.textContent.startsWith('Próxima semana'))||its.find(b=>b.textContent.trim()==='Mañana'&&addDays(todayStr(),1)===nextWeekday(1,true))).click(); }); await page.waitForTimeout(600);   // "Próxima semana"
  r.postponed = await page.evaluate(()=>({date:DB.tasks[0].date===nextWeekday(1,true)?'next monday':DB.tasks[0].date, toast:document.querySelector('#toastText').textContent}));
  // Many tasks: decision 52, still no summary (it used to fold itself over 20) and every task listed
  await page.evaluate(()=>{ for(let i=0;i<25;i++) addTask({title:'T'+i,date:todayStr()}); render(); }); await page.waitForTimeout(200);
  r.manyNoSummary = await page.evaluate(T=>({summary:!!document.querySelector(T+'.summary,'+T+'[data-act=toggleSummary]'), rows:document.querySelectorAll(T+'.group .row[data-id]').length, hoy:pendingFor('hoy').length}), T);
  if(r.manyNoSummary.summary || r.manyNoSummary.rows!==r.manyNoSummary.hoy) errors.push('many tasks: '+JSON.stringify(r.manyNoSummary));
  // Quick-add chips
  await page.click('.fab'); await page.waitForTimeout(250); /* R5: the date chips are in the strip of the date icon */ await page.click('#sheet .qbtn[data-k=date]'); r.chips = await page.$$eval('#sheet .chip', c=>c.map(x=>x.textContent)); const vk = await page.$('#sheet [data-c=vie]') ? 'vie' : 'man'; /* G4a (F54): on a Thursday 'Viernes' is tomorrow and only 'Mañana' is shown */ await page.click('#sheet [data-c='+vk+']'); r.vieDate = await page.evaluate(k=>{ /* R5: a pick closes the strip; the choice shows as the date token and the lit icon */ const t=document.querySelector('#sheet .tok[data-tok=date]'); return !!t && document.querySelector('#sheet .qbtn[data-k=date]').classList.contains('set') && t.textContent.replace('×','')===(k==='vie'?'Viernes':'Mañana'); }, vk); await page.evaluate(()=>closeSheet()); await page.waitForTimeout(400);
  // Detail structure
  await page.click(T+'.group .row .row-title'); await page.waitForTimeout(500);
  r.detail = await page.evaluate(()=>{ const d=document.querySelector('.pushed-screen'); return { title:d.querySelector('.nav-title').textContent, actions:[...d.querySelectorAll('.nav .actions .action')].map(b=>b.dataset.act), cells:[...d.querySelectorAll('.group .cell .lbl')].map(l=>l.textContent), noDropdown:!d.querySelector('#dmenu'), titleInCell:!!d.querySelector('.cell.input .titlein'), voiceCell:!!d.querySelector('[data-act=voice]') }; });
  await page.screenshot({path:'20-detail-ios.png'});
  await page.click('.pushed-screen [data-act=pickPriority]'); await page.waitForTimeout(500); /* batch I: menus ignore taps for 450 ms after opening (v0.14.1 guard) */ r.priorityMenu = await page.$$eval('#pmenu .pm-it', b=>b.map(x=>x.textContent.trim())); await page.click('#pmenu .pm-it:has-text("Alta")'); await page.waitForTimeout(400); // batch D: anchored menu, first option Alta as before
  r.priorityVal = await page.$eval('.pushed-screen [data-act=pickPriority] .val', e=>e.textContent+' '+e.className);
  await page.click('.pushed-screen [data-act=menu]'); await page.waitForTimeout(300); r.detailMenu = await page.$$eval('#pmenu .pm-it', b=>b.map(x=>x.textContent.trim())); await page.evaluate(()=>closeMenu()); await page.waitForTimeout(350); // batch D: anchored menu
  // Check pop class and project colour fill
  await page.click('.pushed-screen [data-act=back]'); await page.waitForTimeout(500);
  await page.click(T+'.group .row [data-act=check]'); await page.waitForTimeout(50);
  r.checkJust = await page.$eval(T+'.group .row .check', e=>e.classList.contains('just')+' '+getComputedStyle(e).backgroundColor);
  await page.waitForTimeout(600);
  // returnHome after two hours away
  await page.click('#tabbar [data-tab=ajustes]'); await page.evaluate(()=>{ hiddenAt=Date.now()-3*36e5; document.dispatchEvent(new Event('visibilitychange')); }); await page.waitForTimeout(300);
  r.home = await page.evaluate(()=>({tab:UI.tab, filter:DB.settings.filter}));
  await page.screenshot({path:'21-home-ios.png'});
  r.errors=errors; console.log(JSON.stringify(r,null,1)); await browser.close(); srv.close();
})().catch(e=>{ console.error(e); process.exit(1); });
