require('./lib/out.js'); const { openSetting, closeSetting } = require('./lib/settings.js'); // v0.37.4: Ajustes in subscreens on the iPhone // outputs (screenshots, downloads) go to tests/out
// Batch NV (owner, 4 November, decision 64, v0.33.1), port 8780. Screenshots in tests/out/NV.
//  1. novedades.json in the repository: well formed, newest first, 3 to 5 plain lines per version, the current APP_VERSION listed.
//  2. Ajustes: no «Generar datos de prueba»; «Eliminar datos de prueba» only while demo data exist (generateDemo from the page).
//  3. Ajustes, Novedades: every version, newest first, the installed one marked, Cerrar only (no update waiting).
//  4. A real service worker update (the server rewrites APP_VERSION and CACHE): the notes are read when it is detected, without cache
//     and never from the service worker; «Actualizar» opens «Novedades de la X» with only the newer versions in order; Más tarde
//     closes without updating; Ajustes then marks them Nueva; Actualizar applies the update and novedades.json stays out of the caches.
//  5. Fallbacks: the notes cannot be read (HTTP 500) or list nothing newer: «Actualizar» updates right away, no sheet.
//  6. The sheet on the iPhone in dark mode and on the desktop (centred window), with its Actualizar reaching the waiting worker.
//  7. The rest of v0.33.1 on a realistic Hoy (tests/lib/hoy-seed.js, the owner's screenshot of 5 November):
//     - the head of Ahora: Modo foco and ¿Qué hago ahora? as icon buttons on the line of «Ahora N», centred on it, the last one ending
//       with the rows' last column (2 px), the line no taller than its text; iPhone and desktop, light and dark;
//     - the desktop columns: no Fecha in Hoy when only Completadas has times, Persona after Tarea, header labels over their cells (2 px);
//     - the person picker: screenshots of the list on the iPhone (light and dark) and the desktop popover.
const { chromium } = require('playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = path.resolve(__dirname, '..'), PORT = 8780, URL0 = 'http://localhost:'+PORT+'/';
const OUT = path.join(__dirname, 'out', 'NV'); fs.mkdirSync(OUT, {recursive:true});
const TYPES = {'.html':'text/html','.css':'text/css','.js':'application/javascript','.webmanifest':'application/manifest+json','.png':'image/png','.json':'application/json'};
let ver = '0.33.1', nvMode = 'ok', nvHits = 0;
// Out of order and with a malformed entry on purpose: the app sorts and cleans
const NOTES = [
  {version:'0.33.0', date:'2026-11-05', items:['Modo foco en el bloque Ahora.', 'Repetir desde que la hice.', 'Series que terminan.']},
  {version:'0.34.0', date:'2026-11-12', items:['Plantillas de tareas con sus pasos.', 'Filtros guardados en la barra lateral.', 'Un arreglo en el calendario.', 'Otra mejora pequeña.']},
  {version:'x.y', items:['mal formada']},
  {version:'0.33.1', date:'2026-11-05', items:['Novedades al actualizar.', 'Sin datos de prueba en Ajustes.', 'Lista en Ajustes.']},
  {version:'0.33.2', date:'2026-11-08', items:['Arreglos en la sincronización.', 'Textos más claros.', 'Menos avisos repetidos.']},
];
const srv = http.createServer((req,res)=>{ let p = decodeURIComponent(req.url.split('?')[0]); if(p==='/') p='/index.html';
  if(p==='/config.js'){ res.writeHead(200,{'Content-Type':'application/javascript'}); res.end('window.TAREAS_CONFIG = {"url":null,"anonKey":null};\n'); return; }
  if(p==='/novedades.json'){ nvHits++; if(nvMode==='fail'){ res.writeHead(500,{'Content-Type':'text/plain'}); res.end('error'); return; }
    res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'max-age=600'}); res.end(JSON.stringify(NOTES)); return; } // max-age: no-store must skip it
  const f=path.join(ROOT,p); if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){ res.writeHead(404,{'Content-Type':'text/html'}); res.end('<h1>404</h1>'); return; }
  let body=fs.readFileSync(f);
  if(p!=='/sw.js'&&/\.(html|js)$/.test(p)) body=body.toString().replace(/APP_VERSION = '[^']*'/, "APP_VERSION = '"+ver+"'");
  if(p==='/sw.js') body=body.toString().replace(/CACHE = '[^']*'/, "CACHE = 'tareas-"+ver+"'");
  res.writeHead(200,{'Content-Type':TYPES[path.extname(f)]||'application/octet-stream','Cache-Control':'no-cache'}); res.end(body); });
const r={}, fails=[], errors=[]; const check=(name, ok, info)=>{ r[name]=ok?true:(info===undefined?false:info); if(!ok) fails.push(name); };
const shot=(page, name)=>page.screenshot({path:path.join(OUT, name+'.png')});
const EMPTY = {spaces:[{id:'trabajo',name:'Trabajo',order:0},{id:'personal',name:'Personal',order:1}],projects:[],tasks:[],voiceNotes:[],settings:{tipsSeen:true}};
const until = (page, fn, arg, ms=8000) => page.waitForFunction(fn, arg, {timeout:ms});
const sheetOn = page => until(page, ()=>{ const s=document.querySelector('#sheet'); return s.classList.contains('on') && s.getAnimations().every(a=>a.playState!=='running'); });
const sheetOff = page => until(page, ()=>{ const s=document.querySelector('#sheet'); return !s.classList.contains('on') && s.getAnimations().every(a=>a.playState!=='running'); });
const sheetInfo = page => page.evaluate(()=>{ const s=document.querySelector('#sheet'); return { on:s.classList.contains('on'), title:(s.querySelector('h2')||{}).textContent,
  vers:[...s.querySelectorAll('.nv-v')].map(e=>e.textContent.replace('Versión ','')), tags:[...s.querySelectorAll('.nv-ver')].map(e=>{ const t=e.querySelector('.nv-tag'); return t?t.textContent:''; }),
  items:[...s.querySelectorAll('.nv-ver')].map(e=>e.querySelectorAll('li').length), btns:[...s.querySelectorAll('.sheet-actions .btn')].map(b=>b.textContent),
  listScroll:(()=>{ const l=s.querySelector('.nv-list'); return l?getComputedStyle(l).overflowY:null; })() }; });

async function openCtx(browser, o={}){
  const vp = o.desk ? {viewport:{width:1280,height:800}, deviceScaleFactor:1} : {viewport:{width:390,height:844}, deviceScaleFactor:2, isMobile:true, hasTouch:true};
  const ctx = await browser.newContext(Object.assign(vp, {colorScheme:o.theme||'light'}));
  const page = await ctx.newPage(); const tag=(o.desk?'D':'M')+(o.theme||'light')[0]+' ';
  await page.addInitScript(s=>{ if(!localStorage.getItem('tareas-v1')) localStorage.setItem('tareas-v1', s); }, JSON.stringify(EMPTY));
  page.on('pageerror', e=>errors.push(tag+'pageerror: '+e.message));
  page.on('console', m=>{ if(m.type()==='error'&&!(nvMode==='fail'&&/500/.test(m.text()))) errors.push(tag+'console: '+m.text()); });
  await page.goto(URL0); await until(page, ()=>navigator.serviceWorker.getRegistration().then(x=>!!(x&&x.active)));
  await page.reload(); await until(page, ()=>!!navigator.serviceWorker.controller); // second load: controlled by the worker
  return {ctx, page}; }
async function bump(page, v){ ver=v; await page.evaluate(()=>navigator.serviceWorker.getRegistration().then(x=>x.update()));
  await until(page, ()=>document.querySelector('#toast').classList.contains('on') && document.querySelector('#toastBtn').textContent==='Actualizar' && !!pendingSW); }
const ajustes = async page => { await closeSetting(page); await page.evaluate(()=>{ if(UI.wide) setDeskView('settings'); else switchTab('ajustes'); }); await until(page, ()=>!!document.querySelector('[data-act=news]')); }; // v0.37.4: Novedades stays on the index
const cell = (page, act) => page.$('.screen.settings [data-act='+act+'], .screen.root[data-root=ajustes] [data-act='+act+'], #desk [data-act='+act+']');

(async()=>{
  await new Promise(res=>srv.listen(PORT,res));
  const browser = await chromium.launch();

  /* ---------- 1. The file in the repository ---------- */
  { const j=JSON.parse(fs.readFileSync(path.join(ROOT,'novedades.json'),'utf8')); const app=fs.readFileSync(path.join(ROOT,'js','core.js'),'utf8').match(/APP_VERSION = '([^']*)'/)[1];
    const num=v=>v.split('.').map(Number); const desc=j.every((e,i)=>i===0||(a=>a[0]*1e6+a[1]*1e3+a[2])(num(j[i-1].version))>(a=>a[0]*1e6+a[1]*1e3+a[2])(num(e.version)));
    const bad=[]; j.forEach(e=>{ if(!/^\d+\.\d+\.\d+$/.test(e.version)||!/^\d{4}-\d{2}-\d{2}$/.test(e.date)) bad.push(e.version+' format'); if(e.items.length<3||e.items.length>5) bad.push(e.version+' '+e.items.length+' lines');
      e.items.forEach(s=>{ if(/·| — | – |→|←|\/|\bOK\b|\bclick\b|\bsync\b/i.test(s)) bad.push(e.version+': '+s); }); });
    check('file_ok', desc && !bad.length && j.length>=5, {desc, bad});
    check('file_current', j.some(e=>e.version===app) && j.some(e=>e.version==='0.33.1'), {app, first:j[0].version}); }

  /* ---------- 2 and 3. Ajustes on the iPhone: demo data and Novedades without an update ---------- */
  let {ctx, page} = await openCtx(browser);
  await ajustes(page);
  let x = await page.evaluate(()=>({gen:!!document.querySelector('[data-act=demo]'), clear:!!document.querySelector('[data-act=demoClear]'), news:(document.querySelector('[data-act=news]')||{}).textContent, upd:!!document.querySelector('[data-act=update]')}));
  check('demo_hidden', !x.gen && !x.clear && /Novedades/.test(x.news) && /v0\.33\.1/.test(x.news) && !x.upd, x);
  await page.evaluate(()=>{ generateDemo(); }); await page.evaluate(()=>render()); await openSetting(page, 'datos'); await until(page, ()=>!!document.querySelector('[data-act=demoClear]')); // v0.37.4: Datos y copias
  x = await page.evaluate(()=>({gen:!!document.querySelector('[data-act=demo]'), n:demoCount(), val:document.querySelector('[data-act=demoClear] .val').textContent}));
  check('demo_clear_only', !x.gen && x.n>100 && x.val===String(x.n), x);
  await (await cell(page,'demoClear')).click(); await until(page, ()=>document.querySelector('#asheet').classList.contains('on'));
  await page.click('#asheet .it:not(.cancel)'); await until(page, ()=>demoCount()===0 && !document.querySelector('[data-act=demoClear]'));
  check('demo_cleared', true);
  await page.evaluate(()=>document.querySelector('#toast').classList.remove('on')); // the Datos de prueba eliminados notice
  const hits0=nvHits; await (await cell(page,'news')).click(); await sheetOn(page);
  x = await sheetInfo(page); await shot(page, 'M-light-ajustes');
  check('ajustes_list', x.title==='Novedades' && x.vers.join()==='0.34.0,0.33.2,0.33.1,0.33.0' && x.tags.join()===',,Instalada,' && x.items.join()==='4,3,3,3' && x.btns.join()==='Cerrar' && x.listScroll==='auto' && nvHits===hits0+1, x);
  await page.click('#sheet [data-x=later]'); await sheetOff(page);

  /* ---------- 4. A real update: the offer, Más tarde, Ajustes, Actualizar ---------- */
  const hits1=nvHits; await page.evaluate(()=>{ NV.list=null; }); await bump(page, '0.34.0');
  await until(page, ()=>!!(NV.list&&NV.list.length)); check('fetched_on_detect', nvHits>hits1, {hits:nvHits-hits1});
  await page.click('#toastBtn'); await sheetOn(page); x = await sheetInfo(page); await shot(page, 'M-light-offer');
  check('offer_sheet', x.title==='Novedades de la 0.34.0' && x.vers.join()==='0.34.0,0.33.2' && x.tags.join()===',' && x.btns.join()==='Más tarde,Actualizar', x);
  await page.click('#sheet [data-x=later]'); await sheetOff(page);
  x = await page.evaluate(()=>({v:APP_VERSION, sw:!!pendingSW, toast:document.querySelector('#toast').classList.contains('on')?document.querySelector('#toastText').textContent:''}));
  check('later_keeps', x.v==='0.33.1' && x.sw && x.toast!=='Actualizando', x);
  await ajustes(page); await page.evaluate(()=>render());
  await page.evaluate(()=>{ document.querySelector('#toast').classList.remove('on'); const sc=document.querySelector('.screen.root[data-root=ajustes] .scroll'); sc.scrollTop=sc.scrollHeight; }); await shot(page, 'M-light-ajustes-version');
  await (await cell(page,'news')).click(); await sheetOn(page); x = await sheetInfo(page);
  check('ajustes_with_update', x.vers.join()==='0.34.0,0.33.2,0.33.1,0.33.0' && x.tags.join()==='Nueva,Nueva,Instalada,' && x.btns.join()==='Más tarde,Actualizar', x);
  await page.click('#sheet [data-x=later]'); await sheetOff(page);
  await (await cell(page,'update')).click(); await sheetOn(page); x = await sheetInfo(page);
  check('ajustes_update_offers', x.title==='Novedades de la 0.34.0', x);
  await page.click('#sheet [data-x=update]');
  await until(page, ()=>typeof APP_VERSION!=='undefined' && APP_VERSION==='0.34.0', null, 10000).catch(()=>{});
  x = await page.evaluate(async()=>{ const keys=await caches.keys(); let nv=false; for(const k of keys){ const c=await caches.open(k); if((await c.keys()).some(q=>/novedades/.test(q.url))) nv=true; } return {v:APP_VERSION, keys, nv}; });
  check('updated', x.v==='0.34.0' && JSON.stringify(x.keys)==='["tareas-0.34.0"]' && !x.nv, x);
  await ctx.close();

  /* ---------- 5. Fallbacks: notes unreadable, or nothing newer listed ---------- */
  for(const [mode, from, to] of [['fail','0.34.0','0.35.0'], ['ok','0.35.0','0.36.0']]){
    ver=from; nvMode='ok'; ({ctx, page} = await openCtx(browser)); nvMode=mode;
    await page.evaluate(()=>{ NV.list=null; const o=nvSheet; nvSheet=function(){ localStorage.setItem('nv-test','opened'); return o.apply(this, arguments); }; });
    await bump(page, to); await until(page, ()=>!NV.p);
    x = await page.evaluate(()=>({list:NV.list&&NV.list.length}));
    await page.click('#toastBtn');
    await until(page, v=>typeof APP_VERSION!=='undefined' && APP_VERSION===v, to, 10000).catch(()=>{});
    const y = await page.evaluate(()=>({v:APP_VERSION, opened:localStorage.getItem('nv-test')}));
    check('fallback_'+mode, y.v===to && !y.opened && (mode==='fail'?!x.list:x.list===4), {x, y});
    await ctx.close(); }
  nvMode='ok';

  /* ---------- 6. Dark iPhone and desktop: the offer sheet, its Actualizar reaches the waiting worker ---------- */
  ver='0.33.1';
  for(const o of [{theme:'dark'}, {desk:true}, {desk:true, theme:'dark'}]){
    ({ctx, page} = await openCtx(browser, o)); const tag=(o.desk?'D':'M')+'-'+(o.theme||'light');
    await page.evaluate(async()=>{ await nvFetch(); window.__posted=null; pendingSW={postMessage:m=>{ window.__posted=m&&m.type; }}; updateTap(); });
    await sheetOn(page); x = await sheetInfo(page); await shot(page, tag+'-offer');
    const geo = await page.evaluate(()=>{ const b=document.querySelector('#sheet').getBoundingClientRect(); return {cx:Math.round(b.x+b.width/2), cy:Math.round(b.y+b.height/2), w:Math.round(b.width), bottom:Math.round(b.bottom), vw:innerWidth, vh:innerHeight}; });
    const placed = o.desk ? Math.abs(geo.cx-geo.vw/2)<2 && Math.abs(geo.cy-geo.vh/2)<2 && geo.w===480 : geo.bottom>=geo.vh-1;
    if(o.desk){ await ajustes(page); await page.evaluate(()=>render()); }
    await page.click('#sheet [data-x=update]'); await sheetOff(page);
    const posted = await page.evaluate(()=>window.__posted);
    check('sheet_'+tag, x.title==='Novedades de la 0.34.0' && x.vers.join()==='0.34.0,0.33.2' && placed && posted==='SKIP_WAITING', {x, geo, posted});
    if(o.desk && !o.theme){ await page.evaluate(()=>{ pendingSW=null; render(); }); await until(page, ()=>!!document.querySelector('#desk [data-act=news]'));
      await page.click('#desk [data-act=news]'); await sheetOn(page); await shot(page, tag+'-ajustes'); x = await sheetInfo(page);
      check('desk_ajustes_list', x.vers.length===4 && x.btns.join()==='Cerrar', x); await page.keyboard.press('Escape'); }
    await ctx.close(); }

  /* ---------- 7. Ahora's head, the columns and the person picker on a realistic Hoy ---------- */
  const { seed: HOY, NOW } = require('./lib/hoy-seed.js');
  for(const o of [{}, {theme:'dark'}, {desk:true}, {desk:true, theme:'dark'}, {desk:true, theme:'dark', w:1700, pane:true}]){
    const vp = o.desk ? {viewport:{width:o.w||1400,height:900}, deviceScaleFactor:1} : {viewport:{width:390,height:844}, deviceScaleFactor:2, isMobile:true, hasTouch:true};
    const ctx = await browser.newContext(Object.assign(vp, {colorScheme:o.theme||'light', serviceWorkers:'block'})); const page = await ctx.newPage(); await page.clock.install({time:NOW});
    const tag=(o.desk?'D':'M')+'-'+(o.theme||'light')+(o.pane?'-pane':''); page.on('pageerror', e=>errors.push(tag+' pageerror: '+e.message));
    await page.addInitScript(s=>{ if(!localStorage.getItem('tareas-v1')) localStorage.setItem('tareas-v1', s); }, JSON.stringify(HOY()));
    await page.goto(URL0); await until(page, ()=>typeof DB!=='undefined' && !!document.querySelector((UI.wide?'#desk .main':'.screen.root')+' .ahora'));
    if(o.pane){ await page.evaluate(()=>{ UI.deskDetail='h1'; UI.dsel.cur='h1'; render(); }); await until(page, ()=>app.classList.contains('has-pane') && !document.querySelector('#desk .pane').getAnimations().some(a=>a.playState==='running')); }
    x = await page.evaluate(()=>{ const a=document.querySelector((UI.wide?'#desk .main':'.screen.root')+' .ahora'), h=a.querySelector('.ahead'), al=h.querySelector('.al'), B=e=>e.getBoundingClientRect(), mid=e=>B(e).top+B(e).height/2;
      const f=h.querySelector('[data-act=focusOn]'), s=h.querySelector('[data-act=suggest]'), row=a.querySelector('.row .row-content');
      const last=[...row.children].filter(e=>B(e).width>0).pop(), cs=getComputedStyle(h);
      return {fm:Math.abs(mid(f)-mid(al)), sm:Math.abs(mid(s)-mid(al)), right:Math.round(B(s).right-B(last).right), order:B(f).right<=B(s).left, w:Math.round(B(s).width), text:(f.textContent+s.textContent).trim(),
        labels:[f.title, f.getAttribute('aria-label'), s.title, s.getAttribute('aria-label')].join('|'), svgs:!!f.querySelector('svg')&&!!s.querySelector('svg'),
        tall:Math.round(B(h).height-parseFloat(cs.paddingTop)-parseFloat(cs.paddingBottom)-B(al).height)}; });
    check('ahora_head_'+tag, x.fm<=2 && x.sm<=2 && Math.abs(x.right)<=2 && x.order && x.w===28 && !x.text && x.svgs && x.tall<=1 && x.labels==='Modo foco|Modo foco|¿Qué hago ahora?|¿Qué hago ahora?', x);
    if(o.desk){
      if(!o.pane){ await page.hover('#desk .ahora [data-act=suggest]'); }
      x = await page.evaluate(()=>{ const h=document.querySelector('#desk .main .colhead'), seen=e=>e&&getComputedStyle(e).display!=='none'&&e.getBoundingClientRect().width>0, bad=[];
        const labels=[...h.querySelectorAll('.chl')].filter(e=>seen(e.parentElement)).map(e=>e.textContent);
        ['pcol','row-text','rc-per','rsteps','rc-date','rc-dl','rc-rem','rc-est'].forEach(k=>{ const a=h.querySelector('.'+k); if(!seen(a)) return; document.querySelectorAll('#desk .main .mbody .row[data-id]:not(.xs)').forEach(r=>{ const b=r.querySelector('.'+k), A=a.getBoundingClientRect(), Bb=b&&b.getBoundingClientRect(); if(!Bb||Math.abs(A.left-Bb.left)>2||Math.abs(A.right-Bb.right)>2) bad.push(r.dataset.id+' '+k); }); });
        const cut=[...document.querySelectorAll('#desk .main .mbody .row[data-id] .row-title')].filter(t=>t.scrollHeight>t.clientHeight+1).map(t=>t.closest('.row').dataset.id);
        const w=document.querySelector('#desk .main .row[data-id=w4]:not(.first .row) .rc-per');
        return {labels, bad, cut, per:w&&w.textContent, tip:w&&w.querySelector('.wtag').title, done:(document.querySelector('#desk .main .row.xs[data-id=d1] .rc-date')||{}).textContent}; });
      check('cols_'+tag, !x.labels.includes('Fecha') && x.labels.includes('Persona') && x.labels.indexOf('Persona')===x.labels.indexOf('Tarea')+1 && !x.bad.length && x.per==='Jorge Martínez de la Fuente' && x.tip==='Esperando a Jorge Martínez de la Fuente' && /^\d{1,2}:\d{2}$/.test(x.done||''), x);
      await shot(page, tag+'-hoy');
      if(o.theme==='dark' && !o.pane){ await page.evaluate(()=>{ UI.deskDetail='h5'; UI.dsel.cur='h5'; render(); }); await until(page, ()=>!!document.querySelector('#desk .pane [data-act=pickResp]'));
        await page.click('#desk .pane [data-act=pickResp]'); await until(page, ()=>!!document.querySelector('#pmenu .pp-pop .pplist .pprow'));
        await page.keyboard.press('ArrowDown'); await shot(page, tag+'-responsable'); await page.keyboard.press('Escape'); }
    } else {
      await shot(page, tag+'-hoy');
      await page.evaluate(()=>responsibleSheet('h5')); await sheetOn(page); await shot(page, tag+'-responsable');
      await page.evaluate(()=>closeSheet()); await sheetOff(page); await page.evaluate(()=>waitingSheet('w2')); await sheetOn(page); await shot(page, tag+'-esperando');
    }
    await ctx.close(); }

  r.fails=fails; r.errors=errors; console.log(JSON.stringify(r,null,1)); await browser.close(); srv.close();
  process.exit(fails.length||errors.length?1:0);
})().catch(e=>{ console.error(e); process.exit(1); });
