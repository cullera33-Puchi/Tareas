require('./lib/out.js'); // outputs (screenshots, downloads) go to tests/out
// Decision 48a (M2, Fecha límite), port 10400. Screenshots in tests/out/dl.
//  1. SQL: supabase/migrations/0007_deadline.sql run twice in PGlite after 0001 to 0006 (stand-ins for auth, pg_cron, pg_net and Storage):
//     the column (a date, nullable), "newest modified wins" on it. Then all.sql run twice on a fresh database and check.sql: every row OK,
//     the deadline row among them.
//  2. iPhone, clock at Wednesday 4 November 2026 10:00: Hoy takes the tasks whose deadline has come (later date, no date, waiting), once each,
//     never as Aplazada; para hoy, aplazadas and the badge count them so; Todas puts them in Hoy; Por confirmar keeps the others; the row
//     texts and colours (red on the day and after, orange two days before, grey earlier); rollOver leaves the deadline; the detail row with
//     the calendar sheet (no past day, Mañana, Quitar, Deshacer); the long press menu; repeating tasks (offset kept, none without a date,
//     Eliminar solo esta); Duplicar; share text, CSV and export; light and dark screenshots.
//  3. Desktop: the deadline column (only when some row uses it), the inspector popover with Deshacer, the right button submenu, the week card
//     flag; light and dark screenshots.
//  4. Sync with rm-RF's fake server, two devices: the deadline goes up and comes down, a cleared one is cleared everywhere, a task without one
//     keeps its signature, and a database without the column (0007 not run) is tolerated (logged once, the value stays, no upload loop).
const { chromium } = require('playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = path.resolve(__dirname, '..'), PORT = 10400, URL0 = 'http://localhost:'+PORT+'/';
const OUT = path.join(__dirname, 'out', 'dl'); fs.mkdirSync(OUT, {recursive:true});
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
  let db = await pgSetup();
  for(const f of ['0001_init.sql','0002_push.sql','0003_attachments.sql','0004_repeat_focus.sql','0005_subtasks.sql','0006_project_notes.sql']) await db.exec(strip(rd(f)));
  let err = null; try { await db.exec(rd('0007_deadline.sql')); await db.exec(rd('0007_deadline.sql')); } catch(e){ err = e.message; }
  check('sql_runs_twice', !err, err);
  const q = async (sql, params) => (await db.query(sql, params)).rows;
  const tryq = async (sql, params) => { try { return {rows: await q(sql, params)}; } catch(e){ return {error: e.message}; } };
  const col = await q(`select data_type, is_nullable from information_schema.columns where table_schema='public' and table_name='tasks' and column_name='deadline'`);
  check('sql_column', col.length===1 && col[0].data_type==='date' && col[0].is_nullable==='YES', col);
  const A = '00000000-0000-4000-8000-00000000000a';
  await db.exec(`insert into auth.users values ('${A}')`);
  const as = async (uid, fn) => { await db.exec(`set test.uid = '${uid}'; set role authenticated;`); try { return await fn(); } finally { await db.exec(`reset role; reset test.uid;`); } };
  const ins = await as(A, () => tryq(`insert into public.tasks (id, title, date, deadline, modified) values ('t1', 'Informe', '2026-11-06', '2026-11-04', '2026-11-04T09:00:00Z') returning deadline::text`));
  const older = await as(A, () => tryq(`update public.tasks set deadline = '2026-11-30', modified = '2026-11-03T00:00:00Z' where id = 't1' returning id`));
  const newer = await as(A, () => tryq(`update public.tasks set deadline = null, modified = '2026-11-04T10:00:00Z' where id = 't1' returning id`));
  const t1 = (await q(`select deadline from public.tasks where id = 't1'`))[0];
  check('sql_newest_wins', ins.rows && ins.rows[0].deadline==='2026-11-04' && older.rows && !older.rows.length && newer.rows && newer.rows.length===1 && t1.deadline===null, {ins, older, newer, t1});
  await db.close();
  db = await pgSetup(); const all = strip(fs.readFileSync(path.join(ROOT, 'supabase/all.sql'), 'utf8'));
  err = null; try { await db.exec(all); await db.exec(all); } catch(e){ err = e.message; }
  check('sql_all_twice', !err && /0001 a 0007/.test(all.split('\n')[0]) && /migrations\/0007_deadline\.sql/.test(all) && (all.match(/^-- ========== migrations\//mg)||[]).length===fs.readdirSync(path.join(ROOT,'supabase/migrations')).filter(f=>f.endsWith('.sql')).length, err);
  let rows = []; try { rows = (await db.query(fs.readFileSync(path.join(ROOT, 'supabase/check.sql'), 'utf8'))).rows; } catch(e){ err = e.message; }
  check('sql_check_all_ok', rows.length>=20 && rows.every(x=>x.Estado==='OK') && rows.some(x=>/tasks\.deadline \(0007\)/.test(x.Pieza)), {err, bad:rows.filter(x=>x.Estado!=='OK'), n:rows.length});
  const readme = fs.readFileSync(path.join(ROOT, 'supabase/README.md'), 'utf8');
  check('sql_readme', /`migrations\/0007_deadline\.sql` \| Fecha límite de una tarea \| v0\.25\.0/.test(readme), null);
  await db.close();
}

/* ======================= Pages ======================= */
const NOW = new Date(2026, 10, 4, 10, 0, 0); // Wednesday 4 November 2026, 10:00 local: before 19:00, no Cerrar el día
const T0 = '2026-11-03T08:00:00.000Z';
const tk = (id, o) => Object.assign({id, title:id, spaceId:'trabajo', projectId:'p1', date:'2026-11-04', reminder:null, priority:'none', status:'pending', notes:'', carried:false, created:T0, modified:T0, completed:null}, o);
const SEED = () => ({ spaces:[{id:'trabajo',name:'Trabajo',order:0,created:T0},{id:'personal',name:'Personal',order:1,created:T0}],
  projects:[{id:'p1', spaceId:'trabajo', name:'FLC', color:'#007AFF', order:0, archived:false, created:T0, modified:T0},{id:'p9', spaceId:'personal', name:'Casa', color:'#FF9500', order:0, archived:false, created:T0, modified:T0}],
  tasks:[ tk('d1', {title:'Entregar informe', date:'2026-11-06', deadline:'2026-11-04', priority:'high'}), // later date, deadline today
    tk('d2', {title:'Presupuesto de obra', date:null, deadline:'2026-11-02'}), // no date, deadline past
    tk('d3', {title:'Revisar contrato', deadline:'2026-11-06'}), // today, deadline in two days: orange
    tk('d4', {title:'Plan de pruebas', deadline:'2026-11-20'}), // today, deadline later: grey
    tk('d5', {title:'Llamar a Marta', carried:true, deadline:'2026-11-04'}), // carried and due: Aplazadas, once
    tk('d6', {title:'Firma del cliente', status:'waiting', waitingFor:'Cliente', date:null, deadline:'2026-11-04'}), // waiting, deadline today
    tk('d7', {title:'Preparar demo', date:'2026-11-05', deadline:'2026-11-05'}), // tomorrow
    tk('d8', {title:'Cerrar acta', status:'done', completed:'2026-11-03T12:00:00.000Z', deadline:'2026-11-03'}),
    tk('d9', {title:'Sin límite'}),
    tk('w2', {title:'Esperando datos', status:'waiting', date:'2026-11-10'}),
    tk('r1', {title:'Informe semanal', repeat:'W1:WE@2026-11-04#ser1', deadline:'2026-11-06'}),
    tk('r2', {title:'Revisar correo', repeat:'D1@2026-11-04#ser2', date:null, deadline:'2026-11-05'}),
    tk('r3', {title:'Pagar facturas', repeat:'W1:WE@2026-11-04#ser3', date:'2026-11-11', deadline:'2026-11-13'}),
    tk('h1', {title:'Comprar pintura', spaceId:'personal', projectId:'p9'}) ],
  voiceNotes:[], attachments:[], subtasks:[], projectNotes:[], settings:{tipsSeen:true} });
async function open(browser, o){
  const vp = o.desk ? {viewport:{width:1280,height:800}, deviceScaleFactor:1} : {viewport:{width:390,height:844}, deviceScaleFactor:2, isMobile:true, hasTouch:true};
  const ctx = await browser.newContext(Object.assign(vp, {colorScheme:o.theme||'light'})); const page = await ctx.newPage();
  if(o.clock!==false) await page.clock.install({time:NOW});
  page.on('pageerror', e=>errors.push(o.tag+' pageerror: '+e.message)); page.on('console', m=>{ if(m.type()==='error') errors.push(o.tag+' console: '+m.text()); });
  await page.addInitScript(()=>{ window.__badge=null; navigator.setAppBadge=n=>{ window.__badge=n; return Promise.resolve(); }; navigator.clearAppBadge=()=>{ window.__badge=0; return Promise.resolve(); }; });
  if(o.fake){ await page.exposeBinding('fakeServer', (src, op, a)=>o.fake.handle(src.page, op, a)); await page.addInitScript(fakeAdapter); await page.addInitScript(u=>{ window.__fakeUser=u; }, USER); }
  await page.addInitScript(s=>{ if(!localStorage.getItem('tareas-v1')) localStorage.setItem('tareas-v1', s); }, JSON.stringify(o.seed||SEED()));
  await page.goto(URL0); await until(page, ()=>typeof DB!=='undefined'&&!!document.querySelector(UI.wide?'#desk .main':'.screen.root')); return {ctx, page};
}
const ev = (page, fn, arg) => page.evaluate(fn, arg);
const until = async (page, fn, arg, ms=8000)=>{ const t0=Date.now(); for(;;){ let v=false; try{ v=await page.evaluate(fn, arg); }catch(e){} if(v) return true; if(Date.now()-t0>ms) return false; await sleep(80); } };
// Settled: no slide, no sheet or menu moving, no held row waiting, no row leaving (CI is slower than a laptop: wait on the state, not on a time)
const calm = page => until(page, ()=>!app.classList.contains('navigating') && !HELD.size && !document.querySelector('.row.leaving, .flip, .enter') && !touchDrag);
const sheetUp = page => until(page, ()=>{ const s=document.querySelector('#sheet'); return s.classList.contains('on') && !sheetFresh(); });
const toastText = page => ev(page, ()=>document.querySelector('#toast').classList.contains('on')?document.querySelector('#toastText').textContent:'');
const menuItem = (page, label) => page.locator('#pmenu .pm-it').filter({has: page.locator('.pm-l', {hasText: new RegExp('^'+label.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'$')})}).first();
const menuLabels = page => ev(page, ()=>[...document.querySelectorAll('#pmenu .pm-list .pm-it')].map(b=>b.querySelector('.pm-l').firstChild.textContent));
const meta = (page, id) => ev(page, id=>{ const r=document.querySelector('.screen.root .scroll .row[data-id="'+id+'"]:not(.first .row)'); if(!r) return null; const d=r.querySelector('.row-meta .dl');
  return {text:(r.querySelector('.row-meta')||{}).textContent||'', dl:d&&d.textContent, cls:d&&d.className, color:d&&getComputedStyle(d).color}; }, id);

/* ======================= 2. iPhone ======================= */
async function iphone(browser){
  const {ctx, page} = await open(browser, {tag:'I'}); let x;
  await calm(page);
  // Hoy: once each, by date or by deadline
  x = await ev(page, ()=>{ const h=pendingFor('hoy').map(x=>x.id); return {h:h.slice().sort().join(), dup:h.length!==new Set(h).size, carried:pendingFor('hoy').filter(carriedOn).map(x=>x.id).join(), todas:pendingFor('todas').map(x=>x.id).sort().join(), wl:waitingList().map(x=>x.id).join(), badge:window.__badge}; });
  check('hoy_list', x.h==='d1,d2,d3,d4,d5,d6,d9,r1' && !x.dup, x);
  check('hoy_not_carried', x.carried==='d5', x);
  check('todas_has_waiting_due', x.todas.split(',').includes('d6') && !x.todas.split(',').includes('w2') && !x.todas.split(',').includes('d8'), x);
  check('waiting_block_keeps_others', x.wl==='w2', x);
  check('badge_counts_deadline', x.badge===9, x.badge); // the 8 of Hoy and Personal's one
  // The summary: para hoy 8, aplazadas 1; the Aplazadas group holds only d5
  x = await ev(page, ()=>{ const nums=[...document.querySelectorAll('.screen.root .summary .num b')].map(b=>b.textContent); const groups={}; let cur=null;
    document.querySelectorAll('.screen.root .scroll .group-title, .screen.root .scroll .group').forEach(e=>{ if(e.classList.contains('group-title')) cur=e.textContent.replace(/Repasar.*/,'').trim(); else if(cur) groups[cur]=(groups[cur]||[]).concat([...e.querySelectorAll('.row')].map(r=>r.dataset.id)); });
    return {nums, groups}; });
  check('summary_counts', x.nums[0]==='8' && x.nums[1]==='1', x.nums);
  check('hoy_groups', (x.groups.Aplazadas||[]).join()==='d5' && (x.groups.Hoy||[]).length===7 && !(x.groups.Hoy||[]).includes('d5'), x.groups);
  // Row texts and colours
  const m1=await meta(page,'d1'), m2=await meta(page,'d2'), m3=await meta(page,'d3'), m4=await meta(page,'d4'), m5=await meta(page,'d5'), m6=await meta(page,'d6');
  check('row_due_today', m1 && m1.dl==='Entrega hoy' && /dl-due/.test(m1.cls) && /Viernes/.test(m1.text) && !/Aplazada/.test(m1.text), m1);
  check('row_due_past', m2 && m2.dl==='Entrega 2 nov' && /dl-due/.test(m2.cls), m2);
  check('row_soon', m3 && m3.dl==='Entrega viernes' && /dl-soon/.test(m3.cls) && m3.color!==m4.color, {m3, m4});
  check('row_grey', m4 && m4.dl==='Entrega 20 nov' && m4.cls==='dl', m4);
  check('row_carried_once', m5 && m5.dl==='Entrega hoy' && !/Aplazada/.test(m5.text), m5); // the Aplazadas group says it
  check('row_waiting', m6 && m6.dl==='Entrega hoy' && /Esperando a Cliente/.test(m6.text) && await ev(page, ()=>!!document.querySelector('.screen.root .row[data-id=d6] .check.waiting')), m6);
  x = await ev(page, ()=>{ return {preview:(document.querySelector('.screen.root .preview')||{}).textContent||''}; });
  check('preview_tomorrow', /Mañana: 2 tareas/.test(x.preview), x); // d7 by its date, r2 by its deadline
  await shot(page, 'i1-hoy');
  // Todas: d1 and d2 under Hoy, d7 under Mañana (said once: its date is its deadline), r2 under Sin fecha
  x = await ev(page, ()=>{ const h=listHTML('todas'), box=document.createElement('div'); box.innerHTML=h; const out={};
    box.querySelectorAll('.gsec').forEach(s=>{ const l=s.querySelector('.gl').firstChild.textContent.trim(); out[l]=[...s.querySelectorAll('.row')].map(r=>r.dataset.id); });
    const d7=box.querySelector('.row[data-id=d7] .row-meta'); return {out, d7:d7&&d7.textContent}; });
  check('todas_groups', x.out.Hoy && x.out.Hoy.includes('d1') && x.out.Hoy.includes('d2') && (x.out['Sin fecha']||[]).join()==='r2' && (x.out['Mañana']||[]).join()==='d7' && !Object.keys(x.out).some(k=>/^Viernes/.test(k)&&x.out[k].includes('d1')), x.out);
  check('todas_said_once', x.d7==='FLCEntrega mañana', x.d7); // the capsule and the deadline, no second «Mañana»
  // rollOver moves the date, never the deadline
  x = await ev(page, ()=>{ addTask({id:'x0', title:'Atrasada', projectId:'p1', date:'2026-11-02', deadline:'2026-11-03'}); DB.settings.summaryDay='2026-11-03'; save(); rollOver(); const o=task('x0'); const r={date:o.date, carried:o.carried, dl:o.deadline, d1:task('d1').deadline, d1d:task('d1').date}; DB.tasks=DB.tasks.filter(t=>t.id!=='x0'); save(); render(); return r; });
  check('rollover_keeps_deadline', x.date==='2026-11-04' && x.carried===true && x.dl==='2026-11-03' && x.d1==='2026-11-04' && x.d1d==='2026-11-06', x);
  await calm(page);

  // The detail: Fecha límite row and its sheet
  await ev(page, ()=>openDetail('d4')); await calm(page);
  x = await ev(page, ()=>{ const c=document.querySelector('.pushed-screen.detail [data-act=pickDeadline]'); const cells=[...document.querySelectorAll('.pushed-screen.detail .group .cell .lbl')].map(e=>e.textContent); return {val:c&&c.querySelector('.val').textContent, order:cells.slice(cells.indexOf('Fecha'), cells.indexOf('Fecha')+3).join()}; });
  check('detail_row', x.val==='20 nov' && x.order==='Fecha,Fecha límite,Recordatorio', x);
  await shot(page, 'i2-detail');
  await page.tap('.pushed-screen.detail [data-act=pickDeadline]'); await sheetUp(page);
  x = await ev(page, ()=>({title:document.querySelector('#sheet h2').textContent, chips:[...document.querySelectorAll('#sheet .chip')].map(c=>c.textContent+(c.classList.contains('on')?'*':'')), past:document.querySelectorAll('#sheet .cal-d.past[disabled]').length, sel:(document.querySelector('#sheet .cal-d.sel')||{}).textContent||'', pick3:!!document.querySelector('#sheet [data-d="2026-11-03"]')}));
  check('sheet_content', x.title==='Fecha límite' && x.chips.join()==='Hoy,Mañana,Este viernes,Próxima semana,Quitar' && x.past>=2 && !x.pick3 && x.sel==='20', x); // a Wednesday: Este viernes too
  await shot(page, 'i3-sheet');
  await page.tap('#sheet .chip[data-d="2026-11-05"]'); await calm(page); await until(page, ()=>!document.querySelector('#sheet').classList.contains('on'));
  x = {dl:await ev(page, ()=>task('d4').deadline), toast:await toastText(page), val:await ev(page, ()=>{ const c=document.querySelector('.pushed-screen.detail [data-act=pickDeadline] .val'); return c&&c.textContent+'|'+c.className; })};
  check('sheet_sets', x.dl==='2026-11-05' && x.toast==='Entrega mañana' && /^Mañana\|.*dl-soon/.test(x.val), x);
  await page.tap('#toastBtn'); await calm(page);
  check('sheet_undo', await ev(page, ()=>task('d4').deadline)==='2026-11-20');
  await page.tap('.pushed-screen.detail [data-act=pickDeadline]'); await sheetUp(page);
  await page.tap('#sheet .chip[data-d=""]'); await calm(page); await until(page, ()=>!document.querySelector('#sheet').classList.contains('on'));
  x = {dl:await ev(page, ()=>task('d4').deadline), toast:await toastText(page), val:await ev(page, ()=>document.querySelector('.pushed-screen.detail [data-act=pickDeadline] .val').textContent)};
  check('sheet_quitar', x.dl===null && x.toast==='Sin fecha límite' && x.val==='Ninguna', x);
  await page.tap('#toastBtn'); await calm(page);
  check('quitar_undo', await ev(page, ()=>task('d4').deadline)==='2026-11-20');
  await page.tap('.pushed-screen.detail [data-act=back]'); await calm(page);

  // The long press menu: Fecha límite next to Aplazar, its submenu
  await ev(page, ()=>rowMenu('d9')); await until(page, ()=>menuOpen());
  x = await menuLabels(page);
  check('menu_item', x[0]==='Aplazar' && x[1]==='Fecha límite', x);
  await sleep(500); await menuItem(page, 'Fecha límite').tap(); await until(page, ()=>!!document.querySelector('#pmenu .pm-head'));
  x = await menuLabels(page);
  check('menu_sub', ['Hoy','Mañana','Viernes','Próxima semana','Elegir fecha'].every(l=>x.includes(l)) && !x.includes('Quitar'), x);
  await until(page, ()=>{ const l=document.querySelector('#pmenu .pm-list'); return l && !l.getAnimations().some(a=>a.playState==='running'); }); await shot(page, 'i4-menu');
  await menuItem(page, 'Viernes').tap(); await until(page, ()=>!menuOpen()); await calm(page);
  x = {dl:await ev(page, ()=>task('d9').deadline), toast:await toastText(page)};
  check('menu_sets', x.dl==='2026-11-06' && x.toast==='Entrega el viernes 6', x);

  // Repeating tasks: the next keeps the offset; without a date, none; Eliminar solo esta moves it too, Deshacer puts it back
  x = await ev(page, ()=>{ completeTask('r1'); completeTask('r2'); const n1=DB.tasks.find(o=>o.id!=='r1'&&repSeries(o.repeat)==='ser1'), n2=DB.tasks.find(o=>o.id!=='r2'&&repSeries(o.repeat)==='ser2');
    const undo=skipOccurrence('r3', true); const s=task('r3'), sk={date:s.date, dl:s.deadline}; undo(); return {n1:n1&&n1.date+'|'+n1.deadline, n2:n2&&n2.date+'|'+(n2.deadline||null), sk, back:task('r3').date+'|'+task('r3').deadline}; });
  check('repeat_offset', x.n1==='2026-11-11|2026-11-13', x);
  check('repeat_no_date', x.n2==='2026-11-05|null', x);
  check('repeat_skip', x.sk.date==='2026-11-18' && x.sk.dl==='2026-11-20' && x.back==='2026-11-11|2026-11-13', x);
  // A carried occurrence (Monday 2, deadline Wednesday 4, carried to today by rollOver) keeps its offset from the series date, not from today
  x = await ev(page, ()=>{ DB.tasks.push(Object.assign({}, task('r1'), {id:'rc', title:'Acta semanal', repeat:'W1:MO@2026-11-02#serc', date:'2026-11-04', carried:true, deadline:'2026-11-04', status:'pending'})); save();
    completeTask('rc'); const n=DB.tasks.find(o=>o.id!=='rc'&&repSeries(o.repeat)==='serc'); const r=n&&n.date+'|'+n.deadline; undoFn(); return r; });
  check('repeat_carried_no_drift', x==='2026-11-09|2026-11-11', x);
  await ev(page, ()=>{ DB.tasks=DB.tasks.filter(o=>repSeries(o.repeat)!=='serc'); save(); render(); });
  // Cerrar el día leaves the tasks whose deadline has come in Hoy (their work date is not pulled earlier) and says so
  x = await ev(page, ()=>{ const t=todayStr(); DB.tasks.push(Object.assign({}, task('r1'), {id:'cd1', title:'Entrega hoy', repeat:null, date:'2026-11-20', deadline:t, carried:false, status:'pending'}), Object.assign({}, task('r1'), {id:'cd2', title:'Normal de hoy', repeat:null, date:t, deadline:null, carried:false, status:'pending'})); save(); render();
    closeDaySheet(); const sh=document.querySelector('#sheet'); const foot=[...sh.querySelectorAll('.cdfoot')].map(e=>e.textContent).join('|'); sh.querySelector('[data-cd=all]').click();
    const r={foot, cd1:task('cd1').date, cd2:task('cd2').date}; undoFn(); DB.tasks=DB.tasks.filter(o=>!['cd1','cd2'].includes(o.id)); save(); render(); return r; });
  check('close_day_keeps_deadline', /tareas? con entrega hoy o vencida se queda/.test(x.foot) && x.cd1==='2026-11-20' && x.cd2==='2026-11-05', x);
  await ev(page, ()=>{ closeSheet(); document.querySelector('#toast').classList.remove('on'); }); await sleep(600);
  await calm(page);
  // Duplicar copies it; share text, CSV and export say it
  x = await ev(page, ()=>{ const n0=DB.tasks.length; duplicateTask('d3'); const c=DB.tasks[DB.tasks.length-1]; return {n:DB.tasks.length-n0, dl:c.deadline, t:c.title, id:c.id}; });
  check('duplicate', x.n===1 && x.dl==='2026-11-06' && x.t==='Revisar contrato', x);
  await calm(page); await ev(page, ()=>pop()); await calm(page); await ev(page, id=>{ DB.tasks=DB.tasks.filter(o=>o.id!==id); save(); render(); }, x.id); await calm(page);
  x = await ev(page, ()=>({share:shareText('d3'), share9:shareText('h1'), csv:csvText(), json:JSON.stringify(exportData())}));
  const head = x.csv.split('\r\n')[0], line = x.csv.split('\r\n').find(l=>l.includes('Revisar contrato'))||'';
  check('share_text', /\nFecha límite: 6 de noviembre de 2026\n/.test(x.share) && !/Fecha límite/.test(x.share9), x.share);
  check('csv', head.includes('"Fecha";"Fecha límite";"Prioridad"') && line.includes('"2026-11-04";"2026-11-06";'), {head, line});
  check('export', x.json.includes('"deadline":"2026-11-06"'), null);
  // Done task: no colour in its detail
  await ev(page, ()=>openDetail('d8')); await calm(page);
  x = await ev(page, ()=>{ const c=document.querySelector('.pushed-screen.detail [data-act=pickDeadline] .val'); return c&&c.textContent+'|'+c.className; });
  check('done_no_colour', x==='Ayer|val', x);
  await page.tap('.pushed-screen.detail [data-act=back]'); await calm(page);
  // Dark theme
  await ev(page, ()=>{ document.querySelector('#toast').classList.remove('on'); DB.settings.theme='dark'; save(); applyTheme(); render(); }); await calm(page); await shot(page, 'i5-hoy-dark'); // the toast hidden: only for the picture
  await ev(page, ()=>openDetail('d1')); await calm(page); await shot(page, 'i6-detail-dark');
  await page.tap('.pushed-screen.detail [data-act=pickDeadline]'); await sheetUp(page); await shot(page, 'i7-sheet-dark');
  await ctx.close();
}

/* ======================= 3. Desktop ======================= */
async function desktop(browser){
  const {ctx, page} = await open(browser, {tag:'D', desk:true}); let x;
  await ev(page, ()=>setDeskView('hoy')); await calm(page);
  const col = id => ev(page, id=>{ const c=document.querySelector('#desk .main .row[data-id="'+id+'"]:not(.first .row) .rc-dl'); return c&&{text:c.textContent, cls:c.className, shown:getComputedStyle(c).display!=='none', w:c.getBoundingClientRect().width}; }, id);
  const c1=await col('d1'), c3=await col('d3'), c9=await col('d9');
  check('desk_column', c1 && c1.text==='Entrega hoy' && /dl-due/.test(c1.cls) && c1.shown && c1.w>60 && c3.text==='Entrega viernes' && /dl-soon/.test(c3.cls) && c9.text==='' && c9.shown, {c1, c3, c9});
  check('desk_sidebar_count', await ev(page, ()=>document.querySelector('#desk .side [data-view=hoy] .n').textContent)==='8');
  await shot(page, 'd1-hoy');
  // A list without deadlines has no such column
  await ev(page, ()=>{ DB.settings.activeSpace='personal'; resetListState(); save(); render(); }); await calm(page);
  x = await ev(page, ()=>{ const c=document.querySelector('#desk .main .row[data-id=h1] .rc-dl'); return c&&getComputedStyle(c).display; });
  check('desk_column_hidden', x==='none', x);
  await ev(page, ()=>{ DB.settings.activeSpace='trabajo'; resetListState(); save(); render(); }); await calm(page);
  // The inspector: Fecha límite after Fecha, a popover with the calendar, Deshacer
  await page.click('#desk .main .row[data-id=d4]:not(.first .row) .row-title'); await until(page, ()=>!!document.querySelector('#desk .pane [data-act=pickDeadline]'));
  x = await ev(page, ()=>({pops:[...document.querySelectorAll('#desk .pane .iform .ipop')].map(b=>b.dataset.act).join(), val:document.querySelector('#desk .pane [data-act=pickDeadline] .val').textContent}));
  check('insp_row', x.pops==='pickProject,pickDate,pickDeadline,pickReminder,pickRepeat' && x.val==='20 nov', x);
  await page.click('#desk .pane [data-act=pickDeadline]'); await until(page, ()=>!!document.querySelector('#pmenu [data-d="2026-11-25"]'));
  await sleep(350); await shot(page, 'd2-inspector-popover');
  await page.click('#pmenu [data-d="2026-11-25"]'); await until(page, ()=>!menuOpen());
  x = {dl:await ev(page, ()=>task('d4').deadline), toast:await toastText(page), val:await ev(page, ()=>document.querySelector('#desk .pane [data-act=pickDeadline] .val').textContent)};
  check('insp_sets', x.dl==='2026-11-25' && x.toast==='Entrega el miércoles 25' && x.val==='25 nov', x);
  await page.click('#toastBtn'); await calm(page);
  check('insp_undo', await ev(page, ()=>task('d4').deadline)==='2026-11-20');
  // The right button menu: Fecha límite after Fecha, its submenu
  await page.keyboard.press('Escape'); await calm(page);
  await page.click('#desk .main .row[data-id=d9]:not(.first .row) .row-title', {button:'right'}); await until(page, ()=>menuOpen());
  x = await ev(page, ()=>[...document.querySelectorAll('#pmenu .pm-menu .pm-it')].map(b=>b.querySelector('.pm-l').textContent));
  check('desk_menu', x.indexOf('Fecha límite')===x.indexOf('Fecha')+1, x);
  await menuItem(page, 'Fecha límite').click(); await until(page, ()=>document.querySelectorAll('#pmenu .pm-menu').length===2);
  x = await ev(page, ()=>[...document.querySelectorAll('#pmenu .pm-menu')][1].textContent);
  check('desk_sub', /Hoy/.test(x) && /Mañana/.test(x) && /Elegir fecha…/.test(x) && !/Quitar/.test(x), x);
  await shot(page, 'd3-menu');
  await menuItem(page, 'Mañana').click(); await until(page, ()=>!menuOpen()); await calm(page);
  check('desk_menu_sets', await ev(page, ()=>task('d9').deadline)==='2026-11-05' && await toastText(page)==='Entrega mañana');
  // Week: the card's flag and its tooltip
  await until(page, ()=>!document.querySelector('#pmenu .pm-menu')); await ev(page, ()=>setDeskView('week')); await calm(page);
  x = await ev(page, ()=>{ const c=document.querySelector('#desk .wcard[data-id=d1]'), g=document.querySelector('#desk .wcard[data-id=d4] .cdl'); const f=c&&c.querySelector('.cdl'); return c&&{flag:!!f, cls:f&&f.className, tip:c.title, red:f&&getComputedStyle(f).color, grey:g&&getComputedStyle(g).color}; });
  check('week_card', x && x.flag && /dl-due/.test(x.cls) && /\nEntrega hoy/.test(x.tip) && x.red!==x.grey, x);
  await shot(page, 'd4-week');
  await ev(page, ()=>{ DB.settings.theme='dark'; save(); applyTheme(); setDeskView('hoy'); }); await calm(page);
  await page.click('#desk .main .row[data-id=d1]:not(.first .row) .row-title'); await until(page, ()=>!!document.querySelector('#desk .pane [data-act=pickDeadline]')); await sleep(300);
  await shot(page, 'd5-hoy-dark');
  await ctx.close();
}

/* ======================= 4. Sync ======================= */
const TABLES = ['spaces','projects','tasks','voice_notes','attachments','subtasks','project_notes'];
const COLS = { spaces:['name','sort_order','members'], projects:['space_id','name','color','sort_order','archived'],
  tasks:['space_id','project_id','title','date','reminder','priority','status','notes','carried','assignees','completed','repeat','focus','waiting_for','deadline'], voice_notes:['task_id','text'],
  attachments:['task_id','kind','path','mime','size','width','height','duration_ms','purged'], subtasks:['task_id','title','done','sort_order'], project_notes:['project_id','title','body','pinned'] };
// rm-RF's in-memory server; noCol: a database where 0007 has not run (an upload naming deadline is refused whole, with PostgREST's message)
const NEWCOLS=['deadline'];
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
    tasks:[ st('s1', {title:'Sin límite'}), st('s2', {title:'Con límite', date:day(1), deadline:day(3)}) ] };
  const fake = new Fake(false); let x;
  const A = await open(browser, {tag:'SA', fake, seed, clock:false}), B = await open(browser, {tag:'SB', fake, seed:Object.assign({}, seed, {tasks:[]}), clock:false, desk:true});
  x = await ev(A.page, ()=>{ const r1=syncToRow('tasks', task('s1')), r2=syncToRow('tasks', task('s2')); return {k1:Object.keys(r1).join(), d2:r2.deadline, sent:Object.keys(syncSendRow('tasks', r1)).slice(-1)[0]}; });
  check('sync_signature_unchanged', x.k1==='id,created,space_id,project_id,title,date,reminder,priority,status,notes,carried,completed,modified,deleted' && x.d2===day(3) && x.sent==='deadline', x);
  await ev(A.page, ()=>syncSignIn()); check('sync_A_first', await synced(A.page));
  await ev(B.page, ()=>syncSignIn()); check('sync_B_first', await synced(B.page));
  check('sync_server_value', fake.t.tasks.get('s2').deadline===day(3) && fake.t.tasks.get('s1').deadline===null, {s2:fake.t.tasks.get('s2').deadline, s1:fake.t.tasks.get('s1').deadline});
  check('sync_B_gets', await until(B.page, d=>!!task('s2')&&task('s2').deadline===d, day(3)), await ev(B.page, ()=>task('s2')));
  // Set on B, it reaches A; cleared on A, cleared everywhere
  await ev(B.page, d=>setDeadline('s1', d), day(2)); check('sync_B_up', await synced(B.page));
  check('sync_A_gets', await until(A.page, d=>task('s1').deadline===d, day(2)) && fake.t.tasks.get('s1').deadline===day(2));
  await ev(A.page, ()=>setDeadline('s2', null)); check('sync_A_up', await synced(A.page));
  check('sync_cleared', fake.t.tasks.get('s2').deadline===null && await until(B.page, ()=>task('s2').deadline===null), fake.t.tasks.get('s2').deadline);
  await A.ctx.close(); await B.ctx.close();

  // A database without the column: logged once, the value stays on the device, nothing goes up again and again
  const nf = new Fake(true);
  const C = await open(browser, {tag:'SC', fake:nf, seed, clock:false});
  await ev(C.page, ()=>syncSignIn());
  check('nocol_synced', await synced(C.page), await ev(C.page, ()=>({st:SY&&SY.status, err:SY&&SY.error})));
  await ev(C.page, ()=>updTask('s1', {title:'Sin límite (editada)'})); await synced(C.page);
  const n1 = nf.ups.length; await sleep(3500); await synced(C.page);
  x = await ev(C.page, ()=>({dl:task('s2').deadline, warns:LOG.filter(e=>/0007_deadline/.test(e.m)).map(e=>e.m), errs:LOG.filter(e=>e.l==='error').map(e=>e.m), pend:syncCollect(true).count}));
  const s2row = nf.t.tasks.get('s2'), s1row = nf.t.tasks.get('s1');
  check('nocol_tolerated', x.dl===day(3) && x.warns.length===1 && /tasks\.deadline/.test(x.warns[0]) && /fecha límite/i.test(x.warns[0]) && !x.errs.length && x.pend===0 && s2row && !('deadline' in s2row) && s1row.title==='Sin límite (editada)', {x, s2row, s1row});
  check('nocol_no_loop', nf.ups.length===n1, {before:n1, after:nf.ups.length});
  const later = new Date(Date.now()+1000).toISOString();
  nf.write(USER.uid, 'tasks', [Object.assign({}, s2row, {title:'Con límite (servidor)', modified:later})]);
  await until(C.page, ()=>task('s2').title==='Con límite (servidor)');
  x = await ev(C.page, ()=>({t:task('s2').title, dl:task('s2').deadline}));
  check('nocol_merge_keeps', x.t==='Con límite (servidor)' && x.dl===day(3), x);
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
