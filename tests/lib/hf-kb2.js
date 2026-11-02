require('./out.js'); // outputs (screenshots, downloads) go to tests/out
// Adapted from the hotfix test kb2.js for the merge of main (v0.14.1 to v0.14.5) into roadmap-r1-r20 (batch I).
// Nueva tarea uses the R5 icon bar: Añadir is .qadd, not a header button; checks that it stays above the floating keyboard bar (kbup) or in the top sheet (kbFallback).
const { chromium } = require('playwright'); const http=require('http'),fs=require('fs'),path=require('path');
const ROOT=process.argv[2]||path.resolve(__dirname, '..', '..'), PORT=+(process.argv[3]||9412), OUT=process.argv[4]||path.join(__dirname, '..', 'out', 'I'); require('fs').mkdirSync(OUT,{recursive:true});
const srv=http.createServer((q,s)=>{let p=decodeURIComponent(q.url.split('?')[0]); if(p==='/')p='/index.html'; const f=path.join(ROOT,p); if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){s.writeHead(404);s.end();return;} s.writeHead(200,{'Content-Type':p.endsWith('.js')?'text/javascript':p.endsWith('.css')?'text/css':'text/html'}); s.end(fs.readFileSync(f));});
(async()=>{ await new Promise(r=>srv.listen(PORT,r)); const b=await chromium.launch(); const r={}, errors=[];
 for(const mode of ['normal','shrunk']){ const page=await (await b.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:2,colorScheme:'dark'})).newPage();
  await page.addInitScript(m=>{ Object.defineProperty(navigator,'standalone',{get:()=>true}); if(m==='shrunk') Object.defineProperty(screen,'height',{get:()=>1400}); if(!localStorage.getItem('tareas-v1')) localStorage.setItem('tareas-v1', JSON.stringify({spaces:[{id:'trabajo',name:'Trabajo',order:0}],projects:[],tasks:[],voiceNotes:[],settings:{tipsSeen:true}})); }, mode);
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://localhost:'+PORT+'/'); await page.waitForTimeout(400);
  await page.evaluate(()=>{ addTask({title:'Revisar plan de cutover',date:todayStr()}); render(); });
  await page.tap('.screen.root[data-root=tareas] .group .row .row-title'); await page.waitForTimeout(600);
  await page.tap('.pushed-screen [data-act=voice]'); await page.waitForTimeout(1500);
  const st=await page.evaluate(()=>({top:sheet.classList.contains('top'), kbup:document.documentElement.classList.contains('kbup'), head:!!document.querySelector('#sheet .shead [data-x=ok]'), log:LOG.slice(-2).map(e=>e.m)}));
  await page.screenshot({path:OUT+'/kb2-'+mode+'.png'});
  await page.keyboard.type('Nota uno'); await page.tap('#sheet .shead [data-x=ok]'); await page.waitForTimeout(500);
  st.saved=await page.evaluate(()=>DB.voiceNotes.map(v=>v.text)); st.open=await page.evaluate(()=>sheet.classList.contains('on'));
  // add sheet with header: Añadir from the header
  await page.tap('.pushed-screen .back, .pushed-screen [data-back]').catch(()=>{}); await page.evaluate(()=>{ pop&&pop(); }).catch(()=>{}); await page.waitForTimeout(500);
  await page.evaluate(()=>addSheet()); await page.waitForTimeout(300); await page.waitForTimeout(1300); /* after kbFallback('late') */
  // R5 (batch B): Nueva tarea has no header; Añadir is in the icon bar on the keyboard (.qadd). It must stay clear of the iOS 26 floating bar:
  // with kbup the sheet keeps 64 px under it; with the sheet moved to the top (no keyboard reported) the bar is in the top half
  st.add=await page.evaluate(()=>{ const q=document.querySelector('#sheet .qadd').getBoundingClientRect(), bar=document.querySelector('#sheet .qbar').getBoundingClientRect(), sh=sheet.getBoundingClientRect(); return {cls:sheet.className, kbup:document.documentElement.classList.contains('kbup'), qbottom:Math.round(q.bottom), barBottom:Math.round(bar.bottom), sheetBottom:Math.round(sh.bottom), pad:getComputedStyle(sheet).paddingBottom, ih:innerHeight}; });
  await page.screenshot({path:OUT+'/kb2-add-'+mode+'.png'});
  await page.keyboard.type('Tarea desde cabecera'); await page.tap('#sheet .qadd'); await page.waitForTimeout(500);
  st.added=await page.evaluate(()=>DB.tasks.some(t=>t.title==='Tarea desde cabecera'));
  r[mode]=st;
  if(mode==='normal'&&!st.top) errors.push('normal: sheet should move to top when no keyboard is reported');
  if(mode==='shrunk'&&(st.top||!st.kbup)) errors.push('shrunk: sheet should stay at the bottom with kbup');
  if(!st.head||st.saved.length!==1||st.open||!st.added) errors.push(mode+': header actions failed');
  if(!/addsheet/.test(st.add.cls)) errors.push(mode+': add sheet class');
  if(mode==='normal'&&(!/\btop\b/.test(st.add.cls)||st.add.qbottom>st.add.ih*0.5)) errors.push(mode+': add sheet should move to the top with its bar visible');
  if(mode==='shrunk'&&(!st.add.kbup||st.add.pad!=='64px'||st.add.sheetBottom-st.add.barBottom<60)) errors.push(mode+': the icon bar must sit above the floating keyboard bar');
 }
 console.log(JSON.stringify(r,null,1)); console.log(JSON.stringify({errors})); await b.close(); srv.close(); process.exit(errors.length?1:0); })().catch(e=>{console.error(e);process.exit(1)});
