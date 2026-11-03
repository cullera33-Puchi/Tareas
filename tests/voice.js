require('./lib/out.js'); // outputs (screenshots, downloads) go to tests/out
const { chromium } = require('playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const TYPES = {'.html':'text/html','.css':'text/css','.js':'application/javascript','.webmanifest':'application/manifest+json','.png':'image/png'};
const srv = http.createServer((req,res)=>{ let p = decodeURIComponent(req.url.split('?')[0]); if(p==='/') p='/index.html'; const f=path.join(ROOT,p); if(!fs.existsSync(f)){res.writeHead(404);res.end();return;} res.writeHead(200,{'Content-Type':TYPES[path.extname(f)]||'application/octet-stream'}); res.end(fs.readFileSync(f)); });
(async()=>{
  await new Promise(r=>srv.listen(8768,r));
  const browser = await chromium.launch(); const out={};
  for (const standalone of [true,false]) {
    const ctx = await browser.newContext({ viewport:{width:390,height:844}, isMobile:true, hasTouch:true });
    const page = await ctx.newPage(); await page.addInitScript(()=>{ if(!localStorage.getItem('tareas-v1')) localStorage.setItem('tareas-v1', JSON.stringify({spaces:[{id:'trabajo',name:'Trabajo',order:0},{id:'personal',name:'Personal',order:1}],projects:[],tasks:[],voiceNotes:[],settings:{tipsSeen:true}})); }); const errors=[];
    page.on('pageerror', e=>errors.push(e.message)); page.on('console', m=>{ if(m.type()==='error') errors.push(m.text()); });
    if(standalone) await page.addInitScript(()=>{ Object.defineProperty(navigator,'standalone',{get:()=>true}); });
    await page.goto('http://localhost:8768/'); await page.waitForTimeout(500);
    await page.click('.fab'); await page.waitForTimeout(300);
    const addFocused = await page.evaluate(()=>document.activeElement===document.querySelector('#sheet .titlein'));
    await page.fill('#sheet .titlein','Llamar a Marta'); /* R5: date options live in the strip of the date icon */ await page.click('#sheet .qbtn[data-k=date]'); /* decision 27b: the + in Hoy already proposes today (a tap on the lit Hoy chip would clear it) */ await page.locator('#sheet [data-c=hoy]:not(.on)').click({timeout:1500}).catch(()=>{}); await page.click('#sheet [data-x=ok]'); await page.waitForTimeout(400);
    await page.click('.screen.root[data-root=tareas] .group .row .row-title'); await page.waitForTimeout(500);
    // Decision 49: no dictated voice note any more. Dictation is the keyboard's microphone in Notas; the recording is «Nota de voz»
    const det = await page.evaluate(()=>({voiceBtn:!!document.querySelector('.pushed-screen [data-act=voice]'), vnGroup:[...document.querySelectorAll('.pushed-screen .group-title')].some(e=>e.textContent==='Notas de voz'), audioBtn:(document.querySelector('.pushed-screen [data-act=attAudio]')||{}).textContent}));
    await page.click('.pushed-screen [data-role=notes]'); await page.keyboard.type('Revisar el presupuesto con el equipo antes del jueves'); await page.waitForTimeout(600);
    const stored = await page.evaluate(()=>{ const d=JSON.parse(localStorage.getItem('tareas-v1')); return {notes:d.tasks[0].notes, vn:d.voiceNotes.length}; });
    await page.click('.pushed-screen [data-act=attAudio]'); await page.waitForTimeout(600);
    const recTitle = await page.evaluate(()=>sheet.classList.contains('on')&&(document.querySelector('#sheet .shead h2')||{}).textContent);
    if(standalone) await page.screenshot({path:'05-voice-saved.png'});
    if(!(addFocused && !det.voiceBtn && !det.vnGroup && det.audioBtn==='Nota de voz' && stored.notes==='Revisar el presupuesto con el equipo antes del jueves' && !stored.vn && recTitle==='Nota de voz')) errors.push('decision 49: '+JSON.stringify({addFocused, det, stored, recTitle}));
    out[standalone?'standalone':'browser']={addFocused, det, stored, recTitle, errors};
    await ctx.close();
  }
  console.log(JSON.stringify(out,null,1)); await browser.close(); srv.close();
})().catch(e=>{ console.error(e); process.exit(1); });
