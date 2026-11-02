require('./lib/out.js'); // outputs (screenshots, downloads) go to tests/out
const { chromium } = require('playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const TYPES = {'.html':'text/html','.css':'text/css','.js':'application/javascript','.webmanifest':'application/manifest+json','.png':'image/png'};
const srv = http.createServer((req,res)=>{ let p = decodeURIComponent(req.url.split('?')[0]); if(p==='/') p='/index.html'; const f=path.join(ROOT,p); if(!fs.existsSync(f)){res.writeHead(404);res.end();return;} res.writeHead(200,{'Content-Type':TYPES[path.extname(f)]||'application/octet-stream'}); res.end(fs.readFileSync(f)); });
(async()=>{
  await new Promise(r=>srv.listen(8769,r));
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport:{width:390,height:844}, deviceScaleFactor:2, isMobile:true, hasTouch:true });
  const page = await ctx.newPage(); await page.addInitScript(()=>{ if(!localStorage.getItem('tareas-v1')) localStorage.setItem('tareas-v1', JSON.stringify({spaces:[{id:'trabajo',name:'Trabajo',order:0},{id:'personal',name:'Personal',order:1}],projects:[],tasks:[],voiceNotes:[],settings:{tipsSeen:true}})); }); const errors=[]; page.on('pageerror', e=>errors.push(e.message)); page.on('console', m=>{ if(m.type()==='error') errors.push(m.text()); });
  const cdp = await ctx.newCDPSession(page);
  const swipe = async (x1,y1,x2,y2,steps=12,ms=15,shotAt=null)=>{ await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:x1,y:y1}]}); for(let i=1;i<=steps;i++){ const x=x1+(x2-x1)*i/steps, y=y1+(y2-y1)*i/steps; await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y}]}); if(shotAt===i) await page.screenshot({path:'06-midswipe.png'}); await page.waitForTimeout(ms);} await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]}); await page.waitForTimeout(450); };
  const state = async()=>page.evaluate(()=>({tab:UI.tab, on:document.querySelector('#tabbar .on').dataset.tab, visible:[...document.querySelectorAll('.screen.root:not(.hidden-tab)')].map(s=>s.dataset.root)}));
  await page.goto('http://localhost:8769/'); await page.waitForTimeout(500);
  await page.click('.fab'); await page.fill('#sheet .titlein','Llamar a Marta'); /* R5: date options live in the strip of the date icon */ await page.click('#sheet .qbtn[data-k=date]'); /* decision 27b: the + in Hoy already proposes today (a tap on the lit Hoy chip would clear it) */ await page.locator('#sheet [data-c=hoy]:not(.on)').click({timeout:1500}).catch(()=>{}); await page.click('#sheet [data-x=ok]'); await page.waitForTimeout(400);
  const r={};
  await swipe(330,650,60,650,12,15,5); r.afterLeft = await state();           // empty area below list: should go to Proyectos
  await swipe(60,650,330,650); r.afterRight = await state();                   // back to Tareas
  await swipe(330,650,250,650); r.shortLeft = await state();                   // too short: stays
  await swipe(330,650,190,650,6,10); r.fastLeft = await state();               // quick flick beyond 20px with velocity: goes
  await swipe(60,650,330,650);
  const rowBox = await page.$eval('.screen.root[data-root=tareas] .group .row', e=>{ const b=e.getBoundingClientRect(); return {x:b.x+b.width/2,y:b.y+b.height/2}; });
  await swipe(rowBox.x+100,rowBox.y,rowBox.x-20,rowBox.y); r.onRow = Object.assign(await state(), {rowOpen: await page.$eval('.screen.root[data-root=tareas] .group .row', e=>e.dataset.open)});
  await page.click('#tabbar [data-tab=ajustes]'); r.tapAjustes = await state();
  await swipe(330,650,60,650); r.leftFromLast = await state();                 // no neighbour: stays
  await page.click('#tabbar [data-tab=tareas]'); await page.waitForTimeout(200);
  await page.click('.screen.root[data-root=tareas] .group .row .row-title'); await page.waitForTimeout(500); await page.screenshot({path:'07-detail-tabbar.png'});
  r.tabbarCoveredByDetail = await page.evaluate(()=>{ const b=document.querySelector('#tabbar').getBoundingClientRect(); const el=document.elementFromPoint(b.x+b.width/2,b.y+10); return !!el.closest('.pushed-screen'); });
  r.errors=errors; console.log(JSON.stringify(r,null,1));
  await browser.close(); srv.close();
})().catch(e=>{ console.error(e); process.exit(1); });
