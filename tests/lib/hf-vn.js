require('./out.js'); // outputs (screenshots, downloads) go to tests/out
// Adapted from the hotfix test vn.js for the merge of main (v0.14.1 to v0.14.5) into roadmap-r1-r20 (batch I).
// Desktop: the voice note menu is a Mac menu (R17) instead of the action sheet. Added: no back swipe from a note, bound once, R4 back swipe still works.
const { chromium } = require('playwright'); const http=require('http'),fs=require('fs'),path=require('path');
const ROOT=process.argv[2]||path.resolve(__dirname, '..', '..'), PORT=+(process.argv[3]||9411), OUT=process.argv[4]||path.join(__dirname, '..', 'out', 'I'); require('fs').mkdirSync(OUT,{recursive:true});
const srv=http.createServer((q,s)=>{let p=decodeURIComponent(q.url.split('?')[0]); if(p==='/')p='/index.html'; const f=path.join(ROOT,p); if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){s.writeHead(404);s.end();return;} s.writeHead(200,{'Content-Type':p.endsWith('.js')?'text/javascript':'text/html'}); s.end(fs.readFileSync(f));});
const errors=[]; const ok=(c,m)=>{ if(!c) errors.push(m); };
async function swipe(page, sel, dx){ const b=await page.locator(sel).boundingBox(); const x=b.x+b.width/2, y=b.y+b.height/2;
  const cdp=await page.context().newCDPSession(page);
  const tp=(type,xx)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:type==='touchEnd'?[]:[{x:xx,y}]});
  await tp('touchStart',x); const n=8; for(let i=1;i<=n;i++){ await tp('touchMove',x+dx*i/n); await page.waitForTimeout(16); } await tp('touchEnd'); await page.waitForTimeout(400); }
(async()=>{ await new Promise(r=>srv.listen(PORT,r)); const b=await chromium.launch(); const r={};
 const seed=()=>{ Object.defineProperty(navigator,'standalone',{get:()=>true}); if(!localStorage.getItem('tareas-v1')) localStorage.setItem('tareas-v1', JSON.stringify({spaces:[{id:'trabajo',name:'Trabajo',order:0}],projects:[],tasks:[{id:'t1',title:'Documentar facturas',spaceId:'trabajo',date:null,priority:'none',status:'pending',notes:'',created:'2026-10-30T10:00:00Z',modified:'2026-10-30T10:00:00Z'}],voiceNotes:[{id:'v1',taskId:'t1',text:'Primera nota',created:'2026-10-31T09:00:00Z'},{id:'v2',taskId:'t1',text:'Segunda nota',created:'2026-10-31T10:00:00Z'}],settings:{tipsSeen:true,filter:'todas'}})); };
 // mobile
 { const page=await (await b.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:2,colorScheme:'dark'})).newPage();
  await page.addInitScript(seed); page.on('pageerror',e=>errors.push('page: '+e.message));
  await page.goto('http://localhost:'+PORT+'/'); await page.waitForTimeout(500);
  await page.evaluate(()=>{ openDetail('t1'); }); await page.waitForTimeout(600);
  const det='.pushed-screen ';
  // swipe right: Editar revealed
  await swipe(page, det+'.vn[data-vn=v2] .vn-c', 90);
  r.openR=await page.evaluate(()=>document.querySelector('.vn[data-vn=v2]').dataset.open);
  await page.screenshot({path:OUT+'/vn-right.png'});
  ok(r.openR==='r','right swipe should reveal Editar');
  // Batch I: the right swipe on a note is the note's, not the R4 back swipe of the detail
  r.stillDetail=await page.evaluate(()=>UI.stack.length===1&&UI.stack[0].el.classList.contains('detail')); ok(r.stillDetail,'a swipe on a voice note must not go back');
  await page.tap(det+'.vn[data-vn=v2] [data-vact=edit]'); await page.waitForTimeout(500);
  r.editSheet=await page.evaluate(()=>({on:sheet.classList.contains('on'), title:document.querySelector('#sheet .shead h2').textContent, val:document.querySelector('#sheet textarea').value}));
  ok(r.editSheet.on&&r.editSheet.title==='Editar nota'&&r.editSheet.val==='Segunda nota','edit sheet prefilled');
  await page.screenshot({path:OUT+'/vn-edit.png'});
  await page.tap('#sheet [data-x=redo]'); r.cleared=await page.evaluate(()=>document.querySelector('#sheet textarea').value===''&&document.activeElement.tagName==='TEXTAREA'); ok(r.cleared,'redo clears and focuses');
  await page.keyboard.type('Segunda nota corregida'); await page.tap('#sheet .shead [data-x=ok]'); await page.waitForTimeout(500);
  r.after=await page.evaluate(()=>{ const v=DB.voiceNotes.find(x=>x.id==='v2'); return {text:v.text, modified:!!v.modified, label:document.querySelector('.pushed-screen .vn[data-vn=v2] small').textContent, toast:(document.querySelector('.toast')||{}).textContent}; });
  ok(r.after.text==='Segunda nota corregida'&&r.after.modified&&/editada/.test(r.after.label),'edit saved with modified');
  // undo edit
  await page.evaluate(()=>{ const u=document.querySelector('.toast [data-undo], .toast button'); u&&u.click(); }); await page.waitForTimeout(300);
  r.undoEdit=await page.evaluate(()=>{ const v=DB.voiceNotes.find(x=>x.id==='v2'); return {text:v.text, modified:'modified' in v}; });
  ok(r.undoEdit.text==='Segunda nota'&&!r.undoEdit.modified,'undo edit restores');
  // long swipe right opens edit directly
  await swipe(page, det+'.vn[data-vn=v1] .vn-c', 220);
  r.longRight=await page.evaluate(()=>sheet.classList.contains('on')&&document.querySelector('#sheet textarea').value);
  ok(r.longRight==='Primera nota','long swipe right opens edit');
  await page.tap('#sheet .shead [data-x=cancel]'); await page.waitForTimeout(500);
  r.unchanged=await page.evaluate(()=>DB.voiceNotes.find(x=>x.id==='v1').text); ok(r.unchanged==='Primera nota','cancel keeps text');
  // Batch I: after a render (bindCommon runs again on the same screen) the note still swipes, bound once
  await page.evaluate(()=>render()); await page.waitForTimeout(200); r.boundOnce=await page.evaluate(()=>[...document.querySelectorAll('.pushed-screen .vn')].every(e=>e._vnb===1)); ok(r.boundOnce,'vn bound once');
  // swipe left: Eliminar
  await swipe(page, det+'.vn[data-vn=v1] .vn-c', -200);
  r.openL=await page.evaluate(()=>{ const e=document.querySelector('.vn[data-vn=v1]'); return {open:e.dataset.open, tr:e.querySelector('.vn-c').style.transform}; });
  ok(r.openL.open==='l'&&/-88px/.test(r.openL.tr),'left swipe stops at Eliminar');
  await page.screenshot({path:OUT+'/vn-left.png'});
  await page.tap(det+'.vn[data-vn=v1] [data-vact=del]'); await page.waitForTimeout(400);
  r.del=await page.evaluate(()=>({n:DB.voiceNotes.length, dom:document.querySelectorAll('.pushed-screen .vn').length}));
  ok(r.del.n===1&&r.del.dom===1,'deleted');
  await page.evaluate(()=>{ const u=document.querySelector('.toast [data-undo], .toast button'); u&&u.click(); }); await page.waitForTimeout(300);
  r.undoDel=await page.evaluate(()=>({n:DB.voiceNotes.length, dom:document.querySelectorAll('.pushed-screen .vn').length})); ok(r.undoDel.n===2&&r.undoDel.dom===2,'undo delete');
  // new note still works
  await page.tap(det+'[data-act=voice]'); await page.waitForTimeout(400); await page.keyboard.type('Tercera'); await page.tap('#sheet .shead [data-x=ok]'); await page.waitForTimeout(400);
  r.newNote=await page.evaluate(()=>DB.voiceNotes.length); ok(r.newNote===3,'new note');
  // Batch I: the back swipe from the middle of the detail (R4) still pops when it starts outside notes and fields
  { const g=await page.evaluate(()=>{ const c=document.querySelector('.pushed-screen .group-title'); const b=c.getBoundingClientRect(); return {x:b.left+150, y:b.top+b.height/2}; });
    const cdp=await page.context().newCDPSession(page); const tp=(type,xx)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:type==='touchEnd'?[]:[{x:xx,y:g.y}]});
    await tp('touchStart',g.x); for(let i=1;i<=8;i++){ await tp('touchMove',g.x+200*i/8); await page.waitForTimeout(16); } await tp('touchEnd'); await page.waitForTimeout(700);
    r.poppedFromMiddle=await page.evaluate(()=>UI.stack.length===0); ok(r.poppedFromMiddle,'R4 back swipe from the middle of the detail'); }
 }
 // desktop
 { const page=await (await b.newContext({viewport:{width:1280,height:800}})).newPage(); await page.addInitScript(seed); page.on('pageerror',e=>errors.push('desk: '+e.message));
  await page.goto('http://localhost:'+PORT+'/'); await page.waitForTimeout(500); await page.evaluate(()=>openDetail('t1')); await page.waitForTimeout(500);
  // Batch E (R17): on the desktop a click on a note opens a Mac menu at the pointer (#pmenu.mac), not the centred action sheet
  await page.click('.vn[data-vn=v1] .vn-c'); await page.waitForTimeout(500);
  r.deskMenu=await page.evaluate(()=>({mac:document.querySelector('#pmenu').classList.contains('mac'), on:menuOpen(), txt:document.querySelector('#pmenu').textContent, asheet:asheet.classList.contains('on')})); ok(r.deskMenu.mac&&r.deskMenu.on&&/Editar nota/.test(r.deskMenu.txt)&&!r.deskMenu.asheet,'desktop menu');
  await page.screenshot({path:OUT+'/vn-desk.png'});
  await page.click('#pmenu .pm-it:has-text("Editar nota")').catch(e=>errors.push('desk click '+e.message)); await page.waitForTimeout(500);
  r.deskEdit=await page.evaluate(()=>sheet.classList.contains('on')&&document.querySelector('#sheet textarea').value); ok(r.deskEdit==='Primera nota','desktop edit');
 }
 console.log(JSON.stringify(r,null,1)); console.log(JSON.stringify({errors})); await b.close(); srv.close(); process.exit(errors.length?1:0); })().catch(e=>{console.error(e);process.exit(1)});
