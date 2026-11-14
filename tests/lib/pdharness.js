// Shared harness of rm-SD and rm-PD (decisions 85 and 86): a static server for the app, a page with the clock installed and a seed in
// localStorage, and the waits the other tests use (calm, sheetUp). Each test passes its own port and output folder
const { chromium } = require('playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const TYPES = {'.html':'text/html','.css':'text/css','.js':'application/javascript','.webmanifest':'application/manifest+json','.png':'image/png','.json':'application/json'};
function server(port){ const srv = http.createServer((req,res)=>{ let p = decodeURIComponent(req.url.split('?')[0]); if(p==='/') p='/index.html';
  if(p==='/config.js'){ res.writeHead(200,{'Content-Type':'application/javascript'}); res.end('window.TAREAS_CONFIG = {"url":null,"anonKey":null};\n'); return; }
  const f=path.join(ROOT,p); if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){ res.writeHead(404,{'Content-Type':'text/html'}); res.end('<h1>404</h1>'); return; }
  res.writeHead(200,{'Content-Type':TYPES[path.extname(f)]||'application/octet-stream'}); res.end(fs.readFileSync(f)); });
  return new Promise(res=>srv.listen(port, ()=>res(srv))); }
const sleep=ms=>new Promise(res=>setTimeout(res,ms));
const ev = (page, fn, arg) => page.evaluate(fn, arg);
const until = async (page, fn, arg, ms=8000)=>{ const t0=Date.now(); for(;;){ let v=false; try{ v=await page.evaluate(fn, arg); }catch(e){} if(v) return true; if(Date.now()-t0>ms) return false; await sleep(80); } };
const calm = async page => { for(let i=0;i<40;i++){ const busy=await ev(page, ()=>app.classList.contains('navigating')||HELD.size>0||!!document.querySelector('.row.leaving, .flip, .enter, .pushed-screen.pushed')||touchDrag||document.getAnimations().some(a=>a.playState==='running'&&!(a.effect&&a.effect.getComputedTiming().iterations===Infinity))); if(!busy) return true; await page.clock.runFor(200); await sleep(30); } return false; };
const sheetUp = page => until(page, ()=>{ const s=document.querySelector('#sheet'); return s.classList.contains('on') && !sheetFresh(); });
const settle = async page => { for(let i=0;i<6;i++){ await page.clock.runFor(150); await sleep(40); } await calm(page); };
async function open(browser, o, errors){
  const vp = o.desk ? {viewport:{width:1280,height:800}, deviceScaleFactor:1} : {viewport:{width:390,height:844}, deviceScaleFactor:2, isMobile:true, hasTouch:true};
  const ctx = await browser.newContext(Object.assign(vp, {colorScheme:o.theme||'light'})); const page = await ctx.newPage();
  await page.clock.install({time:o.now});
  page.on('pageerror', e=>errors.push(o.tag+' pageerror: '+e.message)); page.on('console', m=>{ if(m.type()==='error') errors.push(o.tag+' console: '+m.text()); });
  await page.addInitScript(s=>{ if(!localStorage.getItem('tareas-v1')) localStorage.setItem('tareas-v1', s); }, JSON.stringify(o.seed));
  await page.goto('http://localhost:'+o.port+'/'); await until(page, ()=>typeof DB!=='undefined'&&!!document.querySelector(UI.wide?'#desk .main':'.screen.root')); await settle(page); return {ctx, page}; }
module.exports = { chromium, server, sleep, ev, until, calm, sheetUp, settle, open, ROOT };
