require('./lib/out.js'); // outputs (screenshots, downloads) go to tests/out
const { chromium } = require('playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const TYPES = {'.html':'text/html','.css':'text/css','.js':'application/javascript','.webmanifest':'application/manifest+json','.png':'image/png'};
const srv = http.createServer((req,res)=>{ let p = decodeURIComponent(req.url.split('?')[0]); if(p==='/') p='/index.html'; const f=path.join(ROOT,p); if(!fs.existsSync(f)){res.writeHead(404);res.end();return;} res.writeHead(200,{'Content-Type':TYPES[path.extname(f)]||'application/octet-stream'}); res.end(fs.readFileSync(f)); });
(async()=>{
  await new Promise(r=>srv.listen(8780,r));
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport:{width:390,height:844}, deviceScaleFactor:2, isMobile:true, hasTouch:true });
  const page = await ctx.newPage(); await page.addInitScript(()=>{ if(!localStorage.getItem('tareas-v1')) localStorage.setItem('tareas-v1', JSON.stringify({spaces:[{id:'trabajo',name:'Trabajo',order:0},{id:'personal',name:'Personal',order:1}],projects:[],tasks:[],voiceNotes:[],settings:{tipsSeen:true}})); }); const errors=[]; page.on('pageerror', e=>errors.push(e.message));
  const cdp = await ctx.newCDPSession(page);
  await page.goto('http://localhost:8780/'); await page.waitForTimeout(400);
  await page.evaluate(()=>{ const p=addProject('FLC','#FF9500'); addTask({title:'Preparar comité de seguimiento',date:todayStr(),projectId:p.id,priority:'high'}); addTask({title:'Revisar SOW con legal',date:todayStr()}); addTask({title:'Llamar a Marta',date:todayStr()}); render(); }); await page.waitForTimeout(200);
  const sel='.screen.root[data-root=tareas] .group .row';
  const box = await page.$eval(sel, e=>{ const b=e.getBoundingClientRect(); return {x:b.x+40,y:b.y+b.height/2}; });
  const r={}; const shotAt={4:'22-swipe-40.png',8:'23-swipe-80.png',12:'24-swipe-120.png'};
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:box.x,y:box.y}]});
  for(let i=1;i<=14;i++){ await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:box.x+i*10,y:box.y}]}); await page.waitForTimeout(16); if(shotAt[i]) await page.screenshot({path:shotAt[i]}); if(i===8) r.at80=await page.$eval(sel, e=>({armed:e.classList.contains('armed'), icon:e.querySelector('.row-bg.left span').style.transform})); if(i===12) r.at120=await page.$eval(sel, e=>({armed:e.classList.contains('armed'), content:e.querySelector('.row-content').style.transform})); }
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await page.waitForTimeout(60); r.afterRelease = await page.$eval(sel, e=>({content:e.querySelector('.row-content').style.transform, checkDone:e.querySelector('.check').classList.contains('done')}));
  await page.screenshot({path:'25-swipe-release.png'});
  await page.waitForTimeout(2200); /* R1: the marked row waits 1.5 s before it leaves */ r.completed = await page.evaluate(()=>DB.tasks.filter(x=>x.status==='done').map(x=>x.title));
  r.rowsLeft = await page.$$eval(sel, r=>r.length);
  // Short swipe snaps back without completing
  const box2 = await page.$eval(sel, e=>{ const b=e.getBoundingClientRect(); return {x:b.x+40,y:b.y+b.height/2}; });
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:box2.x,y:box2.y}]}); for(let i=1;i<=5;i++){ await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:box2.x+i*10,y:box2.y}]}); await page.waitForTimeout(16);} await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]}); await page.waitForTimeout(400);
  r.shortSnap = await page.$eval(sel, e=>({content:e.querySelector('.row-content').style.transform, icon:e.querySelector('.row-bg.left span').style.transform, swiping:e.classList.contains('swiping')}));
  r.stillPending = await page.evaluate(()=>DB.tasks.filter(x=>x.status==='pending').length);
  r.errors=errors; console.log(JSON.stringify(r,null,1)); await browser.close(); srv.close();
})().catch(e=>{ console.error(e); process.exit(1); });
