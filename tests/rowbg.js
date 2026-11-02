require('./lib/out.js'); // outputs (screenshots, downloads) go to tests/out
const { chromium } = require('playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const TYPES = {'.html':'text/html','.css':'text/css','.js':'application/javascript','.webmanifest':'application/manifest+json','.png':'image/png'};
const srv = http.createServer((req,res)=>{ let p = decodeURIComponent(req.url.split('?')[0]); if(p==='/') p='/index.html'; const f=path.join(ROOT,p); if(!fs.existsSync(f)){res.writeHead(404);res.end();return;} res.writeHead(200,{'Content-Type':TYPES[path.extname(f)]||'application/octet-stream'}); res.end(fs.readFileSync(f)); });
(async()=>{
  await new Promise(r=>srv.listen(8776,r));
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport:{width:390,height:844}, isMobile:true, hasTouch:true });
  const page = await ctx.newPage(); await page.addInitScript(()=>{ if(!localStorage.getItem('tareas-v1')) localStorage.setItem('tareas-v1', JSON.stringify({spaces:[{id:'trabajo',name:'Trabajo',order:0},{id:'personal',name:'Personal',order:1}],projects:[],tasks:[],voiceNotes:[],settings:{tipsSeen:true}})); }); const errors=[]; page.on('pageerror', e=>errors.push(e.message));
  const cdp = await ctx.newCDPSession(page);
  const swipe = async (x1,y1,x2,y2,steps=10)=>{ await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:x1,y:y1}]}); for(let i=1;i<=steps;i++){ await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x1+(x2-x1)*i/steps,y:y1}]}); await page.waitForTimeout(15);} await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]}); };
  await page.goto('http://localhost:8776/'); await page.waitForTimeout(400);
  await page.evaluate(()=>{ addTask({title:'Una',date:todayStr()}); addTask({title:'Dos',date:todayStr()}); render(); }); await page.waitForTimeout(200);
  const sel='.screen.root[data-root=tareas] .group .row'; const r={};
  r.idleBg = await page.$eval(sel+' .row-bg', e=>getComputedStyle(e).display);
  const box = await page.$eval(sel, e=>{ const b=e.getBoundingClientRect(); return {x:b.x+b.width-30,y:b.y+b.height/2}; });
  await swipe(box.x, box.y, box.x-200, box.y); await page.waitForTimeout(100);
  r.openBg = await page.$eval(sel+' .row-bg.right', e=>getComputedStyle(e).display); r.open = await page.$eval(sel, e=>e.dataset.open+' '+e.classList.contains('swiping'));
  await page.evaluate(()=>closeRow(document.querySelector('.screen.root[data-root=tareas] .group .row'))); await page.waitForTimeout(400);
  r.closedBg = await page.$eval(sel+' .row-bg', e=>getComputedStyle(e).display); r.closedClass = await page.$eval(sel, e=>e.classList.contains('swiping'));
  // Right swipe still completes
  await swipe(box.x-250, box.y, box.x-100, box.y); await page.waitForTimeout(2200); // R1: the marked row waits 1.5 s before the task is completed
  r.completed = await page.evaluate(()=>DB.tasks.filter(x=>x.status==='done').length);
  r.errors=errors; console.log(JSON.stringify(r)); await browser.close(); srv.close();
})().catch(e=>{ console.error(e); process.exit(1); });
