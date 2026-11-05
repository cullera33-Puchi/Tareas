require('./lib/out.js'); // outputs (screenshots, downloads) go to tests/out
// Decision 47 (project notes), port 10300. Screenshots in tests/out/np.
//  1. SQL: supabase/migrations/0006_project_notes.sql run twice in PGlite after 0001 to 0005 (stand-ins for auth, pg_cron, pg_net and Storage):
//     the table and its columns, the write trigger "newest modified wins", the rules by owner, realtime, no rights for anon. Then all.sql run
//     twice on a fresh database and check.sql: every row OK.
//  2. iPhone, clock at Wednesday 4 November 2026 10:00: the segment Tareas and Notas of a project with its counts, the list (pinned first,
//     then the newest), the note screen (lists, boxes, links and phones drawn), a box ticked without entering the text, a tap on a line
//     edits there, typing saved, Intro carrying on a list, Crear tareas (lines preselected, one taken out, dates read, one Deshacer), a new
//     note from the + with its title focused, an empty note left behind going quietly, swipe to Eliminar with Deshacer, the long press menu
//     (Fijar), search in Tareas with the group Notas, share text; dark theme screenshots.
//  3. Desktop: the segment in the column head, the list beside the open note, a click on another note, editing keeps the focus across a
//     redraw, Control N and N, the arrows, the right button menu, lines selected in the text making tasks with Deshacer, Supr with Deshacer,
//     search in Todas opening a note, dark theme screenshot.
//  4. Data: export, import, a local backup restored, a space deleted with its projects' notes and Deshacer, an archived project keeping its
//     notes, demo projects' notes cleared.
//  5. Sync with rm-S's fake server, two devices: notes go up and come down (realtime), a deleted note is marked deleted and leaves the other
//     device, notes of demo projects never go up, and a database without the table (0006 not run) is tolerated (logged once, the notes stay).
const { chromium } = require('playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = path.resolve(__dirname, '..'), PORT = 10300, URL0 = 'http://localhost:'+PORT+'/';
const OUT = path.join(__dirname, 'out', 'np'); fs.mkdirSync(OUT, {recursive:true});
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
  await db.exec(rd('0001_init.sql')); await db.exec(strip(rd('0002_push.sql'))); await db.exec(rd('0003_attachments.sql')); await db.exec(rd('0004_repeat_focus.sql')); await db.exec(rd('0005_subtasks.sql'));
  let err = null; try { await db.exec(rd('0006_project_notes.sql')); await db.exec(rd('0006_project_notes.sql')); } catch(e){ err = e.message; }
  check('sql_runs_twice', !err, err);
  const q = async (sql, params) => (await db.query(sql, params)).rows;
  const tryq = async (sql, params) => { try { return {rows: await q(sql, params)}; } catch(e){ return {error: e.message}; } };
  const cols = await q(`select column_name, data_type, is_nullable from information_schema.columns where table_schema='public' and table_name='project_notes' order by ordinal_position`);
  check('sql_columns', cols.map(c=>c.column_name+':'+c.data_type).join()==='id:text,owner_id:uuid,project_id:text,title:text,body:text,pinned:boolean,created:timestamp with time zone,modified:timestamp with time zone,deleted:timestamp with time zone,server_ts:timestamp with time zone'
    && cols.filter(c=>c.is_nullable==='NO').map(c=>c.column_name).join()==='id,owner_id,modified,server_ts', cols);
  const trg = await q(`select count(*)::int n from pg_trigger where tgrelid='public.project_notes'::regclass and tgname='tareas_before_write'`);
  const pub = await q(`select count(*)::int n from pg_publication_tables where pubname='supabase_realtime' and tablename='project_notes'`);
  const pol = await q(`select policyname from pg_policies where tablename='project_notes' order by policyname`);
  const idx = await q(`select indexname from pg_indexes where tablename='project_notes' order by indexname`);
  check('sql_objects', trg[0].n===1 && pub[0].n===1 && pol.map(p=>p.policyname).join()==='project_notes_delete_own,project_notes_insert_own,project_notes_select_own,project_notes_update_own' && idx.map(i=>i.indexname).join()==='project_notes_owner_server_ts,project_notes_pkey,project_notes_project', {trg, pub, pol, idx});
  const A = '00000000-0000-4000-8000-00000000000a', Bu = '00000000-0000-4000-8000-00000000000b';
  await db.exec(`insert into auth.users values ('${A}'), ('${Bu}')`);
  const as = async (uid, fn, role) => { await db.exec(`set test.uid = '${uid}'; set role ${role||'authenticated'};`); try { return await fn(); } finally { await db.exec(`reset role; reset test.uid;`); } };
  const ins = await as(A, () => tryq(`insert into public.project_notes (id, project_id, title, body, pinned, created, modified) values ('n1', 'p1', 'Acuerdos', '- Uno\n[ ] Dos', false, '2026-11-04T09:00:00Z', '2026-11-04T09:00:00Z') returning owner_id, server_ts`));
  check('sql_insert', ins.rows && ins.rows[0].owner_id===A && !!ins.rows[0].server_ts, ins);
  const older = await as(A, () => tryq(`update public.project_notes set title = 'Viejo', modified = '2026-11-03T00:00:00Z' where id = 'n1' returning id`));
  const newer = await as(A, () => tryq(`update public.project_notes set pinned = true, modified = '2026-11-04T10:00:00Z' where id = 'n1' returning id`));
  const n1 = (await q(`select title, pinned from public.project_notes where id = 'n1'`))[0];
  check('sql_newest_wins', older.rows && !older.rows.length && newer.rows && newer.rows.length===1 && n1.title==='Acuerdos' && n1.pinned===true, {older, newer, n1});
  const seenB = await as(Bu, () => tryq(`select id from public.project_notes`));
  const stealB = await as(Bu, () => tryq(`update public.project_notes set title = 'Ajeno', modified = now() where id = 'n1' returning id`));
  const anon = await as(A, () => tryq(`select id from public.project_notes`), 'anon');
  check('sql_rls', seenB.rows && seenB.rows.length===0 && stealB.rows && stealB.rows.length===0 && !!anon.error, {seenB, stealB, anon});
  await db.close();
  // all.sql: every migration in order, twice, on a fresh database; then check.sql says OK on every row
  db = await pgSetup(); const all = strip(fs.readFileSync(path.join(ROOT, 'supabase/all.sql'), 'utf8'));
  err = null; try { await db.exec(all); await db.exec(all); } catch(e){ err = e.message; }
  check('sql_all_twice', !err && /0001 a 00\d\d/.test(all.split('\n')[0]) && (all.match(/^-- ========== migrations\//mg)||[]).length===fs.readdirSync(path.join(ROOT,'supabase/migrations')).filter(f=>f.endsWith('.sql')).length, err);
  let rows = []; try { rows = (await db.query(fs.readFileSync(path.join(ROOT, 'supabase/check.sql'), 'utf8'))).rows; } catch(e){ err = e.message; }
  check('sql_check_all_ok', rows.length>=19 && // later migrations add rows (0007: Fecha límite)
     rows.every(x=>x.Estado==='OK') && rows.some(x=>/project_notes/.test(x.Pieza)), {err, bad:rows.filter(x=>x.Estado!=='OK')});
  await db.close();
}

/* ======================= Pages ======================= */
const NOW = new Date(2026, 10, 4, 10, 0, 0); // Wednesday 4 November 2026, 10:00 local: before 19:00, no Cerrar el día
const T0 = '2026-11-04T08:00:00.000Z', T1 = '2026-11-03T08:00:00.000Z', T2 = '2026-11-02T08:00:00.000Z';
const tk = (id, o) => Object.assign({id, title:id, spaceId:'trabajo', projectId:null, date:'2026-11-04', reminder:null, priority:'none', status:'pending', notes:'', carried:false, created:T0, modified:T0, completed:null}, o);
const nt = (id, projectId, title, body, o) => Object.assign({id, projectId, title, body, pinned:false, created:T1, modified:T1}, o);
const BODY1 = 'Reunión con Marta del cliente.\n- Revisar el SOW\n- Enviar acta mañana\n[ ] Reservar sala\n[x] Pedir los datos\nWeb https://example.com/acta y teléfono 612 345 678';
const SEED = () => ({ spaces:[{id:'trabajo',name:'Trabajo',order:0,created:T0},{id:'personal',name:'Personal',order:1,created:T0}],
  projects:[{id:'p1', spaceId:'trabajo', name:'FLC', color:'#007AFF', order:0, archived:false, created:T0, modified:T0},{id:'p2', spaceId:'trabajo', name:'Legal', color:'#34C759', order:1, archived:false, created:T0, modified:T0},
    {id:'p3', spaceId:'personal', name:'Casa', color:'#FF9500', order:0, archived:false, created:T0, modified:T0}],
  tasks:[ tk('t1', {title:'Preparar comité', projectId:'p1', priority:'high'}), tk('t2', {title:'Revisar SOW', projectId:'p2'}), tk('t3', {title:'Enviar acta', projectId:'p1'}) ],
  voiceNotes:[], attachments:[], subtasks:[],
  projectNotes:[ nt('n1','p1','Acuerdos del comité',BODY1), nt('n2','p1','Contactos','Marta 600 111 222\nLuis', {pinned:true, modified:T2, created:T2}), nt('n3','p1','','Idea suelta\nsegunda línea', {modified:T2, created:T2}),
    nt('n4','p2','Cláusulas','- Penalización\n- Plazo'), nt('n5','p3','Obras','Llamar al fontanero') ],
  settings:{tipsSeen:true} });
async function open(browser, o){
  const vp = o.desk ? {viewport:{width:1280,height:800}, deviceScaleFactor:1} : {viewport:{width:390,height:844}, deviceScaleFactor:2, isMobile:true, hasTouch:true};
  const ctx = await browser.newContext(Object.assign(vp, {colorScheme:o.theme||'light'})); const page = await ctx.newPage();
  if(o.clock!==false) await page.clock.install({time:NOW});
  page.on('pageerror', e=>errors.push(o.tag+' pageerror: '+e.message)); page.on('console', m=>{ if(m.type()==='error') errors.push(o.tag+' console: '+m.text()); });
  if(o.fake){ await page.exposeBinding('fakeServer', (src, op, a)=>o.fake.handle(src.page, op, a)); await page.addInitScript(fakeAdapter); await page.addInitScript(u=>{ window.__fakeUser=u; }, USER); }
  await page.addInitScript(s=>{ if(!localStorage.getItem('tareas-v1')) localStorage.setItem('tareas-v1', s); }, JSON.stringify(o.seed||SEED()));
  await page.goto(URL0); await until(page, ()=>typeof DB!=='undefined'&&!!document.querySelector(UI.wide?'#desk .main':'.screen.root')); return {ctx, page};
}
const ev = (page, fn, arg) => page.evaluate(fn, arg);
const until = async (page, fn, arg, ms=8000)=>{ const t0=Date.now(); for(;;){ let v=false; try{ v=await page.evaluate(fn, arg); }catch(e){} if(v) return true; if(Date.now()-t0>ms) return false; await sleep(80); } };
// Settled: no slide, no sheet moving, no held row waiting, no row leaving (CI is slower than a laptop: wait on the state, not on a time)
const calm = page => until(page, ()=>!app.classList.contains('navigating') && !HELD.size && !document.querySelector('.row.leaving, .flip, .enter') && !touchDrag);
const toastOn = page => ev(page, ()=>document.querySelector('#toast').classList.contains('on')?{t:document.querySelector('#toastText').textContent, b:document.querySelector('#toastBtn').style.display==='none'?'':document.querySelector('#toastBtn').textContent}:null);
const hideToast = page => ev(page, ()=>{ document.querySelector('#toast').classList.remove('on'); });
const menuItem = (page, label) => page.locator('#pmenu .pm-it').filter({has: page.locator('.pm-l', {hasText: new RegExp('^'+label+'$')})}).first();
const menuLabels = page => ev(page, ()=>[...document.querySelectorAll('#pmenu .pm-it .pm-l')].map(e=>e.textContent).join());
async function cdp(page, fn){ const c=await page.context().newCDPSession(page); try{ await fn(c); } finally{ await c.detach(); } }
const touch = (c, type, x, y) => c.send('Input.dispatchTouchEvent', {type, touchPoints:type==='touchEnd'?[]:[{x, y}]});
async function swipe(page, x, y, dx, dy, n=10){ await cdp(page, async c=>{ await touch(c,'touchStart',x,y); for(let i=1;i<=n;i++){ await touch(c,'touchMove',x+dx*i/n,y+dy*i/n); await sleep(16); } await touch(c,'touchEnd'); }); }
async function hold(page, x, y){ await cdp(page, async c=>{ await touch(c,'touchStart',x,y); await sleep(700); await touch(c,'touchEnd'); }); }
const box = (page, sel) => ev(page, s=>{ const e=document.querySelector(s); if(!e) return null; const b=e.getBoundingClientRect(); return {x:b.x, y:b.y, w:b.width, h:b.height, cx:b.x+b.width/2, cy:b.y+b.height/2}; }, sel);
const noteIds = (page, sel) => ev(page, s=>[...document.querySelectorAll(s+' [data-pn]')].map(e=>e.dataset.pn).join(), sel);

/* ======================= 2. iPhone ======================= */
async function iphone(browser){
  const {ctx, page} = await open(browser, {tag:'M'});
  const PJ='.screen.pushed-screen.project', NS='.screen.pushed-screen.note';
  await page.tap('.tabbar [data-tab=proyectos]'); await calm(page);
  await page.tap('.screen.root[data-root=proyectos] [data-open-project=p1]'); await calm(page);
  // The segment Tareas and Notas, with how many of each; Tareas first
  let x = await ev(page, PJ=>{ const s=document.querySelector(PJ+' .seg.pseg'); return s&&{labels:[...s.querySelectorAll('button')].map(b=>b.textContent).join(), on:s.querySelector('.on').dataset.pseg, rows:document.querySelectorAll(PJ+' .row[data-id]').length, fab:document.querySelector(PJ+' .fab').dataset.act}; }, PJ);
  check('m_segment', x && x.labels==='Tareas2,Notas3' && x.on==='tasks' && x.rows===2 && x.fab==='add', x);
  await page.tap(PJ+' [data-pseg=notes]'); await calm(page);
  // The list: Fijadas first, then the newest; a note without a title shows its first line; the + makes a note
  x = await ev(page, PJ=>({ids:[...document.querySelectorAll(PJ+' [data-pn]')].map(e=>e.dataset.pn).join(), titles:[...document.querySelectorAll(PJ+' [data-pn] .nr-tt')].map(e=>e.textContent).join('|'),
    groups:[...document.querySelectorAll(PJ+' .group-title')].map(e=>e.textContent).join(), prev:document.querySelector(PJ+' [data-pn=n1] .nr-s').textContent, pin:!!document.querySelector(PJ+' [data-pn=n2] .npin'), fab:document.querySelector(PJ+' .fab').dataset.act, rows:document.querySelectorAll(PJ+' .row[data-id]').length}), PJ);
  check('m_notes_list', x.ids==='n2,n1,n3' && x.titles==='Contactos|Acuerdos del comité|Idea suelta' && x.groups==='Fijadas,Notas' && x.prev==='AyerReunión con Marta del cliente.' && x.pin && x.fab==='newNote' && x.rows===0, x);
  await shot(page, 'm1-notes-list');
  // The note: title, date, and the text drawn with its list, boxes, link and phone
  await page.tap(PJ+' [data-pn=n1] .nr-tt'); await calm(page);
  x = await ev(page, NS=>{ const s=document.querySelector(NS); const v=s.querySelector('.nview');
    return {title:s.querySelector('[data-role=ntitle]').value, meta:s.querySelector('.nmeta').textContent, li:[...v.querySelectorAll('.nl.li .nt')].map(e=>e.textContent).join('|'), ck:[...v.querySelectorAll('.nl.ck')].map(e=>(e.classList.contains('done')?'x':'o')+':'+e.textContent).join('|'),
      links:[...v.querySelectorAll('a')].map(a=>a.getAttribute('href')).join(), editing:!!s.querySelector('.nbw.editing'), cell:(s.querySelector('.ntasks .val')||{}).textContent, nav:s.querySelector('.nav-title').textContent}; }, NS);
  check('m_note_view', x.title==='Acuerdos del comité' && /^Modificada ayer \d\d:\d\d$/.test(x.meta) && x.li==='Revisar el SOW|Enviar acta mañana' && x.ck==='o:Reservar sala|x:Pedir los datos' && x.links==='https://example.com/acta,tel:612345678' && !x.editing && x.cell==='4 líneas' && x.nav==='FLC', x);
  await shot(page, 'm2-note');
  // A box ticks without entering the text: its line is rewritten
  await page.tap(NS+' .nl.ck[data-ln="3"] .ncheck'); await sleep(150);
  x = await ev(page, ()=>({line:noteRec('n1').body.split('\n')[3], ae:document.activeElement.tagName, editing:!!document.querySelector('.screen.note .nbw.editing'), done:document.querySelector('.screen.note .nl.ck[data-ln="3"]').classList.contains('done'), saved:JSON.parse(localStorage.getItem('tareas-v1')).projectNotes.find(n=>n.id==='n1').body.split('\n')[3]}));
  check('m_check_toggles', x.line==='[x] Reservar sala' && x.ae!=='TEXTAREA' && !x.editing && x.done && x.saved==='[x] Reservar sala', x);
  // A tap on a line edits the text there; typing is saved a moment later; Intro on a list line starts the next one
  await page.tap(NS+' .nl.li[data-ln="1"] .nt'); await sleep(150);
  x = await ev(page, ()=>{ const a=document.activeElement; return {role:a.dataset.role, caret:a.selectionStart, line:a.value.slice(0, a.selectionStart).split('\n').length-1, editing:!!document.querySelector('.screen.note .nbw.editing')}; });
  await page.keyboard.type(' de FLC'); await page.keyboard.press('Enter'); await page.keyboard.type('Llamar a Luis');
  const typed = await ev(page, ()=>noteRec('n1').body.split('\n').slice(1,4).join('|'));
  const saved = await until(page, ()=>JSON.parse(localStorage.getItem('tareas-v1')).projectNotes.find(n=>n.id==='n1').body.includes('- Llamar a Luis'), null, 3000);
  check('m_edit_at_line', x.role==='nbody' && x.line===1 && x.editing && typed==='- Revisar el SOW de FLC|- Llamar a Luis|- Enviar acta mañana' && saved, {x, typed, saved});
  // Intro on an empty list line ends the list
  await page.keyboard.press('Enter'); await page.keyboard.press('Enter'); await page.keyboard.type('Fin');
  x = await ev(page, ()=>noteRec('n1').body.split('\n').slice(2,5).join('|'));
  check('m_enter_ends_list', x==='- Llamar a Luis||Fin' || x==='- Llamar a Luis|Fin|- Enviar acta mañana', x);
  await page.keyboard.press('Backspace'); await page.keyboard.press('Backspace'); await page.keyboard.press('Backspace'); await page.keyboard.press('Backspace');
  await shot(page, 'm3-editing');
  // Leaving the text draws it again
  await page.tap(NS+' [data-role=ntitle]'); await sleep(200);
  x = await ev(page, ()=>({editing:!!document.querySelector('.screen.note .nbw.editing'), li:[...document.querySelectorAll('.screen.note .nview .nl.li .nt')].map(e=>e.textContent).join('|'), row:document.querySelector('.screen.project [data-pn=n1] .nr-tt').textContent}));
  check('m_view_after_edit', !x.editing && x.li==='Revisar el SOW de FLC|Llamar a Luis|Enviar acta mañana' && x.row==='Acuerdos del comité', x);
  await ev(page, ()=>document.activeElement.blur()); await sleep(150);
  // Crear tareas: the list lines and the boxes, ticked ones not chosen; one taken out; the date at the end of a line is read; one Deshacer
  await page.tap(NS+' .ntasks .cell'); await until(page, ()=>document.querySelector('#sheet').classList.contains('on')); await sleep(500);
  x = await ev(page, ()=>({rows:[...document.querySelectorAll('#sheet .ntl')].map(e=>(e.classList.contains('on')?'+':'-')+e.querySelector('.lbl').textContent+(e.querySelector('.val')?'@'+e.querySelector('.val').textContent:'')).join('|'), ok:document.querySelector('#sheet [data-x=ok]').textContent}));
  await shot(page, 'm4-create-tasks');
  await page.tap('#sheet .ntl[data-k="1"]'); await sleep(100);
  const ok2 = await ev(page, ()=>document.querySelector('#sheet [data-x=ok]').textContent);
  await page.tap('#sheet [data-x=ok]'); await sleep(300);
  const made = await ev(page, ()=>DB.tasks.filter(t=>!['t1','t2','t3'].includes(t.id)).map(t=>t.title+'@'+(t.date||'')+'@'+t.projectId).sort().join('|'));
  const t1 = await toastOn(page);
  check('m_create_tasks', x.rows==='+Revisar el SOW de FLC|+Llamar a Luis|+Enviar acta@Mañana|-Reservar sala|-Pedir los datos' && x.ok==='Crear 3 tareas' && ok2==='Crear 2 tareas'
    && made==='Enviar acta@2026-11-05@p1|Revisar el SOW de FLC@@p1' && t1 && t1.t==='2 tareas creadas' && t1.b==='Deshacer', {x, ok2, made, t1});
  await page.click('#toastBtn'); await calm(page);
  check('m_create_undo', await ev(page, ()=>DB.tasks.length===3));
  // Back: a new note from the +, its title focused at once; written, it goes to the top of the list
  await page.tap(NS+' [data-act=back]'); await calm(page);
  await page.tap(PJ+' .fab'); await calm(page);
  x = await ev(page, ()=>({role:document.activeElement.dataset.role, top:UI.stack[UI.stack.length-1].kind, n:DB.projectNotes.length}));
  await page.keyboard.type('Riesgos'); await page.keyboard.press('Enter'); await page.keyboard.type('- Retraso del cliente');
  const ae2 = await ev(page, ()=>document.activeElement.dataset.role);
  await page.tap(NS+' [data-act=back]'); await calm(page);
  const order = await noteIds(page, PJ);
  check('m_new_note', x.role==='ntitle' && x.top==='note' && x.n===6 && ae2==='nbody' && await ev(page, ()=>{ const n=DB.projectNotes.find(o=>o.title==='Riesgos'); return n&&n.body==='- Retraso del cliente'&&n.projectId==='p1'; }) && order.split(',')[0]==='n2' && order.split(',')[1]===await ev(page, ()=>DB.projectNotes.find(o=>o.title==='Riesgos').id), {x, ae2, order});
  // A note left with nothing written goes quietly
  await page.tap(PJ+' .fab'); await calm(page); await page.tap(NS+' [data-act=back]'); await calm(page);
  check('m_empty_note_goes', await ev(page, ()=>DB.projectNotes.length===6 && !document.querySelector('#toast.on')) && (await noteIds(page, PJ)).split(',').length===4);
  // Swipe to the left: Eliminar, then Deshacer
  let b = await box(page, PJ+' [data-pn=n3]'); await swipe(page, b.x+b.w-60, b.cy, -140, 0); await sleep(450);
  x = await ev(page, PJ=>{ const e=document.querySelector(PJ+' [data-pn=n3]'); return {open:e.dataset.open, btn:e.querySelector('.vn-bg.r button').textContent}; }, PJ);
  await shot(page, 'm5-swipe-delete');
  await page.tap(PJ+' [data-pn=n3] .vn-bg.r button'); await sleep(300);
  const t2 = await toastOn(page), gone = await ev(page, ()=>!noteRec('n3'));
  await page.click('#toastBtn'); await calm(page);
  check('m_swipe_delete', x.open==='l' && x.btn==='Eliminar' && t2 && t2.t==='Nota eliminada' && gone && await ev(page, ()=>!!noteRec('n3')) && (await noteIds(page, PJ)).includes('n3'), {x, t2, gone});
  // The long press lifts the row and opens its menu: Fijar puts it with the pinned ones
  b = await box(page, PJ+' [data-pn=n1]'); await hold(page, b.cx, b.cy); await until(page, ()=>!!document.querySelector('#pmenu .pm-it'));
  const items = await menuLabels(page); await shot(page, 'm6-long-press');
  await menuItem(page, 'Fijar').click(); await calm(page); await sleep(300);
  x = await ev(page, PJ=>({pinned:noteRec('n1').pinned, ids:[...document.querySelectorAll(PJ+' [data-pn]')].map(e=>e.dataset.pn).slice(0,2).join(), toast:document.querySelector('#toastText').textContent}), PJ);
  check('m_long_press_pin', items==='Fijar,Compartir,Crear tareas,Eliminar' && x.pinned && x.ids==='n1,n2' && x.toast==='Nota fijada arriba', {items, x});
  await hideToast(page);
  // Share text: title, project and the text
  x = await ev(page, ()=>noteShareText('n2'));
  check('m_share_text', x==='Nota: Contactos\nProyecto: FLC\n\nMarta 600 111 222\nLuis', x);
  // Search in Tareas: the notes found, in a group of their own, open the note
  await page.tap(PJ+' [data-act=back]'); await calm(page); await page.tap('.tabbar [data-tab=tareas]'); await calm(page);
  await page.tap('.screen.root[data-root=tareas] [data-role=search]'); await page.keyboard.type('fontanero');
  await until(page, ()=>!!document.querySelector('.screen.root[data-root=tareas] .nhits'));
  const other = await ev(page, ()=>document.querySelectorAll('.screen.root[data-root=tareas] .nhits [data-pn]').length);
  await ev(page, ()=>{ const s=document.querySelector('.screen.root[data-root=tareas] [data-role=search]'); s.value='marta'; s.dispatchEvent(new Event('input')); });
  await until(page, ()=>[...document.querySelectorAll('.screen.root[data-root=tareas] .nhits [data-pn]')].length===2);
  x = await ev(page, ()=>({ids:[...document.querySelectorAll('.screen.root[data-root=tareas] .nhits [data-pn]')].map(e=>e.dataset.pn).join(), head:[...document.querySelectorAll('.screen.root[data-root=tareas] .group-title')].map(e=>e.textContent).join(),
    pj:document.querySelector('.screen.root[data-root=tareas] .nhits [data-pn=n1] .nr-pj').textContent, prev:document.querySelector('.screen.root[data-root=tareas] .nhits [data-pn=n1] .nr-pv').textContent, empty:!!document.querySelector('.screen.root[data-root=tareas] .empty')}));
  await shot(page, 'm7-search');
  check('m_search_notes', other===0 && x.ids==='n1,n2' && x.head==='Notas' && x.pj==='FLC' && x.prev==='Reunión con Marta del cliente.' && !x.empty, x);
  await page.tap('.screen.root[data-root=tareas] .nhits [data-pn=n2] .nr-tt'); await calm(page);
  check('m_search_opens', await ev(page, ()=>{ const t=UI.stack[UI.stack.length-1]; return t&&t.kind==='note'&&t.id==='n2'&&document.querySelector('.screen.note [data-role=ntitle]').value==='Contactos'; }));
  await ctx.close();
  // Dark theme, for a look
  { const {ctx, page} = await open(browser, {tag:'MD', theme:'dark'});
    await ev(page, ()=>{ UI.projTab.p1='notes'; switchTab('proyectos'); push('project','p1'); }); await calm(page); await shot(page, 'm8-list-dark');
    await ev(page, ()=>openNote('n1')); await calm(page); await shot(page, 'm9-note-dark'); await ctx.close(); }
}

/* ======================= 3. Desktop ======================= */
async function desktop(browser){
  const {ctx, page} = await open(browser, {tag:'D', desk:true});
  await ev(page, ()=>setDeskView('project:p1')); await calm(page);
  let x = await ev(page, ()=>{ const s=document.querySelector('#desk .mhead .pseg'); return s&&{labels:[...s.querySelectorAll('button')].map(b=>b.textContent).join(), rows:document.querySelectorAll('#desk .main .row[data-id]').length, addbar:!!document.querySelector('#desk [data-role=addbar]')}; });
  check('d_segment', x && x.labels==='Tareas2,Notas3' && x.rows===2 && x.addbar, x);
  await page.click('#desk .mhead [data-pseg=notes]'); await calm(page);
  // The list beside the open note: the first one (pinned) opens; no add bar, no view menu, no inspector
  x = await ev(page, ()=>({ids:[...document.querySelectorAll('#desk .nlist [data-pn]')].map(e=>e.dataset.pn).join(), on:(document.querySelector('#desk .nlist .nli.on')||{}).dataset, title:(document.querySelector('#desk .ned [data-role=ntitle]')||{}).value,
    addbar:!!document.querySelector('#desk [data-role=addbar]'), mopts:!!document.querySelector('#desk .mopts'), pane:!!document.querySelector('#desk > .pane'), lw:Math.round(document.querySelector('#desk .nlist').getBoundingClientRect().width), list:deskListView()}));
  check('d_notes_split', x.ids==='n2,n1,n3' && x.on && x.on.pn==='n2' && x.title==='Contactos' && !x.addbar && !x.mopts && !x.pane && x.lw===260 && !x.list, x);
  await shot(page, 'd1-notes');
  // Another note; a click on its text edits it; the focus stays across a redraw of the column
  await page.click('#desk .nlist [data-pn=n1]'); await calm(page);
  await page.click('#desk .ned .nview .nl[data-ln="0"]'); await sleep(100);
  await page.keyboard.press('End'); await page.keyboard.type(' Bien.');
  await ev(page, ()=>render()); await sleep(100);
  x = await ev(page, ()=>({role:document.activeElement.dataset.role, line:noteRec('n1').body.split('\n')[0], item:document.querySelector('#desk .nlist [data-pn=n1] .nr-pv').textContent, edit:UI.noteEdit}));
  await page.keyboard.type(' Sí');
  check('d_edit_keeps_focus', x.role==='nbody' && x.line==='Reunión con Marta del cliente. Bien.' && x.edit==='n1' && await ev(page, ()=>noteRec('n1').body.startsWith('Reunión con Marta del cliente. Bien. Sí')), x);
  // Lines selected in the text: the button says how many and makes them, with Deshacer
  await ev(page, ()=>{ const ta=document.querySelector('#desk .ned [data-role=nbody]'); const v=ta.value, a=v.indexOf('- Revisar'), b=v.indexOf('[ ] Reservar')+5; ta.focus(); ta.setSelectionRange(a, b); ta.dispatchEvent(new Event('select')); });
  await sleep(100); const lbl = await ev(page, ()=>document.querySelector('#desk .ned [data-act=noteTasks] span').textContent);
  await shot(page, 'd2-selection');
  await page.click('#desk .ned [data-act=noteTasks]'); await sleep(300);
  const made = await ev(page, ()=>DB.tasks.filter(t=>!['t1','t2','t3'].includes(t.id)).map(t=>t.title+'@'+(t.date||'')+'@'+t.projectId).sort().join('|'));
  const t1 = await toastOn(page); await ev(page, ()=>document.activeElement.blur()); await page.keyboard.press('Control+z'); await sleep(250); // in the text Control Z is the text's own
  check('d_selected_lines', lbl==='Crear 3 tareas' && made==='Enviar acta@2026-11-05@p1|Reservar sala@@p1|Revisar el SOW@@p1' && t1 && t1.t==='3 tareas creadas' && await ev(page, ()=>DB.tasks.length===3), {lbl, made, t1});
  // Esc leaves the text (drawn again); the arrows move through the list
  await ev(page, ()=>{ const ta=document.querySelector('#desk .ned [data-role=nbody]'); if(ta){ ta.focus(); ta.setSelectionRange(0,0); } });
  await page.keyboard.press('Escape'); await sleep(100);
  x = await ev(page, ()=>({edit:!!document.querySelector('#desk .ned .nbw.editing'), ae:document.activeElement.tagName}));
  await page.keyboard.press('ArrowDown'); await calm(page);
  const down = await ev(page, ()=>UI.noteOpen); await page.keyboard.press('ArrowUp'); await page.keyboard.press('ArrowUp'); await calm(page);
  check('d_esc_arrows', !x.edit && x.ae!=='TEXTAREA' && down==='n3' && await ev(page, ()=>UI.noteOpen==='n2'), {x, down});
  // Control N makes a note (also while writing) and focuses its title; N too; an empty one goes when another opens
  await page.keyboard.press('Control+n'); await calm(page);
  x = await ev(page, ()=>({n:DB.projectNotes.length, role:document.activeElement.dataset.role, open:UI.noteOpen, first:document.querySelector('#desk .nlist [data-pn]:not([data-pn=n2])').dataset.pn}));
  await page.keyboard.type('Plan de pruebas'); await page.keyboard.press('Enter'); await page.keyboard.type('[ ] Escenarios');
  await page.keyboard.press('Control+n'); await calm(page);
  const n2 = await ev(page, ()=>DB.projectNotes.length);
  await page.keyboard.press('Escape'); await page.keyboard.press('n'); await calm(page);
  check('d_control_n', x.n===6 && x.role==='ntitle' && x.first===x.open && n2===7 && await ev(page, ()=>DB.projectNotes.length===7 && DB.projectNotes.some(n=>n.title==='Plan de pruebas'&&n.body==='[ ] Escenarios')), {x, n2});
  await page.keyboard.press('Escape'); await page.click('#desk .nlist [data-pn=n1]'); await calm(page);
  check('d_empty_goes', await ev(page, ()=>DB.projectNotes.length===6));
  // An empty note that came from another device is not discarded here when left (it may still be being written there)
  await ev(page, ()=>{ const t=new Date().toISOString(); DB.projectNotes.push({id:'nx', projectId:noteRec('n1').projectId, title:'', body:'', pinned:false, created:t, modified:t}); save(); render(); });
  await page.click('#desk .nlist [data-pn=nx]'); await calm(page); await page.click('#desk .nlist [data-pn=n1]'); await calm(page);
  check('d_foreign_empty_kept', await ev(page, ()=>!!noteRec('nx')));
  await ev(page, ()=>{ DB.projectNotes=DB.projectNotes.filter(n=>n.id!=='nx'); save(); render(); }); await calm(page);
  // A new note made from another view stays (going to its own project is not leaving it)
  { const pid = await ev(page, ()=>noteRec('n1').projectId);
    await ev(page, ()=>setDeskView('hoy')); await calm(page);
    const nn = await ev(page, pid=>{ const n=newNote(pid); return n&&n.id; }, pid); await calm(page);
    check('d_new_from_other_view', await ev(page, id=>!!noteRec(id) && UI.noteOpen===id && UI.deskView.startsWith('project:'), nn));
    await page.click('#desk .nlist [data-pn=n1]'); await calm(page);
    check('d_new_from_other_view_left', await ev(page, id=>!noteRec(id) && DB.projectNotes.length===6, nn)); }
  // The right button: the note's menu at the pointer
  await page.click('#desk .nlist [data-pn=n3]', {button:'right'}); await until(page, ()=>!!document.querySelector('#pmenu .pm-it'));
  const items = await menuLabels(page); await shot(page, 'd3-menu');
  await menuItem(page, 'Fijar').click(); await calm(page);
  check('d_menu_pin', items==='Fijar,Compartir,Eliminar' && await ev(page, ()=>noteRec('n3').pinned && [...document.querySelectorAll('#desk .nlist [data-pn]')].slice(0,2).map(e=>e.dataset.pn).sort().join()==='n2,n3'), items);
  await hideToast(page);
  // A box ticks in the drawn view without entering the text
  await page.click('#desk .nlist [data-pn=n1]'); await calm(page);
  await page.click('#desk .ned .nl.ck[data-ln="3"] .ncheck'); await sleep(150);
  check('d_check', await ev(page, ()=>noteRec('n1').body.split('\n')[3]==='[x] Reservar sala' && !document.querySelector('#desk .ned .nbw.editing')));
  // Supr deletes the open note (the next one opens), Control Z gives it back
  await ev(page, ()=>document.activeElement&&document.activeElement.blur());
  await page.keyboard.press('Delete'); await sleep(250);
  const askd = await ev(page, ()=>({alert:asheet.classList.contains('on'), kept:!!noteRec('n1')}));
  await page.keyboard.press('Enter'); await sleep(350);
  x = {askd, gone:await ev(page, ()=>!noteRec('n1')), open:await ev(page, ()=>UI.noteOpen), t:await toastOn(page)};
  await page.keyboard.press('Control+z'); await sleep(250);
  check('d_delete_undo', x.askd.alert && x.askd.kept && x.gone && x.open && x.open!=='n1' && x.t && x.t.t==='Nota eliminada' && await ev(page, ()=>!!noteRec('n1') && UI.noteOpen==='n1'), x);
  // Search in Todas: the notes found under the tasks; a click opens the note in its project
  await ev(page, ()=>setDeskView('todas')); await calm(page);
  await page.click('#desk [data-role=search]'); await page.keyboard.type('sow');
  await until(page, ()=>!!document.querySelector('#desk .nhits'));
  x = await ev(page, ()=>({ids:[...document.querySelectorAll('#desk .nhits [data-pn]')].map(e=>e.dataset.pn).join(), rows:[...document.querySelectorAll('#desk .main .row[data-id]')].map(e=>e.dataset.id).join()}));
  await shot(page, 'd4-search');
  await page.click('#desk .nhits [data-pn=n1]'); await calm(page);
  check('d_search_opens', x.ids==='n1' && x.rows==='t2' && await ev(page, ()=>UI.deskView==='project:p1' && UI.noteOpen==='n1' && !!document.querySelector('#desk .nlist .nli.on[data-pn=n1]') && !UI.query), x);
  // Back to Tareas: the list and its add bar again
  await page.click('#desk .mhead [data-pseg=tasks]'); await calm(page);
  x = await ev(page, ()=>({bar:!!document.querySelector('#desk [data-role=addbar]'), rows:[...document.querySelectorAll('#desk .main .row[data-id]')].map(e=>e.dataset.id).join(), list:deskListView(), v:UI.deskView, tab:projTab('p1')}));
  check('d_back_to_tasks', x.bar && x.rows==='t1,t3' && x.list, x);
  // Narrowing the window: the open note becomes the iPhone's note screen over its project
  await ev(page, ()=>{ UI.projTab.p1='notes'; UI.noteOpen='n1'; render(); }); await calm(page);
  await page.setViewportSize({width:600, height:800}); await until(page, ()=>!UI.wide);
  check('d_narrow', await ev(page, ()=>UI.stack.map(s=>s.kind+':'+s.id).join()==='project:p1,note:n1'));
  await page.setViewportSize({width:1280, height:800}); await until(page, ()=>UI.wide);
  check('d_widen', await ev(page, ()=>UI.deskView==='project:p1' && UI.noteOpen==='n1' && deskNotesOn()));
  await ctx.close();
  { const {ctx, page} = await open(browser, {tag:'DD', desk:true, theme:'dark'}); await ev(page, ()=>{ UI.projTab.p1='notes'; UI.noteOpen='n1'; setDeskView('project:p1'); }); await calm(page); await shot(page, 'd5-notes-dark'); await ctx.close(); }
}

/* ======================= 4. Data ======================= */
async function dataTests(browser){
  const {ctx, page} = await open(browser, {tag:'X'});
  // Export and import
  let x = await ev(page, ()=>{ const ex=exportData(); const saved=JSON.stringify(ex); DB.projectNotes=DB.projectNotes.filter(n=>n.projectId!=='p1'); save(); const r1=importData(saved);
    return {n:ex.projectNotes.length, keys:Object.keys(ex.projectNotes[0]).sort().join(), added:r1.added, back:notesOf('p1').length}; });
  check('x_export_import', x.n===5 && x.keys==='body,created,id,modified,pinned,projectId,title' && x.added===3 && x.back===3, x);
  // A local backup restored brings the notes back as they were
  x = await ev(page, async()=>{ await BK.put(todayStr()); await refreshBackups(); const snap=await BK.get(todayStr()); const n=noteRec('n1'); n.title='Cambiada'; n.modified=new Date().toISOString(); DB.projectNotes=DB.projectNotes.filter(o=>o.id!=='n4'); save(); return (snap.data.projectNotes||[]).length; });
  await ev(page, ()=>restoreBackup(todayStr())); await until(page, ()=>document.querySelector('#asheet').classList.contains('on')); await sleep(600);
  const rtext = await ev(page, ()=>document.querySelector('#asheet .t').textContent);
  await page.locator('#asheet button', {hasText:/^Restaurar/}).first().click(); await until(page, ()=>!!noteRec('n4') && noteRec('n1').title==='Acuerdos del comité');
  check('x_backup', x===5 && /notas de proyecto/.test(rtext) && await ev(page, ()=>!!noteRec('n4') && noteRec('n1').title==='Acuerdos del comité'), {x, rtext});
  await calm(page); await hideToast(page);
  // Archiving a project keeps its notes; deleting its space takes them, with Deshacer, and the confirmation says so
  x = await ev(page, ()=>{ const p=proj('p2'); p.archived=true; save(); const kept=notesOf('p2').length; p.archived=false; save(); return kept; });
  const text = await ev(page, ()=>{ const L=spaceLoad('personal'); return spaceLoadText(L); });
  const undo = await ev(page, ()=>{ const u=deleteSpace('personal'); window.__u=u; return {n:DB.projectNotes.length, n5:!!noteRec('n5')}; });
  await ev(page, ()=>{ window.__u(); });
  check('x_space_cascade', x===1 && text==='1 proyecto y 1 nota de proyecto', {x, text});
  check('x_space_undo', undo.n===4 && !undo.n5 && await ev(page, ()=>DB.projectNotes.length===5 && !!noteRec('n5')), undo);
  // Notes of a demo project go with it
  x = await ev(page, ()=>{ generateDemo(); const dp=DB.projects.find(p=>String(p.id).startsWith('demo-')); const n=addNote(dp.id); n.title='Demo'; save();
    const isDemo=o=>String(o.id).startsWith('demo-'); DB.tasks=DB.tasks.filter(t=>!isDemo(t)); DB.projects=DB.projects.filter(p=>!isDemo(p)); DB.voiceNotes=DB.voiceNotes.filter(o=>!isDemo(o)); DB.subtasks=DB.subtasks.filter(o=>!isDemo(o));
    const pids=new Set(DB.projects.map(p=>p.id)); DB.projectNotes=DB.projectNotes.filter(o=>pids.has(o.projectId)); save(); return DB.projectNotes.length; });
  check('x_demo', x===5, x);
  await ctx.close();
}

/* ======================= 5. Sync ======================= */
const TABLES = ['spaces','projects','tasks','voice_notes','attachments','subtasks','project_notes','contacts'];
// rm-S's in-memory server (0001's trigger and RLS). noTable: a database where 0006 has not run: any request on project_notes fails as PostgREST does
class Fake {
  constructor(noTable){ this.noTable=!!noTable; this.t={}; TABLES.forEach(x=>this.t[x]=new Map()); this.last=0; this.subs=new Map(); this.down=new Set(); this.calls=[]; this.ups=[]; }
  ts(){ this.last=Math.max(Date.now(), this.last+1); return new Date(this.last).toISOString(); }
  gone(table){ if(this.noTable&&table==='project_notes'){ const e=new Error("Could not find the table 'public.project_notes' in the schema cache"); e.code='PGRST205'; throw e; } }
  write(owner, table, rows){ if(!owner) throw new Error('JWT required'); this.gone(table); const ts=this.ts(), out=[], changed=[], m=this.t[table];
    rows.forEach(r=>{ if(!r.id) throw new Error('null id'); if(!r.modified) throw new Error('null value in column "modified"'); });
    rows.forEach(r=>{ const ex=m.get(r.id);
      if(!ex){ const row=Object.assign({id:r.id, owner_id:owner, created:null, deleted:null}, r, {owner_id:owner, server_ts:ts}); m.set(r.id,row); out.push({id:r.id}); changed.push(row); return; }
      if(Date.parse(r.modified) < Date.parse(ex.modified)) return;
      Object.assign(ex, r, {owner_id:ex.owner_id, server_ts:ts}); out.push({id:r.id}); changed.push(ex); });
    changed.forEach(row=>this.notify(table, row)); return out; }
  notify(table, row){ const copy=JSON.parse(JSON.stringify(row)); for(const [page, uid] of this.subs){ if(uid!==row.owner_id||this.down.has(page)) continue; setTimeout(()=>{ page.evaluate(([t,r])=>window.__fakeRT&&window.__fakeRT(t,r), [table, copy]).catch(()=>{}); }, 40); } }
  rows(owner, table){ this.gone(table); return [...this.t[table].values()].filter(r=>r.owner_id===owner); }
  handle(page, op, a){ this.calls.push(op+(a&&a.table?':'+a.table:'')); if(this.down.has(page)&&op!=='signIn') throw new Error('Failed to fetch'); const own=a&&a.owner;
    switch(op){
      case 'signIn': return {id:a.uid, email:a.email};
      case 'pull': { let rs=this.rows(own, a.table); if(a.after) rs=rs.filter(x=>Date.parse(x.server_ts)>Date.parse(a.after)); rs.sort((x,y)=>x.server_ts<y.server_ts?-1:x.server_ts>y.server_ts?1:x.id<y.id?-1:1); return JSON.parse(JSON.stringify(rs.slice(0,a.limit))); }
      case 'byIds': return JSON.parse(JSON.stringify(this.rows(own, a.table).filter(x=>a.ids.includes(x.id))));
      case 'upsert': this.ups.push({page, table:a.table, rows:a.rows}); return this.write(own, a.table, a.rows);
      case 'markDeleted': return this.write(own, a.table, a.items.map(x=>({id:x.id, deleted:x.ts, modified:x.ts})));
      case 'subscribe': this.subs.set(page, a.uid); return a.tables||true;
      case 'unsubscribe': this.subs.delete(page); return true;
    } throw new Error('op '+op); }
}
const USER = {uid:'9b2f6d3e-0000-4000-8000-00000000e0f6', email:'enric@example.com'};
function fakeAdapter(){
  const call=(op,a)=>{ if(!navigator.onLine) return Promise.reject(new TypeError('Failed to fetch')); return window.fakeServer(op,a); };
  const owner=()=>{ const s=JSON.parse(localStorage.getItem('fake-session')||'null'); return s&&s.id; };
  const missing=new Set(), err=e=>({message:String(e&&e.message||e), code:/PGRST205/.test(String(e&&e.message||e))||/schema cache/.test(String(e&&e.message||e))?'PGRST205':''});
  window.__tareasRemote = { missing,
    async init(){ return JSON.parse(localStorage.getItem('fake-session')||'null'); },
    onAuth(cb){ window.__fakeAuth=cb; },
    async signIn(){ const u=await window.fakeServer('signIn', {uid:window.__fakeUser.uid, email:window.__fakeUser.email}); localStorage.setItem('fake-session', JSON.stringify(u)); setTimeout(()=>window.__fakeAuth&&window.__fakeAuth(u,'SIGNED_IN'),0); },
    async signOut(){ localStorage.removeItem('fake-session'); },
    async pull(table, after, limit){ try{ return await call('pull',{owner:owner(), table, after, limit}); }catch(e){ if(syncAbsent(missing, table, err(e))) return []; throw e; } },
    byIds:(table, ids)=>call('byIds',{owner:owner(), table, ids}),
    upsert:(table, rows)=>call('upsert',{owner:owner(), table, rows}),
    markDeleted:(table, items)=>call('markDeleted',{owner:owner(), table, items}),
    subscribe(uid, onRow, onStatus){ window.__fakeRT=(t,r)=>{ if(!missing.has(t)) onRow(t,r); }; window.fakeServer('subscribe',{uid}); setTimeout(()=>onStatus('SUBSCRIBED'),0); return ()=>{ window.__fakeRT=null; window.fakeServer('unsubscribe',{}); }; }
  };
}
const synced = page => until(page, ()=>SY&&SY.user&&!SY.running&&SY.status==='ok'&&syncCollect(true).count===0, null, 10000);
async function syncTests(browser){
  const T = '2026-11-01T10:00:00.000Z';
  const base = { spaces:[{id:'trabajo',name:'Trabajo',order:0,created:T},{id:'personal',name:'Personal',order:1,created:T}], projects:[{id:'q-p1', spaceId:'trabajo', name:'FLC', color:'#007AFF', order:0, archived:false, created:T, modified:T}], tasks:[], voiceNotes:[], attachments:[], subtasks:[], settings:{tipsSeen:true},
    projectNotes:[ {id:'qn1', projectId:'q-p1', title:'Acuerdos', body:'- Uno\n[ ] Dos', pinned:false, created:T, modified:T}, {id:'qn2', projectId:'q-p1', title:'Contactos', body:'Marta', pinned:true, created:T, modified:T} ] };
  const fake = new Fake(false); let x;
  const A = await open(browser, {tag:'SA', fake, seed:base, clock:false}), B = await open(browser, {tag:'SB', fake, seed:Object.assign({}, base, {projects:[], projectNotes:[]}), clock:false, desk:true});
  x = await ev(A.page, ()=>syncToRow('project_notes', noteRec('qn1')));
  check('sync_row', JSON.stringify(x)===JSON.stringify({id:'qn1', created:T, project_id:'q-p1', title:'Acuerdos', body:'- Uno\n[ ] Dos', pinned:false, modified:T, deleted:null}), x);
  await ev(A.page, ()=>syncSignIn()); check('sync_A_first', await synced(A.page));
  check('sync_server_notes', fake.t.project_notes.size===2 && fake.t.project_notes.get('qn2').pinned===true && fake.t.project_notes.get('qn1').project_id==='q-p1', [...fake.t.project_notes.values()]);
  await ev(B.page, ()=>syncSignIn()); check('sync_B_first', await synced(B.page));
  check('sync_B_gets', await ev(B.page, ()=>notesOf('q-p1').map(n=>n.id).join()==='qn2,qn1'));
  // A note written on A reaches B through realtime
  await ev(A.page, ()=>{ const n=addNote('q-p1'); n.title='Riesgos'; n.body='- Plazo'; n.modified=new Date().toISOString(); save(); }); check('sync_A_add', await synced(A.page));
  check('sync_B_realtime', await until(B.page, ()=>DB.projectNotes.some(n=>n.title==='Riesgos'&&n.body==='- Plazo')), await ev(B.page, ()=>DB.projectNotes.map(n=>n.title).join()));
  // Deleted on B: marked deleted on the server, gone from A
  await ev(B.page, ()=>{ deleteNote('qn1'); }); check('sync_B_delete', await synced(B.page));
  check('sync_delete', !!fake.t.project_notes.get('qn1').deleted && await until(A.page, ()=>!noteRec('qn1')), fake.t.project_notes.get('qn1'));
  // Notes of a demo project never go up
  await ev(A.page, ()=>{ generateDemo(); const dp=DB.projects.find(p=>String(p.id).startsWith('demo-')); const n=addNote(dp.id); n.title='Demo'; save(); }); await sleep(2200); check('sync_A_demo', await synced(A.page));
  check('sync_demo_not_pushed', [...fake.t.project_notes.values()].every(r=>!String(r.project_id).startsWith('demo-')) && await ev(A.page, ()=>DB.projectNotes.some(n=>n.title==='Demo')));
  await A.ctx.close(); await B.ctx.close();
  // A database without the table (0006 not run): logged once, the notes stay on the device, the rest syncs, nothing loops
  const nf = new Fake(true);
  const C = await open(browser, {tag:'SC', fake:nf, seed:base, clock:false});
  await ev(C.page, ()=>syncSignIn());
  check('notable_synced', await synced(C.page), await ev(C.page, ()=>({st:SY&&SY.status, err:SY&&SY.error})));
  await ev(C.page, ()=>{ const n=addNote('q-p1'); n.title='Local'; save(); const p=proj('q-p1'); p.name='FLC 2'; p.modified=new Date().toISOString(); save(); }); await sleep(300); await synced(C.page);
  const n1 = nf.ups.length; await sleep(3500); await synced(C.page);
  x = await ev(C.page, ()=>({notes:DB.projectNotes.length, warns:LOG.filter(e=>/0006_project_notes/.test(e.m)).map(e=>e.m), errs:LOG.filter(e=>e.l==='error').map(e=>e.m), pend:syncCollect(true).count, missing:[...SY.remote.missing]}));
  check('notable_tolerated', x.notes===3 && x.warns.length===1 && x.warns[0]==='La base de datos no tiene todavía la tabla project_notes: falta 0006_project_notes.sql. Las notas de proyecto se quedan en este dispositivo'
    && !x.errs.length && x.pend===0 && x.missing.join()==='project_notes' && nf.t.projects.get('q-p1').name==='FLC 2' && nf.t.project_notes.size===0 && !nf.ups.some(u=>u.table==='project_notes') && nf.ups.length===n1, {x, ups:nf.ups.map(u=>u.table), n1});
  await C.ctx.close();
}

(async()=>{
  await new Promise(res=>srv.listen(PORT,res)); const browser = await chromium.launch();
  try{ await sqlTests(); }catch(e){ fails.push('sql_exception'); errors.push('sql: '+String(e&&e.stack||e)); }
  try{ await iphone(browser); }catch(e){ fails.push('iphone_exception'); errors.push('iphone: '+String(e&&e.stack||e)); }
  try{ await desktop(browser); }catch(e){ fails.push('desktop_exception'); errors.push('desktop: '+String(e&&e.stack||e)); }
  try{ await dataTests(browser); }catch(e){ fails.push('data_exception'); errors.push('data: '+String(e&&e.stack||e)); }
  try{ await syncTests(browser); }catch(e){ fails.push('sync_exception'); errors.push('sync: '+String(e&&e.stack||e)); }
  console.log(JSON.stringify({r, fails, errors}, null, 1));
  await browser.close(); srv.close(); process.exit(fails.length||errors.length?1:0);
})();
