require('./lib/out.js'); // outputs (screenshots, downloads) go to tests/out
// Roadmap batch B: R5 (Nueva tarea with a bar on the keyboard), R6 (pasted lists and note items to tasks), R7 (#proyecto, !!, 'a las 9' in the title)
const { chromium } = require('playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = path.resolve(__dirname, '..'); const OUT = path.join(__dirname, 'out', 'B'); fs.mkdirSync(OUT, {recursive:true});
const TYPES = {'.html':'text/html','.css':'text/css','.js':'application/javascript','.webmanifest':'application/manifest+json','.png':'image/png'};
const srv = http.createServer((req,res)=>{ let p = decodeURIComponent(req.url.split('?')[0]); if(p==='/') p='/index.html'; const f=path.join(ROOT,p); if(!fs.existsSync(f)){res.writeHead(404);res.end();return;} res.writeHead(200,{'Content-Type':TYPES[path.extname(f)]||'application/octet-stream'}); res.end(fs.readFileSync(f)); });
const PORT=9202, URL='http://localhost:'+PORT+'/';
const SEED = JSON.stringify({spaces:[{id:'trabajo',name:'Trabajo',order:0},{id:'personal',name:'Personal',order:1}],projects:[
  {id:'p-flc',spaceId:'trabajo',name:'FLC',color:'#FFCC00',order:0,archived:false},{id:'p-flc2',spaceId:'trabajo',name:'FLC Fase 2',color:'#007AFF',order:1,archived:false},
  {id:'p-casa',spaceId:'trabajo',name:'Casa',color:'#34C759',order:2,archived:false},{id:'p-cash',spaceId:'trabajo',name:'Cash Application',color:'#FF9500',order:3,archived:false},
  {id:'p-form',spaceId:'trabajo',name:'Formación del equipo',color:'#AF52DE',order:4,archived:false},{id:'p-old',spaceId:'trabajo',name:'Fleco archivado',color:'#A2845E',order:5,archived:true}],
  tasks:[],voiceNotes:[],settings:{tipsSeen:true,activeSpace:'trabajo'}});
const r={}, fails=[]; const check=(name, ok, info)=>{ r[name]=ok?true:(info===undefined?false:info); if(!ok) fails.push(name); };
const errors=[];

async function open(browser, opts, url){
  const ctx = await browser.newContext(opts); const page = await ctx.newPage();
  await page.addInitScript(s=>{ if(!localStorage.getItem('tareas-v1')) localStorage.setItem('tareas-v1', s); }, SEED);
  page.on('pageerror', e=>errors.push(e.message)); page.on('console', m=>{ if(m.type()==='error') errors.push(m.text()); });
  await page.goto(url||URL); await page.waitForTimeout(500); return {ctx, page};
}
const MOB = scheme => ({ viewport:{width:390,height:844}, deviceScaleFactor:2, isMobile:true, hasTouch:true, colorScheme:scheme });
const focused = page => page.evaluate(()=>document.activeElement===document.querySelector('#sheet .titlein'));
const paste = (page, sel, text) => page.$eval(sel, (el,t)=>{ const dt=new DataTransfer(); dt.setData('text/plain', t); el.focus(); el.dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt, bubbles:true, cancelable:true})); }, text);

(async()=>{
  await new Promise(res=>srv.listen(PORT,res));
  const browser = await chromium.launch();

  /* ---------- Parser (R6, R7) ---------- */
  let {ctx, page} = await open(browser, MOB('light'));
  r.parse = await page.evaluate(()=>{ const P=t=>{ const q=parseQuick(t); return {t:q.title, d:q.date, p:q.projectId, pr:q.priority, tm:q.time&&q.time.h+':'+q.time.m, amb:q.ambiguous&&q.ambiguous.names}; };
    const t=todayStr(); const hr=new Date().getHours();
    return { tomorrow:addDays(t,1), friday:nextWeekday(5,true), today:t,
      a:P('Llamar a Marta mañana'), b:P('Preparar comité #flc viernes !!!'), c:P('#fase revisar'), d:P('Revisar #cas'), e:P('#formacion plan'), f:P('Plan #Formación'),
      g:P('Llamar a las 9:30 !!'), h:P('Llamar mañana a las 18h'), i:P('Llamar a las 9 de la mañana'), j:P('factura #123'), k:P('Revisar #fleco'), l:P('Cena a la 1 de la tarde'),
      // a time already gone today: no date written, tomorrow; with 'hoy' written, no reminder and the words stay in the title
      past: hr>=1 ? (()=>{ const a=quickTask('Llamar a las '+(hr-1)), b=quickTask('Llamar hoy a las '+(hr-1)); return {aDay:localDay(a.reminder), aDate:a.date, aTitle:a.title, bRem:b.reminder, bLate:b.late, bTitle:b.title}; })() : null,
      futureNoDate: hr<23 ? (()=>{ const a=quickTask('Llamar a las 23:59'); return {day:localDay(a.reminder), date:a.date, hm:fmtTime(a.reminder)}; })() : null,
      chosen: (()=>{ const a=quickTask('Llamar', {date:addDays(t,3), projectId:'p-casa', priority:'mid'}), b=quickTask('Llamar #flc !!! mañana', {date:addDays(t,3), projectId:'p-casa', priority:'mid'}); return {a:[a.date,a.projectId,a.priority], b:[b.date,b.projectId,b.priority,b.title]}; })(),
      lines: pasteLines('- uno\n2. dos\n\n* [ ] tres mañana\n☐ cuatro\n  a) cinco'), items: noteItems('Intro\n- a\n* b\n[ ] c\n☐ d\n- [x] hecho\n1. no\n-sin espacio') }; });
  const P=r.parse;
  check('R7_dateKept', P.a.t==='Llamar a Marta' && P.a.d===P.tomorrow, P.a);
  check('R7_projDatePri', P.b.t==='Preparar comité' && P.b.p==='p-flc' && P.b.d===P.friday && P.b.pr==='high', P.b);
  check('R7_projWord', P.c.p==='p-flc2' && P.c.t==='revisar', P.c);
  check('R7_ambiguous', P.d.p===null && P.d.t==='Revisar #cas' && P.d.amb && P.d.amb.join()==='Casa,Cash Application', P.d);
  check('R7_accents', P.e.p==='p-form' && P.f.p==='p-form' && P.f.t==='Plan', [P.e,P.f]);
  check('R7_timePri', P.g.tm==='9:30' && P.g.pr==='mid' && P.g.t==='Llamar', P.g);
  check('R7_timeH', P.h.tm==='18:0' && P.h.d===P.tomorrow && P.h.t==='Llamar', P.h);
  check('R7_morningIsTime', P.i.tm==='9:0' && P.i.d===null && P.i.t==='Llamar', P.i);
  check('R7_hashNumber', P.j.p===null && P.j.t==='factura #123', P.j);
  check('R7_archivedIgnored', P.k.p===null && P.k.t==='Revisar #fleco', P.k);
  check('R7_tarde', P.l.tm==='13:0' && P.l.t==='Cena', P.l);
  if(P.past) check('R7_pastTime', P.past.aDay===P.tomorrow && P.past.aDate===P.tomorrow && P.past.aTitle==='Llamar' && P.past.bRem===null && P.past.bLate && /a las/.test(P.past.bTitle), P.past);
  if(P.futureNoDate) check('R7_futureToday', P.futureNoDate.day===P.today && P.futureNoDate.date===P.today && P.futureNoDate.hm==='23:59', P.futureNoDate);
  check('R7_writtenWins', P.chosen.a.join()===[P.chosen.a[0],'p-casa','mid'].join() && P.chosen.b[0]===P.tomorrow && P.chosen.b[1]==='p-flc' && P.chosen.b[2]==='high' && P.chosen.b[3]==='Llamar', P.chosen);
  check('R6_pasteLines', P.lines.join('|')==='uno|dos|tres mañana|cuatro|cinco', P.lines);
  check('R6_noteItems', P.items.join('|')==='a|b|c|d', P.items);

  /* ---------- R5: mobile sheet ---------- */
  const HOY='.screen.root[data-root=tareas]';
  await page.tap(HOY+' .fab'); await page.waitForTimeout(450);
  r.sheet = await page.evaluate(()=>{ const s=document.querySelector('#sheet'); const bs=[...s.querySelectorAll('.qbtn')].map(b=>{ const x=b.getBoundingClientRect(); return [b.dataset.k, Math.round(x.width), Math.round(x.height)]; });
    return { on:s.classList.contains('on'), add:s.classList.contains('addsheet'), focused:document.activeElement===s.querySelector('.titlein'), bs, addBtn:(s.querySelector('.qadd')||{}).textContent,
      noHelp:!/Escribe|Enter añade/.test(s.textContent), noCancel:![...s.querySelectorAll('button')].some(b=>/Cancelar|Añadir y abrir/.test(b.textContent)), stripHidden:getComputedStyle(s.querySelector('#qstrip')).display==='none' }; });
  check('R5_sheet', r.sheet.on && r.sheet.add && r.sheet.focused && r.sheet.bs.map(b=>b[0]).join()==='date,proj,pri,est' && /* decision 56: Tiempo */ r.sheet.bs.every(b=>b[1]>=44&&b[2]>=44) && r.sheet.addBtn==='Añadir' && r.sheet.noHelp && r.sheet.noCancel && r.sheet.stripHidden, r.sheet);
  // The bar is the last thing in the sheet, at its bottom (on the keyboard when there is one)
  r.barBottom = await page.evaluate(()=>{ const s=document.querySelector('#sheet').getBoundingClientRect(), b=document.querySelector('.qbar').getBoundingClientRect(); return Math.round(s.bottom-b.bottom); });
  check('R5_barAtBottom', r.barBottom<=60, r.barBottom);
  await page.type('#sheet .titlein', 'Preparar acta #flc mañana !!!'); await page.waitForTimeout(80);
  r.typed = await page.evaluate(()=>({ marks:[...document.querySelectorAll('#sheet .qhl mark')].map(m=>m.textContent), toks:[...document.querySelectorAll('#sheet .tok')].map(t=>t.dataset.tok+':'+t.textContent.replace('×','')),
    set:[...document.querySelectorAll('#sheet .qbtn.set')].map(b=>b.dataset.k), inputColor:getComputedStyle(document.querySelector('#sheet .titlein')).backgroundColor }));
  check('R7_mobileMarks', r.typed.marks.join('|')==='#flc|mañana|!!!' && r.typed.toks.join('|')==='date:Mañana|proj:FLC|pri:Alta' && r.typed.set.join()==='date,proj,pri', r.typed);
  // The date icon opens its strip; the field keeps the focus (the keyboard stays) and the recognised chip is lit
  await page.tap('#sheet .qbtn[data-k=date]'); await page.waitForTimeout(120);
  r.strip = await page.evaluate(()=>({ focused:document.activeElement===document.querySelector('#sheet .titlein'), chips:[...document.querySelectorAll('#qstrip .chip')].map(c=>c.dataset.c+(c.classList.contains('on')?'*':'')), open:document.querySelector('.qbtn[data-k=date]').classList.contains('open') }));
  check('R5_stripKeepsFocus', r.strip.focused && r.strip.open && r.strip.chips.includes('man*'), r.strip);
  await page.screenshot({path:path.join(OUT,'b-light-sheet-strip.png')});
  // Picking a chip replaces the written date: 'mañana' leaves the field
  const pick = r.strip.chips.some(c=>c.startsWith('vie')) ? 'vie' : 'nsem';
  await page.tap('#qstrip [data-c='+pick+']'); await page.waitForTimeout(120);
  r.picked = await page.evaluate(()=>({ v:document.querySelector('#sheet .titlein').value, focused:document.activeElement===document.querySelector('#sheet .titlein'), stripHidden:getComputedStyle(document.querySelector('#qstrip')).display==='none', tok:(document.querySelector('.tok[data-tok=date]')||{}).textContent }));
  check('R5_pickReplacesText', r.picked.v==='Preparar acta #flc !!!' && r.picked.focused && r.picked.stripHidden, r.picked);
  // Enter adds and keeps going; the hand-picked date stays, the written project does not
  await page.keyboard.press('Enter'); await page.waitForTimeout(200);
  await page.type('#sheet .titlein', 'Segunda'); await page.keyboard.press('Enter'); await page.waitForTimeout(200);
  r.serial = await page.evaluate(()=>({ open:document.querySelector('#sheet').classList.contains('on'), v:document.querySelector('#sheet .titlein').value, focused:document.activeElement===document.querySelector('#sheet .titlein'), hint:document.querySelector('#addHint').textContent,
    tasks:DB.tasks.map(x=>[x.title,x.projectId,x.priority,x.date]) }));
  const pickDate = await page.evaluate(k=>k==='vie'?nextWeekday(5,true):nextWeekday(1,true), pick);
  check('R5_serialAdd', r.serial.open && r.serial.v==='' && r.serial.focused && /2 añadidas/.test(r.serial.hint) && JSON.stringify(r.serial.tasks)===JSON.stringify([['Preparar acta','p-flc','high',pickDate],['Segunda',null,'none',pickDate]]), r.serial);
  // The cross on a token clears it
  await page.tap('#sheet .tok[data-tok=date] .x'); await page.waitForTimeout(100);
  r.untok = await page.evaluate(()=>({ toks:document.querySelectorAll('#sheet .tok').length, focused:document.activeElement===document.querySelector('#sheet .titlein') }));
  check('R5_tokenRemove', r.untok.toks===0 && r.untok.focused, r.untok);
  // Otra fecha: a calendar inside the strip, still with the focus in the field
  await page.tap('#sheet .qbtn[data-k=date]'); await page.waitForTimeout(100); await page.tap('#qstrip [data-c=fecha]'); await page.waitForTimeout(100);
  const d3 = await page.evaluate(()=>addDays(todayStr(),3));
  r.cal = await page.evaluate(()=>({ cal:!!document.querySelector('#qstrip .cal'), focused:document.activeElement===document.querySelector('#sheet .titlein') }));
  await page.tap('#qstrip [data-d="'+d3+'"]'); await page.waitForTimeout(100);
  r.cal.after = await page.evaluate(()=>({ tok:(document.querySelector('.tok[data-tok=date]')||{}).textContent, strip:getComputedStyle(document.querySelector('#qstrip')).display, focused:document.activeElement===document.querySelector('#sheet .titlein') }));
  r.cal.want = await page.evaluate(d=>fmtDate(d)+'×', d3);
  check('R5_calendarInStrip', r.cal.cal && r.cal.focused && r.cal.after.tok===r.cal.want && r.cal.after.strip==='none' && r.cal.after.focused, r.cal);
  await page.tap('#sheet .tok[data-tok=date] .x'); await page.waitForTimeout(80);
  // Project strip: pick by hand
  await page.tap('#sheet .qbtn[data-k=proj]'); await page.waitForTimeout(100);
  r.projStrip = await page.$$eval('#qstrip .chip', c=>c.map(x=>x.textContent));
  await page.tap('#qstrip [data-p=p-casa]'); await page.waitForTimeout(100);
  await page.tap('#sheet .qbtn[data-k=pri]'); await page.waitForTimeout(100); await page.tap('#qstrip [data-pr=mid]'); await page.waitForTimeout(100);
  r.handToks = await page.$$eval('#sheet .tok', t=>t.map(x=>x.dataset.tok+':'+x.textContent.replace('×','')));
  check('R5_projPriStrips', r.projStrip.join('|')==='Ninguno|FLC|FLC Fase 2|Casa|Cash Application|Formación del equipo' && r.handToks.join('|')==='proj:Casa|pri:Media', {s:r.projStrip, t:r.handToks});
  // R7 ambiguity on the sheet: a warning line, no project from the tag (the hand-picked one stays)
  await page.type('#sheet .titlein', 'Mirar #cas'); await page.waitForTimeout(80);
  r.amb = await page.evaluate(()=>({ hint:document.querySelector('#addHint').textContent, warn:document.querySelector('#addHint').classList.contains('warn'), marks:document.querySelectorAll('#sheet .qhl mark').length }));
  check('R7_mobileAmbiguous', /#cas coincide con Casa y Cash Application/.test(r.amb.hint) && r.amb.warn && r.amb.marks===0, r.amb);
  await page.fill('#sheet .titlein', '');
  // R6: a pasted list; every line takes the picked project and priority, its own written date
  await paste(page, '#sheet .titlein', '- Llamar a Pepe mañana\n2. Enviar acta\n\n* [ ] Revisar SOW #flc');
  await page.waitForTimeout(120);
  r.list = await page.evaluate(()=>({ rows:[...document.querySelectorAll('#qlist .pl')].map(p=>p.querySelector('.t').textContent+' | '+p.querySelector('.m').textContent), btn:document.querySelector('#sheet .qadd').textContent, v:document.querySelector('#sheet .titlein').value }));
  check('R6_listShown', r.list.rows.length===3 && r.list.btn==='Crear 3 tareas' && r.list.v==='' && /^Llamar a Pepe \| Mañana, Casa, !!$/.test(r.list.rows[0]) && /^Revisar SOW \| FLC, !!$/.test(r.list.rows[2]), r.list);
  await page.screenshot({path:path.join(OUT,'b-light-sheet-list.png')});
  // Removing a line, then adding one with Enter
  await page.tap('#qlist [data-rm="1"]'); await page.waitForTimeout(80);
  await page.type('#sheet .titlein', 'Cuarta línea'); await page.keyboard.press('Enter'); await page.waitForTimeout(80);
  r.list2 = await page.evaluate(()=>({ n:document.querySelectorAll('#qlist .pl').length, btn:document.querySelector('#sheet .qadd').textContent }));
  check('R6_listEdit', r.list2.n===3 && r.list2.btn==='Crear 3 tareas', r.list2);
  const before = await page.evaluate(()=>DB.tasks.length);
  await page.tap('#sheet .qadd'); await page.waitForTimeout(450);
  r.created = await page.evaluate(n=>({ closed:!document.querySelector('#sheet').classList.contains('on'), toast:document.querySelector('#toastText').textContent, undo:getComputedStyle(document.querySelector('#toastBtn')).display!=='none', made:DB.tasks.slice(n).map(x=>[x.title,x.projectId,x.priority,x.date]) }), before);
  const tmr = P.tomorrow;
  check('R6_createMany', r.created.closed && r.created.toast==='3 tareas creadas' && r.created.undo && JSON.stringify(r.created.made)===JSON.stringify([['Llamar a Pepe','p-casa','mid',tmr],['Revisar SOW','p-flc','mid',null],['Cuarta línea','p-casa','mid',null]]), r.created);
  await page.tap('#toastBtn'); await page.waitForTimeout(300);
  r.undone = await page.evaluate(()=>DB.tasks.length);
  check('R6_undoAll', r.undone===before, {before, after:r.undone});
  // Long press on Añadir: add and open
  await page.tap(HOY+' .fab'); await page.waitForTimeout(450); await page.type('#sheet .titlein','Abrir esta #fase');
  const ab = await page.$eval('#sheet .qadd', e=>{ const b=e.getBoundingClientRect(); return {x:b.x+b.width/2, y:b.y+b.height/2}; });
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:ab.x,y:ab.y}]}); await page.waitForTimeout(650); await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]}); await page.waitForTimeout(600);
  r.longPress = await page.evaluate(()=>({ stack:UI.stack.length, title:(document.querySelector('.pushed-screen [data-role=title]')||{}).value, n:DB.tasks.filter(x=>x.title==='Abrir esta').length, proj:(DB.tasks.find(x=>x.title==='Abrir esta')||{}).projectId, sheet:document.querySelector('#sheet').classList.contains('on'), tab:UI.tab }));
  await page.waitForTimeout(400); r.longPress.tabLater = await page.evaluate(()=>UI.tab+':'+UI.stack.length); // the click after the long press never reaches the tab bar under the button
  check('R5_longPressOpens', r.longPress.tabLater==='tareas:1' && r.longPress.stack===1 && r.longPress.title==='Abrir esta' && r.longPress.n===1 && r.longPress.proj==='p-flc2' && !r.longPress.sheet, r.longPress);
  await page.evaluate(()=>pop()); await page.waitForTimeout(500);
  // Tapping outside closes without adding
  await page.tap(HOY+' .fab'); await page.waitForTimeout(450); await page.type('#sheet .titlein','No se guarda'); await page.tap('#scrim', {position:{x:195,y:80}}); await page.waitForTimeout(500);
  /* decision 28b (changed on purpose): with text typed, the tap outside asks first; Descartar tarea closes without adding */ await page.tap('#asheet .it.red'); await page.waitForTimeout(450);
  r.outside = await page.evaluate(()=>({ on:document.querySelector('#sheet').classList.contains('on'), saved:DB.tasks.some(x=>x.title==='No se guarda') }));
  check('R5_tapOutsideCancels', !r.outside.on && !r.outside.saved, r.outside);

  /* ---------- R6 second step: note items in the detail ---------- */
  const tid = await page.evaluate(()=>{ const x=addTask({title:'Comité', projectId:'p-flc', date:todayStr(), notes:'Puntos\n- Llamar a Pepe mañana\n* Enviar acta\n[ ] Revisar SOW\n- [x] Hecho ya'}); render(); return x.id; });
  await page.evaluate(id=>openDetail(id), tid); await page.waitForTimeout(500);
  r.conv = await page.$eval('.pushed-screen .convert', e=>e.textContent).catch(()=>null);
  check('R6_convertLink', r.conv==='Convertir 3 líneas en tareas', r.conv);
  await page.screenshot({path:path.join(OUT,'b-light-detail-convert.png')});
  const n0 = await page.evaluate(()=>DB.tasks.length);
  await page.tap('.pushed-screen .convert'); await page.waitForTimeout(400);
  r.converted = await page.evaluate(([n,id])=>({ made:DB.tasks.slice(n).map(x=>[x.title,x.projectId,x.date,x.spaceId]), notes:task(id).notes, link:!!document.querySelector('.pushed-screen .convert'), toast:document.querySelector('#toastText').textContent, stack:UI.stack.length }), [n0, tid]);
  check('R6_convert', JSON.stringify(r.converted.made)===JSON.stringify([['Llamar a Pepe','p-flc',tmr,'trabajo'],['Enviar acta','p-flc',null,'trabajo'],['Revisar SOW','p-flc',null,'trabajo']]) && /- Llamar a Pepe mañana/.test(r.converted.notes) && !r.converted.link && r.converted.toast==='3 tareas creadas' && r.converted.stack===1, r.converted);
  await page.tap('#toastBtn'); await page.waitForTimeout(300);
  r.convUndo = await page.evaluate(n=>({ n:DB.tasks.length===n, link:!!document.querySelector('.pushed-screen .convert') }), n0);
  check('R6_convertUndo', r.convUndo.n && r.convUndo.link, r.convUndo);
  // Typing a new item brings the count up a moment later
  await page.$eval('.pushed-screen [data-role=notes]', e=>{ e.focus(); e.setSelectionRange(e.value.length, e.value.length); });
  await page.keyboard.type('\n☐ Otra más'); await page.waitForTimeout(600);
  r.convTyped = await page.$eval('.pushed-screen .convert', e=>e.textContent).catch(()=>null);
  check('R6_convertFollowsTyping', r.convTyped==='Convertir 4 líneas en tareas', r.convTyped);
  await page.evaluate(()=>{ document.activeElement.blur(); pop(); }); await page.waitForTimeout(500);

  /* ---------- ?add= reads the title too, and a multi-line text becomes a list ---------- */
  await page.goto(URL+'?add='+encodeURIComponent('Llamar #flc mañana a las 10')); await page.waitForTimeout(900);
  r.url = await page.evaluate(()=>({ open:document.querySelector('#sheet').classList.contains('on'), toks:[...document.querySelectorAll('#sheet .tok')].map(t=>t.dataset.tok) }));
  await page.tap('#sheet .qadd'); await page.waitForTimeout(400);
  r.urlTask = await page.evaluate(()=>{ const x=DB.tasks.find(t=>t.title==='Llamar'); return x&&[x.projectId, x.date===addDays(todayStr(),1), fmtTime(x.reminder), localDay(x.reminder)===x.date]; });
  check('R7_urlAdd', r.url.open && r.url.toks.join()==='date,time,proj' && JSON.stringify(r.urlTask)===JSON.stringify(['p-flc',true,'10:00',true]), {u:r.url, t:r.urlTask});
  await page.goto(URL+'?add='+encodeURIComponent('uno\ndos\ntres')); await page.waitForTimeout(900);
  r.urlList = await page.evaluate(()=>({ n:document.querySelectorAll('#qlist .pl').length, btn:(document.querySelector('#sheet .qadd')||{}).textContent }));
  check('R6_urlList', r.urlList.n===3 && r.urlList.btn==='Crear 3 tareas', r.urlList);
  await page.evaluate(()=>closeSheet()); await ctx.close();

  /* ---------- Mobile dark: screenshots of the sheet ---------- */
  ({ctx, page} = await open(browser, MOB('dark')));
  await page.tap(HOY+' .fab'); await page.waitForTimeout(450); await page.type('#sheet .titlein','Revisar contrato #cash viernes a las 12 !!');
  await page.tap('#sheet .qbtn[data-k=proj]'); await page.waitForTimeout(150);
  await page.screenshot({path:path.join(OUT,'b-dark-sheet.png')});
  r.darkMarks = await page.$$eval('#sheet .qhl mark', m=>m.map(x=>x.textContent));
  check('R7_darkMarks', r.darkMarks.join('|')==='#cash|viernes|a las 12|!!', r.darkMarks);
  // Overlay alignment: the tinted '#cash' sits where the field draws it (same left edge within 2 px)
  r.align = await page.evaluate(()=>{ const inp=document.querySelector('#sheet .titlein'); const m=document.querySelector('#sheet .qhl mark'); const cs=getComputedStyle(inp);
    const c=document.createElement('canvas').getContext('2d'); c.font=cs.fontSize+' '+cs.fontFamily; const w=c.measureText(inp.value.slice(0, inp.value.indexOf('#cash'))).width;
    return Math.abs((inp.getBoundingClientRect().left+parseFloat(cs.paddingLeft)+w-inp.scrollLeft) - m.getBoundingClientRect().left); });
  check('R7_overlayAligned', r.align<2.5, r.align);
  await ctx.close();

  /* ---------- Desktop ---------- */
  ({ctx, page} = await open(browser, {viewport:{width:1280,height:800}, colorScheme:'light'}));
  const AB='#desk [data-role=addbar]';
  await page.click(AB); await page.keyboard.type('Revisar SOW #fl');
  await page.keyboard.press('Tab'); await page.waitForTimeout(60);
  r.tab1 = await page.$eval(AB, e=>e.value); await page.keyboard.press('Tab'); await page.waitForTimeout(60); r.tab2 = await page.$eval(AB, e=>e.value);
  await page.keyboard.press('Tab'); await page.waitForTimeout(60); r.tab3 = await page.$eval(AB, e=>e.value);
  r.tabFocus = await page.evaluate(()=>document.activeElement.dataset.role);
  check('R7_tabCompletes', r.tab1==='Revisar SOW #FLC' && r.tab2==='Revisar SOW #FLCFase2' && r.tab3==='Revisar SOW #FLC' && r.tabFocus==='addbar', [r.tab1,r.tab2,r.tab3,r.tabFocus]);
  await page.keyboard.type(' mañana a las 9 !!'); await page.waitForTimeout(60);
  r.said = await page.$eval('#deskSaid', e=>e.textContent);
  r.deskMarks = await page.$$eval('#desk .addbar .qhl mark', m=>m.map(x=>x.textContent));
  check('R7_deskSaid', r.said==='Entendido: Mañana, proyecto FLC, prioridad media, recordatorio a las 09:00' && r.deskMarks.join('|')==='#FLC|mañana|a las 9|!!', {s:r.said, m:r.deskMarks});
  await page.screenshot({path:path.join(OUT,'b-desk-said.png')});
  await page.keyboard.press('Enter'); await page.waitForTimeout(300);
  r.deskTask = await page.evaluate(()=>{ const x=DB.tasks.find(t=>t.title==='Revisar SOW'); return x&&[x.projectId,x.priority,x.date===addDays(todayStr(),1),fmtTime(x.reminder)]; });
  r.deskAfter = await page.evaluate(()=>({ v:document.querySelector('#desk [data-role=addbar]').value, said:document.querySelector('#deskSaid').textContent, focus:document.activeElement.dataset.role }));
  check('R7_deskAdd', JSON.stringify(r.deskTask)===JSON.stringify(['p-flc','mid',true,'09:00']) && r.deskAfter.v==='' && r.deskAfter.said==='' && r.deskAfter.focus==='addbar', {t:r.deskTask, a:r.deskAfter});
  await page.keyboard.type('Algo #cas'); await page.waitForTimeout(60);
  r.deskAmb = await page.$eval('#deskSaid', e=>e.textContent);
  check('R7_deskAmbiguous', r.deskAmb==='#cas coincide con Casa y Cash Application. No se asigna proyecto.', r.deskAmb);
  await page.fill(AB, ''); await page.waitForTimeout(60);
  // Without a written date, Hoy gives today (as before)
  await page.keyboard.type('Sin fecha escrita'); await page.keyboard.press('Enter'); await page.waitForTimeout(250);
  r.deskToday = await page.evaluate(()=>{ const x=DB.tasks.find(t=>t.title==='Sin fecha escrita'); return x&&x.date===todayStr(); });
  check('R7_deskHoyDefault', r.deskToday===true, r.deskToday);
  // R6 on the desktop: the pasted list waits under the bar
  const nd = await page.evaluate(()=>DB.tasks.length);
  await paste(page, AB, '1. Primera\n2. Segunda viernes\n3. Tercera #formacion'); await page.waitForTimeout(250);
  r.box = await page.evaluate(()=>({ rows:[...document.querySelectorAll('#desk .pastebox .pl')].map(p=>p.querySelector('.t').textContent+' | '+p.querySelector('.m').textContent), btn:(document.querySelector('#desk .pastebox [data-paste=ok]')||{}).textContent, focus:document.activeElement.dataset.role }));
  check('R6_deskBox', r.box.rows.length===3 && r.box.btn==='Crear 3 tareas' && r.box.focus==='addbar' && /^Tercera \| Hoy, Formación del equipo$/.test(r.box.rows[2]), r.box);
  await page.screenshot({path:path.join(OUT,'b-desk-paste.png')});
  await page.click('#desk .pastebox [data-paste=ok]'); await page.waitForTimeout(400);
  r.deskMade = await page.evaluate(n=>({ made:DB.tasks.slice(n).map(x=>[x.title, x.date===todayStr()?'today':x.date, x.projectId]), box:!!document.querySelector('#desk .pastebox'), toast:document.querySelector('#toastText').textContent }), nd);
  const fri = P.friday;
  check('R6_deskCreate', JSON.stringify(r.deskMade.made)===JSON.stringify([['Primera','today',null],['Segunda',fri,null],['Tercera','today','p-form']]) && !r.deskMade.box && r.deskMade.toast==='3 tareas creadas', r.deskMade);
  await page.click('#toastBtn'); await page.waitForTimeout(300);
  check('R6_deskUndo', await page.evaluate(n=>DB.tasks.length===n, nd));
  // Detail pane: the convert link works there too
  const did = await page.evaluate(()=>{ const x=addTask({title:'Notas con puntos', date:todayStr(), notes:'- uno\n- dos'}); render(); openDetail(x.id); return x.id; }); await page.waitForTimeout(400);
  const nd2 = await page.evaluate(()=>DB.tasks.length);
  await page.click('#desk .convert'); await page.waitForTimeout(300);
  r.deskConv = await page.evaluate(n=>DB.tasks.slice(n).map(x=>x.title+'|'+x.spaceId), nd2);
  check('R6_deskConvert', r.deskConv.join()==='uno|trabajo,dos|trabajo', r.deskConv);
  await ctx.close();

  /* ---------- Desktop: the same sheet as a centred window (Añadir from a week day) ---------- */
  ({ctx, page} = await open(browser, {viewport:{width:1280,height:800}, colorScheme:'light'}));
  await page.evaluate(()=>addSheet(null,'',{date:addDays(todayStr(),2)})); await page.waitForTimeout(400);
  await page.keyboard.type('Preparar #casa a las 17'); await page.click('#sheet .qbtn[data-k=pri]'); await page.waitForTimeout(100);
  r.deskSheet = await page.evaluate(()=>({ focus:document.activeElement===document.querySelector('#sheet .titlein'), toks:[...document.querySelectorAll('#sheet .tok')].map(t=>t.dataset.tok) }));
  check('R5_deskSheet', r.deskSheet.focus && r.deskSheet.toks.join()==='date,time,proj', r.deskSheet);
  await page.screenshot({path:path.join(OUT,'b-desk-sheet.png')});
  await page.click('#qstrip [data-pr=high]'); await page.keyboard.press('Enter'); await page.waitForTimeout(200);
  r.deskSheetTask = await page.evaluate(()=>{ const x=DB.tasks.find(t=>t.title==='Preparar'); return x&&[x.projectId, x.priority, x.date===addDays(todayStr(),2), fmtTime(x.reminder), localDay(x.reminder)===x.date]; });
  check('R5_deskSheetAdd', JSON.stringify(r.deskSheetTask)===JSON.stringify(['p-casa','high',true,'17:00',true]), r.deskSheetTask);
  await ctx.close();

  /* ---------- Desktop dark screenshot ---------- */
  ({ctx, page} = await open(browser, {viewport:{width:1280,height:800}, colorScheme:'dark'}));
  await page.click(AB); await page.keyboard.type('Preparar comité #flc viernes !!!'); await page.waitForTimeout(80);
  await page.screenshot({path:path.join(OUT,'b-desk-dark.png')}); await ctx.close();

  r.errors = errors; if(errors.length) fails.push('pageErrors');
  r.fails = fails;
  console.log(JSON.stringify(r,null,1));
  await browser.close(); srv.close();
  process.exit(fails.length?1:0);
})().catch(e=>{ console.error(e); console.log(JSON.stringify({r, fails, errors},null,1)); process.exit(1); });
