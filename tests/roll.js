require('./lib/out.js'); // outputs (screenshots, downloads) go to tests/out
const { chromium } = require('playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const TYPES = {'.html':'text/html','.css':'text/css','.js':'application/javascript','.webmanifest':'application/manifest+json','.png':'image/png'};
const srv = http.createServer((req,res)=>{ let p = decodeURIComponent(req.url.split('?')[0]); if(p==='/') p='/index.html'; const f=path.join(ROOT,p); if(!fs.existsSync(f)){res.writeHead(404);res.end();return;} res.writeHead(200,{'Content-Type':TYPES[path.extname(f)]||'application/octet-stream'}); res.end(fs.readFileSync(f)); });
(async()=>{
  await new Promise(r=>srv.listen(8772,r));
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport:{width:390,height:844}, isMobile:true, hasTouch:true });
  const page = await ctx.newPage(); await page.addInitScript(()=>{ if(!localStorage.getItem('tareas-v1')) localStorage.setItem('tareas-v1', JSON.stringify({spaces:[{id:'trabajo',name:'Trabajo',order:0},{id:'personal',name:'Personal',order:1}],projects:[],tasks:[],voiceNotes:[],settings:{tipsSeen:true}})); }); const errors=[]; page.on('pageerror', e=>errors.push(e.message));
  const cdp = await ctx.newCDPSession(page);
  const swipe = async (x1,y1,x2,y2,steps=12)=>{ await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:x1,y:y1}]}); let minT=0; for(let i=1;i<=steps;i++){ await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x1+(x2-x1)*i/steps,y:y1}]}); await page.waitForTimeout(15); const tx=await page.$eval('.screen.root[data-root=tareas] .group .row .row-content', e=>new DOMMatrix(getComputedStyle(e).transform).m41); minT=Math.min(minT,tx);} await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]}); await page.waitForTimeout(450); return minT; };
  await page.goto('http://localhost:8772/'); await page.waitForTimeout(400);
  // Seed a task dated yesterday and one dated 3 days ago, then reload so rollOver runs at start
  await page.evaluate(()=>{ addTask({title:'De ayer',date:addDays(todayStr(),-1)}); addTask({title:'De hace tres días',date:addDays(todayStr(),-3),priority:'high'}); });
  await page.reload(); await page.waitForTimeout(500);
  const r={};
  r.tasks = await page.evaluate(()=>DB.tasks.map(x=>({t:x.title,date:x.date===todayStr()?'today':x.date,carried:x.carried})));
  r.aplazadas = await page.evaluate(()=>{ const t=[...document.querySelectorAll('.screen.root[data-root=tareas] .group-title')].map(x=>x.textContent); return {titles:t, summary:!!document.querySelector('.summary')}; }); // decision 52: no figures; the carried tasks under Aplazadas
  if(r.aplazadas.summary || !r.aplazadas.titles.some(x=>/^Aplazadas/.test(x))) errors.push('aplazadas: '+JSON.stringify(r.aplazadas));
  r.labels = await page.$$eval('.screen.root[data-root=tareas] .group .row .row-meta', ms=>ms.map(m=>m.textContent));
  r.redLabels = await page.$$eval('.screen.root[data-root=tareas] .over', o=>o.length);
  // Moving the date by hand clears the carried flag
  await page.evaluate(()=>{ tomorrowTask(DB.tasks[0].id); });
  r.afterTomorrow = await page.evaluate(()=>({carried:DB.tasks[0].carried, date:DB.tasks[0].date===addDays(todayStr(),1)?'tomorrow':DB.tasks[0].date}));
  await page.evaluate(()=>render()); await page.waitForTimeout(200);
  // Long left swipe stops at the buttons and does not execute "Mañana"
  const box = await page.$eval('.screen.root[data-root=tareas] .group .row', e=>{ const b=e.getBoundingClientRect(); return {x:b.x+b.width-30,y:b.y+b.height/2}; });
  const before = await page.evaluate(()=>DB.tasks.filter(x=>x.date===todayStr()).length);
  r.minTranslate = await swipe(box.x, box.y, 10, box.y, 16);
  r.restTranslate = await page.$eval('.screen.root[data-root=tareas] .group .row .row-content', e=>new DOMMatrix(getComputedStyle(e).transform).m41);
  r.rowOpen = await page.$eval('.screen.root[data-root=tareas] .group .row', e=>e.dataset.open);
  r.stillToday = (await page.evaluate(()=>DB.tasks.filter(x=>x.date===todayStr()).length))===before;
  await page.screenshot({path:'12-row-open.png'});
  r.errors=errors; console.log(JSON.stringify(r,null,1)); await browser.close(); srv.close();
})().catch(e=>{ console.error(e); process.exit(1); });
