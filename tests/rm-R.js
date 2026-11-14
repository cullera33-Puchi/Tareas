require('./lib/out.js'); const { openSetting, closeSetting } = require('./lib/settings.js'); // v0.37.4: Ajustes in subscreens on the iPhone // outputs (screenshots, downloads) go to tests/out
// Decisions 31 to 34 (2 November), port 9920.
//  31. The desktop add bar opens into a composer: notes, Fecha, Proyecto, Prioridad, Recordatorio and Nota de voz (a stand-in recognizer, and the
//      written fallback); title words still count and show on the buttons, a button chosen by hand takes its word out; Intro adds everything,
//      Mayúsculas e Intro is a new line in the notes; adding in series keeps the date and project chosen by hand; Esc asks with a Mac alert.
//  32. The desktop time picker: typed times, half hours from 7:00 to 22:00 scrolled to the chosen one, chips, arrows of 15 minutes, Intro saves;
//      the iPhone keeps the native field.
//  33. 16 project colours in two rows of eight on the iPhone and the desktop; every tag above 4.4:1 in both themes; old colours kept.
//  35. Solo de lunes a viernes per space in the desktop calendar (Semana, Horas, Día, Mes, the Fin de semana column and its drops, the remap).
//  36. Rows dragged between the day and project groups of the desktop lists (dates, Sin fecha, reminders, Deshacer, selection, Hoy, refused groups).
//  34. Local copies deleted one by one (iPhone swipe and menu, desktop right click and hover bin, always confirmed, no Deshacer) and all at once.
const { chromium } = require('playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = path.resolve(__dirname, '..'), PORT = 9920, URL0 = 'http://localhost:'+PORT+'/';
const OUT = path.join(__dirname, 'out', 'R'); fs.mkdirSync(OUT, {recursive:true});
const TYPES = {'.html':'text/html','.css':'text/css','.js':'application/javascript','.webmanifest':'application/manifest+json','.png':'image/png'};
const srv = http.createServer((req,res)=>{ let p = decodeURIComponent(req.url.split('?')[0]); if(p==='/') p='/index.html';
  if(p==='/config.js'){ res.writeHead(200,{'Content-Type':'application/javascript'}); res.end('window.TAREAS_CONFIG = {"url":null,"anonKey":null};\n'); return; }
  const f=path.join(ROOT,p); if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){ res.writeHead(404); res.end(); return; }
  res.writeHead(200,{'Content-Type':TYPES[path.extname(f)]||'application/octet-stream'}); res.end(fs.readFileSync(f)); });
const r={}, fails=[], errors=[]; const check=(name, ok, info)=>{ r[name]=ok?true:(info===undefined?false:info); if(!ok) fails.push(name); };
const today=(()=>{ const d=new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); })();
const T0='2026-11-01T10:00:00.000Z';
const SEED = { spaces:[{id:'trabajo',name:'Trabajo',order:0,created:T0},{id:'personal',name:'Personal',order:1,created:T0}],
  projects:[{id:'p-flc',spaceId:'trabajo',name:'FLC',color:'#007AFF',order:0,archived:false,created:T0,modified:T0},{id:'p-casa',spaceId:'trabajo',name:'Casa',color:'#5856D6',order:1,archived:false,created:T0,modified:T0}],
  tasks:[{id:'t1',title:'Uno',spaceId:'trabajo',projectId:null,date:today,reminder:null,priority:'none',status:'pending',notes:'',carried:false,created:T0,modified:T0,completed:null}], voiceNotes:[], settings:{tipsSeen:true} };
// A stand-in for the browser's recognizer: it hears one sentence shortly after it starts
function fakeSR(){ window.__srStarts=0; window.SpeechRecognition = window.webkitSpeechRecognition = class { start(){ window.__srStarts++; this._t=setTimeout(()=>{ const res=[[{transcript:'llamar a Pedro'}]]; res[0].isFinal=true; this.onresult&&this.onresult({resultIndex:0, results:res}); }, 120); } stop(){ clearTimeout(this._t); } }; }
async function open(browser, o){
  const vp = o.desk ? {viewport:{width:1280,height:800}, deviceScaleFactor:1} : {viewport:{width:390,height:844}, deviceScaleFactor:2, isMobile:true, hasTouch:true};
  const ctx = await browser.newContext(Object.assign(vp, {colorScheme:o.dark?'dark':'light'})); const page = await ctx.newPage();
  // Today at 10:00 local: from 18:30 the add bar of Hoy proposes tomorrow (the evening rule), which these checks are not about
  await page.clock.install({time:(()=>{ const d=new Date(); d.setHours(10,0,0,0); return d; })()});
  page.on('pageerror', e=>errors.push((o.tag||'')+' pageerror: '+e.message)); page.on('console', m=>{ if(m.type()==='error') errors.push((o.tag||'')+' console: '+m.text()); });
  if(o.sr) await page.addInitScript(fakeSR);
  await page.addInitScript(s=>{ if(!localStorage.getItem('tareas-v1')) localStorage.setItem('tareas-v1', s); }, JSON.stringify(o.seed||SEED));
  await page.goto(URL0); await page.waitForTimeout(600); return {ctx, page, cdp:o.desk?null:await ctx.newCDPSession(page)};
}
const AB='#desk [data-role=addbar]';
const btns = page => page.evaluate(()=>Object.fromEntries([...document.querySelectorAll('#desk .axbt')].map(b=>[b.dataset.ax, {t:b.textContent, on:b.classList.contains('on'), c:b.className}])));
const last = page => page.evaluate(()=>{ const x=DB.tasks[DB.tasks.length-1]; return Object.assign({}, x, {vn:DB.voiceNotes.filter(v=>v.taskId===x.id).map(v=>v.text)}); });
const addD=(s,n)=>{ const d=new Date(s+'T12:00:00'); d.setDate(d.getDate()+n); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); };

// Owner feedback (v0.19.0): in Adjuntos, Añadir foto and Grabar audio start at the same place (icon and text), iPhone and desktop, both themes
async function attAlign(page, sel){ return page.evaluate(sel=>{ const g=document.querySelector(sel+' .att-group'); const [a,b]=['attPhoto','attAudio'].map(k=>g.querySelector('[data-act='+k+']'));
  const L=e=>Math.round(e.getBoundingClientRect().left*10)/10; return {icon:[L(a.querySelector('svg')), L(b.querySelector('svg'))], text:[L(a.querySelector('.lbl')), L(b.querySelector('.lbl'))]}; }, sel); }
const aligned = o => Math.abs(o.icon[0]-o.icon[1])<=1 && Math.abs(o.text[0]-o.text[1])<=1;
(async()=>{
  await new Promise(res=>srv.listen(PORT,res)); const browser = await chromium.launch();
  try{
  /* ======================= 31. The composer ======================= */
  let {ctx, page} = await open(browser, {desk:true, sr:true, tag:'D'});
  check('ax_closed_at_start', await page.evaluate(()=>!AX.open && !document.querySelector('#desk .axp')));
  await page.click(AB); await page.keyboard.type('Comprar'); await page.waitForTimeout(350);
  const op = await page.evaluate(()=>({open:AX.open, panel:!!document.querySelector('#desk .axp'), focus:document.activeElement.dataset.role, v:document.querySelector('#desk [data-role=addbar]').value, anim:(document.querySelector('#desk .axp').getAnimations?document.querySelector('#desk .axp').getAnimations().length:1)>=0, notes:!!document.querySelector('#desk [data-role=addnotes]')}));
  check('ax_opens_on_typing', op.open && op.panel && op.focus==='addbar' && op.v==='Comprar' && op.notes, op);
  let b = await btns(page);
  check('ax_buttons', Object.keys(b).join()==='date,proj,pri,est,rem,voice' && /* decision 56: Tiempo */ b.voice.t==='Dictar' && b.date.t==='Hoy' && b.date.on && b.proj.t==='Proyecto' && !b.proj.on && b.pri.t==='Prioridad' && b.rem.t==='Recordatorio', b);
  await page.keyboard.type(' mañana #flc !!! a las 10'); await page.waitForTimeout(200);
  b = await btns(page);
  check('ax_tokens_on_buttons', b.date.t==='Mañana' && b.proj.t==='FLC' && b.proj.on && b.pri.t==='Alta' && /high/.test(b.pri.c) && b.rem.t==='10:00' && b.rem.on, b);
  // Proyecto by hand: the written #flc leaves the title
  await page.click('#desk .axbt[data-ax=proj]'); await page.waitForTimeout(300);
  await page.evaluate(()=>{ const it=[...document.querySelectorAll('#pmenu .pm-it')].find(x=>x.textContent.includes('Casa')); it.click(); }); await page.waitForTimeout(300);
  const pj = await page.evaluate(()=>({v:document.querySelector('#desk [data-role=addbar]').value, focus:document.activeElement.dataset.role, ax:AX.projectId}));
  b = await btns(page);
  check('ax_pick_project_strips', pj.v==='Comprar mañana !!! a las 10' && pj.ax==='p-casa' && b.proj.t==='Casa' && pj.focus==='addbar', {pj, b});
  await page.screenshot({path:path.join(OUT,'r-desk-composer.png')});
  // Notes: Mayúsculas e Intro is a new line; decision 49: the microphone dictates into Notas, after what is there
  await page.click('#desk [data-role=addnotes]'); await page.keyboard.type('Primera línea'); await page.keyboard.press('Shift+Enter'); await page.keyboard.type('Segunda línea');
  await page.click('#desk .axbt[data-ax=voice]'); await page.waitForTimeout(400);
  const vo = await page.evaluate(()=>({rec:!!AX.rec, starts:window.__srStarts, v:document.querySelector('#desk [data-role=addnotes]').value, addvoice:!!document.querySelector('#desk [data-role=addvoice]'), ph:document.querySelector('#desk [data-role=addnotes]').placeholder, btn:document.querySelector('#desk .axbt[data-ax=voice]').className}));
  check('ax_dictation', vo.rec && vo.starts===1 && vo.v==='Primera línea\nSegunda línea llamar a Pedro' && !vo.addvoice && /^Escuchando/.test(vo.ph) && /rec/.test(vo.btn), vo);
  await page.screenshot({path:path.join(OUT,'r-desk-composer-voice.png')});
  await page.click('#desk .axbt[data-ax=voice]'); await page.waitForTimeout(200);
  check('ax_dictation_stops', await page.evaluate(()=>!AX.rec && AX.notes==='Primera línea\nSegunda línea llamar a Pedro' && document.querySelector('#desk .axbt[data-ax=voice]').textContent==='Dictar'));
  await page.click('#desk [data-role=addnotes]'); await page.keyboard.press('End'); await page.keyboard.press('Enter'); await page.waitForTimeout(400);
  let x = await last(page);
  check('ax_enter_in_notes_adds_all', x.title==='Comprar' && x.date===addD(today,1) && x.projectId==='p-casa' && x.priority==='high' && x.reminder && new Date(x.reminder).getHours()===10 && x.notes==='Primera línea\nSegunda línea llamar a Pedro' && !x.vn.length && await page.evaluate(()=>DB.voiceNotes.length===0), x);
  const after = await page.evaluate(()=>({open:AX.open, v:document.querySelector('#desk [data-role=addbar]').value, notes:document.querySelector('#desk [data-role=addnotes]').value, voice:!!document.querySelector('#desk [data-role=addvoice]'), focus:document.activeElement.dataset.role, toast:document.querySelector('#toastText').textContent}));
  b = await btns(page);
  check('ax_series_ready', after.open && after.v==='' && after.notes==='' && !after.voice && after.focus==='addbar' && after.toast==='Añadida para mañana: Comprar' /* written «mañana» from Hoy: not in the list, the toast says where it went */ && b.proj.t==='Casa' && b.date.t==='Hoy' && b.pri.t==='Prioridad' && b.rem.t==='Recordatorio', {after, b}); // the project chosen by hand stays; the written date does not
  // Fecha by hand, then two in a row with it
  await page.click('#desk .axbt[data-ax=date]'); await page.waitForTimeout(300);
  await page.click('#pmenu .pm-pop [data-d="'+addD(today,3)+'"]').catch(async()=>{ await page.evaluate(d=>{ const c=document.querySelector('#pmenu .pm-pop [data-d="'+d+'"]'); c&&c.click(); }, addD(today,3)); }); await page.waitForTimeout(300);
  await page.keyboard.type('Serie uno'); await page.keyboard.press('Enter'); await page.waitForTimeout(300);
  const s1 = await last(page);
  await page.keyboard.type('Serie dos'); await page.keyboard.press('Enter'); await page.waitForTimeout(300);
  const s2 = await last(page);
  check('ax_series_date_project', s1.title==='Serie uno' && s1.date===addD(today,3) && s1.projectId==='p-casa' && s2.title==='Serie dos' && s2.date===addD(today,3) && s2.projectId==='p-casa' && !s2.notes && !s2.vn.length, {s1, s2});
  // Recordatorio by hand, with the time picker: 1830 and Intro
  await page.keyboard.type('Con hora'); await page.click('#desk .axbt[data-ax=rem]'); await page.waitForTimeout(350);
  check('ax_rem_popover', await page.evaluate(()=>!!document.querySelector('#pmenu .pm-pop .tpk') && document.activeElement.classList.contains('tpk-in')));
  await page.keyboard.type('1830'); await page.keyboard.press('Enter'); await page.waitForTimeout(300);
  b = await btns(page); check('ax_rem_set', b.rem.t==='18:30' && b.rem.on && await page.evaluate(()=>AX.time&&AX.time.h===18&&AX.time.m===30&&document.activeElement.dataset.role==='addbar'), b);
  await page.click('#desk .axadd'); await page.waitForTimeout(300); x = await last(page);
  check('ax_add_button', x.title==='Con hora' && x.date===addD(today,3) && new Date(x.reminder).getHours()===18 && new Date(x.reminder).getMinutes()===30, x);
  // Prioridad by hand takes the written !! out
  await page.keyboard.type('Pri !!'); await page.click('#desk .axbt[data-ax=pri]'); await page.waitForTimeout(300);
  await page.evaluate(()=>{ const it=[...document.querySelectorAll('#pmenu .pm-it')].find(x=>x.textContent.includes('Alta')); it.click(); }); await page.waitForTimeout(300);
  check('ax_pick_priority_strips', await page.evaluate(()=>document.querySelector('#desk [data-role=addbar]').value==='Pri' && AX.priority==='high'), await page.evaluate(()=>({v:document.querySelector('#desk [data-role=addbar]').value, p:AX.priority, open:AX.open, last:DB.tasks[DB.tasks.length-1].title, menu:menuOpen()})));
  // Esc with something written asks (a Mac alert); Seguir editando keeps it, Descartar tarea folds it
  await page.click(AB); await page.keyboard.press('Escape'); await page.waitForTimeout(350);
  const al = await page.evaluate(()=>({on:alertOn(), t:(document.querySelector('#asheet .al-t')||{}).textContent, b:[...document.querySelectorAll('#asheet .al-btn')].map(x=>x.textContent)}));
  check('ax_esc_asks', al.on && al.t==='La tarea no se ha añadido.' && al.b.join('|')==='Seguir editando|Descartar tarea', al);
  await page.screenshot({path:path.join(OUT,'r-desk-esc-alert.png')});
  await page.click('#asheet .al-btn[data-i="-1"]'); await page.waitForTimeout(350);
  check('ax_keep_editing', await page.evaluate(()=>AX.open && document.querySelector('#desk [data-role=addbar]').value==='Pri' && !alertOn()));
  await page.click(AB); await page.keyboard.press('Escape'); await page.waitForTimeout(300); await page.click('#asheet .al-btn.def'); await page.waitForTimeout(500);
  check('ax_discarded', await page.evaluate(()=>!AX.open && !document.querySelector('#desk .axp') && document.querySelector('#desk [data-role=addbar]').value==='' && AX.date===undefined && AX.projectId===undefined && DB.tasks.every(t=>t.title!=='Pri')));
  // Esc with nothing written folds it at once; a blur with nothing written too
  await page.click(AB); await page.keyboard.type('x'); await page.waitForTimeout(250); await page.keyboard.press('Backspace'); await page.keyboard.press('Escape'); await page.waitForTimeout(400);
  check('ax_esc_empty', await page.evaluate(()=>!AX.open && !alertOn()));
  await page.click(AB); await page.keyboard.type('y'); await page.waitForTimeout(250); await page.keyboard.press('Backspace'); await page.mouse.click(600, 600); await page.waitForTimeout(500);
  check('ax_blur_empty_folds', await page.evaluate(()=>!AX.open));
  // Without a recognizer: no Dictar button, Notas is written by hand
  await page.evaluate(()=>{ delete window.webkitSpeechRecognition; delete window.SpeechRecognition; });
  await page.click(AB); await page.keyboard.type('Sin dictado'); await page.waitForTimeout(250);
  const fb = await page.evaluate(()=>({btn:!!document.querySelector('#desk .axbt[data-ax=voice]'), rec:!!AX.rec}));
  await page.click('#desk [data-role=addnotes]'); await page.keyboard.type('nota escrita'); await page.keyboard.press('Enter'); await page.waitForTimeout(300); x = await last(page);
  check('ax_voice_written', !fb.btn && !fb.rec && x.title==='Sin dictado' && x.notes==='nota escrita' && !x.vn.length, {fb, x});
  check('ax_logged', await page.evaluate(()=>LOG.some(e=>e.m==='Alta ampliada abierta') && LOG.some(e=>e.m==='Tarea añadida desde el alta ampliada') && LOG.some(e=>e.m==='Alta ampliada descartada con texto')));
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);

  /* ======================= 32. The time picker ======================= */
  const parsed = await page.evaluate(()=>['9','930','9:30','21.15','2115','0730','9 h','24','9:75','abc',''].map(s=>{ const o=parseHM(s); return o?hmStr(o):null; }));
  check('tp_parse', parsed.join()==='09:00,09:30,09:30,21:15,21:15,07:30,09:00,,,,', parsed);
  await page.evaluate(()=>{ UI.dsel.cur='t1'; openDetail('t1'); }); await page.waitForTimeout(400);
  { const a=await attAlign(page, '#desk .pane'); check('att_align_desk_light', aligned(a), a); }
  await page.click('#desk .pane [data-act=pickReminder]'); await page.waitForTimeout(400);
  const tp0 = await page.evaluate(()=>({tpk:!!document.querySelector('#pmenu .pm-pop .tpk'), native:!!document.querySelector('#pmenu input[type=time]'), v:document.querySelector('.tpk-in').value,
    opts:[...document.querySelectorAll('.tpk-o')].map(b=>b.textContent), chips:[...document.querySelectorAll('.tpk-chips .chip')].map(b=>b.textContent), now:document.querySelectorAll('.tpk-o.now').length}));
  check('tp_markup', tp0.tpk && !tp0.native && tp0.v==='9:00' && tp0.opts.length===31 && tp0.opts[0]==='7:00' && tp0.opts[30]==='22:00' && tp0.chips.join()==='9:00,12:00,15:00,18:00' && tp0.now<=1, tp0);
  await page.click('.tpk-chips [data-tq="18:00"]'); await page.click('.tpk-open'); await page.waitForTimeout(200);
  const tp1 = await page.evaluate(()=>{ const l=document.querySelector('.tpk-list'), on=l.querySelector('.tpk-o.on'), lr=l.getBoundingClientRect(), orr=on.getBoundingClientRect(), pop=document.querySelector('#pmenu .pm-pop').getBoundingClientRect();
    return {open:!l.hidden, on:on.textContent, vis:orr.top>=lr.top&&orr.bottom<=lr.bottom, st:l.scrollTop, chip:document.querySelector('.tpk-chips .chip.on').textContent, inWin:pop.top>=0&&pop.bottom<=innerHeight}; });
  check('tp_list_scrolled', tp1.open && tp1.on==='18:00' && tp1.vis && tp1.st>0 && tp1.chip==='18:00' && tp1.inWin, tp1);
  await page.screenshot({path:path.join(OUT,'r-desk-timepicker.png')});
  await page.click('.tpk-o[data-tv="14:30"]'); await page.waitForTimeout(150);
  await page.focus('.tpk-in'); await page.keyboard.press('ArrowUp'); await page.keyboard.press('ArrowUp'); await page.keyboard.press('ArrowDown'); await page.waitForTimeout(100);
  const tp2 = await page.evaluate(()=>({v:document.querySelector('.tpk-in').value, list:document.querySelector('.tpk-list').hidden}));
  check('tp_option_and_arrows', tp2.v==='14:45' && tp2.list, tp2);
  await page.evaluate(d=>{ const c=document.querySelector('#pmenu .pm-pop [data-d="'+d+'"]'); c.click(); }, addD(today,2)); await page.focus('.tpk-in');
  await page.fill('.tpk-in', '21.15'); await page.keyboard.press('Enter'); await page.waitForTimeout(400);
  const rem = await page.evaluate(()=>{ const x=task('t1'); const d=new Date(x.reminder); return {day:localDay(x.reminder), h:d.getHours(), m:d.getMinutes(), menu:menuOpen()}; });
  check('tp_enter_saves', rem.day===addD(today,2) && rem.h===21 && rem.m===15 && !rem.menu, rem);
  await page.click('#desk .pane [data-act=pickReminder]'); await page.waitForTimeout(350); await page.fill('.tpk-in', '25'); await page.waitForTimeout(80);
  check('tp_bad_input', await page.evaluate(()=>document.querySelector('.tpk').classList.contains('bad')));
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  await ctx.close();
  // Dark: the picker in the reminder popover and the composer
  ({ctx, page} = await open(browser, {desk:true, dark:true, tag:'DD'}));
  await page.evaluate(()=>openDetail('t1')); await page.waitForTimeout(400);
  { const a=await attAlign(page, '#desk .pane'); check('att_align_desk_dark', aligned(a), a); await page.screenshot({path:path.join(OUT,'r-desk-adjuntos-dark.png')}); }
  await page.click('#desk .pane [data-act=pickReminder]'); await page.waitForTimeout(300); await page.click('.tpk-open'); await page.waitForTimeout(200);
  await page.screenshot({path:path.join(OUT,'r-desk-timepicker-dark.png')}); await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  await page.click(AB); await page.keyboard.type('Revisar contrato #casa mañana !!'); await page.waitForTimeout(300); await page.screenshot({path:path.join(OUT,'r-desk-composer-dark.png')});
  await ctx.close();
  // iPhone: the native time field stays
  ({ctx, page} = await open(browser, {tag:'M'}));
  await page.evaluate(()=>openDetail('t1')); await page.waitForTimeout(700);
  { const a=await attAlign(page, '.screen.pushed-screen.detail'); check('att_align_iphone_light', aligned(a), a); }
  await page.click('.screen.pushed-screen.detail [data-act=pickReminder]'); await page.waitForTimeout(600);
  check('tp_iphone_native', await page.evaluate(()=>!!document.querySelector('#sheet input[type=time]') && !document.querySelector('#sheet .tpk')));
  await page.evaluate(()=>closeSheet()); await page.waitForTimeout(600); await page.evaluate(()=>pop()); await page.waitForTimeout(700);

  /* ======================= 33. 16 colours ======================= */
  const pal = await page.evaluate(()=>COLORS.slice());
  check('col_palette', pal.length===16 && pal.join()==='#FF3B30,#FF9500,#FFCC00,#34C759,#007AFF,#AF52DE,#FF2D55,#A2845E,#00C7BE,#32ADE6,#5856D6,#8E8E93,#9B2242,#7D8A2E,#1F3A8A,#FF7A5C', pal);
  const contrast = await page.evaluate(()=>{ const rgb=s=>s.match(/\d+/g).slice(0,3).map(Number), lin=u=>{ u/=255; return u<=.03928?u/12.92:Math.pow((u+.055)/1.055,2.4); }, lum=a=>.2126*lin(a[0])+.7152*lin(a[1])+.0722*lin(a[2]);
    const ratio=(a,b)=>{ const x=lum(a), y=lum(b); return (Math.max(x,y)+.05)/(Math.min(x,y)+.05); };
    return COLORS.map(c=>{ const v=Object.fromEntries(tagVars(c).split(';').map(p=>p.split(':'))); return {c, dark:!!TAG_DARK[c], light:+ratio(rgb(v['--tagl']), rgb(v['--tagbg'])).toFixed(2), dk:+ratio(rgb(v['--tagd']), rgb(v['--tagbgd'])).toFixed(2)}; }); });
  check('col_contrast', contrast.every(o=>o.dark && o.light>=4.4 && o.dk>=4.4), contrast);
  await page.click('[data-tab=proyectos]'); await page.waitForTimeout(400);
  await page.evaluate(()=>projectSheet(null)); await page.waitForTimeout(700);
  const sw = await page.evaluate(()=>{ const bs=[...document.querySelectorAll('#sheet .colors button')], sh=document.querySelector('#sheet').getBoundingClientRect(); const tops=[...new Set(bs.map(b=>Math.round(b.getBoundingClientRect().top)))];
    return {n:bs.length, rows:tops.length, perRow:tops.map(t=>bs.filter(b=>Math.round(b.getBoundingClientRect().top)===t).length), inside:bs.every(b=>{ const q=b.getBoundingClientRect(); return q.left>=sh.left&&q.right<=sh.right; }), w:Math.round(bs[0].getBoundingClientRect().width), names:bs.map(b=>b.getAttribute('aria-label')).join(','), noScroll:document.documentElement.scrollWidth<=innerWidth}; });
  check('col_two_rows_iphone', sw.n===16 && sw.rows===2 && sw.perRow.join()==='8,8' && sw.inside && sw.w>=30 && sw.noScroll && sw.names.split(',')[12]==='Granate' && sw.names.split(',')[14]==='Azul marino', sw);
  await page.fill('#sheet .titlein', 'Obra'); await page.click('#sheet [data-col="#9B2242"]'); await page.screenshot({path:path.join(OUT,'r-iphone-colors.png')});
  await page.click('#sheet [data-x=ok]'); await page.waitForTimeout(500);
  check('col_new_project', await page.evaluate(()=>{ const p=DB.projects.find(p=>p.name==='Obra'); return p&&p.color==='#9B2242'; }));
  await page.evaluate(()=>projectSheet('p-casa')); await page.waitForTimeout(600);
  const keep = await page.evaluate(()=>({on:(document.querySelector('#sheet .colors button.on')||{}).dataset, n:document.querySelectorAll('#sheet .colors button').length}));
  await page.fill('#sheet .titlein', 'Casa nueva'); await page.click('#sheet [data-x=ok]'); await page.waitForTimeout(500);
  check('col_old_kept', keep.on && keep.on.col==='#5856D6' && keep.n===16 && await page.evaluate(()=>proj('p-casa').color==='#5856D6' && proj('p-casa').name==='Casa nueva'), keep);
  await page.evaluate(()=>{ const t=todayStr(); COLORS.forEach((c,i)=>{ const p=addProject(['Rojo','Naranja','Amarillo','Verde','Azul','Morado','Rosa','Marrón','Menta','Cian','Índigo','Gris','Granate','Oliva','Marino','Coral'][i], c); addTask({title:'Tarea '+(i+1), date:t, projectId:p.id}); }); render(); });
  await page.click('[data-tab=tareas]'); await page.waitForTimeout(500); await page.screenshot({path:path.join(OUT,'r-iphone-tags-light.png')});
  await ctx.close();
  ({ctx, page} = await open(browser, {tag:'MD', dark:true}));
  await page.evaluate(()=>openDetail('t1')); await page.waitForTimeout(700);
  { const a=await attAlign(page, '.screen.pushed-screen.detail'); check('att_align_iphone_dark', aligned(a), a); }
  await page.evaluate(()=>pop()); await page.waitForTimeout(700);
  await page.evaluate(()=>{ const t=todayStr(); COLORS.forEach((c,i)=>{ const p=addProject('Color '+(i+1), c); addTask({title:'Tarea '+(i+1), date:t, projectId:p.id}); }); render(); }); await page.waitForTimeout(400);
  await page.screenshot({path:path.join(OUT,'r-iphone-tags-dark.png')});
  await page.click('[data-tab=proyectos]'); await page.waitForTimeout(300); await page.evaluate(()=>projectSheet(null)); await page.waitForTimeout(700); await page.screenshot({path:path.join(OUT,'r-iphone-colors-dark.png')});
  await ctx.close();
  ({ctx, page} = await open(browser, {desk:true, tag:'DC'}));
  await page.evaluate(()=>projectSheet(null)); await page.waitForTimeout(500);
  const swd = await page.evaluate(()=>{ const bs=[...document.querySelectorAll('#sheet .colors button')]; const tops=[...new Set(bs.map(b=>Math.round(b.getBoundingClientRect().top)))]; return {n:bs.length, rows:tops.length}; });
  check('col_two_rows_desktop', swd.n===16 && swd.rows===2, swd);
  await page.screenshot({path:path.join(OUT,'r-desk-colors.png')}); await page.evaluate(()=>closeSheet()); await page.waitForTimeout(400);


  /* ======================= 35. Solo de lunes a viernes, per space (desktop calendar) ======================= */
  { const NOW=new Date(2026,10,4,10,0); // Wednesday 4 November 2026
    const tt=(id,title,date,o)=>Object.assign({id,title,spaceId:'trabajo',projectId:null,date,reminder:null,priority:'none',status:'pending',notes:'',carried:false,created:T0,modified:T0,completed:null}, o||{});
    const seed=Object.assign({}, SEED, {tasks:[tt('w1','Miércoles','2026-11-04'), tt('w2','Sábado','2026-11-07'), tt('w3','Domingo','2026-11-08'), tt('w4','Lunes','2026-11-09', {reminder:new Date(2026,10,9,10,0).toISOString()}), tt('w5','Personal sábado','2026-11-07',{spaceId:'personal'})]});
    const c2 = await browser.newContext({viewport:{width:1280,height:800}}); const pg = await c2.newPage(); await pg.clock.install({time:NOW});
    pg.on('pageerror', e=>errors.push('W pageerror: '+e.message)); pg.on('console', m=>{ if(m.type()==='error') errors.push('W console: '+m.text()); });
    await pg.addInitScript(s=>{ if(!localStorage.getItem('tareas-v1')) localStorage.setItem('tareas-v1', s); }, JSON.stringify(seed)); await pg.goto(URL0); await pg.waitForTimeout(600);
    const wk = () => pg.evaluate(()=>({days:[...document.querySelectorAll('#desk .wday, #desk .hcol')].map(e=>e.dataset.day||e.dataset.hday), wkd:[...document.querySelectorAll('#desk .wwkd .wkd')].map(e=>e.dataset.day+':'+[...e.querySelectorAll('.wcard')].map(c=>c.dataset.id).join('+')), label:(document.querySelector('#desk .wmode .l')||{}).textContent, on:workWeekOn()}));
    await pg.evaluate(()=>setDeskView('week')); await pg.waitForTimeout(400);
    let w = await wk();
    check('ww_default_trabajo', w.on && w.label==='Cinco días laborables' && w.days.join()==='2026-11-04,2026-11-05,2026-11-06,2026-11-09,2026-11-10', w);
    check('ww_weekend_column', w.wkd.join()==='2026-11-07:w2,2026-11-08:w3', w.wkd);
    await pg.screenshot({path:path.join(OUT,'r-desk-workweek.png')});
    await pg.dragAndDrop('#desk .wday[data-day="2026-11-04"] .wcard[data-id=w1]', '#desk .wkd[data-day="2026-11-08"]'); await pg.waitForTimeout(500);
    check('ww_drop_weekend', await pg.evaluate(()=>task('w1').date==='2026-11-08' && !!document.querySelector('#desk .wkd[data-day="2026-11-08"] .wcard[data-id=w1]')));
    await pg.evaluate(()=>{ updTask('w1',{date:'2026-11-04'}); setWeekMode('monday'); }); await pg.waitForTimeout(300); w = await wk();
    check('ww_monday_to_friday', w.label==='De lunes a viernes' && w.days.join()==='2026-11-02,2026-11-03,2026-11-04,2026-11-05,2026-11-06' && w.wkd.join()==='2026-11-07:w2,2026-11-08:w3', w);
    await pg.evaluate(()=>{ DB.settings.calMode='hours'; save(); render(); }); await pg.waitForTimeout(300); w = await wk();
    check('ww_hours', w.days.length===5 && w.wkd.length===2, w);
    await pg.screenshot({path:path.join(OUT,'r-desk-workweek-hours.png')});
    await pg.click('#desk [data-week="1"]'); await pg.waitForTimeout(300); w = await wk();
    check('ww_next_week', w.days.join()==='2026-11-09,2026-11-10,2026-11-11,2026-11-12,2026-11-13' && w.wkd.length===0, w); // no weekend task that week: no column
    await pg.evaluate(()=>{ DB.settings.calMode='list'; save(); UI.calDay='2026-11-06'; setDeskView('day'); }); await pg.waitForTimeout(300);
    await pg.click('#desk [data-week="1"]'); await pg.waitForTimeout(200); const d1 = await pg.evaluate(()=>UI.calDay);
    await pg.click('#desk [data-week="-1"]'); await pg.waitForTimeout(200); const d2 = await pg.evaluate(()=>UI.calDay);
    check('ww_day_skips_weekend', d1==='2026-11-09' && d2==='2026-11-06', {d1, d2});
    await pg.evaluate(()=>setDeskView('month')); await pg.waitForTimeout(400);
    const mo = await pg.evaluate(()=>({dow:[...document.querySelectorAll('#desk .mdow span')].map(s=>s.textContent), cells:document.querySelectorAll('#desk .mgrid .mday').length, wk:document.querySelectorAll('#desk .mgrid .mwk').length,
      sat:[...document.querySelectorAll('#desk .mwk[data-day="2026-11-07"] .wcard')].map(c=>c.dataset.id), mini:document.querySelectorAll('#desk .minical .cal-dow').length, label:document.querySelector('#desk .wmode .l').textContent}));
    check('ww_month', mo.dow.join()==='Lun,Mar,Mié,Jue,Vie,Fin de semana' && mo.cells===30 && mo.wk===12 && mo.sat.join()==='w2' && mo.label==='De lunes a viernes', mo);
    check('ww_mini_month_full', mo.mini===7, mo.mini);
    await pg.screenshot({path:path.join(OUT,'r-desk-workweek-month.png')});
    await pg.dragAndDrop('#desk .mday[data-day="2026-11-04"] .wcard[data-id=w1]', '#desk .mwk[data-day="2026-11-07"]'); await pg.waitForTimeout(500);
    check('ww_month_drop', await pg.evaluate(()=>task('w1').date==='2026-11-07'));
    // Off from the menu: the whole week again, kept for this space only
    await pg.evaluate(()=>setDeskView('week')); await pg.waitForTimeout(300); await pg.click('#desk .wmode'); await pg.waitForTimeout(300);
    const mi = await pg.evaluate(()=>[...document.querySelectorAll('#pmenu .pm-it')].map(x=>x.textContent.trim()+(x.getAttribute('aria-checked')==='true'?'*':'')));
    check('ww_menu', mi.join('|')==='Cinco días laborables desde hoy|De lunes a viernes*|Solo de lunes a viernes*', mi);
    await pg.evaluate(()=>{ [...document.querySelectorAll('#pmenu .pm-it')].find(x=>x.textContent.includes('Solo de lunes')).click(); }); await pg.waitForTimeout(300); w = await wk();
    check('ww_off', !w.on && w.days.length===7 && w.wkd.length===0 && w.label==='De lunes a domingo' && await pg.evaluate(()=>DB.settings.workWeek.trabajo===false), w);
    await pg.evaluate(()=>{ DB.settings.activeSpace='personal'; save(); render(); }); await pg.waitForTimeout(300); w = await wk();
    check('ww_personal_default_off', !w.on && w.days.length===7, w);
    await pg.evaluate(()=>{ UI.weekStart=null; setWorkWeek(true); }); await pg.waitForTimeout(300); w = await wk();
    check('ww_personal_on', w.on && w.days.length===5 && w.wkd.join()==='2026-11-07:w5,2026-11-08:' && await pg.evaluate(()=>DB.settings.workWeek.personal===true && DB.settings.workWeek.trabajo===false), w);
    // The first sync gives Trabajo a new id: its choice goes with it
    const rm = await pg.evaluate(()=>{ const W={spaces:DB.spaces.map(x=>Object.assign({},x)), projects:[], tasks:[], voiceNotes:[], attachments:[], settings:Object.assign({}, DB.settings)}; const out=syncRemapSpaces(W, null); const nid=out.find(o=>o.from==='trabajo').to;
      return {nid, v:W.settings.workWeek[nid], old:'trabajo' in W.settings.workWeek, dbKept:DB.settings.workWeek.trabajo===false}; });
    check('ww_remap', rm.v===false && !rm.old && rm.dbKept && rm.nid!=='trabajo', rm);
    await c2.close(); }

  /* ======================= 36. Dragging rows between the groups of a desktop list ======================= */
  { const NOW=new Date(2026,10,4,10,0), T='2026-11-04', TM='2026-11-05';
    const tt=(id,title,date,o)=>Object.assign({id,title,spaceId:'trabajo',projectId:'p-oca',date,reminder:null,priority:'none',status:'pending',notes:'',carried:false,created:T0,modified:T0,completed:null}, o||{});
    const seed=Object.assign({}, SEED, {projects:SEED.projects.concat([{id:'p-oca',spaceId:'trabajo',name:'OCA',color:'#FF9500',order:2,archived:false,created:T0,modified:T0}]),
      tasks:[tt('o1','Hoy con aviso',T,{reminder:new Date(2026,10,4,16,0).toISOString()}), tt('o2','Para mañana',TM), tt('o3','El viernes','2026-11-06'), tt('o4','Sin fecha',null), tt('o5','En diciembre','2026-12-10'),
        tt('c1','Aplazada',T,{carried:true, projectId:null}), tt('h1','De hoy',T,{projectId:null}), tt('f1','De FLC',TM,{projectId:'p-flc'})]});
    const c3 = await browser.newContext({viewport:{width:1280,height:800}}); const pg = await c3.newPage(); await pg.clock.install({time:NOW});
    pg.on('pageerror', e=>errors.push('G pageerror: '+e.message)); pg.on('console', m=>{ if(m.type()==='error') errors.push('G console: '+m.text()); });
    await pg.addInitScript(s=>{ if(!localStorage.getItem('tareas-v1')) localStorage.setItem('tareas-v1', s); }, JSON.stringify(seed)); await pg.goto(URL0); await pg.waitForTimeout(600);
    await pg.evaluate(()=>setDeskView('project:p-oca')); await pg.waitForTimeout(400);
    const zones = await pg.evaluate(()=>[...document.querySelectorAll('#desk .main .gsec')].map(g=>(g.dataset.gday===undefined?'-':g.dataset.gday||'none')+':'+g.querySelector('.gl').firstChild.textContent));
    check('dg_zones', zones.join('|')==='2026-11-04:Hoy|2026-11-05:Mañana|2026-11-06:Viernes 6 nov|-:Diciembre|none:Sin fecha', zones);
    // A drag over another day group is allowed and lights the group; over its own group or a month it is not
    const probe = await pg.evaluate(()=>{ const row=document.querySelector('#desk .row[data-id=o1]'), dt=new DataTransfer(); row.dispatchEvent(new DragEvent('dragstart',{dataTransfer:dt, bubbles:true, cancelable:true}));
      const over=el=>{ const ev=new DragEvent('dragover',{dataTransfer:dt, bubbles:true, cancelable:true, clientX:10, clientY:10}); el.dispatchEvent(ev); return ev.defaultPrevented; };
      const tm=document.querySelector('#desk .gsec[data-gday="2026-11-05"]'), ok=over(tm.querySelector('.row')), litNow=tm.classList.contains('over'), headOk=over(tm.querySelector('.group-title'));
      const own=over(document.querySelector('#desk .gsec[data-gday="2026-11-04"] .row')), month=over([...document.querySelectorAll('#desk .gsec')].find(g=>g.dataset.gday===undefined).querySelector('.row'));
      row.dispatchEvent(new DragEvent('dragend',{dataTransfer:dt, bubbles:true})); return {ok, headOk, litNow, own, month, cleared:!document.querySelector('#desk .over')}; });
    check('dg_allowed_and_lit', probe.ok && probe.headOk && probe.litNow && !probe.own && !probe.month && probe.cleared, probe);
    await pg.dragAndDrop('#desk .row[data-id=o1]', '#desk .gsec[data-gday="'+TM+'"] .group-title'); await pg.waitForTimeout(500);
    const m1 = await pg.evaluate(()=>{ const x=task('o1'), r=new Date(x.reminder); return {date:x.date, rd:localDay(x.reminder), h:r.getHours(), toast:document.querySelector('#toastText').textContent, undo:getComputedStyle(document.querySelector('#toastBtn')).display!=='none'}; });
    check('dg_drop_tomorrow_reminder', m1.date===TM && m1.rd===TM && m1.h===16 && m1.toast==='Movida a mañana' && m1.undo, m1);
    await pg.screenshot({path:path.join(OUT,'r-desk-group-drop.png')});
    await pg.click('#toastBtn'); await pg.waitForTimeout(400);
    check('dg_undo', await pg.evaluate(T=>{ const x=task('o1'); return x.date===T && localDay(x.reminder)===T; }, T));
    await pg.dragAndDrop('#desk .row[data-id=o3]', '#desk .gsec[data-gday=""] .row'); await pg.waitForTimeout(500);
    check('dg_drop_no_date', await pg.evaluate(()=>task('o3').date===null && document.querySelector('#toastText').textContent==='Sin fecha'));
    await pg.click('#toastBtn'); await pg.waitForTimeout(400); check('dg_no_date_undo', await pg.evaluate(()=>task('o3').date==='2026-11-06'));
    await pg.dragAndDrop('#desk .row[data-id=o2]', '#desk .row[data-id=o5]'); await pg.waitForTimeout(500);
    check('dg_month_refused', await pg.evaluate(TM=>task('o2').date===TM, TM));
    await pg.dragAndDrop('#desk .row[data-id=o2]', '#desk .row[data-id=o2] .row-title'); await pg.waitForTimeout(400);
    check('dg_same_group_nothing', await pg.evaluate(TM=>task('o2').date===TM&&task('o2').modified==='2026-11-01T10:00:00.000Z', TM));
    // The R16 selection goes together, with one Deshacer
    await pg.click('#desk .row[data-id=o2]'); await pg.click('#desk .row[data-id=o1]', {modifiers:['Control']}); await pg.waitForTimeout(200);
    await pg.dragAndDrop('#desk .row[data-id=o1]', '#desk .gsec[data-gday="2026-11-06"] .group-title'); await pg.waitForTimeout(500);
    const mm = await pg.evaluate(()=>({o1:task('o1').date, o2:task('o2').date, rem:localDay(task('o1').reminder), toast:document.querySelector('#toastText').textContent}));
    await pg.click('#toastBtn'); await pg.waitForTimeout(400);
    check('dg_selection', mm.o1==='2026-11-06' && mm.o2==='2026-11-06' && mm.rem==='2026-11-06' && mm.toast==='2 tareas movidas a viernes' && await pg.evaluate(([T,TM])=>task('o1').date===T&&task('o2').date===TM, [T,TM]), mm);
    // Hoy: an Aplazada dropped on the Hoy block is confirmed for today
    await pg.evaluate(()=>{ UI.dsel.ids.clear(); setDeskView('hoy'); }); await pg.waitForTimeout(400);
    await pg.dragAndDrop('#desk .row[data-id=c1]', '#desk .group[data-gday="'+T+'"] .row[data-id=h1]'); await pg.waitForTimeout(500);
    check('dg_hoy_confirms_carried', await pg.evaluate(T=>{ const x=task('c1'); return x.date===T && x.carried===false; }, T));
    // By project: another project group changes the project; Sin proyecto clears it
    await pg.evaluate(()=>{ DB.settings.allGroup='project'; save(); setDeskView('todas'); }); await pg.waitForTimeout(400);
    await pg.dragAndDrop('#desk .row[data-id=f1]', '#desk .gsec[data-gproj="p-oca"] .group-title'); await pg.waitForTimeout(500);
    const pj = await pg.evaluate(()=>({p:task('f1').projectId, toast:document.querySelector('#toastText').textContent}));
    await pg.dragAndDrop('#desk .row[data-id=f1]', '#desk .gsec[data-gproj="none"] .group-title'); await pg.waitForTimeout(500);
    check('dg_project_groups', pj.p==='p-oca' && pj.toast==='Movida a OCA' && await pg.evaluate(()=>task('f1').projectId===null), pj);
    check('dg_logged', await pg.evaluate(()=>LOG.some(e=>e.m==='Tareas arrastradas a otro día de la lista')));
    await c3.close(); }
  /* ======================= 34. Deleting local copies ======================= */
  // Desktop: right click, hover bin, Mac alert; Cancelar keeps it
  await page.evaluate(async d=>{ for(const x of d) await BK.put(x); await refreshBackups(); setDeskView('settings'); }, [today, addD(today,-1), addD(today,-2)]); await page.waitForTimeout(400);
  check('bk_desk_rows', await page.evaluate(()=>document.querySelectorAll('#desk .vn[data-bk]').length===3 && !!document.querySelector('#desk [data-act=backupsClear]')));
  await page.click('#desk .vn[data-bk="'+addD(today,-1)+'"] .cell', {button:'right'}); await page.waitForTimeout(300);
  const dm = await page.evaluate(()=>[...document.querySelectorAll('#pmenu .pm-it')].map(x=>x.textContent.trim()));
  check('bk_desk_menu', dm.join('|')==='Restaurar|Borrar copia', dm);
  await page.evaluate(()=>{ [...document.querySelectorAll('#pmenu .pm-it')].find(x=>/Borrar/.test(x.textContent)).click(); }); await page.waitForTimeout(350);
  const da = await page.evaluate(()=>({on:alertOn(), t:document.querySelector('#asheet .al-t').textContent, x:document.querySelector('#asheet .al-x').textContent, ok:document.querySelector('#asheet .al-btn.def').textContent}));
  check('bk_desk_alert', da.on && da.t==='Borrar copia' && /de ayer \(\d+ tareas?\) se borrará de este dispositivo\. No se puede deshacer\./.test(da.x) && da.ok==='Borrar', da);
  await page.screenshot({path:path.join(OUT,'r-desk-backup-alert.png')});
  await page.keyboard.press('Enter'); await page.waitForTimeout(500);
  const dd = await page.evaluate(()=>({list:BACKUPS.map(b=>b.date), rows:document.querySelectorAll('#desk .vn[data-bk]').length, undo:getComputedStyle(document.querySelector('#toastBtn')).display, toast:document.querySelector('#toastText').textContent, log:LOG.some(e=>e.m==='Copia local borrada')}));
  check('bk_desk_deleted', dd.list.join()===[today, addD(today,-2)].join() && dd.rows===2 && dd.undo==='none' && dd.toast==='Copia borrada' && dd.log, dd);
  await page.hover('#desk .vn[data-bk="'+today+'"] .cell'); await page.waitForTimeout(250);
  check('bk_desk_hover_bin', await page.evaluate(d=>getComputedStyle(document.querySelector('#desk .vn[data-bk="'+d+'"] .bk-del')).opacity==='1', today));
  await page.screenshot({path:path.join(OUT,'r-desk-backups.png')});
  await page.click('#desk .vn[data-bk="'+today+'"] .bk-del'); await page.waitForTimeout(300); await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  check('bk_desk_cancel_keeps', await page.evaluate(()=>BACKUPS.length===2 && !alertOn()));
  await ctx.close();
  // iPhone: swipe to Eliminar, the long-press menu, Borrar todas
  ({ctx, page} = await open(browser, {tag:'MB'}));
  const cdp = await ctx.newCDPSession(page);
  await page.evaluate(async d=>{ for(const x of d) await BK.put(x); await refreshBackups(); }, [today, addD(today,-1), addD(today,-2)]);
  await openSetting(page, 'datos'); // v0.37.4: Datos y copias
  const row = async d => page.evaluate(d=>{ const e=document.querySelector('.screen.settings .vn[data-bk="'+d+'"]'); e.scrollIntoView({block:'center'}); const q=e.getBoundingClientRect(); return {x:q.x, y:q.y, w:q.width, cy:q.y+q.height/2}; }, d);
  let q = await row(addD(today,-2));
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:q.x+q.w-30,y:q.cy}]}); for(let i=1;i<=8;i++){ await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:q.x+q.w-30-i*16,y:q.cy}]}); await page.waitForTimeout(16); } await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]}); await page.waitForTimeout(500);
  const so = await page.evaluate(d=>{ const e=document.querySelector('.vn[data-bk="'+d+'"]'); return {open:e.dataset.open, bg:getComputedStyle(e.querySelector('.vn-bg.r')).display, tab:UI.tab}; }, addD(today,-2));
  check('bk_swipe_open', so.open==='l' && so.bg==='block' && so.tab==='ajustes', so);
  await page.screenshot({path:path.join(OUT,'r-iphone-backup-swipe.png')});
  await page.click('.vn[data-bk="'+addD(today,-2)+'"] [data-bkact=del]'); await page.waitForTimeout(500);
  const ia = await page.evaluate(()=>({on:document.querySelector('#asheet').classList.contains('on'), t:(document.querySelector('#asheet .t')||{}).textContent, b:[...document.querySelectorAll('#asheet .it')].map(x=>x.textContent)}));
  check('bk_iphone_confirm', ia.on && /se borrará de este iPhone\. No se puede deshacer\./.test(ia.t) && ia.b.join('|')==='Borrar copia|Cancelar', ia);
  await page.click('#asheet .it.red'); await page.waitForTimeout(600);
  check('bk_iphone_deleted', await page.evaluate(()=>BACKUPS.length===2 && document.querySelectorAll('.screen.settings .vn[data-bk]').length===2));
  q = await row(addD(today,-1));
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:q.x+60,y:q.cy}]}); await page.waitForTimeout(700); await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]}); await page.waitForTimeout(500);
  const im = await page.evaluate(()=>[...document.querySelectorAll('#pmenu .pm-it, #pmenu button')].map(x=>x.textContent.trim()).filter(Boolean));
  check('bk_iphone_menu', im.some(t=>t==='Borrar copia') && im.some(t=>t==='Restaurar'), im);
  await page.screenshot({path:path.join(OUT,'r-iphone-backup-menu.png')});
  await page.evaluate(()=>{ [...document.querySelectorAll('#pmenu .pm-it, #pmenu button')].find(x=>x.textContent.trim()==='Borrar copia').click(); }); await page.waitForTimeout(600);
  await page.click('#asheet .it.red'); await page.waitForTimeout(600);
  check('bk_iphone_menu_deleted', await page.evaluate(d=>BACKUPS.map(b=>b.date).join()===d, today));
  await page.evaluate(()=>document.querySelector('[data-act=backupsClear]').scrollIntoView({block:'center'})); await page.click('[data-act=backupsClear]'); await page.waitForTimeout(500);
  const ca = await page.evaluate(()=>({t:(document.querySelector('#asheet .t')||{}).textContent, b:[...document.querySelectorAll('#asheet .it')].map(x=>x.textContent)}));
  await page.click('#asheet .it.red'); await page.waitForTimeout(700);
  const cl = await page.evaluate(async()=>{ await dailyBackup(false); const auto=(await BK.list()).length; return {n:BACKUPS.length, rows:document.querySelectorAll('.vn[data-bk]').length, clearBtn:!!document.querySelector('[data-act=backupsClear]'), auto, skip:localStorage.getItem('tareas-bk-skip')===todayStr(), log:LOG.some(e=>e.m==='Copias locales borradas')}; });
  check('bk_clear_all', /se borrarán\. No se puede deshacer\. La copia automática vuelve mañana\./.test(ca.t) && ca.b[0]==='Borrar todas las copias' && cl.n===0 && cl.rows===0 && !cl.clearBtn && cl.auto===0 && cl.skip && cl.log, {ca, cl});
  check('bk_manual_still_works', await page.evaluate(async()=>{ await dailyBackup(true); return BACKUPS.length===1; }));
  await page.waitForTimeout(400); await page.screenshot({path:path.join(OUT,'r-iphone-backups-after.png')});
  await ctx.close();
  }catch(e){ check('crash', false, String(e.stack||e)); }
  await browser.close(); srv.close();
  console.log(JSON.stringify({results:r, fails, errors}, null, 1));
  process.exit(fails.length||errors.length?1:0);
})();
