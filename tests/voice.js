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
    await page.click('.pushed-screen [data-act=voice]'); await page.waitForTimeout(300);
    const micShown = !!(await page.$('#sheet .mic'));
    const taFocused = await page.evaluate(()=>document.activeElement===document.querySelector('#sheet textarea'));
    const hint = await page.$eval('#sheet .hint', e=>e.textContent);
    if(!standalone) await page.click('#sheet textarea'); await page.keyboard.type('Revisar el presupuesto con el equipo antes del jueves');
    await page.click('#sheet [data-x=ok]'); await page.waitForTimeout(500);
    const notes = await page.$$eval('.pushed-screen .vn', n=>n.map(e=>e.textContent));
    const stored = await page.evaluate(()=>JSON.parse(localStorage.getItem('tareas-v1')).voiceNotes.length);
    if(standalone) await page.screenshot({path:'05-voice-saved.png'});
    out[standalone?'standalone':'browser']={addFocused, micShown, taFocused, hint, notes, stored, errors};
    await ctx.close();
  }
  console.log(JSON.stringify(out,null,1)); await browser.close(); srv.close();
})().catch(e=>{ console.error(e); process.exit(1); });
