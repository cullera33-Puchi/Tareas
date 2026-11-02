require('./lib/out.js'); // outputs (screenshots, downloads) go to tests/out
// Roadmap batch G: R15 (selected row, keyboard, title edited in place, shortcuts) and R16 (multiple selection, bulk pane, dragging rows).
// Desktop only; the iPhone's own selection mode is checked unchanged. The clock is fixed on Wednesday 4 November 2026 at 10:10 (local)
const { chromium } = require('playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = path.resolve(__dirname, '..'); const OUT = path.join(__dirname, 'out', 'G'); fs.mkdirSync(OUT, {recursive:true});
const TYPES = {'.html':'text/html','.css':'text/css','.js':'application/javascript','.webmanifest':'application/manifest+json','.png':'image/png'};
const srv = http.createServer((req,res)=>{ let p = decodeURIComponent(req.url.split('?')[0]); if(p==='/') p='/index.html'; const f=path.join(ROOT,p); if(!fs.existsSync(f)){res.writeHead(404);res.end();return;} res.writeHead(200,{'Content-Type':TYPES[path.extname(f)]||'application/octet-stream'}); res.end(fs.readFileSync(f)); });
const PORT=9107, URL='http://localhost:'+PORT+'/';
const SEED = JSON.stringify({spaces:[{id:'trabajo',name:'Trabajo',order:0},{id:'personal',name:'Personal',order:1}],projects:[],tasks:[],voiceNotes:[],settings:{tipsSeen:true}});
const r={}, fails=[]; const check=(name, ok, info)=>{ r[name]=ok?true:(info===undefined?false:info); if(!ok) fails.push(name); };
let errors=[];
const NOW = new Date(2026, 10, 4, 10, 10, 0); // Wednesday

async function open(browser, opts, desk){
  const ctx = await browser.newContext(Object.assign({ viewport:{width:1280,height:800}, deviceScaleFactor:1, colorScheme:'light' }, opts||{}));
  const page = await ctx.newPage(); await page.clock.install({time:NOW});
  await page.addInitScript(s=>{ if(!localStorage.getItem('tareas-v1')) localStorage.setItem('tareas-v1', s); }, SEED);
  page.on('pageerror', e=>errors.push(e.message)); page.on('console', m=>{ if(m.type()==='error') errors.push(m.text()); });
  await page.goto(URL); await page.waitForTimeout(400);
  await page.evaluate(()=>{ const t=todayStr();
    const p=addProject('FLC','#FF3B30'), q=addProject('Casa','#34C759'); window.P={p:p.id, q:q.id};
    ['Uno','Dos','Tres','Cuatro'].forEach((n,i)=>addTask({id:'a'+(i+1), title:n, date:t}));
    addTask({id:'a5', title:'Cinco', date:addDays(t,1)});
    addTask({id:'a6', title:'Seis'}); addTask({id:'a7', title:'Siete'});
    save(); if(UI.wide) setDeskView('todas'); else render(); });
  await page.waitForTimeout(300);
  return {ctx, page};
}
const toastText = page => page.evaluate(()=>document.querySelector('#toast').classList.contains('on')?document.querySelector('#toastText').textContent:null);
const undo = async page => { await page.click('#toastBtn'); await page.waitForTimeout(300); };
const order = page => page.evaluate(()=>deskOrder());
const state = page => page.evaluate(()=>({cur:UI.dsel.cur, ids:[...UI.dsel.ids].sort(), mode:UI.dsel.mode, pane:UI.deskDetail, multi:deskMulti(),
  curRows:[...document.querySelectorAll('#desk .main .row.cur')].map(r=>r.dataset.id), selRows:[...document.querySelectorAll('#desk .main .row.selected')].map(r=>r.dataset.id).sort(),
  multiPane:(document.querySelector('#desk .pane.multi .mtitle')||{}).textContent||null, active:document.activeElement&&document.activeElement.classList.contains('row')?document.activeElement.dataset.id:(document.activeElement||{}).tagName}));
const ROW = id => '#desk .main .mbody .row[data-id="'+id+'"]:not(.first .row)';
const clickRow = (page, id, mods) => page.click(ROW(id)+' .row-title', mods?{modifiers:mods}:{});
const menuItems = page => page.$$eval('#pmenu .pm-it', b=>b.map(x=>x.querySelector('.pm-l').textContent));
// batch I: a tap-opened menu on the iPhone ignores taps for 450 ms (v0.14.1 guard), so the helper waits for it
const clickItem = async (page, label) => { await page.waitForFunction(()=>typeof menuFresh!=='function'||UI.wide||!menuFresh()); return page.evaluate(l=>{ const b=[...document.querySelectorAll('#pmenu .pm-it')].find(x=>x.querySelector('.pm-l').textContent===l); if(!b) throw new Error('no item '+l); b.click(); }, label); };
const key = async (page, k, w) => { await page.keyboard.press(k); await page.waitForTimeout(w||120); };
async function drag(page, src, dst, hold){
  for(const s of [src,dst]) await page.$eval(s, e=>e.scrollIntoView({block:'center'}));
  const a=await (await page.$(src)).boundingBox(), b=await (await page.$(dst)).boundingBox();
  await page.mouse.move(a.x+a.width/3, a.y+a.height/2); await page.mouse.down();
  await page.mouse.move(b.x+b.width/2, b.y+b.height/2, {steps:10}); await page.mouse.move(b.x+b.width/2+2, b.y+b.height/2+1, {steps:3});
  const mid = hold ? await hold() : null;
  await page.mouse.up(); await page.waitForTimeout(400); return mid; }

(async()=>{
  await new Promise(res=>srv.listen(PORT,res));
  const browser = await chromium.launch();
  let {ctx, page} = await open(browser);
  const o0 = await order(page);
  check('setup_order', JSON.stringify(o0)===JSON.stringify(['a1','a2','a3','a4','a5','a6','a7']), o0);

  /* ---------- R15: roles, the selected row, the inspector following ---------- */
  r.aria = await page.evaluate(()=>{ const gs=[...document.querySelectorAll('#desk .main .mbody .group[role=listbox]')]; const rows=[...document.querySelectorAll('#desk .main .mbody .row[data-id]')];
    return {groups:gs.length, label:gs[0]&&gs[0].getAttribute('aria-label'), multi:gs.every(g=>g.getAttribute('aria-multiselectable')==='true'), options:rows.every(x=>x.getAttribute('role')==='option'), tab0:rows.filter(x=>x.tabIndex===0).map(x=>x.dataset.id), drag:rows.every(x=>x.draggable),
      btnTab:[...document.querySelectorAll('#desk .main .row .check, #desk .main .row .rowmore')].every(b=>b.tabIndex===-1)}; });
  check('R15_aria', r.aria.groups===3 && r.aria.label==='Todas, Hoy' && r.aria.multi && r.aria.options && JSON.stringify(r.aria.tab0)==='["a1"]' && r.aria.btnTab, r.aria);
  check('R16_rowsDraggable', r.aria.drag, r.aria);
  await clickRow(page, 'a2'); await page.waitForTimeout(250);
  let s = await state(page);
  check('R15_clickSelects', s.cur==='a2' && s.pane==='a2' && JSON.stringify(s.curRows)==='["a2"]' && s.active==='a2', s);
  // The selection is not the hover: the accent tint against the hover gray
  await page.hover(ROW('a4')+' .row-title'); await page.waitForTimeout(100);
  r.bg = await page.evaluate(()=>{ const g=id=>getComputedStyle(document.querySelector('#desk .main .row[data-id="'+id+'"] > .row-content')).backgroundColor; return {cur:g('a2'), hover:g('a4'), sel:document.querySelector('#desk .main .row[data-id="a2"]').getAttribute('aria-selected')}; });
  check('R15_selectedNotHover', r.bg.cur!==r.bg.hover && /0, 122, 255/.test(r.bg.cur) && r.bg.sel==='true', r.bg);
  await key(page, 'ArrowDown', 300); s = await state(page);
  check('R15_arrowPaneFollows', s.cur==='a3' && s.pane==='a3' && JSON.stringify(s.curRows)==='["a3"]' && await page.evaluate(()=>document.querySelector('#desk .pane').dataset.task==='a3'), s);
  r.ring = await page.evaluate(()=>{ const a=document.activeElement; return {id:a.dataset.id, fv:a.matches(':focus-visible'), sh:getComputedStyle(a.querySelector('.row-content')).boxShadow}; });
  check('R15_focusRing', r.ring.id==='a3' && r.ring.fv && /inset/.test(r.ring.sh), r.ring);
  await key(page, 'j', 300); await key(page, 'j', 300); s = await state(page);
  check('R15_jMoves', s.cur==='a5' && s.pane==='a5', s);
  await key(page, 'k', 300); s = await state(page); check('R15_kMoves', s.cur==='a4' && s.pane==='a4', s);
  await key(page, 'Space', 300); s = await state(page);
  check('R15_spaceCloses', !s.pane && s.cur==='a4' && !(await page.$('#desk .pane')), s);
  await key(page, 'ArrowUp'); s = await state(page);
  check('R15_arrowWithoutPane', s.cur==='a3' && !s.pane && JSON.stringify(s.curRows)==='["a3"]' && s.active==='a3', s);
  await key(page, ' ', 300); s = await state(page); check('R15_spaceOpens', s.pane==='a3', s);
  await key(page, 'Escape', 300); s = await state(page); check('R15_escClosesPane', !s.pane && s.cur==='a3', s);

  (r.trace=r.trace||[]).push(0+':'+await page.evaluate(()=>JSON.stringify(task('a4'))+deskOrder().join(',')));
  /* ---------- R15: single-key shortcuts ---------- */
  await key(page, '1', 250); check('R15_key1', await page.evaluate(()=>task('a3').priority==='high') && await toastText(page)==='Prioridad alta');
  await key(page, '2', 250); check('R15_key2', await page.evaluate(()=>task('a3').priority==='mid'));
  await key(page, '0', 250); check('R15_key0', await page.evaluate(()=>task('a3').priority==='none'));
  await key(page, 'Control+z', 250); check('R15_cmdZ', await page.evaluate(()=>task('a3').priority==='mid'));
  await page.evaluate(()=>{ updTask('a3',{priority:'none'}); render(); }); // the fixed order puts priorities first: back to the plain order
  // Dates: M tomorrow, V Friday, S next Monday, H back to today; in Todas the row stays listed and selected
  await clickRow(page, 'a3'); await page.waitForTimeout(250);
  await key(page, 'm', 350); s = await state(page);
  r.m = await page.evaluate(()=>({d:task('a3').date, t:addDays(todayStr(),1)}));
  check('R15_keyM', r.m.d===r.m.t && await toastText(page)==='Movida a mañana' && s.cur==='a3' && s.pane==='a3', {m:r.m, s});
  await key(page, 'v', 300); r.v = await page.evaluate(()=>({d:task('a3').date, f:nextWeekday(5,true)})); check('R15_keyV', r.v.d===r.v.f && r.v.d==='2026-11-06', r.v);
  await key(page, 's', 300); r.s2 = await page.evaluate(()=>({d:task('a3').date, n:nextWeekday(1,true)})); check('R15_keyS', r.s2.d===r.s2.n && r.s2.d==='2026-11-09', r.s2);
  await key(page, 'h', 300); check('R15_keyH', await page.evaluate(()=>task('a3').date===todayStr()));
  // In Hoy, M takes the row out of the list: the selection and the inspector go on to the next row (as Mail)
  await page.evaluate(()=>setDeskView('hoy')); await page.waitForTimeout(250);
  await clickRow(page, 'a3'); await page.waitForTimeout(250); r.hoyBefore = Object.assign(await state(page), {order:await order(page), dates:await page.evaluate(()=>DB.tasks.map(x=>x.id+':'+x.date+':'+x.carried))}); await key(page, 'm', 400); s = await state(page);
  check('R15_paneFollowsAfterKey', s.cur==='a4' && s.pane==='a4' && JSON.stringify(s.curRows)==='["a4"]' && s.active==='a4', s);
  await key(page, 'Control+z', 300); await page.evaluate(()=>setDeskView('todas')); await page.waitForTimeout(250);
  check('R15_backInTodas', await page.evaluate(()=>task('a3').date===todayStr() && JSON.stringify(deskOrder().slice(0,4))==='["a1","a2","a3","a4"]'));
  (r.trace=r.trace||[]).push(1+':'+await page.evaluate(()=>JSON.stringify(task('a4'))+deskOrder().join(',')));
  // C completes, and the selection with the inspector moves to the next row
  await clickRow(page, 'a1'); await page.waitForTimeout(250);
  await key(page, 'c', 700); s = await state(page);
  check('R15_keyC', await page.evaluate(()=>task('a1').status==='done') && await toastText(page)==='Tarea completada' && s.cur==='a2' && s.pane==='a2', s);
  await key(page, 'Meta+z', 300); check('R15_metaZ', await page.evaluate(()=>task('a1').status==='pending'));
  (r.trace=r.trace||[]).push(2+':'+await page.evaluate(()=>JSON.stringify(task('a4'))+deskOrder().join(',')));
  // F and P open the inspector's popovers
  await clickRow(page, 'a2'); await page.waitForTimeout(250);
  await key(page, 'f', 300); r.f = await page.evaluate(()=>({open:menuOpen(), cal:!!document.querySelector('#pmenu .cal'), anch:(()=>{ const m=document.querySelector('#pmenu .pm-pop, #pmenu .pm-lvl, #pmenu > *'); return !!m; })()}));
  check('R15_keyF', r.f.open && r.f.cal, r.f);
  await key(page, 'Escape', 250);
  await key(page, 'p', 300); r.p = await menuItems(page).catch(()=>[]); check('R15_keyP', r.p[0]==='Ninguno' && r.p.includes('FLC'), r.p);
  await clickItem(page, 'FLC'); await page.waitForTimeout(300); check('R15_keyPChoose', await page.evaluate(()=>task('a2').projectId===P.p));
  (r.trace=r.trace||[]).push(3+':'+await page.evaluate(()=>JSON.stringify(task('a4'))+deskOrder().join(',')));
  // Delete asks first; Backspace too
  await key(page, 'Delete', 350); r.del = await page.evaluate(()=>({a:document.querySelector('#asheet').classList.contains('on'), txt:document.querySelector('#asheet').textContent}));
  check('R15_deleteConfirms', r.del.a && /Eliminar/.test(r.del.txt) && await page.evaluate(()=>!!task('a2')), r.del);
  await key(page, 'Escape', 350); check('R15_deleteCancel', await page.evaluate(()=>!!task('a2')&&!document.querySelector('#asheet').classList.contains('on')));
  await key(page, 'Backspace', 350);
  await page.evaluate(()=>{ const b=[...document.querySelectorAll('#asheet button')].find(x=>/Eliminar/.test(x.textContent)); b.click(); }); await page.waitForTimeout(600);
  s = await state(page);
  check('R15_backspaceDeletes', await page.evaluate(()=>!task('a2')) && await toastText(page)==='Tarea eliminada' && s.cur==='a3' && s.pane==='a3', s);
  await undo(page); check('R15_deleteUndo', await page.evaluate(()=>!!task('a2')));
  (r.trace=r.trace||[]).push(4+':'+await page.evaluate(()=>JSON.stringify(task('a4'))+deskOrder().join(',')));
  // The keys never act while typing, nor take the browser's own
  await page.click('#desk [data-role=addbar]'); await page.keyboard.type('chm'); await page.waitForTimeout(150);
  r.typing = await page.evaluate(()=>({v:document.querySelector('#desk [data-role=addbar]').value, a3:task('a3').status, d:task('a3').date, pr:task('a3').priority}));
  check('R15_typingSafe', r.typing.v==='chm' && r.typing.a3==='pending' && r.typing.d===r.typing.d, r.typing);
  await page.keyboard.press('Control+a'); r.selAllTyping = await page.evaluate(()=>UI.dsel.ids.size); check('R15_cmdAInFieldIsNative', r.selAllTyping===0, r.selAllTyping);
  await page.evaluate(()=>{ const a=document.querySelector('#desk [data-role=addbar]'); a.value=''; UI.addDraft=''; a.blur(); });
  r.browserKeys = await page.evaluate(()=>['l','t','w','r','n'].map(k=>{ const e=new KeyboardEvent('keydown',{key:k, metaKey:true, bubbles:true, cancelable:true}); document.body.dispatchEvent(e); return e.defaultPrevented; }));
  check('R15_browserKeysFree', r.browserKeys.every(x=>!x), r.browserKeys);
  (r.trace=r.trace||[]).push(5+':'+await page.evaluate(()=>JSON.stringify(task('a4'))+deskOrder().join(',')));
  // ? shows the shortcuts
  await key(page, '?', 350); r.help = await page.evaluate(()=>({on:document.querySelector('#sheet').classList.contains('on'), h:(document.querySelector('#sheet h2')||{}).textContent, n:document.querySelectorAll('#sheet .kr').length, fits:(sh=>sh.scrollHeight<=sh.clientHeight+1)(document.querySelector('#sheet'))}));
  check('R15_helpSheet', r.help.on && r.help.h==='Atajos de teclado' && r.help.n>=18 && r.help.fits, r.help);
  await page.screenshot({path:OUT+'/g-help-light.png'});
  await key(page, 'Escape', 350);

  (r.trace=r.trace||[]).push(6+':'+await page.evaluate(()=>JSON.stringify(task('a4'))+deskOrder().join(',')));
  /* ---------- R15: the title edited in the row ---------- */
  await clickRow(page, 'a3'); await page.waitForTimeout(250); await key(page, 'Escape', 250);
  await key(page, 'Enter', 250);
  r.edit = await page.evaluate(()=>{ const i=document.querySelector('#desk .main .row[data-id=a3] input.rowedit'); return {has:!!i, focused:document.activeElement===i, v:i&&i.value, sel:i&&i.selectionEnd-i.selectionStart, drag:document.querySelector('#desk .main .row[data-id=a3]').draggable}; });
  check('R15_enterEdits', r.edit.has && r.edit.focused && r.edit.v==='Tres' && r.edit.sel===4 && !r.edit.drag, r.edit);
  await page.screenshot({path:OUT+'/g-edit-light.png'});
  await page.keyboard.type('Tres revisada'); await page.evaluate(()=>render()); await page.waitForTimeout(100); // a redraw keeps the field and the text
  r.keep = await page.evaluate(()=>{ const i=document.querySelector('#desk input.rowedit'); return {v:i&&i.value, f:document.activeElement===i}; });
  check('R15_editSurvivesRender', r.keep.v==='Tres revisada' && r.keep.f, r.keep);
  await key(page, 'Enter', 300);
  r.saved = await page.evaluate(()=>({t:task('a3').title, input:!!document.querySelector('#desk input.rowedit'), focus:document.activeElement.dataset.id}));
  check('R15_enterSaves', r.saved.t==='Tres revisada' && !r.saved.input && r.saved.focus==='a3' && await toastText(page)==='Título cambiado', r.saved);
  await key(page, 'Control+z', 300); check('R15_editUndo', await page.evaluate(()=>task('a3').title==='Tres'));
  await key(page, 'Enter', 200); await page.keyboard.type('Otra cosa'); await key(page, 'Escape', 250);
  r.esc = await page.evaluate(()=>({t:task('a3').title, input:!!document.querySelector('#desk input.rowedit'), shown:document.querySelector('#desk .main .row[data-id=a3] .row-title').textContent, pane:UI.deskDetail}));
  check('R15_escCancelsEdit', r.esc.t==='Tres' && !r.esc.input && r.esc.shown==='Tres' && !r.esc.pane, r.esc);
  (r.trace=r.trace||[]).push(7+':'+await page.evaluate(()=>JSON.stringify(task('a4'))+deskOrder().join(',')));
  await page.dblclick(ROW('a4')+' .row-title'); await page.waitForTimeout(300);
  check('R15_dblclickEdits', await page.evaluate(()=>!!document.querySelector('#desk .main .row[data-id=a4] input.rowedit') && document.activeElement.classList.contains('rowedit')));
  await page.keyboard.type('Cuatro bis'); await page.click('#desk .main .mhead h1'); await page.waitForTimeout(300);
  check('R15_blurSaves', await page.evaluate(()=>task('a4').title==='Cuatro bis' && !document.querySelector('#desk input.rowedit')));

  /* ---------- R16: Comando clic, Mayúsculas clic, Comando A and the bulk pane ---------- */
  await clickRow(page, 'a1'); await page.waitForTimeout(250);
  await clickRow(page, 'a3', ['Control']); await page.waitForTimeout(250); s = await state(page);
  check('R16_cmdClickAdds', JSON.stringify(s.ids)==='["a1","a3"]' && s.multi && !s.pane && JSON.stringify(s.selRows)==='["a1","a3"]' && s.multiPane==='2 tareas seleccionadas', s);
  r.mp = await page.evaluate(()=>({acts:[...document.querySelectorAll('#desk .pane.multi .mact .l')].map(x=>x.textContent), list:[...document.querySelectorAll('#desk .pane.multi .mlist li')].map(x=>x.textContent), hasPane:app.classList.contains('has-pane')}));
  check('R16_paneActions', JSON.stringify(r.mp.acts)==='["Completar","Aplazar","Fecha","Proyecto","Prioridad","Mover a espacio","Eliminar"]' && r.mp.list.length===2 && r.mp.hasPane, r.mp);
  await page.screenshot({path:OUT+'/g-multi-light.png'});
  await clickRow(page, 'a3', ['Control']); await page.waitForTimeout(250); s = await state(page);
  check('R16_cmdClickRemovesToOne', !s.multi && s.cur==='a1' && s.pane==='a1' && !s.ids.length, s);
  await clickRow(page, 'a5', ['Shift']); await page.waitForTimeout(250); s = await state(page);
  check('R16_shiftRange', JSON.stringify(s.ids)==='["a1","a2","a3","a4","a5"]' && s.multiPane==='5 tareas seleccionadas', s);
  await key(page, 'Escape', 250); s = await state(page); check('R16_escClears', !s.multi && !s.ids.length && !s.multiPane, s);
  await key(page, 'Shift+ArrowDown', 250); await key(page, 'Shift+ArrowDown', 250); s = await state(page);
  check('R16_shiftArrows', s.multi && s.ids.length===3 && s.ids.includes(s.cur) && s.multiPane==='3 tareas seleccionadas', s);
  await page.click('#desk .main .mhead h1'); await key(page, 'Control+a', 300); s = await state(page);
  check('R16_cmdA', s.ids.length===7 && s.multiPane==='7 tareas seleccionadas', s);
  // Keys act on all of them: 1 gives them high priority with one Deshacer
  await key(page, '1', 300);
  r.bp = await page.evaluate(()=>({p:DB.tasks.filter(x=>x.priority==='high').length, multi:deskMulti(), t:document.querySelector('#toastText').textContent}));
  check('R16_bulkPriorityKey', r.bp.p===7 && !r.bp.multi && r.bp.t==='7 tareas con prioridad alta', r.bp);
  await undo(page); check('R16_bulkPriorityUndo', await page.evaluate(()=>DB.tasks.filter(x=>x.priority==='high').length===0));
  // The pane's buttons: Completar, Fecha, Proyecto, Prioridad, Mover a espacio, Aplazar, Eliminar
  const pick = async ids => { await page.evaluate(ids=>{ UI.dsel.ids=new Set(ids); UI.dsel.cur=ids[0]; UI.deskDetail=null; render(); }, ids); await page.waitForTimeout(150); };
  await pick(['a1','a2']); await page.click('#desk .pane.multi [data-act=bulkComplete]'); await page.waitForTimeout(400);
  check('R16_bulkComplete', await page.evaluate(()=>task('a1').status==='done'&&task('a2').status==='done') && await toastText(page)==='2 tareas completadas');
  await undo(page); check('R16_bulkCompleteUndo', await page.evaluate(()=>task('a1').status==='pending'&&task('a2').status==='pending'));
  await pick(['a6','a7']); await page.click('#desk .pane.multi [data-act=bulkDate]'); await page.waitForTimeout(250);
  r.dm = await menuItems(page); check('R16_dateMenu', JSON.stringify(r.dm.slice(0,2))==='["Hoy","Mañana"]' && r.dm.includes('Sin fecha') && r.dm.includes('Elegir fecha…'), r.dm);
  await clickItem(page, 'Mañana'); await page.waitForTimeout(400);
  check('R16_bulkDate', await page.evaluate(()=>task('a6').date===addDays(todayStr(),1)&&task('a7').date===addDays(todayStr(),1)) && await toastText(page)==='2 tareas pasadas a mañana');
  await undo(page); check('R16_bulkDateUndo', await page.evaluate(()=>!task('a6').date&&!task('a7').date));
  await pick(['a6','a7']); await page.click('#desk .pane.multi [data-act=bulkDate]'); await page.waitForTimeout(200); await clickItem(page, 'Elegir fecha…'); await page.waitForTimeout(300);
  r.cal = await page.evaluate(()=>{ const b=[...document.querySelectorAll('#pmenu .cal-d[data-d]')].find(x=>x.dataset.d===addDays(todayStr(),3)); if(!b) return null; b.click(); return b.dataset.d; }); await page.waitForTimeout(400);
  check('R16_bulkCalendar', r.cal && await page.evaluate(d=>task('a6').date===d&&task('a7').date===d, r.cal), r.cal);
  await undo(page);
  await pick(['a6','a7']); await page.click('#desk .pane.multi [data-act=bulkMove]'); await page.waitForTimeout(200); await clickItem(page, 'Casa'); await page.waitForTimeout(400);
  check('R16_bulkProject', await page.evaluate(()=>task('a6').projectId===P.q&&task('a7').projectId===P.q) && await toastText(page)==='2 tareas movidas a Casa');
  await undo(page); check('R16_bulkProjectUndo', await page.evaluate(()=>!task('a6').projectId&&!task('a7').projectId));
  await pick(['a6','a7']); await page.click('#desk .pane.multi [data-act=bulkPriority]'); await page.waitForTimeout(200); await clickItem(page, 'Media'); await page.waitForTimeout(400);
  check('R16_bulkPriorityMenu', await page.evaluate(()=>task('a6').priority==='mid'&&task('a7').priority==='mid') && await toastText(page)==='2 tareas con prioridad media');
  await undo(page);
  await pick(['a6','a7']); await page.click('#desk .pane.multi [data-act=bulkPostpone]'); await page.waitForTimeout(200); r.pp=await menuItems(page); await clickItem(page, 'Mañana'); await page.waitForTimeout(400);
  check('R16_bulkPostpone', await page.evaluate(()=>task('a6').date===addDays(todayStr(),1)) && /2 tareas aplazadas a mañana/.test(await toastText(page)), r.pp);
  await undo(page);
  await pick(['a6','a7']); await page.click('#desk .pane.multi [data-act=bulkSpace]'); await page.waitForTimeout(200); await clickItem(page, 'Personal'); await page.waitForTimeout(400);
  r.sp = await page.evaluate(()=>({a6:task('a6').spaceId, rows:deskOrder()}));
  check('R16_bulkSpace', r.sp.a6==='personal' && !r.sp.rows.includes('a6') && await toastText(page)==='2 tareas movidas a Personal', r.sp);
  await undo(page); check('R16_bulkSpaceUndo', await page.evaluate(()=>task('a6').spaceId==='trabajo'&&deskOrder().includes('a7')));
  await pick(['a6','a7']); await page.click('#desk .pane.multi [data-act=bulkDelete]'); await page.waitForTimeout(350);
  await page.evaluate(()=>{ const b=[...document.querySelectorAll('#asheet button')].find(x=>/Eliminar/.test(x.textContent)); b.click(); }); await page.waitForTimeout(400);
  check('R16_bulkDelete', await page.evaluate(()=>!task('a6')&&!task('a7')) && await toastText(page)==='2 tareas eliminadas');
  await undo(page); check('R16_bulkDeleteUndo', await page.evaluate(()=>!!task('a6')&&!!task('a7')));

  /* ---------- R16: the selection mode of the view menu ---------- */
  await page.evaluate(()=>{ UI.dsel.cur=null; render(); });
  await page.click('#desk .mopts'); await page.waitForTimeout(200); r.vm = await menuItems(page);
  check('R16_viewMenuItem', r.vm[0]==='Seleccionar tareas', r.vm);
  await clickItem(page, 'Seleccionar tareas'); await page.waitForTimeout(300);
  r.mode = await page.evaluate(()=>({mode:UI.dsel.mode, boxes:document.querySelectorAll('#desk .main .row .selbox').length, checks:document.querySelectorAll('#desk .main .mbody .group .row .check').length, title:document.querySelector('#desk .pane.multi .mtitle').textContent, dis:document.querySelector('#desk .pane.multi [data-act=bulkComplete]').disabled}));
  check('R16_modeStarts', r.mode.mode && r.mode.boxes>=7 && r.mode.checks===0 && r.mode.title==='Ninguna tarea seleccionada' && r.mode.dis, r.mode);
  await clickRow(page, 'a2'); await page.waitForTimeout(200); await clickRow(page, 'a4'); await page.waitForTimeout(200); s = await state(page);
  check('R16_modeClicksToggle', JSON.stringify(s.ids)==='["a2","a4"]' && !s.pane && s.multiPane==='2 tareas seleccionadas', s);
  await clickRow(page, 'a2'); await page.waitForTimeout(200); s = await state(page);
  check('R16_modeKeepsOne', s.mode && JSON.stringify(s.ids)==='["a4"]' && s.multiPane==='1 tarea seleccionada', s);
  await page.screenshot({path:OUT+'/g-mode-light.png'});
  await page.click('#desk .pane.multi [data-act=selDone]'); await page.waitForTimeout(250); s = await state(page);
  check('R16_modeEnds', !s.mode && !s.ids.length && !s.multiPane && await page.evaluate(()=>!document.querySelector('#desk .main .row .selbox')), s);

  /* ---------- R16: dragging rows to the sidebar and the mini month ---------- */
  const over = () => page.evaluate(()=>[...document.querySelectorAll('#desk .over')].map(x=>x.dataset.dropProject!==undefined?'project:'+x.dataset.dropProject:x.dataset.day?'day:'+x.dataset.day:x.className));
  r.overP = await drag(page, ROW('a6'), '#desk .side [data-drop-project="'+await page.evaluate(()=>P.p)+'"]', over);
  check('R16_dropHighlight', r.overP.length===1 && /^project:/.test(r.overP[0]), r.overP);
  check('R16_dragToProject', await page.evaluate(()=>task('a6').projectId===P.p) && await toastText(page)==='Movida a FLC');
  await undo(page); check('R16_dragToProjectUndo', await page.evaluate(()=>!task('a6').projectId));
  await page.evaluate(()=>{ updTask('a1',{projectId:P.q}); render(); });
  await drag(page, ROW('a1'), '#desk .side [data-drop-project=""]');
  check('R16_dragToNoProject', await page.evaluate(()=>!task('a1').projectId) && await toastText(page)==='Sin proyecto');
  await drag(page, ROW('a7'), '#desk .side [data-view=hoy]');
  check('R16_dragToHoy', await page.evaluate(()=>task('a7').date===todayStr()) && /Movida a hoy/i.test(await toastText(page)||''), await toastText(page));
  await undo(page); check('R16_dragToHoyUndo', await page.evaluate(()=>!task('a7').date));
  const d6 = await page.evaluate(()=>addDays(todayStr(),6));
  await drag(page, ROW('a6'), '#desk .minical [data-day="'+d6+'"]');
  check('R16_dragToMiniMonth', await page.evaluate(d=>task('a6').date===d, d6));
  await undo(page);
  const dPast = await page.evaluate(()=>addDays(todayStr(),-1));
  await drag(page, ROW('a6'), '#desk .minical [data-day="'+dPast+'"]');
  check('R16_pastRefused', await page.evaluate(()=>!task('a6').date) && await toastText(page)==='No se puede mover a un día pasado', await toastText(page));
  // The whole selection travels together, with one Deshacer
  await page.evaluate(()=>{ UI.dsel.ids=new Set(['a5','a6','a7']); UI.dsel.cur='a5'; UI.deskDetail=null; render(); });
  r.multiOver = await drag(page, ROW('a6'), '#desk .side [data-drop-project="'+await page.evaluate(()=>P.q)+'"]', ()=>page.evaluate(()=>({dragging:[...document.querySelectorAll('#desk .main .row.dragging')].map(x=>x.dataset.id).sort()})));
  r.multiDrop = await page.evaluate(()=>['a5','a6','a7'].map(id=>task(id).projectId===P.q));
  check('R16_dragSelection', r.multiDrop.every(Boolean) && await toastText(page)==='3 tareas movidas a Casa' && JSON.stringify(r.multiOver.dragging)==='["a5","a6","a7"]', {d:r.multiDrop, o:r.multiOver, t:await toastText(page)});
  await undo(page); check('R16_dragSelectionUndo', await page.evaluate(()=>['a5','a6','a7'].every(id=>!task(id).projectId)));
  await page.evaluate(()=>{ UI.dsel.ids=new Set(['a6','a7']); UI.dsel.cur='a6'; render(); });
  await drag(page, ROW('a7'), '#desk .side [data-view=hoy]');
  check('R16_dragSelectionDate', await page.evaluate(()=>task('a6').date===todayStr()&&task('a7').date===todayStr()) && await toastText(page)==='2 tareas movidas a hoy', await toastText(page));
  await undo(page); check('R16_dragSelectionDateUndo', await page.evaluate(()=>!task('a6').date&&!task('a7').date));
  // No reordering inside a list: dropping a row on another row changes nothing
  const before = await order(page); await page.evaluate(()=>{ UI.dsel.ids.clear(); render(); });
  await drag(page, ROW('a1'), ROW('a4')); check('R16_noReorder', JSON.stringify(await order(page))===JSON.stringify(before) && await page.evaluate(()=>task('a1').date===todayStr()));
  // Calendar cards still drag (batch F)
  await page.evaluate(()=>setDeskView('week')); await page.waitForTimeout(300);
  r.calOk = await page.evaluate(()=>({cards:document.querySelectorAll('#desk .wcard[draggable=true]').length, sel:UI.dsel.ids.size}));
  check('R16_calendarUnchanged', r.calOk.cards>0 && r.calOk.sel===0, r.calOk);
  await page.evaluate(()=>setDeskView('todas')); await page.waitForTimeout(200);

  // A long list (windowed rows): the arrows reach rows not drawn yet, Comando A counts them too, and a key costs little
  await page.evaluate(()=>{ for(let i=0;i<260;i++) addTask({id:'L'+i, title:'Larga '+i}); save(); setDeskView('todas'); }); await page.waitForTimeout(300);
  r.lazy0 = await page.evaluate(()=>({ph:document.querySelectorAll('#desk .rph').length, n:deskOrder().length}));
  await clickRow(page, 'a1'); await key(page, 'Space', 250);
  r.lazy = await page.evaluate(()=>{ const t0=performance.now(); for(let i=0;i<250;i++) moveSel(1,false); const dt=performance.now()-t0; const id=UI.dsel.cur, row=deskRow(id), mb=document.querySelector('#desk .main .mbody').getBoundingClientRect(), b=row&&row.getBoundingClientRect();
    return {id, idx:deskOrder().indexOf(id), drawn:!!row, inView:!!b&&b.top>=mb.top&&b.bottom<=mb.bottom+1, focus:document.activeElement===row, ms:Math.round(dt/250*10)/10}; });
  check('R15_longListArrows', r.lazy0.ph>0 && r.lazy.idx===250 && r.lazy.drawn && r.lazy.inView && r.lazy.focus && r.lazy.ms<20, {l0:r.lazy0, l:r.lazy});
  await page.click('#desk .main .mhead h1'); await key(page, 'Control+a', 300);
  r.lazyAll = await page.evaluate(()=>({n:UI.dsel.ids.size, t:document.querySelector('#desk .pane.multi .mtitle').textContent}));
  check('R16_cmdALongList', r.lazyAll.n===r.lazy0.n && r.lazyAll.t===r.lazy0.n+' tareas seleccionadas', r.lazyAll);
  await key(page, 'Escape', 200); await page.evaluate(()=>{ DB.tasks=DB.tasks.filter(x=>!/^L\d/.test(x.id)); save(); render(); });
  // Dark desktop: the selection and the bulk pane
  await page.emulateMedia({colorScheme:'dark'}); await page.evaluate(()=>{ UI.dsel.ids=new Set(['a1','a3','a4']); UI.dsel.cur='a4'; render(); }); await page.waitForTimeout(200);
  await page.screenshot({path:OUT+'/g-multi-dark.png'});
  await page.evaluate(()=>{ UI.dsel.ids.clear(); openDetail('a3'); }); await page.waitForTimeout(200); await page.keyboard.press('ArrowDown'); await page.waitForTimeout(250);
  await page.screenshot({path:OUT+'/g-cur-dark.png'});
  await ctx.close();

  /* ---------- The iPhone keeps its own selection mode ---------- */
  ({ctx, page} = await open(browser, {viewport:{width:390,height:844}, deviceScaleFactor:2, isMobile:true, hasTouch:true}));
  r.mob = await page.evaluate(()=>{ const rows=[...document.querySelectorAll('.screen.root .row[data-id]')]; return {wide:UI.wide, desk:!!document.querySelector('#desk'), rows:rows.length, role:rows.some(x=>x.hasAttribute('role')||x.draggable), dsel:UI.dsel.ids.size}; });
  check('iPhone_rowsUnchanged', !r.mob.wide && !r.mob.desk && r.mob.rows>=4 && !r.mob.role, r.mob);
  await page.evaluate(()=>viewMenu(document.querySelector('.vopts'))); await page.waitForTimeout(300); r.mvm = await menuItems(page);
  await clickItem(page, 'Seleccionar tareas'); await page.waitForTimeout(400);
  r.msel = await page.evaluate(()=>({sel:!!UI.select, cls:app.classList.contains('selecting'), boxes:document.querySelectorAll('.screen.root .row .selbox').length, bar:document.querySelectorAll('#selbar button').length}));
  check('iPhone_selectMode', r.mvm[0]==='Seleccionar tareas' && r.msel.sel && r.msel.cls && r.msel.boxes>=4 && r.msel.bar===4, {m:r.mvm, s:r.msel});
  await page.tap('.screen.root .row[data-id=a1] .row-title'); await page.tap('.screen.root .row[data-id=a2] .row-title'); await page.waitForTimeout(200);
  r.mids = await page.evaluate(()=>({ids:[...UI.select.ids].sort(), title:document.querySelector('#selTitle').textContent, sel:selSet()===UI.select.ids}));
  check('iPhone_toggle', JSON.stringify(r.mids.ids)==='["a1","a2"]' && r.mids.title==='2 seleccionadas' && r.mids.sel, r.mids);
  await page.tap('#selbar [data-act=bulkComplete]'); await page.waitForTimeout(400);
  r.mdone = await page.evaluate(()=>({a1:task('a1').status, a2:task('a2').status, sel:UI.select, t:document.querySelector('#toastText').textContent}));
  check('iPhone_bulkComplete', r.mdone.a1==='done' && r.mdone.a2==='done' && r.mdone.sel===null && r.mdone.t==='2 tareas completadas', r.mdone);
  // The keys of the desktop do nothing on the iPhone
  await page.evaluate(()=>document.dispatchEvent(new KeyboardEvent('keydown',{key:'c', bubbles:true}))); await page.waitForTimeout(250);
  check('iPhone_noKeys', await page.evaluate(()=>task('a3').status==='pending'));
  await page.screenshot({path:OUT+'/g-mobile-light.png'});
  await ctx.close();
  // Widening keeps nothing selected on the way in and out
  ({ctx, page} = await open(browser, {viewport:{width:1280,height:800}}));
  await page.evaluate(()=>{ UI.dsel.ids=new Set(['a1','a2']); render(); }); await page.setViewportSize({width:390, height:844}); await page.waitForTimeout(300);
  r.narrow = await page.evaluate(()=>({wide:UI.wide, ids:UI.dsel.ids.size, select:UI.select, rows:document.querySelectorAll('.screen.root .row.selected').length}));
  check('narrowClears', !r.narrow.wide && r.narrow.ids===0 && r.narrow.select===null && r.narrow.rows===0, r.narrow);
  await ctx.close();

  await browser.close(); srv.close();
  console.log(JSON.stringify({fails, results:r, errors}, null, 1));
  process.exit(fails.length||errors.length?1:0);
})().catch(e=>{ console.log(JSON.stringify({fatal:e.message, stack:e.stack, fails, results:r, errors:errors.concat([e.message])}, null, 1)); process.exit(1); });
