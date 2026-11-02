require('./lib/out.js'); // outputs (screenshots, downloads) go to tests/out
const { chromium } = require('playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const TYPES = {'.html':'text/html','.css':'text/css','.js':'application/javascript','.webmanifest':'application/manifest+json','.png':'image/png'};
const srv = http.createServer((req,res)=>{ let p = decodeURIComponent(req.url.split('?')[0]); if(p==='/') p='/index.html'; const f=path.join(ROOT,p); if(!fs.existsSync(f)){res.writeHead(404);res.end();return;} res.writeHead(200,{'Content-Type':TYPES[path.extname(f)]||'application/octet-stream'}); res.end(fs.readFileSync(f)); });
(async()=>{
  await new Promise(r=>srv.listen(8781,r));
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport:{width:390,height:844}, deviceScaleFactor:2, isMobile:true, hasTouch:true });
  const page = await ctx.newPage(); await page.addInitScript(()=>{ if(!localStorage.getItem('tareas-v1')) localStorage.setItem('tareas-v1', JSON.stringify({spaces:[{id:'trabajo',name:'Trabajo',order:0},{id:'personal',name:'Personal',order:1}],projects:[],tasks:[],voiceNotes:[],settings:{tipsSeen:true}})); }); const errors=[]; page.on('pageerror', e=>errors.push(e.message)); page.on('console', m=>{ if(m.type()==='error') errors.push(m.text()); });
  await page.goto('http://localhost:8781/'); await page.waitForTimeout(400); const r={}; const T='.screen.root[data-root=tareas] ';
  r.hapSwitch = await page.$eval('#hap', e=>e.getAttribute('switch')!==null);
  r.summaryFirst = await page.evaluate(()=>UI.summaryFirst+' '+(DB.settings.summaryDay===todayStr()));
  await page.evaluate(()=>{ const p=addProject('FLC','#FF9500'); addTask({title:'Con enlace',date:addDays(todayStr(),3),projectId:p.id,notes:'Reunión en https://teams.microsoft.com/l/meetup-join/abc y llamar al +34 600 123 456'}); addTask({title:'Hoy simple',date:todayStr()}); for(let i=0;i<22;i++) addTask({title:'T'+i,date:todayStr()}); render(); });
  await page.waitForTimeout(200);
  r.summaryOpenFirstTime = !(await page.$eval(T+'.summary', e=>e.classList.contains('collapsed')));
  await page.click(T+'[data-filter=todas]'); await page.waitForTimeout(200);
  r.weekday = await page.$eval(T+'.row[data-id] .row-meta', e=>e.textContent);
  r.indicator = await page.$eval(T+'.row[data-id] .row-content > .inds svg', e=>!!e); // R3 moved the indicators out of the meta line, to the right
  // Detail: links strip and voice note linkify
  await page.click(T+'.group .row .row-title'); await page.waitForTimeout(500);
  r.links = await page.$$eval('.pushed-screen .links a', a=>a.map(x=>x.textContent+' -> '+x.getAttribute('href')));
  await page.screenshot({path:'26-detail-links.png'});
  // Duplicate from the detail menu
  await page.click('.pushed-screen [data-act=menu]'); await page.waitForTimeout(250); r.detailMenu = await page.$$eval('#pmenu .pm-it', b=>b.map(x=>x.textContent.trim()));
  await page.click('#pmenu .pm-it:has-text("Duplicar")'); await page.waitForTimeout(600);   // batch D (R10): the detail menu is anchored (#pmenu)
  r.afterDup = await page.evaluate(()=>({n:DB.tasks.filter(x=>x.title==='Con enlace').length, stack:UI.stack.length, topTitle:document.querySelector('.pushed-screen:last-child [data-role=title]').value}));
  // Move to other space from the detail menu
  await page.click('.pushed-screen:last-child [data-act=menu]'); await page.waitForTimeout(500); await page.click('#pmenu .pm-it:has-text("Mover a otro espacio")'); await page.waitForTimeout(350); // a submenu in place /* batch I: menus ignore taps for 450 ms after opening (v0.14.1 guard), so the test waits 500 */
  r.spaceOptions = await page.$$eval('#pmenu .pm-it', b=>b.map(x=>x.textContent.trim())); await page.click('#pmenu .pm-it:has-text("Personal")'); await page.waitForTimeout(700);
  r.moved = await page.evaluate(()=>({personal:DB.tasks.filter(x=>x.spaceId==='personal').map(x=>x.title+'/'+x.projectId), toast:document.querySelector('#toastText').textContent, stack:UI.stack.length}));
  await page.evaluate(()=>{ while(UI.stack.length) pop(); }); await page.waitForTimeout(500);
  // Priority with undo toast
  await page.evaluate(()=>setPriority(DB.tasks[1].id,'high')); await page.waitForTimeout(100); r.prioToast = await page.$eval('#toastText', e=>e.textContent)+' / undo '+(await page.$eval('#toastBtn', e=>e.style.display!=='none'));
  // Search including completed
  await page.evaluate(()=>{ completeTask(DB.tasks[2].id,true); }); await page.click(T+'[data-filter=hoy]');
  await page.fill(T+'[data-role=search]','T0'); await page.waitForTimeout(250);
  r.searchDoneLink = await page.$eval(T+'[data-act=searchDone]', e=>e.textContent).catch(()=>null);
  if(r.searchDoneLink){ await page.click(T+'[data-act=searchDone]'); await page.waitForTimeout(200); r.searchDoneGroups = await page.$$eval(T+'.group-title', g=>g.map(x=>x.textContent)); }
  await page.click(T+'[data-act=clearSearch]'); await page.waitForTimeout(200);
  // Add and open
  await page.click('.fab'); await page.waitForTimeout(250); await page.type('#sheet .titlein','Preparar acta'); /* R5: 'Añadir y abrir' is a long press on Añadir */ { const b=await page.$eval('#sheet [data-x=ok]', e=>{ const r=e.getBoundingClientRect(); return {x:r.x+r.width/2, y:r.y+r.height/2}; }); await page.mouse.move(b.x,b.y); await page.mouse.down(); await page.waitForTimeout(650); await page.mouse.up(); } await page.waitForTimeout(600);
  r.addOpen = await page.evaluate(()=>({stack:UI.stack.length, title:(document.querySelector('.pushed-screen [data-role=title]')||{}).value}));
  await page.evaluate(()=>pop()); await page.waitForTimeout(500);
  // Projects tab icons
  await page.click('#tabbar [data-tab=proyectos]'); await page.waitForTimeout(200); r.picons = await page.$$eval('.screen.root[data-root=proyectos] .picon', p=>p.length); await page.screenshot({path:'27-projects-icons.png'});
  r.errors=errors; console.log(JSON.stringify(r,null,1)); await browser.close(); srv.close();
})().catch(e=>{ console.error(e); process.exit(1); });
