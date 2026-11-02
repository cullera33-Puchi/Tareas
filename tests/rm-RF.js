require('./lib/out.js'); // outputs (screenshots, downloads) go to tests/out
// Decisions 38 (tasks that repeat), 39 (Ahora) and 41 (Por confirmar), port 10100. Screenshots in tests/out/rf.
//  1. SQL: supabase/migrations/0004_repeat_focus.sql run twice in PGlite after 0001 to 0003 (stand-ins for auth, pg_cron, pg_net and Storage):
//     the two columns, the write trigger still "newest modified wins" with them, the rules by owner.
//  2. The rule engine in the page: parse, dates of the series (weeks every 2, months, the k-th and last weekday, 31 and 29 February), words.
//  3. iPhone, clock at Wednesday 4 November 2026 10:00: Repetir in the detail (anchored menu, Personalizada sheet), an undated task dated by
//     its rule, completing with the circle (R1 hold), the row menu, Lo primero and in bulk, each with Deshacer taking the next one back,
//     "Eliminar solo esta" and "Eliminar la serie" (also in bulk), rollOver with no copies, the row indicator, share text and CSV.
//     Ahora: from the long-press menu, the block above the summary in order, compact rows, the sixth refused, the star of the detail,
//     completing and deleting take tasks out, a new day empties it, the star in the list rows.
//  4. Desktop: the inspector's Repetir (Mac menu and popover), the key A, the context menu, drags onto the sidebar entry and onto the block,
//     the Ahora view with the keys, the three-button alert on Supr, C on a repeating task, the calendar card's icon.
//  3 and 4 also cover Por confirmar: marking it from the menus (sheet and popover), the folded block, the sidebar view, Revisar on the review day,
//     rollOver leaving it, Ahora refused, completing (also in a series) and Volver a pendiente with Deshacer, search, share and CSV.
//  5. Sync with rm-S's fake server, two devices: both fields go up and come down, a task without them keeps its signature, a cleared value
//     is cleared on the server, only the device that completes a task of a series creates the next, and a database without the columns
//     (0004 not run) is tolerated: logged once per column, the values stay on the device, nothing loops.
const { chromium } = require('playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = path.resolve(__dirname, '..'), PORT = 10100, URL0 = 'http://localhost:'+PORT+'/';
const OUT = path.join(__dirname, 'out', 'rf'); fs.mkdirSync(OUT, {recursive:true});
const DEPS = path.join(ROOT, 'node_modules');
const TYPES = {'.html':'text/html','.css':'text/css','.js':'application/javascript','.webmanifest':'application/manifest+json','.png':'image/png'};
const srv = http.createServer((req,res)=>{ let p = decodeURIComponent(req.url.split('?')[0]); if(p==='/') p='/index.html';
  if(p==='/config.js'){ res.writeHead(200,{'Content-Type':'application/javascript'}); res.end('window.TAREAS_CONFIG = {"url":null,"anonKey":null};\n'); return; }
  const f=path.join(ROOT,p); if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){ res.writeHead(404,{'Content-Type':'text/html'}); res.end('<h1>404</h1>'); return; }
  res.writeHead(200,{'Content-Type':TYPES[path.extname(f)]||'application/octet-stream'}); res.end(fs.readFileSync(f)); });
const r={}, fails=[], errors=[]; const check=(name, ok, info)=>{ r[name]=ok?true:(info===undefined?false:info); if(!ok) fails.push(name); };
const sleep=ms=>new Promise(res=>setTimeout(res,ms));
const shot=(page, name)=>page.screenshot({path:path.join(OUT, name+'.png')});

/* ======================= 1. SQL ======================= */
async function sqlTests(){
  const { PGlite } = await import(path.join(DEPS, '@electric-sql/pglite/dist/index.js'));
  const db = new PGlite();
  await db.exec(`
    create role authenticated; create role anon; create role service_role; create schema auth; create schema extensions;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
    grant usage on schema auth to authenticated, anon; grant execute on function auth.uid() to authenticated, anon;
    create schema cron; create table cron.job (jobid serial primary key, jobname text unique, schedule text, command text);
    create function cron.schedule(n text, s text, c text) returns bigint language sql as $$ insert into cron.job (jobname, schedule, command) values (n, s, c) returning jobid $$;
    create function cron.unschedule(n text) returns boolean language sql as $$ delete from cron.job where jobname = n returning true $$;
    create schema net; create function net.http_post(url text, body jsonb default '{}', params jsonb default '{}', headers jsonb default '{}', timeout_milliseconds int default 5000) returns bigint language sql as $$ select 1::bigint $$;
    create schema storage;
    create table storage.buckets (id text primary key, name text not null, public boolean default false, file_size_limit bigint, allowed_mime_types text[], created_at timestamptz default now());
    create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets (id), name text, owner uuid, created_at timestamptz default now(), unique (bucket_id, name));
    create function storage.foldername(name text) returns text[] language plpgsql as $$ declare p text[]; begin p := string_to_array(name, '/'); return p[1:array_length(p, 1) - 1]; end $$;
    alter table storage.objects enable row level security;
    grant usage on schema storage to authenticated, anon; grant select, insert, update, delete on storage.objects to authenticated;
    grant usage on schema public to service_role;
  `);
  const strip = s => s.replace(/^create extension if not exists pg_(cron|net).*$/mg, '-- (extension stand-in)');
  const rd = f => fs.readFileSync(path.join(ROOT, 'supabase/migrations', f), 'utf8');
  await db.exec(rd('0001_init.sql')); await db.exec(strip(rd('0002_push.sql'))); await db.exec(rd('0003_attachments.sql'));
  let err = null; try { await db.exec(rd('0004_repeat_focus.sql')); await db.exec(rd('0004_repeat_focus.sql')); } catch(e){ err = e.message; }
  check('sql_runs_twice', !err, err);
  const q = async (sql, params) => (await db.query(sql, params)).rows;
  const tryq = async (sql, params) => { try { return {rows: await q(sql, params)}; } catch(e){ return {error: e.message}; } };
  const cols = await q(`select column_name, data_type from information_schema.columns where table_schema='public' and table_name='tasks' and column_name in ('repeat','focus') order by column_name`);
  check('sql_columns', cols.map(c=>c.column_name+':'+c.data_type).join()==='focus:timestamp with time zone,repeat:text', cols);
  const wf = await q(`select data_type from information_schema.columns where table_schema='public' and table_name='tasks' and column_name='waiting_for'`);
  const cons = await q(`select conname from pg_constraint where conrelid='public.tasks'::regclass and contype='c'`);
  check('sql_waiting_for', wf.length===1 && wf[0].data_type==='text' && cons.filter(c=>/status/.test(c.conname)).length===1, {wf, cons});
  const A = '00000000-0000-4000-8000-00000000000a', Bu = '00000000-0000-4000-8000-00000000000b';
  await db.exec(`insert into auth.users values ('${A}'), ('${Bu}')`);
  const as = async (uid, fn) => { await db.exec(`set test.uid = '${uid}'; set role authenticated;`); try { return await fn(); } finally { await db.exec(`reset role; reset test.uid;`); } };
  const ins = await as(A, () => tryq(`insert into public.tasks (id, title, repeat, focus, modified) values ('t1', 'Informe', 'W2:MO,TH@2026-11-02#abc', '2026-11-04T09:00:00Z', '2026-11-04T09:00:00Z') returning owner_id, repeat, focus`));
  check('sql_insert', ins.rows && ins.rows[0].owner_id===A && ins.rows[0].repeat==='W2:MO,TH@2026-11-02#abc' && !!ins.rows[0].focus, ins);
  const older = await as(A, () => tryq(`update public.tasks set repeat = null, modified = '2026-11-03T00:00:00Z' where id = 't1' returning id`));
  const newer = await as(A, () => tryq(`update public.tasks set focus = null, modified = '2026-11-04T10:00:00Z' where id = 't1' returning id`));
  const t1 = (await q(`select repeat, focus from public.tasks where id = 't1'`))[0];
  check('sql_newest_wins', older.rows && !older.rows.length && newer.rows && newer.rows.length===1 && t1.repeat==='W2:MO,TH@2026-11-02#abc' && t1.focus===null, {older, newer, t1});
  const wOk = await as(A, () => tryq(`insert into public.tasks (id, title, status, waiting_for, modified) values ('t2', 'Firmar', 'waiting', 'Ramiro', now()) returning status, waiting_for`));
  const wBad = await as(A, () => tryq(`insert into public.tasks (id, title, status, modified) values ('t3', 'Mal', 'later', now())`));
  check('sql_waiting_status', wOk.rows && wOk.rows[0].status==='waiting' && wOk.rows[0].waiting_for==='Ramiro' && !!wBad.error && /check constraint/.test(wBad.error), {wOk, wBad});
  const seenB = await as(Bu, () => tryq(`select id from public.tasks`));
  check('sql_rls', seenB.rows && seenB.rows.length===0, seenB);
  await db.close();
}

/* ======================= Pages ======================= */
const NOW = new Date(2026, 10, 4, 10, 0, 0); // Wednesday 4 November 2026, 10:00 local
const T0 = '2026-11-04T08:00:00.000Z';
const iso = (y, mo, d, h, mi) => new Date(y, mo-1, d, h, mi||0).toISOString();
const tk = (id, o) => Object.assign({id, title:id, spaceId:'trabajo', projectId:null, date:'2026-11-04', reminder:null, priority:'none', status:'pending', notes:'', carried:false, created:T0, modified:T0, completed:null}, o);
const SEED = { spaces:[{id:'trabajo',name:'Trabajo',order:0,created:T0},{id:'personal',name:'Personal',order:1,created:T0}],
  projects:[{id:'p1', spaceId:'trabajo', name:'FLC', color:'#007AFF', order:0, archived:false, created:T0, modified:T0}],
  tasks:[ tk('r1', {title:'Informe semanal', projectId:'p1', priority:'high', notes:'Con cifras', reminder:iso(2026,11,4,16,0)}),
    tk('r2', {title:'Revisar correo', date:null}),
    tk('r3', {title:'Pagar alquiler', repeat:'M1:1@2026-11-01#ser3', created:'2026-11-01T08:00:00.000Z', modified:'2026-11-01T08:00:00.000Z'}),
    tk('a1', {title:'Llamar a Marta'}), tk('a2', {title:'Enviar acta', projectId:'p1'}), tk('a3', {title:'Preparar comité', priority:'mid'}),
    tk('a4', {title:'Leer contrato'}), tk('a5', {title:'Pedir presupuesto'}), tk('a6', {title:'Ordenar carpeta'}) ],
  voiceNotes:[{id:'v1', taskId:'r1', text:'Añadir el gráfico', created:T0}], attachments:[], settings:{tipsSeen:true} };
async function open(browser, o){
  const vp = o.desk ? {viewport:{width:1280,height:800}, deviceScaleFactor:1} : {viewport:{width:390,height:844}, deviceScaleFactor:2, isMobile:true, hasTouch:true};
  const ctx = await browser.newContext(Object.assign(vp, {colorScheme:o.theme||'light'})); const page = await ctx.newPage();
  if(o.clock!==false) await page.clock.install({time:NOW});
  page.on('pageerror', e=>errors.push(o.tag+' pageerror: '+e.message)); page.on('console', m=>{ if(m.type()==='error') errors.push(o.tag+' console: '+m.text()); });
  if(o.fake){ await page.exposeBinding('fakeServer', (src, op, a)=>o.fake.handle(src.page, op, a)); await page.addInitScript(fakeAdapter); await page.addInitScript(u=>{ window.__fakeUser=u; }, USER); }
  await page.addInitScript(s=>{ if(!localStorage.getItem('tareas-v1')) localStorage.setItem('tareas-v1', s); }, JSON.stringify(o.seed||SEED));
  await page.goto(URL0); await page.waitForTimeout(600); return {ctx, page};
}
const ev = (page, fn, arg) => page.evaluate(fn, arg);
const toastText = page => ev(page, ()=>document.querySelector('#toast').classList.contains('on')?document.querySelector('#toastText').textContent:'');
// A menu item by its label (the iPhone menu, or a Mac menu whose key follows the label)
const menuItem = (page, label) => page.locator('#pmenu .pm-it').filter({has: page.locator('.pm-l', {hasText: new RegExp('^'+label.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'$')})}).first();
const series = (page, id) => ev(page, id=>{ const s=repSeries(task(id).repeat); return DB.tasks.filter(x=>repSeries(x.repeat)===s).map(x=>({id:x.id, status:x.status, date:x.date, title:x.title, projectId:x.projectId, priority:x.priority, notes:x.notes, reminder:x.reminder, reminderSent:x.reminderSent||null, vn:DB.voiceNotes.filter(v=>v.taskId===x.id).length, repeat:x.repeat})); }, id);

/* ======================= 2 and 3. Engine and iPhone ======================= */
async function iphone(browser){
  const {ctx, page} = await open(browser, {tag:'M'});
  // 2. The engine
  const E = await ev(page, ()=>{ const nx=(s,a)=>repNext(s,a), f=(s,d)=>repFirst(s,d);
    return { parse:[repParse('W2:MO,TH@2026-11-02#abc'), repParse('M1:LFR'), repParse('X1'), repParse('W1:'), repParse('M1:32'), repParse('Y1:13-01')].map(x=>x&&repString(x)),
      w2:[nx('W2:MO,TH@2026-11-02','2026-11-02'), nx('W2:MO,TH@2026-11-02','2026-11-05'), nx('W2:MO,TH@2026-11-02','2026-11-16')],
      d3:[nx('D3@2026-11-04','2026-11-04'), f('D3@2026-11-04','2026-11-08')], wd:[nx('WD','2026-11-06'), f('WD','2026-11-07')],
      m31:[nx('M1:31@2026-10-31','2026-10-31'), nx('M1:31@2026-10-31','2026-11-30')], m2:nx('M2:15@2026-11-15','2026-11-15'),
      nth:[f('M1:1MO','2026-11-04'), f('M1:LFR','2026-11-04'), f('M1:4SU','2026-11-04'), nx('M3:2TU@2026-11-10','2026-11-10')],
      y:[nx('Y1:02-29@2028-02-29','2028-02-29'), nx('Y1:11-03@2026-11-03','2026-11-04')],
      words:['D1','D3','WD','W1:WE','W1:MO,TH','W2:MO,WE,FR','W1:MO,TU,WE,TH,FR,SA,SU','M1:15','M3:15','M1:1MO','M1:LFR','M2:3TU','Y1:11-03'].map(repSummary),
      presets:['daily','work','week','week2','month','year'].map(k=>repPreset(k,'2026-11-04')), of:['D1','WD','W1:WE','W2:MO','W1:MO,TH','M1:4','M1:1MO','Y1:11-04','D2'].map(repPresetOf),
      dayWords:[dayWords('2026-11-05'), dayWords('2026-11-16'), dayWords('2026-12-01')] }; });
  check('engine_parse', JSON.stringify(E.parse)===JSON.stringify(['W2:MO,TH@2026-11-02#abc','M1:LFR',null,null,null,null]), E.parse);
  check('engine_weeks2', E.w2.join()==='2026-11-05,2026-11-16,2026-11-19', E.w2);
  check('engine_days_weekdays', E.d3.join()==='2026-11-07,2026-11-10' && E.wd.join()==='2026-11-09,2026-11-09', {d3:E.d3, wd:E.wd});
  check('engine_months', E.m31.join()==='2026-11-30,2026-12-31' && E.m2==='2027-01-15', {m31:E.m31, m2:E.m2});
  check('engine_nth', E.nth.join()==='2026-12-07,2026-11-27,2026-11-22,2027-02-09', E.nth);
  check('engine_years', E.y.join()==='2029-02-28,2027-11-03', E.y);
  check('engine_words', JSON.stringify(E.words)===JSON.stringify(['Cada día','Cada 3 días','Cada día laborable','Cada semana, miércoles','Cada semana, lunes y jueves','Cada 2 semanas, lunes, miércoles y viernes','Cada semana, todos los días','Cada mes, el día 15','Cada 3 meses, el día 15','El primer lunes de cada mes','El último viernes de cada mes','El tercer martes cada 2 meses','Cada año, el 3 de noviembre']), E.words);
  check('engine_presets', E.presets.join()==='D1,WD,W1:WE,W2:WE,M1:4,Y1:11-04' && E.of.join()==='daily,work,week,week2,custom,month,custom,year,custom', {p:E.presets, of:E.of});
  check('engine_dayWords', E.dayWords.join('|')==='mañana|el lunes 16|el martes 1 de diciembre', E.dayWords);

  // 3a. Repetir in the iPhone detail
  const L = '.screen.root[data-root=tareas]';
  await page.tap(L+' .row[data-id=r1]:not(.first .row) .row-title'); await sleep(800);
  const d0 = await ev(page, ()=>{ const c=[...document.querySelectorAll('.pushed-screen.detail .cell')].find(c=>c.dataset.act==='pickRepeat'); return c&&c.textContent; });
  check('detail_repeat_row', d0==='RepetirNunca', d0);
  await page.tap('.pushed-screen.detail [data-act=pickRepeat]'); await sleep(550); await shot(page, 'm1-repeat-menu');
  const items = await ev(page, ()=>[...document.querySelectorAll('#pmenu .pm-it .pm-l')].map(e=>e.textContent));
  check('repeat_menu_items', items.join('|')==='Nunca|Cada día|Cada día laborable|Cada semana|Cada 2 semanas|Cada mes|Cada año|Personalizada', items);
  await menuItem(page, 'Cada semana').tap(); await sleep(500);
  let x = await ev(page, ()=>({rep:task('r1').repeat, val:document.querySelector('.pushed-screen.detail [data-act=pickRepeat] .val').textContent}));
  check('repeat_weekly', /^W1:WE@2026-11-04#[\w-]+$/.test(x.rep) && x.val==='Cada semana, miércoles' && /^Se repite: cada semana, miércoles$/.test(await toastText(page)), x);
  const ser1 = x.rep.split('#')[1];
  // Personalizada: every 2 weeks on Monday and Thursday
  await page.tap('.pushed-screen.detail [data-act=pickRepeat]'); await sleep(550); await menuItem(page, 'Personalizada').tap(); await sleep(700);
  const tapRp = async k => { await page.tap('#sheet [data-rp="'+k+'"]'); await sleep(120); };
  await tapRp('n+'); await tapRp('d:3'); await tapRp('d:1'); await tapRp('d:4');
  const sum1 = await ev(page, ()=>document.querySelector('#sheet .rpsum').textContent); await shot(page, 'm2-repeat-custom-weeks');
  await tapRp('ok'); await sleep(500);
  x = await ev(page, ()=>({rep:task('r1').repeat, val:document.querySelector('.pushed-screen.detail [data-act=pickRepeat] .val').textContent}));
  check('repeat_custom_weeks', sum1==='Cada 2 semanas, lunes y jueves' && x.rep==='W2:MO,TH@2026-11-04#'+ser1 && x.val==='Cada 2 semanas, lunes y jueves', {sum1, x});
  // Personalizada: the first Monday of each month
  await page.tap('.pushed-screen.detail [data-act=pickRepeat]'); await sleep(550); await menuItem(page, 'Personalizada').tap(); await sleep(700);
  await tapRp('u:M'); await tapRp('m:nth'); await tapRp('o:1'); await tapRp('w:1'); await tapRp('n-');
  const sum2 = await ev(page, ()=>document.querySelector('#sheet .rpsum').textContent); await shot(page, 'm3-repeat-custom-month');
  await tapRp('ok'); await sleep(400);
  x = await ev(page, ()=>task('r1').repeat);
  check('repeat_custom_month', sum2==='El primer lunes de cada mes' && x==='M1:1MO@2026-11-04#'+ser1, {sum2, x});
  // Deshacer of the rule, then back to every 2 weeks for what follows
  await page.tap('#toastBtn'); await sleep(300); x = await ev(page, ()=>task('r1').repeat);
  check('repeat_undo', x==='W2:MO,TH@2026-11-04#'+ser1, x);
  await shot(page, 'm4-detail-repeat');
  await page.tap('.pushed-screen.detail [data-act=back]'); await sleep(700);
  // An undated task gets the first date of its series (today counts)
  await ev(page, ()=>{ openDetail('r2'); }); await sleep(800);
  await page.tap('.pushed-screen.detail [data-act=pickRepeat]'); await sleep(550); await menuItem(page, 'Cada día laborable').tap(); await sleep(400);
  x = await ev(page, ()=>({rep:task('r2').repeat, date:task('r2').date})); const t2 = await toastText(page);
  check('repeat_undated', /^WD@2026-11-04#/.test(x.rep) && x.date==='2026-11-04' && t2==='Se repite: cada día laborable, desde hoy', {x, t2});
  await page.tap('.pushed-screen.detail [data-act=back]'); await sleep(700);
  check('row_indicator', await ev(page, L=>!!document.querySelector(L+' .row[data-id=r1]:not(.first .row) .inds .irp') && !document.querySelector(L+' .row[data-id=a1] .inds .irp'), L));

  // 3b. Completing a task of a series: the circle (R1), then Deshacer
  await ev(page, ()=>{ document.querySelector('#toast').classList.remove('on'); });
  await page.tap(L+' .row[data-id=r1]:not(.first .row) .check'); await sleep(2300);
  let s = await series(page, 'r1'); const tc = await toastText(page);
  const nx = s.find(o=>o.id!=='r1');
  check('complete_creates_next', s.length===2 && s.find(o=>o.id==='r1').status==='done' && nx && nx.status==='pending' && nx.date==='2026-11-05' && nx.title==='Informe semanal' && nx.projectId==='p1' && nx.priority==='high' && nx.notes==='Con cifras'
    && nx.reminder===new Date(2026,10,5,16,0).toISOString() && !nx.reminderSent && nx.vn===0 && s.find(o=>o.id==='r1').vn===1 && nx.repeat===s[0].repeat, s);
  check('complete_toast', tc==='Tarea completada, la siguiente mañana', tc);
  await shot(page, 'm5-completed-next');
  await page.tap('#toastBtn'); await sleep(500); s = await series(page, 'r1');
  check('complete_undo', s.length===1 && s[0].id==='r1' && s[0].status==='pending', s);
  // From the row menu
  await ev(page, ()=>rowMenu('r1')); await sleep(600); await menuItem(page, 'Completar').tap(); await sleep(700);
  s = await series(page, 'r1'); check('menu_complete', s.length===2 && s.filter(o=>o.status==='pending').length===1, s);
  await page.tap('#toastBtn'); await sleep(500); s = await series(page, 'r1'); check('menu_complete_undo', s.length===1 && s[0].status==='pending', s);
  // From Lo primero (r1 is today's high priority)
  await ev(page, ()=>{ DB.settings.summaryState='open'; save(); render(); }); await sleep(300);
  await page.tap(L+' .summary .first .row[data-id=r1] .check'); await sleep(2300);
  s = await series(page, 'r1'); check('first_complete', s.length===2 && s.find(o=>o.id==='r1').status==='done', s);
  await page.tap('#toastBtn'); await sleep(500); s = await series(page, 'r1'); check('first_complete_undo', s.length===1, s);
  // In bulk: two series, two next tasks, one Deshacer
  await ev(page, ()=>{ startSelect(null); UI.select.ids.add('r1'); UI.select.ids.add('r3'); bulkComplete(); }); await sleep(500);
  let b = await ev(page, ()=>({r1:DB.tasks.filter(x=>repSeries(x.repeat)===repSeries(task('r1').repeat)).length, r3:DB.tasks.filter(x=>repSeries(x.repeat)==='ser3').map(x=>x.status+':'+x.date).sort(), t:document.querySelector('#toastText').textContent}));
  check('bulk_complete', b.r1===2 && b.r3.join()==='done:2026-11-04,pending:2026-12-01' && b.t==='2 tareas completadas', b);
  await page.tap('#toastBtn'); await sleep(500);
  b = await ev(page, ()=>({n:DB.tasks.length, r1:task('r1').status, r3:task('r3').status})); check('bulk_complete_undo', b.n===9 && b.r1==='pending' && b.r3==='pending', b);
  // Reopening a completed task of a series takes its untouched next one back; one pending at a time
  await ev(page, ()=>{ completeTask('r3', true); }); s = await series(page, 'r3');
  await ev(page, ()=>{ completeTask('r3', true); }); const s2 = await series(page, 'r3');
  check('reopen_drops_next', s.length===2 && s2.length===1 && s2[0].status==='pending', {s, s2});

  // 3c. Deleting a task of a series
  await ev(page, ()=>confirmDelete('r1')); await sleep(600); await shot(page, 'm6-delete-repeating');
  const opts = await ev(page, ()=>({t:document.querySelector('#asheet .t').textContent, b:[...document.querySelectorAll('#asheet .it')].map(e=>e.textContent)}));
  check('delete_asks', opts.b.join('|')==='Eliminar solo esta|Eliminar la serie|Cancelar' && /se repite/.test(opts.t), opts);
  await page.tap('#asheet .it[data-i="0"]'); await sleep(700);
  x = await ev(page, ()=>({d:task('r1').date, c:task('r1').carried, rem:task('r1').reminder, t:document.querySelector('#toastText').textContent}));
  check('delete_only_this', x.d==='2026-11-05' && x.c===false && x.rem===new Date(2026,10,5,16,0).toISOString() && x.t==='Eliminada solo esta, la siguiente mañana', x);
  await page.tap('#toastBtn'); await sleep(400); x = await ev(page, ()=>({d:task('r1').date, rem:task('r1').reminder}));
  check('delete_only_undo', x.d==='2026-11-04' && x.rem===new Date(2026,10,4,16,0).toISOString(), x);
  await ev(page, ()=>confirmDelete('r1')); await sleep(600); await page.tap('#asheet .it[data-i="1"]'); await sleep(700);
  const gone = await ev(page, ()=>!task('r1')); await page.tap('#toastBtn'); await sleep(400);
  check('delete_series', gone && await ev(page, ()=>!!task('r1') && DB.voiceNotes.some(v=>v.taskId==='r1')), gone);
  // In bulk: asked once
  await ev(page, ()=>{ startSelect(null); ['r1','r3','a6'].forEach(i=>UI.select.ids.add(i)); bulkDelete(); }); await sleep(600);
  const bo = await ev(page, ()=>[...document.querySelectorAll('#asheet .it')].map(e=>e.textContent)); await shot(page, 'm7-bulk-delete');
  await page.tap('#asheet .it[data-i="0"]'); await sleep(700);
  x = await ev(page, ()=>({r1:task('r1')&&task('r1').date, r3:task('r3')&&task('r3').date, a6:!!task('a6'), t:document.querySelector('#toastText').textContent}));
  check('bulk_delete_only', bo.join('|')==='Eliminar solo estas|Eliminar las series|Cancelar' && x.r1==='2026-11-05' && x.r3==='2026-12-01' && !x.a6 && x.t==='1 tarea eliminada, 2 pasadas a su siguiente fecha', {bo, x});
  await page.tap('#toastBtn'); await sleep(400);
  x = await ev(page, ()=>({r1:task('r1').date, r3:task('r3').date, a6:!!task('a6')})); check('bulk_delete_undo', x.r1==='2026-11-04' && x.r3==='2026-11-04' && x.a6, x);
  // rollOver: a carried task of a series stays one task
  x = await ev(page, ()=>{ const n0=DB.tasks.length; task('r3').date='2026-11-02'; DB.settings.summaryDay='2026-11-03'; save(); rollOver(); return {n:DB.tasks.length-n0, d:task('r3').date, c:task('r3').carried}; });
  check('rollover_single', x.n===0 && x.d==='2026-11-04' && x.c===true, x);
  // Share text and CSV
  x = await ev(page, ()=>({share:shareText('r1'), csv:csvText()}));
  const head = x.csv.split('\r\n')[0];
  check('share_csv', /\nSe repite: cada 2 semanas, lunes y jueves\n/.test(x.share) && /"Recordatorio";"Se repite";"Esperando a";"Aplazada"/.test(head) && x.csv.includes('"Cada 2 semanas, lunes y jueves"') && x.csv.includes('"Cada mes, el día 1"'), {share:x.share, head});

  // 3c bis. Por confirmar (decision 41)
  await ev(page, ()=>rowMenu('a6')); await sleep(600); await menuItem(page, 'Por confirmar').tap(); await sleep(700);
  x = await ev(page, ()=>({on:document.querySelector('#sheet').classList.contains('on'), chips:[...document.querySelectorAll('#sheet .wchips .chip')].map(c=>c.textContent+(c.classList.contains('on')?'*':'')), line:document.querySelector('#sheet .wline').textContent}));
  check('wait_sheet', x.on && x.chips.join()==='Mañana*,En 3 días,Próxima semana,Sin fecha' && x.line==='Vuelve a Hoy mañana, marcada Revisar.', x);
  await page.fill('#sheet [data-role=waitfor]', 'Ramiro'); await page.tap('#sheet [data-wd="3d"]'); await sleep(200); await shot(page, 'm12-waiting-sheet');
  await page.tap('#sheet [data-x=ok]'); await sleep(700);
  x = await ev(page, L=>({st:task('a6').status, who:task('a6').waitingFor, d:task('a6').date, t:document.querySelector('#toastText').textContent, inList:!!document.querySelector(L+' .row[data-id=a6]'), hoy:pendingFor('hoy').some(x=>x.id==='a6'), btn:(document.querySelector(L+' .wblock .cell')||{}).textContent}), L);
  check('wait_mark', x.st==='waiting' && x.who==='Ramiro' && x.d==='2026-11-07' && x.t==='Por confirmar, esperando a Ramiro, revisar el sábado 7' && !x.inList && !x.hoy && x.btn==='Por confirmar (1)', x);
  await page.tap(L+' .wblock .cell'); await sleep(400);
  x = await ev(page, L=>{ const r=document.querySelector(L+' .gsec[data-waiting] .row[data-id=a6]'); return r&&{meta:r.querySelector('.row-meta').textContent, half:r.querySelector('.check').classList.contains('waiting')}; }, L);
  await ev(page, L=>{ const e=document.querySelector(L+' .gsec[data-waiting]'); e&&e.scrollIntoView({block:'center'}); }, L); await ev(page, ()=>document.querySelector('#toast').classList.remove('on')); await sleep(200); await shot(page, 'm13-waiting-block');
  check('wait_block', x && x.meta==='SábadoEsperando a Ramiro' && x.half, x);
  // Its review day: back in Hoy, marked Revisar, counted; rollOver never carries it
  x = await ev(page, L=>{ updTask('a6', {date:'2026-11-02'}); task('a6').status='waiting'; DB.settings.summaryDay='2026-11-03'; save(); rollOver(); render(); const r=document.querySelector(L+' .row[data-id=a6]:not(.first .row)');
    return {d:task('a6').date, c:task('a6').carried, st:task('a6').status, hoy:pendingFor('hoy').some(x=>x.id==='a6'), meta:r&&r.querySelector('.row-meta').textContent, block:!!document.querySelector(L+' .wblock')}; }, L);
  check('wait_review_day', x.d==='2026-11-02' && !x.c && x.st==='waiting' && x.hoy && x.meta==='RevisarEsperando a Ramiro' && !x.block, x);
  await ev(page, ()=>updTask('a6', {date:'2026-11-07'}));
  // Not in Ahora; marking a task in Ahora takes it out, Deshacer puts it back
  x = await ev(page, ()=>{ const no=toggleFocus('a6'); toggleFocus('a1'); setWaiting('a1', '', undefined); const mid={st:task('a1').status, f:task('a1').focus||null}; undoFn(); return {no, mid, st:task('a1').status, f:!!task('a1').focus}; });
  check('wait_ahora', x.no===false && x.mid.st==='waiting' && !x.mid.f && x.st==='pending' && x.f, x);
  await ev(page, ()=>toggleFocus('a1'));
  // Completing it with the circle (R1 hold), with Deshacer back to waiting; in a series the next one comes as usual
  await page.tap(L+' .gsec[data-waiting] .row[data-id=a6] .check'); await sleep(2300);
  x = await ev(page, ()=>task('a6').status); await page.tap('#toastBtn'); await sleep(400);
  check('wait_complete', x==='done' && await ev(page, ()=>task('a6').status==='waiting'), x);
  x = await ev(page, ()=>{ setWaiting('r3', 'Banco', '2026-11-05'); completeTask('r3'); const xs=DB.tasks.filter(o=>repSeries(o.repeat)==='ser3').map(o=>o.status+':'+o.date).sort(); undoFn(); return {xs, after:DB.tasks.filter(o=>repSeries(o.repeat)==='ser3').map(o=>o.status)}; });
  check('wait_series', x.xs.join()==='done:2026-11-05,pending:2026-12-01' && x.after.join()==='waiting', x);
  // Search finds it by who it waits for; share and CSV say it
  x = await ev(page, ()=>{ UI.query='ramiro'; const h=listHTML('todas'); UI.query=''; return {found:h.includes('data-id="a6"'), share:shareText('a6'), csv:csvText().split('\r\n').find(l=>l.includes('Ordenar carpeta'))}; });
  check('wait_search_share_csv', x.found && /\nEstado: por confirmar, esperando a Ramiro\n/.test(x.share) && /"Por confirmar";.*"Ramiro"/.test(x.csv), x);
  // The detail shows it; Volver a pendiente from the row menu
  await ev(page, ()=>openDetail('a6')); await sleep(800);
  x = await ev(page, ()=>{ const c=document.querySelector('.pushed-screen.detail [data-act=pickWaiting]'); return c&&c.textContent; }); await shot(page, 'm14-waiting-detail');
  await page.tap('.pushed-screen.detail [data-act=back]'); await sleep(700);
  check('wait_detail', x==='Por confirmarEsperando a Ramiro', x);
  await ev(page, ()=>rowMenu('a6')); await sleep(600); const wm = await ev(page, ()=>[...document.querySelectorAll('#pmenu .pm-it .pm-l')].map(e=>e.textContent));
  await menuItem(page, 'Volver a pendiente').tap(); await sleep(500);
  x = await ev(page, ()=>({st:task('a6').status, who:task('a6').waitingFor, t:document.querySelector('#toastText').textContent}));
  check('wait_back_pending', wm.includes('Volver a pendiente') && wm.includes('Cambiar Por confirmar') && !wm.includes('Ahora') && x.st==='pending' && !x.who && x.t==='Vuelve a pendiente', {wm, x});
  await page.tap('#toastBtn'); await sleep(300); await ev(page, ()=>unWait('a6')); await sleep(200);

  // 3d. Ahora
  await ev(page, ()=>rowMenu('a1')); await sleep(600);
  const mi = await ev(page, ()=>[...document.querySelectorAll('#pmenu .pm-it .pm-l')].map(e=>e.textContent));
  await menuItem(page, 'Ahora').tap(); await sleep(600);
  x = await ev(page, L=>{ const sc=document.querySelector(L+' .scroll'), ah=sc.querySelector('.ahora'), su=sc.querySelector('.summary');
    return {focus:!!task('a1').focus, block:!!ah, before:!!(ah&&su&&(ah.compareDocumentPosition(su)&Node.DOCUMENT_POSITION_FOLLOWING)), n:ah&&ah.querySelector('.gn').textContent, t:document.querySelector('#toastText').textContent}; }, L);
  check('ahora_from_menu', mi.includes('Ahora') && x.focus && x.block && x.before && x.n==='1' && x.t==='Añadida a Ahora', {mi, x});
  for(const id of ['a2','a3','a4','a5']){ await ev(page, id=>toggleFocus(id), id); await sleep(30); }
  await ev(page, ()=>rowMenu('a6')); await sleep(600); await menuItem(page, 'Ahora').tap(); await sleep(500);
  x = await ev(page, L=>({a6:task('a6').focus||null, t:document.querySelector('#toastText').textContent, ids:[...document.querySelectorAll(L+' .ahora .row')].map(e=>e.dataset.id), n:document.querySelector(L+' .ahora .gn').textContent}), L);
  check('ahora_max', !x.a6 && x.t==='Ahora ya tiene 5 tareas. Quita una antes.' && x.ids.join()==='a1,a2,a3,a4,a5' && x.n==='5', x);
  x = await ev(page, L=>{ const row=document.querySelector(L+' .ahora .row[data-id=a2]'); return {meta:row.querySelector('.row-meta')&&row.querySelector('.row-meta').textContent, inds:!!row.querySelector('.inds'), pri:!!document.querySelector(L+' .ahora .row[data-id=a3] .pri.mid'), star:!!document.querySelector(L+' .row[data-id=a2]:not(.first .row) .inds .ist')}; }, L);
  check('ahora_compact', x.meta==='FLC' && !x.inds && x.pri && x.star, x);
  await ev(page, ()=>{ document.querySelector('#toast').classList.remove('on'); }); await sleep(100);
  await ev(page, L=>document.querySelector(L+' .scroll').scrollTop=0, L); await shot(page, 'm8-ahora-hoy');
  // A row of the block opens the detail, whose star takes it out (with Deshacer)
  await page.tap(L+' .ahora .row[data-id=a2] .row-title'); await sleep(800);
  x = await ev(page, ()=>({top:UI.stack.length&&UI.stack[UI.stack.length-1].id, star:!!document.querySelector('.pushed-screen.detail .action.star.on')}));
  await shot(page, 'm9-detail-star');
  await page.tap('.pushed-screen.detail [data-act=focus]'); await sleep(400);
  const off = await ev(page, ()=>({f:task('a2').focus||null, star:!!document.querySelector('.pushed-screen.detail .action.star.on'), t:document.querySelector('#toastText').textContent}));
  await page.tap('#toastBtn'); await sleep(400);
  check('ahora_detail_star', x.top==='a2' && x.star && !off.f && !off.star && off.t==='Quitada de Ahora' && await ev(page, ()=>!!task('a2').focus), {x, off});
  await page.tap('.pushed-screen.detail [data-act=back]'); await sleep(700);
  // Completing from the block takes the task out; deleting too
  await page.tap(L+' .ahora .row[data-id=a3] .check'); await sleep(2300);
  x = await ev(page, L=>({st:task('a3').status, f:task('a3').focus||null, n:document.querySelector(L+' .ahora .gn').textContent}), L);
  check('ahora_complete', x.st==='done' && !x.f && x.n==='4', x);
  await ev(page, ()=>deleteTask('a4')); await sleep(200); await ev(page, ()=>render());
  check('ahora_delete', await ev(page, L=>document.querySelector(L+' .ahora .gn').textContent==='3' && ahoraTasks().map(x=>x.id).join()==='a1,a2,a5', L));
  // The real long press: the menu says Quitar de Ahora for a task in it
  const rb = await ev(page, L=>{ const e=document.querySelector(L+' .row[data-id=a5]:not(.first .row)'); e.scrollIntoView({block:'center'}); const q=e.getBoundingClientRect(); return {x:q.x+q.width/2, y:q.y+q.height/2}; }, L);
  const cdp = await page.context().newCDPSession(page); await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:rb.x,y:rb.y}]}); await sleep(700); await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]}); await cdp.detach(); await sleep(400);
  const lp = await ev(page, ()=>[...document.querySelectorAll('#pmenu .pm-it .pm-l')].map(e=>e.textContent)); await shot(page, 'm10-longpress-menu');
  await ev(page, ()=>closeMenu(true));
  check('ahora_longpress_label', lp.includes('Quitar de Ahora'), lp);
  // A new day empties Ahora; the tasks stay in their place
  x = await ev(page, ()=>{ DB.tasks.forEach(t=>{ if(t.focus) t.focus=new Date(2026,10,3,18,0).toISOString(); }); DB.settings.summaryDay='2026-11-03'; save(); rollOver(); render();
    return {n:ahoraTasks().length, block:!!document.querySelector('.screen.root[data-root=tareas] .ahora'), a1:task('a1').status+':'+task('a1').date}; });
  check('ahora_new_day', x.n===0 && !x.block && x.a1==='pending:2026-11-04', x);
  // Dark mode, for a look
  await ev(page, ()=>{ toggleFocus('a1'); toggleFocus('a2'); DB.settings.theme='dark'; save(); applyTheme(); render(); document.querySelector('#toast').classList.remove('on'); }); await sleep(400);
  await ev(page, L=>document.querySelector(L+' .scroll').scrollTop=0, L); await shot(page, 'm11-ahora-dark');
  await ctx.close();
}

/* ======================= 4. Desktop ======================= */
async function desktop(browser){
  const {ctx, page} = await open(browser, {tag:'D', desk:true});
  await ev(page, ()=>setDeskView('hoy')); await sleep(300);
  let x = await ev(page, ()=>{ const its=[...document.querySelectorAll('#desk .side .it[data-view]')].map(e=>e.dataset.view); return {first:its.slice(0,2).join(), n:document.querySelector('#desk .side [data-view=ahora] .n').textContent, block:!!document.querySelector('#desk .main .ahora')}; });
  check('desk_sidebar_entry', x.first==='ahora,hoy' && x.n==='0' && !x.block, x);
  // The key A on the selected row
  await page.click('#desk .main .row[data-id=a1] .row-title'); await sleep(300); await page.keyboard.press('Escape'); await sleep(200);
  await page.keyboard.press('a'); await sleep(400);
  x = await ev(page, ()=>({f:!!task('a1').focus, n:document.querySelector('#desk .side [data-view=ahora] .n').textContent, block:[...document.querySelectorAll('#desk .main .ahora .row')].map(e=>e.dataset.id).join()}));
  check('desk_key_a', x.f && x.n==='1' && x.block==='a1', x);
  // The context menu, with the key shown
  await page.click('#desk .main .row[data-id=a2]:not(.first .row) .row-title', {button:'right'}); await sleep(400);
  const cm = await ev(page, ()=>[...document.querySelectorAll('#pmenu .pm-it')].map(b=>b.querySelector('.pm-l').textContent+'/'+((b.querySelector('.pm-key')||{}).textContent||'')));
  await shot(page, 'd1-context-menu');
  await menuItem(page, 'Ahora').click(); await sleep(400);
  check('desk_context_menu', cm.includes('Ahora/A') && await ev(page, ()=>!!task('a2').focus), cm);
  // Drags: onto the sidebar entry and onto the block
  await page.dragAndDrop('#desk .main .row[data-id=a3]:not(.first .row)', '#desk .side [data-view=ahora]'); await sleep(500);
  await page.dragAndDrop('#desk .main .row[data-id=a4]:not(.first .row)', '#desk .main .ahora'); await sleep(500);
  x = await ev(page, ()=>({f:ahoraTasks().map(x=>x.id).join(), t:document.querySelector('#toastText').textContent}));
  check('desk_drag', x.f==='a1,a2,a3,a4', x);
  await ev(page, ()=>toggleFocus('a5')); await sleep(200);
  await page.click('#desk .main .row[data-id=a6] .row-title'); await sleep(300); await page.keyboard.press('Escape'); await sleep(200); await page.keyboard.press('a'); await sleep(300);
  x = await ev(page, ()=>({f:task('a6').focus||null, t:document.querySelector('#toastText').textContent}));
  check('desk_max', !x.f && x.t==='Ahora ya tiene 5 tareas. Quita una antes.', x);
  await ev(page, ()=>document.querySelector('#toast').classList.remove('on')); await sleep(100); await shot(page, 'd2-hoy-ahora');
  await ev(page, ()=>setDeskView('todas')); await sleep(300);
  check('desk_todas_block', await ev(page, ()=>document.querySelectorAll('#desk .main .ahora .row').length===5));
  // The Ahora view: its own list, with the keys
  await page.click('#desk .side [data-view=ahora]'); await sleep(400);
  x = await ev(page, ()=>({title:document.querySelector('#desk .mhead h1').textContent, ids:[...document.querySelectorAll('#desk .main .ahoralist .row')].map(e=>e.dataset.id)}));
  await shot(page, 'd3-ahora-view');
  await page.keyboard.press('ArrowDown'); await sleep(200); await page.keyboard.press('a'); await sleep(500);
  const y = await ev(page, ()=>({ids:[...document.querySelectorAll('#desk .main .ahoralist .row')].map(e=>e.dataset.id), cur:UI.dsel.cur}));
  await page.keyboard.press('Control+z'); await sleep(400);
  const z = await ev(page, ()=>[...document.querySelectorAll('#desk .main .ahoralist .row')].map(e=>e.dataset.id));
  check('desk_ahora_view', x.title==='Ahora' && x.ids.join()==='a1,a2,a3,a4,a5' && y.ids.join()==='a2,a3,a4,a5' && y.cur==='a2' && z.join()==='a1,a2,a3,a4,a5', {x, y, z});
  // The inspector: Repetir as a Mac menu and a popover; the star
  await ev(page, ()=>setDeskView('hoy')); await sleep(300);
  await page.click('#desk .main .row[data-id=r1]:not(.first .row) .row-title'); await sleep(500);
  const iv = await ev(page, ()=>{ const f=document.querySelector('#desk .pane .iform'); return [...f.querySelectorAll('.ilbl')].map(e=>e.textContent).join()+'|'+f.querySelector('[data-act=pickRepeat] .val').textContent; });
  await page.click('#desk .pane [data-act=pickRepeat]'); await sleep(400); await shot(page, 'd4-repeat-menu');
  await menuItem(page, 'Cada mes').click(); await sleep(400);
  x = await ev(page, ()=>({rep:task('r1').repeat, val:document.querySelector('#desk .pane [data-act=pickRepeat] .val').textContent}));
  check('desk_repeat_menu', iv==='Proyecto,Fecha,Recordatorio,Repetir,Prioridad|Nunca' && /^M1:4@2026-11-04#/.test(x.rep) && x.val==='Cada mes, el día 4', {iv, x});
  await page.click('#desk .pane [data-act=pickRepeat]'); await sleep(400); await menuItem(page, 'Personalizada…').click(); await sleep(500);
  for(const k of ['u:W','d:3','d:2','d:5','n+']){ await page.click('#pmenu .pm-pop [data-rp="'+k+'"]'); await sleep(80); }
  const ps = await ev(page, ()=>document.querySelector('#pmenu .pm-pop .rpsum').textContent); await shot(page, 'd5-repeat-custom');
  await page.click('#pmenu .pm-pop [data-rp=ok]'); await sleep(400);
  x = await ev(page, ()=>task('r1').repeat);
  check('desk_repeat_custom', ps==='Cada 2 semanas, martes y viernes' && /^W2:TU,FR@2026-11-04#/.test(x), {ps, x});
  await page.click('#desk .pane [data-act=focus]'); await sleep(400);
  x = await ev(page, ()=>({t:document.querySelector('#toastText').textContent, star:!!document.querySelector('#desk .pane .ihead .star.on')}));
  check('desk_inspector_star', x.t==='Ahora ya tiene 5 tareas. Quita una antes.' && !x.star, x);
  await ev(page, ()=>removeFromAhora(['a5'])); await sleep(200); await page.click('#desk .pane [data-act=focus]'); await sleep(400);
  check('desk_inspector_star_on', await ev(page, ()=>!!task('r1').focus && !!document.querySelector('#desk .pane .ihead .star.on')));
  await shot(page, 'd6-inspector');
  // C on the selected repeating task: the next one, and Ahora loses the completed one
  await page.keyboard.press('Escape'); await sleep(200); await page.click('#desk .main .row[data-id=r1]:not(.first .row) .row-title'); await sleep(200); await page.keyboard.press('Escape'); await sleep(200);
  await page.keyboard.press('c'); await sleep(800);
  x = await ev(page, ()=>({st:task('r1').status, f:task('r1').focus||null, next:DB.tasks.filter(o=>o.status==='pending'&&repSeries(o.repeat)===repSeries(task('r1').repeat)).map(o=>o.date)}));
  check('desk_key_c', x.st==='done' && !x.f && x.next.join()==='2026-11-06', x);
  // Supr on a repeating task: a macOS alert with three buttons
  await page.click('#desk .main .row[data-id=r3]:not(.first .row) .row-title'); await sleep(200); await page.keyboard.press('Escape'); await sleep(200); await page.keyboard.press('Delete'); await sleep(500);
  const al = await ev(page, ()=>[...document.querySelectorAll('#asheet .al-b.al-v .al-btn')].map(b=>b.textContent)); await shot(page, 'd7-delete-alert');
  await page.keyboard.press('Enter'); await sleep(600); // Intro: the default button, only this one
  x = await ev(page, ()=>task('r3')&&task('r3').date);
  check('desk_delete_alert', al.join('|')==='Eliminar solo esta|Eliminar la serie|Cancelar' && x==='2026-12-01', {al, x});
  // Por confirmar from the context menu: a popover, Intro saves; the block, the sidebar view, C and Deshacer
  await page.click('#desk .main .row[data-id=a6]:not(.first .row) .row-title', {button:'right'}); await sleep(400); await menuItem(page, 'Por confirmar…').click(); await sleep(400);
  await page.keyboard.type('Ramiro'); await shot(page, 'd10-waiting-popover'); await page.keyboard.press('Enter'); await sleep(500);
  x = await ev(page, ()=>({st:task('a6').status, who:task('a6').waitingFor, d:task('a6').date, blk:(document.querySelector('#desk .main .wblock .cell')||{}).textContent, n:document.querySelector('#desk .side [data-view=waiting] .n').textContent}));
  check('desk_wait_mark', x.st==='waiting' && x.who==='Ramiro' && x.d==='2026-11-05' && x.blk==='Por confirmar (1)' && x.n==='1', x);
  await page.click('#desk .side [data-view=waiting]'); await sleep(400);
  x = await ev(page, ()=>{ const r=document.querySelector('#desk .main .row[data-id=a6]'); return {title:document.querySelector('#desk .mhead h1').textContent, tag:r&&r.querySelector('.wtag').textContent, date:r&&r.querySelector('.rc-date').textContent, half:r&&r.querySelector('.check.waiting')!==null}; });
  await ev(page, ()=>document.querySelector('#toast').classList.remove('on')); await sleep(100); await shot(page, 'd11-waiting-view');
  check('desk_wait_view', x.title==='Por confirmar' && x.tag==='Ramiro' && x.date==='Mañana' && x.half, x);
  await page.click('#desk .main .row[data-id=a6] .row-title'); await sleep(300); await page.keyboard.press('Escape'); await sleep(200); await page.keyboard.press('c'); await sleep(700);
  const wc = await ev(page, ()=>task('a6').status); await page.keyboard.press('Control+z'); await sleep(400);
  check('desk_wait_complete', wc==='done' && await ev(page, ()=>task('a6').status==='waiting'), wc);
  await ev(page, ()=>setDeskView('hoy')); await sleep(200);
  // The week's cards
  await ev(page, ()=>{ updTask('r3', {date:'2026-11-06'}); setDeskView('week'); }); await sleep(500);
  x = await ev(page, ()=>({rep:!!document.querySelector('#desk .wcard[data-id=r3] .cic.irp'), star:!!document.querySelector('#desk .wcard[data-id=a1] .cic.ist'), no:!document.querySelector('#desk .wcard[data-id=a6] .cic')}));
  await shot(page, 'd8-week-cards');
  check('desk_week_cards', x.rep && x.star && x.no, x);
  // Decision 41 in the calendar: a task Por confirmar on its review day, half filled, Esperando a in the tooltip; a drag moves its review day
  // (Deshacer), the card's circle completes it; the mini month counts it
  x = await ev(page, ()=>{ const c=document.querySelector('#desk .wcard[data-id=a6]'); return c&&{day:c.closest('[data-day]').dataset.day, half:!!c.querySelector('.check.waiting'), tip:c.title, mini:!!document.querySelector('#desk .minical [data-mini="2026-11-05"] .ld')}; });
  check('desk_cal_waiting', x && x.day==='2026-11-05' && x.half && /Por confirmar, esperando a Ramiro/.test(x.tip) && x.mini, x);
  await page.dragAndDrop('#desk .wcard[data-id=a6]', '#desk .wday[data-day="2026-11-09"]'); await sleep(500);
  x = await ev(page, ()=>({d:task('a6').date, st:task('a6').status})); await page.keyboard.press('Control+z'); await sleep(400);
  check('desk_cal_waiting_drag', x.d==='2026-11-09' && x.st==='waiting' && await ev(page, ()=>task('a6').date==='2026-11-05'), x);
  await page.click('#desk .wcard[data-id=a6] [data-act=wcheck]'); await sleep(600);
  x = await ev(page, ()=>task('a6').status); await page.keyboard.press('Control+z'); await sleep(400);
  check('desk_cal_waiting_done', x==='done' && await ev(page, ()=>task('a6').status==='waiting'), x);
  await ev(page, ()=>{ DB.settings.theme='dark'; save(); applyTheme(); setDeskView('hoy'); }); await sleep(300); await page.click('#desk .main .row[data-id=a2]:not(.first .row) .row-title'); await sleep(400);
  await page.click('#desk .pane [data-act=pickRepeat]'); await sleep(300); await menuItem(page, 'Personalizada…').click(); await sleep(400); await page.click('#pmenu .pm-pop [data-rp="u:M"]'); await sleep(200);
  await shot(page, 'd9-dark-custom-month'); await page.keyboard.press('Escape');
  await ctx.close();
}

/* ======================= 5. Sync ======================= */
const TABLES = ['spaces','projects','tasks','voice_notes','attachments','subtasks']; // decision 46: the app syncs the steps too (0005_subtasks.sql)
const COLS = { spaces:['name','sort_order','members'], projects:['space_id','name','color','sort_order','archived'],
  tasks:['space_id','project_id','title','date','reminder','priority','status','notes','carried','assignees','completed','repeat','focus','waiting_for'], voice_notes:['task_id','text'],
  attachments:['task_id','kind','path','mime','size','width','height','duration_ms','purged'], subtasks:['task_id','title','done','sort_order'] };
// rm-S's in-memory server (0001's trigger and RLS), plus the columns of 0004. noCol: a database where 0004 has not run; an upload naming one of
// its columns is refused whole, with PostgREST's message, one column at a time
const NEWCOLS=['repeat','focus','waiting_for'];
class Fake {
  constructor(noCol){ this.noCol=!!noCol; this.t={}; TABLES.forEach(x=>this.t[x]=new Map()); this.last=0; this.subs=new Map(); this.down=new Set(); this.calls=[]; this.ups=[]; }
  ts(){ this.last=Math.max(Date.now(), this.last+1); return new Date(this.last).toISOString(); }
  cols(table){ return COLS[table].filter(c=>!(this.noCol&&table==='tasks'&&NEWCOLS.includes(c))); }
  write(owner, table, rows){ if(!owner) throw new Error('JWT required'); const ts=this.ts(), out=[], changed=[], m=this.t[table];
    if(this.noCol&&table==='tasks'){ for(const c of NEWCOLS) if(rows.some(r=>c in r)) throw new Error("Could not find the '"+c+"' column of 'tasks' in the schema cache");
      if(rows.some(r=>r.status==='waiting')) throw new Error('new row for relation "tasks" violates check constraint "tasks_status_check"'); } // 0001's check: pending or done
    rows.forEach(r=>{ if(!r.id) throw new Error('null id'); if(!r.modified) throw new Error('null value in column "modified"'); });
    rows.forEach(r=>{ const ex=m.get(r.id);
      if(!ex){ const row={id:r.id, owner_id:owner}; this.cols(table).forEach(c=>row[c]=(c==='members'||c==='assignees')?[]:null); Object.assign(row,{created:null, deleted:null}, r, {owner_id:owner, server_ts:ts}); m.set(r.id,row); out.push({id:r.id}); changed.push(row); return; }
      if(Date.parse(r.modified) < Date.parse(ex.modified)) return;
      Object.assign(ex, r, {owner_id:ex.owner_id, server_ts:ts}); out.push({id:r.id}); changed.push(ex); });
    changed.forEach(row=>this.notify(table, row)); return out; }
  notify(table, row){ const copy=JSON.parse(JSON.stringify(row)); for(const [page, uid] of this.subs){ if(uid!==row.owner_id||this.down.has(page)) continue; setTimeout(()=>{ page.evaluate(([t,r])=>window.__fakeRT&&window.__fakeRT(t,r), [table, copy]).catch(()=>{}); }, 40); } }
  rows(owner, table){ return [...this.t[table].values()].filter(r=>r.owner_id===owner); }
  handle(page, op, a){ this.calls.push(op); if(this.down.has(page)&&op!=='signIn') throw new Error('Failed to fetch'); const own=a&&a.owner;
    switch(op){
      case 'signIn': return {id:a.uid, email:a.email};
      case 'pull': { let rs=this.rows(own, a.table); if(a.after) rs=rs.filter(x=>Date.parse(x.server_ts)>Date.parse(a.after)); rs.sort((x,y)=>x.server_ts<y.server_ts?-1:x.server_ts>y.server_ts?1:x.id<y.id?-1:1); return JSON.parse(JSON.stringify(rs.slice(0,a.limit))); }
      case 'byIds': return JSON.parse(JSON.stringify(this.rows(own, a.table).filter(x=>a.ids.includes(x.id))));
      case 'upsert': this.ups.push({page, table:a.table, rows:a.rows}); return this.write(own, a.table, a.rows);
      case 'markDeleted': return this.write(own, a.table, a.items.map(x=>({id:x.id, deleted:x.ts, modified:x.ts})));
      case 'subscribe': this.subs.set(page, a.uid); return true;
      case 'unsubscribe': this.subs.delete(page); return true;
    } throw new Error('op '+op); }
}
const USER = {uid:'9b2f6d3e-0000-4000-8000-00000000e0f1', email:'enric@example.com'};
function fakeAdapter(){
  const call=(op,a)=>{ if(!navigator.onLine) return Promise.reject(new TypeError('Failed to fetch')); return window.fakeServer(op,a); };
  const owner=()=>{ const s=JSON.parse(localStorage.getItem('fake-session')||'null'); return s&&s.id; };
  window.__tareasRemote = {
    async init(){ return JSON.parse(localStorage.getItem('fake-session')||'null'); },
    onAuth(cb){ window.__fakeAuth=cb; },
    async signIn(){ const u=await window.fakeServer('signIn', {uid:window.__fakeUser.uid, email:window.__fakeUser.email}); localStorage.setItem('fake-session', JSON.stringify(u)); setTimeout(()=>window.__fakeAuth&&window.__fakeAuth(u,'SIGNED_IN'),0); },
    async signOut(){ localStorage.removeItem('fake-session'); },
    pull:(table, after, limit)=>call('pull',{owner:owner(), table, after, limit}),
    byIds:(table, ids)=>call('byIds',{owner:owner(), table, ids}),
    upsert:(table, rows)=>call('upsert',{owner:owner(), table, rows}),
    markDeleted:(table, items)=>call('markDeleted',{owner:owner(), table, items}),
    subscribe(uid, onRow, onStatus){ window.__fakeRT=(t,r)=>onRow(t,r); window.fakeServer('subscribe',{uid}); setTimeout(()=>onStatus('SUBSCRIBED'),0); return ()=>{ window.__fakeRT=null; window.fakeServer('unsubscribe',{}); }; }
  };
}
const until = async (page, fn, arg, ms=8000)=>{ const t0=Date.now(); for(;;){ let v=false; try{ v=await page.evaluate(fn, arg); }catch(e){} if(v) return true; if(Date.now()-t0>ms) return false; await sleep(100); } };
const synced = page => until(page, ()=>SY&&SY.user&&!SY.running&&SY.status==='ok'&&syncCollect(true).count===0);
async function syncTests(browser){
  const today = (()=>{ const d=new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); })();
  const T = '2026-11-01T10:00:00.000Z';
  const seed = { spaces:[{id:'trabajo',name:'Trabajo',order:0,created:T},{id:'personal',name:'Personal',order:1,created:T}], projects:[], voiceNotes:[], attachments:[], settings:{tipsSeen:true},
    tasks:[ {id:'s1', title:'Sin repetir', spaceId:'trabajo', projectId:null, date:today, reminder:null, priority:'none', status:'pending', notes:'', carried:false, created:T, modified:T, completed:null},
      {id:'s2', title:'Copia de seguridad', spaceId:'trabajo', projectId:null, date:today, reminder:null, priority:'mid', status:'pending', notes:'Nota', carried:false, created:T, modified:T, completed:null} ] };
  const fake = new Fake(false); let x;
  const A = await open(browser, {tag:'SA', fake, seed, clock:false}), B = await open(browser, {tag:'SB', fake, seed:Object.assign({}, seed, {tasks:[]}), clock:false, desk:true});
  // A task without the new fields keeps the signature it had before them: no new keys in its row
  const sig = await ev(A.page, ()=>{ const row=syncToRow('tasks', task('s1')); return {keys:Object.keys(row).join(), sent:Object.keys(syncSendRow('tasks', row)).slice(-3).join()}; });
  check('sync_signature_unchanged', sig.keys==='id,created,space_id,project_id,title,date,reminder,priority,status,notes,carried,completed,modified,deleted' && sig.sent==='repeat,focus,waiting_for', sig);
  await ev(A.page, ()=>syncSignIn()); check('sync_A_first', await synced(A.page));
  await ev(B.page, ()=>syncSignIn()); check('sync_B_first', await synced(B.page));
  // Both fields go up and come down
  await ev(A.page, ()=>{ setRepeat('s2', 'D1'); toggleFocus('s2'); }); check('sync_A_up', await synced(A.page));
  let srow = fake.t.tasks.get('s2');
  check('sync_server_fields', /^D1@\d{4}-\d\d-\d\d#/.test(srow.repeat||'') && !!srow.focus && fake.t.tasks.get('s1').repeat===null, {repeat:srow.repeat, focus:srow.focus});
  check('sync_B_gets', await until(B.page, ()=>{ const x=task('s2'); return !!x&&/^D1@/.test(x.repeat||'')&&!!x.focus; }), await ev(B.page, ()=>task('s2')));
  // Cleared on one device, cleared on the server and on the other
  await ev(B.page, ()=>{ removeFromAhora(['s2']); }); check('sync_B_up', await synced(B.page));
  check('sync_cleared', fake.t.tasks.get('s2').focus===null && await until(A.page, ()=>!task('s2').focus), fake.t.tasks.get('s2').focus);
  // Por confirmar goes up and comes down (decision 41)
  await ev(A.page, ()=>setWaiting('s1', 'Ramiro', undefined)); check('sync_A_wait', await synced(A.page));
  check('sync_wait_server', fake.t.tasks.get('s1').status==='waiting' && fake.t.tasks.get('s1').waiting_for==='Ramiro', {st:fake.t.tasks.get('s1').status, w:fake.t.tasks.get('s1').waiting_for});
  check('sync_wait_B', await until(B.page, ()=>task('s1').status==='waiting' && task('s1').waitingFor==='Ramiro'));
  // Only the device that completes creates the next one; the other receives it and creates nothing
  const ups0 = fake.ups.filter(u=>u.page===B.page).length;
  await ev(A.page, ()=>completeTask('s2')); check('sync_A_complete', await synced(A.page));
  const ser = await ev(A.page, ()=>repSeries(task('s2').repeat));
  const onServer = [...fake.t.tasks.values()].filter(x=>(x.repeat||'').endsWith('#'+ser));
  check('sync_server_series', onServer.length===2 && onServer.filter(x=>x.status==='pending').length===1, onServer.map(x=>x.id+':'+x.status));
  check('sync_B_series', await until(B.page, s=>{ const xs=DB.tasks.filter(x=>repSeries(x.repeat)===s); return xs.length===2 && xs.filter(x=>x.status==='pending').length===1; }, ser), await ev(B.page, s=>DB.tasks.filter(x=>repSeries(x.repeat)===s).map(x=>x.id+':'+x.status), ser));
  await sleep(2500); await synced(B.page);
  const bRows = fake.ups.filter(u=>u.page===B.page).slice(ups0).flatMap(u=>u.rows);
  check('sync_B_creates_nothing', ![...fake.t.tasks.values()].some(x=>(x.repeat||'').endsWith('#'+ser)&&!onServer.some(o=>o.id===x.id)) && !bRows.some(x=>(x.repeat||'').endsWith('#'+ser)&&!onServer.some(o=>o.id===x.id)), bRows.map(x=>x.id));
  // Deshacer on A after the sync: the next one is deleted everywhere
  await ev(A.page, ()=>undoDone({id:'s2', status:'pending', completed:null})); // the Deshacer of the completion, after it went up check('sync_A_undo', await synced(A.page));
  check('sync_undo_everywhere', await until(B.page, s=>DB.tasks.filter(x=>repSeries(x.repeat)===s).length===1 && task('s2').status==='pending', ser) && [...fake.t.tasks.values()].filter(x=>(x.repeat||'').endsWith('#'+ser)&&!x.deleted).length===1);
  // Both devices complete the same task of a series offline: each makes the next one; once both are back, one stays, on both and on the server
  await ev(A.page, ()=>{ setRepeat('s1', 'D1'); }); check('sync_dup_ready', await synced(A.page) && await until(B.page, ()=>!!repParse(task('s1').repeat)));
  await synced(B.page); const ser2 = await ev(A.page, ()=>repSeries(task('s1').repeat));
  fake.down.add(A.page); fake.down.add(B.page); await A.ctx.setOffline(true); await B.ctx.setOffline(true); await sleep(200);
  await ev(A.page, ()=>completeTask('s1')); await ev(B.page, ()=>completeTask('s1'));
  const nextA = await ev(A.page, s=>DB.tasks.filter(x=>repSeries(x.repeat)===s&&x.status==='pending').map(x=>x.id+'|'+x.date), ser2), nextB = await ev(B.page, s=>DB.tasks.filter(x=>repSeries(x.repeat)===s&&x.status==='pending').map(x=>x.id+'|'+x.date), ser2);
  fake.down.delete(A.page); await A.ctx.setOffline(false); check('sync_dup_A_up', await synced(A.page));
  fake.down.delete(B.page); await B.ctx.setOffline(false); check('sync_dup_B_up', await synced(B.page)); await synced(A.page);
  const keep = [nextA[0], nextB[0]].map(s=>s.split('|')[0]).sort()[0];
  const pendOn = page => page.evaluate(s=>DB.tasks.filter(x=>repSeries(x.repeat)===s&&x.status==='pending').map(x=>x.id), ser2);
  check('sync_dup_one_left', nextA.length===1 && nextB.length===1 && nextA[0]!==nextB[0] && nextA[0].split('|')[1]===nextB[0].split('|')[1]
    && await until(A.page, ([s,k])=>{ const xs=DB.tasks.filter(x=>repSeries(x.repeat)===s&&x.status==='pending'); return xs.length===1&&xs[0].id===k; }, [ser2, keep])
    && await until(B.page, ([s,k])=>{ const xs=DB.tasks.filter(x=>repSeries(x.repeat)===s&&x.status==='pending'); return xs.length===1&&xs[0].id===k; }, [ser2, keep])
    && [...fake.t.tasks.values()].filter(x=>(x.repeat||'').endsWith('#'+ser2)&&x.status==='pending'&&!x.deleted).map(x=>x.id).join()===keep,
    {nextA, nextB, keep, A:await pendOn(A.page), B:await pendOn(B.page), server:[...fake.t.tasks.values()].filter(x=>(x.repeat||'').endsWith('#'+ser2)).map(x=>x.id+':'+x.status+':'+!!x.deleted)});
  check('sync_dup_logged', await ev(B.page, ()=>LOG.some(e=>/^Tarea repetida de una serie retirada/.test(e.m))) || await ev(A.page, ()=>LOG.some(e=>/^Tarea repetida de una serie retirada/.test(e.m))));
  await A.ctx.close(); await B.ctx.close();

  // A database without the columns: logged once per column, the values stay on the device, nothing goes up again and again
  const nf = new Fake(true);
  const C = await open(browser, {tag:'SC', fake:nf, seed, clock:false});
  await ev(C.page, ()=>{ setRepeat('s2', 'W1:MO'); toggleFocus('s2'); setWaiting('s1', 'Ramiro', undefined); syncSignIn(); });
  check('nocol_synced', await synced(C.page), await ev(C.page, ()=>({st:SY&&SY.status, err:SY&&SY.error})));
  await ev(C.page, ()=>updTask('s1', {title:'Sin repetir (editada)'})); await synced(C.page);
  const n1 = nf.ups.length; await sleep(3500); await synced(C.page);
  x = await ev(C.page, ()=>({rep:task('s2').repeat, focus:!!task('s2').focus, st:task('s1').status, who:task('s1').waitingFor, warns:LOG.filter(e=>/0004_repeat_focus/.test(e.m)).map(e=>e.m), errs:LOG.filter(e=>e.l==='error').map(e=>e.m), pend:syncCollect(true).count}));
  const s2row = nf.t.tasks.get('s2'), s1row = nf.t.tasks.get('s1');
  check('nocol_tolerated', /^W1:MO@/.test(x.rep||'') && x.focus && x.st==='waiting' && x.who==='Ramiro' && x.warns.length===4 && ['tasks\\.repeat','tasks\\.focus','tasks\\.waiting_for','Por confirmar'].every(w=>x.warns.some(m=>new RegExp(w).test(m))) && !x.errs.length && x.pend===0
    && s2row && !('repeat' in s2row) && !('focus' in s2row) && s1row.status==='pending' && !('waiting_for' in s1row) && s1row.title==='Sin repetir (editada)', {x, s2row, s1row});
  check('nocol_no_loop', nf.ups.length===n1, {before:n1, after:nf.ups.length});
  // A change from the server (another device on the old version) keeps the device's rule and Ahora
  const row = nf.t.tasks.get('s2'), row1 = nf.t.tasks.get('s1'), later=new Date(Date.now()+1000).toISOString();
  nf.write(USER.uid, 'tasks', [Object.assign({}, row, {title:'Copia de seguridad (servidor)', modified:later}), Object.assign({}, row1, {title:'Sin repetir (servidor)', modified:later})]);
  await until(C.page, ()=>task('s2').title==='Copia de seguridad (servidor)' && task('s1').title==='Sin repetir (servidor)');
  x = await ev(C.page, ()=>({t:task('s2').title, rep:task('s2').repeat, focus:!!task('s2').focus, st:task('s1').status, who:task('s1').waitingFor}));
  check('nocol_merge_keeps', x.t==='Copia de seguridad (servidor)' && /^W1:MO@/.test(x.rep||'') && x.focus && x.st==='waiting' && x.who==='Ramiro', x);
  await C.ctx.close();
}

(async()=>{
  await new Promise(res=>srv.listen(PORT,res)); const browser = await chromium.launch();
  try{ await sqlTests(); }catch(e){ fails.push('sql_exception'); errors.push('sql: '+String(e&&e.stack||e)); }
  try{ await iphone(browser); }catch(e){ fails.push('iphone_exception'); errors.push('iphone: '+String(e&&e.stack||e)); }
  try{ await desktop(browser); }catch(e){ fails.push('desktop_exception'); errors.push('desktop: '+String(e&&e.stack||e)); }
  try{ await syncTests(browser); }catch(e){ fails.push('sync_exception'); errors.push('sync: '+String(e&&e.stack||e)); }
  console.log(JSON.stringify({r, fails, errors}, null, 1));
  await browser.close(); srv.close(); process.exit(fails.length||errors.length?1:0);
})();
