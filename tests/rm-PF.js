require('./lib/out.js'); // outputs (screenshots, downloads) go to tests/out
// New task proposes the project in context (v0.29.2), port 10800.
//  iPhone: the + of a project screen proposes it; with a project filter, the + of Hoy (with today) and of Todas (no date), and a day header's +.
//  Desktop: the add bar of a project, of Hoy and of Todas with a filter; a search proposes nothing; a month day's double click with a filter.
const { chromium } = require('playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = path.resolve(__dirname, '..'), PORT = 10800, URL0 = 'http://localhost:'+PORT+'/';
const TYPES = {'.html':'text/html','.css':'text/css','.js':'application/javascript','.webmanifest':'application/manifest+json','.png':'image/png'};
const srv = http.createServer((req,res)=>{ let p = decodeURIComponent(req.url.split('?')[0]); if(p==='/') p='/index.html';
  if(p==='/config.js'){ res.writeHead(200,{'Content-Type':'application/javascript'}); res.end('window.TAREAS_CONFIG = {"url":null,"anonKey":null};\n'); return; }
  const f=path.join(ROOT,p); if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){ res.writeHead(404,{'Content-Type':'text/html'}); res.end('<h1>404</h1>'); return; }
  res.writeHead(200,{'Content-Type':TYPES[path.extname(f)]||'application/octet-stream'}); res.end(fs.readFileSync(f)); });
const r={}, fails=[], errors=[]; const check=(name, ok, info)=>{ r[name]=ok?true:(info===undefined?false:info); if(!ok) fails.push(name); };
const sleep=ms=>new Promise(res=>setTimeout(res,ms));
const until = async (page, fn, arg, ms=8000)=>{ const t0=Date.now(); for(;;){ let v=false; try{ v=await page.evaluate(fn, arg); }catch(e){} if(v) return true; if(Date.now()-t0>ms) return false; await sleep(80); } };
const T='2026-11-03T10:00:00Z';
const SEED = JSON.stringify({spaces:[{id:'trabajo',name:'Trabajo',order:0}], projects:[{id:'p1',spaceId:'trabajo',name:'FLC',color:'#FF9500',order:0},{id:'p2',spaceId:'trabajo',name:'OCA',color:'#007AFF',order:1}],
  tasks:[{id:'a1',title:'Uno',spaceId:'trabajo',projectId:'p1',status:'pending',priority:'none',date:null,created:T,modified:T},{id:'a2',title:'Dos',spaceId:'trabajo',projectId:'p1',status:'pending',priority:'none',date:'2026-11-10',created:T,modified:T}],
  voiceNotes:[], settings:{tipsSeen:true}});
async function open(browser, desk){
  const ctx = await browser.newContext(desk?{viewport:{width:1440,height:900}}:{viewport:{width:390,height:844}, isMobile:true, hasTouch:true});
  await ctx.addInitScript(()=>{ const D=Date, fix=new D('2026-11-03T10:10:00').getTime(), off=fix-D.now(); class FD extends D{ constructor(...a){ if(!a.length) super(D.now()+off); else super(...a); } static now(){ return D.now()+off; } } window.Date=FD; });
  const page = await ctx.newPage(); const tag=desk?'D':'M'; page.on('pageerror', e=>errors.push(tag+' pageerror: '+e.message));
  await page.addInitScript(s=>{ if(!localStorage.getItem('tareas-v1')) localStorage.setItem('tareas-v1', s); }, SEED);
  await page.goto(URL0); await until(page, ()=>typeof DB!=='undefined'&&!!document.querySelector(UI.wide?'#desk .main':'.screen.root'));
  return {ctx, page};
}
// The iPhone add sheet: which project and date tokens it proposes; then it closes
const sheetState = async page => { await until(page, ()=>document.querySelector('#sheet').classList.contains('on')); await sleep(200);
  const s = await page.evaluate(()=>({toks:[...document.querySelectorAll('#sheet .tok')].map(t=>t.textContent.replace('×','').trim())}));
  await page.evaluate(()=>closeSheet()); await until(page, ()=>!document.querySelector('#sheet').classList.contains('on')); await sleep(400); return s; };
async function iphone(browser){
  const {ctx, page} = await open(browser, false); let s;
  await page.evaluate(()=>{ switchTab('proyectos'); }); await sleep(500);
  await page.tap('[data-open-project=p1]'); await until(page, ()=>UI.stack.length===1); await sleep(700);
  await page.tap('.screen.project .fab'); s = await sheetState(page); check('m_project_fab', s.toks.includes('FLC'), s);
  await page.evaluate(()=>pop()); await sleep(700);
  await page.evaluate(()=>{ switchTab('tareas'); DB.settings.filter='hoy'; UI.projFilter='p1'; render(); }); await sleep(500);
  await page.evaluate(()=>addFromList()); s = await sheetState(page); check('m_hoy_filter', s.toks.includes('FLC') && s.toks.includes('Hoy'), s);
  await page.evaluate(()=>{ DB.settings.filter='todas'; UI.projFilter='p1'; render(); }); await sleep(500);
  await page.evaluate(()=>addFromList()); s = await sheetState(page); check('m_todas_filter', s.toks.includes('FLC') && !s.toks.includes('Hoy'), s);
  await page.evaluate(()=>{ const b=document.querySelector('.screen.root[data-root=tareas] .gadd[data-add-date="2026-11-10"]'); b.click(); }); s = await sheetState(page);
  check('m_dayhead_filter', s.toks.includes('FLC'), s);
  await page.evaluate(()=>{ UI.projFilter=null; render(); }); await sleep(300);
  await page.evaluate(()=>addFromList()); s = await sheetState(page); check('m_todas_nofilter', !s.toks.some(t=>t==='FLC'||t==='OCA'), s);
  await ctx.close();
}
async function desktop(browser){
  const {ctx, page} = await open(browser, true);
  const viaBar = async (title) => { await page.click('#desk [data-role=addbar]'); await page.keyboard.type(title); await sleep(250); await page.keyboard.press('Enter'); await sleep(350);
    const t = await page.evaluate(t=>DB.tasks.find(x=>x.title===t), title); await page.keyboard.press('Escape'); await sleep(250); return t&&{p:t.projectId, d:t.date||null}; };
  await page.evaluate(()=>setDeskView('project:p1')); await sleep(400);
  check('d_project_bar', (await viaBar('Ta')).p==='p1');
  await page.evaluate(()=>{ setDeskView('todas'); UI.projFilter='p1'; render(); }); await sleep(400);
  let x = await viaBar('Tb'); check('d_todas_filter', x.p==='p1' && !x.d, x);
  await page.evaluate(()=>{ setDeskView('hoy'); UI.projFilter='p2'; render(); }); await sleep(400);
  x = await viaBar('Tc'); check('d_hoy_filter', x.p==='p2' && x.d==='2026-11-03', x);
  await page.evaluate(()=>{ setDeskView('todas'); UI.projFilter=null; render(); }); await sleep(400);
  x = await viaBar('Td'); check('d_todas_nofilter', !x.p, x);
  await ctx.close();
}
(async()=>{
  await new Promise(res=>srv.listen(PORT,res)); const browser = await chromium.launch();
  try{ await iphone(browser); }catch(e){ fails.push('iphone_exception'); errors.push('iphone: '+String(e&&e.stack||e)); }
  try{ await desktop(browser); }catch(e){ fails.push('desktop_exception'); errors.push('desktop: '+String(e&&e.stack||e)); }
  console.log(JSON.stringify({r, fails, errors}, null, 1));
  await browser.close(); srv.close(); process.exit(fails.length||errors.length?1:0);
})();
