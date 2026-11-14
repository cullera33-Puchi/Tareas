require('./lib/out.js'); const { openSetting } = require('./lib/settings.js'); // v0.37.4: Ajustes in subscreens on the iPhone // outputs (screenshots, downloads) go to tests/out
const { chromium } = require('playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const TYPES = {'.html':'text/html','.css':'text/css','.js':'application/javascript','.webmanifest':'application/manifest+json','.png':'image/png'};
const srv = http.createServer((req,res)=>{ let p = decodeURIComponent(req.url.split('?')[0]); if(p==='/') p='/index.html'; const f=path.join(ROOT,p); if(!fs.existsSync(f)){res.writeHead(404);res.end();return;} res.writeHead(200,{'Content-Type':TYPES[path.extname(f)]||'application/octet-stream'}); res.end(fs.readFileSync(f)); });
(async()=>{
  await new Promise(r=>srv.listen(8788,r));
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport:{width:390,height:844}, deviceScaleFactor:2, isMobile:true, hasTouch:true, acceptDownloads:true });
  const page = await ctx.newPage(); await page.addInitScript(()=>{ localStorage.setItem('tareas-v1', JSON.stringify({spaces:[{id:'trabajo',name:'Trabajo',order:0},{id:'personal',name:'Personal',order:1}],projects:[],tasks:[],voiceNotes:[],settings:{tipsSeen:true}})); });
  const errors=[]; page.on('pageerror', e=>errors.push(e.message)); page.on('console', m=>{ if(m.type()==='error') errors.push(m.text()); });
  await page.goto('http://localhost:8788/'); await page.waitForTimeout(500); const r={}; const T='.screen.root[data-root=tareas] ';
  await page.evaluate(()=>{ const a=addProject('FLC','#FF9500'), b=addProject('Verifactu','#007AFF'); const t=todayStr(); addTask({title:'A1',date:t,projectId:a.id,priority:'high'}); addTask({title:'A2',date:t,projectId:a.id}); addTask({title:'B1',date:t,projectId:b.id}); addTask({title:'Suelta',date:t}); addTask({title:'SF1',projectId:a.id,notes:'con "comillas"; y punto y coma'}); addTask({title:'SF2'}); addTask({title:'SF3'}); render(); }); await page.waitForTimeout(200);
  // 1. Project chips
  r.chips = await page.$$eval(T+'.pchips .chip', c=>c.map(x=>x.textContent)); await page.click(T+'.pchips [data-pf]:nth-child(1)'); await page.waitForTimeout(200);
  r.filtered = await page.$$eval(T+'.group .row .row-title', t=>t.map(x=>x.textContent)); r.chipOn = await page.$eval(T+'.pchips .chip.on', e=>e.style.background);
  await page.screenshot({path:'34-projfilter.png'});
  await page.click(T+'.pchips [data-pf=none]'); await page.waitForTimeout(200); r.filteredNone = await page.$$eval(T+'.group .row .row-title', t=>t.map(x=>x.textContent));
  await page.click(T+'.pchips [data-pf=none]'); await page.waitForTimeout(200); r.unfiltered = await page.$$eval(T+'.group .row', t=>t.length);
  // 2. Close the day (force the clock past 18:00)
  await page.evaluate(()=>{ const RD=Date; const fixed=new RD(); fixed.setHours(19,0,0,0); window.Date=class extends RD{ constructor(...a){ super(...(a.length?a:[fixed.getTime()])); } static now(){ return fixed.getTime(); } }; render(); }); await page.waitForTimeout(200);
  r.closeDayBtn = await page.$eval(T+'.closecell', e=>e.textContent).catch(()=>null); if(!r.closeDayBtn) errors.push('no Cerrar el día cell at 19:00'); // decision 52: the cell at the end of Hoy
  // Updated by batch C (R8): Cerrar el día opens a sheet with the day's balance and its actions as cells
  await page.click(T+'[data-act=closeDay]'); await page.waitForTimeout(350); r.closeDayOpts = await page.$$eval('#sheet [data-cd]', b=>b.map(x=>x.textContent.trim()));
  await page.click('#sheet [data-cd=rest]'); await page.waitForTimeout(500);
  r.afterClose = await page.evaluate(()=>({today:pendingFor('hoy').map(x=>x.title), tomorrow:DB.tasks.filter(x=>x.date===addDays(todayStr(),1)).map(x=>x.title), toast:document.querySelector('#toastText').textContent}));
  await page.click('#toastBtn'); await page.waitForTimeout(300); r.undone = await page.evaluate(()=>pendingFor('hoy').length);
  // 3. Plan the undated
  await page.click(T+'[data-filter=todas]'); await page.waitForTimeout(200); r.planLink = await page.$eval(T+'[data-act=plan]', e=>e.textContent);
  await page.click(T+'[data-act=plan]'); await page.waitForTimeout(400); r.planFirst = await page.evaluate(()=>({title:document.querySelector('#sheet .plan-title').textContent, hint:document.querySelector('#sheet .hint').textContent, cal:!!document.querySelector('#sheet .cal')}));
  await page.screenshot({path:'35-plan.png'});
  await page.click('#sheet .chips [data-d]:nth-child(2)'); await page.waitForTimeout(300);   // Mañana for SF1
  r.planSecond = await page.$eval('#sheet .plan-title', e=>e.textContent);
  await page.click('#sheet [data-x=skip]'); await page.waitForTimeout(300); await page.click('#sheet .cal-d.today'); await page.waitForTimeout(500);
  r.planEnd = await page.evaluate(()=>({sheetOpen:document.querySelector('#sheet').classList.contains('on'), toast:document.querySelector('#toastText').textContent, dates:DB.tasks.filter(x=>/^SF/.test(x.title)).map(x=>x.title+':'+(x.date===todayStr()?'today':x.date===addDays(todayStr(),1)?'tomorrow':x.date))}));
  // 4. CSV
  const SS=await openSetting(page, 'datos');
  const [dl] = await Promise.all([ page.waitForEvent('download',{timeout:5000}).catch(()=>null), page.click(SS+' [data-act=exportCSV]') ]);
  if(dl){ const txt=fs.readFileSync(await dl.path(),'utf8'); r.csv={name:dl.suggestedFilename(), bom:txt.charCodeAt(0)===0xFEFF, head:txt.split('\r\n')[0], rows:txt.trim().split('\r\n').length-1, quoted:/"con ""comillas""; y punto y coma"/.test(txt)}; }
  r.errors=errors; console.log(JSON.stringify(r,null,1)); await browser.close(); srv.close();
})().catch(e=>{ console.error(e); process.exit(1); });
