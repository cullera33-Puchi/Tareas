require('./lib/out.js'); // outputs (screenshots, downloads) go to tests/out
// Roadmap batch E: R11 (desktop density as on a Mac) and R17 (Mac menus, popovers and inspector). Desktop only; the iPhone is checked unchanged
const { chromium } = require('playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = path.resolve(__dirname, '..'); const OUT = path.join(__dirname, 'out', 'E'); fs.mkdirSync(OUT, {recursive:true});
const TYPES = {'.html':'text/html','.css':'text/css','.js':'application/javascript','.webmanifest':'application/manifest+json','.png':'image/png'};
const srv = http.createServer((req,res)=>{ let p = decodeURIComponent(req.url.split('?')[0]); if(p==='/') p='/index.html'; const f=path.join(ROOT,p); if(!fs.existsSync(f)){res.writeHead(404);res.end();return;} res.writeHead(200,{'Content-Type':TYPES[path.extname(f)]||'application/octet-stream'}); res.end(fs.readFileSync(f)); });
const PORT=9105, URL='http://localhost:'+PORT+'/';
const SEED = JSON.stringify({spaces:[{id:'trabajo',name:'Trabajo',order:0},{id:'personal',name:'Personal',order:1}],projects:[],tasks:[],voiceNotes:[],settings:{tipsSeen:true}});
const r={}, fails=[]; const check=(name, ok, info)=>{ r[name]=ok?true:(info===undefined?false:info); if(!ok) fails.push(name); };
let errors=[];

async function open(browser, opts){
  const ctx = await browser.newContext(Object.assign({ viewport:{width:1280,height:800}, deviceScaleFactor:1, colorScheme:'light' }, opts||{}));
  const page = await ctx.newPage(); await page.addInitScript(s=>{ if(!localStorage.getItem('tareas-v1')) localStorage.setItem('tareas-v1', s); }, SEED);
  page.on('pageerror', e=>errors.push(e.message)); page.on('console', m=>{ if(m.type()==='error') errors.push(m.text()); });
  await page.goto(URL); await page.waitForTimeout(400);
  return {ctx, page};
}
const menu = page => page.evaluate(()=>{ const pm=document.querySelector('#pmenu'); const ls=[...pm.querySelectorAll('.pm-menu')]; if(!ls.length) return {open:false};
  return {open:pm.classList.contains('on'), mac:pm.classList.contains('mac'), lift:!!pm.querySelector('.pm-lift'), back:getComputedStyle(pm.querySelector('.pm-back')).backgroundColor,
    levels:ls.map(l=>{ const b=l.getBoundingClientRect(); return {lv:+l.dataset.lv, pop:l.classList.contains('pm-pop'), box:{left:b.left, top:b.top, right:b.right, bottom:b.bottom},
      items:[...l.querySelectorAll('.pm-it')].map(x=>x.querySelector('.pm-l').textContent+(x.querySelector('.pm-key')?' ['+x.querySelector('.pm-key').textContent+']':'')+(x.querySelector('.pm-ck svg')?' *':'')+(x.querySelector('.pm-sub')?' >':'')),
      hl:(l.querySelector('.pm-it.hl .pm-l')||{}).textContent||null, font:getComputedStyle(l.querySelector('.pm-it')||l).fontSize}; })}; });
const item = (page, lv, label) => page.evaluate(([lv,l])=>{ const b=[...document.querySelectorAll('#pmenu .pm-menu[data-lv="'+lv+'"] .pm-it')].find(x=>x.querySelector('.pm-l').textContent===l); if(!b) return null; const q=b.getBoundingClientRect(); return {x:q.x+q.width/2, y:q.y+q.height/2}; }, [lv,label]);
const box = (page, sel) => page.$eval(sel, e=>{ const sc=e.closest('.mbody'); if(sc){ const q=e.getBoundingClientRect(), r0=sc.getBoundingClientRect(); if(q.top<r0.top+80||q.bottom>r0.bottom-120) sc.scrollTop+=q.top-(r0.top+r0.height/3); } const b=e.getBoundingClientRect(); return {left:b.left, top:b.top, right:b.right, bottom:b.bottom, w:b.width, h:b.height}; });
const rowSel = id => '#desk .main .group .row[data-id="'+id+'"]';

(async()=>{
  await new Promise(res=>srv.listen(PORT,res));
  const browser = await chromium.launch();

  /* ---------- R11: density with the demo data at 1280 x 800 ---------- */
  let {ctx, page} = await open(browser);
  await page.evaluate(()=>{ generateDemo(); render(); }); await page.waitForTimeout(400);
  r.dens = await page.evaluate(()=>{ const rows=[...document.querySelectorAll('#desk .main .group .row')]; const hs=rows.slice(0,30).map(x=>Math.round(x.getBoundingClientRect().height));
    const vis=[...document.querySelectorAll('#desk .row')].filter(x=>{ const b=x.getBoundingClientRect(); return b.height&&b.top>=0&&b.bottom<=innerHeight; }).length;
    const t=document.querySelector('#desk .main .row .row-title');
    return {html:getComputedStyle(document.documentElement).fontSize, hs:[...new Set(hs)], vis, title:getComputedStyle(t).fontSize, clamp:getComputedStyle(t).webkitLineClamp};
  });
  check('R11_rem14', r.dens.html==='14px', r.dens.html);
  check('R11_rows32', r.dens.hs.every(h=>h>=32&&h<=36), r.dens.hs);
  check('R11_oneLine', r.dens.clamp==='2' && r.dens.title==='14px', r.dens); // v0.33.1: one line of 32 px, a long title wraps to two
  check('R11_19rows', r.dens.vis>=18, r.dens.vis);
  // Columns: the date, reminder and priority columns end at the same x on every row
  r.cols = await page.evaluate(()=>{ const rows=[...document.querySelectorAll('#desk .main .group .row')].slice(0,25); const xs=sel=>[...new Set(rows.map(x=>Math.round(x.querySelector(sel).getBoundingClientRect().right)))];
    return {date:xs('.rc-date'), rem:xs('.rc-rem'), pri:xs('.pri'), hoyDates:rows.map(x=>x.querySelector('.rc-date')).filter(e=>!e.classList.contains('drag')).map(e=>e.textContent).filter(Boolean)}; }); // decision 56b: «Aplazada N veces» and «Desde…» are not a date
  check('R11_columnsAligned', r.cols.date.length===1 && r.cols.rem.length===1 && r.cols.pri.length===1, r.cols);
  check('R3_deskHoySaysNoDate', r.cols.hoyDates.length===0, r.cols.hoyDates); // Hoy: no "Hoy"; Aplazadas: no "Aplazada"
  // The list takes the whole column (decision 58) and the head (search, view options) ends where the list ends
  r.width = await page.evaluate(()=>{ const i=document.querySelector('#desk .main .inner').getBoundingClientRect(), m=document.querySelector('#desk .mhead .mopts').getBoundingClientRect(), s=document.querySelector('#desk .mhead .search').getBoundingClientRect(), h=document.querySelector('#desk .mhead h1').getBoundingClientRect();
    return {inner:Math.round(i.width), right:Math.round(i.right), mopts:Math.round(m.right), searchTop:Math.round(s.top), h1Top:Math.round(h.top)}; });
  check('R11_listWidth', r.width.inner===1012, r.width); // decision 58: the list takes the whole column (1280 - 220 - 2 x 24), no 900 px cap
  check('R11_searchInHead', Math.abs(r.width.right-r.width.mopts)<=1, r.width);
  // Materials: white content, translucent grey sidebar
  r.mat = await page.evaluate(()=>({main:getComputedStyle(document.querySelector('#desk')).backgroundColor, side:getComputedStyle(document.querySelector('#desk .side')).backgroundColor, row:getComputedStyle(document.querySelector('#desk .main .row:not(.first .row) .row-content')).backgroundColor})); // v0.16.3: "Lo primero" rows sit on a tinted block, so the check reads a list row
  check('R11_whiteContent', r.mat.main==='rgb(255, 255, 255)' && r.mat.row==='rgb(255, 255, 255)', r.mat);
  check('R11_translucentSide', /rgba\(\d+, \d+, \d+, 0\.\d+\)/.test(r.mat.side), r.mat.side);
  await page.screenshot({path:OUT+'/e-light-hoy.png'});

  // Decision 52: no day summary line, no figures and no "Lo primero" above the list
  r.sum = await page.evaluate(()=>({summary:!!document.querySelector('#desk .summary'), nums:document.querySelectorAll('#desk [data-sum]').length, first:[...document.querySelectorAll('#desk .main .first')].filter(e=>!e.closest('.ahora')).length}));
  check('R11_noSummaryLine', !r.sum.summary && !r.sum.nums && !r.sum.first, r.sum);

  // Project filter: a "Proyecto: Todos" pop-up in the head instead of the chips
  check('R11_noChips', await page.evaluate(()=>!document.querySelector('#desk .pchips') && /Proyecto:\s*Todos/.test(document.querySelector('#desk .pfdrop').textContent)));
  await page.click('#desk .pfdrop'); await page.waitForTimeout(250);
  let m = await menu(page); r.pfMenu=m;
  const pfb = await box(page, '#desk .pfdrop');
  check('R11_pfMenu', m.open && m.mac && m.levels[0].items[0]==='Todos *' && m.levels[0].items.includes('Sin proyecto') && m.levels[0].items.length>=8 && Math.abs(m.levels[0].box.top-(pfb.bottom+4))<=1 && Math.abs(m.levels[0].box.right-pfb.right)<=1, m);
  const pname = await page.evaluate(()=>activeProjects()[1].name);
  let c = await item(page, 0, pname); await page.mouse.click(c.x, c.y); await page.waitForTimeout(350);
  r.pf = await page.evaluate(()=>({f:UI.projFilter, label:document.querySelector('#desk .pfdrop').textContent, on:document.querySelector('#desk .pfdrop').classList.contains('on'), tags:document.querySelectorAll('#desk .main .group .row .tag').length, menu:menuOpen()}));
  check('R11_pfApplies', r.pf.f && r.pf.label.includes(pname) && r.pf.on && r.pf.tags===0 && !r.pf.menu, r.pf);
  await page.click('#desk .pfdrop'); await page.waitForTimeout(200); c = await item(page, 0, 'Todos'); await page.mouse.click(c.x, c.y); await page.waitForTimeout(300);
  check('R11_pfClears', await page.evaluate(()=>UI.projFilter===null));
  // A search hides the filter (it ignores it) and brings it back when cleared
  await page.click('#desk [data-role=search]'); await page.keyboard.type('raid'); await page.waitForTimeout(400);
  check('R11_pfHiddenInSearch', await page.evaluate(()=>!document.querySelector('#desk .pfdrop') && document.activeElement.dataset.role==='search'));
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  check('R11_pfBack', await page.evaluate(()=>!!document.querySelector('#desk .pfdrop')));

  /* ---------- R17: context menu at the pointer, submenus, keys ---------- */
  const t1 = await page.evaluate(()=>{ const x=pendingFor('hoy').find(x=>!x.carried&&x.priority==='none'); return x.id; }); // demo titles repeat: tasks go by id
  const rb = await box(page, rowSel(t1)+' .row-title');
  const px=Math.round(rb.left+30), py=Math.round(rb.top+10);
  await page.mouse.click(px, py, {button:'right'}); await page.waitForTimeout(250);
  m = await menu(page); r.ctx=m;
  check('R17_ctxAtPointer', m.open && m.mac && !m.lift && Math.abs(m.levels[0].box.left-px)<=1 && (Math.abs(m.levels[0].box.top-py)<=1 || Math.abs(m.levels[0].box.bottom-py)<=1), {m, px, py});
  // Updated by decisions 39 (Ahora) and 41 (Por confirmar): two items after Completar
  check('R17_ctxItems', JSON.stringify(m.levels[0].items)===JSON.stringify(['Completar [C]','Ahora [A]','Por confirmar…','Fecha >','Fecha límite >','Prioridad >','Tiempo >','Proyecto [P] >','Mover a otro espacio >','Responsable…','Duplicar','Eliminar [Supr]']), m.levels[0].items);
  check('R17_macStyle', m.levels[0].font==='13px' && /rgba\(0, 0, 0, 0\)|transparent/.test(m.back), {font:m.levels[0].font, back:m.back});
  // Hover: highlight, then the submenu opens to the side with a check on the current value and the keys
  c = await item(page, 0, 'Prioridad'); await page.mouse.move(c.x, c.y); await page.waitForTimeout(400);
  m = await menu(page);
  check('R17_hoverHl', m.levels[0].hl==='Prioridad', m.levels[0].hl);
  check('R17_submenuSide', m.levels.length===2 && m.levels[1].box.left>=m.levels[0].box.right-6 && JSON.stringify(m.levels[1].items)===JSON.stringify(['Alta [1]','Media [2]','Ninguna [0] *']), m.levels[1]);
  r.hlBg = await page.$eval('#pmenu .pm-it.hl', e=>getComputedStyle(e).backgroundColor);
  check('R17_hlBlue', r.hlBg==='rgb(0, 122, 255)', r.hlBg);
  await page.screenshot({path:OUT+'/e-light-ctx.png'});
  // Moving down onto Proyecto swaps the submenu
  c = await item(page, 0, 'Proyecto'); await page.mouse.move(c.x, c.y, {steps:3}); await page.waitForTimeout(450);
  m = await menu(page); check('R17_submenuSwaps', m.levels.length===2 && m.levels[1].items[0]==='Ninguno' && m.levels[1].items.some(x=>/\*$/.test(x)), m.levels[1]&&m.levels[1].items);
  // Back to Prioridad and choose Alta
  c = await item(page, 0, 'Prioridad'); await page.mouse.move(c.x, c.y); await page.waitForTimeout(450);
  c = await item(page, 1, 'Alta'); await page.mouse.move(c.x-30, c.y, {steps:4}); await page.mouse.move(c.x, c.y); await page.mouse.click(c.x, c.y); await page.waitForTimeout(400);
  r.prio = await page.evaluate(t=>({p:task(t).priority, menu:menuOpen(), toast:document.querySelector('#toastText').textContent}), t1);
  check('R17_submenuChoose', r.prio.p==='high' && !r.prio.menu && r.prio.toast==='Prioridad alta', r.prio);
  // Keyboard: arrows, right into a submenu, left back, Enter chooses, Escape closes
  const t2 = await page.evaluate(()=>pendingFor('hoy').find(x=>!x.carried&&x.priority==='none').id);
  const rb2 = await box(page, rowSel(t2)+' .row-title');
  await page.mouse.click(rb2.left+30, rb2.top+10, {button:'right'}); await page.waitForTimeout(250);
  for(let i=0;i<4;i++) await page.keyboard.press('ArrowDown'); await page.waitForTimeout(80); // Completar, Ahora (decision 39), Por confirmar (decision 41), Fecha
  m = await menu(page); check('R17_keyDown', m.levels[0].hl==='Fecha', m.levels[0].hl);
  await page.keyboard.press('ArrowRight'); await page.waitForTimeout(120); m = await menu(page);
  check('R17_keyRight', m.levels.length===2 && m.levels[1].hl==='Hoy', m.levels.map(l=>l.hl));
  await page.keyboard.press('ArrowLeft'); await page.waitForTimeout(120); m = await menu(page);
  check('R17_keyLeft', m.levels.length===1 && m.levels[0].hl==='Fecha', m.levels.map(l=>l.hl));
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowRight'); await page.waitForTimeout(100); // Fecha límite (decision 48a), Prioridad, Alta
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter'); await page.waitForTimeout(400); // Media
  r.kb = await page.evaluate(t=>({p:task(t).priority, menu:menuOpen()}), t2);
  check('R17_keyEnter', r.kb.p==='mid' && !r.kb.menu, r.kb);
  await page.mouse.click(rb2.left+30, rb2.top+10, {button:'right'}); await page.waitForTimeout(250);
  await page.keyboard.press('Escape'); await page.waitForTimeout(350);
  check('R17_escCloses', await page.evaluate(()=>!menuOpen() && !document.querySelector('#pmenu').classList.contains('open')));
  // A click outside closes without acting; N does not reach the add bar while a menu is open
  await page.mouse.click(rb2.left+30, rb2.top+10, {button:'right'}); await page.waitForTimeout(250);
  await page.keyboard.press('n'); await page.waitForTimeout(80);
  check('R17_keysStayInMenu', await page.evaluate(()=>menuOpen() && document.activeElement.dataset.role!=='addbar'));
  const n0 = await page.evaluate(()=>DB.tasks.length);
  await page.mouse.click(1240, 780); await page.waitForTimeout(350);
  check('R17_clickOutside', await page.evaluate(n=>!menuOpen() && DB.tasks.length===n && !UI.deskDetail, n0));
  // Fecha submenu: Mañana with its key; the task leaves Hoy with Deshacer (its row moved when its priority changed: measured again)
  const rb2b = await box(page, rowSel(t2)+' .row-title');
  await page.mouse.click(rb2b.left+30, rb2b.top+10, {button:'right'}); await page.waitForTimeout(250);
  c = await item(page, 0, 'Fecha'); await page.mouse.click(c.x, c.y); await page.waitForTimeout(250);
  m = await menu(page); check('R17_dateSub', m.levels.length===2 && m.levels[1].items[0]==='Hoy [H] *' && m.levels[1].items.includes('Mañana [M]') && m.levels[1].items.includes('Sin fecha') && m.levels[1].items[m.levels[1].items.length-1]==='Elegir fecha… [F]', m.levels[1]&&m.levels[1].items);
  c = await item(page, 1, 'Mañana'); await page.mouse.move(c.x-40, c.y); await page.mouse.click(c.x, c.y); await page.waitForTimeout(500);
  r.moved = await page.evaluate(t=>{ const x=task(t); return {d:x.date===addDays(todayStr(),1), toast:document.querySelector('#toastText').textContent, undo:getComputedStyle(document.querySelector('#toastBtn')).display!=='none'}; }, t2);
  check('R17_dateChoose', r.moved.d && r.moved.toast==='Movida a mañana' && r.moved.undo, r.moved);
  await page.click('#toastBtn'); await page.waitForTimeout(300);
  check('R17_dateUndo', await page.evaluate(t=>task(t).date===todayStr(), t2));
  // The three dots of a row: the same menu, under them and right-aligned
  await page.hover(rowSel(t2)); const mb = await box(page, rowSel(t2)+' .rowmore'); await page.click(rowSel(t2)+' .rowmore'); await page.waitForTimeout(250);
  m = await menu(page); check('R17_rowmoreAnchored', m.open && Math.abs(m.levels[0].box.right-mb.right)<=1 && Math.abs(m.levels[0].box.top-(mb.bottom+4))<=1 && m.levels[0].items[0]==='Completar [C]', {m:m.levels[0].box, b:mb});
  // A right click elsewhere while a menu is open moves the menu there
  const rb3 = await box(page, '#desk .side [data-view^="project:"]');
  await page.mouse.click(rb3.left+40, rb3.top+10, {button:'right'}); await page.waitForTimeout(300);
  m = await menu(page); check('R17_rightClickReopens', m.open && m.levels[0].items[0]==='Renombrar o cambiar color…' && m.levels[0].items.includes('Archivar') && Math.abs(m.levels[0].box.left-(rb3.left+40))<=1, m.levels&&m.levels[0]);
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  // Space selector and view options: anchored menus
  const sp = await box(page, '#desk .side .sp'); await page.click('#desk .side .sp'); await page.waitForTimeout(250);
  m = await menu(page); check('R17_spaceMenu', m.open && m.mac && JSON.stringify(m.levels[0].items)===JSON.stringify(['Trabajo *','Personal','Nuevo espacio']) && Math.abs(m.levels[0].box.left-sp.left)<=1 && Math.abs(m.levels[0].box.top-(sp.bottom+4))<=1, m.levels[0]);
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  const vo = await box(page, '#desk .mopts'); await page.click('#desk .mopts'); await page.waitForTimeout(250);
  // Batch G (R16): the desktop view menu starts with Seleccionar tareas, as the iPhone's
  m = await menu(page); check('R17_viewMenu', m.open && m.levels[0].items[0]==='Seleccionar tareas' && m.levels[0].items[1]==='Mostrar completadas' && m.levels[0].items.includes('Agrupar por fecha *') && Math.abs(m.levels[0].box.right-vo.right)<=1, m.levels[0]);
  check('R17_openerState', await page.evaluate(()=>document.querySelector('#desk .mopts').classList.contains('open')));
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  check('R17_openerCleared', await page.evaluate(()=>!document.querySelector('#desk .mopts').classList.contains('open')));
  // Todas: right click on a day header, at the pointer
  await page.click('#desk .side [data-view=todas]'); await page.waitForTimeout(300);
  const dh = await box(page, '#desk [data-day-head]:not([data-day-head="'+await page.evaluate(()=>todayStr())+'"]) .gl');
  await page.mouse.click(dh.left+20, dh.top+8, {button:'right'}); await page.waitForTimeout(250);
  m = await menu(page); check('R17_dayHead', m.open && /^Mover est/.test(m.levels[0].items[0]) && Math.abs(m.levels[0].box.left-(dh.left+20))<=1, m.levels&&m.levels[0]);
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  r.todasDates = await page.$$eval('#desk .gsec .row .rc-date', e=>e.slice(0,80).map(x=>x.textContent));
  check('R3_todasDayGroupsNoDate', r.todasDates.filter(Boolean).every(s=>s==='Aplazada'||/\d/.test(s)), r.todasDates.filter(Boolean).slice(0,10)); // day groups say no date; month groups give the day
  await page.screenshot({path:OUT+'/e-light-todas.png'});
  // Confirmation stays a centred dialog
  await page.click('#desk .side [data-view=hoy]'); await page.waitForTimeout(300);
  const [t3, t3id] = await page.evaluate(()=>{ const x=pendingFor('hoy').find(x=>!x.carried&&x.priority==='none'); return [x.title, x.id]; }); const rb4=await box(page, '#desk .main .row[data-id="'+t3id+'"] .row-title');
  await page.mouse.click(rb4.left+30, rb4.top+10, {button:'right'}); await page.waitForTimeout(250);
  c = await item(page, 0, 'Eliminar'); await page.mouse.click(c.x, c.y); await page.waitForTimeout(400);
  // decision 28c (changed on purpose): the confirmation is a macOS alert, title and Cancelar and Eliminar buttons (rm-Q2 covers it in full)
  r.conf = await page.evaluate(()=>{ const a=document.querySelector('#asheet'); const b=a.getBoundingClientRect(); return {on:a.classList.contains('on'), cx:Math.round(b.left+b.width/2), title:(a.querySelector('.al-t')||{}).textContent, items:[...a.querySelectorAll('.al-btn')].map(x=>x.textContent)}; });
  check('R17_confirmCentred', r.conf.on && Math.abs(r.conf.cx-640)<=2 && r.conf.title==='Eliminar tarea' && r.conf.items.join()==='Cancelar,Eliminar', r.conf);
  await page.click('#asheet .al-btn.def'); await page.waitForTimeout(500);
  check('R17_confirmDeletes', await page.evaluate(id=>!task(id) && !document.querySelector('#asheet').classList.contains('on'), t3id));

  /* ---------- R17: the inspector ---------- */
  const tid = await page.evaluate(()=>{ const x=pendingFor('hoy').find(x=>!x.carried&&x.priority==='none'&&x.projectId); return x.id; });
  await page.click('#desk .main .row[data-id="'+tid+'"] .row-title'); await page.waitForTimeout(350);
  r.insp = await page.evaluate(()=>({close:!!document.querySelector('#desk .pane .ihead .ix[data-act=back]'), seg:[...document.querySelectorAll('#desk .pane .iseg button')].map(b=>b.textContent+(b.classList.contains('on')?'*':'')), pops:[...document.querySelectorAll('#desk .pane .ipop')].map(b=>b.dataset.act), foot:document.querySelector('#desk .pane .ifoot').textContent, w:Math.round(document.querySelector('#desk .pane').getBoundingClientRect().width), grip:!!document.querySelector('#desk .pane .igrip')}));
  check('R17_inspector', r.insp.close && JSON.stringify(r.insp.seg)===JSON.stringify(['Ninguna*','!!Media','!!!Alta']) && r.insp.pops.join()==='pickProject,pickDate,pickDeadline,pickReminder,pickResp,pickRepeat,pickEstimate' && /Creada .*Modificada /.test(r.insp.foot) && r.insp.w===400 && r.insp.grip, r.insp);
  await page.screenshot({path:OUT+'/e-light-inspector.png'});
  await page.click('#desk .pane .iseg [data-pr=mid]'); await page.waitForTimeout(300);
  check('R17_segment', await page.evaluate(id=>task(id).priority==='mid' && document.querySelector('#desk .pane .iseg .on').dataset.pr==='mid', tid));
  // Proyecto: a pop-up menu under the control
  const ip = await box(page, '#desk .pane [data-act=pickProject]'); await page.click('#desk .pane [data-act=pickProject]'); await page.waitForTimeout(250);
  m = await menu(page); check('R17_projectPopup', m.open && m.levels[0].items[0]==='Ninguno' && m.levels[0].items.filter(x=>/\*$/.test(x)).length===1 && Math.abs(m.levels[0].box.left-ip.left)<=1 && Math.abs(m.levels[0].box.top-(ip.bottom+4))<=1, {m:m.levels&&m.levels[0], ip});
  c = await item(page, 0, 'Ninguno'); await page.mouse.click(c.x, c.y); await page.waitForTimeout(350);
  check('R17_projectSet', await page.evaluate(id=>task(id).projectId===null && document.querySelector('#desk .pane [data-act=pickProject] .val').textContent==='Ninguno', tid));
  // Fecha: a popover with the calendar under the control
  const idt = await box(page, '#desk .pane [data-act=pickDate]'); await page.click('#desk .pane [data-act=pickDate]'); await page.waitForTimeout(250);
  m = await menu(page); check('R17_datePopover', m.open && m.levels[0].pop && Math.abs(m.levels[0].box.top-(idt.bottom+4))<=1 && await page.evaluate(()=>!!document.querySelector('#pmenu .pm-pop .cal .cal-d')), m.levels&&m.levels[0]);
  await page.screenshot({path:OUT+'/e-light-datepop.png'});
  const d5 = await page.evaluate(()=>addDays(todayStr(),5));
  await page.click('#pmenu .pm-pop .cal-d[data-d="'+d5+'"]').catch(async()=>{ await page.click('#pmenu .pm-pop [data-cal="1"]'); await page.click('#pmenu .pm-pop .cal-d[data-d="'+d5+'"]'); }); await page.waitForTimeout(400);
  check('R17_dateSet', await page.evaluate(([id,d])=>task(id).date===d && !menuOpen() && UI.deskDetail===id, [tid,d5]));
  // Recordatorio: popover with time; Enter in the time saves
  await page.click('#desk .pane [data-act=pickReminder]'); await page.waitForTimeout(250);
  // Updated by decision 32: on the desktop the time is the app's own picker (.tpk), no longer input[type=time]; Intro in it still saves
check('R17_reminderPopover', await page.evaluate(()=>!!document.querySelector('#pmenu .pm-pop .tpk-in')));
  await page.click('#pmenu .pm-pop .tpk-in'); await page.keyboard.press('Enter'); await page.waitForTimeout(350);
  r.rem = await page.evaluate(id=>({r:task(id).reminder, menu:menuOpen()}), tid);
  check('R17_reminderSet', !!r.rem.r && !r.rem.menu, r.rem);
  // Menu of the inspector's three dots, under them
  const dm = await box(page, '#desk .pane .ihead [data-act=menu]'); await page.click('#desk .pane .ihead [data-act=menu]'); await page.waitForTimeout(250);
  m = await menu(page); check('R17_detailMenu', m.open && m.levels[0].items[0]==='Marcar completada [C]' && m.levels[0].items.includes('Eliminar tarea [Supr]') && Math.abs(m.levels[0].box.right-dm.right)<=1, m.levels&&m.levels[0]);
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  // Resize from the left edge, kept in the settings, between 320 and 600
  const g = await box(page, '#desk .pane .igrip');
  await page.mouse.move(g.left+4, 300); await page.mouse.down(); await page.mouse.move(g.left-96, 300, {steps:5}); await page.mouse.up(); await page.waitForTimeout(200);
  r.rs1 = await page.evaluate(()=>({w:Math.round(document.querySelector('#desk .pane').getBoundingClientRect().width), s:DB.settings.paneWidth}));
  check('R17_resize', Math.abs(r.rs1.w-500)<=2 && Math.abs(r.rs1.s-500)<=2, r.rs1);
  const g2 = await box(page, '#desk .pane .igrip');
  await page.mouse.move(g2.left+4, 300); await page.mouse.down(); await page.mouse.move(g2.left-400, 300, {steps:5}); await page.mouse.up(); await page.waitForTimeout(200);
  r.rs2 = await page.evaluate(()=>Math.round(document.querySelector('#desk .pane').getBoundingClientRect().width));
  const g3 = await box(page, '#desk .pane .igrip');
  await page.mouse.move(g3.left+4, 300); await page.mouse.down(); await page.mouse.move(g3.left+700, 300, {steps:5}); await page.mouse.up(); await page.waitForTimeout(200);
  r.rs3 = await page.evaluate(()=>Math.round(document.querySelector('#desk .pane').getBoundingClientRect().width));
  check('R17_resizeClamp', r.rs2===600 && r.rs3===320, {max:r.rs2, min:r.rs3});
  await page.mouse.move(g3.left+4-0, 300); const g4 = await box(page, '#desk .pane .igrip'); await page.mouse.move(g4.left+4, 300); await page.mouse.down(); await page.mouse.move(g4.left-56, 300, {steps:3}); await page.mouse.up(); await page.waitForTimeout(200);
  await page.reload(); await page.waitForTimeout(500); await page.evaluate(id=>openDetail(id), tid); await page.waitForTimeout(300);
  r.rs4 = await page.evaluate(()=>({w:Math.round(document.querySelector('#desk .pane').getBoundingClientRect().width), s:DB.settings.paneWidth}));
  check('R17_resizeKept', Math.abs(r.rs4.w-380)<=2 && Math.abs(r.rs4.s-380)<=2, r.rs4);
  await page.click('#desk .pane .ix'); await page.waitForTimeout(300);
  check('R17_closeButton', await page.evaluate(()=>!document.querySelector('#desk .pane') && !UI.deskDetail));

  /* ---------- R17: in Semana the detail is a popover beside the card ---------- */
  await page.click('#desk [data-view=week]'); await page.waitForTimeout(350);
  const cols0 = await page.$$eval('#desk .wday', d=>d.map(x=>Math.round(x.getBoundingClientRect().width)));
  const card = await page.evaluate(()=>{ const c=document.querySelector('#desk .wday .wcard:not(.done)')||document.querySelector('#desk .wundated .wcard'); return c.dataset.id; });
  const cb = await box(page, '#desk .wcard[data-id="'+card+'"]');
  await page.click('#desk .wcard[data-id="'+card+'"] .t'); await page.waitForTimeout(350);
  r.wp = await page.evaluate(()=>{ const p=document.querySelector('#desk .pane.wpop'); const b=p&&p.getBoundingClientRect(); return p&&{box:{left:b.left,right:b.right,top:b.top,bottom:b.bottom}, hasPane:document.querySelector('#app').classList.contains('has-pane'), cols:[...document.querySelectorAll('#desk .wday')].map(x=>Math.round(x.getBoundingClientRect().width)), title:p.querySelector('[data-role=title]').value, popped:!!document.querySelector('#desk .wcard.popped')}; });
  check('R17_weekPopover', !!r.wp && !r.wp.hasPane && JSON.stringify(r.wp.cols)===JSON.stringify(cols0) && r.wp.popped && (r.wp.box.left>=cb.right || r.wp.box.right<=cb.left) && r.wp.box.bottom<=800 && r.wp.box.top>=0, {wp:r.wp, cb, cols0});
  await page.screenshot({path:OUT+'/e-light-week.png'});
  // Pickers work from inside it (they open above it)
  await page.click('#desk .pane.wpop [data-act=pickProject]'); await page.waitForTimeout(250);
  check('R17_weekPopoverMenu', (await menu(page)).open && await page.evaluate(()=>!!document.querySelector('#desk .pane.wpop')));
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  check('R17_weekEscMenuFirst', await page.evaluate(()=>!menuOpen() && !!document.querySelector('#desk .pane.wpop')));
  // A press outside closes it; a press on the same card closes it too (toggle)
  await page.mouse.click(300, 785); await page.waitForTimeout(300); // updated by decision 38: the inspector's Repetir row makes the popover taller, down to about 770 px
  check('R17_weekOutside', await page.evaluate(()=>!document.querySelector('#desk .pane.wpop') && !UI.deskDetail));
  await page.click('#desk .wcard[data-id="'+card+'"] .t'); await page.waitForTimeout(300);
  await page.click('#desk .wcard[data-id="'+card+'"] .t'); await page.waitForTimeout(300);
  check('R17_weekToggle', await page.evaluate(()=>!document.querySelector('#desk .pane.wpop')));
  await page.click('#desk .wcard[data-id="'+card+'"] .t'); await page.waitForTimeout(300);
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  check('R17_weekEsc', await page.evaluate(()=>!document.querySelector('#desk .pane.wpop')));
  check('noErrorsLight', errors.length===0, errors.slice());
  await ctx.close();

  /* ---------- Dark: macOS dark greys ---------- */
  ({ctx, page} = await open(browser, {colorScheme:'dark'}));
  await page.evaluate(()=>{ generateDemo(); render(); openDetail(pendingFor('hoy')[2].id); }); await page.waitForTimeout(400);
  r.dark = await page.evaluate(()=>({main:getComputedStyle(document.querySelector('#desk')).backgroundColor, pane:getComputedStyle(document.querySelector('#desk .pane')).backgroundColor, side:getComputedStyle(document.querySelector('#desk .side')).backgroundColor}));
  check('R11_darkGreys', r.dark.main==='rgb(30, 30, 30)' && r.dark.pane==='rgb(30, 30, 30)' && /rgba\(48, 48, 50, 0\.8\)/.test(r.dark.side), r.dark);
  await page.screenshot({path:OUT+'/e-dark-hoy.png'});
  const rd = await box(page, '#desk .main .group .row .row-title'); await page.mouse.click(rd.left+30, rd.top+10, {button:'right'}); await page.waitForTimeout(250);
  c = await item(page, 0, 'Proyecto'); await page.mouse.move(c.x, c.y); await page.waitForTimeout(400);
  r.darkMenu = await page.$eval('#pmenu .pm-menu', e=>getComputedStyle(e).backgroundColor);
  check('R17_darkMenu', /rgba\(42, 42, 44/.test(r.darkMenu), r.darkMenu);
  await page.screenshot({path:OUT+'/e-dark-ctx.png'});
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  await page.click('#desk [data-view=week]'); await page.waitForTimeout(300); await page.click('#desk .wcard .t'); await page.waitForTimeout(350);
  await page.screenshot({path:OUT+'/e-dark-week.png'});
  check('noErrorsDark', errors.length===0, errors.slice());
  await ctx.close();

  /* ---------- The iPhone is unchanged ---------- */
  ({ctx, page} = await open(browser, {viewport:{width:390,height:844}, deviceScaleFactor:2, isMobile:true, hasTouch:true}));
  await page.evaluate(()=>{ const p=addProject('FLC','#FF9500'); addTask({title:'Uno', date:todayStr(), projectId:p.id}); addTask({title:'Dos', date:todayStr()}); render(); }); await page.waitForTimeout(300);
  r.mob = await page.evaluate(()=>{ const row=document.querySelector('.screen.root[data-root=tareas] .scroll .group .row'); return {wide:UI.wide, cls:document.documentElement.classList.contains('wide'), html:getComputedStyle(document.documentElement).fontSize, h:Math.round(row.getBoundingClientRect().height), meta:!!row.querySelector('.row-meta .tag'), cols:!!row.querySelector('.rc-date'), summary:!!document.querySelector('.screen.root .summary')}; });
  check('iPhone_unchanged', !r.mob.wide && !r.mob.cls && r.mob.html==='17px' && r.mob.h>=52 && r.mob.meta && !r.mob.cols && !r.mob.summary, r.mob); // decision 52: no summary card either
  await page.evaluate(()=>rowMenu(DB.tasks[0].id)); await page.waitForTimeout(500);
  r.mobMenu = await page.evaluate(()=>({mac:document.querySelector('#pmenu').classList.contains('mac'), lift:!!document.querySelector('#pmenu .pm-lift'), prio:document.querySelectorAll('#pmenu .pm-prio button').length}));
  check('iPhone_menuUnchanged', !r.mobMenu.mac && r.mobMenu.lift && r.mobMenu.prio===3, r.mobMenu);
  await page.evaluate(()=>closeMenu(true));
  // Widening turns the desktop on, narrowing back restores the iPhone sizes
  await page.setViewportSize({width:1200, height:800}); await page.waitForTimeout(400);
  const wideNow = await page.evaluate(()=>({w:UI.wide, cls:document.documentElement.classList.contains('wide')}));
  await page.setViewportSize({width:390, height:844}); await page.waitForTimeout(400);
  const narrow = await page.evaluate(()=>({w:UI.wide, cls:document.documentElement.classList.contains('wide'), html:getComputedStyle(document.documentElement).fontSize}));
  check('switchLayouts', wideNow.w && wideNow.cls && !narrow.w && !narrow.cls && narrow.html==='17px', {wideNow, narrow});
  check('noErrorsMobile', errors.length===0, errors.slice());
  await ctx.close();

  await browser.close(); srv.close();
  console.log(JSON.stringify(Object.assign(r, {errors:fails.concat(errors.map(e=>'page: '+e))}), null, 1));
  process.exit(fails.length||errors.length?1:0);
})().catch(e=>{ console.error(e); console.log(JSON.stringify(Object.assign(r,{errors:fails.concat(['crash: '+e.message])}),null,1)); process.exit(1); });
