require('./out.js'); // outputs (screenshots, downloads) go to tests/out
// Adapted from the hotfix test repro.js (v0.14.1 diagnosis) for the merge of main into roadmap-r1-r20 (batch I).
// Proyecto in the detail is now an R10 anchored menu (#pmenu) instead of the bottom action sheet: the sample tracks the menu (M)
// and asserts that neither it nor the Fecha sheet closes by itself, and that the action sheet keeps the v0.14.5 timing (0.45 s).
const { chromium } = require('playwright'); const http=require('http'),fs=require('fs'),path=require('path');
const ROOT=process.argv[2]||path.resolve(__dirname, '..', '..'), PORT=+(process.argv[3]||9414);
const srv=http.createServer((q,s)=>{let p=decodeURIComponent(q.url.split('?')[0]); if(p==='/')p='/index.html'; const f=path.join(ROOT,p); if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){s.writeHead(404);s.end();return;} s.writeHead(200,{'Content-Type':p.endsWith('.js')?'application/javascript':p.endsWith('.css')?'text/css':p.endsWith('.png')?'image/png':'text/html'}); s.end(fs.readFileSync(f));});
(async()=>{ await new Promise(r=>srv.listen(PORT,r)); const b=await chromium.launch(); const ctx=await b.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:2}); const page=await ctx.newPage();
  await page.addInitScript(()=>{ if(!localStorage.getItem('tareas-v1')) localStorage.setItem('tareas-v1', JSON.stringify({spaces:[{id:'trabajo',name:'Trabajo',order:0},{id:'personal',name:'Personal',order:1}],projects:[],tasks:[],voiceNotes:[],settings:{tipsSeen:true}})); });
  const errors=[]; page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://localhost:'+PORT+'/'); await page.waitForTimeout(500);
  await page.evaluate(()=>{ addProject('FLC','#FF9500'); addTask({title:'Tarea uno',date:todayStr()}); render(); });
  await page.waitForTimeout(300);
  await page.tap('.screen.root[data-root=tareas] .group .row .row-title'); await page.waitForTimeout(700);
  const sample = async ()=>{ const out=[]; for(let i=0;i<12;i++){ out.push(await page.evaluate(()=>(sheet.classList.contains('on')?'S':'-')+(asheet.classList.contains('on')?'A':'-')+(menuOpen()?'M':'-'))); await page.waitForTimeout(50);} return out; };
  await page.tap('.pushed-screen [data-act=pickProject]'); const p=await sample(); console.log('Proyecto: '+p.join(' '));
  if(!p.every(x=>x==='--M')) errors.push('Proyecto menu should stay open by itself');
  await page.evaluate(()=>closeMenu(true)); await page.waitForTimeout(500);
  await page.tap('.pushed-screen [data-act=pickDate]'); const f=await sample(); console.log('Fecha: '+f.join(' '));
  if(!f.every(x=>x==='S--')) errors.push('Fecha sheet should stay open by itself');
  const st=await page.evaluate(()=>({tf:getComputedStyle(asheet).transitionDuration, sheetTf:getComputedStyle(sheet).transitionDuration, early:LOG.filter(e=>/Hoja cerrada/.test(e.m)).length}));
  console.log(JSON.stringify(st)); if(!/0\.45s/.test(st.tf)||!/0\.5s/.test(st.sheetTf)) errors.push('v0.14.5 timings'); if(st.early) errors.push('early close logged');
  console.log(JSON.stringify({errors})); await b.close(); srv.close(); process.exit(errors.length?1:0); })().catch(e=>{console.error(e);process.exit(1)});
