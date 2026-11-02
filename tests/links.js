require('./lib/out.js'); // outputs (screenshots, downloads) go to tests/out
const { chromium } = require('playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const srv = http.createServer((req,res)=>{ let p = decodeURIComponent(req.url.split('?')[0]); if(p==='/') p='/index.html'; const f=path.join(ROOT,p); if(!fs.existsSync(f)){res.writeHead(404);res.end();return;} res.writeHead(200,{'Content-Type':p.endsWith('.js')?'application/javascript':p.endsWith('.css')?'text/css':p.endsWith('.png')?'image/png':'text/html'}); res.end(fs.readFileSync(f)); });
(async()=>{
  await new Promise(r=>srv.listen(8782,r));
  const browser = await chromium.launch(); const ctx = await browser.newContext({ viewport:{width:390,height:844}, deviceScaleFactor:2, isMobile:true, hasTouch:true }); const page = await ctx.newPage(); await page.addInitScript(()=>{ if(!localStorage.getItem('tareas-v1')) localStorage.setItem('tareas-v1', JSON.stringify({spaces:[{id:'trabajo',name:'Trabajo',order:0},{id:'personal',name:'Personal',order:1}],projects:[],tasks:[],voiceNotes:[],settings:{tipsSeen:true}})); }); const errors=[]; page.on('pageerror', e=>errors.push(e.message));
  await page.goto('http://localhost:8782/'); await page.waitForTimeout(400);
  const r = await page.evaluate(()=>{ const p=addProject('FLC','#FF9500'); const x=addTask({title:'Con enlace',date:addDays(todayStr(),3),projectId:p.id,notes:'Reunión en https://teams.microsoft.com/l/meetup-join/abc?x=1 y llamar al +34 600 123 456. Ver www.deloitte.com'}); DB.voiceNotes.push({id:uid(),taskId:x.id,text:'Llamar al 912 345 678 y mirar https://example.org/doc',created:new Date().toISOString()}); render(); openDetail(x.id); return { weekday: fmtDate(addDays(todayStr(),3)), links: extractLinks(x.notes) }; });
  await page.waitForTimeout(500);
  r.strip = await page.$$eval('.pushed-screen .links a', a=>a.map(x=>x.textContent+' -> '+x.getAttribute('href')));
  r.vnLinks = await page.$$eval('.pushed-screen .vn a', a=>a.map(x=>x.getAttribute('href')));
  await page.screenshot({path:'28-detail-links.png'});
  await page.evaluate(()=>pop()); await page.waitForTimeout(500); await page.click('.screen.root[data-root=tareas] [data-filter=todas]'); await page.waitForTimeout(200);
  r.rowMeta = await page.$eval('.screen.root[data-root=tareas] .row[data-id] .row-meta', e=>e.textContent);
  r.errors=errors; console.log(JSON.stringify(r,null,1)); await browser.close(); srv.close();
})().catch(e=>{ console.error(e); process.exit(1); });
