require('./lib/out.js'); const { openSetting } = require('./lib/settings.js'); // v0.37.4: Ajustes in subscreens on the iPhone // outputs (screenshots, downloads) go to tests/out
const { chromium } = require('playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const TYPES = {'.html':'text/html','.css':'text/css','.js':'application/javascript','.webmanifest':'application/manifest+json','.png':'image/png'};
const srv = http.createServer((req,res)=>{ let p = decodeURIComponent(req.url.split('?')[0]); if(p==='/') p='/index.html'; const f=path.join(ROOT,p); if(!fs.existsSync(f)){res.writeHead(404);res.end();return;} res.writeHead(200,{'Content-Type':TYPES[path.extname(f)]||'application/octet-stream'}); res.end(fs.readFileSync(f)); });
(async()=>{
  await new Promise(r=>srv.listen(8773,r));
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport:{width:390,height:844}, deviceScaleFactor:2, isMobile:true, hasTouch:true });
  const page = await ctx.newPage(); await page.addInitScript(()=>{ if(!localStorage.getItem('tareas-v1')) localStorage.setItem('tareas-v1', JSON.stringify({spaces:[{id:'trabajo',name:'Trabajo',order:0},{id:'personal',name:'Personal',order:1}],projects:[],tasks:[],voiceNotes:[],settings:{tipsSeen:true}})); }); const errors=[]; page.on('pageerror', e=>errors.push(e.message));
  await page.goto('http://localhost:8773/'); await page.waitForTimeout(400); const r={};
  // Create from the title menu
  await page.click('.nav .title'); await page.waitForTimeout(300);
  // Batch D (R10): on the iPhone the title opens an anchored menu (#pmenu), not the bottom action sheet
  r.menu = await page.$$eval('#pmenu .pm-it', b=>b.map(x=>x.textContent.trim()));
  await page.click('#pmenu .pm-it:has-text("Nuevo espacio")'); await page.waitForTimeout(300);
  await page.fill('#sheet .titlein','Deloitte'); await page.click('#sheet [data-x=ok]'); await page.waitForTimeout(400);
  r.activeAfterCreate = await page.$eval('.nav .title', e=>e.textContent.trim());
  // Rename from Settings
  const SS=await openSetting(page, 'espacios');
  r.settingsSpaces = await page.$$eval(SS+' [data-edit-space] .lbl', l=>l.map(x=>x.textContent));
  await page.click(SS+' [data-edit-space]:nth-child(1)'); await page.waitForTimeout(300);
  await page.fill('#sheet .titlein','Oficina'); await page.click('#sheet [data-x=ok]'); await page.waitForTimeout(400);
  r.afterRename = await page.$$eval(SS+' [data-edit-space] .lbl', l=>l.map(x=>x.textContent));
  await page.screenshot({path:'13-settings-spaces.png'});
  // Delete the empty new space (it is active) -> falls back to first
  await page.click(SS+' [data-edit-space]:nth-child(3)'); await page.waitForTimeout(300);
  r.deleteOffered = !!(await page.$('#sheet [data-x=del]'));
  await page.click('#sheet [data-x=del]'); await page.waitForTimeout(300); await page.click('#asheet .it:not(.cancel)'); await page.waitForTimeout(400);
  r.afterDelete = await page.evaluate(()=>({spaces:DB.spaces.map(s=>s.name), active:space().name}));
  // A space with tasks cannot be deleted
  await page.evaluate(()=>{ addTask({title:'x',date:todayStr()}); render(); }); await page.waitForTimeout(200);
  await page.click(SS+' [data-edit-space]:nth-child(1)'); await page.waitForTimeout(300);
  r.deleteBlocked = !(await page.$('#sheet [data-x=del]')); r.blockHint = await page.$eval('#sheet .hint', e=>e.textContent).catch(()=>null);
  r.errors=errors; console.log(JSON.stringify(r,null,1)); await browser.close(); srv.close();
})().catch(e=>{ console.error(e); process.exit(1); });
