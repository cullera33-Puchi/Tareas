require('./lib/out.js'); // outputs (screenshots, downloads) go to tests/out
// Decision 48c (Responsable), the list of contacts and the length of the hour blocks (R20), approved on 4 November. Ports 10880 to 10899.
// Screenshots in tests/out/RC.
//  1. SQL: supabase/migrations/0011_contacts.sql run twice in PGlite after 0001 to 0010: tasks.responsible, the table contacts and its
//     columns, the write trigger "newest modified wins", the rules by owner, realtime, no rights for anon; a deletion mark with no name is
//     taken. Then all.sql run twice on a fresh database and check.sql: every row OK, the three new rows among them.
//  2. iPhone, clock at Wednesday 4 November 2026 9:00 (light and dark): the responsible in grey on the rows, with and without Esperando a;
//     the Responsable row of the detail (sheet with the field focused, suggestions as typed, a chip sets it, a new name makes a contact,
//     Deshacer takes both back); the long press menu; the chip filter by responsible, with the project filter (both apply); search;
//     Enviar recordatorio by WhatsApp, mail or the share sheet (window.open, the mailto link and navigator.share stubbed), the two people
//     of a task, the selection bar's Recordar with one message for every title; Esperando a making contacts (not a reason); Ajustes,
//     Contactos: edit, rename cascading to the tasks with Deshacer, delete keeping the tasks' names with Deshacer, a new contact.
//  3. Desktop (light and dark): the tag in the title cell beside Esperando a, the inspector's Responsable popover, the right button menu,
//     the pop-up filter Responsable with Proyecto, the selection pane's Enviar recordatorio; the hours view: blocks as tall as the
//     estimate, lanes for overlapping blocks, the bottom edge dragged to each of the four values with a live preview and Deshacer, Esc
//     cancelling, a moved block keeping its estimate, the day head's hours.
//  4. Data: duplicate and the next of a series copy the responsible; share text and CSV; export, import, a local backup restored.
//  5. Sync with rm-NP's fake server, two devices: contacts and the responsible up and down (realtime), a rename reaching the other device,
//     a deleted contact marked deleted; a database without the table (logged once, contacts stay) and one without the column (logged once,
//     the responsible stays, the rest syncs, no upload loop).
const { chromium } = require('playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = path.resolve(__dirname, '..'), PORT = 10880, URL0 = 'http://localhost:'+PORT+'/';
const OUT = path.join(__dirname, 'out', 'RC'); fs.mkdirSync(OUT, {recursive:true});
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
  const mig = rd('0011_contacts.sql'), body = mig.split('\n').filter(l=>!/^\s*--/.test(l)).join('\n');
  check('sql_words', !/\bdelete\b/i.test(body.replace(/drop policy if exists \w+|for delete|on delete cascade|contacts_delete_own|select, insert, update, delete/gi,'')) && !/\bdrop\b/i.test(body.replace(/drop (policy|trigger) if exists/gi,'')));
  let db = await pgSetup();
  for(const f of ['0001_init.sql','0002_push.sql','0003_attachments.sql','0004_repeat_focus.sql','0005_subtasks.sql','0006_project_notes.sql','0007_deadline.sql','0008_estimate_postponed.sql','0009_closed_day.sql','0010_inbox.sql']) await db.exec(strip(rd(f)));
  let err = null; try { await db.exec(mig); await db.exec(mig); } catch(e){ err = e.message; }
  check('sql_runs_twice', !err, err);
  const q = async (sql, params) => (await db.query(sql, params)).rows;
  const tryq = async (sql, params) => { try { return {rows: await q(sql, params)}; } catch(e){ return {error: e.message}; } };
  const cols = await q(`select column_name, data_type, is_nullable from information_schema.columns where table_schema='public' and table_name='contacts' order by ordinal_position`);
  check('sql_columns', cols.map(c=>c.column_name+':'+c.data_type).join()==='id:text,owner_id:uuid,name:text,email:text,phone:text,created:timestamp with time zone,modified:timestamp with time zone,deleted:timestamp with time zone,server_ts:timestamp with time zone'
    && cols.filter(c=>c.is_nullable==='NO').map(c=>c.column_name).join()==='id,owner_id,modified,server_ts', cols);
  const tcol = await q(`select data_type, is_nullable from information_schema.columns where table_schema='public' and table_name='tasks' and column_name='responsible'`);
  check('sql_task_column', tcol.length===1 && tcol[0].data_type==='text' && tcol[0].is_nullable==='YES', tcol);
  const trg = await q(`select count(*)::int n from pg_trigger where tgrelid='public.contacts'::regclass and tgname='tareas_before_write'`);
  const pub = await q(`select count(*)::int n from pg_publication_tables where pubname='supabase_realtime' and tablename='contacts'`);
  const pol = await q(`select policyname from pg_policies where tablename='contacts' order by policyname`);
  check('sql_objects', trg[0].n===1 && pub[0].n===1 && pol.map(p=>p.policyname).join()==='contacts_delete_own,contacts_insert_own,contacts_select_own,contacts_update_own', {trg, pub, pol});
  const A = '00000000-0000-4000-8000-00000000000a', Bu = '00000000-0000-4000-8000-00000000000b';
  await db.exec(`insert into auth.users values ('${A}'), ('${Bu}')`);
  const as = async (uid, fn, role) => { await db.exec(`set test.uid = '${uid}'; set role ${role||'authenticated'};`); try { return await fn(); } finally { await db.exec(`reset role; reset test.uid;`); } };
  const ins = await as(A, () => tryq(`insert into public.contacts (id, name, phone, created, modified) values ('c1', 'Marta', '612 345 678', '2026-11-04T09:00:00Z', '2026-11-04T09:00:00Z') returning owner_id, server_ts`));
  check('sql_insert', ins.rows && ins.rows[0].owner_id===A && !!ins.rows[0].server_ts, ins);
  const older = await as(A, () => tryq(`update public.contacts set name = 'Viejo', modified = '2026-11-03T00:00:00Z' where id = 'c1' returning id`));
  const newer = await as(A, () => tryq(`update public.contacts set email = 'marta@example.com', modified = '2026-11-04T10:00:00Z' where id = 'c1' returning id`));
  const c1 = (await q(`select name, email from public.contacts where id = 'c1'`))[0];
  check('sql_newest_wins', older.rows && !older.rows.length && newer.rows && newer.rows.length===1 && c1.name==='Marta' && c1.email==='marta@example.com', {older, newer, c1});
  // The app's deletion mark: an upsert with only id, deleted and modified (markDeleted)
  const mark = await as(A, () => tryq(`insert into public.contacts (id, deleted, modified) values ('c1', '2026-11-04T11:00:00Z', '2026-11-04T11:00:00Z') on conflict (id) do update set deleted = excluded.deleted, modified = excluded.modified returning id`));
  check('sql_delete_mark', mark.rows && mark.rows.length===1 && (await q(`select deleted is not null d, name from public.contacts where id='c1'`))[0].name==='Marta', mark);
  const seenB = await as(Bu, () => tryq(`select id from public.contacts`));
  const anon = await as(A, () => tryq(`select id from public.contacts`), 'anon');
  const tk = await as(A, () => tryq(`insert into public.tasks (id, title, responsible, modified) values ('t1', 'Uno', 'Marta', now()) returning responsible`));
  check('sql_rls', seenB.rows && seenB.rows.length===0 && !!anon.error && tk.rows && tk.rows[0].responsible==='Marta', {seenB, anon, tk});
  await db.close();
  db = await pgSetup(); const all = strip(fs.readFileSync(path.join(ROOT, 'supabase/all.sql'), 'utf8'));
  err = null; try { await db.exec(all); await db.exec(all); } catch(e){ err = e.message; }
  check('sql_all_twice', !err && /0001 a 00\d\d/.test(all.split('\n')[0]) && (all.match(/^-- ========== migrations\//mg)||[]).length===fs.readdirSync(path.join(ROOT,'supabase/migrations')).filter(f=>f.endsWith('.sql')).length, err);
  let rows = []; try { rows = (await db.query(fs.readFileSync(path.join(ROOT, 'supabase/check.sql'), 'utf8'))).rows; } catch(e){ err = e.message; }
  check('sql_check_all_ok', rows.length>=30 && rows.every(x=>x.Estado==='OK') && rows.filter(x=>/\(0011\)/.test(x.Pieza)).length===3, {err, bad:rows.filter(x=>x.Estado!=='OK'), n:rows.length});
  await db.close();
}

/* ======================= Pages ======================= */
const NOW = new Date(2026, 10, 4, 9, 0, 0); // Wednesday 4 November 2026, 9:00 local: before the hour blocks, before 18:30
const T0 = '2026-11-03T08:00:00.000Z';
const at = (h, m) => new Date(2026, 10, 4, h, m||0).toISOString();
const tk = (id, o) => Object.assign({id, title:id, spaceId:'trabajo', projectId:null, date:'2026-11-04', reminder:null, priority:'none', status:'pending', notes:'', carried:false, created:T0, modified:T0, completed:null}, o);
const SEED = () => ({ spaces:[{id:'trabajo',name:'Trabajo',order:0,created:T0},{id:'personal',name:'Personal',order:1,created:T0}],
  projects:[{id:'p1', spaceId:'trabajo', name:'FLC', color:'#007AFF', order:0, archived:false, created:T0, modified:T0},{id:'p2', spaceId:'trabajo', name:'OCA', color:'#34C759', order:1, archived:false, created:T0, modified:T0}],
  tasks:[ tk('a1', {title:'Preparar comité', projectId:'p1', responsible:'Marta Ruiz', deadline:'2026-11-05'}),
    tk('a2', {title:'Revisar SOW', projectId:'p2', responsible:'Marta Ruiz'}),
    tk('a3', {title:'Enviar acta', projectId:'p1', status:'waiting', waitingFor:'Luis', responsible:'Marta Ruiz'}),
    tk('a4', {title:'Llamar a Pepe', projectId:'p1'}),
    tk('a5', {title:'Firma del contrato', projectId:'p2', responsible:'Ana', date:'2026-11-06'}),
    tk('h1', {title:'Comité de dirección', reminder:at(10), estimate:60}), tk('h2', {title:'Llamada rápida', reminder:at(10,30)}),
    tk('h3', {title:'Correo', reminder:at(15), estimate:15}), tk('h4', {title:'Taller', reminder:at(16), estimate:240}), tk('h5', {title:'Revisión', reminder:at(12), estimate:30}) ],
  voiceNotes:[], attachments:[], subtasks:[], projectNotes:[],
  contacts:[ {id:'c1', name:'Marta Ruiz', email:null, phone:'612 345 678', created:T0, modified:T0}, {id:'c2', name:'Luis', email:'luis@example.com', phone:null, created:T0, modified:T0} ],
  settings:{tipsSeen:true} });
// window.open, the mailto link and the share sheet, caught instead of leaving the page
function stubs(){ window.__sent=[]; window.open=(u)=>{ window.__sent.push({via:'open', u}); return null; };
  document.addEventListener('click', e=>{ const a=e.target.closest&&e.target.closest('a[href^="mailto:"]'); if(a){ e.preventDefault(); window.__sent.push({via:'mailto', u:a.getAttribute('href')}); } }, true);
  Object.defineProperty(navigator, 'share', {configurable:true, value:o=>{ window.__sent.push({via:'share', text:o.text}); return Promise.resolve(); }}); }
async function open(browser, o){
  const vp = o.desk ? {viewport:{width:1280,height:800}, deviceScaleFactor:1} : {viewport:{width:390,height:844}, deviceScaleFactor:2, isMobile:true, hasTouch:true};
  const ctx = await browser.newContext(Object.assign(vp, {colorScheme:o.theme||'light'})); const page = await ctx.newPage();
  if(o.clock!==false) await page.clock.install({time:NOW});
  page.on('pageerror', e=>errors.push(o.tag+' pageerror: '+e.message)); page.on('console', m=>{ if(m.type()==='error') errors.push(o.tag+' console: '+m.text()); });
  if(o.fake){ await page.exposeBinding('fakeServer', (src, op, a)=>o.fake.handle(src.page, op, a)); await page.addInitScript(fakeAdapter); await page.addInitScript(u=>{ window.__fakeUser=u; }, USER); }
  await page.addInitScript(stubs);
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
const menuLabels = page => ev(page, ()=>[...document.querySelectorAll('#pmenu .pm-it .pm-l')].map(b=>b.textContent));
const sent = page => ev(page, ()=>window.__sent.splice(0));
const rootRows = page => ev(page, ()=>[...document.querySelectorAll('.screen.root .scroll .row[data-id]')].filter(r=>!r.closest('.first')).map(r=>r.dataset.id).sort().join());
const deskRows = page => ev(page, ()=>[...document.querySelectorAll('#desk .main .mbody .row[data-id]')].filter(r=>!r.closest('.first')).map(r=>r.dataset.id).sort().join());
// v0.33.1: the person picker is a list (bindPersonPick): the names it shows, the checked one, a row by its name
const sugs = page => ev(page, ()=>[...document.querySelectorAll('.pplist .pprow:not(.ppnone):not(.ppadd) .ppl')].map(b=>b.textContent).join());
const ppChecked = page => ev(page, ()=>{ const r=document.querySelector('.pplist .pprow[aria-selected=true] .ppl'); return r&&r.textContent; });
const ppRow = (page, name) => page.locator('.pplist .pprow').filter({has: page.locator('.ppl', {hasText: new RegExp('^'+name+'$')})}).first();

/* ======================= 2. iPhone ======================= */
async function iphone(browser){
  const {ctx, page} = await open(browser, {tag:'M'}); let x;
  await calm(page);
  // --- The rows: grey, after the rest; both people on a waiting task; none without one
  x = await ev(page, ()=>{ const m=id=>{ const r=document.querySelector('.screen.root .scroll .row[data-id="'+id+'"]:not(.first .row)'); const e=r&&r.querySelector('.row-meta'); return e&&{text:e.textContent, resp:(e.querySelector('.resp')||{}).textContent||'', color:e.querySelector('.resp')&&getComputedStyle(e.querySelector('.resp')).color, metaColor:getComputedStyle(e).color, icon:!!(e.querySelector('.resp svg'))}; };
    return {a1:m('a1'), a3:m('a3'), a4:document.querySelector('.screen.root .row[data-id=a4] .resp')}; });
  check('i_row', x.a1 && x.a1.resp==='Marta Ruiz' && x.a1.icon && x.a1.color===x.a1.metaColor && x.a3 && /Esperando a Luis/.test(x.a3.text) && x.a3.resp==='Marta Ruiz' && !x.a4, x);
  await shot(page, 'i1-hoy');
  // --- The detail: Responsable after Recordatorio and Por confirmar; the sheet with the field focused and the suggestions
  await ev(page, ()=>openDetail('a4')); await calm(page);
  x = await ev(page, ()=>{ const s=document.querySelector('.pushed-screen.detail'); const c=s.querySelector('[data-act=pickResp]'); return {lbl:c&&c.querySelector('.lbl').textContent, val:c&&c.querySelector('.val').textContent, remind:!!s.querySelector('[data-act=sendRemind]')}; });
  check('i_detail_cell', x.lbl==='Responsable' && x.val==='Ninguno' && !x.remind, x);
  await page.tap('.pushed-screen.detail [data-act=pickResp]'); await sheetUp(page);
  x = await ev(page, ()=>({h:document.querySelector('#sheet h2').textContent, focus:document.activeElement===document.querySelector('#sheet [data-role=ppq]'), none:document.querySelector('#sheet .pprow').textContent, btns:[...document.querySelectorAll('#sheet .shead button')].map(b=>b.textContent).join()}));
  check('i_sheet', x.h==='Responsable' && x.focus && x.none==='Sin responsableLa tarea es tuya' && x.btns==='Cancelar', x);
  check('i_sug_all', await sugs(page)==='Luis,Marta Ruiz,Ana', await sugs(page)); // contacts first, then the names the tasks use
  await page.fill('#sheet [data-role=ppq]', 'MÁR'); // no accents nor case
  check('i_sug_typed', await sugs(page)==='Marta Ruiz' && await ev(page, ()=>document.querySelector('#sheet .pprow').textContent==='Añadir «MÁR»'&&!document.querySelector('#sheet .ppnone')), await sugs(page));
  await page.fill('#sheet [data-role=ppq]', 'marta ruiz'); // an exact name (any case) offers no Añadir
  check('i_exact', await ev(page, ()=>!document.querySelector('#sheet .ppadd') && document.querySelectorAll('#sheet .pprow').length===1));
  await shot(page, 'i2-resp-sheet');
  await page.fill('#sheet [data-role=ppq]', 'Carmen  Vidal ');
  check('i_add_row', await ev(page, ()=>document.querySelector('#sheet .pprow').textContent==='Añadir «Carmen Vidal»'));
  await page.press('#sheet [data-role=ppq]', 'Enter'); await sheetGone(page); await calm(page);
  x = await ev(page, ()=>({r:task('a4').responsible, c:DB.contacts.filter(c=>c.name==='Carmen Vidal').length, val:document.querySelector('.pushed-screen.detail [data-act=pickResp] .val').textContent}));
  check('i_set_new', x.r==='Carmen Vidal' && x.c===1 && x.val==='Carmen Vidal' && await toastText(page)==='Responsable: Carmen Vidal', x);
  await page.tap('#toastBtn'); await calm(page);
  check('i_set_undo', await ev(page, ()=>task('a4').responsible===null && !DB.contacts.some(c=>c.name==='Carmen Vidal')));
  await page.tap('.pushed-screen.detail [data-act=pickResp]'); await sheetUp(page);
  await ppRow(page, 'Luis').tap(); await sheetGone(page); await calm(page);
  check('i_set_chip', await ev(page, ()=>task('a4').responsible==='Luis' && DB.contacts.length===2 && !!document.querySelector('.pushed-screen.detail [data-act=sendRemind]')));
  await shot(page, 'i3-detail');
  // A different case and accents take the contact's spelling; empty clears
  await ev(page, ()=>setResponsible('a4', 'marta ruíz')); check('i_canonical', await ev(page, ()=>task('a4').responsible==='Marta Ruiz' && DB.contacts.length===2));
  await ev(page, ()=>setResponsible('a4', '  ')); check('i_clear', await ev(page, ()=>task('a4').responsible===null));
  await ev(page, ()=>{ setResponsible('a4', 'Luis'); render(); }); await hideToast(page);
  await page.tap('.pushed-screen.detail [data-act=back]'); await calm(page);
  // --- The long press menu
  await ev(page, ()=>rowMenu('a2')); await menuSettled(page);
  x = await menuLabels(page); check('i_menu', x.includes('Responsable') && x.includes('Enviar recordatorio') && x.indexOf('Responsable')===x.indexOf('Tiempo')+1, x);
  await menuItem(page, 'Responsable').click(); await sheetUp(page);
  check('i_menu_sheet', await ppChecked(page)==='Marta Ruiz', await ppChecked(page));
  await page.tap('#sheet [data-x=cancel]'); await sheetGone(page);
  x = await ev(page, ()=>{ rowMenu('a4'); return null; }); await menuSettled(page);
  check('i_menu_luis', (await menuLabels(page)).includes('Enviar recordatorio'));
  await ev(page, ()=>closeMenu(true));
  // --- The filter: the chip first, a menu of names, combined with the project filter
  x = await ev(page, ()=>{ const c=document.querySelector('.screen.root .pchips .chip'); return c&&{first:c.classList.contains('rchip'), text:c.textContent}; });
  check('i_chip', x && x.first && x.text==='Responsable', x);
  await page.tap('.screen.root .pchips .rchip'); await menuSettled(page);
  check('i_chip_menu', (await menuLabels(page)).join()==='Todos,Ana,Luis,Marta Ruiz', await menuLabels(page));
  await menuItem(page, 'Marta Ruiz').click(); await calm(page);
  check('i_filter', await rootRows(page)==='a1,a2,a3' && await ev(page, ()=>UI.respFilter==='Marta Ruiz' && document.querySelector('.screen.root .rchip.on').textContent==='Marta Ruiz'), await rootRows(page));
  await page.tap('.screen.root .pchips [data-pf=p1]'); await calm(page);
  check('i_filter_and', await rootRows(page)==='a1,a3', await rootRows(page));
  await shot(page, 'i4-filter');
  await ev(page, ()=>{ UI.projFilter='p2'; UI.respFilter='Luis'; render(); }); await calm(page);
  x = await ev(page, ()=>({t:(document.querySelector('.screen.root .empty b')||{}).textContent, b:!!document.querySelector('.screen.root .empty [data-pf=""]')}));
  check('i_filter_empty', x.t==='Nada de OCA para Luis' && x.b, x);
  await page.tap('.screen.root .empty [data-pf=""]'); await calm(page);
  check('i_filter_clear', await ev(page, ()=>UI.projFilter===null && UI.respFilter===null));
  // --- Search finds the responsible
  await page.fill('.screen.root [data-role=search]', 'marta'); await until(page, ()=>UI.query==='marta' && !document.querySelector('.screen.root .row[data-id=h1]')); await calm(page);
  check('i_search', await rootRows(page)==='a1,a2,a3', await rootRows(page));
  await page.tap('.screen.root [data-act=clearSearch]'); await calm(page);
  // --- Enviar recordatorio: WhatsApp with the phone (+34 for a Spanish number), the message editable
  await ev(page, ()=>openDetail('a1')); await calm(page);
  await page.tap('.pushed-screen.detail [data-act=sendRemind]'); await sheetUp(page);
  x = await ev(page, ()=>({h:document.querySelector('#sheet h2').textContent, msg:document.querySelector('#sheet [data-role=rmsg]').value, via:document.querySelector('#sheet .rvia').textContent, to:(document.querySelector('#sheet .rto')||{}).textContent}));
  check('i_remind_sheet', x.h==='Enviar recordatorio' && x.msg==='Hola Marta,\n\nTe recuerdo esta tarea:\n\n• Preparar comité (FLC, entrega mañana)\n\nGracias.' && x.via==='Por WhatsApp a 612 345 678' && x.to==='Para Marta Ruiz', x);
  await shot(page, 'i5-remind');
  await page.fill('#sheet [data-role=rmsg]', 'Hola Marta, ¿cómo va el comité?');
  await page.tap('#sheet [data-x=ok]'); await sheetGone(page);
  x = await sent(page); check('i_remind_wa', x.length===1 && x[0].via==='open' && x[0].u==='https://wa.me/34612345678?text='+encodeURIComponent('Hola Marta, ¿cómo va el comité?'), x);
  check('i_remind_log', await ev(page, ()=>LOG.some(e=>e.m==='Recordatorio enviado'&&/wa/.test(e.x||''))));
  await page.tap('.pushed-screen.detail [data-act=back]'); await calm(page);
  // Two people: whom to send it to; mail with the email (subject and body)
  await ev(page, ()=>remindSheet(['a3'])); await sheetUp(page);
  x = await ev(page, ()=>({who:[...document.querySelectorAll('#sheet [data-who]')].map(b=>b.textContent+(b.classList.contains('on')?'*':'')).join(), msg:document.querySelector('#sheet [data-role=rmsg]').value}));
  check('i_remind_two', x.who==='Marta Ruiz*,Luis' && x.msg==='Hola Marta,\n\nTe recuerdo esta tarea:\n\n• Enviar acta (FLC)\n\nGracias.', x); // a waiting task's date is its review day: not said
  await page.tap('#sheet [data-who="Luis"]');
  x = await ev(page, ()=>({msg:document.querySelector('#sheet [data-role=rmsg]').value, via:document.querySelector('#sheet .rvia').textContent}));
  check('i_remind_switch', x.msg==='Hola Luis,\n\nTe recuerdo esta tarea:\n\n• Enviar acta (FLC)\n\nGracias.' && x.via==='Por correo a luis@example.com', x);
  await page.tap('#sheet [data-x=ok]'); await sheetGone(page);
  x = await sent(page); check('i_remind_mail', x.length===1 && x[0].via==='mailto' && x[0].u==='mailto:luis@example.com?subject='+encodeURIComponent('Recordatorio: Enviar acta')+'&body='+encodeURIComponent('Hola Luis,\n\nTe recuerdo esta tarea:\n\n• Enviar acta (FLC)\n\nGracias.'), x);
  // No phone or email: the share sheet
  await ev(page, ()=>remindSheet(['a5'])); await sheetUp(page);
  x = await ev(page, ()=>({msg:document.querySelector('#sheet [data-role=rmsg]').value, via:document.querySelector('#sheet .rvia').textContent}));
  check('i_remind_share_sheet', x.msg==='Hola Ana,\n\nTe recuerdo esta tarea:\n\n• Firma del contrato (OCA, para el viernes 6)\n\nGracias.' && x.via==='Con la hoja de compartir', x);
  await page.tap('#sheet [data-x=ok]'); await sheetGone(page);
  x = await sent(page); check('i_remind_share', x.length===1 && x[0].via==='share' && x[0].text==='Hola Ana,\n\nTe recuerdo esta tarea:\n\n• Firma del contrato (OCA, para el viernes 6)\n\nGracias.', x);
  // --- The selection: Recordar only when every task has the same person, one message for all
  await ev(page, ()=>startSelect('a1')); await calm(page);
  check('i_sel_one', await ev(page, ()=>!!document.querySelector('#selbar [data-act=bulkRemind]')));
  await page.tap('.screen.root .row[data-id=a2]'); await page.tap('.screen.root .row[data-id=a4]');
  check('i_sel_mixed', await ev(page, ()=>UI.select.ids.size===3 && !document.querySelector('#selbar [data-act=bulkRemind]')));
  await page.tap('.screen.root .row[data-id=a4]');
  await shot(page, 'i6-select');
  await page.tap('#selbar [data-act=bulkRemind]'); await sheetUp(page);
  x = await ev(page, ()=>document.querySelector('#sheet [data-role=rmsg]').value);
  check('i_sel_text', x==='Hola Marta,\n\nTe recuerdo estas tareas:\n\n• Preparar comité (FLC, entrega mañana)\n• Revisar SOW (OCA, para hoy)\n\nGracias.', x);
  await page.tap('#sheet [data-x=ok]'); await sheetGone(page); await calm(page);
  x = await sent(page); check('i_sel_sent', x.length===1 && x[0].u.startsWith('https://wa.me/34612345678?text=') && await ev(page, ()=>UI.select===null), x);
  // --- Esperando a: the suggestions, a new name becomes a contact, a reason does not
  await ev(page, ()=>waitingSheet('a2')); await sheetUp(page);
  check('w_sug', await sugs(page)==='Luis,Marta Ruiz,Ana', await sugs(page));
  await page.fill('#sheet [data-role=ppq]', 'Notaría'); await page.tap('#sheet [data-x=ok]'); await sheetGone(page); await calm(page);
  x = await ev(page, ()=>({w:task('a2').waitingFor, c:DB.contacts.filter(c=>c.name==='Notaría').length, t:document.querySelector('#toastText').textContent}));
  check('w_contact', x.w==='Notaría' && x.c===1 && /esperando a Notaría/.test(x.t), x);
  await page.tap('#toastBtn'); await calm(page);
  check('w_undo', await ev(page, ()=>task('a2').status==='pending' && !DB.contacts.some(c=>c.name==='Notaría')));
  await ev(page, ()=>{ setWaiting('a2', 'la respuesta del banco de España'); }); check('w_reason', await ev(page, ()=>DB.contacts.length===2 && task('a2').waitingFor==='la respuesta del banco de España'));
  await ev(page, ()=>{ unWait('a2'); setWaiting('a2', 'luis'); }); check('w_canonical', await ev(page, ()=>task('a2').waitingFor==='Luis' && DB.contacts.length===2));
  await ev(page, ()=>{ unWait('a2'); render(); }); await hideToast(page); await calm(page);
  // --- Ajustes, Contactos
  await page.tap('.tabbar [data-tab=ajustes]'); await calm(page);
  x = await ev(page, ()=>{ const g=document.querySelector('.screen.root[data-root=ajustes] .group.contacts'); return g&&{rows:[...g.querySelectorAll('[data-contact]')].map(b=>b.querySelector('.lbl').textContent+':'+b.querySelector('.val').textContent).join('|'), add:!!g.querySelector('[data-act=newContact]'), title:g.previousElementSibling.textContent}; });
  check('s_list', x && x.rows==='Luis:luis@example.com|Marta Ruiz:612 345 678' && x.add && x.title==='Contactos', x);
  await ev(page, ()=>{ document.querySelector('.screen.root[data-root=ajustes] .group.contacts').scrollIntoView({block:'center'}); }); await sleep(200);
  await shot(page, 'i7-ajustes');
  await page.tap('.screen.root[data-root=ajustes] [data-contact=c1]'); await sheetUp(page);
  x = await ev(page, ()=>({h:document.querySelector('#sheet h2').textContent, n:document.querySelector('#sheet [data-role=cname]').value, p:document.querySelector('#sheet [data-role=cphone]').value, hint:document.querySelector('#sheet .hint').textContent}));
  check('s_sheet', x.h==='Editar contacto' && x.n==='Marta Ruiz' && x.p==='612 345 678' && x.hint==='Lo usan 3 tareas. Si cambias el nombre, cambia también en ellas.', x); // a1, a2 and a3
  await shot(page, 'i8-contact');
  await page.fill('#sheet [data-role=cname]', 'Marta R.'); await page.fill('#sheet [data-role=cemail]', 'marta@example.com'); await page.tap('#sheet [data-x=ok]'); await sheetGone(page); await calm(page);
  x = await ev(page, ()=>({c:contactRec('c1'), r:['a1','a2','a3'].map(id=>task(id).responsible).join(), t:document.querySelector('#toastText').textContent}));
  check('s_rename', x.c.name==='Marta R.' && x.c.email==='marta@example.com' && x.r==='Marta R.,Marta R.,Marta R.' && x.t==='Contacto renombrado en 3 tareas', x);
  await page.tap('#toastBtn'); await calm(page);
  x = await ev(page, ()=>({c:contactRec('c1'), r:['a1','a2','a3'].map(id=>task(id).responsible).join()}));
  check('s_rename_undo', x.c.name==='Marta Ruiz' && !x.c.email && x.r==='Marta Ruiz,Marta Ruiz,Marta Ruiz', x);
  // A rename of the person waited for, and one to a name another contact has
  await ev(page, ()=>{ saveContact(contactRec('c2'), {name:'Luis Pons', email:'luis@example.com', phone:null}); }); check('s_rename_wait', await ev(page, ()=>task('a3').waitingFor==='Luis Pons' && task('a4').responsible==='Luis Pons'));
  await ev(page, ()=>{ undoFn(); render(); }); await calm(page);
  await page.tap('.screen.root[data-root=ajustes] [data-contact=c2]'); await sheetUp(page);
  await page.fill('#sheet [data-role=cname]', 'marta ruiz'); await page.tap('#sheet [data-x=ok]');
  check('s_dup_name', await ev(page, ()=>document.querySelector('#sheet').classList.contains('on') && document.querySelector('#toastText').textContent==='Ya hay un contacto con ese nombre'));
  // Delete: confirmation, the tasks keep the name, Deshacer
  await page.tap('#sheet [data-x=del]'); await until(page, ()=>document.querySelector('#asheet').classList.contains('on')); await sleep(500);
  x = await ev(page, ()=>document.querySelector('#asheet .t').textContent);
  check('s_del_text', x==='"Luis" se eliminará de tus contactos. Las 2 tareas que lo usan conservan el nombre. Podrás deshacerlo durante unos segundos.', x);
  await page.locator('#asheet .it.red').click(); await calm(page);
  check('s_deleted', await ev(page, ()=>!contactRec('c2') && task('a3').waitingFor==='Luis' && task('a4').responsible==='Luis' && !document.querySelector('[data-contact=c2]')));
  await page.tap('#toastBtn'); await calm(page);
  check('s_del_undo', await ev(page, ()=>!!contactRec('c2') && !!document.querySelector('[data-contact=c2]')));
  // A new contact
  await page.tap('.screen.root[data-root=ajustes] [data-act=newContact]'); await sheetUp(page);
  check('s_new_focus', await ev(page, ()=>document.activeElement===document.querySelector('#sheet [data-role=cname]') && document.querySelector('#sheet h2').textContent==='Nuevo contacto'));
  await page.fill('#sheet [data-role=cname]', 'Sofía'); await page.fill('#sheet [data-role=cphone]', '+44 7700 900123'); await page.tap('#sheet [data-x=ok]'); await sheetGone(page); await calm(page);
  check('s_new', await ev(page, ()=>{ const c=contactByName('sofia'); return !!c && c.phone==='+44 7700 900123' && waDigits(c.phone)==='447700900123' && !!document.querySelector('[data-contact="'+c.id+'"]'); }));
  await ctx.close();
  // Dark theme: the rows, the detail, the reminder sheet and Ajustes
  { const {ctx, page} = await open(browser, {tag:'MD', theme:'dark'}); await calm(page); await shot(page, 'i9-hoy-dark');
    await ev(page, ()=>openDetail('a3')); await calm(page); await shot(page, 'i10-detail-dark');
    await ev(page, ()=>remindSheet(['a3'])); await sheetUp(page); await shot(page, 'i11-remind-dark'); await ev(page, ()=>closeSheet()); await sheetGone(page);
    await page.tap('.pushed-screen.detail [data-act=back]'); await calm(page);
    await page.tap('.tabbar [data-tab=ajustes]'); await calm(page); await ev(page, ()=>{ document.querySelector('.screen.root[data-root=ajustes] .group.contacts').scrollIntoView({block:'center'}); }); await sleep(200); await shot(page, 'i12-ajustes-dark');
    await ctx.close(); }
}

/* ======================= 3. Desktop ======================= */
async function desktop(browser){
  const {ctx, page} = await open(browser, {tag:'D', desk:true}); let x;
  await ev(page, ()=>setDeskView('hoy')); await calm(page);
  // --- The tags in the title cell: the responsible beside Esperando a, the title keeping its room
  x = await ev(page, ()=>{ const row=id=>document.querySelector('#desk .main .row[data-id="'+id+'"]:not(.first .row)'); const b=e=>e&&Math.round(e.getBoundingClientRect().width);
    const r1=row('a1'), r3=row('a3'), r4=row('a4'); return {t1:r1.querySelector('.rtag').textContent, tip:r1.querySelector('.rtag').title, w1:b(r1.querySelector('.rtag')), wt:b(r3.querySelector('.wtag')), rt:b(r3.querySelector('.rtag')), title:b(r3.querySelector('.row-title')), none:!r4.querySelector('.rtag')}; });
  check('d_tags', x.t1==='Marta Ruiz' && x.tip==='Responsable: Marta Ruiz' && x.w1>40 && x.wt>30 && x.rt>40 && x.title>60 && x.none, x);
  await shot(page, 'd1-hoy');
  // --- The inspector: Responsable, a popover with the suggestions, Intro sets it
  await page.click('#desk .main .row[data-id=a4]:not(.first .row) .row-title'); await until(page, ()=>!!document.querySelector('#desk .pane [data-act=pickResp]'));
  x = await ev(page, ()=>{ const l=[...document.querySelectorAll('#desk .pane .iform .ilbl')].map(e=>e.textContent); return {has:l.includes('Responsable'), val:document.querySelector('#desk .pane [data-act=pickResp] .val').textContent, remind:!!document.querySelector('#desk .pane [data-act=sendRemind]')}; });
  check('d_insp', x.has && x.val==='Ninguno' && !x.remind, x);
  await page.click('#desk .pane [data-act=pickResp]'); await menuSettled(page);
  check('d_pop', await ev(page, ()=>document.activeElement===document.querySelector('#pmenu [data-role=ppq]') && Math.round(document.querySelector('#pmenu .pp-pop').getBoundingClientRect().width)===280) && await sugs(page)==='Luis,Marta Ruiz,Ana');
  await page.keyboard.type('Pepa'); await until(page, ()=>!document.querySelector('#pmenu .pprow:not(.ppadd)') && document.querySelector('#pmenu .pprow.hl.ppadd'));
  await shot(page, 'd2-insp-pop');
  await page.keyboard.press('Enter'); await until(page, ()=>!menuOpen()); await calm(page);
  x = await ev(page, ()=>({r:task('a4').responsible, c:!!contactByName('Pepa'), val:document.querySelector('#desk .pane [data-act=pickResp] .val').textContent, remind:!!document.querySelector('#desk .pane [data-act=sendRemind]'), tag:(document.querySelector('#desk .main .row[data-id=a4] .rtag')||{}).textContent}));
  check('d_insp_set', x.r==='Pepa' && x.c && x.val==='Pepa' && x.remind && x.tag==='Pepa', x);
  await shot(page, 'd3-insp');
  await page.keyboard.press('Escape'); await calm(page);
  // --- The right button menu
  await page.click('#desk .main .row[data-id=a1]:not(.first .row) .row-title', {button:'right'}); await menuSettled(page);
  x = await menuLabels(page); check('d_menu', x.includes('Responsable…') && x.includes('Enviar recordatorio…'), x);
  await menuItem(page, 'Enviar recordatorio…').click(); await sheetUp(page);
  check('d_menu_remind', await ev(page, ()=>document.querySelector('#sheet [data-role=rmsg]').value==='Hola Marta,\n\nTe recuerdo esta tarea:\n\n• Preparar comité (FLC, entrega mañana)\n\nGracias.'));
  await shot(page, 'd4-remind');
  await page.click('#sheet [data-x=cancel]'); await sheetGone(page);
  await page.click('#desk .main .row[data-id=a4]:not(.first .row) .row-title', {button:'right'}); await menuSettled(page);
  await menuItem(page, 'Responsable…').click(); await menuSettled(page);
  check('d_menu_resp', await ppChecked(page)==='Pepa', await ppChecked(page));
  await page.click('#pmenu .ppnone'); await until(page, ()=>!menuOpen()); await calm(page);
  check('d_cleared', await ev(page, ()=>task('a4').responsible===null) && await toastText(page)==='Sin responsable');
  await page.click('#toastBtn'); await calm(page);
  // v0.33.1, the list picker with the keys: the checked row is the active one; down moves, Enter chooses and closes, with Deshacer
  await page.click('#desk .main .row[data-id=a4]:not(.first .row) .row-title', {button:'right'}); await menuSettled(page);
  await menuItem(page, 'Responsable…').click(); await menuSettled(page);
  x = await ev(page, ()=>({rows:[...document.querySelectorAll('#pmenu .pprow .ppl')].map(e=>e.textContent).join(), hl:(document.querySelector('#pmenu .pprow.hl .ppl')||{}).textContent, icons:[...document.querySelectorAll('#pmenu .pprow')].map(r=>!!r.querySelector('.ppic svg')).join()}));
  check('d_keys_list', x.rows==='Sin responsableLa tarea es tuya,Luis,Marta Ruiz,Pepa,Ana' && x.hl==='Pepa' && x.icons==='false,true,true,false,false', x);
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter'); await until(page, ()=>!menuOpen()); await calm(page);
  check('d_keys_pick', await ev(page, ()=>task('a4').responsible==='Ana') && await toastText(page)==='Responsable: Ana');
  await page.click('#toastBtn'); await calm(page);
  // Typing filters (no accents nor case); Esc closes and changes nothing
  await page.click('#desk .main .row[data-id=a4]:not(.first .row) .row-title', {button:'right'}); await menuSettled(page);
  await menuItem(page, 'Responsable…').click(); await menuSettled(page);
  await page.keyboard.type('LÚ'); await until(page, ()=>document.querySelectorAll('#pmenu .pprow').length===2);
  x = await ev(page, ()=>[...document.querySelectorAll('#pmenu .pprow')].map(r=>r.textContent+(r.classList.contains('hl')?'*':'')).join());
  check('d_filter', x==='Añadir «LÚ»*,Luis', x);
  await page.keyboard.press('ArrowDown'); await shot(page, 'd2b-list-keys');
  await page.keyboard.press('Escape'); await until(page, ()=>!menuOpen());
  check('d_esc', await ev(page, ()=>task('a4').responsible==='Pepa'));
  // Esperando a: the same list inside its popover; a click marks the name and keeps the popover for the review day and Guardar
  await ev(page, ()=>waitingSheet('a1')); await menuSettled(page);
  await ppRow(page, 'Luis').click();
  x = await ev(page, ()=>({open:menuOpen(), ck:(document.querySelector('#pmenu .pprow[aria-selected=true] .ppl')||{}).textContent, none:(document.querySelector('#pmenu .ppnone .ppl')||{}).textContent}));
  check('d_wait_pick', x.open && x.ck==='Luis' && x.none==='Sin indicarPor confirmar sin nombre', x);
  await shot(page, 'd2c-wait-list');
  await page.click('#pmenu [data-x=ok]'); await until(page, ()=>!menuOpen()); await calm(page);
  check('d_wait_saved', await ev(page, ()=>task('a1').status==='waiting' && task('a1').waitingFor==='Luis'));
  await page.click('#toastBtn'); await calm(page);
  // --- The filter: Responsable beside Proyecto, both applying
  check('d_rfdrop', await ev(page, ()=>{ const b=document.querySelector('#desk .pfslot .rfdrop'); return !!b && b.textContent==='Responsable: Todos' && b.previousElementSibling.classList.contains('pfdrop'); }));
  await page.click('#desk .pfslot .rfdrop'); await menuSettled(page);
  check('d_rf_menu', (await menuLabels(page)).join()==='Todos,Ana,Marta Ruiz,Pepa', await menuLabels(page));
  await menuItem(page, 'Marta Ruiz').click(); await until(page, ()=>!menuOpen()); await calm(page);
  check('d_filter', await deskRows(page)==='a1,a2,a3' && await ev(page, ()=>document.querySelector('#desk .rfdrop.on').textContent==='Responsable: Marta Ruiz'), await deskRows(page));
  await ev(page, ()=>{ UI.projFilter='p2'; render(); }); await calm(page);
  check('d_filter_and', await deskRows(page)==='a2', await deskRows(page));
  await shot(page, 'd5-filter');
  x = await ev(page, ()=>{ const f=calFilter(); return DB.tasks.filter(f).map(t=>t.id).join(); }); check('d_cal_filter', x==='a2', x);
  await ev(page, ()=>{ UI.projFilter=null; UI.respFilter=null; render(); }); await calm(page);
  // --- The selection pane
  await ev(page, ()=>{ UI.dsel.ids=new Set(['a1','a2']); UI.dsel.cur=null; render(); }); await calm(page);
  check('d_multi', await ev(page, ()=>!!document.querySelector('#desk .pane.multi [data-act=bulkRemind]')));
  await page.click('#desk .pane.multi [data-act=bulkRemind]'); await sheetUp(page);
  check('d_multi_text', await ev(page, ()=>document.querySelector('#sheet [data-role=rmsg]').value.startsWith('Hola Marta,\n\nTe recuerdo estas tareas:\n\n• Preparar comité')));
  await page.click('#sheet [data-x=ok]'); await sheetGone(page); await calm(page);
  x = await sent(page); check('d_multi_sent', x.length===1 && x[0].via==='open' && await ev(page, ()=>!deskMulti()), x);
  await ev(page, ()=>{ UI.dsel.ids=new Set(['a1','a4']); render(); }); await calm(page);
  check('d_multi_mixed', await ev(page, ()=>!!document.querySelector('#desk .pane.multi') && !document.querySelector('#desk .pane.multi [data-act=bulkRemind]')));
  await ev(page, ()=>{ endSelect(); }); await calm(page);

  // --- Hours: blocks as tall as the estimate, lanes, the bottom edge
  await ev(page, ()=>{ DB.settings.calMode='hours'; save(); setDeskView('day'); }); await calm(page); await until(page, ()=>!!document.querySelector('#desk .hcol .wcard.hb[data-id=h1]'));
  const hb = () => ev(page, ()=>Object.fromEntries([...document.querySelectorAll('#desk .hcol .wcard.hb')].map(c=>{ const b=c.getBoundingClientRect(); return [c.dataset.id, {h:Math.round(b.height), w:Math.round(b.width), x:Math.round(b.left), y:Math.round(b.top), cls:c.className}]; })));
  x = await hb();
  check('h_heights', x.h1.h===42 && x.h2.h===20 && x.h3.h===9 && x.h4.h===174 && x.h5.h===20 && /short/.test(x.h3.cls) && /tall/.test(x.h4.cls), x);
  check('h_lanes', Math.abs(x.h1.w-x.h2.w)<=1 && x.h2.x>=x.h1.x+x.h1.w-1 && x.h5.w>x.h1.w*1.8, x); // 10:00 for an hour and 10:30: side by side; 12:00 alone: the full width
  x = await ev(page, ()=>{ const h=document.querySelector('#desk .dh .wh'); return h&&h.textContent; }); check('h_dayhead', x==='5 h 45', x); // 60 + 15 + 240 + 30: the day head adds the estimates (a block without one counts none)
  await ev(page, ()=>document.querySelector('#desk .wcard.hb[data-id=h5]').scrollIntoView({block:'center'})); await sleep(200);
  await shot(page, 'd6-hours');
  check('h_cursor', await ev(page, ()=>getComputedStyle(document.querySelector('#desk .wcard.hb[data-id=h5] .hbr')).cursor==='ns-resize'));
  // Drag the bottom edge of h5 (30 min): to 1 h with a live preview, then Deshacer; to 15 min; to medio día; Esc cancels
  const edge = async id => { const b=await ev(page, id=>{ const c=document.querySelector('#desk .wcard.hb[data-id="'+id+'"]'); c.scrollIntoView({block:'center'}); const r=c.getBoundingClientRect(); return {x:r.left+r.width/2, y:r.bottom-1}; }, id); return b; };
  let p = await edge('h5'); await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.mouse.move(p.x, p.y+12, {steps:3}); await page.mouse.move(p.x, p.y+22, {steps:3});
  x = await ev(page, ()=>{ const c=document.querySelector('#desk .wcard.hb[data-id=h5]'); return {h:Math.round(c.getBoundingClientRect().height), lbl:c.querySelector('.hbd').textContent, on:c.classList.contains('resizing'), shown:getComputedStyle(c.querySelector('.hbd')).display}; });
  check('h_preview', x.h===42 && x.lbl==='1 h' && x.on && x.shown==='block', x);
  await shot(page, 'd7-resize');
  await page.mouse.up(); await calm(page);
  x = {e:await ev(page, ()=>task('h5').estimate), t:await toastText(page), h:(await hb()).h5.h, open:await ev(page, ()=>!UI.deskDetail)};
  check('h_to_60', x.e===60 && x.t==='Tiempo estimado: 1 h' && x.h===42 && x.open, x);
  await page.click('#toastBtn'); await calm(page);
  check('h_undo', await ev(page, ()=>task('h5').estimate===30) && (await hb()).h5.h===20);
  p = await edge('h5'); await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.mouse.move(p.x, p.y-9, {steps:4}); await page.mouse.up(); await calm(page);
  check('h_to_15', await ev(page, ()=>task('h5').estimate===15) && (await hb()).h5.h===9, await ev(page, ()=>task('h5').estimate));
  p = await edge('h5'); await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.mouse.move(p.x, p.y+200, {steps:6}); await page.mouse.up(); await calm(page);
  check('h_to_240', await ev(page, ()=>task('h5').estimate===240) && (await hb()).h5.h===174, await ev(page, ()=>task('h5').estimate));
  p = await edge('h5'); await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.mouse.move(p.x, p.y-150, {steps:6}); await page.mouse.up(); await calm(page);
  check('h_to_30', await ev(page, ()=>task('h5').estimate===30) && (await hb()).h5.h===20, await ev(page, ()=>task('h5').estimate));
  await hideToast(page); p = await edge('h1'); await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.mouse.move(p.x, p.y+120, {steps:5}); await page.keyboard.press('Escape'); await page.mouse.up(); await calm(page);
  x = {e:await ev(page, ()=>task('h1').estimate), h:(await hb()).h1.h, t:await toastText(page)}; check('h_esc', x.e===60 && x.h===42 && !x.t, x);
  // A block without an estimate (30 min) dragged to 30 min changes nothing; dragged to 1 h it gets one
  p = await edge('h2'); await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.mouse.move(p.x, p.y+4, {steps:2}); await page.mouse.up(); await calm(page);
  x = {e:await ev(page, ()=>task('h2').estimate), t:await toastText(page), open:await ev(page, ()=>UI.deskDetail)}; check('h_same', !x.e && !x.t && !x.open, x);
  // A move keeps its estimate (the HTML5 drag of the block, not its edge)
  { const a=await ev(page, ()=>{ const c=document.querySelector('#desk .wcard.hb[data-id=h3]'); c.scrollIntoView({block:'center'}); const r=c.getBoundingClientRect(); return {x:r.left+r.width/2, y:r.top+3}; });
    await page.$eval('#desk .hs[data-slot="2026-11-04T17:00"]', e=>e.scrollIntoView({block:'center'})); const a2=await ev(page, ()=>{ const r=document.querySelector('#desk .wcard.hb[data-id=h3]').getBoundingClientRect(); return {x:r.left+r.width/2, y:r.top+3}; });
    const z=await ev(page, ()=>{ const r=document.querySelector('#desk .hs[data-slot="2026-11-04T17:00"]').getBoundingClientRect(); return {x:r.left+r.width*0.8, y:r.top+r.height/2}; });
    await page.mouse.move(a2.x, a2.y); await page.mouse.down(); await page.mouse.move(z.x, z.y, {steps:10}); await page.mouse.move(z.x+2, z.y+1, {steps:3}); await page.mouse.up(); await calm(page); }
  x = await ev(page, ()=>({t:fmtTime(task('h3').reminder), e:task('h3').estimate}));
  check('h_move_keeps', x.t==='17:00' && x.e===15, x);
  await ev(page, ()=>{ undoFn&&undoFn(); render(); }); await calm(page);
  // The layout itself: lanes of a cluster, a block ending past 21:00 cut at the grid's end
  x = await ev(page, ts=>layoutBlocks([{id:'a', reminder:ts[0], date:'2026-11-04', estimate:60}, {id:'b', reminder:ts[1], date:'2026-11-04', estimate:15}, {id:'c', reminder:ts[2], date:'2026-11-04'}, {id:'d', reminder:ts[3], date:'2026-11-04'}].map(o=>Object.assign(o, {status:'pending'}))).map(c=>c.x.id+':'+c.col+'/'+c.k+':'+c.dur).join(' ')
    .concat(' '+blockPx(20*60+30, 240)), [at(9,0), at(9,30), at(9,45), at(10,30)]);
  check('h_layout', x==='a:0/2:60 b:1/2:15 c:1/2:30 d:0/1:30 20', x);
  await ctx.close();
  { const {ctx, page} = await open(browser, {tag:'DD', desk:true, theme:'dark'}); await ev(page, ()=>setDeskView('hoy')); await calm(page); await shot(page, 'd8-hoy-dark');
    await ev(page, ()=>{ DB.settings.calMode='hours'; save(); setDeskView('day'); }); await calm(page); await ev(page, ()=>document.querySelector('#desk .wcard.hb[data-id=h5]').scrollIntoView({block:'center'})); await sleep(200); await shot(page, 'd9-hours-dark');
    await ev(page, ()=>setDeskView('settings')); await calm(page); await ev(page, ()=>document.querySelector('#desk .group.contacts').scrollIntoView({block:'center'})); await sleep(200); await shot(page, 'd10-ajustes-dark');
    await ctx.close(); }
}

/* ======================= 4. Data ======================= */
async function dataTests(browser){
  const {ctx, page} = await open(browser, {tag:'X'}); let x;
  // Duplicate and the next of a series keep the responsible
  x = await ev(page, ()=>{ duplicateTask('a1'); const d=DB.tasks.find(t=>t.title==='Preparar comité'&&t.id!=='a1'); updTask('a2', {repeat:'D1@2026-11-04#ser1'}); completeTask('a2'); const n=DB.tasks.find(t=>t.repeat&&t.id!=='a2'&&t.status==='pending');
    return {d:d&&d.responsible, n:n&&n.responsible}; });
  check('x_copies', x.d==='Marta Ruiz' && x.n==='Marta Ruiz', x);
  await calm(page);
  // Share text and CSV
  x = await ev(page, ()=>({s:shareText('a1'), csv:csvText()}));
  check('x_share', /\nResponsable: Marta Ruiz\n/.test(x.s), x.s);
  check('x_csv', /"Esperando a";"Responsable";"Aplazada"/.test(x.csv) && /"Luis";"Marta Ruiz";/.test(x.csv), x.csv.split('\r\n').slice(0,2));
  // Export and import
  x = await ev(page, ()=>{ const ex=exportData(); const saved=JSON.stringify(ex); DB.contacts=DB.contacts.filter(c=>c.id!=='c2'); save(); const r1=importData(saved);
    return {n:ex.contacts.length, keys:Object.keys(ex.contacts[0]).sort().join(), added:r1.added, back:!!contactRec('c2')}; });
  check('x_export_import', x.n===2 && x.keys==='created,email,id,modified,name,phone' && x.added===1 && x.back, x);
  // A local backup restored brings the contacts back as they were
  x = await ev(page, async()=>{ await BK.put(todayStr()); await refreshBackups(); const snap=await BK.get(todayStr()); contactRec('c1').phone='600 000 000'; DB.contacts=DB.contacts.filter(c=>c.id!=='c2'); save(); return (snap.data.contacts||[]).length; });
  await ev(page, ()=>restoreBackup(todayStr())); await until(page, ()=>document.querySelector('#asheet').classList.contains('on')); await sleep(600);
  const rtext = await ev(page, ()=>document.querySelector('#asheet .t').textContent);
  await page.locator('#asheet button', {hasText:/^Restaurar/}).first().click(); await until(page, ()=>!!contactRec('c2'));
  check('x_backup', x===2 && /adjuntos y contactos/.test(rtext) && await ev(page, ()=>!!contactRec('c2') && contactRec('c1').phone==='612 345 678'), {x, rtext});
  await ctx.close();
}

/* ======================= 5. Sync ======================= */
const TABLES = ['spaces','projects','tasks','voice_notes','attachments','subtasks','project_notes','contacts'];
// rm-NP's in-memory server (0001's trigger and RLS). noTable: 0011 not run, so neither the table contacts nor tasks.responsible exist;
// noCol: only the column is missing
class Fake {
  constructor(o){ o=o||{}; this.noTable=!!o.noTable; this.noCol=!!(o.noCol||o.noTable); this.t={}; TABLES.forEach(x=>this.t[x]=new Map()); this.last=0; this.subs=new Map(); this.down=new Set(); this.calls=[]; this.ups=[]; }
  ts(){ this.last=Math.max(Date.now(), this.last+1); return new Date(this.last).toISOString(); }
  gone(table){ if(this.noTable&&table==='contacts'){ const e=new Error("Could not find the table 'public.contacts' in the schema cache"); e.code='PGRST205'; throw e; } }
  write(owner, table, rows){ if(!owner) throw new Error('JWT required'); this.gone(table); const ts=this.ts(), out=[], changed=[], m=this.t[table];
    rows.forEach(r=>{ if(!r.id) throw new Error('null id'); if(!r.modified) throw new Error('null value in column "modified"'); if(this.noCol&&table==='tasks'&&'responsible' in r){ const e=new Error("Could not find the 'responsible' column of 'tasks' in the schema cache"); e.code='PGRST204'; throw e; } });
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
  const base = { spaces:[{id:'trabajo',name:'Trabajo',order:0,created:T},{id:'personal',name:'Personal',order:1,created:T}], projects:[], voiceNotes:[], attachments:[], subtasks:[], projectNotes:[], settings:{tipsSeen:true},
    tasks:[ tk('q1', {title:'Uno', responsible:'Marta', created:T, modified:T}), tk('q2', {title:'Dos', status:'waiting', waitingFor:'Marta', created:T, modified:T}), tk('q3', {title:'Tres', created:T, modified:T}) ],
    contacts:[ {id:'qc1', name:'Marta', email:null, phone:'612 345 678', created:T, modified:T} ] };
  const fake = new Fake(); let x;
  const A = await open(browser, {tag:'SA', fake, seed:base, clock:false}), B = await open(browser, {tag:'SB', fake, seed:Object.assign({}, base, {tasks:[], contacts:[]}), clock:false, desk:true});
  x = await ev(A.page, ()=>({c:syncToRow('contacts', contactRec('qc1')), t:syncToRow('tasks', task('q3')), t1:syncToRow('tasks', task('q1')).responsible}));
  check('sync_row', JSON.stringify(x.c)===JSON.stringify({id:'qc1', created:T, name:'Marta', phone:'612 345 678', modified:T, deleted:null}) && !('responsible' in x.t) && x.t1==='Marta', x); // an empty responsible or email is left out: old signatures stay
  await ev(A.page, ()=>syncSignIn()); check('sync_A_first', await synced(A.page));
  check('sync_server', fake.t.contacts.size===1 && fake.t.contacts.get('qc1').phone==='612 345 678' && fake.t.tasks.get('q1').responsible==='Marta', [...fake.t.contacts.values()]);
  await ev(B.page, ()=>syncSignIn()); check('sync_B_first', await synced(B.page));
  check('sync_B_gets', await ev(B.page, ()=>!!contactRec('qc1') && task('q1').responsible==='Marta'));
  // A responsible set on A makes a contact there; both reach B through realtime
  await ev(A.page, ()=>setResponsible('q3', 'Jordi')); check('sync_A_set', await synced(A.page));
  check('sync_B_realtime', await until(B.page, ()=>task('q3')&&task('q3').responsible==='Jordi' && !!contactByName('Jordi')), await ev(B.page, ()=>({r:task('q3')&&task('q3').responsible, c:DB.contacts.map(c=>c.name)})));
  // A rename on B reaches A, tasks and contact
  await ev(B.page, ()=>saveContact(contactRec('qc1'), {name:'Marta Ruiz', email:'marta@example.com', phone:'612 345 678'})); check('sync_B_rename', await synced(B.page));
  check('sync_A_rename', await until(A.page, ()=>contactRec('qc1').name==='Marta Ruiz' && task('q1').responsible==='Marta Ruiz' && task('q2').waitingFor==='Marta Ruiz'), await ev(A.page, ()=>({c:contactRec('qc1'), r:task('q1').responsible, w:task('q2').waitingFor})));
  // A responsible cleared goes as null; a contact deleted is marked deleted and leaves the other device
  await ev(A.page, ()=>setResponsible('q1', '')); check('sync_A_clear', await synced(A.page));
  check('sync_cleared', fake.t.tasks.get('q1').responsible===null && await until(B.page, ()=>task('q1').responsible==null), fake.t.tasks.get('q1'));
  await ev(B.page, ()=>{ const c=contactByName('Jordi'); window.__jid=c.id; DB.contacts=DB.contacts.filter(o=>o!==c); save(); }); check('sync_B_delete', await synced(B.page));
  const jid = await ev(B.page, ()=>window.__jid);
  check('sync_delete', !!fake.t.contacts.get(jid).deleted && await until(A.page, ()=>!contactByName('Jordi')) && await ev(A.page, ()=>task('q3').responsible==='Jordi'), fake.t.contacts.get(jid));
  await A.ctx.close(); await B.ctx.close();
  // A database without 0011: no table, no column. Logged once each, the contacts and the responsible stay, the rest syncs, nothing loops
  const nf = new Fake({noTable:true});
  const C = await open(browser, {tag:'SC', fake:nf, seed:base, clock:false});
  await ev(C.page, ()=>syncSignIn());
  check('none_synced', await synced(C.page), await ev(C.page, ()=>({st:SY&&SY.status, err:SY&&SY.error})));
  await ev(C.page, ()=>{ setResponsible('q3', 'Pau'); updTask('q3', {title:'Tres bis'}); }); await sleep(300); await synced(C.page);
  const n1 = nf.ups.length; await sleep(3500); await synced(C.page);
  x = await ev(C.page, ()=>({c:DB.contacts.map(c=>c.name).join(), r:task('q3').responsible, q1:task('q1').responsible, warns:LOG.filter(e=>/0011_contacts/.test(e.m)).map(e=>e.m), errs:LOG.filter(e=>e.l==='error').map(e=>e.m), pend:syncCollect(true).count, missing:[...SY.remote.missing].join()}));
  check('none_tolerated', x.c==='Marta,Pau' && x.r==='Pau' && x.q1==='Marta' && x.warns.length===2 && x.warns.includes('La base de datos no tiene todavía la tabla contacts: falta 0011_contacts.sql. Los contactos se quedan en este dispositivo')
    && x.warns.includes('La base de datos no tiene todavía la columna tasks.responsible: falta 0011_contacts.sql. El responsable se queda en este dispositivo')
    && !x.errs.length && x.pend===0 && x.missing==='contacts' && nf.t.tasks.get('q3').title==='Tres bis' && !('responsible' in nf.t.tasks.get('q3')) && nf.t.contacts.size===0 && nf.ups.length===n1, {x, n1, ups:nf.ups.length});
  await C.ctx.close();
  // Only the column missing: the contacts sync, the responsible stays on the device
  const nc = new Fake({noCol:true});
  const D = await open(browser, {tag:'SD', fake:nc, seed:base, clock:false});
  await ev(D.page, ()=>syncSignIn()); check('nocol_synced', await synced(D.page));
  x = await ev(D.page, ()=>({r:task('q1').responsible, warns:LOG.filter(e=>/0011_contacts/.test(e.m)).length}));
  check('nocol_tolerated', x.r==='Marta' && x.warns===1 && nc.t.contacts.size===1 && nc.t.tasks.size===3 && [...nc.t.tasks.values()].every(t=>!('responsible' in t)), {x, tasks:[...nc.t.tasks.values()]});
  await D.ctx.close();
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
