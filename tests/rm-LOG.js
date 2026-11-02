require('./lib/out.js'); // outputs (screenshots, downloads) go to tests/out
// Borrar registro (v0.24.1), port 10600. Screenshots in tests/out/log.
//  iPhone: Ajustes shows «Borrar registro» only while the log has entries; it asks first (action sheet), empties the log on this device and
//  in localStorage, and Deshacer brings the entries back with anything logged meanwhile after them. The Borrar of «Ver registro» has Deshacer too.
//  Desktop: the same cell asks with the Mac alert; Intro clears.
const { chromium } = require('playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = path.resolve(__dirname, '..'), PORT = 10600, URL0 = 'http://localhost:'+PORT+'/';
const OUT = path.join(__dirname, 'out', 'log'); fs.mkdirSync(OUT, {recursive:true});
const TYPES = {'.html':'text/html','.css':'text/css','.js':'application/javascript','.webmanifest':'application/manifest+json','.png':'image/png'};
const srv = http.createServer((req,res)=>{ let p = decodeURIComponent(req.url.split('?')[0]); if(p==='/') p='/index.html';
  if(p==='/config.js'){ res.writeHead(200,{'Content-Type':'application/javascript'}); res.end('window.TAREAS_CONFIG = {"url":null,"anonKey":null};\n'); return; }
  const f=path.join(ROOT,p); if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){ res.writeHead(404,{'Content-Type':'text/html'}); res.end('<h1>404</h1>'); return; }
  res.writeHead(200,{'Content-Type':TYPES[path.extname(f)]||'application/octet-stream'}); res.end(fs.readFileSync(f)); });
const r={}, fails=[], errors=[]; const check=(name, ok, info)=>{ r[name]=ok?true:(info===undefined?false:info); if(!ok) fails.push(name); };
const sleep=ms=>new Promise(res=>setTimeout(res,ms));
const shot=(page, name)=>page.screenshot({path:path.join(OUT, name+'.png')});
const until = async (page, fn, arg, ms=8000)=>{ const t0=Date.now(); for(;;){ let v=false; try{ v=await page.evaluate(fn, arg); }catch(e){} if(v) return true; if(Date.now()-t0>ms) return false; await sleep(80); } };
const SEED = JSON.stringify({spaces:[{id:'trabajo',name:'Trabajo',order:0}], projects:[], tasks:[], voiceNotes:[], settings:{tipsSeen:true}});
const LOGSEED = JSON.stringify([{t:'2026-11-02T10:00:00Z',l:'info',m:'Uno'},{t:'2026-11-02T10:01:00Z',l:'info',m:'Dos'},{t:'2026-11-02T10:02:00Z',l:'error',m:'Tres'}]);
async function open(browser, desk){
  const ctx = await browser.newContext(desk?{viewport:{width:1280,height:800}}:{viewport:{width:390,height:844}, deviceScaleFactor:2, isMobile:true, hasTouch:true});
  const page = await ctx.newPage(); const tag=desk?'D':'M';
  page.on('pageerror', e=>errors.push(tag+' pageerror: '+e.message));
  await page.addInitScript(([s,l])=>{ if(!localStorage.getItem('tareas-v1')){ localStorage.setItem('tareas-v1', s); localStorage.setItem('tareas-log', l); } }, [SEED, LOGSEED]);
  await page.goto(URL0); await until(page, ()=>typeof DB!=='undefined'&&!!document.querySelector(UI.wide?'#desk .main':'.screen.root'));
  return {ctx, page};
}
const stored = page => page.evaluate(()=>{ const s=localStorage.getItem('tareas-log'); return s?JSON.parse(s).map(e=>e.m):[]; });

async function iphone(browser){
  const {ctx, page} = await open(browser, false);
  await page.evaluate(()=>switchTab('ajustes')); await until(page, ()=>!!document.querySelector('.screen.root[data-root=ajustes] [data-act=logClear]'));
  const S='.screen.root[data-root=ajustes]';
  await page.evaluate(S=>document.querySelector(S+' [data-act=logClear]').scrollIntoView({block:'center'}), S); await sleep(200);
  await shot(page, 'm1-ajustes');
  const n0 = await page.evaluate(()=>LOG.length);
  await page.tap(S+' [data-act=logClear]'); await until(page, ()=>document.querySelector('#asheet').classList.contains('on'));
  const ask = await page.evaluate(()=>({t:document.querySelector('#asheet').textContent, n:LOG.length, list:LOG.map(e=>e.m).join()}));
  await shot(page, 'm2-ask');
  await sleep(500); // sheetFresh ignores taps on a just opened sheet
  await page.locator('#asheet button', {hasText:'Borrar registro'}).first().tap();
  await until(page, ()=>!LOG.length && document.querySelector('#toast').classList.contains('on'));
  const after = {n:await page.evaluate(()=>LOG.length), st:await stored(page), toast:await page.evaluate(()=>document.querySelector('#toastText').textContent+'|'+document.querySelector('#toastBtn').textContent),
    cell:await page.evaluate(S=>!!document.querySelector(S+' [data-act=logClear]'), S), count:await page.evaluate(S=>document.querySelector(S+' [data-act=log] .val').textContent, S)};
  check('m_clear', n0>=3 && /Las \d+ entradas del registro de este dispositivo se borrarán/.test(ask.t) && ask.n===n0 && after.n===0 && after.st.length===0 && after.toast==='Registro borrado|Deshacer' && !after.cell && after.count==='0 entradas', {n0, ask, after});
  await page.evaluate(()=>log('info','Después'));
  await page.click('#toastBtn'); await sleep(200);
  const back = await page.evaluate(()=>LOG.map(e=>e.m));
  check('m_undo', back.length>n0 && back.slice(0,n0).join()===ask.list && back[back.length-1]==='Después' && (await stored(page)).join()===back.join(), back);
  // The Borrar inside «Ver registro» clears at once, with Deshacer
  await page.tap(S+' [data-act=log]'); await until(page, ()=>document.querySelector('#sheet').classList.contains('on')); await sleep(500);
  await page.tap('#sheet [data-x=clear]'); await until(page, ()=>!LOG.length);
  const nb = back.length; const t2 = await page.evaluate(()=>document.querySelector('#toastBtn').style.display!=='none'&&document.querySelector('#toastText').textContent);
  await page.click('#toastBtn'); await sleep(200);
  check('m_sheet_clear_undo', t2==='Registro borrado' && await page.evaluate(n=>LOG.length>=n && LOG[0].m==='Uno', nb), t2);
  await ctx.close();
}
async function desktop(browser){
  const {ctx, page} = await open(browser, true);
  await page.evaluate(()=>setDeskView('settings')); await until(page, ()=>!!document.querySelector('#desk [data-act=logClear]'));
  await page.click('#desk [data-act=logClear]'); await until(page, ()=>document.querySelector('#asheet').classList.contains('on'));
  await shot(page, 'd1-alert'); await sleep(500);
  await page.keyboard.press('Enter'); await until(page, ()=>!LOG.length);
  check('d_clear', await page.evaluate(()=>!LOG.length && !document.querySelector('#desk [data-act=logClear]')) && (await stored(page)).length===0);
  await ctx.close();
}
(async()=>{
  await new Promise(res=>srv.listen(PORT,res)); const browser = await chromium.launch();
  try{ await iphone(browser); }catch(e){ fails.push('iphone_exception'); errors.push('iphone: '+String(e&&e.stack||e)); }
  try{ await desktop(browser); }catch(e){ fails.push('desktop_exception'); errors.push('desktop: '+String(e&&e.stack||e)); }
  console.log(JSON.stringify({r, fails, errors}, null, 1));
  await browser.close(); srv.close(); process.exit(fails.length||errors.length?1:0);
})();
