require('./lib/out.js'); // outputs (screenshots, downloads) go to tests/out
const { chromium } = require('playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = path.resolve(__dirname, '..'); let ver='A';
const TYPES = {'.html':'text/html','.css':'text/css','.js':'application/javascript','.webmanifest':'application/manifest+json','.png':'image/png'};
const srv = http.createServer((req,res)=>{ let p = decodeURIComponent(req.url.split('?')[0]); if(p==='/') p='/index.html'; const f=path.join(ROOT,p); if(!fs.existsSync(f)){res.writeHead(404);res.end();return;}
  let body=fs.readFileSync(f); if(p!=='/sw.js'&&/\.(html|js)$/.test(p)) body=body.toString().replace(/APP_VERSION = '[^']*'/, "APP_VERSION = '"+ver+"'"); /* wherever APP_VERSION lives (index.html or js/) */ if(p==='/sw.js') body=body.toString().replace(/CACHE = '[^']*'/, "CACHE = 'tareas-"+ver+"'");
  res.writeHead(200,{'Content-Type':TYPES[path.extname(f)]||'application/octet-stream','Cache-Control':'max-age=600'}); res.end(body); });
(async()=>{
  await new Promise(r=>srv.listen(8770,r));
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport:{width:390,height:844}, isMobile:true, hasTouch:true });
  const page = await ctx.newPage(); await page.addInitScript(()=>{ if(!localStorage.getItem('tareas-v1')) localStorage.setItem('tareas-v1', JSON.stringify({spaces:[{id:'trabajo',name:'Trabajo',order:0},{id:'personal',name:'Personal',order:1}],projects:[],tasks:[],voiceNotes:[],settings:{tipsSeen:true}})); }); const errors=[]; page.on('pageerror', e=>errors.push(e.message));
  await page.goto('http://localhost:8770/'); await page.waitForTimeout(1200);
  await page.reload(); await page.waitForTimeout(800);   // second load: controlled by SW A
  const r={}; r.v1 = await page.evaluate(()=>APP_VERSION); r.controlled = await page.evaluate(()=>!!navigator.serviceWorker.controller);
  ver='B';
  await page.evaluate(()=>navigator.serviceWorker.getRegistration().then(x=>x.update()));
  await page.waitForFunction(()=>document.querySelector('#toast').classList.contains('on') && document.querySelector('#toastBtn').textContent==='Actualizar', null, {timeout:8000});
  r.toast = await page.$eval('#toastText', e=>e.textContent);
  await page.click('#tabbar [data-tab=ajustes]'); await page.waitForTimeout(200);
  r.settingsRow = await page.$eval('.screen.root[data-root=ajustes] [data-act=update] .lbl', e=>e.textContent).catch(()=>null);
  await page.click('.screen.root[data-root=ajustes] [data-act=update]');
  await page.waitForFunction(()=>typeof APP_VERSION!=='undefined' && APP_VERSION==='B', null, {timeout:8000}).catch(()=>{});
  await page.waitForTimeout(800);
  r.v2 = await page.evaluate(()=>APP_VERSION); r.cacheNames = await page.evaluate(()=>caches.keys());
  // privacidad.html (the privacy policy of the Google sign-in screen): with the service worker in control it is the page itself, not the app shell
  { const p2 = await ctx.newPage(); await p2.goto('http://localhost:8770/privacidad.html'); await p2.waitForTimeout(300);
    r.privacy = await p2.evaluate(()=>({title:document.title, h1:(document.querySelector('h1')||{}).textContent, app:!!document.querySelector('#app'), controlled:!!navigator.serviceWorker.controller, wide:document.documentElement.scrollWidth>innerWidth, sections:document.querySelectorAll('section').length}));
    await p2.screenshot({path:require('path').join(require('./lib/out.js'),'privacidad.png'), fullPage:true}).catch(()=>{}); await p2.close();
    if(r.privacy.title!=='Privacidad de Tareas'||r.privacy.h1!=='Privacidad de Tareas'||r.privacy.app||!r.privacy.controlled||r.privacy.wide||r.privacy.sections<6) errors.push('privacy page: '+JSON.stringify(r.privacy)); }
  // Assertions (the summary reads the errors array): the waiting worker is offered and applied, and only the new cache stays
  if(r.v1!=='A'||!r.controlled) errors.push('first version not served by the service worker: '+r.v1+' '+r.controlled);
  if(r.toast!=='Nueva versión disponible'||r.settingsRow!=='Nueva versión disponible') errors.push('update not offered: '+r.toast+' / '+r.settingsRow);
  if(r.v2!=='B'||JSON.stringify(r.cacheNames)!=='["tareas-B"]') errors.push('update not applied: '+r.v2+' '+JSON.stringify(r.cacheNames));
  r.errors=errors; console.log(JSON.stringify(r)); await browser.close(); srv.close();
})().catch(e=>{ console.error(e); process.exit(1); });
