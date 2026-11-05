require('./lib/out.js'); // outputs (screenshots, downloads) go to tests/out
// Decision 56 (estimated time, procrastination and «¿Qué hago ahora?»), port 10650. Screenshots in tests/out/ep.
//  1. SQL: supabase/migrations/0008_estimate_postponed.sql (no DROP or DELETE in it) run twice in PGlite after 0001 to 0007: the three
//     columns (integer, integer, date, nullable) and "newest modified wins" on them, an equal time accepted (the start of a day counts
//     without touching modified). Then all.sql run twice on a fresh database and check.sql: every row OK, the three new rows among them.
//  2. iPhone, clock at Wednesday 4 November 2026 10:00 (light and dark):
//     A. the estimate in grey on the rows; the Tiempo row of the detail (menu, Deshacer, Quitar); the long press submenu; the add sheet (its
//        Tiempo button and the title words 15m, 30m, 1h, medio día, highlighted; «Comida de medio día» stays a title); the next of a series
//        and a copy keep it; share text and CSV.
//     B. the counting paths: Aplazar, the date sheet, Cerrar el día, Repasar (Mañana counts, Hoy keeps), a future move that does not count,
//        Sin fecha, Eliminar solo esta and Por confirmar that do not count, Deshacer restoring the counters; the «arrastrada» labels by
//        count and by days in place of Aplazada (not both, not on a done task); Partir en pasos with the focus in Añadir paso.
//     C. Sugerir from the head of Ahora and «¿Qué hago ahora?» from the Hoy view menu: chips, the default 30 min, the order and fit rules,
//        the reminder warning, a tap puts it in Ahora with Deshacer, the limit of five and its message, the chevron opens the task, «Nada
//        encaja en ese tiempo»; no entry with Ahora empty.
//  3. The start of the day across two and three days (clock moved): one count per move, the first due day kept, modified untouched,
//     «Aplazada 3 veces» and «Desde el domingo 1».
//  4. Desktop (light and dark): the estimate column only when used, the inspector's Tiempo, the right button submenu, the composer's
//     Tiempo button and «1h» in the title, the date column «Aplazada 4 veces», a drag to a later day (list and hours slot) counting with
//     Deshacer, Partir en pasos in the inspector, Sugerir as a popover.
//  5. Sync with rm-DL's fake server, two devices: values up and down, a cleared one cleared everywhere, a task without them keeps its
//     signature (nothing goes up again), rollOver's count goes up with the same modified, and a database without the columns (0008 not
//     run) is tolerated: one line in the log, the values stay, no upload loop.
const { chromium } = require('playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = path.resolve(__dirname, '..'), PORT = 10650, URL0 = 'http://localhost:'+PORT+'/';
const OUT = path.join(__dirname, 'out', 'ep'); fs.mkdirSync(OUT, {recursive:true});
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
async function pgSetup(){
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
    grant usage on schema public to service_role, authenticated;
  `);
  return db; }
const strip = s => s.replace(/^create extension if not exists pg_(cron|net).*$/mg, '-- (extension stand-in)');
async function sqlTests(){
  const rd = f => fs.readFileSync(path.join(ROOT, 'supabase/migrations', f), 'utf8');
  const mig = rd('0008_estimate_postponed.sql');
  check('sql_no_drop_delete', !/drop|delete/i.test(mig), (mig.match(/.*(drop|delete).*/ig)||[]).join(' | '));
  let db = await pgSetup();
  for(const f of ['0001_init.sql','0002_push.sql','0003_attachments.sql','0004_repeat_focus.sql','0005_subtasks.sql','0006_project_notes.sql','0007_deadline.sql']) await db.exec(strip(rd(f)));
  let err = null; try { await db.exec(mig); await db.exec(mig); } catch(e){ err = e.message; }
  check('sql_runs_twice', !err, err);
  const q = async (sql, params) => (await db.query(sql, params)).rows;
  const tryq = async (sql, params) => { try { return {rows: await q(sql, params)}; } catch(e){ return {error: e.message}; } };
  const cols = await q(`select column_name, data_type, is_nullable from information_schema.columns where table_schema='public' and table_name='tasks' and column_name in ('estimate','postponed','carried_since') order by column_name`);
  check('sql_columns', cols.map(c=>c.column_name+':'+c.data_type+':'+c.is_nullable).join()==='carried_since:date:YES,estimate:integer:YES,postponed:integer:YES', cols);
  const comments = await q(`select col_description('public.tasks'::regclass, a.attnum) d from pg_attribute a where a.attrelid='public.tasks'::regclass and a.attname in ('estimate','postponed','carried_since')`);
  check('sql_comments', comments.length===3 && comments.every(c=>/Decision 56/.test(c.d||'')), comments);
  const A = '00000000-0000-4000-8000-00000000000a';
  await db.exec(`insert into auth.users values ('${A}')`);
  const as = async (uid, fn) => { await db.exec(`set test.uid = '${uid}'; set role authenticated;`); try { return await fn(); } finally { await db.exec(`reset role; reset test.uid;`); } };
  const ins = await as(A, () => tryq(`insert into public.tasks (id, title, date, estimate, modified) values ('t1', 'Informe', '2026-11-04', 30, '2026-11-04T09:00:00Z') returning estimate`));
  const older = await as(A, () => tryq(`update public.tasks set estimate = 240, modified = '2026-11-03T00:00:00Z' where id = 't1' returning id`));
  const same = await as(A, () => tryq(`update public.tasks set postponed = 1, carried_since = '2026-11-03', modified = '2026-11-04T09:00:00Z' where id = 't1' returning id`)); // rollOver: same modified
  const newer = await as(A, () => tryq(`update public.tasks set estimate = null, modified = '2026-11-04T10:00:00Z' where id = 't1' returning id`));
  const t1 = (await q(`select estimate, postponed, carried_since::text from public.tasks where id = 't1'`))[0];
  check('sql_newest_wins', ins.rows && ins.rows[0].estimate===30 && older.rows && !older.rows.length && same.rows && same.rows.length===1 && newer.rows && newer.rows.length===1 && t1.estimate===null && t1.postponed===1 && t1.carried_since==='2026-11-03', {ins, older, same, newer, t1});
  await db.close();
  db = await pgSetup(); const all = strip(fs.readFileSync(path.join(ROOT, 'supabase/all.sql'), 'utf8'));
  err = null; try { await db.exec(all); await db.exec(all); } catch(e){ err = e.message; }
  check('sql_all_twice', !err && /0001 a 00\d\d/.test(all.split('\n')[0]) && /migrations\/0008_estimate_postponed\.sql/.test(all) && (all.match(/^-- ========== migrations\//mg)||[]).length===fs.readdirSync(path.join(ROOT,'supabase/migrations')).filter(f=>f.endsWith('.sql')).length, err);
  let rows = []; try { rows = (await db.query(fs.readFileSync(path.join(ROOT, 'supabase/check.sql'), 'utf8'))).rows; } catch(e){ err = e.message; }
  check('sql_check_all_ok', rows.length>=23 && rows.every(x=>x.Estado==='OK') && ['tasks\\.estimate \\(0008\\)','tasks\\.postponed \\(0008\\)','tasks\\.carried_since \\(0008\\)'].every(p=>rows.some(x=>new RegExp(p).test(x.Pieza))), {err, bad:rows.filter(x=>x.Estado!=='OK'), n:rows.length});
  const readme = fs.readFileSync(path.join(ROOT, 'supabase/README.md'), 'utf8');
  check('sql_readme', /`migrations\/0008_estimate_postponed\.sql` \| .* \| v0\.28\.0/.test(readme) && /suma de las \w+ en orden/.test(readme), null);
  await db.close();
}

/* ======================= Pages ======================= */
const NOW = new Date(2026, 10, 4, 10, 0, 0); // Wednesday 4 November 2026, 10:00 local: before 19:00 (Cerrar el día is opened by hand)
const T0 = '2026-11-03T08:00:00.000Z';
const C = n => new Date(Date.UTC(2026, 10, 3, 8, n)).toISOString(); // created times, in the order of the lists
const tk = (id, o) => Object.assign({id, title:id, spaceId:'trabajo', projectId:'p1', date:'2026-11-04', reminder:null, priority:'none', status:'pending', notes:'', carried:false, created:T0, modified:T0, completed:null}, o);
const SEED = () => ({ spaces:[{id:'trabajo',name:'Trabajo',order:0,created:T0},{id:'personal',name:'Personal',order:1,created:T0}],
  projects:[{id:'p1', spaceId:'trabajo', name:'FLC', color:'#007AFF', order:0, archived:false, created:T0, modified:T0},{id:'p2', spaceId:'trabajo', name:'OCA', color:'#34C759', order:1, archived:false, created:T0, modified:T0},
    {id:'p9', spaceId:'personal', name:'Casa', color:'#FF9500', order:0, archived:false, created:T0, modified:T0}],
  tasks:[ tk('s1', {title:'Enviar acta', estimate:15, created:C(1)}),
    tk('s2', {title:'Revisar presupuesto', estimate:30, date:'2026-11-10', deadline:'2026-11-04', projectId:'p2', created:C(2)}), // in Hoy by its deadline
    tk('s3', {title:'Informe mensual', estimate:60, priority:'high', created:C(3)}),
    tk('s4', {title:'Correo a Pepe', estimate:15, priority:'high', created:C(4)}),
    tk('s5', {title:'Llamar al banco', estimate:30, carried:true, postponed:4, carriedSince:'2026-11-01', created:C(5)}), // arrastrada by count
    tk('s6', {title:'Ordenar carpeta', date:null, created:C(6)}), // no date, no estimate
    tk('s7', {title:'Plan de pruebas', estimate:15, carried:true, postponed:1, carriedSince:'2026-10-27', created:C(7)}), // arrastrada by days
    tk('s8', {title:'En Ahora', estimate:15, focus:new Date(2026,10,4,8,0).toISOString(), created:C(8)}),
    tk('s9', {title:'Firma del cliente', estimate:15, status:'waiting', waitingFor:'Cliente', created:C(9)}), // Revisar hoy
    tk('s10', {title:'Futuro', estimate:15, date:'2026-11-10', created:C(10)}),
    tk('s11', {title:'Esperando datos', status:'waiting', date:'2026-11-10', created:C(11)}),
    tk('s12', {title:'Reunión SteerCo', estimate:240, reminder:new Date(2026,10,4,10,20).toISOString(), created:C(12)}),
    tk('s13', {title:'Hecha', estimate:15, status:'done', completed:new Date(2026,10,4,9,0).toISOString(), postponed:5, carriedSince:'2026-10-20', created:C(13)}),
    tk('s14', {title:'Dos veces', carried:true, postponed:2, carriedSince:'2026-11-01', created:C(14)}), // not yet arrastrada: plain Aplazada
    tk('r1', {title:'Informe semanal', estimate:30, repeat:'W1:WE@2026-11-04#ser1', postponed:2, carriedSince:'2026-11-02', created:C(20)}),
    tk('h1', {title:'Comprar pintura', spaceId:'personal', projectId:'p9', estimate:15, created:C(30)}) ],
  voiceNotes:[], attachments:[], subtasks:[], projectNotes:[], settings:{tipsSeen:true} });
async function open(browser, o){
  const vp = o.desk ? {viewport:{width:1280,height:800}, deviceScaleFactor:1} : {viewport:{width:390,height:844}, deviceScaleFactor:2, isMobile:true, hasTouch:true};
  const ctx = await browser.newContext(Object.assign(vp, {colorScheme:o.theme||'light'})); const page = await ctx.newPage();
  if(o.clock!==false) await page.clock.install({time:o.now||NOW});
  page.on('pageerror', e=>errors.push(o.tag+' pageerror: '+e.message)); page.on('console', m=>{ if(m.type()==='error') errors.push(o.tag+' console: '+m.text()); });
  if(o.fake){ await page.exposeBinding('fakeServer', (src, op, a)=>o.fake.handle(src.page, op, a)); await page.addInitScript(fakeAdapter); await page.addInitScript(u=>{ window.__fakeUser=u; }, USER); }
  await page.addInitScript(s=>{ if(!localStorage.getItem('tareas-v1')) localStorage.setItem('tareas-v1', s); }, JSON.stringify(o.seed||SEED()));
  await page.goto(URL0); await until(page, ()=>typeof DB!=='undefined'&&!!document.querySelector(UI.wide?'#desk .main':'.screen.root')); return {ctx, page};
}
const ev = (page, fn, arg) => page.evaluate(fn, arg);
const until = async (page, fn, arg, ms=8000)=>{ const t0=Date.now(); for(;;){ let v=false; try{ v=await page.evaluate(fn, arg); }catch(e){} if(v) return true; if(Date.now()-t0>ms) return false; await sleep(80); } };
const calm = page => until(page, ()=>!app.classList.contains('navigating') && !HELD.size && !document.querySelector('.row.leaving, .flip, .enter') && !touchDrag);
const sheetUp = page => until(page, ()=>{ const s=document.querySelector('#sheet'); return s.classList.contains('on') && !sheetFresh(); });
const sheetGone = page => until(page, ()=>!document.querySelector('#sheet').classList.contains('on'));
const menuSettled = page => until(page, ()=>menuOpen() && !menuFresh() && !document.querySelector('#pmenu').getAnimations({subtree:true}).some(a=>a.playState==='running'));
const toastText = page => ev(page, ()=>document.querySelector('#toast').classList.contains('on')?document.querySelector('#toastText').textContent:'');
const hideToast = page => ev(page, ()=>{ document.querySelector('#toast').classList.remove('on'); undoFn=null; });
const menuItem = (page, label) => page.locator('#pmenu .pm-it').filter({has: page.locator('.pm-l', {hasText: new RegExp('^'+label.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'$')})}).first();
const menuLabels = page => ev(page, ()=>[...document.querySelectorAll('#pmenu .pm-list .pm-it')].map(b=>b.querySelector('.pm-l').firstChild.textContent));
const meta = (page, id) => ev(page, id=>{ const r=document.querySelector('.screen.root .scroll .row[data-id="'+id+'"]:not(.first .row)'); if(!r) return null; const m=r.querySelector('.row-meta'), e=m&&m.querySelector('.est'), d=m&&m.querySelector('.drag'), c=m&&m.querySelector('.carried');
  return {text:m?m.textContent:'', est:e&&e.textContent, estColor:e&&getComputedStyle(e).color, metaColor:m&&getComputedStyle(m).color, drag:d&&d.textContent, dragColor:d&&getComputedStyle(d).color, carried:c&&c.textContent}; }, id);
const cnt = (page, id) => ev(page, id=>{ const x=task(id); return x&&{p:x.postponed||null, s:x.carriedSince||null, d:x.date, m:x.modified}; }, id);
const sgRows = page => ev(page, ()=>[...document.querySelectorAll('.sg .sgrow')].map(r=>({id:r.dataset.sg, t:r.querySelector('.sgt').textContent, m:r.querySelector('.sgm').textContent})));

/* ======================= 2. iPhone ======================= */
async function iphone(browser){
  const {ctx, page} = await open(browser, {tag:'I'}); let x;
  await calm(page);
  // --- A. The estimate on the rows: grey, after the rest; a done task says nothing
  const m1 = await meta(page, 's1');
  check('row_estimate', m1 && m1.est==='15 min' && m1.estColor===m1.metaColor && /15 min$/.test(m1.text), m1);
  // --- B. The «arrastrada» labels in place of Aplazada, by count and by days; two times only is still Aplazada
  const m5 = await meta(page, 's5'), m7 = await meta(page, 's7'), m14 = await meta(page, 's14');
  check('drag_by_count', m5 && m5.drag==='Aplazada 4 veces' && (m5.text.match(/Aplazada/g)||[]).length===1 && m5.dragColor==='rgb(255, 149, 0)', m5); // orange, once, even in the Aplazadas group
  check('drag_by_days', m7 && m7.drag==='Desde el martes 27' && !/Aplazada/.test(m7.text), m7);
  check('drag_not_yet', m14 && !m14.drag && !/veces|Desde/.test(m14.text), m14); // in the Aplazadas group: no label at all (the group says it)
  x = await ev(page, ()=>({done:dragText(task('s13')), isd:isDrag(task('s13')), r1:dragText(task('r1')), fut:dragText(Object.assign({}, task('s10'), {postponed:3}))}));
  check('drag_rules', x.done==='' && x.isd===false && x.r1==='' && x.fut==='Aplazada 3 veces', x); // isDrag is open only; the row shows it only when due
  await shot(page, 'i1-hoy');

  // --- C. Sugerir in the head of Ahora, a sheet with the chips (30 min by default)
  check('sugerir_link', await ev(page, ()=>{ const b=document.querySelector('.screen.root .ahora .ahead [data-act=suggest]'); return !!b&&b.textContent==='Sugerir'; }));
  await page.tap('.screen.root .ahora [data-act=suggest]'); await sheetUp(page);
  x = await ev(page, ()=>({h:document.querySelector('#sheet h2').textContent, chips:[...document.querySelectorAll('#sheet .sgchips .chip')].map(c=>c.textContent+(c.classList.contains('on')?'*':'')).join(), warn:(document.querySelector('#sheet .sgwarn')||{}).textContent||''}));
  check('sg_sheet', x.h==='¿Qué hago ahora?' && x.chips==='15 min,30 min*,1 h,Medio día' && x.warn==='Ojo: a las 10:20 tienes "Reunión SteerCo"', x);
  x = await sgRows(page);
  check('sg_30', x.map(o=>o.id).join()==='s2,s4,s5' && /OCA.*30 min.*Entrega hoy/.test(x[0].m) && /15 min.*Prioritaria/.test(x[1].m) && /Aplazada 4 veces/.test(x[2].m), x);
  await shot(page, 'i2-sugerir');
  await page.tap('#sheet .chip[data-sg-min="15"]');
  x = {rows:await sgRows(page), warn:await ev(page, ()=>!!document.querySelector('#sheet .sgwarn')), on:await ev(page, ()=>document.querySelector('#sheet .chip.on').textContent)};
  check('sg_15', x.rows.map(o=>o.id).join()==='s4,s7,s1' && /Desde el martes 27/.test(x.rows[1].m) && /Rápida/.test(x.rows[2].m) && !x.warn && x.on==='15 min', x); // no reminder within 15 minutes
  await page.tap('#sheet .chip[data-sg-min="60"]'); x = await sgRows(page);
  check('sg_60', x.map(o=>o.id).join()==='s2,s3,s4', x);
  // the fit and pool rules, and the quick ones by estimate (the higher tiers set aside for a moment)
  x = await ev(page, ()=>{ const pool=suggestPool().map(x=>x.id); const fits=[sgFits(task('s6'),30), sgFits(task('s6'),60), sgFits(task('s12'),60), sgFits(task('s12'),240), sgFits(task('s3'),30), sgFits(task('s3'),60)];
    const keep={}; ['s2','s3','s4','s5','s7'].forEach(id=>{ keep[id]=task(id).status; task(id).status='done'; }); const q=suggestFor(240).list.map(x=>x.id), q15=suggestFor(15).list.map(x=>x.id); Object.keys(keep).forEach(id=>{ task(id).status=keep[id]; });
    return {pool:pool.slice().sort().join(), fits:fits.join(), q:q.join(), q15:q15.join(), why9:sgReason(task('s9')), why6:sgReason(task('s6'))}; });
  check('sg_pool', x.pool==='r1,s1,s12,s14,s2,s3,s4,s5,s6,s7,s9', x.pool); // not s8 (Ahora), s10 (later), s11 (waiting, later), s13 (done), h1 (Personal)
  check('sg_fit', x.fits==='false,true,false,true,false,true', x.fits);
  check('sg_quick_first', x.q==='s1,s9,r1' && x.q15==='s1,s9', x); // 15, 15 then 30; the ones without an estimate last
  check('sg_reasons', x.why9==='Revisar hoy' && x.why6==='Sin fecha', x);
  // A tap puts it in Ahora with Deshacer and closes the sheet
  await page.tap('#sheet .sgrow[data-sg=s3] .sgmain'); await sheetGone(page); await calm(page);
  x = {focus:await ev(page, ()=>!!task('s3').focus), toast:await toastText(page), inAhora:await ev(page, ()=>!!document.querySelector('.screen.root .ahora .row[data-id=s3]'))};
  check('sg_to_ahora', x.focus && x.toast==='Añadida a Ahora' && x.inAhora, x);
  await page.tap('#toastBtn'); await calm(page);
  check('sg_undo', await ev(page, ()=>!task('s3').focus));
  // The chevron opens the task
  await page.tap('.screen.root .ahora [data-act=suggest]'); await sheetUp(page);
  await page.tap('#sheet .sgrow[data-sg=s4] .sgopen'); await sheetGone(page); await calm(page);
  check('sg_chevron_opens', await ev(page, ()=>detailTaskId()==='s4' && !task('s4').focus));
  await page.tap('.pushed-screen.detail [data-act=back]'); await calm(page);
  // A waiting one (Revisar hoy) is opened, not put in Ahora
  x = await ev(page, ()=>{ task('s2').status='done'; task('s4').status='done'; task('s5').status='done'; task('s7').status='done'; task('s1').status='done'; return suggestFor(15).list.map(x=>x.id).join(); });
  check('sg_waiting_listed', x==='s9', x);
  await ev(page, ()=>suggestSheet(null)); await sheetUp(page); await page.tap('#sheet .chip[data-sg-min="15"]');
  await page.tap('#sheet .sgrow[data-sg=s9] .sgmain'); await sheetGone(page); await calm(page);
  check('sg_waiting_opens', await ev(page, ()=>detailTaskId()==='s9' && !task('s9').focus));
  await page.tap('.pushed-screen.detail [data-act=back]'); await calm(page);
  await ev(page, ()=>{ ['s2','s4','s5','s7','s1'].forEach(id=>{ task(id).status='pending'; }); save(); render(); }); await calm(page);
  // The limit of five: the message, the sheet stays
  await ev(page, ()=>{ ['s10','s11','s12','r1'].forEach((id,i)=>{ task(id).focus=new Date(2026,10,4,8,i+1).toISOString(); task(id).status=task(id).status==='waiting'?'pending':task(id).status; }); save(); render(); });
  await calm(page); await page.tap('.screen.root .ahora [data-act=suggest]'); await sheetUp(page);
  await page.tap('#sheet .sgrow[data-sg=s2] .sgmain'); await sleep(300);
  x = {focus:await ev(page, ()=>!!task('s2').focus), toast:await toastText(page), open:await ev(page, ()=>document.querySelector('#sheet').classList.contains('on'))};
  check('sg_limit', !x.focus && x.toast==='Ahora ya tiene 5 tareas. Quita una antes.' && x.open, x);
  await ev(page, ()=>closeSheet()); await sheetGone(page);
  await ev(page, ()=>{ ['s10','s11','s12','r1'].forEach(id=>{ task(id).focus=null; }); task('s11').status='waiting'; save(); render(); }); await calm(page);
  // The Hoy view menu has «¿Qué hago ahora?»; Todas has not
  await page.tap('.screen.root [data-act=viewMenu]'); await menuSettled(page);
  x = await menuLabels(page);
  check('viewmenu_hoy', x.includes('¿Qué hago ahora?'), x);
  await menuItem(page, '¿Qué hago ahora?').tap(); await sheetUp(page);
  check('viewmenu_opens', await ev(page, ()=>document.querySelector('#sheet h2').textContent==='¿Qué hago ahora?' && document.querySelectorAll('#sheet .sgrow').length===3));
  await ev(page, ()=>closeSheet()); await sheetGone(page);
  await ev(page, ()=>{ DB.settings.filter='todas'; save(); render(); }); await calm(page);
  await page.tap('.screen.root [data-act=viewMenu]'); await menuSettled(page);
  check('viewmenu_todas', !(await menuLabels(page)).includes('¿Qué hago ahora?'));
  await ev(page, ()=>{ closeMenu(true); DB.settings.filter='hoy'; save(); render(); }); await calm(page);
  // Nothing fits (Personal at 15 min, its task without estimate... and Ahora empty: no link)
  await ev(page, ()=>{ task('h1').estimate=null; DB.settings.activeSpace='personal'; resetListState(); save(); render(); }); await calm(page);
  check('sg_no_link_without_ahora', await ev(page, ()=>!document.querySelector('.screen.root [data-act=suggest]') && !document.querySelector('.screen.root .ahora')));
  await ev(page, ()=>suggestSheet(null)); await sheetUp(page); await page.tap('#sheet .chip[data-sg-min="15"]');
  check('sg_empty', await ev(page, ()=>(document.querySelector('#sheet .sgempty')||{}).textContent==='Nada encaja en ese tiempo'));
  await shot(page, 'i3-sugerir-empty');
  await ev(page, ()=>{ closeSheet(); task('h1').estimate=15; DB.settings.activeSpace='trabajo'; resetListState(); save(); render(); }); await sheetGone(page); await calm(page);

  // --- A. The detail: Tiempo after Prioridad, its menu, Deshacer, Quitar
  await ev(page, ()=>openDetail('s1')); await calm(page);
  x = await ev(page, ()=>{ const cells=[...document.querySelectorAll('.pushed-screen.detail .group .cell .lbl')].map(e=>e.textContent); const i=cells.indexOf('Prioridad'); return {next:cells[i+1], val:document.querySelector('.pushed-screen.detail [data-act=pickEstimate] .val').textContent}; });
  check('detail_row', x.next==='Tiempo' && x.val==='15 min', x);
  await shot(page, 'i4-detail');
  await page.tap('.pushed-screen.detail [data-act=pickEstimate]'); await menuSettled(page);
  x = await ev(page, ()=>[...document.querySelectorAll('#pmenu .pm-it')].map(b=>b.querySelector('.pm-l').textContent+(b.querySelector('.pm-ck svg')?'*':'')).join());
  check('detail_menu', x==='15 min*,30 min,1 h,Medio día,Quitar', x);
  await shot(page, 'i5-detail-menu');
  await menuItem(page, '1 h').tap(); await until(page, ()=>!menuOpen()); await calm(page);
  x = {e:await ev(page, ()=>task('s1').estimate), toast:await toastText(page), val:await ev(page, ()=>document.querySelector('.pushed-screen.detail [data-act=pickEstimate] .val').textContent)};
  check('detail_sets', x.e===60 && x.toast==='Tiempo estimado: 1 h' && x.val==='1 h', x);
  await page.tap('#toastBtn'); await calm(page);
  check('detail_undo', await ev(page, ()=>task('s1').estimate)===15);
  await page.tap('.pushed-screen.detail [data-act=pickEstimate]'); await menuSettled(page); await menuItem(page, 'Quitar').tap(); await until(page, ()=>!menuOpen()); await calm(page);
  x = {e:await ev(page, ()=>task('s1').estimate), toast:await toastText(page), val:await ev(page, ()=>document.querySelector('.pushed-screen.detail [data-act=pickEstimate] .val').textContent)};
  check('detail_quitar', x.e===null && x.toast==='Sin tiempo estimado' && x.val==='Ninguno', x);
  await page.tap('#toastBtn'); await calm(page);
  await page.tap('.pushed-screen.detail [data-act=back]'); await calm(page);
  // The long press menu: Tiempo after Fecha límite, its submenu
  await ev(page, ()=>rowMenu('s6')); await menuSettled(page);
  x = await menuLabels(page);
  check('rowmenu_item', x[0]==='Aplazar' && x[1]==='Fecha límite' && x[2]==='Tiempo', x);
  await menuItem(page, 'Tiempo').tap(); await until(page, ()=>!!document.querySelector('#pmenu .pm-head')); await menuSettled(page);
  x = await menuLabels(page);
  check('rowmenu_sub', x.join()==='15 min,30 min,1 h,Medio día', x);
  await shot(page, 'i6-rowmenu');
  await menuItem(page, 'Medio día').tap(); await until(page, ()=>!menuOpen()); await calm(page);
  check('rowmenu_sets', await ev(page, ()=>task('s6').estimate)===240 && await toastText(page)==='Tiempo estimado: medio día');
  check('row_after_set', await ev(page, ()=>rowHTML(task('s6')).includes('<span class="est">Medio día</span>'))); // undated: not in Hoy

  // --- A. Title words: parseQuick and quickTask
  x = await ev(page, ()=>{ const t=s=>{ const r=quickTask(s, {}); return r.title+'|'+(r.estimate||'')+'|'+(r.date||''); };
    return [t('Revisar contrato 30m mañana'), t('Revisar contrato mañana 30M'), t('Llamar 1H'), t('Preparar informe Medio Dia'), t('Preparar informe medio día !!'), t('Comida de medio día'), t('Llamar a medio día'), t('Correo 15 min'), t('Plan 1h a las 9'), t('15m'), t('Leer 45m')]; });
  check('title_words', x.join(' ; ')==='Revisar contrato|30|2026-11-05 ; Revisar contrato|30|2026-11-05 ; Llamar|60| ; Preparar informe|240| ; Preparar informe|240| ; Comida de medio día|| ; Llamar a medio día|| ; Correo|15| ; Plan|60|2026-11-05 ; 15m|| ; Leer 45m||', x);
  x = await ev(page, ()=>{ const r=quickTask('Revisar contrato 30m mañana', {}); return {said:quickSaid(r).out.join(', '), meta:quickMeta(r), toks:r.toks.map(t=>t.kind).join()}; });
  check('title_said', x.said==='Mañana, tiempo 30 min' && x.meta==='Mañana, 30 min' && x.toks==='est,date', x);
  // The add sheet: the word highlighted and its token; the Tiempo button and its chips
  await ev(page, ()=>addSheet(null)); await sheetUp(page);
  await page.fill('#sheet .titlein', 'Revisar contrato 30m mañana');
  x = await ev(page, ()=>({marks:[...document.querySelectorAll('#sheet .qhl mark')].map(m=>m.textContent).join('|'), toks:[...document.querySelectorAll('#sheet .tok')].map(t=>t.textContent.replace('×','')).join('|'), btn:document.querySelector('#sheet .qbtn[data-k=est]').classList.contains('set')}));
  check('add_words', x.marks==='30m|mañana' && x.toks==='Mañana|30 min' && x.btn, x);
  await hideToast(page); await sleep(350); await shot(page, 'i7-add-words');
  await page.keyboard.press('Enter'); await until(page, ()=>DB.tasks.some(t=>t.title==='Revisar contrato'));
  x = await ev(page, ()=>{ const t=DB.tasks.find(t=>t.title==='Revisar contrato'); return {e:t.estimate, d:t.date, p:t.postponed===undefined&&t.carriedSince===undefined}; });
  check('add_created', x.e===30 && x.d==='2026-11-05' && x.p, x);
  await page.fill('#sheet .titlein', 'Pedir datos');
  await page.tap('#sheet .qbtn[data-k=est]'); await until(page, ()=>document.querySelectorAll('#sheet .qstrip [data-es]').length===4);
  x = await ev(page, ()=>[...document.querySelectorAll('#sheet .qstrip .chip')].map(c=>c.textContent).join());
  check('add_strip', x==='15 min,30 min,1 h,Medio día', x);
  await hideToast(page); await sleep(350); await shot(page, 'i8-add-strip');
  await page.tap('#sheet .qstrip [data-es="60"]');
  x = await ev(page, ()=>({toks:[...document.querySelectorAll('#sheet .tok')].map(t=>t.textContent.replace('×','')).join('|'), focus:document.activeElement===document.querySelector('#sheet .titlein')}));
  check('add_strip_picks', x.toks==='1 h' && x.focus, x);
  await page.tap('#sheet .qadd'); await sheetGone(page); await calm(page);
  check('add_strip_created', await ev(page, ()=>{ const t=DB.tasks.find(t=>t.title==='Pedir datos'); return !!t&&t.estimate===60; }));
  // The next of a series keeps the estimate, never the counters; a copy too
  x = await ev(page, ()=>{ completeTask('r1'); const n=DB.tasks.find(o=>o.id!=='r1'&&repSeries(o.repeat)==='ser1'); const done=task('r1'); const n0=DB.tasks.length; duplicateTask('s5'); const c=DB.tasks[DB.tasks.length-1];
    return {n:n&&{e:n.estimate, p:n.postponed||null, s:n.carriedSince||null}, kept:{p:done.postponed, s:done.carriedSince}, dup:{e:c.estimate, p:c.postponed||null, s:c.carriedSince||null, t:c.title, id:c.id}, more:DB.tasks.length-n0}; });
  check('series_keeps_estimate', x.n && x.n.e===30 && x.n.p===null && x.n.s===null && x.kept.p===2 && x.kept.s==='2026-11-02', x);
  check('duplicate', x.more===1 && x.dup.e===30 && x.dup.p===null && x.dup.s===null && x.dup.t==='Llamar al banco', x);
  await calm(page); await ev(page, id=>{ pop(); DB.tasks=DB.tasks.filter(o=>o.id!==id); save(); render(); }, x.dup.id); await calm(page);
  // Share text, CSV and export
  x = await ev(page, ()=>({share:shareText('s12'), share0:shareText('s14'), share4:shareText('s6'), csv:csvText(), json:JSON.stringify(exportData())}));
  const head = x.csv.split('\r\n')[0], line = x.csv.split('\r\n').find(l=>l.includes('Reunión SteerCo'))||'';
  check('share_text', /\nPrioridad: ninguna\nTiempo estimado: medio día\n/.test(x.share) && !/Tiempo/.test(x.share0) && /Tiempo estimado: medio día/.test(x.share4), x.share);
  check('csv', head.includes('"Prioridad";"Tiempo estimado";"Estado"') && line.includes('"";"medio día";"Pendiente"'), {head, line});
  check('export', x.json.includes('"estimate":240') && x.json.includes('"postponed":4') && x.json.includes('"carriedSince":"2026-11-01"'), null);
  x = await ev(page, ()=>{ const ex=JSON.stringify(exportData()); const t=task('s5'); const keep={e:t.estimate, p:t.postponed, s:t.carriedSince}; delete t.estimate; delete t.postponed; delete t.carriedSince; t.modified='2026-11-01T00:00:00.000Z'; save();
    importData(ex); const u=task('s5'); return {e:u.estimate, p:u.postponed, s:u.carriedSince, keep}; });
  check('import', x.e===30 && x.p===4 && x.s==='2026-11-01', x);
  await ev(page, ()=>render()); await calm(page);

  // --- B. Counting: Aplazar (row menu) counts, Deshacer gives it back
  await ev(page, ()=>{ DB.tasks.push(Object.assign({}, task('s1'), {id:'c1', title:'Cuenta uno', estimate:null, created:'2026-11-03T09:00:00.000Z', modified:'2026-11-03T09:00:00.000Z'}), Object.assign({}, task('s1'), {id:'c2', title:'Cuenta dos', estimate:null, date:'2026-11-06', created:'2026-11-03T09:01:00.000Z'}), Object.assign({}, task('s1'), {id:'c3', title:'Cuenta tres', estimate:null, postponed:3, carriedSince:'2026-10-30', carried:true, created:'2026-11-03T09:02:00.000Z'})); save(); render(); }); await calm(page);
  await ev(page, ()=>rowMenu('c1')); await menuSettled(page); await menuItem(page, 'Aplazar').tap(); await until(page, ()=>!!document.querySelector('#pmenu .pm-head')); await menuSettled(page);
  await menuItem(page, 'Mañana').tap(); await until(page, ()=>task('c1').date==='2026-11-05'); await calm(page);
  x = await cnt(page, 'c1');
  check('count_aplazar', x.p===1 && x.s==='2026-11-04' && x.d==='2026-11-05' && await toastText(page)==='Aplazada a mañana', x);
  await page.tap('#toastBtn'); await calm(page);
  x = await cnt(page, 'c1');
  check('count_undo', x.p===null && x.s===null && x.d==='2026-11-04', x);
  // A future task moved to another future day does not count; Sin fecha does not either
  x = await ev(page, ()=>{ setTaskDate('c2', '2026-11-10'); const a=task('c2').postponed||null; setTaskDate('c1', null); const b=task('c1').postponed||null; undoFn(); return {a, b, d:task('c1').date}; });
  check('count_future_no', x.a===null && x.b===null && x.d==='2026-11-04', x);
  // The date sheet counts; a second time adds; the earliest due day is kept
  x = await ev(page, ()=>{ setManualDate('c1', '2026-11-05'); const a={p:task('c1').postponed, s:task('c1').carriedSince}; updTask('c1', {date:'2026-11-04', postponed:null, carriedSince:null}); return a; });
  check('count_date_sheet', x.p===1 && x.s==='2026-11-04', x);
  x = await ev(page, ()=>{ const t=task('c3'); const old=daySnap(t); tomorrowTask('c3'); const a={p:task('c3').postponed, s:task('c3').carriedSince}; undoDay(old); return {a, back:{p:task('c3').postponed, s:task('c3').carriedSince, c:task('c3').carried}}; });
  check('count_keeps_earliest', x.a.p===4 && x.a.s==='2026-10-30' && x.back.p===3 && x.back.s==='2026-10-30' && x.back.c===true, x);
  // Eliminar solo esta and Por confirmar move the date without counting
  x = await ev(page, ()=>{ DB.tasks.push(Object.assign({}, task('s1'), {id:'c4', title:'Serie', estimate:null, repeat:'D1@2026-11-04#ser4'})); save(); skipOccurrence('c4', true); const a={d:task('c4').date, p:task('c4').postponed||null};
    setWaiting('c1', 'Ana', '2026-11-05'); const b={st:task('c1').status, p:task('c1').postponed||null}; undoFn(); return {a, b, st:task('c1').status}; });
  check('count_not_skip_wait', x.a.d==='2026-11-05' && x.a.p===null && x.b.st==='waiting' && x.b.p===null && x.st==='pending', x);
  await ev(page, ()=>{ DB.tasks=DB.tasks.filter(o=>o.id!=='c4'); save(); render(); }); await calm(page);
  // Cerrar el día: Todo a mañana counts each one, Deshacer gives them back
  x = await ev(page, ()=>{ closeDaySheet(); document.querySelector('#sheet [data-cd=all]').click(); const a={c1:task('c1').postponed, c3:task('c3').postponed, s2:task('s2').postponed||null, s9:task('s9').postponed||null}; undoFn(); return {a, b:{c1:task('c1').postponed||null, c3:task('c3').postponed}}; });
  check('count_close_day', x.a.c1===1 && x.a.c3===4 && x.a.s2===null && x.a.s9===null && x.b.c1===null && x.b.c3===3, x); // s2 stays (deadline today), s9 waits
  await ev(page, ()=>{ closeSheet(); }); await sheetGone(page); await hideToast(page); await calm(page);
  // Repasar: Mañana counts, Hoy keeps the counters; the balance's Deshacer gives them back
  await ev(page, ()=>reviewStep(['c3','s5'], 0, {kind:'carried', prev:new Map(), removed:[], tally:{}})); await sheetUp(page);
  x = await ev(page, ()=>({drag:(document.querySelector('#sheet .rvdrag')||{}).textContent, split:!!document.querySelector('#sheet [data-x=split]')}));
  check('review_drag_line', x.drag==='Aplazada 3 veces' && x.split, x);
  await shot(page, 'i9-review');
  await page.tap('#sheet [data-rv=man]'); await until(page, ()=>task('c3').date==='2026-11-05'); await sheetUp(page);
  await page.tap('#sheet [data-rv=hoy]'); await until(page, ()=>!!document.querySelector('#sheet [data-x=undo]'));
  x = {c3:await cnt(page, 'c3'), s5:await cnt(page, 's5'), s5c:await ev(page, ()=>task('s5').carried)};
  check('count_review', x.c3.p===4 && x.c3.s==='2026-10-30' && x.s5.p===4 && x.s5.s==='2026-11-01' && x.s5c===false, x);
  await page.tap('#sheet [data-x=undo]'); await sheetGone(page); await calm(page);
  x = {c3:await cnt(page, 'c3'), s5c:await ev(page, ()=>task('s5').carried)};
  check('count_review_undo', x.c3.p===3 && x.c3.d==='2026-11-04' && x.s5c===true, x);
  // A task that is not arrastrada has no Partir en pasos
  await ev(page, ()=>reviewStep(['s14'], 0, {kind:'carried', prev:new Map(), removed:[], tally:{}})); await sheetUp(page);
  check('review_no_split', await ev(page, ()=>!document.querySelector('#sheet [data-x=split]') && !document.querySelector('#sheet .rvdrag')));
  await ev(page, ()=>{ sheetOnClose=null; closeSheet(); }); await sheetGone(page); await calm(page);
  // Partir en pasos: the walk ends there and the detail opens with the focus in Añadir paso, inside the tap
  await ev(page, ()=>reviewStep(['c3','s5'], 0, {kind:'carried', prev:new Map(), removed:[], tally:{}})); await sheetUp(page);
  await page.tap('#sheet [data-x=split]'); await sheetGone(page);
  x = await ev(page, ()=>({id:detailTaskId(), role:document.activeElement&&document.activeElement.dataset.role, inTop:!!document.activeElement&&UI.stack.length&&UI.stack[UI.stack.length-1].el.contains(document.activeElement), c3:task('c3').date}));
  check('split_focus', x.id==='c3' && x.role==='stepadd' && x.inTop && x.c3==='2026-11-04', x);
  await calm(page); await sleep(300); await shot(page, 'i10-split');
  await page.keyboard.type('Primer paso'); await page.keyboard.press('Enter');
  check('split_step_added', await until(page, ()=>stepsOf('c3').some(s=>s.title==='Primer paso')));
  await ev(page, ()=>{ document.activeElement&&document.activeElement.blur(); }); await page.tap('.pushed-screen.detail [data-act=back]'); await calm(page);

  // Dark theme
  await ev(page, ()=>{ document.querySelector('#toast').classList.remove('on'); DB.settings.theme='dark'; save(); applyTheme(); render(); }); await calm(page); await shot(page, 'i11-hoy-dark');
  await page.tap('.screen.root .ahora [data-act=suggest]'); await sheetUp(page); await shot(page, 'i12-sugerir-dark');
  await ev(page, ()=>closeSheet()); await sheetGone(page);
  await ev(page, ()=>openDetail('s5')); await calm(page); await shot(page, 'i13-detail-dark');
  await ctx.close();
}

/* ======================= 3. The start of the day across days ======================= */
async function rollDays(browser){
  const T = '2026-11-02T08:00:00.000Z';
  const seed = { spaces:[{id:'trabajo',name:'Trabajo',order:0,created:T},{id:'personal',name:'Personal',order:1,created:T}], projects:[], voiceNotes:[], attachments:[], subtasks:[], projectNotes:[], settings:{tipsSeen:true, summaryDay:'2026-11-03'},
    tasks:[ tk('a', {title:'Debía el martes', projectId:null, date:'2026-11-03', created:T, modified:T}), tk('b', {title:'Debía el domingo', projectId:null, date:'2026-11-01', created:T, modified:T}),
      tk('f', {title:'Futura', projectId:null, date:'2026-11-12', created:T, modified:T}), tk('w', {title:'Espera', projectId:null, status:'waiting', date:'2026-11-02', created:T, modified:T}) ] };
  const {ctx, page} = await open(browser, {tag:'R', seed, now:NOW}); let x;
  await calm(page);
  x = {a:await cnt(page,'a'), b:await cnt(page,'b'), f:await cnt(page,'f'), w:await cnt(page,'w')};
  check('roll_day1', x.a.p===1 && x.a.s==='2026-11-03' && x.a.d==='2026-11-04' && x.a.m===T && x.b.p===1 && x.b.s==='2026-11-01' && x.b.m===T && x.f.p===null && x.w.p===null && x.w.d==='2026-11-02', x); // one start, one count, modified untouched; a waiting one never rolls
  await page.clock.setSystemTime(new Date(2026, 10, 5, 9, 0)); await ev(page, ()=>{ rollOver(); render(); });
  x = {a:await cnt(page,'a'), b:await cnt(page,'b')};
  check('roll_day2', x.a.p===2 && x.a.s==='2026-11-03' && x.a.d==='2026-11-05' && x.a.m===T && x.b.p===2, x);
  await page.clock.setSystemTime(new Date(2026, 10, 8, 9, 0)); await ev(page, ()=>{ rollOver(); render(); }); await calm(page); // three days later, one start: one count
  x = {a:await cnt(page,'a'), b:await cnt(page,'b'), ma:await meta(page,'a'), mb:await meta(page,'b')};
  check('roll_day3', x.a.p===3 && x.a.s==='2026-11-03' && x.a.d==='2026-11-08' && x.b.p===3, x);
  check('roll_label_count', x.ma && x.ma.drag==='Aplazada 3 veces', x.ma);
  x = await ev(page, ()=>{ const t=task('b'); t.postponed=1; save(); render(); return dragText(t); }); // by days: since Sunday 1, a week ago
  check('roll_label_days', x==='Desde el domingo 1', x);
  await shot(page, 'r1-days');
  await ctx.close();
}

/* ======================= 4. Desktop ======================= */
async function desktop(browser){
  const {ctx, page} = await open(browser, {tag:'D', desk:true}); let x;
  await ev(page, ()=>setDeskView('hoy')); await calm(page);
  const col = (id, c) => ev(page, ([id,c])=>{ const e=document.querySelector('#desk .main .row[data-id="'+id+'"]:not(.first .row) .'+c); return e&&{text:e.textContent, cls:e.className, shown:getComputedStyle(e).display!=='none', w:Math.round(e.getBoundingClientRect().width), color:getComputedStyle(e).color}; }, [id, c]);
  const e1=await col('s1','rc-est'), e14=await col('s14','rc-est'), d5=await col('s5','rc-date'), d7=await col('s7','rc-date'), d14=await col('s14','rc-date');
  check('desk_est_column', e1 && e1.text==='15 min' && e1.shown && e1.w>=50 && e14 && e14.text==='' && e14.shown, {e1, e14});
  check('desk_drag_column', d5 && d5.text==='Aplazada 4 veces' && /drag/.test(d5.cls) && d5.w>=110 && d7.text==='Desde el martes 27' && d14.text==='', {d5, d7, d14}); // s14 is in Aplazadas: the group says it
  await shot(page, 'd1-hoy');
  // A list without estimates has no such column
  await ev(page, ()=>{ task('h1').estimate=null; DB.settings.activeSpace='personal'; resetListState(); save(); render(); }); await calm(page);
  x = await ev(page, ()=>{ const c=document.querySelector('#desk .main .row[data-id=h1] .rc-est'); return c&&getComputedStyle(c).display; });
  check('desk_est_hidden', x==='none', x);
  await ev(page, ()=>{ task('h1').estimate=15; DB.settings.activeSpace='trabajo'; resetListState(); save(); setDeskView('hoy'); }); await calm(page);
  // The inspector: Tiempo after Prioridad, a Mac menu, Deshacer
  await page.click('#desk .main .row[data-id=s3]:not(.first .row) .row-title'); await until(page, ()=>!!document.querySelector('#desk .pane [data-act=pickEstimate]'));
  x = await ev(page, ()=>{ const l=[...document.querySelectorAll('#desk .pane .iform .ilbl')].map(e=>e.textContent); return {last:l.slice(-2).join(), val:document.querySelector('#desk .pane [data-act=pickEstimate] .val').textContent}; });
  check('insp_row', x.last==='Prioridad,Tiempo' && x.val==='1 h', x);
  await page.click('#desk .pane [data-act=pickEstimate]'); await menuSettled(page);
  x = await ev(page, ()=>[...document.querySelectorAll('#pmenu .pm-it')].map(b=>b.querySelector('.pm-l').textContent+(b.querySelector('.pm-ck svg')?'*':'')).join());
  check('insp_menu', x==='15 min,30 min,1 h*,Medio día,Quitar', x);
  await shot(page, 'd2-inspector-menu');
  await menuItem(page, '30 min').click(); await until(page, ()=>!menuOpen());
  x = {e:await ev(page, ()=>task('s3').estimate), toast:await toastText(page), val:await ev(page, ()=>document.querySelector('#desk .pane [data-act=pickEstimate] .val').textContent)};
  check('insp_sets', x.e===30 && x.toast==='Tiempo estimado: 30 min' && x.val==='30 min', x);
  await page.click('#toastBtn'); await calm(page);
  check('insp_undo', await ev(page, ()=>task('s3').estimate)===60);
  // The right button menu: Tiempo after Prioridad, its submenu
  await page.keyboard.press('Escape'); await calm(page);
  await page.click('#desk .main .row[data-id=s14]:not(.first .row) .row-title', {button:'right'}); await until(page, ()=>menuOpen());
  x = await ev(page, ()=>[...document.querySelectorAll('#pmenu .pm-menu .pm-it')].map(b=>b.querySelector('.pm-l').textContent));
  check('desk_menu', x.indexOf('Tiempo')===x.indexOf('Prioridad')+1, x);
  await menuItem(page, 'Tiempo').click(); await until(page, ()=>document.querySelectorAll('#pmenu .pm-menu').length===2);
  x = await ev(page, ()=>[...document.querySelectorAll('#pmenu .pm-menu')][1].textContent);
  check('desk_sub', /15 min/.test(x) && /Medio día/.test(x) && !/Quitar/.test(x), x);
  await shot(page, 'd3-menu');
  await menuItem(page, '15 min').click(); await until(page, ()=>!menuOpen()); await calm(page);
  check('desk_menu_sets', await ev(page, ()=>task('s14').estimate)===15 && await toastText(page)==='Tiempo estimado: 15 min');
  // The composer: «1h» in the title, then the Tiempo button over it
  await page.click('#desk [data-role=addbar]'); await page.keyboard.type('Preparar demo 1h'); await until(page, ()=>!!document.querySelector('#desk .axp [data-ax=est]'));
  x = await ev(page, ()=>({btn:document.querySelector('#desk .axp [data-ax=est]').textContent, said:(document.querySelector('#deskSaid')||{}).textContent||'', mark:[...document.querySelectorAll('#desk .qhl mark')].map(m=>m.textContent).join('|')}));
  check('ax_words', x.btn==='1 h' && /tiempo 1 h/.test(x.said) && x.mark==='1h', x);
  await page.click('#desk .axp [data-ax=est]'); await menuSettled(page);
  await shot(page, 'd4-composer');
  await menuItem(page, 'Medio día').click(); await until(page, ()=>!menuOpen()); await until(page, ()=>document.activeElement===document.querySelector('#desk [data-role=addbar]'));
  x = await ev(page, ()=>({v:document.querySelector('#desk [data-role=addbar]').value, btn:document.querySelector('#desk .axp [data-ax=est]').textContent}));
  check('ax_button', x.v==='Preparar demo' && x.btn==='Medio día', x);
  await page.keyboard.press('Enter'); await until(page, ()=>DB.tasks.some(t=>t.title==='Preparar demo'));
  x = await ev(page, ()=>{ const t=DB.tasks.find(t=>t.title==='Preparar demo'); return {e:t.estimate, ax:AX.estimate===undefined}; });
  check('ax_created', x.e===240 && x.ax, x);
  await page.keyboard.press('Escape'); await calm(page);
  // A drag to a later day of the list counts, Deshacer gives it back; a slot of the hours grid too
  x = await ev(page, ()=>{ dropToDay(['s1'], '2026-11-05'); const a={p:task('s1').postponed, s:task('s1').carriedSince, d:task('s1').date}; undoFn(); const b={p:task('s1').postponed||null, d:task('s1').date};
    dropTask('s4', {dataset:{slot:'2026-11-06T09:00'}}); const c={p:task('s4').postponed, d:task('s4').date, r:!!task('s4').reminder}; undoFn(); const d={p:task('s4').postponed||null, d:task('s4').date, r:task('s4').reminder};
    dropMany(['s1','s4'], {dataset:{day:'2026-11-09'}}); const e=[task('s1').postponed, task('s4').postponed]; undoFn(); const f=[task('s1').postponed||null, task('s4').postponed||null]; return {a, b, c, d, e, f}; });
  check('count_drag', x.a.p===1 && x.a.s==='2026-11-04' && x.a.d==='2026-11-05' && x.b.p===null && x.b.d==='2026-11-04' && x.c.p===1 && x.c.d==='2026-11-06' && x.c.r && x.d.p===null && x.d.d==='2026-11-04' && x.d.r===null && x.e.join()==='1,1' && x.f.join()===',', x);
  await ev(page, ()=>render()); await calm(page);
  // Partir en pasos opens the inspector with the focus in Añadir paso
  await ev(page, ()=>reviewStep(['s5'], 0, {kind:'carried', prev:new Map(), removed:[], tally:{}})); await sheetUp(page);
  await page.click('#sheet [data-x=split]'); await sheetGone(page);
  x = await ev(page, ()=>({id:UI.deskDetail, role:document.activeElement&&document.activeElement.dataset.role, inPane:!!document.activeElement&&!!document.activeElement.closest('#desk .pane')}));
  check('desk_split_focus', x.id==='s5' && x.role==='stepadd' && x.inPane, x);
  await sleep(300); await shot(page, 'd5-split');
  await ev(page, ()=>{ document.activeElement&&document.activeElement.blur(); }); await page.keyboard.press('Escape'); await calm(page);
  // Sugerir: a popover from the head of Ahora and from the view menu; a click puts it in Ahora
  await page.click('#desk .ahora [data-act=suggest]'); await until(page, ()=>!!document.querySelector('#pmenu .pm-pop .sg')); await menuSettled(page);
  x = await ev(page, ()=>({t:document.querySelector('#pmenu .sgtitle').textContent, rows:[...document.querySelectorAll('#pmenu .sgrow')].map(r=>r.dataset.sg).join(), warn:(document.querySelector('#pmenu .sgwarn')||{}).textContent||'', w:Math.round(document.querySelector('#pmenu .pm-pop').getBoundingClientRect().width)}));
  check('desk_sg', x.t==='¿Qué hago ahora?' && x.rows==='s2,s4,s5' && /a las 10:20/.test(x.warn) && x.w>=330, x);
  await shot(page, 'd6-sugerir');
  await page.click('#pmenu [data-sg-min="60"]'); await until(page, ()=>[...document.querySelectorAll('#pmenu .sgrow')].map(r=>r.dataset.sg).join()==='s2,s3,s4');
  await page.click('#pmenu .sgrow[data-sg=s3] .sgmain'); await until(page, ()=>!menuOpen()); await calm(page);
  check('desk_sg_ahora', await ev(page, ()=>!!task('s3').focus && !!document.querySelector('#desk .ahora .row[data-id=s3]')) && await toastText(page)==='Añadida a Ahora');
  await page.click('#desk .mhead [data-act=viewMenu]'); await until(page, ()=>menuOpen());
  await menuItem(page, '¿Qué hago ahora?').click(); await until(page, ()=>!!document.querySelector('#pmenu .pm-pop .sg'));
  check('desk_viewmenu_sg', await ev(page, ()=>document.querySelectorAll('#pmenu .sgrow').length===3));
  await page.keyboard.press('Escape'); await until(page, ()=>!menuOpen());
  // Dark
  await ev(page, ()=>{ DB.settings.theme='dark'; save(); applyTheme(); setDeskView('hoy'); }); await calm(page);
  await page.click('#desk .main .row[data-id=s5]:not(.first .row) .row-title'); await until(page, ()=>!!document.querySelector('#desk .pane [data-act=pickEstimate]')); await sleep(300);
  await shot(page, 'd7-hoy-dark');
  await page.click('#desk .ahora [data-act=suggest]'); await until(page, ()=>!!document.querySelector('#pmenu .pm-pop .sg')); await menuSettled(page); await shot(page, 'd8-sugerir-dark');
  await ctx.close();
}

/* ======================= 5. Sync ======================= */
const TABLES = ['spaces','projects','tasks','voice_notes','attachments','subtasks','project_notes','contacts'];
const COLS = { spaces:['name','sort_order','members'], projects:['space_id','name','color','sort_order','archived'],
  tasks:['space_id','project_id','title','date','reminder','priority','status','notes','carried','assignees','completed','repeat','focus','waiting_for','deadline','estimate','postponed','carried_since'], voice_notes:['task_id','text'],
  attachments:['task_id','kind','path','mime','size','width','height','duration_ms','purged'], subtasks:['task_id','title','done','sort_order'], project_notes:['project_id','title','body','pinned'], contacts:['name','email','phone'] };
// rm-DL's in-memory server; noCol: a database where 0008 has not run (an upload naming one of its columns is refused whole, with PostgREST's message)
const NEWCOLS=['estimate','postponed','carried_since'];
class Fake {
  constructor(noCol){ this.noCol=!!noCol; this.t={}; TABLES.forEach(x=>this.t[x]=new Map()); this.last=0; this.subs=new Map(); this.down=new Set(); this.calls=[]; this.ups=[]; }
  ts(){ this.last=Math.max(Date.now(), this.last+1); return new Date(this.last).toISOString(); }
  cols(table){ return COLS[table].filter(c=>!(this.noCol&&table==='tasks'&&NEWCOLS.includes(c))); }
  write(owner, table, rows){ if(!owner) throw new Error('JWT required'); const ts=this.ts(), out=[], changed=[], m=this.t[table];
    if(this.noCol&&table==='tasks'){ for(const c of NEWCOLS) if(rows.some(r=>c in r)) throw new Error("Could not find the '"+c+"' column of 'tasks' in the schema cache"); }
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
const synced = page => until(page, ()=>SY&&SY.user&&!SY.running&&SY.status==='ok'&&syncCollect(true).count===0);
async function syncTests(browser){
  const d0 = new Date(); const day = n => { const d=new Date(d0); d.setDate(d.getDate()+n); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); };
  const T = '2026-11-01T10:00:00.000Z';
  const st = (id, o) => Object.assign({id, title:id, spaceId:'trabajo', projectId:null, date:day(0), reminder:null, priority:'none', status:'pending', notes:'', carried:false, created:T, modified:T, completed:null}, o);
  const seed = { spaces:[{id:'trabajo',name:'Trabajo',order:0,created:T},{id:'personal',name:'Personal',order:1,created:T}], projects:[], voiceNotes:[], attachments:[], settings:{tipsSeen:true},
    tasks:[ st('u1', {title:'Sin nada'}), st('u2', {title:'Con todo', estimate:30, postponed:2, carriedSince:day(-3), carried:true}) ] };
  const fake = new Fake(false); let x;
  const A = await open(browser, {tag:'SA', fake, seed, clock:false}), B = await open(browser, {tag:'SB', fake, seed:Object.assign({}, seed, {tasks:[]}), clock:false, desk:true});
  x = await ev(A.page, ()=>{ const r1=syncToRow('tasks', task('u1')), r2=syncToRow('tasks', task('u2')); return {k1:Object.keys(r1).join(), r2:[r2.estimate, r2.postponed, r2.carried_since], sent:['estimate','postponed','carried_since'].every(k=>k in syncSendRow('tasks', r1)&&syncSendRow('tasks', r1)[k]===null),
    intN:[SYNC_TO.intN(0), SYNC_TO.intN(null), SYNC_TO.intN('30'), SYNC_TO.intN(-2), SYNC_TO.intN('x')].join()}; });
  check('sync_signature_unchanged', x.k1==='id,created,space_id,project_id,title,date,reminder,priority,status,notes,carried,completed,modified,deleted' && x.r2.join()==='30,2,'+day(-3) && x.sent && x.intN===',,30,,', x);
  await ev(A.page, ()=>syncSignIn()); check('sync_A_first', await synced(A.page));
  await ev(B.page, ()=>syncSignIn()); check('sync_B_first', await synced(B.page));
  const s2=()=>fake.t.tasks.get('u2'), s1=()=>fake.t.tasks.get('u1');
  check('sync_server_values', s2().estimate===30 && s2().postponed===2 && s2().carried_since===day(-3) && s1().estimate===null && s1().postponed===null, {s2:s2(), s1:s1()});
  check('sync_B_gets', await until(B.page, d=>{ const t=task('u2'); return !!t&&t.estimate===30&&t.postponed===2&&t.carriedSince===d; }, day(-3)), await ev(B.page, ()=>task('u2')));
  // No re-upload of untouched tasks: a later run sends nothing
  const n0 = fake.ups.length; await ev(A.page, ()=>syncRun('manual')); await synced(A.page); await ev(B.page, ()=>syncRun('manual')); await synced(B.page);
  check('sync_no_reupload', fake.ups.length===n0, fake.ups.slice(n0).map(u=>u.table+':'+u.rows.map(r=>r.id).join()));
  // Set on B, it reaches A; cleared on A, cleared everywhere
  await ev(B.page, ()=>setEstimate('u1', 240)); check('sync_B_up', await synced(B.page));
  check('sync_A_gets', await until(A.page, ()=>task('u1').estimate===240) && s1().estimate===240);
  await ev(A.page, ()=>setEstimate('u2', null)); check('sync_A_up', await synced(A.page));
  check('sync_cleared', s2().estimate===null && await until(B.page, ()=>task('u2').estimate==null), s2().estimate);
  // The start of a day counts without a new modified: the count goes up and reaches B
  x = await ev(A.page, d=>{ const t=task('u1'); t.date=d; t.modified=new Date().toISOString(); save(); return t.modified; }, day(-1)); await synced(A.page);
  const m0 = x; x = await ev(A.page, ()=>{ rollOver(); render(); const t=task('u1'); return {p:t.postponed, s:t.carriedSince, m:t.modified}; });
  check('sync_rollover_local', x.p===1 && x.m===m0, x);
  check('sync_rollover_up', await synced(A.page) && s1().postponed===1 && s1().carried_since===day(-1) && s1().modified===m0, s1());
  check('sync_rollover_B', await until(B.page, d=>task('u1').postponed===1&&task('u1').carriedSince===d&&task('u1').date===d, day(0)) || await until(B.page, ()=>task('u1').postponed===1), await ev(B.page, ()=>task('u1')));
  await A.ctx.close(); await B.ctx.close();

  // A database without the columns: one line in the log, the values stay on the device, nothing goes up again and again
  const nf = new Fake(true);
  const Cx = await open(browser, {tag:'SC', fake:nf, seed, clock:false});
  await ev(Cx.page, ()=>syncSignIn());
  check('nocol_synced', await synced(Cx.page), await ev(Cx.page, ()=>({st:SY&&SY.status, err:SY&&SY.error})));
  await ev(Cx.page, ()=>updTask('u1', {title:'Sin nada (editada)'})); await synced(Cx.page);
  const n1 = nf.ups.length; await sleep(3500); await synced(Cx.page);
  x = await ev(Cx.page, ()=>({t:task('u2'), warns:LOG.filter(e=>/0008_estimate_postponed/.test(e.m)).map(e=>e.m), errs:LOG.filter(e=>e.l==='error').map(e=>e.m), pend:syncCollect(true).count}));
  const u2row = nf.t.tasks.get('u2'), u1row = nf.t.tasks.get('u1');
  check('nocol_tolerated', x.t.estimate===30 && x.t.postponed===2 && x.warns.length===1 && /tasks\.estimate, tasks\.postponed y tasks\.carried_since/.test(x.warns[0]) && /se quedan en este dispositivo/.test(x.warns[0]) && !x.errs.length && x.pend===0 && u2row && !('estimate' in u2row) && !('postponed' in u2row) && u1row.title==='Sin nada (editada)', {x, u2row});
  check('nocol_no_loop', nf.ups.length===n1, {before:n1, after:nf.ups.length});
  const later = new Date(Date.now()+1000).toISOString();
  nf.write(USER.uid, 'tasks', [Object.assign({}, u2row, {title:'Con todo (servidor)', modified:later})]);
  await until(Cx.page, ()=>task('u2').title==='Con todo (servidor)');
  x = await ev(Cx.page, ()=>({t:task('u2').title, e:task('u2').estimate, p:task('u2').postponed, s:task('u2').carriedSince}));
  check('nocol_merge_keeps', x.t==='Con todo (servidor)' && x.e===30 && x.p===2 && !!x.s, x);
  await Cx.ctx.close();
}

(async()=>{
  await new Promise(res=>srv.listen(PORT,res)); const browser = await chromium.launch();
  try{ await sqlTests(); }catch(e){ fails.push('sql_exception'); errors.push('sql: '+String(e&&e.stack||e)); }
  try{ await iphone(browser); }catch(e){ fails.push('iphone_exception'); errors.push('iphone: '+String(e&&e.stack||e)); }
  try{ await rollDays(browser); }catch(e){ fails.push('roll_exception'); errors.push('roll: '+String(e&&e.stack||e)); }
  try{ await desktop(browser); }catch(e){ fails.push('desktop_exception'); errors.push('desktop: '+String(e&&e.stack||e)); }
  try{ await syncTests(browser); }catch(e){ fails.push('sync_exception'); errors.push('sync: '+String(e&&e.stack||e)); }
  console.log(JSON.stringify({r, fails, errors}, null, 1));
  await browser.close(); srv.close(); process.exit(fails.length||errors.length?1:0);
})();
