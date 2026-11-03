require('./out.js'); // outputs (screenshots, downloads) go to tests/out
// Adapted from the hotfix test vn.js for the merge of main (v0.14.1 to v0.14.5) into roadmap-r1-r20 (batch I).
// Decision 49: dictated voice notes are gone; the old ones are lines of Notas. What stays is the swipe of a recording row (now called
// «Nota de voz»): left to Eliminar only, no back swipe from it, bound once, the R4 back swipe still works, and the desktop Mac menu.
const { chromium } = require('playwright'); const http=require('http'),fs=require('fs'),path=require('path');
const ROOT=process.argv[2]||path.resolve(__dirname, '..', '..'), PORT=+(process.argv[3]||9411), OUT=process.argv[4]||path.join(__dirname, '..', 'out', 'I'); require('fs').mkdirSync(OUT,{recursive:true});
const srv=http.createServer((q,s)=>{let p=decodeURIComponent(q.url.split('?')[0]); if(p==='/')p='/index.html'; const f=path.join(ROOT,p); if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){s.writeHead(404);s.end();return;} s.writeHead(200,{'Content-Type':p.endsWith('.js')?'text/javascript':p.endsWith('.css')?'text/css':'text/html'}); s.end(fs.readFileSync(f));});
const errors=[]; const ok=(c,m)=>{ if(!c) errors.push(m); };
async function swipe(page, sel, dx){ const b=await page.locator(sel).boundingBox(); const x=b.x+b.width/2, y=b.y+b.height/2;
  const cdp=await page.context().newCDPSession(page);
  const tp=(type,xx)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:type==='touchEnd'?[]:[{x:xx,y}]});
  await tp('touchStart',x); const n=8; for(let i=1;i<=n;i++){ await tp('touchMove',x+dx*i/n); await page.waitForTimeout(16); } await tp('touchEnd'); await page.waitForTimeout(400); }
(async()=>{ await new Promise(r=>srv.listen(PORT,r)); const b=await chromium.launch(); const r={};
 const seed=()=>{ Object.defineProperty(navigator,'standalone',{get:()=>true}); if(!localStorage.getItem('tareas-v1')) localStorage.setItem('tareas-v1', JSON.stringify({spaces:[{id:'trabajo',name:'Trabajo',order:0}],projects:[],tasks:[{id:'t1',title:'Documentar facturas',spaceId:'trabajo',date:null,priority:'none',status:'pending',notes:'',created:'2026-10-30T10:00:00Z',modified:'2026-10-30T10:00:00Z'}],voiceNotes:[{id:'v1',taskId:'t1',text:'Primera nota',created:'2026-10-31T09:00:00Z'},{id:'v2',taskId:'t1',text:'Segunda nota',created:'2026-10-31T10:00:00Z'}],attachments:[{id:'a1',taskId:'t1',kind:'audio',path:null,mime:'audio/mp4',size:4000,width:null,height:null,durationMs:5000,created:'2026-10-31T11:00:00Z',modified:'2026-10-31T11:00:00Z'}],settings:{tipsSeen:true,filter:'todas'}})); };
 const NOTES='31/10 10:00: Primera nota\n31/10 11:00: Segunda nota'; // Europe/Madrid, winter time
 // mobile
 { const page=await (await b.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:2,colorScheme:'dark',timezoneId:'Europe/Madrid'})).newPage();
  await page.addInitScript(seed); page.on('pageerror',e=>errors.push('page: '+e.message));
  await page.goto('http://localhost:'+PORT+'/'); await page.waitForFunction(()=>typeof DB!=='undefined'&&DB);
  r.folded=await page.evaluate(()=>({vn:DB.voiceNotes.length, notes:DB.tasks[0].notes})); ok(r.folded.vn===0&&r.folded.notes===NOTES,'voice notes folded into Notas at the start');
  await page.evaluate(()=>{ openDetail('t1'); }); await page.waitForFunction(()=>UI.stack.length===1&&!app.classList.contains('navigating'));
  const det='.pushed-screen ';
  r.detail=await page.evaluate(()=>({vn:document.querySelectorAll('.pushed-screen .vn[data-vn]').length, voiceBtn:!!document.querySelector('.pushed-screen [data-act=voice]'), titles:[...document.querySelectorAll('.pushed-screen .group-title')].map(e=>e.textContent), notes:document.querySelector('.pushed-screen [data-role=notes]').value, audioBtn:(document.querySelector('.pushed-screen [data-act=attAudio]')||{}).textContent, au:(document.querySelector('.pushed-screen .au-name')||{}).textContent}));
  ok(!r.detail.vn&&!r.detail.voiceBtn&&!r.detail.titles.includes('Notas de voz')&&r.detail.notes===NOTES,'detail without voice notes, lines in Notas');
  ok(r.detail.audioBtn==='Nota de voz'&&/^Nota de voz, /.test(r.detail.au||''),'the recording is called Nota de voz');
  await page.screenshot({path:OUT+'/vn-detail.png'});
  // swipe right on a recording: nothing opens, no sheet, no back swipe
  await swipe(page, det+'.vn[data-au=a1] .vn-c', 220);
  r.right=await page.evaluate(()=>({open:document.querySelector('.vn[data-au=a1]').dataset.open||'', sheet:sheet.classList.contains('on'), detail:UI.stack.length===1}));
  ok(!r.right.open&&!r.right.sheet&&r.right.detail,'a right swipe on a recording does nothing and does not go back');
  await page.evaluate(()=>render()); await page.waitForTimeout(100); r.boundOnce=await page.evaluate(()=>[...document.querySelectorAll('.pushed-screen .vn')].every(e=>e._vnb===1)); ok(r.boundOnce,'vn bound once');
  // swipe left: Eliminar
  await swipe(page, det+'.vn[data-au=a1] .vn-c', -200);
  r.openL=await page.evaluate(()=>{ const e=document.querySelector('.vn[data-au=a1]'); return {open:e.dataset.open, tr:e.querySelector('.vn-c').style.transform}; });
  ok(r.openL.open==='l'&&/-88px/.test(r.openL.tr),'left swipe stops at Eliminar');
  await page.screenshot({path:OUT+'/vn-left.png'});
  await page.tap(det+'.vn[data-au=a1] [data-aact=del]'); await page.waitForTimeout(400);
  r.del=await page.evaluate(()=>({n:DB.attachments.length, dom:document.querySelectorAll('.pushed-screen .vn[data-au]').length, toast:(document.querySelector('#toast')||{}).textContent}));
  ok(r.del.n===0&&r.del.dom===0&&/Nota de voz eliminada/.test(r.del.toast||''),'deleted, toast says Nota de voz');
  await page.evaluate(()=>{ const u=document.querySelector('#toast [data-undo], #toast button'); u&&u.click(); }); await page.waitForTimeout(300);
  r.undoDel=await page.evaluate(()=>DB.attachments.length); ok(r.undoDel===1,'undo delete');
  // the back swipe from the middle of the detail (R4) still pops when it starts outside rows and fields
  { const g=await page.evaluate(()=>{ const c=document.querySelector('.pushed-screen .group-title'); const b=c.getBoundingClientRect(); return {x:b.left+150, y:b.top+b.height/2}; });
    const cdp=await page.context().newCDPSession(page); const tp=(type,xx)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:type==='touchEnd'?[]:[{x:xx,y:g.y}]});
    await tp('touchStart',g.x); for(let i=1;i<=8;i++){ await tp('touchMove',g.x+200*i/8); await page.waitForTimeout(16); } await tp('touchEnd'); await page.waitForTimeout(700);
    r.poppedFromMiddle=await page.evaluate(()=>UI.stack.length===0); ok(r.poppedFromMiddle,'R4 back swipe from the middle of the detail'); }
 }
 // desktop
 { const page=await (await b.newContext({viewport:{width:1280,height:800},timezoneId:'Europe/Madrid'})).newPage(); await page.addInitScript(seed); page.on('pageerror',e=>errors.push('desk: '+e.message));
  await page.goto('http://localhost:'+PORT+'/'); await page.waitForTimeout(500); await page.evaluate(()=>openDetail('t1')); await page.waitForTimeout(500);
  r.desk=await page.evaluate(()=>({vn:document.querySelectorAll('.vn[data-vn]').length, voiceBtn:!!document.querySelector('#desk [data-act=voice]'), notes:(document.querySelector('#desk [data-role=notes]')||{}).value}));
  ok(!r.desk.vn&&!r.desk.voiceBtn&&r.desk.notes===NOTES,'inspector without voice notes, lines in Notas');
  // R17: a click on a recording opens a Mac menu at the pointer
  await page.click('.vn[data-au=a1] .au-name'); await page.waitForTimeout(500);
  r.deskMenu=await page.evaluate(()=>({mac:document.querySelector('#pmenu').classList.contains('mac'), on:menuOpen(), txt:document.querySelector('#pmenu').textContent})); ok(r.deskMenu.mac&&r.deskMenu.on&&/Eliminar nota de voz/.test(r.deskMenu.txt),'desktop menu');
  await page.screenshot({path:OUT+'/vn-desk.png'});
 }
 console.log(JSON.stringify(r,null,1)); console.log(JSON.stringify({errors})); await b.close(); srv.close(); process.exit(errors.length?1:0); })().catch(e=>{console.error(e);process.exit(1)});
