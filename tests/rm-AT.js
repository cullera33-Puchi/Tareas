require('./lib/out.js'); // outputs (screenshots, downloads) go to tests/out
// Decision 29 (photos and recorded audio attached to tasks), port 9910 (fake Storage 9911, fake PostgREST 9912, send-reminders under Deno 9913).
//  1. SQL: supabase/migrations/0003_attachments.sql run twice in PGlite after 0001 and 0002, with stand-ins for auth, pg_cron, pg_net and Storage
//     (buckets, objects with row level security, foldername): the table, its rules, realtime, the private bucket, the per-user folder
//     policies and the purge function.
//  2. send-reminders under Deno against a fake PostgREST and Storage API: the purge removes the files of attachments deleted more than 24 hours
//     ago (or whose task was), marks the rows, is idempotent, survives a Storage failure and a database without 0003.
//  3. The app, two "devices" against an in-memory fake server (rm-S's, plus the attachments table and a fake Storage whose signed URLs are
//     served by a test HTTP server on another origin): a photo with EXIF orientation reduced and turned upright, offline capture uploaded on
//     reconnect, a recording with Chromium's fake microphone (stop, preview, save, auto stop at the limit, discard asks), the second device
//     downloads and shows them, delete with Deshacer on both devices, cascade with the task, the cache cap (LRU, never a file waiting to
//     upload), the viewer (swipe, pinch, double tap, drag down), desktop drag and drop, the paperclip, the local-only and signed-out notes,
//     export and a restored copy, and the real Supabase adapter (request shapes, a database without the table) with every request intercepted.
const { chromium } = require('playwright');
const http = require('http'); const fs = require('fs'); const path = require('path'); const crypto = require('crypto'); const { spawn } = require('child_process');
const ROOT = path.resolve(__dirname, '..'), PORT = 9910, URL0 = 'http://localhost:'+PORT+'/', STO = 9911, REST_PORT = 9912, FN_PORT = 9913;
const OUT = path.join(__dirname, 'out', 'A', 'att'); fs.mkdirSync(OUT, {recursive:true});
const PDIR = path.join(__dirname, 'out', 'P'), DEPS = path.join(ROOT, 'node_modules');
const TYPES = {'.html':'text/html','.css':'text/css','.js':'application/javascript','.webmanifest':'application/manifest+json','.png':'image/png'};
const srv = http.createServer((req,res)=>{ let p = decodeURIComponent(req.url.split('?')[0]); if(p==='/') p='/index.html';
  if(p==='/config.js'){ res.writeHead(200,{'Content-Type':'application/javascript'}); res.end('window.TAREAS_CONFIG = {"url":null,"anonKey":null};\n'); return; } // local only; the fake comes in through the adapter
  const f=path.join(ROOT,p); if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){ res.writeHead(404,{'Content-Type':'text/html'}); res.end('<h1>404</h1>'); return; }
  res.writeHead(200,{'Content-Type':TYPES[path.extname(f)]||'application/octet-stream'}); res.end(fs.readFileSync(f)); });
const r={}, fails=[], errors=[]; const check=(name, ok, info)=>{ r[name]=ok?true:(info===undefined?false:info); if(!ok) fails.push(name); };
const sleep=ms=>new Promise(res=>setTimeout(res,ms));

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
  const m1 = fs.readFileSync(path.join(ROOT, 'supabase/migrations/0001_init.sql'), 'utf8');
  const m2 = fs.readFileSync(path.join(ROOT, 'supabase/migrations/0002_push.sql'), 'utf8');
  const m3 = fs.readFileSync(path.join(ROOT, 'supabase/migrations/0003_attachments.sql'), 'utf8');
  await db.exec(m1); await db.exec(strip(m2));
  let err = null; try { await db.exec(m3); await db.exec(m3); } catch(e){ err = e.message; }
  check('sql_runs_twice', !err, err);
  const q = async (sql, params) => (await db.query(sql, params)).rows;
  const tryq = async (sql, params) => { try { return {rows: await q(sql, params)}; } catch(e){ return {error: e.message}; } };
  const A = '00000000-0000-4000-8000-00000000000a', Bu = '00000000-0000-4000-8000-00000000000b';
  await db.exec(`insert into auth.users values ('${A}'), ('${Bu}')`);
  const as = async (uid, fn) => { await db.exec(`set test.uid = '${uid}'; set role authenticated;`); try { return await fn(); } finally { await db.exec(`reset role; reset test.uid;`); } };
  const cols = await q(`select column_name from information_schema.columns where table_schema='public' and table_name='attachments' order by ordinal_position`);
  check('sql_columns', cols.map(c=>c.column_name).join()==='id,owner_id,task_id,kind,path,mime,size,width,height,duration_ms,created,modified,deleted,server_ts,purged', cols.map(c=>c.column_name).join());
  const ins = await as(A, () => tryq(`insert into public.attachments (id, task_id, kind, path, mime, size, width, height, created, modified) values ('a1','t1','photo','${A}/t1/a1.jpg','image/jpeg',1000,2048,1536,now(),'2026-11-02T10:00:00Z') returning owner_id, server_ts`));
  check('sql_insert_own', ins.rows && ins.rows[0].owner_id===A && !!ins.rows[0].server_ts, ins);
  const seenB = await as(Bu, () => tryq(`select id from public.attachments`)), seenA = await as(A, () => tryq(`select id from public.attachments`));
  check('sql_rls', seenB.rows && seenB.rows.length===0 && seenA.rows && seenA.rows.length===1, {seenA, seenB});
  const older = await as(A, () => tryq(`update public.attachments set path = 'x', modified = '2026-11-01T00:00:00Z' where id = 'a1' returning id`));
  const newer = await as(A, () => tryq(`update public.attachments set deleted = now() - interval '1 hour', modified = '2026-11-02T11:00:00Z' where id = 'a1' returning id`));
  const a1 = (await q(`select path, deleted from public.attachments where id = 'a1'`))[0];
  check('sql_newest_wins', older.rows && older.rows.length===0 && newer.rows && newer.rows.length===1 && a1.path===A+'/t1/a1.jpg' && !!a1.deleted, {older, newer, a1});
  const badKind = await as(A, () => tryq(`insert into public.attachments (id, kind, modified) values ('bad', 'video', now())`));
  check('sql_kind_check', !!badKind.error, badKind);
  const anonSel = await (async()=>{ await db.exec(`set role anon`); try { return await tryq(`select * from public.attachments`); } finally { await db.exec(`reset role`); } })();
  check('sql_anon_denied', !!anonSel.error, anonSel);
  const pub = await q(`select tablename from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'attachments'`);
  check('sql_realtime', pub.length===1, pub);
  const trg = await q(`select tgname from pg_trigger where tgrelid = 'public.attachments'::regclass and not tgisinternal`);
  check('sql_trigger', trg.length===1 && trg[0].tgname==='tareas_before_write', trg);
  const bk = await q(`select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'attachments'`);
  check('sql_bucket', bk.length===1 && bk[0].public===false && Number(bk[0].file_size_limit)===26214400 && bk[0].allowed_mime_types.join()==='image/*,audio/*', bk);
  // Storage: each user only inside the folder named after their id, only in this bucket
  await db.exec(`insert into storage.buckets (id, name) values ('other', 'other')`);
  const up = (uid, bucket, name) => as(uid, () => tryq(`insert into storage.objects (bucket_id, name, owner) values ($1, $2, $3) returning name`, [bucket, name, uid]));
  const okA = await up(A, 'attachments', A+'/t1/a1.jpg'), badA = await up(A, 'attachments', Bu+'/t1/x.jpg'), rootA = await up(A, 'attachments', 'a1.jpg'), otherA = await up(A, 'other', A+'/t1/z.jpg');
  const okB = await up(Bu, 'attachments', Bu+'/t9/b1.m4a');
  check('sql_storage_insert', okA.rows && okB.rows && !!badA.error && !!rootA.error && !!otherA.error, {okA, badA, rootA, otherA, okB});
  const selA = await as(A, () => tryq(`select name from storage.objects`)), selB = await as(Bu, () => tryq(`select name from storage.objects`));
  check('sql_storage_select', selA.rows && selA.rows.map(x=>x.name).join()===A+'/t1/a1.jpg' && selB.rows && selB.rows.map(x=>x.name).join()===Bu+'/t9/b1.m4a', {selA, selB});
  const mv = await as(A, () => tryq(`update storage.objects set name = '${Bu}/t1/a1.jpg' where name = '${A}/t1/a1.jpg' returning name`));
  const upd = await as(A, () => tryq(`update storage.objects set owner = owner where name = '${A}/t1/a1.jpg' returning name`));
  const delB = await as(Bu, () => tryq(`delete from storage.objects where name = '${A}/t1/a1.jpg' returning name`));
  check('sql_storage_update_delete', !!mv.error && upd.rows && upd.rows.length===1 && delB.rows && delB.rows.length===0, {mv, upd, delB});
  // The purge: deleted more than 24 hours ago, or the task was; never twice; only for the service role
  await db.exec(`
    insert into public.tasks (id, owner_id, title, modified, deleted) values ('td', '${A}', 'x', now(), now() - interval '2 days'), ('tl', '${A}', 'y', now(), null), ('tr', '${A}', 'z', now(), now() - interval '1 hour');
    insert into public.attachments (id, owner_id, task_id, kind, path, modified, deleted, purged) values
      ('p1', '${A}', 'tl', 'photo', 'A/tl/p1.jpg', now(), now() - interval '2 days', null),
      ('p2', '${A}', 'td', 'audio', 'A/td/p2.m4a', now(), null, null),
      ('p3', '${A}', 'tl', 'photo', 'A/tl/p3.jpg', now(), null, null),
      ('p4', '${A}', 'tl', 'photo', 'A/tl/p4.jpg', now(), now() - interval '1 hour', null),
      ('p5', '${A}', 'tr', 'photo', 'A/tr/p5.jpg', now(), null, null),
      ('p6', '${A}', 'tl', 'photo', 'A/tl/p6.jpg', now(), now() - interval '3 days', now() - interval '1 day');
  `);
  await db.exec(`set role service_role`); let pr, pr1; try { pr = await tryq(`select * from public.tareas_attachments_to_purge(50)`); pr1 = await tryq(`select * from public.tareas_attachments_to_purge(1)`); } finally { await db.exec(`reset role`); }
  check('sql_purge_rows', pr.rows && pr.rows.map(x=>x.id).join()==='p1,p2' && pr.rows[0].path==='A/tl/p1.jpg' && pr1.rows && pr1.rows.length===1 && pr1.rows[0].id==='p1', {pr, pr1}); // p1 deleted 2 days ago (first), p2's task 2 days ago; a1 and p4 an hour ago, p5's task an hour ago, p6 already purged
  const userTry = await as(A, () => tryq(`select * from public.tareas_attachments_to_purge(50)`));
  check('sql_purge_private', !!userTry.error && /permission denied/.test(userTry.error), userTry);
  await db.close();
}

/* ======================= 2. The purge in send-reminders, under Deno ======================= */
const FN = { rows:[], objects:new Set(), log:[], mode:{noRpc:false, storageFail:false}, tasksPatched:0 };
async function fnTests(){
  const KEY = 'eyJservice';
  const rest = http.createServer((req, res) => { let b=''; req.on('data', c=>b+=c); req.on('end', () => {
    const u = new URL(req.url, 'http://x'), body = b ? JSON.parse(b) : undefined; FN.log.push({method:req.method, path:u.pathname, search:u.search, body, apikey:req.headers['apikey'], auth:req.headers['authorization']});
    const send = (st, o) => { res.writeHead(st, {'Content-Type':'application/json'}); res.end(o===undefined?'':JSON.stringify(o)); };
    if (u.pathname === '/rest/v1/rpc/tareas_attachments_to_purge') {
      if (FN.mode.noRpc) return send(404, {code:'PGRST202', message:'Could not find the function public.tareas_attachments_to_purge(p_limit) in the schema cache'});
      const day = Date.now() - 864e5;
      return send(200, FN.rows.filter(x => !x.purged && ((x.deleted && Date.parse(x.deleted) < day) || (x.taskDeleted && Date.parse(x.taskDeleted) < day))).slice(0, body && body.p_limit || 50).map(x => ({id:x.id, path:x.path, deleted:x.deleted})));
    }
    if (u.pathname === '/rest/v1/tasks' && req.method === 'PATCH') { FN.tasksPatched++; return send(200, []); }
    if (u.pathname === '/rest/v1/attachments' && req.method === 'PATCH') { const ids = /^in\.\((.*)\)$/.exec(u.searchParams.get('id')||'')[1].split(',').map(s=>s.replace(/^"|"$/g,''));
      FN.rows.filter(x => ids.includes(x.id)).forEach(x => Object.assign(x, body)); res.writeHead(204); res.end(); return; }
    if (u.pathname === '/storage/v1/object/attachments' && req.method === 'DELETE') {
      if (FN.mode.storageFail) return send(500, {statusCode:'500', error:'internal', message:'storage down'});
      const gone = (body.prefixes||[]).filter(p => FN.objects.has(p)); gone.forEach(p => FN.objects.delete(p)); return send(200, gone.map(name => ({name, bucket_id:'attachments'}))); }
    send(404, {message:'no route '+u.pathname}); }); });
  await new Promise(res => rest.listen(REST_PORT, res));
  const wrapper = path.join(OUT, 'serve-fn.ts');
  fs.writeFileSync(wrapper, `(globalThis as any).TAREAS_NO_SERVE = true;\nconst m = await import('file://${ROOT}/supabase/functions/send-reminders/index.ts');\nDeno.serve({ port: ${FN_PORT}, hostname: '127.0.0.1', onListen(){ console.log('listening'); } }, m.handler);\n`);
  const deno = spawn(process.env.DENO || 'deno', ['run', '--allow-net', '--allow-env', '--allow-read', wrapper], { env: Object.assign({}, process.env, {
    SUPABASE_URL: 'http://127.0.0.1:' + REST_PORT, SUPABASE_SERVICE_ROLE_KEY: KEY, SUPABASE_ANON_KEY: 'anon-key', DENO_DIR: path.join(PDIR, 'denodir'), NO_COLOR: '1' }) });
  const st = { out:'' }; deno.stdout.on('data', d => st.out += d); deno.stderr.on('data', d => st.out += d);
  for (let i = 0; i < 300 && !/listening/.test(st.out); i++) await sleep(100);
  check('fn_started', /listening/.test(st.out), st.out.slice(-600));
  const call = async () => { const res = await fetch('http://127.0.0.1:' + FN_PORT + '/', {method:'POST', headers:{'Content-Type':'application/json'}, body:'{}'}); return {status:res.status, json:await res.json().catch(()=>null)}; };
  try {
    // Before 0003: nothing to purge, the reminders as usual
    FN.mode.noRpc = true; let c0 = await call();
    check('fn_purge_without_0003', c0.status===200 && c0.json && c0.json.due===0 && c0.json.purged===0 && !c0.json.purgeFailed && !FN.log.some(l=>l.path.startsWith('/storage')), c0);
    FN.mode.noRpc = false;
    const old = new Date(Date.now() - 2*864e5).toISOString(), recent = new Date(Date.now() - 36e5).toISOString();
    FN.rows = [ {id:'a1', path:'U/t1/a1.jpg', deleted:old}, {id:'a2', path:'U/t2/a2.m4a', deleted:null, taskDeleted:old}, {id:'a3', path:null, deleted:old},
      {id:'a4', path:'U/t1/a4.jpg', deleted:recent}, {id:'a5', path:'U/t1/a5.jpg', deleted:null} ];
    FN.objects = new Set(['U/t1/a1.jpg', 'U/t2/a2.m4a', 'U/t1/a4.jpg', 'U/t1/a5.jpg']); FN.log.length = 0;
    const c1 = await call(); const dels = FN.log.filter(l => l.method==='DELETE'), rpc = FN.log.find(l => l.path.startsWith('/rest/v1/rpc/'));
    const by = id => FN.rows.find(x => x.id===id);
    check('fn_purge_counts', c1.status===200 && c1.json.purged===3 && c1.json.files===2 && c1.json.removed===2 && c1.json.due===0, c1.json);
    check('fn_purge_storage', dels.length===1 && dels[0].body.prefixes.sort().join()==='U/t1/a1.jpg,U/t2/a2.m4a' && FN.objects.has('U/t1/a4.jpg') && FN.objects.has('U/t1/a5.jpg') && !FN.objects.has('U/t1/a1.jpg'), {dels:dels.map(d=>d.body), objects:[...FN.objects]});
    check('fn_purge_marks', !!by('a1').purged && by('a1').deleted===old && !!by('a2').purged && !!by('a2').deleted && !!by('a3').purged && !by('a4').purged && !by('a5').purged, FN.rows);
    check('fn_purge_service_role', FN.log.every(l => l.apikey===KEY && l.auth==='Bearer '+KEY) && rpc && rpc.body.p_limit===50 && FN.tasksPatched>0, FN.log.map(l=>[l.method,l.path,l.apikey]));
    FN.log.length = 0; const c2 = await call();
    check('fn_purge_idempotent', c2.json.purged===0 && !FN.log.some(l => l.method==='DELETE'), c2.json);
    // Storage fails: the rows wait for the next run, the reminders still go
    by('a4').deleted = old; FN.mode.storageFail = true; const before = FN.tasksPatched; const c3 = await call();
    check('fn_purge_storage_fail', c3.status===200 && c3.json.purgeFailed===1 && !by('a4').purged && FN.tasksPatched>before, c3.json);
    FN.mode.storageFail = false; const c4 = await call();
    check('fn_purge_retry', c4.json.purged===1 && !!by('a4').purged && !FN.objects.has('U/t1/a4.jpg'), c4.json);
    check('fn_purge_logs', /"event":"purge"/.test(st.out) && /"event":"purge-failed"/.test(st.out) && /"event":"purge-skipped"/.test(st.out), st.out.slice(-900));
  } finally { deno.kill(); rest.close(); }
}

/* ======================= 3. The app ======================= */
// rm-S's fake server, with the attachments table and a fake Storage (signed URLs served on another origin, as Supabase's are)
const TABLES = ['spaces','projects','tasks','voice_notes','attachments'];
const STORE = new Map(), TOKENS = new Map(); let downloads = [];
class Fake {
  constructor(){ this.t={}; TABLES.forEach(x=>this.t[x]=new Map()); this.last=0; this.subs=new Map(); this.down=new Set(); this.calls=[]; }
  ts(){ this.last=Math.max(Date.now(), this.last+1); return new Date(this.last).toISOString(); }
  write(owner, table, rows){ if(!owner) throw new Error('JWT required'); const ts=this.ts(), out=[], changed=[]; const m=this.t[table];
    rows.forEach(r=>{ if(!r.id||!r.modified) throw new Error('bad row'); if(table==='attachments'&&r.kind!=null&&!['photo','audio'].includes(r.kind)) throw new Error('violates check constraint kind');
      const ex=m.get(r.id); if(ex && ex.owner_id!==owner) throw new Error('rls'); });
    rows.forEach(r=>{ const ex=m.get(r.id);
      if(!ex){ const row=Object.assign({id:r.id, owner_id:owner, created:null, deleted:null}, r, {owner_id:owner, server_ts:ts}); m.set(r.id,row); out.push({id:r.id}); changed.push(row); return; }
      if(Date.parse(r.modified) < Date.parse(ex.modified)) return;
      Object.assign(ex, r, {owner_id:ex.owner_id, server_ts:ts}); out.push({id:r.id}); changed.push(ex); });
    changed.forEach(row=>this.notify(table, row)); return out; }
  notify(table, row){ const copy=JSON.parse(JSON.stringify(row));
    for(const [page, uid] of this.subs){ if(uid!==row.owner_id || this.down.has(page)) continue; setTimeout(()=>{ page.evaluate(([t,r])=>window.__fakeRT&&window.__fakeRT(t,r), [table, copy]).catch(()=>{}); }, 40); } }
  rows(owner, table){ return [...this.t[table].values()].filter(r=>r.owner_id===owner); }
  handle(page, op, a){ this.calls.push(op); if(this.down.has(page) && op!=='signIn') throw new Error('Failed to fetch'); const own=a&&a.owner;
    switch(op){
      case 'signIn': return {id:a.uid, email:a.email};
      case 'pull': { let rs=this.rows(own, a.table); if(a.after) rs=rs.filter(x=>Date.parse(x.server_ts)>Date.parse(a.after)); rs.sort((x,y)=>x.server_ts<y.server_ts?-1:x.server_ts>y.server_ts?1:x.id<y.id?-1:1); return JSON.parse(JSON.stringify(rs.slice(0,a.limit))); }
      case 'byIds': return JSON.parse(JSON.stringify(this.rows(own, a.table).filter(x=>a.ids.includes(x.id))));
      case 'upsert': return this.write(own, a.table, a.rows);
      case 'markDeleted': return this.write(own, a.table, a.items.map(x=>({id:x.id, deleted:x.ts, modified:x.ts})));
      case 'subscribe': this.subs.set(page, a.uid); return true;
      case 'unsubscribe': this.subs.delete(page); return true;
      // Storage: the folder of the owner only (0003's policies); a signed URL lasts ttl seconds
      case 'upload': { if(!own) throw new Error('JWT required'); if(a.path.split('/')[0]!==own) throw new Error('new row violates row-level security policy');
        STORE.set(a.path, {buf:Buffer.from(a.b64,'base64'), mime:a.mime, owner:own}); return {path:a.path}; }
      case 'sign': { const o=STORE.get(a.path); if(!o||o.owner!==own) throw new Error('Object not found'); const tok=crypto.randomBytes(8).toString('hex'); TOKENS.set(tok, {path:a.path, exp:Date.now()+a.ttl*1000});
        return 'http://127.0.0.1:'+STO+'/storage/v1/object/sign/attachments/'+a.path.split('/').map(encodeURIComponent).join('/')+'?token='+tok; }
    } throw new Error('op '+op); }
}
const fake = new Fake();
const stoSrv = http.createServer((req,res)=>{ const u=new URL(req.url,'http://x'), tk=TOKENS.get(u.searchParams.get('token')||''), p=decodeURIComponent(u.pathname.replace('/storage/v1/object/sign/attachments/',''));
  const h={'Access-Control-Allow-Origin':'*'}; if(!tk||tk.path!==p||tk.exp<Date.now()||!STORE.has(p)){ res.writeHead(400, Object.assign({'Content-Type':'application/json'},h)); res.end('{"error":"InvalidSignature"}'); return; }
  const o=STORE.get(p); downloads.push(p); res.writeHead(200, Object.assign({'Content-Type':o.mime},h)); res.end(o.buf); });
const USER = {uid:'9b2f6d3e-0000-4000-8000-00000000a001', email:'enric@example.com'};
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
    subscribe(uid, onRow, onStatus){ window.__fakeRT=(t,r)=>onRow(t,r); window.fakeServer('subscribe',{uid}); setTimeout(()=>onStatus('SUBSCRIBED'),0); return ()=>{ window.__fakeRT=null; window.fakeServer('unsubscribe',{}); }; },
    async fileUpload(path, blob, mime){ if(!navigator.onLine) throw new TypeError('Failed to fetch');
      const b64=await new Promise((res,rej)=>{ const rd=new FileReader(); rd.onload=()=>res(String(rd.result).split(',')[1]||''); rd.onerror=()=>rej(rd.error); rd.readAsDataURL(blob); });
      window.__uploads=(window.__uploads||0)+1; return call('upload', {owner:owner(), path, b64, mime}); },
    fileUrl:(path, ttl)=>call('sign', {owner:owner(), path, ttl})
  };
}
const today=(()=>{ const d=new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); })();
const T0='2026-11-01T10:00:00.000Z';
const tk=(id,title,o)=>Object.assign({id,title,spaceId:'trabajo',projectId:null,date:today,reminder:null,priority:'none',status:'pending',notes:'',carried:false,created:T0,modified:T0,completed:null}, o||{});
const SEED = { spaces:[{id:'trabajo',name:'Trabajo',order:0,created:T0},{id:'personal',name:'Personal',order:1,created:T0}], projects:[], voiceNotes:[],
  tasks:[tk('t1','Preparar comité'), tk('t2','Revisar SOW'), tk('t3','Llamar a Marta')], settings:{tipsSeen:true} };
async function device(browser, o){
  const vp = o.desk ? {viewport:{width:1280,height:800}, deviceScaleFactor:1} : {viewport:{width:390,height:844}, deviceScaleFactor:2, isMobile:true, hasTouch:true};
  const ctx = await browser.newContext(Object.assign(vp, {colorScheme:o.dark?'dark':'light', permissions:['microphone']})); const page = await ctx.newPage();
  page.on('pageerror', e=>errors.push(o.tag+' pageerror: '+e.message)); page.on('console', m=>{ if(m.type()==='error'&&!/Failed to fetch|ERR_INTERNET_DISCONNECTED/.test(m.text())) errors.push(o.tag+' console: '+m.text()); });
  if(o.fake){ await page.exposeBinding('fakeServer', (src, op, a)=>fake.handle(src.page, op, a)); await page.addInitScript(fakeAdapter); await page.addInitScript(u=>{ window.__fakeUser=u; }, USER); }
  await page.addInitScript(s=>{ if(!localStorage.getItem('tareas-v1')) localStorage.setItem('tareas-v1', s); }, JSON.stringify(o.seed||SEED));
  await page.goto(URL0); await page.waitForTimeout(600); return {ctx, page, cdp:o.desk?null:await ctx.newCDPSession(page)};
}
const until = async (page, fn, arg, ms=8000)=>{ const t0=Date.now(); for(;;){ let v=false; try{ v=await page.evaluate(fn, arg); }catch(e){} if(v) return true; if(Date.now()-t0>ms) return false; await page.waitForTimeout(100); } };
const synced = page => until(page, ()=>SY&&SY.user&&!SY.running&&SY.status==='ok'&&syncCollect(true).count===0&&!UQ.running&&!DB.attachments.some(a=>!a.path));
async function touchDrag(cdp, page, pts, n, gap){ // pts: one or two [x0,y0,x1,y1]
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:pts.map((p,i)=>({x:p[0],y:p[1],id:i}))});
  for(let k=1;k<=n;k++){ await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:pts.map((p,i)=>({x:p[0]+(p[2]-p[0])*k/n, y:p[1]+(p[3]-p[1])*k/n, id:i}))}); await page.waitForTimeout(gap); }
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]}); }
const tapAt = (cdp, x, y) => cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]}).then(()=>cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]}));
const box = (page, sel) => page.evaluate(s=>{ const e=document.querySelector(s); if(!e) return null; e.scrollIntoView({block:'center'}); const q=e.getBoundingClientRect(); return {x:q.x, y:q.y, w:q.width, h:q.height, cx:q.x+q.width/2, cy:q.y+q.height/2}; }, sel);
const DET = '.screen.pushed-screen.detail';
// A camera photo: 3000 by 1000 as stored, left half red and right half blue, with EXIF orientation 6 (turn 90 degrees clockwise to show it)
async function exifPhoto(page){ const b64 = await page.evaluate(async()=>{ const c=document.createElement('canvas'); c.width=3000; c.height=1000; const g=c.getContext('2d'); g.fillStyle='#f00'; g.fillRect(0,0,1500,1000); g.fillStyle='#00f'; g.fillRect(1500,0,1500,1000);
    const bl=await new Promise(res=>c.toBlob(res,'image/jpeg',0.9)); const u=new Uint8Array(await bl.arrayBuffer()); let s=''; for(let i=0;i<u.length;i++) s+=String.fromCharCode(u[i]); return btoa(s); });
  const jpg=Buffer.from(b64,'base64'), exif=Buffer.from([0xFF,0xE1,0x00,0x22, 0x45,0x78,0x69,0x66,0x00,0x00, 0x4D,0x4D,0x00,0x2A,0x00,0x00,0x00,0x08, 0x00,0x01, 0x01,0x12,0x00,0x03,0x00,0x00,0x00,0x01,0x00,0x06,0x00,0x00, 0x00,0x00,0x00,0x00]);
  return Buffer.concat([jpg.slice(0,2), exif, jpg.slice(2)]); }
async function pngPhoto(page, w, h, color){ const b64=await page.evaluate(async([w,h,color])=>{ const c=document.createElement('canvas'); c.width=w; c.height=h; const g=c.getContext('2d'); g.fillStyle=color; g.fillRect(0,0,w,h); g.fillStyle='#fff'; g.fillRect(w/4,h/4,w/2,h/2);
    const bl=await new Promise(res=>c.toBlob(res,'image/png')); const u=new Uint8Array(await bl.arrayBuffer()); let s=''; for(let i=0;i<u.length;i++) s+=String.fromCharCode(u[i]); return btoa(s); }, [w,h,color]); return Buffer.from(b64,'base64'); }
async function addPhoto(page, buf, name, mime){ const [fc]=await Promise.all([page.waitForEvent('filechooser'), page.click(DET+' [data-act=attPhoto]')]);
  await fc.setFiles({name, mimeType:mime, buffer:buf}); }
const atts = (page, kind) => page.evaluate(k=>DB.attachments.filter(a=>!k||a.kind===k).map(a=>Object.assign({}, a)), kind);

async function appTests(browser){
  await new Promise(res=>stoSrv.listen(STO, res));
  /* ---------- A (iPhone) signs in; a photo taken offline ---------- */
  const A = await device(browser, {tag:'A', fake:true});
  await A.page.click('[data-tab=ajustes]'); await A.page.waitForTimeout(300); await A.page.click('[data-act=signIn]'); check('A_signedIn', await synced(A.page));
  await A.page.click('[data-tab=tareas]'); await A.page.waitForTimeout(300);
  fake.down.add(A.page); await A.ctx.setOffline(true); await A.page.waitForTimeout(200);
  await A.page.evaluate(()=>openDetail('t1')); await A.page.waitForTimeout(700);
  await addPhoto(A.page, await exifPhoto(A.page), 'IMG_0001.jpg', 'image/jpeg');
  check('photo_added', await until(A.page, ()=>DB.attachments.length===1 && document.querySelectorAll('.screen.pushed-screen.detail .att-ph img[src]').length===1));
  let [p1] = await atts(A.page,'photo');
  const px = await A.page.evaluate(async id=>{ const b=await FS.getFile(id), m=await FS.meta(id), th=await FS.getThumb(id); const bm=await createImageBitmap(b, {imageOrientation:'none'}); const c=document.createElement('canvas'); c.width=bm.width; c.height=bm.height; const g=c.getContext('2d'); g.drawImage(bm,0,0);
    const at=(x,y)=>[...g.getImageData(x,y,1,1).data].slice(0,3); const tb=await createImageBitmap(th);
    return {w:bm.width, h:bm.height, top:at(340,400), bottom:at(340,1650), type:b.type, size:b.size, meta:m, thumb:[tb.width, tb.height]}; }, p1.id);
  check('photo_downscaled_upright', p1.width===683 && p1.height===2048 && px.w===683 && px.h===2048 && px.type==='image/jpeg' && p1.mime==='image/jpeg' && p1.size===px.size, {p1, px});
  check('photo_orientation_pixels', px.top[0]>200 && px.top[2]<60 && px.bottom[2]>200 && px.bottom[0]<60, px); // the left (red) half of the stored image is the top once turned
  check('photo_thumb', px.thumb[0]===320 && px.thumb[1]===960 && px.meta.tsize>0, px.thumb);
  check('photo_pending_offline', !p1.path && px.meta.pending===true && !STORE.size && !(await A.page.evaluate(()=>window.__uploads||0)), {p1, meta:px.meta});
  check('photo_note_offline', (await A.page.evaluate(()=>(document.querySelector('.screen.pushed-screen.detail .att-note')||{}).textContent))==='Se subirán a tu cuenta al volver la conexión.');
  await addPhoto(A.page, await pngPhoto(A.page, 1200, 900, '#0a0'), 'plano.png', 'image/png');
  check('photo2_added', await until(A.page, ()=>DB.attachments.length===2));
  const p2 = (await atts(A.page,'photo'))[1];
  check('photo2_small_kept_size', p2.width===1200 && p2.height===900 && p2.mime==='image/jpeg', p2);
  await A.page.screenshot({path:path.join(OUT,'a-light-detail-offline.png')});
  /* ---------- back online: both upload, then their records sync ---------- */
  fake.down.delete(A.page); await A.ctx.setOffline(false);
  check('upload_on_reconnect', await synced(A.page));
  const srvRows=[...fake.t.attachments.values()];
  check('upload_storage', STORE.size===2 && [p1,p2].every(p=>STORE.has(USER.uid+'/t1/'+p.id+'.jpg')) && STORE.get(USER.uid+'/t1/'+p1.id+'.jpg').mime==='image/jpeg', [...STORE.keys()]);
  check('upload_rows', srvRows.length===2 && srvRows.every(x=>x.task_id==='t1'&&x.kind==='photo'&&x.path===USER.uid+'/t1/'+x.id+'.jpg'&&x.mime==='image/jpeg'&&x.width&&x.height&&x.size>0&&x.duration_ms===null&&!x.deleted), srvRows);
  check('upload_meta', await A.page.evaluate(async ids=>{ for(const id of ids){ const m=await FS.meta(id); if(!m||m.pending) return false; } return true; }, [p1.id,p2.id]));
  check('upload_logged', await A.page.evaluate(()=>LOG.filter(e=>e.m==='Foto subida').length===2 && LOG.filter(e=>e.m==='Foto añadida').length===2));
  check('upload_note_gone', await until(A.page, ()=>!document.querySelector('.screen.pushed-screen.detail .att-note')));

  /* ---------- A records audio with the fake microphone ---------- */
  await A.page.click(DET+' [data-act=attAudio]'); await A.page.waitForTimeout(600);
  const s0 = await A.page.evaluate(()=>({title:document.querySelector('.sheet h2').textContent, ok:document.querySelector('.sheet .hbtn.ok').disabled, hint:document.querySelector('.rec-hint').textContent}));
  check('rec_sheet', s0.title==='Grabar audio' && s0.ok && s0.hint==='Toca para grabar. Hasta 10 minutos.', s0);
  await A.page.click('.sheet .recbtn'); await A.page.waitForTimeout(1700);
  const s1 = await A.page.evaluate(()=>({on:document.querySelector('.recbtn').classList.contains('on'), t:document.querySelector('.rec-time').textContent, hint:document.querySelector('.rec-hint').textContent}));
  check('rec_recording', s1.on && s1.t==='0:01' && s1.hint==='Grabando. Toca para parar.', s1);
  await A.page.screenshot({path:path.join(OUT,'a-light-recording.png')});
  await A.page.click('.sheet .recbtn'); await A.page.waitForTimeout(700);
  const s2 = await A.page.evaluate(()=>({on:document.querySelector('.recbtn').classList.contains('on'), prev:!document.querySelector('.rec-prev').hidden, ok:document.querySelector('.sheet .hbtn.ok').disabled, dur:document.querySelector('.rec-prev .au-dur').textContent}));
  check('rec_stopped_preview', !s2.on && s2.prev && !s2.ok && s2.dur==='0:02', s2);
  await A.page.click('.rec-prev .au-play'); await A.page.waitForTimeout(500);
  check('rec_preview_plays', await A.page.evaluate(()=>document.querySelector('.rec-prev').classList.contains('playing')));
  await A.page.screenshot({path:path.join(OUT,'a-light-recorded.png')});
  await A.page.click('.sheet .hbtn.ok'); await A.page.waitForTimeout(300);
  check('rec_saved', await until(A.page, ()=>DB.attachments.some(a=>a.kind==='audio') && !document.querySelector('#sheet').classList.contains('on')));
  let [au] = await atts(A.page,'audio');
  check('rec_record', au.mime==='audio/mp4' /* m4a first on every browser since the release (iPhone plays it) */ && au.durationMs>1300 && au.durationMs<2600 && au.size>500 && au.taskId==='t1', au);
  check('rec_uploaded', await synced(A.page) && STORE.has(USER.uid+'/t1/'+au.id+'.m4a') && fake.t.attachments.get(au.id).duration_ms===au.durationMs, [...STORE.keys()]);
  check('rec_mic_released', await A.page.evaluate(()=>LOG.some(e=>e.m==='Grabación iniciada'&&/mp4/.test(e.x||'')) && LOG.some(e=>e.m==='Audio grabado')));
  // Discarding a recording asks first (decision 28b)
  await A.page.click(DET+' [data-act=attAudio]'); await A.page.waitForTimeout(600); await A.page.click('.sheet .recbtn'); await A.page.waitForTimeout(900); await A.page.click('.sheet .recbtn'); await A.page.waitForTimeout(500);
  await A.page.click('.sheet .hbtn[data-x=cancel]'); await A.page.waitForTimeout(600);
  const ask = await A.page.evaluate(()=>({on:document.querySelector('#asheet').classList.contains('on'), t:(document.querySelector('#asheet .t')||{}).textContent, b:[...document.querySelectorAll('#asheet .it')].map(x=>x.textContent)}));
  check('rec_discard_asks', ask.on && ask.t==='La grabación no se ha guardado.' && ask.b.join('|')==='Descartar grabación|Seguir editando', ask);
  await A.page.click('#asheet .it.red'); await A.page.waitForTimeout(700);
  check('rec_discarded', await A.page.evaluate(()=>!document.querySelector('#sheet').classList.contains('on') && DB.attachments.filter(a=>a.kind==='audio').length===1));
  // The limit stops it by itself
  await A.page.evaluate(()=>{ REC_MAX_MS=1200; }); await A.page.click(DET+' [data-act=attAudio]'); await A.page.waitForTimeout(600); await A.page.click('.sheet .recbtn'); await A.page.waitForTimeout(2400);
  const s3 = await A.page.evaluate(()=>({on:document.querySelector('.recbtn').classList.contains('on'), t:document.querySelector('.rec-time').textContent, hint:document.querySelector('.rec-hint').textContent, prev:!document.querySelector('.rec-prev').hidden}));
  check('rec_auto_stop', !s3.on && s3.t==='0:01' && s3.hint==='Grabación detenida al llegar a 0 minutos. Escúchala y guárdala.' && s3.prev, s3); // the test limit is 1.2 s
  await A.page.click('.sheet .hbtn[data-x=cancel]'); await A.page.waitForTimeout(500); await A.page.click('#asheet .it.red'); await A.page.waitForTimeout(600); await A.page.evaluate(()=>{ REC_MAX_MS=10*60*1000; });
  // Playing a recording of the detail
  await A.page.click(DET+' .att-au .au-play'); await A.page.waitForTimeout(800);
  const pl = await A.page.evaluate(()=>({id:AP.id, playing:!!document.querySelector('.att-au.playing'), paused:AP.el&&AP.el.paused, bar:(document.querySelector('.att-au .au-bar i')||{style:{}}).style.transform}));
  check('audio_plays', pl.id && pl.playing && pl.paused===false && /scaleX\(0\.[1-9]/.test(pl.bar), pl);
  await A.page.click(DET+' .att-au .au-play'); await A.page.waitForTimeout(200);
  check('audio_pauses', await A.page.evaluate(()=>AP.el.paused && !document.querySelector('.att-au.playing')));
  // Swipe left on the recording: Eliminar, with Deshacer
  { const b=await box(A.page, DET+' .att-au'); await touchDrag(A.cdp, A.page, [[b.x+b.w-30, b.cy, b.x+b.w-160, b.cy]], 8, 16); await A.page.waitForTimeout(500);
    const open = await A.page.evaluate(()=>{ const e=document.querySelector('.screen.pushed-screen.detail .att-au'); return e.dataset.open==='l' && getComputedStyle(e.querySelector('.vn-bg.r')).display==='block'; });
    await A.page.screenshot({path:path.join(OUT,'a-light-audio-swipe.png')});
    await A.page.click(DET+' .att-au [data-aact=del]'); await A.page.waitForTimeout(500);
    const gone = await A.page.evaluate(()=>!DB.attachments.some(a=>a.kind==='audio') && !document.querySelector('.screen.pushed-screen.detail .att-au') && document.querySelector('#toastText').textContent==='Audio eliminado');
    await A.page.click('#toastBtn'); await A.page.waitForTimeout(500);
    check('audio_swipe_delete_undo', open && gone && await A.page.evaluate(()=>DB.attachments.some(a=>a.kind==='audio') && !!document.querySelector('.screen.pushed-screen.detail .att-au')), {open, gone}); }
  check('A_settled', await synced(A.page));
  await A.page.screenshot({path:path.join(OUT,'a-light-detail.png')});

  /* ---------- the paperclip in the rows ---------- */
  await A.page.evaluate(()=>pop()); await A.page.waitForTimeout(700);
  const clip = await A.page.evaluate(()=>{ const has=id=>{ const r=document.querySelector('.screen.root:not(.hidden-tab) .row[data-id="'+id+'"] .inds'); return !!r&&r.innerHTML.includes('M20.5 11.5'); }; return {t1:has('t1'), t2:has('t2')}; });
  check('clip_iphone', clip.t1 && !clip.t2, clip);
  await A.page.screenshot({path:path.join(OUT,'a-light-list-clip.png')});

  /* ---------- B (desktop): signs in, downloads on demand and shows them ---------- */
  const B = await device(browser, {tag:'B', fake:true, desk:true});
  await B.page.evaluate(()=>setDeskView('settings')); await B.page.waitForTimeout(300); await B.page.click('[data-act=signIn]'); check('B_signedIn', await synced(B.page));
  check('B_rows', await B.page.evaluate(()=>DB.attachments.length===3 && DB.attachments.every(a=>a.path)));
  await B.page.evaluate(()=>setDeskView('hoy')); await B.page.waitForTimeout(400);
  check('clip_desktop', await B.page.evaluate(()=>{ const r=document.querySelector('#desk .row[data-id="t1"] .inds'); const r2=document.querySelector('#desk .row[data-id="t2"] .inds'); return !!r&&r.innerHTML.includes('M20.5 11.5')&&!r2.innerHTML.includes('M20.5 11.5'); }));
  downloads=[]; await B.page.evaluate(()=>openDetail('t1'));
  check('B_thumbs', await until(B.page, ()=>document.querySelectorAll('#desk .pane .att-ph img[src]').length===2 && !document.querySelector('#desk .pane .att-ph.wait')));
  check('B_downloaded_signed', downloads.length===2 && downloads.every(p=>p.startsWith(USER.uid+'/t1/')), downloads);
  check('B_cached', await B.page.evaluate(async()=>{ for(const a of DB.attachments.filter(x=>x.kind==='photo')){ const m=await FS.meta(a.id), t=await FS.getThumb(a.id); if(!m||!m.file||m.pending||!t) return false; } return LOG.filter(e=>e.m==='Foto descargada').length===2; }));
  await B.page.click('#desk .pane .att-au .au-play'); await B.page.waitForTimeout(900);
  check('B_audio_download_play', downloads.length===3 && await B.page.evaluate(()=>!!AP.id&&!AP.el.paused), downloads);
  await B.page.click('#desk .pane .att-au .au-play'); await B.page.waitForTimeout(200);
  await B.page.screenshot({path:path.join(OUT,'b-desk-inspector.png')});
  // A click on a recording (not its button) offers its menu at the pointer
  { const bb=await box(B.page, '#desk .pane .att-au .au-name'); await B.page.mouse.click(bb.cx, bb.cy); await B.page.waitForTimeout(300);
    const items = await B.page.evaluate(()=>[...document.querySelectorAll('#pmenu [role=menuitem], #pmenu button')].map(x=>x.textContent.trim()).filter(Boolean));
    check('B_audio_menu', items.some(t=>/Eliminar audio/.test(t)) && items.some(t=>/Reproducir/.test(t)), items); await B.page.keyboard.press('Escape'); await B.page.waitForTimeout(200); }

  /* ---------- Delete with Deshacer, seen on both devices ---------- */
  await A.page.evaluate(()=>openDetail('t1')); await A.page.waitForTimeout(700);
  await A.page.click(DET+' .att-ph'); await A.page.waitForTimeout(600);
  check('viewer_open', await A.page.evaluate(()=>!!VW && VW.i===0 && document.querySelector('.viewer .vw-n').textContent==='1 de 2' && document.querySelector('.viewer').classList.contains('on')));
  check('viewer_full_loaded', await until(A.page, ()=>{ const im=document.querySelector('.viewer .vw-slide[data-vw-id="'+VW.ids[0]+'"] .vw-img'); return !!im&&im.src===fuGet(VW.ids[0],'f')&&VW.blobs.has(VW.ids[0]); }));
  await A.page.screenshot({path:path.join(OUT,'a-viewer.png')});
  await A.page.click('.viewer [data-vw=del]'); await A.page.waitForTimeout(400);
  check('viewer_delete', await A.page.evaluate(id=>!DB.attachments.some(a=>a.id===id) && VW && VW.ids.length===1 && document.querySelector('.viewer .vw-n').textContent==='1 de 1' && document.querySelector('#toastText').textContent==='Foto eliminada', p1.id));
  check('delete_server', await synced(A.page) && !!fake.t.attachments.get(p1.id).deleted);
  check('delete_B', await until(B.page, id=>!DB.attachments.some(a=>a.id===id) && document.querySelectorAll('#desk .pane .att-ph').length===1, p1.id), 'B kept the photo');
  await A.page.click('#toastBtn'); await A.page.waitForTimeout(300);
  check('undo_server', await synced(A.page) && fake.t.attachments.get(p1.id).deleted===null);
  check('undo_B', await until(B.page, id=>DB.attachments.some(a=>a.id===id) && document.querySelectorAll('#desk .pane .att-ph img[src]').length===2, p1.id), 'B did not get the photo back');
  check('undo_no_reupload', STORE.size===3); // the file was never removed: Deshacer only brings the record back
  await A.page.evaluate(()=>closeViewer(true)); await A.page.waitForTimeout(300);

  /* ---------- The viewer: swipe, pinch, double tap, drag down ---------- */
  await A.page.click(DET+' .att-ph'); await A.page.waitForTimeout(700);
  await touchDrag(A.cdp, A.page, [[320, 420, 80, 425]], 6, 16); await A.page.waitForTimeout(600);
  const sw = await A.page.evaluate(()=>({i:VW.i, n:document.querySelector('.viewer .vw-n').textContent, tr:document.querySelector('.vw-track').style.transform}));
  check('viewer_swipe', sw.i===1 && sw.n==='2 de 2' && /translate3d\(-410px/.test(sw.tr), sw);
  await touchDrag(A.cdp, A.page, [[80, 420, 300, 420]], 4, 16); await A.page.waitForTimeout(600);
  check('viewer_swipe_back', await A.page.evaluate(()=>VW.i===0));
  await touchDrag(A.cdp, A.page, [[170, 420, 120, 380], [220, 440, 290, 500]], 8, 16); await A.page.waitForTimeout(500);
  const z = await A.page.evaluate(()=>({s:VW.s, t:document.querySelector('.viewer .vw-slide[data-vw-id="'+VW.ids[0]+'"] .vw-img').style.transform}));
  check('viewer_pinch_zoom', z.s>2 && z.s<=6 && /scale\([2-6]\./.test(z.t), z);
  await A.page.screenshot({path:path.join(OUT,'a-viewer-zoom.png')});
  await touchDrag(A.cdp, A.page, [[200, 420, 240, 300]], 5, 16); await A.page.waitForTimeout(400); // zoomed: a drag pans, it does not close or change photo
  check('viewer_pan', await A.page.evaluate(()=>!!VW && VW.i===0 && VW.s>2));
  await tapAt(A.cdp, 200, 420); await A.page.waitForTimeout(120); await tapAt(A.cdp, 200, 420); await A.page.waitForTimeout(500);
  check('viewer_double_tap', await A.page.evaluate(()=>!!VW && VW.s===1 && VW.tx===0 && VW.ty===0));
  await touchDrag(A.cdp, A.page, [[200, 300, 205, 600]], 6, 16); await A.page.waitForTimeout(600);
  check('viewer_drag_down_closes', await A.page.evaluate(()=>!VW && !document.querySelector('.viewer')));

  /* ---------- The cache: past the cap the least recently used files go, never one waiting to upload ---------- */
  const capB = await B.page.evaluate(async ps=>{ // B holds three downloaded files; the oldest use is the second photo
    const order=[ps[1], ps[0]]; let t=1000; for(const id of order){ await FS.tx(['meta'],'readwrite',m=>{ const rq=m.get(id); rq.onsuccess=()=>{ rq.result.used=t; m.put(rq.result); }; }); t+=1000; }
    const all=await FS.allMeta(), total=all.reduce((n,m)=>n+(m.file?m.size:0)+(m.tsize||0),0), big=all.find(m=>m.id===ps[1]);
    FILE_CAP=total-1; await FS.evict(); const after=await FS.allMeta();
    const st=Object.fromEntries(after.map(m=>[m.id, {file:m.file, t:m.tsize>0}])); const total2=await FS.total(); FILE_CAP=200*1024*1024;
    return {st, total, total2, big:big.size, thumb:!!(await FS.getThumb(ps[1])), logged:LOG.some(e=>e.m==='Caché de adjuntos')}; }, [p1.id, p2.id]);
  check('cache_lru', capB.st[p2.id].file===false && capB.st[p2.id].t && capB.st[p1.id].file===true && capB.thumb && capB.total2<=capB.total-capB.big && capB.logged, capB);
  // Shown again, the file evicted comes back through a new signed URL
  downloads=[]; await B.page.evaluate(()=>{ const ph=[...document.querySelectorAll('#desk .pane .att-ph')]; ph[1].click(); }); await B.page.waitForTimeout(900);
  check('cache_redownload', downloads.length===1 && downloads[0].endsWith(p2.id+'.jpg') && await B.page.evaluate(id=>!!VW&&VW.blobs.has(id), p2.id), downloads);
  await B.page.screenshot({path:path.join(OUT,'b-desk-viewer.png')});
  await B.page.keyboard.press('ArrowLeft'); await B.page.waitForTimeout(300);
  check('viewer_desk_keys', await B.page.evaluate(()=>VW&&VW.i===0));
  await B.page.keyboard.press('Escape'); await B.page.waitForTimeout(500);
  check('viewer_desk_escape', await B.page.evaluate(()=>!VW && UI.deskDetail==='t1'));
  // A: a file waiting to upload is never evicted, even with a cap of one byte
  fake.down.add(A.page); await A.ctx.setOffline(true); await A.page.waitForTimeout(200);
  await addPhoto(A.page, await pngPhoto(A.page, 400, 300, '#a0a'), 'p3.png', 'image/png'); await until(A.page, ()=>DB.attachments.filter(a=>a.kind==='photo').length===3);
  const capA = await A.page.evaluate(async()=>{ const p=DB.attachments.find(a=>!a.path); FILE_CAP=1; await FS.evict(); const ms=await FS.allMeta(); FILE_CAP=200*1024*1024;
    return {pend:ms.find(m=>m.id===p.id), others:ms.filter(m=>m.id!==p.id).map(m=>m.file)}; });
  check('cache_never_pending', capA.pend && capA.pend.file && capA.pend.pending && capA.others.length>=3 && capA.others.every(f=>f===false), capA);
  fake.down.delete(A.page); await A.ctx.setOffline(false); check('A_pending_uploaded', await synced(A.page));

  /* ---------- Desktop: a photo dragged from the computer onto the inspector ---------- */
  const png64 = (await pngPhoto(B.page, 2400, 1800, '#08f')).toString('base64');
  const dd = await B.page.evaluate(async b64=>{ const bin=atob(b64), u=new Uint8Array(bin.length); for(let i=0;i<bin.length;i++) u[i]=bin.charCodeAt(i);
    const dt=new DataTransfer(); dt.items.add(new File([u], 'escaneo.png', {type:'image/png'})); const pn=document.querySelector('#desk .pane[data-task]'), tgt=pn.querySelector('.ifoot')||pn;
    tgt.dispatchEvent(new DragEvent('dragenter', {dataTransfer:dt, bubbles:true, cancelable:true}));
    const ov=new DragEvent('dragover', {dataTransfer:dt, bubbles:true, cancelable:true}); tgt.dispatchEvent(ov); const lit=pn.classList.contains('filedrop');
    const n0=DB.attachments.length, ids=DB.attachments.map(a=>a.id); tgt.dispatchEvent(new DragEvent('drop', {dataTransfer:dt, bubbles:true, cancelable:true}));
    return {lit, prevented:ov.defaultPrevented, n0, ids, unlit:!pn.classList.contains('filedrop')}; }, png64);
  check('drop_accepts', dd.lit && dd.prevented && dd.unlit, {lit:dd.lit, prevented:dd.prevented, unlit:dd.unlit});
  check('drop_added', await until(B.page, ids=>{ const a=DB.attachments.find(x=>!ids.includes(x.id)&&x.width===2048&&x.height===1536); if(!a) return false; const im=document.querySelector('#desk .pane .att-ph[data-att="'+a.id+'"] img'); return !!im&&!!im.getAttribute('src'); }, dd.ids)); // A's third photo may arrive meanwhile
  const dp = await B.page.evaluate(ids=>DB.attachments.find(x=>!ids.includes(x.id)&&x.width===2048&&x.height===1536)||{}, dd.ids);
  check('drop_photo', dp.kind==='photo' && dp.width===2048 && dp.height===1536 && dp.taskId==='t1', dp);
  check('drop_uploaded_and_A', await synced(B.page) && STORE.has(USER.uid+'/t1/'+dp.id+'.jpg') && await until(A.page, id=>DB.attachments.some(a=>a.id===id), dp.id));
  check('drop_elsewhere_ignored', await B.page.evaluate(()=>{ const dt=new DataTransfer(); dt.items.add(new File(['x'], 'x.png', {type:'image/png'})); const el=document.querySelector('#desk .main'); const ev=new DragEvent('drop', {dataTransfer:dt, bubbles:true, cancelable:true}); el.dispatchEvent(ev); return ev.defaultPrevented; }));
  const notImg = await B.page.evaluate(async()=>{ const n=DB.attachments.length; const r=await addPhotos('t1', [new File(['hola'], 'nota.txt', {type:'text/plain'})]); return {r, same:DB.attachments.length===n, toast:document.querySelector('#toastText').textContent}; });
  check('drop_not_image', notImg.r===0 && notImg.same && notImg.toast==='Solo se pueden añadir fotos', notImg);

  /* ---------- Cascade: deleting the task takes its attachments, Deshacer brings them back, on both devices ---------- */
  await A.page.evaluate(()=>{ pop(); }); await A.page.waitForTimeout(700);
  const nAtt = await A.page.evaluate(()=>DB.attachments.length);
  await A.page.evaluate(()=>deleteTask('t1')); await A.page.waitForTimeout(200);
  check('cascade_local', await A.page.evaluate(()=>!task('t1') && DB.attachments.length===0));
  check('cascade_server', await synced(A.page) && !!fake.t.tasks.get('t1').deleted && [...fake.t.attachments.values()].every(x=>!!x.deleted), [...fake.t.attachments.values()].map(x=>x.deleted));
  check('cascade_B', await until(B.page, ()=>!task('t1') && DB.attachments.length===0), 'B kept them');
  await A.page.click('#toastBtn'); await A.page.waitForTimeout(300);
  check('cascade_undo', await synced(A.page) && await A.page.evaluate(n=>!!task('t1') && DB.attachments.length===n, nAtt) && !fake.t.tasks.get('t1').deleted && [...fake.t.attachments.values()].every(x=>x.deleted===null));
  check('cascade_undo_B', await until(B.page, n=>!!task('t1') && DB.attachments.length===n, nAtt), 'B did not get them back');

  /* ---------- Export and a restored copy ---------- */
  const ex = await A.page.evaluate(()=>{ const d=exportData(); return {n:(d.attachments||[]).length, keys:Object.keys(d.attachments[0]||{}).sort().join()}; });
  check('export_list', ex.n===nAtt && ex.keys==='created,durationMs,height,id,kind,mime,modified,path,size,taskId,width', ex);
  await A.page.evaluate(async()=>{ await dailyBackup(true); });
  const gone = await A.page.evaluate(()=>{ const a=DB.attachments.find(x=>x.kind==='audio'); deleteAttachment(a.id); return a.id; }); await synced(A.page);
  check('restore_before', !!fake.t.attachments.get(gone).deleted);
  await A.page.evaluate(()=>{ UI.tab='ajustes'; render(); restoreBackup(todayStr()); }); await A.page.waitForTimeout(700);
  const rtext = await A.page.evaluate(()=>(document.querySelector('#asheet .t')||{}).textContent||'');
  await A.page.click('#asheet .it.red'); await A.page.waitForTimeout(800);
  check('restore_brings_back', /notas de voz y adjuntos/.test(rtext) && await A.page.evaluate(id=>DB.attachments.some(a=>a.id===id), gone) && await synced(A.page) && fake.t.attachments.get(gone).deleted===null, rtext);
  check('restore_B', await until(B.page, id=>DB.attachments.some(a=>a.id===id), gone));
  await A.page.evaluate(()=>{ UI.tab='tareas'; render(); });

  /* ---------- Signed out, and without config: the attachments stay on the device and say so ---------- */
  const C = await device(browser, {tag:'C', fake:true});
  await C.page.evaluate(()=>openDetail('t2')); await C.page.waitForTimeout(700);
  await addPhoto(C.page, await pngPhoto(C.page, 300, 300, '#f80'), 'c.png', 'image/png'); await until(C.page, ()=>DB.attachments.length===1);
  const cn = await C.page.evaluate(()=>(document.querySelector('.screen.pushed-screen.detail .att-note')||{}).textContent);
  check('signedout_note', cn==='Se guardan en este iPhone y se subirán a tu cuenta al iniciar sesión.' && !(await C.page.evaluate(()=>window.__uploads||0)), cn);
  await C.page.screenshot({path:path.join(OUT,'c-signedout.png')});
  await C.page.evaluate(()=>pop()); await C.page.waitForTimeout(600); await C.page.click('[data-tab=ajustes]'); await C.page.waitForTimeout(300); await C.page.click('[data-act=signIn]');
  const cid = await C.page.evaluate(()=>DB.attachments[0].id);
  check('signedout_then_upload', await synced(C.page) && STORE.has(USER.uid+'/t2/'+cid+'.jpg') && fake.t.attachments.has(cid));
  await C.ctx.close();
  const N = await device(browser, {tag:'N', dark:true});
  await N.page.evaluate(()=>openDetail('t3')); await N.page.waitForTimeout(700);
  await addPhoto(N.page, await pngPhoto(N.page, 800, 600, '#5ac'), 'n.png', 'image/png'); await until(N.page, ()=>DB.attachments.length===1);
  await N.page.evaluate(()=>{ const id=DB.attachments[0].id; DB.attachments.push({id:'n-au', taskId:'t3', kind:'audio', path:null, mime:'audio/webm', size:1, width:null, height:null, durationMs:65000, created:new Date().toISOString(), modified:new Date().toISOString()}); save(); render(); });
  await N.page.waitForTimeout(400);
  const nn = await N.page.evaluate(()=>(document.querySelector('.screen.pushed-screen.detail .att-note')||{}).textContent);
  check('noconfig_note', nn==='Los adjuntos se guardan solo en este iPhone.' && await N.page.evaluate(()=>SY===null), nn);
  await N.page.screenshot({path:path.join(OUT,'n-dark-detail.png')});
  await N.page.click(DET+' [data-act=attAudio]'); await N.page.waitForTimeout(700); await N.page.screenshot({path:path.join(OUT,'n-dark-recorder.png')});
  await N.ctx.close();

  /* ---------- The real Supabase adapter: request shapes, and a database without the table (every request intercepted) ---------- */
  { const ctx = await browser.newContext(); const page = await ctx.newPage(); const reqs=[];
    page.on('pageerror', e=>errors.push('R pageerror: '+e.message));
    await page.route('https://fakeref.supabase.co/**', route=>{ const q=route.request(), u=new URL(q.url()); reqs.push({m:q.method(), p:u.pathname, h:q.headers(), body:(()=>{ try{ const b=q.postDataBuffer(); return b?b.toString('latin1').slice(0,600):null; }catch(e){ return null; } })()});
      const j=(st,o)=>route.fulfill({status:st, contentType:'application/json', headers:{'Access-Control-Allow-Origin':'*'}, body:JSON.stringify(o)});
      if(q.method()==='OPTIONS') return route.fulfill({status:204, headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*','Access-Control-Allow-Methods':'*'}});
      if(u.pathname==='/rest/v1/attachments') return j(404, {code:'PGRST205', details:null, hint:null, message:"Could not find the table 'public.attachments' in the schema cache"});
      if(u.pathname.startsWith('/rest/v1/')) return j(200, []);
      if(u.pathname.startsWith('/storage/v1/object/sign/')) return j(200, {signedURL:'/object/sign/attachments/u1/t1/a1.jpg?token=abc'});
      if(u.pathname.startsWith('/storage/v1/object/')) return j(200, {Key:'attachments/u1/t1/a1.jpg', Id:'x'});
      return j(404, {}); });
    await page.goto(URL0); await page.waitForTimeout(500);
    const out = await page.evaluate(async()=>{ const R=supabaseRemote({url:'https://fakeref.supabase.co', anonKey:'anon-key'}); await R.init();
      const att=await R.pull('attachments', null, 10), tasks=await R.pull('tasks', null, 10);
      await R.fileUpload('u1/t1/a1.jpg', new Blob(['abc'], {type:'image/jpeg'}), 'image/jpeg'); const url=await R.fileUrl('u1/t1/a1.jpg', 300);
      return {att, tasks, missing:[...R.missing], url, log:LOG.filter(e=>/0003_attachments/.test(e.m)).length}; });
    const upReq=reqs.find(x=>x.m==='POST'&&x.p==='/storage/v1/object/attachments/u1/t1/a1.jpg'), signReq=reqs.find(x=>x.p==='/storage/v1/object/sign/attachments/u1/t1/a1.jpg');
    check('adapter_missing_table', out.att.length===0 && out.tasks.length===0 && out.missing.join()==='attachments' && out.log===1, out);
    check('adapter_upload_shape', !!upReq && upReq.h['x-upsert']==='true' && /multipart\/form-data/.test(upReq.h['content-type']||'') && /31536000/.test(upReq.body||'') && /Content-Type: image\/jpeg/.test(upReq.body||'') && upReq.h['apikey']==='anon-key', upReq); // a Blob goes as a form: cacheControl and the file part with its type
    check('adapter_signed_url', !!signReq && /"expiresIn":300/.test(signReq.body||'') && out.url==='https://fakeref.supabase.co/storage/v1/object/sign/attachments/u1/t1/a1.jpg?token=abc', {signReq, url:out.url});
    await ctx.close(); }

  // Dark detail with everything on A
  await A.page.emulateMedia({colorScheme:'dark'}); await A.page.evaluate(()=>openDetail('t1')); await A.page.waitForTimeout(900);
  await A.page.evaluate(()=>{ const s=document.querySelector('.screen.pushed-screen.detail .scroll'); s.scrollTop=s.scrollHeight; }); await A.page.waitForTimeout(300);
  await A.page.screenshot({path:path.join(OUT,'a-dark-detail.png')});
  // Object URLs: once the detail is gone, nothing is kept
  await A.page.evaluate(()=>pop()); await A.page.waitForTimeout(1800);
  check('object_urls_revoked', await A.page.evaluate(()=>FU.size===0), await A.page.evaluate(()=>[...FU.keys()]));
  await A.ctx.close(); await B.ctx.close(); stoSrv.close();
}

(async()=>{
  await new Promise(res=>srv.listen(PORT,res));
  const browser = await chromium.launch({args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream','--autoplay-policy=no-user-gesture-required']});
  try{ await sqlTests(); }catch(e){ check('sql_crash', false, String(e.stack||e)); }
  try{ await fnTests(); }catch(e){ check('fn_crash', false, String(e.stack||e)); }
  try{ await appTests(browser); }catch(e){ check('app_crash', false, String(e.stack||e)); }
  await browser.close(); srv.close();
  console.log(JSON.stringify({results:r, fails, errors}, null, 1));
  process.exit(fails.length||errors.length?1:0);
})();
