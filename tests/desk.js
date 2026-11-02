require('./lib/out.js'); // outputs (screenshots, downloads) go to tests/out
const { chromium } = require('playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = path.resolve(__dirname, '..'); const OUT = path.join(__dirname, 'out');
const TYPES = {'.html':'text/html','.css':'text/css','.js':'application/javascript','.webmanifest':'application/manifest+json','.png':'image/png'};
const srv = http.createServer((req,res)=>{ let p = decodeURIComponent(req.url.split('?')[0]); if(p==='/') p='/index.html'; const f=path.join(ROOT,p); if(!fs.existsSync(f)){res.writeHead(404);res.end();return;} res.writeHead(200,{'Content-Type':TYPES[path.extname(f)]||'application/octet-stream'}); res.end(fs.readFileSync(f)); });
(async()=>{
  await new Promise(r=>srv.listen(8789,r));
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport:{width:1280,height:800}, deviceScaleFactor:1 });
  const page = await ctx.newPage(); await page.addInitScript(()=>{ localStorage.setItem('tareas-v1', JSON.stringify({spaces:[{id:'trabajo',name:'Trabajo',order:0},{id:'personal',name:'Personal',order:1}],projects:[],tasks:[],voiceNotes:[],settings:{tipsSeen:true}})); });
  const errors=[]; page.on('pageerror', e=>errors.push(e.message)); page.on('console', m=>{ if(m.type()==='error') errors.push(m.text()); });
  await page.goto('http://localhost:8789/'); await page.waitForTimeout(600); const r={};
  r.mode = await page.evaluate(()=>({wide:UI.wide, desk:!!document.querySelector('#desk'), bodyClass:document.body.classList.contains('desktop'), tabbarHidden:getComputedStyle(document.querySelector('#tabbar')).display==='none'}));
  await page.evaluate(()=>{ generateDemo(); }); await page.waitForTimeout(300);
  r.side = await page.$$eval('#desk .side .it', b=>b.map(x=>x.textContent.trim()).slice(0,4));
  await page.screenshot({path:OUT+'/d1-hoy.png'});
  // Add bar with a date word
  await page.keyboard.press('n'); r.addbarFocused = await page.evaluate(()=>document.activeElement&&document.activeElement.dataset.role==='addbar');
  await page.keyboard.type('Preparar comité viernes'); await page.keyboard.press('Enter'); await page.waitForTimeout(300);
  r.added = await page.evaluate(()=>{ const x=DB.tasks.find(t=>t.title==='Preparar comité'); return x?{date:x.date===nextWeekday(5,true)?'friday':x.date}:null; });
  // Detail pane
  await page.click('#desk .group .row .row-title'); await page.waitForTimeout(300);
  r.pane = await page.evaluate(()=>({has:document.querySelector('#app').classList.contains('has-pane'), title:(document.querySelector('.pane [data-role=title]')||{}).value, close:(document.querySelector('.pane .back')||{}).textContent}));
  await page.screenshot({path:OUT+'/d2-pane.png'});
  await page.keyboard.press('Escape'); await page.waitForTimeout(200); r.paneClosed = await page.evaluate(()=>!document.querySelector('.pane'));
  // Row hover menu button and right click
  r.rowmore = await page.$$eval('#desk .rowmore', b=>b.length>0);
  await page.click('#desk .group .row .row-title', {button:'right'}); await page.waitForTimeout(250); r.ctxItems = await page.$$eval('#pmenu .pm-it .pm-l', b=>b.map(x=>x.textContent.trim())); /* batch E (R17): a macOS menu, no longer the action sheet */ await page.keyboard.press('Escape'); await page.waitForTimeout(250);
  // Week view
  await page.click('#desk [data-view=week]'); await page.waitForTimeout(300);
  r.week = await page.evaluate(()=>({days:document.querySelectorAll('#desk .wday').length, today:!!document.querySelector('#desk .wday.today'), cards:document.querySelectorAll('#desk .wday .wcard').length, undated:document.querySelectorAll('#desk .wundated .wcard').length, title:document.querySelector('#desk .whead h2').textContent}));
  await page.screenshot({path:OUT+'/d3-week.png'});
  // Drag a card from today to tomorrow
  let src = await page.$('#desk .wday.today .wcard'); let dst = await page.$$('#desk .wday').then(async ds=>{ const t=await page.evaluate(()=>todayStr()); for(const d of ds){ const day=await d.getAttribute('data-day'); if(day>t) return d; } return null; }); // G1b: on a Sunday the week has no later day
  // G3 (F72): past days no longer take a drop, so on a Sunday the drag is done in next week: a card of one day onto another day of that week
  let wentNext=false; if(!dst){ await page.click('#desk [data-week="1"]'); await page.waitForTimeout(200); wentNext=true; const ds=await page.$$('#desk .wday'); src=null; for(let i=0;i<ds.length&&!src;i++){ const c=await ds[i].$('.wcard'); if(c){ src=c; dst=ds[i+1]||ds[i-1]; } } }
  if(src&&dst){ const id=await src.getAttribute('data-id'); const day=await dst.getAttribute('data-day'); const sb=await src.boundingBox(), db=await dst.boundingBox(); await page.mouse.move(sb.x+sb.width/2, sb.y+sb.height/2); await page.mouse.down(); await page.mouse.move(db.x+db.width/2, db.y+60, {steps:12}); await page.mouse.move(db.x+db.width/2, db.y+70, {steps:4}); await page.mouse.up(); await page.waitForTimeout(500); r.drag = await page.evaluate(([id,day])=>({moved:task(id).date===day, toast:document.querySelector('#toastText').textContent}), [id,day]); }
  if(wentNext){ await page.click('#desk [data-week=today]'); await page.waitForTimeout(200); }
  await page.click('#desk [data-week="1"]'); await page.waitForTimeout(200); r.nextWeek = await page.$eval('#desk .whead h2', e=>e.textContent); await page.click('#desk [data-week=today]');
  // Project view and settings view
  await page.click('#desk .side [data-view^="project:"]'); await page.waitForTimeout(300); r.project = await page.evaluate(()=>({view:UI.deskView, title:document.querySelector('#desk h1').textContent, rows:document.querySelectorAll('#desk .group .row').length, addbarProject:!!document.querySelector('#desk [data-role=addbar]').dataset.project}));
  await page.click('#desk [data-view=settings]'); await page.waitForTimeout(300); r.settings = await page.evaluate(()=>({title:document.querySelector('#desk h1').textContent, hasBackups:!!document.querySelector('#desk [data-act=backupNow]')}));
  await page.screenshot({path:OUT+'/d4-settings.png'});
  // Search
  await page.click('#desk [data-view=hoy]'); await page.waitForTimeout(200); await page.keyboard.press('/'); await page.keyboard.type('raid'); await page.waitForTimeout(300); r.search = await page.$eval('#desk .group-title', e=>e.textContent);
  await page.keyboard.press('Escape'); await page.waitForTimeout(200); r.searchCleared = await page.evaluate(()=>UI.query==='');
  // Sheets centered
  await page.evaluate(()=>dateSheet(DB.tasks[0].id)); await page.waitForTimeout(300); r.sheetCentered = await page.$eval('#sheet', e=>{ const b=e.getBoundingClientRect(); return Math.abs((b.left+b.width/2)-640)<5 && b.width<=440; }); await page.evaluate(()=>closeSheet());
  // Back to mobile width restores the tab bar
  await page.setViewportSize({width:390,height:844}); await page.waitForTimeout(400); r.backToMobile = await page.evaluate(()=>({wide:UI.wide, tab:UI.tab, desk:!!document.querySelector('#desk'), tabbarVisible:getComputedStyle(document.querySelector('#tabbar')).display!=='none'}));
  r.errors=errors; console.log(JSON.stringify(r,null,1)); await browser.close(); srv.close();
})().catch(e=>{ console.error(e); process.exit(1); });
