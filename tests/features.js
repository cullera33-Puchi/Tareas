require('./lib/out.js'); // outputs (screenshots, downloads) go to tests/out
const { chromium } = require('playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const TYPES = {'.html':'text/html','.css':'text/css','.js':'application/javascript','.webmanifest':'application/manifest+json','.png':'image/png'};
const srv = http.createServer((req,res)=>{ let p = decodeURIComponent(req.url.split('?')[0]); if(p==='/') p='/index.html'; const f=path.join(ROOT,p); if(!fs.existsSync(f)){res.writeHead(404);res.end();return;} res.writeHead(200,{'Content-Type':TYPES[path.extname(f)]||'application/octet-stream'}); res.end(fs.readFileSync(f)); });
(async()=>{
  await new Promise(r=>srv.listen(8777,r));
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport:{width:390,height:844}, deviceScaleFactor:2, isMobile:true, hasTouch:true });
  const page = await ctx.newPage(); await page.addInitScript(()=>{ if(!localStorage.getItem('tareas-v1')) localStorage.setItem('tareas-v1', JSON.stringify({spaces:[{id:'trabajo',name:'Trabajo',order:0},{id:'personal',name:'Personal',order:1}],projects:[],tasks:[],voiceNotes:[],settings:{tipsSeen:true}})); }); const errors=[]; page.on('pageerror', e=>errors.push(e.message)); page.on('console', m=>{ if(m.type()==='error') errors.push(m.text()); });
  await page.goto('http://localhost:8777/'); await page.waitForTimeout(400); const r={};
  const T='.screen.root[data-root=tareas] ';
  r.bodyFont = await page.evaluate(()=>getComputedStyle(document.body).fontSize);
  r.activeTabFilled = await page.$eval('#tabbar button.on svg', e=>e.getAttribute('fill')==='currentColor');
  // Multi-add with dates in the title
  await page.click('.fab'); await page.waitForTimeout(250);
  r.appDimmed = await page.$eval('#app', e=>e.classList.contains('sheet-open'));
  await page.type('#sheet .titlein','Llamar a Marta mañana'); await page.waitForTimeout(50);
  /* R5: chips live in the strip of the date icon; the recognised date lights the icon and the chip in the strip */ await page.click('#sheet .qbtn[data-k=date]'); r.chipAuto = await page.$eval('#sheet [data-c=man]', e=>e.classList.contains('on')) && await page.$eval('#sheet .qbtn[data-k=date]', e=>e.classList.contains('set'));
  await page.keyboard.press('Enter'); await page.waitForTimeout(250);
  r.stillOpen = await page.$eval('#sheet', e=>e.classList.contains('on')); r.hint1 = await page.$eval('#addHint', e=>e.textContent);
  await page.type('#sheet .titlein','Enviar acta el 12'); await page.keyboard.press('Enter'); await page.waitForTimeout(200);
  await page.type('#sheet .titlein','Revisar SOW viernes'); await page.keyboard.press('Enter'); await page.waitForTimeout(200);
  await page.type('#sheet .titlein','Sin fecha ninguna'); await page.click('#sheet [data-x=ok]'); await page.waitForTimeout(400);
  r.added = await page.evaluate(()=>DB.tasks.map(x=>[x.title, x.date===addDays(todayStr(),1)?'tomorrow':x.date]));
  r.toast = await page.$eval('#toastText', e=>e.textContent);
  r.appUndimmed = await page.$eval('#app', e=>!e.classList.contains('sheet-open'));
  // Todas grouped + counts
  await page.click(T+'[data-filter=todas]'); await page.waitForTimeout(200);
  r.groups = await page.$$eval(T+'.group-title', g=>g.map(x=>x.textContent));
  r.segCounts = await page.$$eval(T+'.seg .n', n=>n.map(x=>x.textContent));
  await page.screenshot({path:'18-todas-grouped.png'});
  // Summary filter
  await page.click(T+'[data-filter=hoy]'); await page.waitForTimeout(200);
  await page.evaluate(()=>{ addTask({title:'Urgente hoy',date:todayStr(),priority:'high'}); addTask({title:'Normal hoy',date:todayStr()}); render(); }); await page.waitForTimeout(200);
  await page.click(T+'[data-sum=high]'); await page.waitForTimeout(200);
  r.sumHigh = await page.$$eval(T+'.group .row .row-title', t=>t.map(x=>x.textContent));
  await page.click(T+'[data-sum=carried]'); await page.waitForTimeout(200);
  r.sumCarriedEmpty = await page.$eval(T+'.empty b', e=>e.textContent).catch(()=>null);
  await page.click(T+'[data-sum=all]'); await page.waitForTimeout(200);
  r.sumAll = await page.$$eval(T+'.group .row', x=>x.length);
  // Priority marks and two-line title
  r.priMark = await page.$eval(T+'.pri.high', e=>e.textContent);
  // Search with cancel and count
  await page.fill(T+'[data-role=search]','hoy'); await page.waitForTimeout(250);
  r.searchTitle = await page.$eval(T+'.group-title', e=>e.textContent); r.cancelShown = !!(await page.$(T+'.searchbar .cancel'));
  await page.click(T+'[data-act=clearSearch]'); await page.waitForTimeout(200); r.searchCleared = await page.$eval(T+'[data-role=search]', e=>e.value==='');
  // Long-press menu contents
  await page.evaluate(()=>rowMenu(DB.tasks[0].id)); await page.waitForTimeout(250);
  // Batch D (R10): the iPhone row menu is the anchored menu (#pmenu): priority buttons first, then the options; closed as a tap outside would
  r.rowMenu = await page.$$eval('#pmenu .pm-prio button, #pmenu .pm-it', b=>b.map(x=>x.textContent.trim()));
  await page.evaluate(()=>closeMenu()); await page.waitForTimeout(350);
  // Delete from row asks for confirmation
  const n0 = await page.evaluate(()=>DB.tasks.length);
  await page.evaluate(()=>{ const row=document.querySelector('.screen.root[data-root=tareas] .group .row'); row.querySelector('[data-act=delete]').click(); }); await page.waitForTimeout(250);
  r.deleteAsks = await page.$$eval('#asheet .it', b=>b.map(x=>x.textContent.trim()));
  await page.click('#asheet .it.red'); await page.waitForTimeout(600);
  r.deleted = (await page.evaluate(()=>DB.tasks.length))===n0-1;
  // Complete via check: row leaves, list re-renders without errors
  // R1: the row is first marked and stays (held) for 1.5 s, then leaves
  await page.click(T+'.group .row [data-act=check]'); await page.waitForTimeout(100);
  r.held = await page.$eval(T+'.group .row', e=>e.classList.contains('held'));
  r.leaving = await page.evaluate(sel=>new Promise(res=>{ const mo=new MutationObserver(()=>{ if(document.querySelector(sel)){ mo.disconnect(); res(true); } }); mo.observe(document.body,{subtree:true,attributes:true,attributeFilter:['class']}); setTimeout(()=>{ mo.disconnect(); res(false); },2500); }), T+'.group .row.leaving');
  await page.waitForTimeout(600); r.doneCount = await page.evaluate(()=>DB.tasks.filter(x=>x.status==='done').length);
  // Date sheet chips
  await page.evaluate(()=>dateSheet(DB.tasks[0].id)); await page.waitForTimeout(250);
  r.dateChips = await page.$$eval('#sheet .chip', c=>c.map(x=>x.textContent)); await page.evaluate(()=>closeSheet()); await page.waitForTimeout(300);
  // Project reorder
  await page.evaluate(()=>{ addProject('A','#FF3B30'); addProject('B','#007AFF'); addProject('C','#34C759'); });
  await page.evaluate(()=>moveProject(DB.projects[2].id,-1)); await page.waitForTimeout(100);
  r.projectOrder = await page.evaluate(()=>activeProjects().map(p=>p.name));
  await page.click('#tabbar [data-tab=proyectos]'); await page.waitForTimeout(200);
  r.pill = await page.$eval('.screen.root[data-root=proyectos] .count', e=>getComputedStyle(e).borderRadius);
  await page.evaluate(()=>projectMenu(DB.projects[0].id)); await page.waitForTimeout(250);
  r.projectMenu = await page.$$eval('#pmenu .pm-it', b=>b.map(x=>x.textContent.trim())); await page.evaluate(()=>closeMenu()); await page.waitForTimeout(350); // batch D: anchored menu
  // Notes grow in the detail
  await page.click('#tabbar [data-tab=tareas]'); await page.waitForTimeout(200);
  await page.evaluate(()=>{ DB.tasks[1].notes='línea\n'.repeat(12); save(); openDetail(DB.tasks[1].id); }); await page.waitForTimeout(500);
  r.notesHeight = await page.$eval('.pushed-screen [data-role=notes]', e=>parseInt(e.style.height));
  // Empty state actions
  await page.evaluate(()=>{ pop(); }); await page.waitForTimeout(400);
  await page.evaluate(()=>{ DB.tasks.forEach(x=>{ if(x.status==='pending') x.date=addDays(todayStr(),3); }); save(); render(); }); await page.waitForTimeout(200);
  r.emptyActs = await page.$$eval(T+'.empty .btn-link', b=>b.map(x=>x.textContent));
  await page.screenshot({path:'19-empty-today.png'});
  r.errors=errors; console.log(JSON.stringify(r,null,1)); await browser.close(); srv.close();
})().catch(e=>{ console.error(e); process.exit(1); });
