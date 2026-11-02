require('./lib/out.js'); // outputs (screenshots, downloads) go to tests/out
const { chromium } = require('playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const TYPES = {'.html':'text/html','.css':'text/css','.js':'application/javascript','.webmanifest':'application/manifest+json','.png':'image/png'};
const srv = http.createServer((req,res)=>{ let p = decodeURIComponent(req.url.split('?')[0]); if(p==='/') p='/index.html'; const f=path.join(ROOT,p); if(!fs.existsSync(f)){res.writeHead(404);res.end();return;} res.writeHead(200,{'Content-Type':TYPES[path.extname(f)]||'application/octet-stream'}); res.end(fs.readFileSync(f)); });
(async()=>{
  await new Promise(r=>srv.listen(8765,r));
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport:{width:390,height:844}, deviceScaleFactor:2, isMobile:true, hasTouch:true, serviceWorkers:'allow' });
  const page = await ctx.newPage(); await page.addInitScript(()=>{ if(!localStorage.getItem('tareas-v1')) localStorage.setItem('tareas-v1', JSON.stringify({spaces:[{id:'trabajo',name:'Trabajo',order:0},{id:'personal',name:'Personal',order:1}],projects:[],tasks:[],voiceNotes:[],settings:{tipsSeen:true}})); }); const errors=[];
  page.on('console', m=>{ if(m.type()==='error') errors.push(m.text()); }); page.on('pageerror', e=>errors.push('pageerror: '+e.message));
  await page.goto('http://localhost:8765/'); await page.waitForTimeout(800);
  const sw = await page.evaluate(async()=>{ const r=await navigator.serviceWorker.getRegistration(); return r? (r.active?'active':r.installing?'installing':r.waiting?'waiting':'registered'):'none'; });
  const manifest = await page.evaluate(async()=>{ const r=await fetch('manifest.webmanifest'); return r.status+' '+(await r.json()).name; });
  const icon = await page.evaluate(async()=>(await fetch('icons/icon-192.png')).status);
  await page.screenshot({path:'01-home.png'});
  // Add a task via the quick-add sheet
  await page.click('.fab'); await page.waitForTimeout(400);
  await page.fill('#sheet .titlein','Preparar comité de seguimiento'); /* R5: date options live in the strip of the date icon */ await page.click('#sheet .qbtn[data-k=date]'); /* decision 27b: the + in Hoy already proposes today (a tap on the lit Hoy chip would clear it) */ await page.locator('#sheet [data-c=hoy]:not(.on)').click({timeout:1500}).catch(()=>{}); await page.click('#sheet [data-x=ok]'); await page.waitForTimeout(400);
  const rows = await page.$$eval('.screen.root[data-root=tareas] .group .row', r=>r.length);
  await page.screenshot({path:'02-task.png'});
  // Open detail and go back
  await page.click('.screen.root[data-root=tareas] .group .row .row-title'); await page.waitForTimeout(500);
  const detailTitle = await page.inputValue('.pushed-screen [data-role=title]');
  await page.screenshot({path:'03-detail.png'});
  await page.click('.pushed-screen [data-act=back]'); await page.waitForTimeout(500);
  // Settings tab shows version
  await page.click('[data-tab=ajustes]'); await page.waitForTimeout(200);
  const ver = await page.$eval('.screen.root[data-root=ajustes] .footnote:last-child', e=>e.textContent);
  await page.screenshot({path:'04-settings.png'});
  // Offline: reload served from SW cache
  await page.waitForTimeout(500); await ctx.setOffline(true);
  let offline='failed'; try{ await page.reload({waitUntil:'load'}); offline = await page.$eval('.nav .title', e=>e.textContent.trim()); }catch(e){ offline='failed: '+e.message.split('\n')[0]; }
  await ctx.setOffline(false);
  console.log(JSON.stringify({sw, manifest, icon, rows, detailTitle, ver, offline, errors}, null, 1));
  await browser.close(); srv.close();
})().catch(e=>{ console.error(e); process.exit(1); });
