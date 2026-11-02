require('./lib/out.js'); // outputs (screenshots, downloads) go to tests/out
const { chromium } = require('playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const TYPES = {'.html':'text/html','.css':'text/css','.js':'application/javascript','.webmanifest':'application/manifest+json','.png':'image/png'};
const srv = http.createServer((req,res)=>{ let p = decodeURIComponent(req.url.split('?')[0]); if(p==='/') p='/index.html'; const f=path.join(ROOT,p); if(!fs.existsSync(f)){res.writeHead(404);res.end();return;} res.writeHead(200,{'Content-Type':TYPES[path.extname(f)]||'application/octet-stream'}); res.end(fs.readFileSync(f)); });
(async()=>{
  await new Promise(r=>srv.listen(8774,r));
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport:{width:390,height:844}, deviceScaleFactor:2, isMobile:true, hasTouch:true, acceptDownloads:true });
  const page = await ctx.newPage(); await page.addInitScript(()=>{ if(!localStorage.getItem('tareas-v1')) localStorage.setItem('tareas-v1', JSON.stringify({spaces:[{id:'trabajo',name:'Trabajo',order:0},{id:'personal',name:'Personal',order:1}],projects:[],tasks:[],voiceNotes:[],settings:{tipsSeen:true}})); }); const errors=[]; page.on('pageerror', e=>errors.push(e.message));
  await page.goto('http://localhost:8774/'); await page.waitForTimeout(400); const r={};
  await page.click('#tabbar [data-tab=ajustes]'); await page.waitForTimeout(200);
  // Demo data
  const t0=Date.now(); await page.click('.screen.root[data-root=ajustes] [data-act=demo]'); await page.waitForTimeout(400);
  r.demo = await page.evaluate(()=>({tasks:DB.tasks.length, projects:DB.projects.length, vnotes:DB.voiceNotes.length, demo:demoCount(), carried:DB.tasks.filter(x=>x.carried).length, done:DB.tasks.filter(x=>x.status==='done').length, today:pendingFor('hoy').length}));
  await page.click('#tabbar [data-tab=tareas]'); const t1=Date.now(); await page.waitForTimeout(300); await page.screenshot({path:'14-demo-tasks.png'});
  r.renderMs = await page.evaluate(()=>{ const a=performance.now(); render(); return Math.round(performance.now()-a); });
  await page.click('#tabbar [data-tab=proyectos]'); await page.waitForTimeout(200); await page.screenshot({path:'15-demo-projects.png'});
  await page.click('#tabbar [data-tab=ajustes]'); await page.waitForTimeout(200); await page.screenshot({path:'16-settings.png'});
  // Export to file (download path in Chromium)
  const [dl] = await Promise.all([ page.waitForEvent('download',{timeout:5000}).catch(()=>null), page.click('.screen.root[data-root=ajustes] [data-act=exportFile]') ]);
  if(dl){ const p=await dl.path(); const j=JSON.parse(fs.readFileSync(p,'utf8')); r.export={name:dl.suggestedFilename(), tasks:j.tasks.length, spaces:j.spaces.length}; fs.copyFileSync(p,'export.json'); } else r.export='no download';
  // Clear demo, then import the file back: everything returns
  await page.click('.screen.root[data-root=ajustes] [data-act=demoClear]'); await page.waitForTimeout(300); await page.click('#asheet .it:not(.cancel)'); await page.waitForTimeout(300);
  r.afterClear = await page.evaluate(()=>({tasks:DB.tasks.length, projects:DB.projects.length}));
  await page.click('.screen.root[data-root=ajustes] [data-act=importFile]'); await page.waitForTimeout(200);
  await page.setInputFiles('#importFile','export.json'); await page.waitForTimeout(500);
  r.afterImport = await page.evaluate(()=>({tasks:DB.tasks.length, projects:DB.projects.length, toast:document.querySelector('#toastText').textContent}));
  // Import again: nothing added, nothing updated
  await page.click('.screen.root[data-root=ajustes] [data-act=importFile]'); await page.setInputFiles('#importFile','export.json'); await page.waitForTimeout(400);
  r.reimportToast = await page.$eval('#toastText', e=>e.textContent);
  // Log: trigger an error and check it is captured, then the sheet
  await page.evaluate(()=>{ setTimeout(()=>{ throw new Error('Error de prueba'); },0); }); await page.waitForTimeout(200);
  await page.evaluate(()=>render()); await page.click('.screen.root[data-root=ajustes] [data-act=log]'); await page.waitForTimeout(300);
  const txt = await page.$eval('#sheet textarea', e=>e.value); r.logHead = txt.split('\n')[0].slice(0,60); r.logHasError = /\[error\] Error de prueba/.test(txt); r.logHasDemo = /Datos de prueba generados/.test(txt); r.logLines = txt.split('\n').length;
  await page.screenshot({path:'17-log.png'});
  r.errors=errors; console.log(JSON.stringify(r,null,1)); await browser.close(); srv.close();
})().catch(e=>{ console.error(e); process.exit(1); });
