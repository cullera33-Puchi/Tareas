require('./lib/out.js'); // outputs (screenshots, downloads) go to tests/out
// Batch FR (owner, 4 November, decision 65 b, d and e), port 10900. Screenshots in tests/out/FR.
//  1. Modo foco (65d): Foco in the head of Ahora, only the Ahora tasks (rows with their gestures, completing), nothing else of Hoy (no
//     segment, search, chips, Revisar hoy, Mañana, Cerrar el día, +), Salir del foco, the last one completed ends it, a new day ends it,
//     on the iPhone (light and dark) and on the desktop (the sidebar stays, another view ends it).
//  2. Repetir desde que la completas (65b): A<n>D and A<n>W, the next dated the day it is done plus n with the reminder's time, Eliminar
//     solo esta from today, the summary, the menu entry, Personalizada with Desde que la hice.
//  3. Repeticiones con fin y sin acumularse (65e): ;u and ;x (with ;n), the last one creates nothing and says so, its delete asks nothing;
//     ;s: rollOver over a weekend for a Monday and Thursday series (fixed clock), no Aplazada, no postponing, the reminder moved, the
//     count moved on; Cerrar el día sends it to its next occurrence; waiting, Ahora and the series dedupe; old rules unchanged; an unknown
//     flag is no repeat and breaks nothing; new series get ;s, old ones keep what they had.
const { chromium } = require('playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = path.resolve(__dirname, '..'), PORT = 10900, URL0 = 'http://localhost:'+PORT+'/';
const OUT = path.join(__dirname, 'out', 'FR'); fs.mkdirSync(OUT, {recursive:true});
const TYPES = {'.html':'text/html','.css':'text/css','.js':'application/javascript','.webmanifest':'application/manifest+json','.png':'image/png'};
const srv = http.createServer((req,res)=>{ let p = decodeURIComponent(req.url.split('?')[0]); if(p==='/') p='/index.html';
  if(p==='/config.js'){ res.writeHead(200,{'Content-Type':'application/javascript'}); res.end('window.TAREAS_CONFIG = {"url":null,"anonKey":null};\n'); return; }
  const f=path.join(ROOT,p); if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){ res.writeHead(404,{'Content-Type':'text/html'}); res.end('<h1>404</h1>'); return; }
  res.writeHead(200,{'Content-Type':TYPES[path.extname(f)]||'application/octet-stream'}); res.end(fs.readFileSync(f)); });
const r={}, fails=[], errors=[]; const check=(name, ok, info)=>{ r[name]=ok?true:(info===undefined?false:info); if(!ok) fails.push(name); };
const sleep=ms=>new Promise(res=>setTimeout(res,ms));
const shot=(page, name)=>page.screenshot({path:path.join(OUT, name+'.png')});

const AT = (d, h, m) => new Date(2026, 10, d, h, m, 0); // November 2026, local: Thursday 5, Friday 6, Monday 9
const L = (d, h, m) => AT(d, h, m).toISOString();
const T0 = '2026-11-03T08:00:00.000Z';
const C = n => new Date(Date.UTC(2026, 10, 3, 8, n)).toISOString();
const tk = (id, o) => Object.assign({id, title:id, spaceId:'trabajo', projectId:null, date:'2026-11-05', reminder:null, priority:'none', status:'pending', notes:'', carried:false, created:T0, modified:T0, completed:null}, o);
const base = tasks => ({ spaces:[{id:'trabajo',name:'Trabajo',order:0,created:T0},{id:'personal',name:'Personal',order:1,created:T0}],
  projects:[{id:'p1', spaceId:'trabajo', name:'FLC', color:'#007AFF', order:0, archived:false, created:T0, modified:T0}],
  tasks, voiceNotes:[], attachments:[], subtasks:[], projectNotes:[], contacts:[], settings:{tipsSeen:true} });
// Focus mode: two tasks in Ahora, and everything else Hoy can show around them at 19:30 (Revisar hoy, Aplazadas, Mañana, Cerrar el día)
const FOCUS_SEED = () => base([
  tk('f1', {title:'Llamar al cliente de FLC', projectId:'p1', priority:'high', focus:L(5,9,0), estimate:30, created:C(1)}),
  tk('f2', {title:'Revisar el presupuesto del trimestre', focus:L(5,9,5), reminder:L(5,20,0), created:C(2)}),
  tk('h1', {title:'Preparar el comité', projectId:'p1', created:C(3)}),
  tk('h2', {title:'Aplazada de ayer', carried:true, created:C(4)}),
  tk('w1', {title:'Firma del contrato', status:'waiting', waitingFor:'Marta', created:C(5)}),
  tk('m1', {title:'Para mañana', date:'2026-11-06', created:C(6)}),
  tk('x1', {title:'Personal', spaceId:'personal', created:C(7)}) ]);

async function open(browser, o){
  const vp = o.desk ? {viewport:{width:1280,height:800}, deviceScaleFactor:1} : {viewport:{width:390,height:844}, deviceScaleFactor:2, isMobile:true, hasTouch:true};
  const ctx = await browser.newContext(Object.assign(vp, {colorScheme:o.theme||'light'})); const page = await ctx.newPage();
  await page.clock.install({time:o.now||AT(5,10,0)});
  page.on('pageerror', e=>errors.push(o.tag+' pageerror: '+e.message)); page.on('console', m=>{ if(m.type()==='error') errors.push(o.tag+' console: '+m.text()); });
  await page.addInitScript(s=>{ if(!localStorage.getItem('tareas-v1')) localStorage.setItem('tareas-v1', s); }, JSON.stringify(o.seed));
  await page.goto(URL0); await until(page, ()=>typeof DB!=='undefined'&&!!document.querySelector(UI.wide?'#desk .main':'.screen.root')); return {ctx, page};
}
const ev = (page, fn, arg) => page.evaluate(fn, arg);
const until = async (page, fn, arg, ms=8000)=>{ const t0=Date.now(); for(;;){ let v=false; try{ v=await page.evaluate(fn, arg); }catch(e){} if(v) return true; if(Date.now()-t0>ms) return false; await sleep(80); } };
const calm = page => until(page, ()=>!app.classList.contains('navigating') && !HELD.size && !document.querySelector('.row.leaving, .flip, .enter') && !touchDrag);
const sheetUp = page => until(page, ()=>{ const s=document.querySelector('#sheet'); return s.classList.contains('on') && !sheetFresh(); });
const sheetGone = page => until(page, ()=>!document.querySelector('#sheet').classList.contains('on'));
const menuSettled = page => until(page, ()=>menuOpen() && !menuFresh() && !document.querySelector('#pmenu').getAnimations({subtree:true}).some(a=>a.playState==='running'));
const toastText = page => ev(page, ()=>document.querySelector('#toast').classList.contains('on')?document.querySelector('#toastText').textContent:'');
const menuItem = (page, label) => page.locator('#pmenu .pm-it').filter({has: page.locator('.pm-l', {hasText: new RegExp('^'+label.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'$')})}).first();
const RS = '.screen.root[data-root=tareas]';
// A task's day facts, with its reminder in local time
const facts = (page, id) => ev(page, id=>{ const x=task(id); if(!x) return null; const rm=x.reminder?new Date(x.reminder):null;
  return {date:x.date, carried:!!x.carried, postponed:x.postponed||null, carriedSince:x.carriedSince||null, repeat:x.repeat||null, deadline:x.deadline||null, status:x.status, focus:!!x.focus,
    rem:rm?localDay(x.reminder)+' '+rm.getHours()+':'+String(rm.getMinutes()).padStart(2,'0'):null, sent:!!x.reminderSent}; }, id);
const nextOf = (page, id) => ev(page, id=>{ const s=repSeries(task(id).repeat); const n=DB.tasks.filter(o=>o.id!==id&&o.status==='pending'&&repSeries(o.repeat)===s);
  return n.map(o=>({id:o.id, date:o.date, repeat:o.repeat, rem:o.reminder?localDay(o.reminder)+' '+new Date(o.reminder).getHours()+':'+String(new Date(o.reminder).getMinutes()).padStart(2,'0'):null, postponed:o.postponed||null})); }, id);

/* ======================= 2 and 3: the engine ======================= */
async function engine(browser){ let x;
  const {ctx, page} = await open(browser, {tag:'E', seed:base([
    tk('a1', {title:'Regar las plantas', repeat:'A3D@2026-11-05#ad1', reminder:L(5,9,30), created:C(1)}),
    tk('a2', {title:'Revisión de coche', repeat:'A1W@2026-11-10#aw1', date:'2026-11-10', reminder:L(10,16,0), created:C(2)}),
    tk('a3', {title:'Copia de seguridad', repeat:'A2W@2026-11-05#aw2', reminder:L(5,18,0), created:C(3)}),
    tk('e1', {title:'Curso de inglés', repeat:'D1@2026-11-05#e1;u2026-11-06', created:C(4)}),
    tk('c1', {title:'Sesión de fisio', repeat:'W1:TH@2026-11-05#c1;x2', reminder:L(5,12,0), created:C(5)}),
    tk('o1', {title:'Informe semanal', repeat:'W1:TH@2026-11-05#old1', created:C(6)}),
    tk('u1', {title:'Regla futura', repeat:'D1@2026-11-05#zz;q1', created:C(7)}),
    tk('n1', {title:'Nueva serie', date:null, created:C(8)}),
    tk('n2', {title:'Serie antigua', repeat:'W1:MO@2026-11-02#old2', date:'2026-11-09', created:C(9)}) ])});
  x = await ev(page, ()=>{ const rt=s=>{ const p=repParse(s); return p&&repString(p); };
    return { old:['W2:MO,TH@2026-11-02#abc','D1@2026-11-04#ser2','M1:LFR','Y1:11-03@2026-11-03#y1','WD'].map(rt),
      neu:['A3D#x;s','A2W@2026-11-05#s1','A1D','W1:MO,TH@2026-11-02#k;x10;n3;s','D1#a;u2026-12-31','D1#a;x5;n1','M1:15#m;s;u2027-01-31'].map(rt),
      bad:['D1#a;z9','D1#a;','A0D','A2M','D1#a;x0','W1:MO#a;s;y'].map(s=>repParse(s)),
      words:['A2W','A1W','A1D','A3D','D1;u2026-12-31','W1:MO,TH;x10','A2W;x1','D1;u2027-01-05'].map(s=>repSummary(s.replace(';','#q;')).replace(/#q/,'')),
      preset:[repPreset('aweek','2026-11-05'), repPresetOf('A1W'), repPresetOf('A2W'), repPresetOf('W1:TH#a;s;x3')] }; });
  check('parse_old_unchanged', JSON.stringify(x.old)===JSON.stringify(['W2:MO,TH@2026-11-02#abc','D1@2026-11-04#ser2','M1:LFR','Y1:11-03@2026-11-03#y1','WD']), x.old);
  check('parse_new_roundtrip', JSON.stringify(x.neu)===JSON.stringify(['A3D#x','A2W@2026-11-05#s1','A1D','W1:MO,TH@2026-11-02#k;x10;n3;s','D1#a;u2026-12-31','D1#a;x5','M1:15#m;u2027-01-31;s']), x.neu);
  check('parse_unknown_null', x.bad.every(v=>v===null), x.bad);
  check('summary_words', JSON.stringify(x.words)===JSON.stringify(['Cada 2 semanas desde que se hace','Cada semana desde que se hace','Cada día desde que se hace','Cada 3 días desde que se hace','Cada día, hasta el 31 de diciembre','Cada semana, lunes y jueves, 10 veces','Cada 2 semanas desde que se hace, una vez','Cada día, hasta el 5 de enero de 2027']), x.words);
  check('presets', x.preset.join()==='A1W,aweek,custom,week', x.preset);

  // 65b: every 3 days after it is done, completed today: the 8th, with its reminder at 9:30; Deshacer takes it back
  x = await ev(page, ()=>{ completeTask('a1'); return document.querySelector('#toastText').textContent; });
  let n = await nextOf(page, 'a1');
  check('after_days', n.length===1 && n[0].date==='2026-11-08' && n[0].rem==='2026-11-08 9:30' && n[0].repeat==='A3D@2026-11-05#ad1' && x==='Tarea completada, la siguiente el domingo 8', {n, x});
  await ev(page, ()=>undoFn()); n = await nextOf(page, 'a1'); x = await facts(page, 'a1');
  check('after_undo', !n.length && x.status==='pending', {n, x});
  // Weekly, dated the 10th but done today (the 5th): the next one counts from today, the 12th at 16:00
  await ev(page, ()=>completeTask('a2')); n = await nextOf(page, 'a2');
  check('after_week_from_done', n.length===1 && n[0].date==='2026-11-12' && n[0].rem==='2026-11-12 16:00', n);
  // Eliminar solo esta: two weeks from today, the reminder along; Deshacer
  x = await ev(page, ()=>{ skipOccurrence('a3'); return document.querySelector('#toastText').textContent; }); let f = await facts(page, 'a3');
  check('after_skip_one', f.date==='2026-11-19' && f.rem==='2026-11-19 18:00' && !f.carried && /la siguiente el jueves 19/.test(x), {f, x});
  await ev(page, ()=>undoFn()); f = await facts(page, 'a3'); check('after_skip_undo', f.date==='2026-11-05' && f.rem==='2026-11-05 18:00', f);

  // 65e: the end by date. Today's one makes tomorrow's; tomorrow's one is the last (the 7th is past the 6th)
  await ev(page, ()=>completeTask('e1')); n = await nextOf(page, 'e1');
  check('until_next', n.length===1 && n[0].date==='2026-11-06', n);
  const e2 = n[0] && n[0].id;
  x = await ev(page, id=>({goes:repGoesOn(task(id))}), e2);
  x.toast = await ev(page, id=>{ completeTask(id); return document.querySelector('#toastText').textContent; }, e2); n = await nextOf(page, e2);
  check('until_last', !x.goes && !n.length && x.toast==='Tarea completada, era la última de la serie', {x, n});
  // The end by count: occurrence 1 of 2 makes occurrence 2 (;n2); that one is the last
  await ev(page, ()=>completeTask('c1')); n = await nextOf(page, 'c1');
  check('count_next', n.length===1 && n[0].date==='2026-11-12' && n[0].repeat==='W1:TH@2026-11-05#c1;x2;n2' && n[0].rem==='2026-11-12 12:00', n);
  const c2 = n[0] && n[0].id;
  // Its delete asks nothing about the series (there is no next one): the plain confirmation
  await ev(page, id=>confirmDelete(id), c2); await sheetUp(page).catch(()=>{});
  x = await ev(page, ()=>({sheet:document.querySelector('#asheet')&&document.querySelector('#asheet').textContent||'', s2:document.querySelector('#sheet').textContent}));
  check('count_last_delete_plain', !/Eliminar solo esta/.test(x.sheet+x.s2) && /Eliminar/.test(x.sheet+x.s2), x);
  await ev(page, ()=>{ if(typeof closeAction==='function') closeAction(); closeSheet(); }); await sleep(600);
  x = await ev(page, id=>{ completeTask(id); return document.querySelector('#toastText').textContent; }, c2); n = await nextOf(page, c2);
  check('count_last', !n.length && x==='Tarea completada, era la última de la serie', {n, x});
  // An old rule is written back as it was; completing it still makes the next one with the same text
  await ev(page, ()=>completeTask('o1')); n = await nextOf(page, 'o1');
  check('old_rule_next', n.length===1 && n[0].repeat==='W1:TH@2026-11-05#old1' && n[0].date==='2026-11-12', n);
  // An unknown flag (a later version): no repeat, nothing breaks (row, detail, complete, delete)
  x = await ev(page, ()=>{ render(); const row=document.querySelector('.screen.root .row[data-id=u1]'); const ok={row:!!row, icon:!!(row&&row.querySelector('.irp')), goes:repGoesOn(task('u1'))};
    completeTask('u1'); ok.next=DB.tasks.filter(o=>o.id!=='u1'&&(o.repeat||'').includes('zz')).length; ok.toast=document.querySelector('#toastText').textContent; undoFn(); return ok; });
  check('unknown_flag_tolerated', x.row && !x.icon && !x.goes && x.next===0 && x.toast==='Tarea completada', x);
  // A new series does not pile up (;s); an old series keeps what it had when its quick rule changes; an A rule has no ;s
  x = await ev(page, ()=>{ setRepeat('n1','D1'); const a=task('n1').repeat; setRepeat('n2', repPreset('week2','2026-11-09')); const b=task('n2').repeat; setRepeat('a3', 'A1W'); return {a, b, c:task('a3').repeat}; });
  check('default_skip_new', /^D1@2026-11-05#[\w-]+;s$/.test(x.a) && /^W2:MO@2026-11-09#old2$/.test(x.b) && x.c==='A1W@2026-11-05#aw2', x);
  // setRepeat with an end from Personalizada keeps the series and the rhythm when only the end changes
  x = await ev(page, ()=>{ const s0=task('n1').repeat; setRepeat('n1','D1',{count:5, skip:true}); const a=task('n1').repeat; setRepeat('n1','D1',{until:'2026-12-31', skip:false}); return {s0, a, b:task('n1').repeat}; });
  const ser = (x.s0||'').split('#')[1].split(';')[0];
  check('set_end', x.a==='D1@2026-11-05#'+ser+';x5;s' && x.b==='D1@2026-11-05#'+ser+';u2026-12-31', x);
  await ctx.close();
}

/* ======================= 3: not piling up, over a weekend ======================= */
const ROLL_SEED = () => base([
  tk('s1', {title:'Reunión de seguimiento', repeat:'W1:MO,TH@2026-11-02#mt1;s', reminder:L(5,8,0), deadline:'2026-11-06', created:C(1)}),
  tk('s2', {title:'Parte semanal', repeat:'W1:MO,TH@2026-11-02#mt2;x5;n2;s', reminder:L(5,11,0), created:C(2)}),
  tk('s3', {title:'Serie sin flag', repeat:'W1:MO,TH@2026-11-02#mt3', reminder:L(5,8,0), created:C(3)}),
  tk('s4', {title:'Diaria que no se acumula', repeat:'D1@2026-11-02#dd1;s', reminder:L(5,7,30), created:C(4)}),
  tk('s5', {title:'Por confirmar de una serie', repeat:'W1:MO,TH@2026-11-02#mt5;s', status:'waiting', waitingFor:'Luis', created:C(5)}),
  tk('s6', {title:'En Ahora de una serie', repeat:'W1:MO,TH@2026-11-02#mt6;s', focus:L(5,9,0), created:C(6)}),
  tk('s7a', {title:'Copia A', repeat:'W1:MO,TH@2026-11-02#dup;s', created:C(7)}),
  tk('s7b', {title:'Copia B', repeat:'W1:MO,TH@2026-11-02#dup;s', date:'2026-11-06', created:C(8)}),
  tk('s8', {title:'Termina el viernes', repeat:'W1:MO,TH@2026-11-02#end1;u2026-11-08;s', created:C(9)}) ]);
async function roll(browser){ let x;
  // Opened on Monday 9 at 10:00 with Thursday's tasks: the start rolls them over
  const {ctx, page} = await open(browser, {tag:'W', seed:ROLL_SEED(), now:AT(9,10,0)});
  let f = await facts(page, 's1');
  check('skip_weekend_monday', f.date==='2026-11-09' && !f.carried && !f.postponed && !f.carriedSince && f.rem==='2026-11-09 8:00' && f.sent && f.deadline==='2026-11-10' && f.repeat==='W1:MO,TH@2026-11-02#mt1;s', f);
  f = await facts(page, 's2'); check('skip_count_moves_on', f.date==='2026-11-09' && !f.carried && f.repeat==='W1:MO,TH@2026-11-02#mt2;x5;n3;s' && f.rem==='2026-11-09 11:00' && !f.sent, f);
  f = await facts(page, 's3'); check('old_series_carried', f.date==='2026-11-09' && f.carried && f.postponed===1, f);
  f = await facts(page, 's4'); check('skip_daily_today', f.date==='2026-11-09' && !f.carried && !f.postponed, f);
  f = await facts(page, 's5'); check('skip_waiting_untouched', f.date==='2026-11-05' && f.status==='waiting', f);
  f = await facts(page, 's6'); check('skip_ahora_cleared', f.date==='2026-11-09' && !f.focus && !f.carried, f);
  x = await ev(page, ()=>({a:!!task('s7a'), b:!!task('s7b'), n:DB.tasks.filter(o=>repSeries(o.repeat)==='dup').length}));
  check('skip_dedupe', x.a && !x.b && x.n===1, x);
  f = await facts(page, 's8'); check('skip_ended_carried', f.date==='2026-11-09' && f.carried && f.postponed===1, f);
  // Hoy shows them as today's, not under Aplazadas
  x = await ev(page, RS=>{ const ap=[...document.querySelectorAll(RS+' .group-title')].find(g=>/Aplazadas/.test(g.textContent)); const grp=ap&&ap.nextElementSibling;
    const inAp=id=>!!(grp&&grp.querySelector('.row[data-id="'+id+'"]')); const meta=id=>{ const r=document.querySelector(RS+' .row[data-id="'+id+'"] .row-meta'); return r?r.textContent:''; };
    return {s1:inAp('s1'), s3:inAp('s3'), m1:meta('s1'), m4:meta('s4')}; }, RS);
  check('skip_rows', !x.s1 && x.s3 && !/Aplazada/.test(x.m1) && !/Aplazada/.test(x.m4), x);
  await shot(page, 'r1-hoy-monday');
  await ctx.close();

  // Thursday to Friday with the app open: Thursday's Monday and Thursday series goes to Monday (out of Hoy), the daily one stays today
  const o2 = await open(browser, {tag:'W2', seed:ROLL_SEED(), now:AT(5,10,0)}); const p2=o2.page;
  await p2.clock.setSystemTime(AT(6,10,0)); await ev(p2, ()=>{ rollOver(); render(); });
  f = await facts(p2, 's1'); const s4 = await facts(p2, 's4');
  x = await ev(p2, ()=>pendingFor('hoy').map(t=>t.id));
  check('skip_friday', f.date==='2026-11-09' && !f.carried && f.rem==='2026-11-09 8:00' && !f.sent && s4.date==='2026-11-06' && !s4.carried && !x.includes('s1') && x.includes('s4'), {f, s4, x});
  await o2.ctx.close();
}

/* ======================= 3: Cerrar el día ======================= */
async function closeDay(browser){ let x;
  const {ctx, page} = await open(browser, {tag:'K', now:AT(5,19,30), seed:base([
    tk('k1', {title:'Reunión lunes y jueves', repeat:'W1:MO,TH@2026-11-02#k1;s', reminder:L(5,20,0), created:C(1)}),
    tk('k2', {title:'Tarea suelta', created:C(2)}),
    tk('k3', {title:'Diaria sin acumular', repeat:'D1@2026-11-02#k3;s', created:C(3)}),
    tk('k4', {title:'Serie de antes', repeat:'W1:MO,TH@2026-11-02#k4', created:C(4)}) ])});
  await ev(page, ()=>closeDaySheet()); await sheetUp(page);
  x = await ev(page, ()=>[...document.querySelectorAll('#sheet .cdfoot')].map(e=>e.textContent).join('|'));
  check('close_hint', /Las que se repiten sin acumularse pasan a su siguiente fecha\./.test(x), x);
  await shot(page, 'k1-close-day');
  await page.tap('#sheet [data-cd=all]'); await sheetGone(page); await calm(page);
  const t = await toastText(page); const k = {}; for(const id of ['k1','k2','k3','k4']) k[id]=await facts(page, id);
  check('close_next_occurrence', k.k1.date==='2026-11-09' && !k.k1.postponed && k.k1.rem==='2026-11-09 20:00' && !k.k1.carried, k.k1);
  check('close_tomorrow', k.k2.date==='2026-11-06' && k.k2.postponed===1 && k.k3.date==='2026-11-06' && !k.k3.postponed && k.k4.date==='2026-11-06' && k.k4.postponed===1, k);
  check('close_toast', t==='3 tareas pasadas a mañana, 1 a su siguiente fecha, día cerrado', t);
  await page.tap('#toastBtn'); await calm(page);
  x = await ev(page, ()=>['k1','k2','k3','k4'].map(id=>task(id).date+'|'+(task(id).postponed||0)).join(',')+' '+isClosed());
  check('close_undo', x==='2026-11-05|0,2026-11-05|0,2026-11-05|0,2026-11-05|0 false', x);
  await ctx.close();
}

/* ======================= 2 and 3: Personalizada in the iPhone detail ======================= */
async function custom(browser, theme){ let x;
  const {ctx, page} = await open(browser, {tag:'P'+theme, theme, seed:base([tk('r1', {title:'Lavar el coche', created:C(1)}), tk('r2', {title:'Sesiones de fisio', created:C(2)})])});
  await ev(page, ()=>openDetail('r1')); await until(page, ()=>!!document.querySelector('.pushed-screen.detail [data-act=pickRepeat]')); await calm(page);
  await page.tap('.pushed-screen.detail [data-act=pickRepeat]'); await menuSettled(page);
  const items = await ev(page, ()=>[...document.querySelectorAll('#pmenu .pm-it .pm-l')].map(e=>e.textContent));
  check('menu_items_'+theme, items.join('|')==='Nunca|Cada día|Cada día laborable|Cada semana|Cada 2 semanas|Cada mes|Cada año|Cada semana desde que la hice|Personalizada', items);
  await menuItem(page, 'Personalizada').tap(); await sheetUp(page);
  const tapRp = async k => { await page.tap('#sheet [data-rp="'+k+'"]'); await until(page, ()=>!!document.querySelector('#sheet .rp')); };
  x = await ev(page, ()=>({skip:document.querySelector('#sheet [data-rp=skip] .switch').classList.contains('on'), after:!!document.querySelector('#sheet [data-rp=after]')}));
  check('custom_defaults_'+theme, x.skip && x.after, x);
  await tapRp('u:D'); await tapRp('n+'); await tapRp('n+'); await tapRp('after'); await tapRp('e:count'); await tapRp('c-'); await tapRp('c-'); await tapRp('c-'); await tapRp('c-'); await tapRp('c-'); await tapRp('c-'); await tapRp('c-');
  x = await ev(page, ()=>({sum:document.querySelector('#sheet .rpsum').textContent, skip:!!document.querySelector('#sheet [data-rp=skip]'), days:!!document.querySelector('#sheet .rpdays')}));
  check('custom_after_summary_'+theme, x.sum==='Cada 3 días desde que se hace, 3 veces' && !x.skip && !x.days, x);
  await shot(page, 'p1-custom-after-'+theme);
  await tapRp('ok'); await sheetGone(page);
  x = await ev(page, ()=>({rep:task('r1').repeat, val:document.querySelector('.pushed-screen.detail [data-act=pickRepeat] .val').textContent}));
  check('custom_after_saved_'+theme, /^A3D@2026-11-05#[\w-]+;x3$/.test(x.rep) && x.val==='Cada 3 días desde que se hace, 3 veces', x);
  await page.tap('.pushed-screen.detail [data-act=back]'); await calm(page);
  // Weekly on Monday and Thursday until a day, without piling up switched off
  await ev(page, ()=>openDetail('r2')); await until(page, ()=>!!document.querySelector('.pushed-screen.detail [data-act=pickRepeat]')); await calm(page);
  await page.tap('.pushed-screen.detail [data-act=pickRepeat]'); await menuSettled(page); await menuItem(page, 'Personalizada').tap(); await sheetUp(page);
  await tapRp('d:1'); await tapRp('e:until'); // Thursday, the task's day, is on already
  await page.fill('#sheet [data-role=rpuntil]', '2026-12-31'); await page.dispatchEvent('#sheet [data-role=rpuntil]', 'change');
  await tapRp('skip');
  x = await ev(page, ()=>document.querySelector('#sheet .rpsum').textContent);
  check('custom_until_summary_'+theme, x==='Cada semana, lunes y jueves, hasta el 31 de diciembre', x);
  await shot(page, 'p2-custom-until-'+theme);
  await tapRp('ok'); await sheetGone(page);
  x = await ev(page, ()=>task('r2').repeat);
  check('custom_until_saved_'+theme, /^W1:MO,TH@2026-11-05#[\w-]+;u2026-12-31$/.test(x), x);
  await ctx.close();
}

/* ======================= 1: focus mode on the iPhone ======================= */
async function focusPhone(browser, theme){ let x;
  const {ctx, page} = await open(browser, {tag:'F'+theme, theme, now:AT(5,19,30), seed:FOCUS_SEED()});
  x = await ev(page, RS=>{ const h=document.querySelector(RS+' .ahora .ahead'); return {foco:!!(h&&h.querySelector('[data-act=focusOn]')), closecell:!!document.querySelector(RS+' .closecell')}; }, RS);
  check('focus_button_'+theme, x.foco && x.closecell, x);
  if(theme==='light') await shot(page, 'f0-hoy-before');
  await page.tap(RS+' .ahora [data-act=focusOn]'); await calm(page);
  const look = () => ev(page, RS=>{ const s=document.querySelector(RS); const rows=[...s.querySelectorAll('.row')].map(r=>r.dataset.id);
    return {rows, gestures:s.querySelectorAll('.focuslist .row .row-bg').length, seg:!!s.querySelector('.seg'), search:!!s.querySelector('.searchbar'), chips:!!s.querySelector('.pchips'),
      close:!!s.querySelector('.closecell'), preview:!!s.querySelector('.preview'), review:!!s.querySelector('[data-review]'), fab:!!s.querySelector('.fab'), wait:!!s.querySelector('.wblock'),
      exit:(s.querySelector('[data-act=focusOff]')||{}).textContent||'', title:(s.querySelector('.nav .title')||{}).textContent||'', mode:DB.settings.focusMode||null, big:parseFloat(getComputedStyle(s.querySelector('.focuslist .row-title')||document.body).fontSize)}; }, RS);
  x = await look();
  check('focus_only_ahora_'+theme, x.rows.join()==='f1,f2' && x.gestures===4 && !x.seg && !x.search && !x.chips && !x.close && !x.preview && !x.review && !x.fab && !x.wait && x.exit==='Salir del foco' && x.title==='Ahora2' && x.mode==='2026-11-05' && x.big>19, x);
  await shot(page, 'f1-focus-'+theme);
  if(theme==='dark'){ await ctx.close(); return; }
  // Completing one with its circle: it waits (R1) and leaves; focus goes on with the other
  await page.tap(RS+' .focuslist .row[data-id=f1] .check'); await calm(page);
  x = await look(); check('focus_complete_one', x.rows.join()==='f2' && x.mode==='2026-11-05' && (await facts(page,'f1')).status==='done', x);
  // Salir del foco, then back in
  await page.tap(RS+' [data-act=focusOff]'); await calm(page); x = await look();
  check('focus_exit', x.seg && x.search && x.close && !x.mode && x.rows.includes('h1'), x);
  await page.tap(RS+' .ahora [data-act=focusOn]'); await calm(page);
  // Completing the last one ends focus mode by itself: the usual Hoy
  await page.tap(RS+' .focuslist .row[data-id=f2] .check'); await calm(page); x = await look();
  check('focus_last_ends', x.seg && !x.mode && !x.rows.includes('f2') && x.rows.includes('h1'), x);
  // A new day ends it too: on, then the clock to Friday and rollOver
  await ev(page, ()=>{ toggleFocus('h1'); }); await calm(page); await page.tap(RS+' .ahora [data-act=focusOn]'); await calm(page);
  check('focus_on_again', (await look()).mode==='2026-11-05');
  await page.clock.setSystemTime(AT(6,9,0)); await ev(page, ()=>{ rollOver(); render(); }); await calm(page); x = await look();
  check('focus_new_day', !x.mode && x.seg, x);
  await ctx.close();
}

/* ======================= 1: focus mode on the desktop ======================= */
async function focusDesk(browser, theme){ let x;
  const {ctx, page} = await open(browser, {tag:'D'+theme, desk:true, theme, now:AT(5,19,30), seed:FOCUS_SEED()});
  await page.click('#desk .main .ahora [data-act=focusOn]'); await calm(page);
  const look = () => ev(page, ()=>{ const m=document.querySelector('#desk .main'); return {focus:m.classList.contains('focusmain'), rows:[...m.querySelectorAll('.row')].map(r=>r.dataset.id),
    side:!!document.querySelector('#desk .side, #desk aside, #desk .sidebar'), addbar:!!m.querySelector('.addbar, [data-role=addbar], .add-bar'), colhead:!!m.querySelector('.colhead'), agenda:!!m.querySelector('.hagenda'),
    search:!!m.querySelector('.searchbar'), close:!!m.querySelector('.closecell'), exit:(m.querySelector('[data-act=focusOff]')||{}).textContent||'', h1:(m.querySelector('h1')||{}).textContent||'', mode:DB.settings.focusMode||null, view:UI.deskView}; });
  x = await look();
  check('desk_focus_'+theme, x.focus && x.rows.join()==='f1,f2' && x.side && !x.addbar && !x.colhead && !x.agenda && !x.search && !x.close && x.exit==='Salir del foco' && x.h1==='Ahora2', x);
  await shot(page, 'd1-focus-'+theme);
  if(theme==='dark'){ await ctx.close(); return; }
  // A click on a row opens the inspector beside it; completing from the keyboard (C) works as anywhere
  await page.click('#desk .main .row[data-id=f1] .row-title'); await until(page, ()=>!!document.querySelector('#desk .pane'));
  await shot(page, 'd2-focus-inspector');
  check('desk_focus_pane', await ev(page, ()=>UI.deskDetail==='f1'||detailTaskId()==='f1'));
  // Salir del foco
  await page.click('#desk .main [data-act=focusOff]'); await calm(page); x = await look();
  check('desk_exit', !x.focus && !x.mode && x.rows.includes('h1') && x.search, x);
  // Another view of the sidebar ends it
  await page.click('#desk .main .ahora [data-act=focusOn]'); await calm(page);
  await ev(page, ()=>setDeskView('todas')); await calm(page); x = await look();
  check('desk_other_view', !x.focus && !x.mode && x.view==='todas', x);
  await ev(page, ()=>setDeskView('hoy')); await calm(page); x = await look(); check('desk_back_hoy_normal', !x.focus, x);
  await ctx.close();
}

(async()=>{
  await new Promise(res=>srv.listen(PORT,res)); const browser = await chromium.launch();
  const run = async (name, fn) => { try{ await fn(); }catch(e){ fails.push(name+'_exception'); errors.push(name+': '+String(e&&e.stack||e)); } };
  await run('engine', ()=>engine(browser));
  await run('roll', ()=>roll(browser));
  await run('close', ()=>closeDay(browser));
  await run('custom_light', ()=>custom(browser, 'light'));
  await run('custom_dark', ()=>custom(browser, 'dark'));
  await run('focus_light', ()=>focusPhone(browser, 'light'));
  await run('focus_dark', ()=>focusPhone(browser, 'dark'));
  await run('desk_light', ()=>focusDesk(browser, 'light'));
  await run('desk_dark', ()=>focusDesk(browser, 'dark'));
  console.log(JSON.stringify({r, fails, errors}, null, 1));
  await browser.close(); srv.close(); process.exit(fails.length||errors.length?1:0);
})();
