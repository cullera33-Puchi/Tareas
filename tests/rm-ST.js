require('./lib/out.js'); // outputs (screenshots, downloads) go to tests/out
// Decision 46 (steps inside a task), port 10200. Screenshots in tests/out/st.
//  1. SQL: supabase/migrations/0005_subtasks.sql run twice in PGlite after 0001 to 0004 (stand-ins for auth, pg_cron, pg_net and Storage):
//     the table and its columns, the write trigger "newest modified wins", the rules by owner, realtime, no rights for anon.
//  2. iPhone, clock at Wednesday 4 November 2026 10:00 (before 19:00, so no Cerrar el día): the row's "3/4" and ring, the group Pasos with
//     its count, Añadir paso with Intro keeping the same field focused, Intro in a step opening the next one in place, an empty step removed
//     on leaving it (with Deshacer), pasted lines, checking, the prompt Todos los pasos hechos and Completar tarea through R1's hold and
//     Deshacer, the swipe to Eliminar, the long press that lifts and moves a step, search, completing with open steps, the next task of a
//     series and a duplicate with the steps unchecked, deleting a task with its steps and Deshacer, share text, CSV, export, import and a
//     local backup restored.
//  3. Desktop: the steps column of the rows (only when some row has steps), the calendar card, the inspector's group (the field keeps its
//     focus and the inspector stays), Esc then Supr and Control Z, the step's menu and the right button, the handle, Alt and an arrow,
//     Espacio, and Control Z leaving the prompt Completar tarea alone.
//  4. Sync with rm-S's fake server, two devices: the steps go up and come down, edits of different steps of one task made offline on both
//     devices both survive, a deleted task takes its steps on the server and on the other device, demo steps never go up, the tasks keep
//     their signatures, and a database without the table (0005 not run) is tolerated through the app's own check (logged once, the steps
//     stay on the device, nothing loops); the real Supabase adapter too, with every request intercepted.
const { chromium } = require('playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = path.resolve(__dirname, '..'), PORT = 10200, URL0 = 'http://localhost:'+PORT+'/';
const OUT = path.join(__dirname, 'out', 'st'); fs.mkdirSync(OUT, {recursive:true});
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
    grant usage on schema public to service_role, authenticated;
  `);
  const strip = s => s.replace(/^create extension if not exists pg_(cron|net).*$/mg, '-- (extension stand-in)');
  const rd = f => fs.readFileSync(path.join(ROOT, 'supabase/migrations', f), 'utf8');
  await db.exec(rd('0001_init.sql')); await db.exec(strip(rd('0002_push.sql'))); await db.exec(rd('0003_attachments.sql')); await db.exec(rd('0004_repeat_focus.sql'));
  let err = null; try { await db.exec(rd('0005_subtasks.sql')); await db.exec(rd('0005_subtasks.sql')); } catch(e){ err = e.message; }
  check('sql_runs_twice', !err, err);
  const q = async (sql, params) => (await db.query(sql, params)).rows;
  const tryq = async (sql, params) => { try { return {rows: await q(sql, params)}; } catch(e){ return {error: e.message}; } };
  const cols = await q(`select column_name, data_type, is_nullable from information_schema.columns where table_schema='public' and table_name='subtasks' order by ordinal_position`);
  check('sql_columns', cols.map(c=>c.column_name+':'+c.data_type).join()==='id:text,owner_id:uuid,task_id:text,title:text,done:boolean,sort_order:integer,created:timestamp with time zone,modified:timestamp with time zone,deleted:timestamp with time zone,server_ts:timestamp with time zone'
    && cols.filter(c=>c.is_nullable==='NO').map(c=>c.column_name).join()==='id,owner_id,modified,server_ts', cols);
  const trg = await q(`select count(*)::int n from pg_trigger where tgrelid='public.subtasks'::regclass and tgname='tareas_before_write'`);
  const pub = await q(`select count(*)::int n from pg_publication_tables where pubname='supabase_realtime' and tablename='subtasks'`);
  const pol = await q(`select policyname from pg_policies where tablename='subtasks' order by policyname`);
  const idx = await q(`select indexname from pg_indexes where tablename='subtasks' order by indexname`);
  check('sql_objects', trg[0].n===1 && pub[0].n===1 && pol.map(p=>p.policyname).join()==='subtasks_delete_own,subtasks_insert_own,subtasks_select_own,subtasks_update_own' && idx.map(i=>i.indexname).join()==='subtasks_owner_server_ts,subtasks_pkey,subtasks_task', {trg, pub, pol, idx});
  const A = '00000000-0000-4000-8000-00000000000a', Bu = '00000000-0000-4000-8000-00000000000b';
  await db.exec(`insert into auth.users values ('${A}'), ('${Bu}')`);
  const as = async (uid, fn, role) => { await db.exec(`set test.uid = '${uid}'; set role ${role||'authenticated'};`); try { return await fn(); } finally { await db.exec(`reset role; reset test.uid;`); } };
  const ins = await as(A, () => tryq(`insert into public.subtasks (id, task_id, title, done, sort_order, created, modified) values ('s1', 't1', 'Pedir datos', false, 1024, '2026-11-04T09:00:00Z', '2026-11-04T09:00:00Z') returning owner_id, server_ts`));
  check('sql_insert', ins.rows && ins.rows[0].owner_id===A && !!ins.rows[0].server_ts, ins);
  const older = await as(A, () => tryq(`update public.subtasks set title = 'Viejo', modified = '2026-11-03T00:00:00Z' where id = 's1' returning id`));
  const newer = await as(A, () => tryq(`update public.subtasks set done = true, modified = '2026-11-04T10:00:00Z' where id = 's1' returning id`));
  const s1 = (await q(`select title, done from public.subtasks where id = 's1'`))[0];
  check('sql_newest_wins', older.rows && !older.rows.length && newer.rows && newer.rows.length===1 && s1.title==='Pedir datos' && s1.done===true, {older, newer, s1});
  const seenB = await as(Bu, () => tryq(`select id from public.subtasks`));
  const stealB = await as(Bu, () => tryq(`update public.subtasks set title = 'Ajeno', modified = now() where id = 's1' returning id`));
  const anon = await as(A, () => tryq(`select id from public.subtasks`), 'anon');
  check('sql_rls', seenB.rows && seenB.rows.length===0 && stealB.rows && stealB.rows.length===0 && !!anon.error, {seenB, stealB, anon});
  await db.close();
}

/* ======================= Pages ======================= */
const NOW = new Date(2026, 10, 4, 10, 0, 0); // Wednesday 4 November 2026, 10:00 local: before 19:00, no Cerrar el día
const T0 = '2026-11-04T08:00:00.000Z';
const tk = (id, o) => Object.assign({id, title:id, spaceId:'trabajo', projectId:null, date:'2026-11-04', reminder:null, priority:'none', status:'pending', notes:'', carried:false, created:T0, modified:T0, completed:null}, o);
const st = (id, taskId, title, done, order) => ({id, taskId, title, done, order, created:T0, modified:T0});
const SEED = () => ({ spaces:[{id:'trabajo',name:'Trabajo',order:0,created:T0},{id:'personal',name:'Personal',order:1,created:T0}],
  projects:[{id:'p1', spaceId:'trabajo', name:'FLC', color:'#007AFF', order:0, archived:false, created:T0, modified:T0},{id:'p2', spaceId:'trabajo', name:'Legal', color:'#34C759', order:1, archived:false, created:T0, modified:T0}],
  tasks:[ tk('t1', {title:'Preparar comité', projectId:'p1', priority:'high'}), tk('t2', {title:'Revisar SOW', projectId:'p2'}), tk('t3', {title:'Enviar acta', projectId:'p1'}),
    tk('t4', {title:'Informe mensual', repeat:'M1:4@2026-11-04#ser4', notes:'Con cifras'}), tk('t5', {title:'Comprar regalo', spaceId:'personal'}) ],
  voiceNotes:[], attachments:[],
  subtasks:[ st('s1','t1','Pedir los datos a Marta',true,1024), st('s2','t1','Revisar el borrador',false,2048), st('s3','t1','Enviar convocatoria',true,3072), st('s4','t1','Reservar sala',false,4096),
    st('s5','t3','Firmar el acta',false,1024), st('s6','t4','Sacar cifras',true,1024), st('s7','t4','Redactar',false,2048) ],
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
const steps = (page, id) => ev(page, id=>stepsOf(id).map(s=>(s.done?'x':'o')+':'+s.title).join('|'), id);
const domSteps = (page, scope) => ev(page, sc=>[...document.querySelectorAll(sc+' .steps > .step')].map(e=>(e.classList.contains('done')?'x':'o')+':'+e.querySelector('.stepin').value).join('|'), scope);
const menuItem = (page, label) => page.locator('#pmenu .pm-it').filter({has: page.locator('.pm-l', {hasText: new RegExp('^'+label+'$')})}).first();
async function cdp(page, fn){ const c=await page.context().newCDPSession(page); try{ await fn(c); } finally{ await c.detach(); } }
const touch = (c, type, x, y) => c.send('Input.dispatchTouchEvent', {type, touchPoints:type==='touchEnd'?[]:[{x, y}]});
async function tapAt(page, x, y){ await cdp(page, async c=>{ await touch(c,'touchStart',x,y); await sleep(40); await touch(c,'touchEnd'); }); }
async function swipe(page, x, y, dx, dy, n=10){ await cdp(page, async c=>{ await touch(c,'touchStart',x,y); for(let i=1;i<=n;i++){ await touch(c,'touchMove',x+dx*i/n,y+dy*i/n); await sleep(16); } await touch(c,'touchEnd'); }); }
async function liftMove(page, x, y, dy){ await cdp(page, async c=>{ await touch(c,'touchStart',x,y); await sleep(700); for(let i=1;i<=14;i++){ await touch(c,'touchMove',x,y+dy*i/14); await sleep(24); } await sleep(150); await touch(c,'touchEnd'); }); }
const box = (page, sel) => ev(page, s=>{ const e=document.querySelector(s); if(!e) return null; const b=e.getBoundingClientRect(); return {x:b.x, y:b.y, w:b.width, h:b.height, cx:b.x+b.width/2, cy:b.y+b.height/2}; }, sel);
const paste = (page, sel, text) => ev(page, ([s,t])=>{ const ta=document.querySelector(s); const dt=new DataTransfer(); dt.setData('text/plain', t); ta.dispatchEvent(new ClipboardEvent('paste', {clipboardData:dt, bubbles:true, cancelable:true})); }, [sel, text]);

/* ======================= 2. iPhone ======================= */
async function iphone(browser){
  const {ctx, page} = await open(browser, {tag:'M'});
  const L='.screen.root[data-root=tareas]', D='.screen.pushed-screen.detail';
  // The rows: "2/4" and the ring after the other data (v0.37.2, U2: in the grey line, before the small icons; on the right in a row without one); nothing for a task without steps
  let x = await ev(page, L=>{ const row=id=>document.querySelector(L+' .group .row[data-id='+id+']:not(.first .row)'); const p=id=>{ const e=row(id).querySelector('.sprog'); return e?e.textContent+'|'+!!e.querySelector('svg .sr-fg')+'|'+e.getAttribute('aria-label'):null; };
    return {t1:p('t1'), t2:p('t2'), t3:p('t3'), t4:p('t4'), last:(sp=>!sp.nextElementSibling||sp.nextElementSibling.classList.contains('micons'))(row('t1').querySelector('.sprog')), ahead:!!document.querySelector('.cerrar,[data-act=closeDay]')}; }, L);
  check('m_row_progress', x.t1==='2/4|true|2 de 4 pasos' && x.t2===null && x.t3==='0/1|false|0 de 1 pasos' && x.t4==='1/2|true|1 de 2 pasos' && x.last===true, x);
  await shot(page, 'm1-list');
  // The detail: the group Pasos with its count, the steps in order and Añadir paso
  await page.tap(L+' .group .row[data-id=t1]:not(.first .row) .row-title'); await calm(page);
  x = await ev(page, D=>{ const d=document.querySelector(D); const g=d.querySelector('.steps'); return {title:g.previousElementSibling.firstChild.textContent, count:d.querySelector('.steps-count').textContent, add:g.lastElementChild.querySelector('.stepin').placeholder, before:g.previousElementSibling.previousElementSibling.className}; }, D);
  check('m_detail_group', x.title==='Pasos' && x.count==='2 de 4' && x.add==='Añadir paso' && await domSteps(page, D)==='x:Pedir los datos a Marta|o:Revisar el borrador|x:Enviar convocatoria|o:Reservar sala', x);
  await shot(page, 'm2-detail');
  // Añadir paso: Intro adds the step and the same field stays focused (the keyboard stays), for the next one
  await page.tap(D+' .step-add .stepin'); await page.keyboard.type('Llamar al cliente'); await page.keyboard.press('Enter');
  const ae1 = await ev(page, ()=>{ const a=document.activeElement; a._mark=1; return a.dataset.role+'|'+a.value; });
  await page.keyboard.type('Confirmar menú'); await page.keyboard.press('Enter');
  x = await ev(page, ()=>({ae:document.activeElement.dataset.role, mark:document.activeElement._mark, val:document.activeElement.value, count:document.querySelector('.screen.pushed-screen.detail .steps-count').textContent}));
  check('m_add_enter_keeps_field', ae1==='stepadd|' && x.ae==='stepadd' && x.mark===1 && x.val==='' && x.count==='2 de 6' && await steps(page, 't1')==='x:Pedir los datos a Marta|o:Revisar el borrador|x:Enviar convocatoria|o:Reservar sala|o:Llamar al cliente|o:Confirmar menú', {ae1, x, s:await steps(page,'t1')});
  await shot(page, 'm3-add-steps');
  // Intro in a step opens the next one right after it, focused at once; typing makes it a step there; leaving an empty one removes it
  let b = await box(page, D+' .steps > .step:nth-child(2)'); await tapAt(page, b.x+b.w-40, b.cy); await sleep(150);
  const ae2 = await ev(page, ()=>document.activeElement.value);
  await page.keyboard.press('Enter'); await sleep(100);
  x = await ev(page, ()=>{ const a=document.activeElement, row=a.closest('.step'); return {draft:row&&row.classList.contains('draft'), idx:[...row.parentElement.children].indexOf(row)}; });
  await page.keyboard.type('Paso intermedio'); await sleep(100);
  const mid = await steps(page, 't1');
  await page.keyboard.press('Enter'); await sleep(100);
  const ae3 = await ev(page, ()=>{ const a=document.activeElement, row=a.closest('.step'); return row&&row.classList.contains('draft')&&[...row.parentElement.children].indexOf(row); });
  await page.tap(D+' .titlein'); await sleep(250);
  x = Object.assign(x, {after:await domSteps(page, D), data:await steps(page,'t1'), drafts:await ev(page, ()=>document.querySelectorAll('.steps .draft').length)});
  check('m_enter_chains', ae2==='Revisar el borrador' && x.draft && x.idx===2 && mid.split('|')[2]==='o:Paso intermedio' && ae3===3 && x.drafts===0 && x.data.split('|').length===7 && x.after===x.data, {ae2, x, mid, ae3});
  // An emptied step goes when it is left, with Deshacer (its title comes back)
  b = await box(page, D+' .steps > .step:nth-child(5)'); await tapAt(page, b.x+b.w-40, b.cy); await sleep(150);
  const was = await ev(page, ()=>document.activeElement.value);
  await page.keyboard.press('Control+a'); await page.keyboard.press('Backspace'); await page.tap(D+' .titlein'); await sleep(300);
  const t1 = await toastOn(page), gone = await steps(page, 't1');
  await page.click('#toastBtn'); await calm(page);
  check('m_empty_removed', was==='Reservar sala' && t1 && t1.t==='Paso eliminado' && t1.b==='Deshacer' && !gone.includes('Reservar sala') && (await steps(page,'t1')).includes('o:Reservar sala'), {was, t1, gone});
  // Pasting several lines into Añadir paso: one step each, bullets and numbers cleaned (R6), one Deshacer
  await page.tap(D+' .step-add .stepin'); await paste(page, D+' .step-add .stepin', '- Uno\n* Dos\n\n3. Tres\n'); await sleep(200);
  const pt = await toastOn(page), pasted = await steps(page, 't1');
  await page.click('#toastBtn'); await calm(page);
  check('m_paste_lines', pt && pt.t==='3 pasos añadidos' && pasted.endsWith('o:Uno|o:Dos|o:Tres') && !(await steps(page,'t1')).includes('Uno'), {pt, pasted});
  // Swipe to the left: Eliminar, then Deshacer
  await page.tap(D+' .titlein'); await page.evaluate(()=>document.activeElement.blur()); await sleep(200);
  await ev(page, D=>document.querySelector(D+' .steps').scrollIntoView({block:'center'}), D); await sleep(100);
  const sel6 = D+' .steps > .step[data-st]:nth-child(6)'; const id6 = await ev(page, s=>document.querySelector(s).dataset.st, sel6);
  b = await box(page, sel6); await swipe(page, b.x+b.w-60, b.cy, -140, 0); await sleep(500);
  x = await ev(page, s=>{ const e=document.querySelector(s); return {open:e.dataset.open, btn:e.querySelector('.vn-bg.r button').textContent, vis:getComputedStyle(e.querySelector('.vn-bg.r')).display}; }, sel6);
  await shot(page, 'm4-swipe-delete');
  await page.tap(sel6+' .vn-bg.r button'); await sleep(300);
  const t2 = await toastOn(page), del = await ev(page, id=>!stepRec(id), id6);
  await page.click('#toastBtn'); await calm(page);
  check('m_swipe_delete', x.open==='l' && x.btn==='Eliminar' && x.vis==='block' && t2 && t2.t==='Paso eliminado' && del && await ev(page, id=>!!stepRec(id), id6), {x, t2, del});
  // Several deletions in a row, one of them while editing the step's title: each one leaves the screen too (v0.23.1, the row stayed on screen)
  { const seq=[]; for(let k=0;k<3;k++){ await hideToast(page);
      const sid=await ev(page, D=>[...document.querySelectorAll(D+' .steps > .step[data-st]')].map(e=>e.dataset.st).filter(i=>!/^s[1-4]$/.test(i)).pop(), D); const sel=D+' .steps > .step[data-st="'+sid+'"]';
      await ev(page, s=>document.querySelector(s).scrollIntoView({block:'center'}), sel); await sleep(100);
      b = await box(page, sel); if(k===1){ await tapAt(page, b.x+b.w/2, b.cy); await sleep(300); b = await box(page, sel); }
      await swipe(page, b.x+b.w-60, b.cy, -140, 0); await sleep(500);
      const bb = await box(page, sel+' .vn-bg.r button'); if(bb) await tapAt(page, bb.cx, bb.cy); await sleep(500);
      seq.push(await ev(page, ([D,id])=>({gone:!stepRec(id), inDom:!!document.querySelector(D+' .step[data-st="'+id+'"]'), data:stepsOf('t1').length, dom:document.querySelectorAll(D+' .steps > .step[data-st]').length}), [D, sid])); }
    await hideToast(page);
    check('m_delete_in_a_row', seq.every(q=>q.gone && !q.inDom && q.data===q.dom) && seq[2].data===seq[0].data-2, seq); }
  // Long press lifts a step and the same finger moves it; Deshacer puts it back
  const order0 = await steps(page, 't1');
  b = await box(page, D+' .steps > .step:nth-child(1)'); const h = b.h;
  await liftMove(page, b.x+b.w-50, b.cy, h*2.2); await sleep(300);
  const order1 = await steps(page, 't1'), t3 = await toastOn(page);
  check('m_long_press_move', order1.split('|')[2]==='x:Pedir los datos a Marta' && order1.split('|')[0]==='o:Revisar el borrador' && t3 && t3.t==='Paso movido' && await domSteps(page, D)===order1 && await ev(page, ()=>!document.querySelector('.step.lifted')&&!touchDrag), {order0, order1, t3});
  await page.click('#toastBtn'); await calm(page);
  check('m_move_undo', await steps(page, 't1')===order0, await steps(page, 't1'));
  // Checking: the count follows; the last open step offers Completar tarea; the task never completes by itself
  await ev(page, ()=>{ DB.subtasks=DB.subtasks.filter(s=>s.taskId!=='t1'||['s1','s2','s3','s4'].includes(s.id)); save(); render(); }); await calm(page);
  await ev(page, D=>document.querySelector(D+' .steps').scrollIntoView({block:'center'}), D);
  await page.tap(D+' .steps > .step:nth-child(2) .scheck'); await sleep(200);
  x = {count:await ev(page, ()=>document.querySelector('.screen.pushed-screen.detail .steps-count').textContent), toast:await toastOn(page)};
  await page.tap(D+' .steps > .step:nth-child(4) .scheck'); await sleep(250);
  const t4 = await toastOn(page); await shot(page, 'm5-all-done');
  await sleep(2000);
  const still = await ev(page, ()=>task('t1').status);
  check('m_all_done_prompt', x.count==='3 de 4' && (!x.toast||x.toast.t!=='Todos los pasos hechos') && t4 && t4.t==='Todos los pasos hechos' && t4.b==='Completar tarea' && still==='pending', {x, t4, still});
  await page.click('#toastBtn');
  const held = await ev(page, ()=>HELD.get('t1')===true);
  await until(page, ()=>task('t1').status==='done', null, 6000);
  const t5 = await toastOn(page);
  await page.click('#toastBtn'); await calm(page);
  check('m_complete_through_hold', held && t5 && t5.t==='Tarea completada' && t5.b==='Deshacer' && await ev(page, ()=>task('t1').status==='pending') && await steps(page,'t1')==='x:Pedir los datos a Marta|x:Revisar el borrador|x:Enviar convocatoria|x:Reservar sala', {held, t5});
  // Unchecking and checking again: the count goes back
  await page.tap(D+' .steps > .step:nth-child(4) .scheck'); await sleep(200);
  check('m_uncheck', await ev(page, ()=>document.querySelector('.screen.pushed-screen.detail .steps-count').textContent)==='3 de 4');
  await hideToast(page);
  // Back to the list: the row follows
  await page.tap(D+' [data-act=back]'); await calm(page); await until(page, L=>!document.querySelector(L).classList.contains('under'), L);
  x = await ev(page, L=>document.querySelector(L+' .group .row[data-id=t1]:not(.first .row) .sprog').textContent, L);
  check('m_row_follows', x==='3/4', x);
  // Search finds a step's title (accents ignored)
  await page.tap(L+' [data-role=search]'); await page.keyboard.type('convocatoria'); await until(page, L=>document.querySelectorAll(L+' .group .row[data-id]:not(.first .row)').length===1, L);
  x = await ev(page, L=>[...document.querySelectorAll(L+' .group .row[data-id]:not(.first .row)')].map(e=>e.dataset.id).join(), L);
  check('m_search', x==='t1', x); await shot(page, 'm6-search');
  await ev(page, ()=>{ UI.query=''; document.activeElement.blur(); render(); }); await calm(page);
  // Completing with open steps leaves them as they are; Deshacer
  await ev(page, ()=>{ completeTask('t3'); render(); }); await calm(page);
  check('m_complete_leaves_steps', await steps(page, 't3')==='o:Firmar el acta' && await ev(page, ()=>task('t3').status==='done'));
  await ev(page, ()=>{ undoDone({id:'t3', status:'pending', completed:null}); render(); }); await calm(page);
  // A task that repeats: the next one gets the steps unchecked, in the same order; the completed one keeps its own
  await ev(page, ()=>{ completeTask('t4'); render(); }); await calm(page);
  x = await ev(page, ()=>{ const nx=DB.tasks.find(t=>t.id!=='t4'&&repSeries(t.repeat)==='ser4'); return nx&&{date:nx.date, steps:stepsOf(nx.id).map(s=>(s.done?'x':'o')+':'+s.title).join('|'), own:stepsOf('t4').map(s=>(s.done?'x':'o')+':'+s.title).join('|'), ids:stepsOf(nx.id).every(s=>!['s6','s7'].includes(s.id))}; });
  check('m_repeat_copies', x && x.date==='2026-12-04' && x.steps==='o:Sacar cifras|o:Redactar' && x.own==='x:Sacar cifras|o:Redactar' && x.ids, x);
  // Deshacer of that completion takes the untouched next one back with its steps
  await ev(page, ()=>{ undoDone({id:'t4', status:'pending', completed:null}); render(); }); await calm(page);
  check('m_repeat_undo', await ev(page, ()=>DB.tasks.filter(t=>repSeries(t.repeat)==='ser4').length===1 && DB.subtasks.filter(s=>s.taskId!=='t4'&&/^(Sacar cifras|Redactar)$/.test(s.title)).length===0));
  // Duplicate: the steps, unchecked
  await ev(page, ()=>duplicateTask('t1')); await calm(page);
  x = await ev(page, ()=>{ const d=DB.tasks.find(t=>t.title==='Preparar comité'&&t.id!=='t1'); return d&&stepsOf(d.id).map(s=>(s.done?'x':'o')+':'+s.title).join('|'); });
  check('m_duplicate', x==='o:Pedir los datos a Marta|o:Revisar el borrador|o:Enviar convocatoria|o:Reservar sala', x);
  await ev(page, ()=>{ while(UI.stack.length) pop(); }); await calm(page);
  await ev(page, ()=>{ const d=DB.tasks.find(t=>t.title==='Preparar comité'&&t.id!=='t1'); removeTasks([d.id]); render(); }); await calm(page);
  check('m_remove_cascade', await ev(page, ()=>DB.subtasks.every(s=>task(s.taskId))));
  // Deleting a task takes its steps; Deshacer brings both back
  const n1 = await ev(page, ()=>DB.subtasks.length);
  await ev(page, ()=>{ deleteTask('t3'); render(); }); await sleep(100);
  const n2 = await ev(page, ()=>DB.subtasks.length); await page.click('#toastBtn'); await calm(page);
  check('m_delete_cascade', n2===n1-1 && await ev(page, ()=>!!task('t3') && stepsOf('t3').length===1), {n1, n2});
  // Share text and CSV: the steps with their state
  x = await ev(page, ()=>({share:shareText('t1'), csv:csvText()}));
  const head = x.csv.split('\r\n')[0], line = x.csv.split('\r\n').find(l=>l.includes('Preparar comité'))||'';
  check('m_share_text', /\nPasos \(3 de 4 hechos\):\n- \[x\] Pedir los datos a Marta\n- \[x\] Revisar el borrador\n- \[x\] Enviar convocatoria\n- \[ \] Reservar sala\n$/.test(x.share), x.share);
  check('m_csv', head.includes('"Notas";"Pasos";"Creada"') && line.includes('"[x] Pedir los datos a Marta | [x] Revisar el borrador | [x] Enviar convocatoria | [ ] Reservar sala"'), {head, line});
  // Export, import and a local backup restored
  x = await ev(page, async()=>{ const ex=exportData(); const n=ex.subtasks.length; const saved=JSON.stringify(ex);
    DB.subtasks=DB.subtasks.filter(s=>s.taskId!=='t1'); save(); const r1=importData(saved); const back=stepsOf('t1').length;
    await BK.put(todayStr()); await refreshBackups(); const snap=await BK.get(todayStr());
    const s=stepRec('s2'); s.title='Cambiado'; s.modified=new Date().toISOString(); DB.subtasks=DB.subtasks.filter(o=>o.id!=='s4'); save();
    return {n, imported:r1.added, back, snap:(snap.data.subtasks||[]).length}; });
  await ev(page, ()=>restoreBackup(todayStr())); await until(page, ()=>document.querySelector('#asheet').classList.contains('on')); await sleep(600); // a sheet just opened ignores taps for 450 ms
  await page.locator('#asheet button', {hasText:/^Restaurar/}).first().click(); await until(page, ()=>!!stepRec('s4') && stepRec('s2').title==='Revisar el borrador');
  check('m_export_import_backup', x.n===7 && x.imported===4 && x.back===4 && x.snap===7 && await ev(page, ()=>!!stepRec('s4') && stepRec('s2').title==='Revisar el borrador'), x);
  await calm(page); await hideToast(page);
  // Demo data brings steps with demo- ids, and clearing them takes them away
  x = await ev(page, ()=>{ generateDemo(); const a=DB.subtasks.filter(s=>String(s.id).startsWith('demo-')).length; const ok=DB.subtasks.filter(s=>String(s.id).startsWith('demo-')).every(s=>String(s.taskId).startsWith('demo-'));
    const isDemo=o=>String(o.id).startsWith('demo-'); DB.tasks=DB.tasks.filter(t=>!isDemo(t)); DB.projects=DB.projects.filter(p=>!isDemo(p)); DB.subtasks=DB.subtasks.filter(o=>!isDemo(o)); save(); render(); return {a, ok}; });
  check('m_demo_steps', x.a>0 && x.ok, x);
  // Dark theme, for a look
  await ctx.close();
  { const {ctx, page} = await open(browser, {tag:'MD', theme:'dark'}); await page.tap(L+' .group .row[data-id=t1]:not(.first .row) .row-title'); await calm(page); await shot(page, 'm7-detail-dark');
    await ev(page, ()=>{ while(UI.stack.length) pop(); }); await calm(page); await shot(page, 'm8-list-dark'); await ctx.close(); }
}

/* ======================= 3. Desktop ======================= */
async function desktop(browser){
  const {ctx, page} = await open(browser, {tag:'D', desk:true});
  await ev(page, ()=>setDeskView('hoy')); await calm(page);
  const col = (page, id) => ev(page, id=>{ const e=document.querySelector('#desk .main .mbody .row[data-id='+id+']:not(.first .row) .rsteps'); return e?{t:e.textContent, d:getComputedStyle(e).display, w:Math.round(e.getBoundingClientRect().width)}:null; }, id);
  let x = {t1:await col(page,'t1'), t2:await col(page,'t2')};
  check('d_column', x.t1 && x.t1.t==='2/4' && x.t1.d==='flex' && x.t2 && x.t2.t==='' && x.t2.d==='flex' && x.t1.w===x.t2.w, x);
  // A list where no row has steps: the column takes no room (point 22)
  await ev(page, ()=>setDeskView('project:p2')); await calm(page);
  x = await col(page, 't2'); check('d_column_hidden', x && x.d==='none', x);
  await ev(page, ()=>setDeskView('week')); await calm(page);
  x = await ev(page, ()=>{ const c=document.querySelector('#desk .wcard[data-id=t1]'); return c&&{p:(c.querySelector('.sprog')||{}).textContent, tip:c.title}; });
  check('d_week_card', x && x.p==='2/4' && /\n2 de 4 pasos$/.test(x.tip), x); await shot(page, 'd1-week');
  await ev(page, ()=>setDeskView('hoy')); await calm(page); await shot(page, 'd2-hoy');
  // The inspector: Añadir paso keeps its focus across the redraw of the column, the inspector stays the same element
  await page.click('#desk .main .mbody .row[data-id=t1]:not(.first .row) .row-title'); await until(page, ()=>!!document.querySelector('#desk .pane .steps'));
  await ev(page, ()=>{ document.querySelector('#desk .pane')._mark=1; });
  await page.click('#desk .pane .step-add .stepin'); await page.keyboard.type('Llamar al cliente'); await page.keyboard.press('Enter'); await page.keyboard.type('Mandar acta'); await page.keyboard.press('Enter');
  x = await ev(page, ()=>({ae:document.activeElement.dataset.role, pane:document.querySelector('#desk .pane')._mark, count:document.querySelector('#desk .pane .steps-count').textContent, col:document.querySelector('#desk .main .row[data-id=t1]:not(.first .row) .rsteps').textContent}));
  check('d_add_keeps_focus', x.ae==='stepadd' && x.pane===1 && x.count==='2 de 6' && x.col==='2/6', x);
  await shot(page, 'd3-inspector');
  // Esc leaves the field and selects the step (the inspector stays open); Supr deletes it; Control Z gives it back
  await page.click('#desk .pane .steps > .step:nth-child(6) .stepin'); await page.keyboard.press('Escape'); await sleep(150);
  x = await ev(page, ()=>({sel:document.activeElement.classList.contains('step')&&document.activeElement.querySelector('.stepin').value, pane:!!document.querySelector('#desk .pane .steps')}));
  await page.keyboard.press('Delete'); await sleep(250);
  const del = await steps(page, 't1'), dt = await toastOn(page), task1 = await ev(page, ()=>!!task('t1'));
  await page.keyboard.press('Control+z'); await sleep(250);
  check('d_esc_supr_undo', x.sel==='Mandar acta' && x.pane && !del.includes('Mandar acta') && dt && dt.t==='Paso eliminado' && task1 && (await steps(page,'t1')).endsWith('o:Mandar acta'), {x, del, dt});
  // The step's menu (its button on hover) and the right button
  await page.hover('#desk .pane .steps > .step:nth-child(5)'); await page.click('#desk .pane .steps > .step:nth-child(5) .smore'); await until(page, ()=>!!document.querySelector('#pmenu .pm-it'));
  const items = await ev(page, ()=>[...document.querySelectorAll('#pmenu .pm-it .pm-l')].map(e=>e.textContent).join());
  await shot(page, 'd4-step-menu');
  await menuItem(page, 'Eliminar paso').click(); await sleep(250);
  const m1 = await steps(page, 't1'); await page.click('#toastBtn'); await sleep(250);
  await page.click('#desk .pane .steps > .step:nth-child(2)', {button:'right', position:{x:6, y:10}}); await until(page, ()=>!!document.querySelector('#pmenu .pm-it'));
  await menuItem(page, 'Marcar paso').click(); await sleep(250);
  check('d_menus', items==='Marcar paso,Subir,Bajar,Eliminar paso' && !m1.includes('Llamar al cliente') && (await steps(page,'t1')).split('|')[1]==='x:Revisar el borrador', {items, m1, s:await steps(page,'t1')});
  await hideToast(page);
  // The handle on hover moves a step; Alt and an arrow move the selected one
  const before = await steps(page, 't1');
  let g = await box(page, '#desk .pane .steps > .step:nth-child(1) .sgrip'), h = (await box(page, '#desk .pane .steps > .step:nth-child(1)')).h;
  await page.hover('#desk .pane .steps > .step:nth-child(1)'); await page.mouse.move(g.cx, g.cy); await page.mouse.down();
  for(let i=1;i<=10;i++){ await page.mouse.move(g.cx, g.cy+h*2.3*i/10); await sleep(20); } await shot(page, 'd5-drag'); await page.mouse.up(); await sleep(250);
  const dragged = await steps(page, 't1');
  check('d_handle_drag', dragged.split('|')[2]===before.split('|')[0] && (await toastOn(page)||{}).t==='Paso movido', {before, dragged});
  await page.keyboard.press('Control+z'); await sleep(250);
  await page.click('#desk .pane .steps > .step:nth-child(1) .sgrip'); await sleep(100); // a click on the handle, without moving, selects the step
  const selG = await ev(page, ()=>document.activeElement.classList.contains('step')&&document.activeElement.querySelector('.stepin').value);
  await page.keyboard.press('Alt+ArrowDown'); await sleep(250);
  x = {s:await steps(page,'t1'), f:await ev(page, ()=>document.activeElement.classList.contains('step')&&document.activeElement.querySelector('.stepin').value)};
  check('d_alt_arrow', selG==='Pedir los datos a Marta' && x.s.split('|')[1]===before.split('|')[0] && x.f==='Pedir los datos a Marta', {selG, before, x});
  await page.keyboard.press('Control+z'); await sleep(250); await hideToast(page);
  // Espacio checks the selected step; the last one offers Completar tarea; Control Z leaves that offer alone; the button completes through R1
  await ev(page, ()=>{ stepsOf('t1').forEach(s=>{ if(!/Reservar sala/.test(s.title)) s.done=true; }); save(); render(); }); await sleep(250);
  const rs = await ev(page, ()=>[...document.querySelectorAll('#desk .pane .steps > .step')].findIndex(e=>e.querySelector('.stepin').value==='Reservar sala')+1);
  await page.click('#desk .pane .steps > .step:nth-child('+rs+') .stepin'); await page.keyboard.press('Escape'); await page.keyboard.press(' '); await sleep(250);
  const tp = await toastOn(page); await page.keyboard.press('Control+z'); await sleep(250);
  x = {t:await ev(page, ()=>task('t1').status), still:await toastOn(page), held:await ev(page, ()=>HELD.size), pane:await ev(page, ()=>!!document.querySelector('#desk .pane .steps'))};
  await shot(page, 'd6-all-done');
  check('d_all_done_prompt', tp && tp.t==='Todos los pasos hechos' && tp.b==='Completar tarea' && x.t==='pending' && x.still && x.still.t==='Todos los pasos hechos' && !x.held && x.pane, {tp, x});
  await page.click('#toastBtn'); await until(page, ()=>task('t1').status==='done', null, 6000);
  check('d_complete', await ev(page, ()=>task('t1').status==='done' && stepsOf('t1').every(s=>s.done)));
  await ctx.close();
}

/* ======================= 4. Sync ======================= */
const TABLES = ['spaces','projects','tasks','voice_notes','attachments','subtasks','project_notes','contacts']; // decision 47: the app syncs the project notes too
// rm-S's in-memory server (0001's trigger and RLS). noTable: a database where 0005 has not run: any request on subtasks fails as PostgREST does
class Fake {
  constructor(noTable){ this.noTable=!!noTable; this.t={}; TABLES.forEach(x=>this.t[x]=new Map()); this.last=0; this.subs=new Map(); this.down=new Set(); this.calls=[]; this.ups=[]; }
  ts(){ this.last=Math.max(Date.now(), this.last+1); return new Date(this.last).toISOString(); }
  gone(table){ if(this.noTable&&table==='subtasks'){ const e=new Error("Could not find the table 'public.subtasks' in the schema cache"); e.code='PGRST205'; throw e; } }
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
// The adapter the app sees, as supabaseRemote(): a binding's error comes back as a plain Error, so the code PostgREST would give is read from the message.
// A missing table goes through the app's own check (syncAbsent), as the real adapter does
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
  const today = (()=>{ const d=new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); })();
  const T = '2026-11-01T10:00:00.000Z';
  const base = { spaces:[{id:'trabajo',name:'Trabajo',order:0,created:T},{id:'personal',name:'Personal',order:1,created:T}], projects:[], voiceNotes:[], attachments:[], settings:{tipsSeen:true},
    tasks:[ {id:'q1', title:'Preparar viaje', spaceId:'trabajo', projectId:null, date:today, reminder:null, priority:'none', status:'pending', notes:'', carried:false, created:T, modified:T, completed:null},
      {id:'q2', title:'Cerrar contrato', spaceId:'trabajo', projectId:null, date:today, reminder:null, priority:'mid', status:'pending', notes:'', carried:false, created:T, modified:T, completed:null} ],
    subtasks:[ {id:'qs1', taskId:'q1', title:'Billetes', done:false, order:1024, created:T, modified:T}, {id:'qs2', taskId:'q1', title:'Hotel', done:false, order:2048, created:T, modified:T}, {id:'qs3', taskId:'q2', title:'Firmar', done:false, order:1024, created:T, modified:T} ] };
  const fake = new Fake(false); let x;
  const A = await open(browser, {tag:'SA', fake, seed:base, clock:false}), B = await open(browser, {tag:'SB', fake, seed:Object.assign({}, base, {tasks:[], subtasks:[]}), clock:false, desk:true});
  // The tasks keep the signature they had before the steps: no new keys in their rows; a step's row
  x = await ev(A.page, ()=>({task:Object.keys(syncToRow('tasks', task('q1'))).join(), step:syncToRow('subtasks', stepRec('qs1'))}));
  check('sync_rows', x.task==='id,created,space_id,project_id,title,date,reminder,priority,status,notes,carried,completed,modified,deleted' && JSON.stringify(x.step)===JSON.stringify({id:'qs1', created:T, task_id:'q1', title:'Billetes', done:false, sort_order:1024, modified:T, deleted:null}), x);
  await ev(A.page, ()=>syncSignIn()); check('sync_A_first', await synced(A.page));
  check('sync_server_steps', fake.t.subtasks.size===3 && fake.t.subtasks.get('qs2').task_id==='q1' && fake.t.subtasks.get('qs2').sort_order===2048 && fake.t.subtasks.get('qs2').done===false, [...fake.t.subtasks.values()]);
  await ev(B.page, ()=>syncSignIn()); check('sync_B_first', await synced(B.page));
  check('sync_B_gets', await ev(B.page, ()=>stepsOf('q1').map(s=>s.title).join()==='Billetes,Hotel' && stepsOf('q2').length===1));
  // A step added on A reaches B through realtime, in its place
  await ev(A.page, ()=>{ addStep('q1', 'Seguro', 1); }); check('sync_A_add', await synced(A.page));
  check('sync_B_realtime', await until(B.page, ()=>stepsOf('q1').map(s=>s.title).join()==='Billetes,Seguro,Hotel'), await ev(B.page, ()=>stepsOf('q1').map(s=>s.title).join()));
  // Both devices offline: A renames one step, B checks another of the same task; once back, both changes are everywhere
  fake.down.add(A.page); fake.down.add(B.page); await A.ctx.setOffline(true); await B.ctx.setOffline(true); await sleep(200);
  await ev(A.page, ()=>{ const s=stepRec('qs1'); s.title='Billetes de tren'; s.modified=new Date().toISOString(); save(); });
  await sleep(30); await ev(B.page, ()=>{ toggleStep('qs2'); });
  fake.down.delete(A.page); await A.ctx.setOffline(false); check('sync_A_back', await synced(A.page));
  fake.down.delete(B.page); await B.ctx.setOffline(false); check('sync_B_back', await synced(B.page)); await synced(A.page);
  const want = 'o:Billetes de tren|o:Seguro|x:Hotel';
  check('sync_no_conflict', await until(A.page, w=>stepsOf('q1').map(s=>(s.done?'x':'o')+':'+s.title).join('|')===w, want) && await until(B.page, w=>stepsOf('q1').map(s=>(s.done?'x':'o')+':'+s.title).join('|')===w, want)
    && fake.t.subtasks.get('qs1').title==='Billetes de tren' && fake.t.subtasks.get('qs2').done===true, {A:await steps(A.page,'q1'), B:await steps(B.page,'q1')});
  // Deleting a task on B: its steps are marked deleted on the server and leave A
  await ev(B.page, ()=>{ deleteTask('q2'); render(); }); check('sync_B_delete', await synced(B.page));
  check('sync_delete_cascade', !!fake.t.subtasks.get('qs3').deleted && !!fake.t.tasks.get('q2').deleted && await until(A.page, ()=>!task('q2') && !stepRec('qs3')), {s:fake.t.subtasks.get('qs3')});
  // Demo steps never go up
  await ev(A.page, ()=>{ generateDemo(); }); await sleep(2200); check('sync_A_demo', await synced(A.page));
  check('sync_demo_not_pushed', await ev(A.page, ()=>DB.subtasks.some(s=>String(s.id).startsWith('demo-'))) && [...fake.t.subtasks.keys()].every(id=>!id.startsWith('demo-')));
  await A.ctx.close(); await B.ctx.close();

  // A database without the table (0005 not run): logged once, the steps stay on the device, tasks still sync, nothing loops
  const nf = new Fake(true);
  const C = await open(browser, {tag:'SC', fake:nf, seed:base, clock:false});
  await ev(C.page, ()=>syncSignIn());
  check('notable_synced', await synced(C.page), await ev(C.page, ()=>({st:SY&&SY.status, err:SY&&SY.error})));
  await ev(C.page, ()=>{ addStep('q1', 'Visado'); toggleStep('qs1'); updTask('q2', {title:'Cerrar contrato (editada)'}); }); await sleep(300); await synced(C.page);
  const n1 = nf.ups.length; await sleep(3500); await synced(C.page);
  x = await ev(C.page, ()=>({steps:stepsOf('q1').map(s=>(s.done?'x':'o')+':'+s.title).join('|'), warns:LOG.filter(e=>/0005_subtasks/.test(e.m)).map(e=>e.m), errs:LOG.filter(e=>e.l==='error').map(e=>e.m), pend:syncCollect(true).count, missing:[...SY.remote.missing]}));
  check('notable_tolerated', x.steps==='x:Billetes|o:Hotel|o:Visado' && x.warns.length===1 && x.warns[0]==='La base de datos no tiene todavía la tabla subtasks: falta 0005_subtasks.sql. Los pasos se quedan en este dispositivo'
    && !x.errs.length && x.pend===0 && x.missing.join()==='subtasks' && nf.t.tasks.get('q2').title==='Cerrar contrato (editada)' && nf.t.subtasks.size===0 && !nf.ups.some(u=>u.table==='subtasks'), {x, ups:nf.ups.map(u=>u.table)});
  check('notable_no_loop', nf.ups.length===n1, {before:n1, after:nf.ups.length});
  await C.ctx.close();

  // The real Supabase adapter: a database without the table answers PostgREST's PGRST205; pull gives nothing and the table is noted once
  { const ctx = await browser.newContext(); const page = await ctx.newPage();
    page.on('pageerror', e=>errors.push('R pageerror: '+e.message));
    await page.route('https://fakeref.supabase.co/**', route=>{ const q=route.request(), u=new URL(q.url());
      const j=(s,o)=>route.fulfill({status:s, contentType:'application/json', headers:{'Access-Control-Allow-Origin':'*'}, body:JSON.stringify(o)});
      if(q.method()==='OPTIONS') return route.fulfill({status:204, headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*','Access-Control-Allow-Methods':'*'}});
      if(u.pathname==='/rest/v1/subtasks') return j(404, {code:'PGRST205', details:null, hint:null, message:"Could not find the table 'public.subtasks' in the schema cache"});
      if(u.pathname.startsWith('/rest/v1/')) return j(200, []); return j(404, {}); });
    await page.goto(URL0); await until(page, ()=>typeof supabaseRemote==='function');
    x = await page.evaluate(async()=>{ const R=supabaseRemote({url:'https://fakeref.supabase.co', anonKey:'anon-key'}); await R.init();
      const a=await R.pull('subtasks', null, 10), b=await R.pull('subtasks', null, 10), t=await R.pull('tasks', null, 10);
      return {a, b, t, missing:[...R.missing], log:LOG.filter(e=>/0005_subtasks/.test(e.m)).length}; });
    check('adapter_missing_table', x.a.length===0 && x.b.length===0 && x.t.length===0 && x.missing.join()==='subtasks' && x.log===1, x);
    await ctx.close(); }
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
