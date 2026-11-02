require('./lib/out.js'); // outputs (screenshots, downloads) go to tests/out
const { chromium } = require('playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const TYPES = {'.html':'text/html','.css':'text/css','.js':'application/javascript','.webmanifest':'application/manifest+json','.png':'image/png'};
const srv = http.createServer((req,res)=>{ let p = decodeURIComponent(req.url.split('?')[0]); if(p==='/') p='/index.html'; const f=path.join(ROOT,p); if(!fs.existsSync(f)){res.writeHead(404);res.end();return;} res.writeHead(200,{'Content-Type':TYPES[path.extname(f)]||'application/octet-stream'}); res.end(fs.readFileSync(f)); });
(async()=>{
  await new Promise(r=>srv.listen(8785,r));
  const browser = await chromium.launch(); const r={};
  for(const scheme of ['light','dark']){
    const ctx = await browser.newContext({ viewport:{width:390,height:844}, deviceScaleFactor:2, isMobile:true, hasTouch:true, colorScheme:scheme });
    const page = await ctx.newPage(); await page.addInitScript(()=>{ localStorage.setItem('tareas-v1', JSON.stringify({spaces:[{id:'trabajo',name:'Trabajo',order:0},{id:'personal',name:'Personal',order:1}],projects:[],tasks:[],voiceNotes:[],settings:{tipsSeen:true}})); });
    const errors=[]; page.on('pageerror', e=>errors.push(e.message));
    await page.goto('http://localhost:8785/'); await page.waitForTimeout(500);
    await page.evaluate(()=>{ generateDemo(); DB.settings.doneOpen=true; save(); render(); }); await page.waitForTimeout(300);
    await page.evaluate(()=>dateSheet(DB.tasks.find(x=>x.status==='pending').id)); await page.waitForTimeout(400); await page.screenshot({path:`m-${scheme}-date.png`});
    if(scheme==='light'){ r.cells = await page.$$eval('#sheet .cal-d', c=>c.length); r.dots = await page.$$eval('#sheet .cal-d i', c=>c.length); await page.click('#sheet [data-cal="1"]'); r.nextMonth = await page.$eval('#sheet .cal-head span', e=>e.textContent); await page.click('#sheet .cal-d:not(.other):nth-of-type(20)'); await page.waitForTimeout(400); r.picked = await page.evaluate(()=>DB.tasks.find(x=>x.status==='pending').date); }
    else { await page.evaluate(()=>closeSheet()); await page.waitForTimeout(400); }
    await page.evaluate(()=>reminderSheet(DB.tasks.find(x=>x.status==='pending').id)); await page.waitForTimeout(400); await page.screenshot({path:`m-${scheme}-reminder.png`});
    if(scheme==='light'){ await page.click('#sheet .cal-d.today'); await page.fill('#sheet input[type=time]','17:30'); await page.click('#sheet [data-x=ok]'); await page.waitForTimeout(300); r.reminder = await page.evaluate(()=>fmtDateTime(DB.tasks.find(x=>x.status==='pending').reminder)); }
    else { await page.evaluate(()=>closeSheet()); await page.waitForTimeout(400); }
    await page.evaluate(()=>{ const sc=document.querySelector('.screen.root[data-root=tareas] .scroll'); const el=sc.querySelector('[data-act=toggleDone]'); el.scrollIntoView({block:'start'}); }); await page.waitForTimeout(200); await page.screenshot({path:`m-${scheme}-done.png`});
    if(scheme==='light'){ r.doneGroups = await page.$$eval('.screen.root[data-root=tareas] .group-title', g=>g.map(x=>x.textContent)).then(a=>a.slice(0,5)); r.toggleLabel = await page.$eval('.screen.root[data-root=tareas] [data-act=toggleDone] span', e=>e.textContent); }
    r['errors_'+scheme]=errors; await ctx.close();
  }
  console.log(JSON.stringify(r,null,1)); await browser.close(); srv.close();
})().catch(e=>{ console.error(e); process.exit(1); });
