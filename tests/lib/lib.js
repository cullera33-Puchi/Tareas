require('./out.js'); // outputs (screenshots, downloads) go to tests/out
// Shared harness for batch J (pre-release review): static server, page opener, touch helpers, error collection
const { chromium } = require('playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const TYPES = {'.html':'text/html','.css':'text/css','.js':'application/javascript','.webmanifest':'application/manifest+json','.png':'image/png','.svg':'image/svg+xml'};
function serve(port){ const srv = http.createServer((req,res)=>{ let p = decodeURIComponent(req.url.split('?')[0]); if(p==='/') p='/index.html'; const f=path.join(ROOT,p); if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){res.writeHead(404);res.end();return;} res.writeHead(200,{'Content-Type':TYPES[path.extname(f)]||'application/octet-stream'}); res.end(fs.readFileSync(f)); });
  return new Promise(r=>srv.listen(port,()=>r(srv))); }
const EMPTY = {spaces:[{id:'trabajo',name:'Trabajo',order:0},{id:'personal',name:'Personal',order:1}],projects:[],tasks:[],voiceNotes:[],settings:{tipsSeen:true}};
const errors = [];
// opts: mobile (default) or desk {w,h}; theme 'light'|'dark'; demo true; now Date; seed object
async function open(browser, url, o={}){
  const vp = o.desk ? {viewport:{width:o.w||1280,height:o.h||800}, deviceScaleFactor:1} : {viewport:{width:390,height:844}, deviceScaleFactor:2, isMobile:true, hasTouch:true};
  const ctx = await browser.newContext(Object.assign(vp, {colorScheme:o.theme||'light'}));
  const page = await ctx.newPage(); if(o.now) await page.clock.install({time:o.now});
  const tag = (o.desk?'D':'M')+(o.theme||'light')[0];
  await page.addInitScript(s=>{ if(!localStorage.getItem('tareas-v1')) localStorage.setItem('tareas-v1', s); }, JSON.stringify(o.seed||EMPTY));
  page.on('pageerror', e=>errors.push(tag+' pageerror: '+e.message)); page.on('console', m=>{ if(m.type()==='error') errors.push(tag+' console: '+m.text()); });
  await page.goto(url); await page.waitForTimeout(500);
  if(o.demo){ await page.evaluate(()=>{ generateDemo(); }); await page.waitForTimeout(900); await page.evaluate(()=>{ const t=document.querySelector('#toast'); if(t) t.classList.remove('show'); }); }
  return {ctx, page};
}
async function touchDrag(page, x, y, dx, dy, n=10, gap=16, hold=0){ const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]}); if(hold) await page.waitForTimeout(hold);
  for(let i=1;i<=n;i++){ await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+dx*i/n,y:y+dy*i/n}]}); await page.waitForTimeout(gap); }
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]}); await cdp.detach(); }
async function longPress(page, x, y, ms=700){ const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]}); await page.waitForTimeout(ms);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]}); await cdp.detach(); }
async function tapAt(page, x, y){ const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]}); await page.waitForTimeout(40);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]}); await cdp.detach(); }
async function box(page, sel){ return page.evaluate(s=>{ const e=document.querySelector(s); if(!e) return null; const r=e.getBoundingClientRect(); return {x:r.x,y:r.y,w:r.width,h:r.height,cx:r.x+r.width/2,cy:r.y+r.height/2}; }, sel); }
// Visible leaf text nodes in English or with forbidden punctuation
async function textAudit(page){ return page.evaluate(()=>{ const out=[]; const w=document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); let n;
  const EN=/\b(the|and|cancel|delete|save|done|today|tomorrow|undefined|null|NaN|Invalid|error|loading|settings|project|task)\b/i;
  while((n=w.nextNode())){ const t=n.nodeValue.trim(); if(!t) continue; const el=n.parentElement; if(!el||el.closest('script,style')) continue; const r=el.getBoundingClientRect(); if(!r.width||!r.height) continue;
    const cs=getComputedStyle(el); if(cs.visibility==='hidden'||cs.display==='none') continue;
    if(el.closest('.row-title,.notes,textarea,.vn-text,.vntext')) continue; // user content
    if(EN.test(t)||/ — |→|←|\bundefined\b|NaN|Invalid Date|[a-záéíóú]\/[a-záéíóú]/i.test(t)||(t.includes('·')&&!el.classList.contains('sep'))) out.push(t.slice(0,80)); }
  return [...new Set(out)]; }); }
module.exports = {chromium, serve, open, errors, touchDrag, longPress, tapAt, box, textAudit, EMPTY, OUT: path.join(__dirname, '..', 'out', 'J')};
