require('./lib/out.js'); // outputs (screenshots, downloads) go to tests/out
const { chromium } = require('playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const TYPES = {'.html':'text/html','.css':'text/css','.js':'application/javascript','.webmanifest':'application/manifest+json','.png':'image/png'};
const srv = http.createServer((req,res)=>{ let p = decodeURIComponent(req.url.split('?')[0]); if(p==='/') p='/index.html'; const f=path.join(ROOT,p); if(!fs.existsSync(f)){res.writeHead(404);res.end();return;} res.writeHead(200,{'Content-Type':TYPES[path.extname(f)]||'application/octet-stream'}); res.end(fs.readFileSync(f)); });
(async()=>{
  await new Promise(r=>srv.listen(8786,r));
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport:{width:390,height:844}, deviceScaleFactor:2, isMobile:true, hasTouch:true });
  const page = await ctx.newPage(); await page.addInitScript(()=>{ localStorage.setItem('tareas-v1', JSON.stringify({spaces:[{id:'trabajo',name:'Trabajo',order:0},{id:'personal',name:'Personal',order:1}],projects:[],tasks:[],voiceNotes:[],settings:{tipsSeen:true}})); });
  const errors=[]; page.on('pageerror', e=>errors.push(e.message)); page.on('console', m=>{ if(m.type()==='error') errors.push(m.text()); });
  await page.goto('http://localhost:8786/'); await page.waitForTimeout(500); const r={}; const T='.screen.root[data-root=tareas] ';
  await page.evaluate(()=>{ const a=addProject('FLC','#FF9500'), b=addProject('Verifactu','#007AFF'); const t=todayStr(); ['A1','A2','A3'].forEach(n=>addTask({title:n,date:t,projectId:a.id})); ['B1','B2'].forEach(n=>addTask({title:n,date:addDays(t,3),projectId:b.id})); addTask({title:'Suelta',date:t}); render(); }); await page.waitForTimeout(200);
  // Todas by project
  await page.click(T+'[data-filter=todas]'); await page.waitForTimeout(200);
  // Updated by batch C (R13): the grouping is picked from the view menu (three dots of the bar); the mini segment is gone
  // Updated by batch D (R10): on the iPhone every menu but the confirmations is the anchored menu (#pmenu .pm-it)
  const pick = async t => { await page.click(T+'.nav .vopts'); await page.waitForTimeout(500); await page.evaluate(t=>[...document.querySelectorAll('#pmenu .pm-it')].find(b=>b.textContent.startsWith(t)).click(), t); await page.waitForTimeout(300); }; /* batch I: menus ignore taps for 450 ms after opening (v0.14.1 guard), so the test waits 500 */
  r.miniSeg = await page.$$eval(T+'.seg.mini button', b=>b.map(x=>x.textContent)); await pick('Agrupar por proyecto');
  r.projectGroups = await page.$$eval(T+'.group-title', g=>g.map(x=>x.textContent.trim())); await page.screenshot({path:'32-todas-proyecto.png'});
  await pick('Agrupar por fecha'); r.dateGroups = await page.$$eval(T+'.group-title', g=>g.map(x=>x.textContent.trim()));
  await page.click(T+'[data-filter=hoy]'); await page.waitForTimeout(200);
  // Enter selection from the long-press menu
  await page.evaluate(()=>rowMenu(DB.tasks[0].id)); await page.waitForTimeout(250); r.menu = await page.$$eval('#pmenu .pm-it', b=>b.map(x=>x.textContent.trim()));
  await page.click('#pmenu .pm-it:has-text("Más")'); await page.waitForTimeout(400); // v0.37.4 (decision 84): Seleccionar is under Más
  await page.click('#pmenu .pm-it:has-text("Seleccionar")'); await page.waitForTimeout(400);
  r.enter = await page.evaluate(()=>({selecting:document.querySelector('#app').classList.contains('selecting'), title:document.querySelector('#selTitle').textContent, selboxes:document.querySelectorAll('.screen.root[data-root=tareas] .selbox').length, selected:document.querySelectorAll('.screen.root[data-root=tareas] .row.selected').length, bar:[...document.querySelectorAll('#selbar button')].map(b=>b.textContent+(b.disabled?'(off)':'')), tabbarHidden:getComputedStyle(document.querySelector('#tabbar')).display==='none'}));
  // Tap another row toggles selection, no detail opens
  await page.click(T+'.group .row:nth-child(2) .row-title'); await page.waitForTimeout(150);
  r.afterTap = await page.evaluate(()=>({title:document.querySelector('#selTitle').textContent, stack:UI.stack.length, selected:document.querySelectorAll('.screen.root[data-root=tareas] .row.selected').length}));
  await page.screenshot({path:'33-select.png'});
  // Select all, then bulk postpone
  await page.click(T+'[data-act=selAll]'); await page.waitForTimeout(200); r.all = await page.evaluate(()=>UI.select.ids.size+' '+document.querySelector('#selTitle').textContent);
  await page.click('#selbar [data-act=bulkPostpone]'); await page.waitForTimeout(250); r.postponeOpts = await page.$$eval('#pmenu .pm-it', b=>b.map(x=>x.textContent.trim()));
  await page.click('#pmenu .pm-it:has-text("Mañana")'); await page.waitForTimeout(500);   // Mañana
  r.afterPostpone = await page.evaluate(()=>({selecting:!!UI.select, tomorrow:DB.tasks.filter(x=>x.date===addDays(todayStr(),1)).length, toast:document.querySelector('#toastText').textContent}));
  await page.click('#toastBtn'); await page.waitForTimeout(300); r.undone = await page.evaluate(()=>DB.tasks.filter(x=>x.date===todayStr()).length);
  // Bulk complete two, bulk delete one with confirm, bulk move
  await page.evaluate(()=>startSelect(DB.tasks[0].id)); await page.waitForTimeout(300); await page.click(T+'.group .row:nth-child(2) .row-title'); await page.click('#selbar [data-act=bulkComplete]'); await page.waitForTimeout(400);
  r.completed = await page.evaluate(()=>DB.tasks.filter(x=>x.status==='done').length);
  await page.evaluate(()=>startSelect(DB.tasks.find(x=>x.status==='pending').id)); await page.waitForTimeout(300); await page.click('#selbar [data-act=bulkDelete]'); await page.waitForTimeout(250); r.deleteAsk = await page.$$eval('#asheet .it', b=>b.map(x=>x.textContent.trim())); await page.click('#asheet .it.red'); await page.waitForTimeout(400);
  r.afterDelete = await page.evaluate(()=>DB.tasks.length);
  await page.evaluate(()=>startSelect(DB.tasks.find(x=>x.status==='pending').id)); await page.waitForTimeout(300); await page.click('#selbar [data-act=bulkMove]'); await page.waitForTimeout(500); await page.evaluate(()=>document.querySelectorAll('#pmenu .pm-it')[1].click()); await page.waitForTimeout(400); // the first project, after Sin proyecto /* batch I: menus ignore taps for 450 ms after opening (v0.14.1 guard), so the test waits 500 */
  r.moveToast = await page.$eval('#toastText', e=>e.textContent);
  // Selection inside a project screen, then back ends it
  await page.click('#tabbar [data-tab=proyectos]'); await page.waitForTimeout(200); await page.click('.screen.root[data-root=proyectos] [data-open-project]'); await page.waitForTimeout(500);
  await page.evaluate(()=>startSelect(null)); await page.waitForTimeout(300); r.projScope = await page.evaluate(()=>UI.select.scope+' '+!!document.querySelector('.pushed-screen #selTitle'));
  await page.evaluate(()=>pop()); await page.waitForTimeout(500); r.afterBack = await page.evaluate(()=>!UI.select && !document.querySelector('#app').classList.contains('selecting'));
  r.errors=errors; console.log(JSON.stringify(r,null,1)); await browser.close(); srv.close();
})().catch(e=>{ console.error(e); process.exit(1); });
