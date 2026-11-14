require('./lib/out.js'); // outputs (screenshots, downloads) go to tests/out
// Decision 63a, end-to-end encryption. Port 8790 (8790 to 8799 reserved). Screenshots in tests/out/E2E.
//  1. SQL: supabase/migrations/0012_encryption.sql (no DROP in it) run twice in PGlite after 0001 to 0011: crypto_keys and its rules by
//     owner, the trigger tareas_require_cipher on the seven tables: plain text refused only for an owner with a key row, 'e1:' accepted,
//     an unchanged old plain value accepted on update and a deletion mark (upsert with id, deleted and modified) accepted on a not yet
//     encrypted row, an older copy skipped quietly, the service role's reminder_sent; the inbox's text and url writable by the owner.
//     Then all.sql twice on a fresh database and check.sql: every row OK, the three new rows among them.
//  2. The app against an in-memory fake server (rm-S's, plus crypto_keys, Storage, the Siri inbox and a stand-in for the trigger):
//     device A (iPhone, light) signs in with plain data, then activates: rules, warning, checkbox, progress; a file upload cut midway
//     leaves the flag 'migrating' and the next pass finishes; the server then holds only 'e1:' in the encrypted columns (a deleted row and
//     a voice note made before activation included), files with the magic, the taken Siri phrase emptied; A stays plain (data, search,
//     export, backup); a new Siri phrase becomes a task, its row emptied in the same update. The end is marked on the server (migrated).
//     Review fixes: a device that kept ciphertext as text on an older version repairs it on unlock and never encrypts it twice; the pull
//     uses the stored key and never merges ciphertext as text; uploads wait during activation and re-read the key row; a lost answer to the
//     key row keeps key and flag until the next pass decides; another device finishes the migration; password change answers lost or raced;
//     «Cerrar sesión» reaches the other windows.
//     Device B (desktop): signs in, sync paused (no pull, nothing merged, realtime ignored), unlock sheet by itself; wrong password
//     refused; the right one shows A's tasks in clear, its own task goes up encrypted, an encrypted photo opens.
//     A changes the password (wrong current refused); B keeps syncing both ways; device C (iPhone, dark) unlocks with the new password and
//     not the old one; signing out forgets its key. A device on an older version (no encryption layer) is refused by the server and says
//     «Actualiza la app». The service worker shows an encrypted reminder in clear (CDP push) and «Recordatorio» without a key.
const { chromium } = require('playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = path.resolve(__dirname, '..'), PORT = 8790, URL0 = 'http://localhost:'+PORT+'/';
const OUT = path.join(__dirname, 'out', 'E2E'); fs.mkdirSync(OUT, {recursive:true});
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
  const mig = rd('0012_encryption.sql'), body = mig.split('\n').filter(l=>!/^\s*--/.test(l)).join('\n');
  check('sql_no_drop', !/\bdrop\b/i.test(body) && !/\bdelete\b/i.test(body.replace(/on delete cascade/gi,'')), body.match(/.*\b(drop|delete)\b.*/gi));
  let db = await pgSetup();
  for(const f of ['0001_init.sql','0002_push.sql','0003_attachments.sql','0004_repeat_focus.sql','0005_subtasks.sql','0006_project_notes.sql','0007_deadline.sql','0008_estimate_postponed.sql','0009_closed_day.sql','0010_inbox.sql','0011_contacts.sql']) await db.exec(strip(rd(f)));
  let err = null; try { await db.exec(mig); await db.exec(mig); } catch(e){ err = e.message; }
  check('sql_runs_twice', !err, err);
  const q = async (sql, params) => (await db.query(sql, params)).rows;
  const tryq = async (sql, params) => { try { return {rows: await q(sql, params)}; } catch(e){ return {error: e.message}; } };
  const cols = await q(`select column_name, data_type, is_nullable from information_schema.columns where table_schema='public' and table_name='crypto_keys' order by ordinal_position`);
  check('sql_columns', cols.map(c=>c.column_name+':'+c.data_type).join()==='owner_id:uuid,kid:text,salt:text,iterations:integer,wrapped:text,created:timestamp with time zone,modified:timestamp with time zone,migrated:timestamp with time zone', cols);
  const pol = await q(`select policyname from pg_policies where tablename='crypto_keys' order by policyname`);
  const trg = await q(`select tgrelid::regclass::text t from pg_trigger where tgname='tareas_require_cipher' order by 1`);
  check('sql_objects', pol.map(p=>p.policyname).join()==='crypto_keys_insert_own,crypto_keys_select_own,crypto_keys_update_own' && trg.map(x=>x.t).join()==='contacts,project_notes,projects,spaces,subtasks,tasks,voice_notes', {pol, trg});
  const A = '00000000-0000-4000-8000-00000000000a', Bu = '00000000-0000-4000-8000-00000000000b';
  await db.exec(`insert into auth.users values ('${A}'), ('${Bu}')`);
  const as = async (uid, fn, role) => { await db.exec(`set test.uid = '${uid}'; set role ${role||'authenticated'};`); try { return await fn(); } finally { await db.exec(`reset role; reset test.uid;`); } };
  const up = (id, title, mod, extra) => `insert into public.tasks (id, title, modified${extra?', '+extra[0]:''}) values ('${id}', ${title===null?'null':"'"+title+"'"}, '${mod}'${extra?', '+extra[1]:''}) on conflict (id) do update set title = excluded.title, modified = excluded.modified returning id`;
  // Before any key: plain text is fine
  const p0 = await as(A, () => tryq(up('t1', 'Preparar comité', '2026-11-05T09:00:00Z')));
  const p0b = await as(A, () => tryq(`insert into public.tasks (id, title, notes, modified) values ('t2', 'Antigua', 'nota', '2026-11-05T09:00:00Z') returning id`));
  check('sql_plain_before_key', p0.rows && p0.rows.length===1 && p0b.rows && p0b.rows.length===1, {p0, p0b});
  const key = await as(A, () => tryq(`insert into public.crypto_keys (kid, salt, iterations, wrapped) values ('k1', 's', 600000, 'w') returning owner_id`));
  const key2 = await as(A, () => tryq(`insert into public.crypto_keys (kid, salt, iterations, wrapped) values ('k2', 's', 600000, 'w') returning owner_id`));
  check('sql_key_row', key.rows && key.rows[0].owner_id===A && !!key2.error, {key, key2});
  // With the key row: plain refused (insert and upsert), e1 accepted, empty accepted
  const r1 = await as(A, () => tryq(up('t3', 'Texto en claro', '2026-11-05T10:00:00Z')));
  const r2 = await as(A, () => tryq(up('t1', 'Otro título', '2026-11-05T10:00:00Z')));
  const r3 = await as(A, () => tryq(up('t1', 'e1:AAAA', '2026-11-05T10:00:00Z')));
  const r4 = await as(A, () => tryq(up('t4', '', '2026-11-05T10:00:00Z')));
  const pn = await as(A, () => tryq(`insert into public.projects (id, name, modified) values ('p1', 'FLC', now())`));
  const ct = await as(A, () => tryq(`insert into public.contacts (id, name, email, modified) values ('c1', 'e1:x', 'luis@example.com', now())`));
  check('sql_plain_refused', /tareas_plaintext_refused/.test(r1.error||'') && /tareas_plaintext_refused/.test(r2.error||'') && /tareas_plaintext_refused: projects\.name/.test(pn.error||'') && /contacts\.email/.test(ct.error||''), {r1, r2, pn, ct});
  check('sql_cipher_accepted', r3.rows && r3.rows.length===1 && r4.rows && r4.rows.length===1 && (await q(`select title from public.tasks where id='t1'`))[0].title==='e1:AAAA', {r3, r4});
  // A not yet encrypted row (t2, plain): an update that leaves the title as it is passes, and so does the app's deletion mark
  const u1 = await as(A, () => tryq(`update public.tasks set priority = 'high', modified = '2026-11-05T11:00:00Z' where id = 't2' returning id`));
  const u2 = await as(A, () => tryq(`update public.tasks set notes = 'nueva nota', modified = '2026-11-05T11:01:00Z' where id = 't2' returning id`));
  const mark = await as(A, () => tryq(`insert into public.tasks (id, deleted, modified) values ('t2', '2026-11-05T12:00:00Z', '2026-11-05T12:00:00Z') on conflict (id) do update set deleted = excluded.deleted, modified = excluded.modified returning id`));
  const t2 = (await q(`select title, deleted is not null d from public.tasks where id='t2'`))[0];
  check('sql_unchanged_and_mark', u1.rows && u1.rows.length===1 && /tareas_plaintext_refused: tasks\.notes/.test(u2.error||'') && mark.rows && mark.rows.length===1 && t2.title==='Antigua' && t2.d, {u1, u2, mark, t2});
  // An older copy is skipped by tareas_before_write first (no error); the service role sets reminder_sent; B has no key: plain is fine
  const old = await as(A, () => tryq(`update public.tasks set title = 'vieja', modified = '2026-11-01T00:00:00Z' where id = 't1' returning id`));
  const svc = await tryq(`update public.tasks set reminder_sent = now() where id = 't2' returning id`);
  const b1 = await as(Bu, () => tryq(up('tb', 'De B en claro', '2026-11-05T10:00:00Z')));
  check('sql_other_paths', old.rows && old.rows.length===0 && svc.rows && svc.rows.length===1 && b1.rows && b1.rows.length===1, {old, svc, b1});
  const seenB = await as(Bu, () => tryq(`select kid from public.crypto_keys`));
  const anon = await as(A, () => tryq(`select kid from public.crypto_keys`), 'anon');
  const upd = await as(A, () => tryq(`update public.crypto_keys set salt = 's2', wrapped = 'w2', modified = now() where owner_id = '${A}' and kid = 'k1' returning kid`));
  const del = await as(A, () => tryq(`delete from public.crypto_keys where owner_id = '${A}'`));
  // The end of the encryption of the server copy: marked once, only while still unmarked (the app's conditional update)
  const m1 = await as(A, () => tryq(`update public.crypto_keys set migrated = now() where owner_id = '${A}' and kid = 'k1' and migrated is null returning kid`));
  const m2 = await as(A, () => tryq(`update public.crypto_keys set migrated = now() where owner_id = '${A}' and kid = 'k1' and migrated is null returning kid`));
  check('sql_migrated_once', m1.rows && m1.rows.length===1 && m2.rows && m2.rows.length===0, {m1, m2});
  check('sql_key_rls', seenB.rows && seenB.rows.length===0 && !!anon.error && upd.rows && upd.rows.length===1 && !!del.error && (await q(`select count(*)::int n from public.crypto_keys`))[0].n===1, {seenB, anon, upd, del});
  // The inbox: the owner empties text and url, and still cannot change anything else
  await db.exec(`insert into public.inbox (id, owner_id, text, url, source, taken) values ('00000000-0000-4000-8000-0000000000f1', '${A}', 'Llamar a Marta', 'https://x', 'share', now())`);
  const ib = await as(A, () => tryq(`update public.inbox set text = '', url = null where taken is not null and text <> '' returning id`));
  const ib2 = await as(A, () => tryq(`update public.inbox set source = 'siri' returning id`));
  check('sql_inbox_clear', ib.rows && ib.rows.length===1 && /permission denied/.test(ib2.error||'') && (await q(`select text, url from public.inbox`))[0].text==='', {ib, ib2});
  await db.close();
  db = await pgSetup(); const all = strip(fs.readFileSync(path.join(ROOT, 'supabase/all.sql'), 'utf8'));
  err = null; try { await db.exec(all); await db.exec(all); } catch(e){ err = e.message; }
  check('sql_all_twice', !err && /0001 a 00\d\d/.test(all.split('\n')[0]) && /migrations\/0012_encryption\.sql/.test(all) && (all.match(/^-- ========== migrations\//mg)||[]).length===fs.readdirSync(path.join(ROOT,'supabase/migrations')).filter(f=>f.endsWith('.sql')).length, err);
  let rows = []; try { rows = (await db.query(fs.readFileSync(path.join(ROOT, 'supabase/check.sql'), 'utf8'))).rows; } catch(e){ err = e.message; }
  check('sql_check_all_ok', rows.length>=34 && rows.every(x=>x.Estado==='OK') && rows.filter(x=>/\(0012\)/.test(x.Pieza)).length===4, {err, bad:rows.filter(x=>x.Estado!=='OK'), n:rows.length});
  await db.close();
}

/* ======================= 2. Fake server ======================= */
const TABLES = ['spaces','projects','tasks','voice_notes','attachments','subtasks','project_notes','contacts'];
const ENC = { tasks:['title','notes','waiting_for','responsible'], projects:['name'], spaces:['name'], subtasks:['title'], project_notes:['title','body'], contacts:['name','email','phone'], voice_notes:['text'] };
const isEnc = v => typeof v==='string' && v.startsWith('e1:');
class Fake {
  constructor(){ this.t={}; TABLES.forEach(x=>this.t[x]=new Map()); this.last=0; this.subs=new Map(); this.tags=new Map(); this.calls=[]; this.keys=new Map(); this.inbox=[]; this.store=new Map(); this.failUpload=0; this.refused=0; this.lose={}; }
  ts(){ this.last=Math.max(Date.now(), this.last+1); return new Date(this.last).toISOString(); }
  // The trigger's stand-in: PostgREST's upsert is an insert first, so with a key row any plain value is refused
  write(owner, table, rows){ if(!owner) throw new Error('JWT required'); const ts=this.ts(), out=[], changed=[], m=this.t[table];
    rows.forEach(r=>{ if(!r.id) throw new Error('null id'); if(!r.modified) throw new Error('null value in column "modified"');
      const ex=m.get(r.id); if(ex && ex.owner_id!==owner) throw new Error('new row violates row-level security policy');
      if(this.keys.has(owner) && ENC[table]) ENC[table].forEach(c=>{ const v=r[c]; if(v!=null && v!=='' && !isEnc(v)){ this.refused++; throw new Error('tareas_plaintext_refused: '+table+'.'+c+' must be encrypted (update the app)'); } }); });
    rows.forEach(r=>{ const ex=m.get(r.id);
      if(!ex){ const row=Object.assign({id:r.id, owner_id:owner, created:null, deleted:null}, r, {owner_id:owner, server_ts:ts}); m.set(r.id,row); out.push({id:r.id}); changed.push(row); return; }
      if(Date.parse(r.modified) < Date.parse(ex.modified)) return;
      Object.assign(ex, r, {owner_id:ex.owner_id, server_ts:ts}); out.push({id:r.id}); changed.push(ex); });
    changed.forEach(row=>this.notify(table, row)); return out; }
  put(owner, table, row){ const full=Object.assign({owner_id:owner, created:row.modified, deleted:null}, row, {server_ts:this.ts()}); this.t[table].set(row.id, full); return full; } // straight into the database
  notify(table, row){ const copy=JSON.parse(JSON.stringify(row));
    for(const [page, uid] of this.subs){ if(uid!==row.owner_id) continue; setTimeout(()=>{ page.evaluate(([t,r])=>window.__fakeRT&&window.__fakeRT(t,r), [table, copy]).catch(()=>{}); }, 30); } }
  rows(owner, table){ return [...this.t[table].values()].filter(r=>r.owner_id===owner); }
  handle(page, op, a){ this.calls.push((this.tags.get(page)||'?')+':'+op+(a&&a.table?':'+a.table:'')); const own=a&&a.owner;
    switch(op){
      case 'signIn': return {id:a.uid, email:a.email};
      case 'pull': { let rs=this.rows(own, a.table); if(a.after) rs=rs.filter(r=>Date.parse(r.server_ts)>Date.parse(a.after));
        rs.sort((x,y)=>x.server_ts<y.server_ts?-1:x.server_ts>y.server_ts?1:x.id<y.id?-1:1); return JSON.parse(JSON.stringify(rs.slice(0,a.limit))); }
      case 'byIds': return JSON.parse(JSON.stringify(this.rows(own, a.table).filter(r=>a.ids.includes(r.id))));
      // failUpsert: the next writes of a table fail; hook: before the first write that names its row, another device changes that row without
      // touching modified (fn), and the columns sent for it are kept (keys)
      case 'upsert': if(this.failUpsert&&this.failUpsert[a.table]>0){ this.failUpsert[a.table]--; throw new Error('HTTP 500 upsert failed'); }
        if(this.hook&&a.table===this.hook.table&&!this.hook.keys){ const r=a.rows.find(x=>x.id===this.hook.id); if(r){ this.hook.keys=Object.keys(r).sort(); this.hook.fn(this.t[a.table].get(r.id)); } }
        return this.write(own, a.table, a.rows);
      case 'markDeleted': return this.write(own, a.table, a.items.map(x=>({id:x.id, deleted:x.ts, modified:x.ts})));
      case 'subscribe': this.subs.set(page, a.uid); return true;
      case 'unsubscribe': this.subs.delete(page); return true;
      // lose.get / lose.put / lose.patch: the request fails (put and patch after storing, as an answer lost on the way back); hide: the row is not seen
      case 'cryptoGet': { if(this.lose.get){ this.lose.get--; throw new Error('Failed to fetch'); } const k=this.keys.get(own); return k&&!this.hide?JSON.parse(JSON.stringify(k)):null; }
      case 'cryptoPut': if(this.keys.has(own)) throw new Error('duplicate key value violates unique constraint "crypto_keys_pkey"'); this.keys.set(own, Object.assign({migrated:null}, a.row, {owner_id:undefined}));
        if(this.lose.put){ this.lose.put--; this.lose.get=this.lose.afterPut||0; throw new Error('Failed to fetch'); } return true;
      case 'cryptoPatch': { const k=this.keys.get(own); if(this.racePatch){ this.racePatch=false; if(k) k.wrapped='cambiada-en-otro-dispositivo'; }
        if(!k||Object.keys(a.match).some(c=>a.match[c]===null?k[c]!=null:k[c]!==a.match[c])) return []; Object.assign(k, a.patch);
        if(this.lose.patch){ this.lose.patch--; throw new Error('Failed to fetch'); } return [{kid:k.kid}]; }
      case 'upload': if(a.path===this.failPath) throw new Error('HTTP 500 storage error'); if(this.failUpload>0){ this.failUpload--; throw new Error('Failed to fetch'); } if(!a.path.startsWith(own+'/')) throw new Error('row-level security'); this.store.set(a.path, {b64:a.b64, mime:a.mime}); return true;
      case 'download': { if(a.path===this.rateLimitPath) throw new Error('HTTP 429 Too Many Requests'); const o=this.store.get(a.path); if(!o) throw new Error('HTTP 400 {"statusCode":"404","error":"not_found","message":"Object not found"}'); return o; }
      case 'inboxList': return this.inbox.filter(x=>x.owner_id===own&&!x.taken).map(x=>({id:x.id, text:x.text, url:x.url, source:x.source, created:x.created}));
      case 'inboxTake': return this.inbox.filter(x=>x.owner_id===own&&a.ids.includes(x.id)).map(x=>{ x.taken=a.ts; if(a.o&&a.o.clear){ x.text=''; x.url=null; } return {id:x.id}; });
      case 'inboxClear': return this.inbox.filter(x=>x.owner_id===own&&x.taken&&x.text!=='').map(x=>{ x.text=''; x.url=null; return {id:x.id}; });
    } throw new Error('op '+op); }
}
const fake = new Fake();
const USER = {uid:'9b2f6d3e-0000-4000-8000-00000000c001', email:'enric@example.com'};
function fakeAdapter(){
  const call=(op,a)=>{ if(!navigator.onLine) return Promise.reject(new TypeError('Failed to fetch')); return window.fakeServer(op,a); };
  const owner=()=>{ const s=JSON.parse(localStorage.getItem('fake-session')||'null'); return s&&s.id; };
  const b64=async blob=>new Promise((res,rej)=>{ const rd=new FileReader(); rd.onload=()=>res(String(rd.result).split(',')[1]||''); rd.onerror=()=>rej(rd.error); rd.readAsDataURL(blob); });
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
    async fileUpload(path, blob, mime){ return call('upload', {owner:owner(), path, b64:await b64(blob), mime}); },
    async fileDownload(path){ const o=await call('download', {owner:owner(), path}); const s=atob(o.b64), u=new Uint8Array(s.length); for(let i=0;i<s.length;i++) u[i]=s.charCodeAt(i); return new Blob([u], {type:o.mime}); },
    inboxList:()=>call('inboxList', {owner:owner()}),
    inboxTake:(ids, ts, o)=>call('inboxTake', {owner:owner(), ids, ts, o:o||null}),
    inboxClear:()=>call('inboxClear', {owner:owner()}),
    cryptoGet:()=>call('cryptoGet', {owner:owner()}),
    cryptoPut:row=>call('cryptoPut', {owner:owner(), row}),
    cryptoPatch:(own, match, patch)=>call('cryptoPatch', {owner:owner(), match, patch})
  };
}

/* ======================= Pages ======================= */
const T0 = '2026-11-04T08:00:00.000Z';
const today=(()=>{ const d=new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); })();
const tk = (id, o) => Object.assign({id, title:id, spaceId:'trabajo', projectId:null, date:today, reminder:null, priority:'none', status:'pending', notes:'', carried:false, created:T0, modified:T0, completed:null}, o);
const SEED_A = () => ({ spaces:[{id:'trabajo',name:'Trabajo',order:0,created:T0},{id:'personal',name:'Personal',order:1,created:T0}],
  projects:[{id:'p1', spaceId:'trabajo', name:'FLC', color:'#007AFF', order:0, archived:false, created:T0, modified:T0}],
  tasks:[ tk('a1', {title:'Preparar comité de seguimiento', projectId:'p1', notes:'Orden del día con riesgos', responsible:'Marta Ruiz'}),
    tk('a2', {title:'Revisar SOW', status:'waiting', waitingFor:'Luis'}), tk('a3', {title:'Llamar al fontanero', spaceId:'personal', priority:'high'}), tk('a4', {title:'e1:texto que parece cifrado'}) ],
  voiceNotes:[], attachments:[], subtasks:[{id:'s1', taskId:'a1', title:'Enviar convocatoria', done:false, order:0, created:T0, modified:T0}],
  projectNotes:[{id:'n1', projectId:'p1', title:'Acuerdos', body:'- Cerrar alcance\n[ ] Pedir firma', pinned:false, created:T0, modified:T0}],
  contacts:[{id:'c1', name:'Marta Ruiz', email:'marta@example.com', phone:'612 345 678', created:T0, modified:T0}], settings:{tipsSeen:true} });
const SEED_B = () => ({ spaces:[{id:'trabajo',name:'Trabajo',order:0,created:T0},{id:'personal',name:'Personal',order:1,created:T0}], projects:[],
  tasks:[tk('b1', {title:'Tarea de B antes de entrar', created:'2026-11-04T09:00:00.000Z', modified:'2026-11-04T09:00:00.000Z'})], voiceNotes:[], settings:{tipsSeen:true} });
const PW1 = 'Correcta horse 9!', PW2 = 'Nueva clave 2026#';
async function device(browser, o){
  const vp = o.desk ? {viewport:{width:1280,height:800}, deviceScaleFactor:1} : {viewport:{width:390,height:844}, deviceScaleFactor:2, isMobile:true, hasTouch:true};
  if(o.dark) vp.colorScheme='dark';
  const ctx = await browser.newContext(vp); if(o.notify) await ctx.grantPermissions(['notifications'], {origin:'http://localhost:'+PORT});
  const page = await ctx.newPage(); fake.tags.set(page, o.tag);
  page.on('pageerror', e=>errors.push(o.tag+' pageerror: '+e.message)); page.on('console', m=>{ if(m.type()==='error'&&!/Failed to fetch/.test(m.text())) errors.push(o.tag+' console: '+m.text()); });
  await page.exposeBinding('fakeServer', (src, op, a)=>fake.handle(src.page, op, a)); await page.addInitScript(fakeAdapter); await page.addInitScript(u=>{ window.__fakeUser=u; }, USER);
  if(o.old) await page.addInitScript(()=>{ if(!localStorage.getItem('__updated')) window.__noCrypto=true; }); // until it «updates»
  if(o.user) await page.addInitScript(u=>{ window.__fakeUser=u; }, o.user);
  // A database without 0012_encryption.sql: the adapter answers as supabaseRemote does (absent, logged once)
  if(o.absent) await page.addInitScript(()=>{ const R=window.__tareasRemote; R.missing=new Set(); R.cryptoGet=async()=>{ window.__cg=(window.__cg||0)+1; syncAbsent(R.missing, 'crypto_keys', {code:'PGRST205', message:"Could not find the table 'public.crypto_keys' in the schema cache"}); return null; }; });
  await page.addInitScript(s=>{ if(!localStorage.getItem('tareas-v1')) localStorage.setItem('tareas-v1', s); }, JSON.stringify(o.seed));
  await page.goto(URL0); await page.waitForTimeout(600); return {ctx, page};
}
const until = async (page, fn, arg, ms=10000)=>{ const t0=Date.now(); for(;;){ let v=false; try{ v=await page.evaluate(fn, arg); }catch(e){} if(v) return true; if(Date.now()-t0>ms) return false; await page.waitForTimeout(100); } };
const synced = (page, ms) => until(page, ()=>SY&&SY.user&&!SY.running&&SY.status==='ok'&&!CR.busy&&!CR.migrating&&syncCollect(true).count===0, null, ms||15000);
const settled = page => until(page, ()=>!document.querySelector('#sheet.on')&&!document.querySelector('#asheet.on'), null, 3000);
async function toSettings(page, desk){ await require('./lib/settings.js').openSetting(page, desk?null:'cuenta'); } // v0.37.4: Cuenta on the iPhone
const section = page => page.evaluate(()=>{ const t=[...document.querySelectorAll('.group-title')].find(x=>x.textContent==='Cifrado'); if(!t) return null; const g=t.nextElementSibling, f=g.nextElementSibling;
  t.scrollIntoView({block:'start'}); return {cells:[...g.querySelectorAll('.cell')].map(c=>c.textContent.trim()), foot:f&&f.classList.contains('footnote')?f.textContent:''}; });
const account = page => page.evaluate(()=>syncLine());
const signIn = async (page, desk) => { await toSettings(page, desk); await page.click('[data-act=signIn]:visible'); };
// Every encrypted column of every row the fake holds: empty or 'e1:'
const plainLeft = () => { const out=[]; for(const t of Object.keys(ENC)) for(const row of fake.t[t].values()) ENC[t].forEach(c=>{ const v=row[c]; if(v!=null&&v!==''&&!isEnc(v)) out.push(t+'.'+c+'.'+row.id+'='+v); }); return out; };
const sheetShot = async (page, name, js) => { await page.evaluate(()=>{ const t=document.getElementById('toast'); t.classList.remove('on'); }); await page.evaluate(js); await page.waitForTimeout(650); await shot(page, name); await page.evaluate(()=>{ CR.prog=null; closeSheet(); }); await settled(page); };

async function appTests(browser){
  /* ---------- Server data from before: a deleted task, a voice note, a photo, a taken Siri phrase ---------- */
  const U=USER.uid, PHOTO=Buffer.from('JPEG fake photo bytes 0123456789 '.repeat(20));
  fake.put(U, 'tasks', {id:'tdel', title:'Borrada antes de cifrar', notes:'Nota de la borrada', space_id:null, status:'pending', priority:'none', modified:'2026-11-03T10:00:00.000Z', created:'2026-11-03T09:00:00.000Z', deleted:'2026-11-03T10:00:00.000Z'});
  fake.put(U, 'tasks', {id:'tvn', title:'Con nota de voz', notes:'', space_id:null, status:'pending', priority:'none', date:today, modified:'2026-11-03T10:00:00.000Z', created:'2026-11-03T09:00:00.000Z'});
  fake.put(U, 'voice_notes', {id:'vn1', task_id:'tvn', text:'Dictado antiguo', modified:'2026-11-03T10:05:00.000Z', created:'2026-11-03T10:05:00.000Z'});
  const photoPath=U+'/tvn/ph1.jpg'; fake.store.set(photoPath, {b64:PHOTO.toString('base64'), mime:'image/jpeg'});
  fake.put(U, 'attachments', {id:'ph1', task_id:'tvn', kind:'photo', path:photoPath, mime:'image/jpeg', size:PHOTO.length, width:10, height:10, duration_ms:null, purged:null, modified:'2026-11-03T10:06:00.000Z', created:'2026-11-03T10:06:00.000Z'});
  fake.inbox.push({id:'ib-old', owner_id:U, text:'Comprar tóner', url:'https://example.com/toner', source:'share', created:'2026-11-03T08:00:00.000Z', taken:'2026-11-03T08:01:00.000Z'});

  /* ---------- A (iPhone, light): signs in with plain data ---------- */
  const A = await device(browser, {tag:'A', seed:SEED_A(), notify:true}); const ap=A.page;
  await toSettings(ap);
  let s = await section(ap); check('A_section_signed_out', s && s.cells.join('|')==='CifradoSin cuenta' && /Inicia sesión primero/.test(s.foot), s);
  await signIn(ap); check('A_first_sync', await synced(ap));
  check('A_plain_before', plainLeft().length>10 && fake.keys.size===0 && fake.t.tasks.get('a4').title==='e1:texto que parece cifrado' && await ap.evaluate(()=>task('a4').title==='e1:texto que parece cifrado'&&SY.status==='ok'), plainLeft().length);
  await ap.waitForTimeout(300); s = await section(ap);
  check('A_section_off', s && s.cells.join('|')==='Activar cifrado' && /el servidor solo guarda texto ilegible/.test(s.foot), s);
  await shot(ap, 'ip-light-section-off');

  /* ---------- Activation sheet: rules live, OK only with the checkbox ---------- */
  await ap.click('[data-act=cxOn]'); await ap.waitForTimeout(650);
  const focused = await ap.evaluate(()=>document.activeElement&&document.activeElement.dataset.role);
  await ap.fill('#sheet [data-role=cx1]', 'corta1'); await ap.fill('#sheet [data-role=cx2]', 'corta1');
  const weak = await ap.evaluate(()=>({ok:[...document.querySelectorAll('#sheet .cx-rules li.ok')].map(l=>l.dataset.rule), dis:document.querySelector('#sheet .hbtn.ok').disabled}));
  await ap.fill('#sheet [data-role=cx1]', PW1); await ap.fill('#sheet [data-role=cx2]', PW1);
  const good = await ap.evaluate(()=>({ok:[...document.querySelectorAll('#sheet .cx-rules li.ok')].map(l=>l.dataset.rule), dis:document.querySelector('#sheet .hbtn.ok').disabled, txt:document.querySelector('#sheet .cxsheet').textContent}));
  await ap.check('#sheet [data-role=cxok]'); const armed = await ap.evaluate(()=>document.querySelector('#sheet .hbtn.ok').disabled);
  check('act_sheet', focused==='cx1' && weak.ok.join()==='let,num,same' && weak.dis && good.ok.join()==='len,let,num,sym,same' && good.dis && armed===false
    && /Si olvidas esta contraseña, los datos guardados en el servidor no se pueden recuperar\. No hay código de recuperación\./.test(good.txt) && /Entiendo que no se puede recuperar/.test(good.txt) && /Actualiza la app en todos tus dispositivos antes de activarlo/.test(good.txt), {focused, weak, good, armed});
  await shot(ap, 'ip-light-activate-sheet');
  // The first upload of a file fails as if the connection dropped: the work stops and the flag stays
  fake.failUpload=1;
  await ap.click('#sheet .hbtn.ok');
  check('act_progress_sheet', await until(ap, ()=>!!document.querySelector('#sheet.on .cxprog'), null, 3000));
  await shot(ap, 'ip-light-progress');
  check('act_interrupted', await until(ap, ()=>!CR.migrating&&!CR.busy&&CR.row&&!CR.row.migrated&&!crFlag()&&LOG.some(e=>/^Cifrado interrumpido/.test(e.m)), null, 30000) && fake.keys.get(U).migrated===null, await ap.evaluate(()=>({row:CR.row, f:crFlag(), log:LOG.slice(-6).map(e=>e.m)})));
  const mid = {left:plainLeft(), key:fake.keys.get(U)};
  check('act_key_row', mid.key && /^[A-Za-z0-9_-]{16}$/.test(mid.key.kid) && mid.key.iterations===600000 && /^[A-Za-z0-9_-]{20,}$/.test(mid.key.salt) && /^[A-Za-z0-9_-]{50,}$/.test(mid.key.wrapped), mid.key);
  // The next pass goes on from where it stopped
  check('act_waits', await ap.evaluate(()=>CR.resumeAt>Date.now()+20e3));
  await ap.evaluate(()=>{ CR.resumeAt=0; SY.retry=0; syncRun('prueba'); });
  check('act_resumed', await until(ap, ()=>CR.row&&!!CR.row.migrated&&!CR.migrating, null, 30000) && !!fake.keys.get(U).migrated, await ap.evaluate(()=>({row:CR.row, log:LOG.slice(-6).map(e=>e.m)})));
  check('A_synced_after', await synced(ap));
  const left = plainLeft(), files=[...fake.store.entries()].map(([p,o])=>({p, magic:Buffer.from(o.b64,'base64').slice(0,8).toString()}));
  const tdel=fake.t.tasks.get('tdel'), vn1=fake.t.voice_notes.get('vn1');
  check('server_all_cipher', left.length===0 && [...fake.t.tasks.values()].every(x=>isEnc(x.title)) && isEnc(fake.t.projects.get('p1').name) && isEnc(fake.t.contacts.get('c1').phone) && isEnc(fake.t.project_notes.get('n1').body) && isEnc(fake.t.subtasks.get('s1').title), left);
  const a4=fake.t.tasks.get('a4').title;
  check('server_typed_prefix_encrypted', isEnc(a4) && a4!=='e1:texto que parece cifrado' && (await ap.evaluate(async([v])=>cryptoDec(CR.key, v, cryptoAad('tasks','title')), [a4]))==='e1:texto que parece cifrado', a4);
  check('server_deleted_and_voice', isEnc(tdel.title) && isEnc(tdel.notes) && tdel.deleted==='2026-11-03T10:00:00.000Z' && tdel.modified==='2026-11-03T10:00:00.000Z' && isEnc(vn1.text), {tdel, vn1});
  check('server_files', files.length===1 && files[0].magic==='TAREASE1', files);
  check('server_inbox_cleared', fake.inbox[0].text==='' && fake.inbox[0].url===null, fake.inbox[0]);
  const Ax = await ap.evaluate(async()=>{ const b=await BK.list(); return {t:task('a1').title, n:task('a1').notes, r:task('a1').responsible, w:task('a2').waitingFor, p:proj('p1').name, raw:/e1:[A-Za-z0-9_-]{30}/.test(localStorage.getItem('tareas-v1')),
    exp:/e1:[A-Za-z0-9_-]{30}/.test(JSON.stringify(exportData())), search:pendingFor('todas', undefined, 'comité').map(x=>x.id), backups:b.length, log:LOG.map(e=>e.m), key:!!CR.key, idb:!!(await cryptoKeyLoad())}; });
  check('A_stays_plain', Ax.t==='Preparar comité de seguimiento' && Ax.n==='Orden del día con riesgos' && Ax.r==='Marta Ruiz' && Ax.w==='Luis' && Ax.p==='FLC' && !Ax.raw && !Ax.exp && Ax.search.join()==='a1' && Ax.backups>=1, Ax);
  check('A_log', ['Activación del cifrado: inicio','Copia local antes de cifrar','Cifrado activado en la cuenta: clave creada','Cifrado: cifrando los datos del servidor','Cifrado completado'].every(m=>Ax.log.includes(m)) && !Ax.log.some(m=>m.includes(PW1)) && Ax.key && Ax.idb, Ax.log.slice(-15));
  // A sheet left open by the activation is closed for the next steps
  await ap.evaluate(()=>{ if(document.querySelector('#sheet.on')) closeSheet(); }); await settled(ap);
  s = await section(ap); check('A_section_on', s && /^Cifrado activado el \d+ de [a-z]+/.test(s.cells[0]) && s.cells[1]==='Cambiar contraseña', s);
  await shot(ap, 'ip-light-section-on');
  // A change goes up encrypted, bound to its row and column
  await ap.evaluate(()=>updTask('a1', {title:'Preparar comité de dirección'})); await synced(ap);
  const enc1 = fake.t.tasks.get('a1').title;
  const dec1 = await ap.evaluate(async([v])=>({ok:await cryptoDec(CR.key, v, cryptoAad('tasks','title')), other:await cryptoDec(CR.key, v, cryptoAad('tasks','notes')).then(()=>'opened', ()=>'refused')}), [enc1]);
  check('A_edit_encrypted', isEnc(enc1) && dec1.ok==='Preparar comité de dirección' && dec1.other==='refused', {enc1, dec1});
  // Siri: a phrase becomes a task and leaves the server in the same update
  fake.inbox.push({id:'ib-new', owner_id:U, text:'Llamar a Pepe mañana', url:null, source:'siri', created:new Date().toISOString(), taken:null});
  await ap.evaluate(()=>syncRun('prueba')); await synced(ap);
  const ibn=fake.inbox.find(x=>x.id==='ib-new'), ibt=fake.t.tasks.get('ib-ib-new');
  fake.inbox.push({id:'ib-after', owner_id:U, text:'Pedir presupuesto', url:null, source:'siri', created:new Date().toISOString(), taken:null}); fake.failUpsert={tasks:3};
  await ap.evaluate(()=>syncRun('prueba')); await until(ap, ()=>!SY.running);
  const ibA=fake.inbox.find(x=>x.id==='ib-after');
  check('siri_kept_until_pushed', !!ibA.taken && ibA.text==='Pedir presupuesto' && !fake.t.tasks.has('ib-ib-after'), {ibA, f:fake.failUpsert});
  fake.failUpsert={}; fake.inbox.push({id:'ib-old2', owner_id:U, text:'Tomada por un dispositivo antiguo', url:'https://x', source:'share', created:new Date().toISOString(), taken:new Date().toISOString()});
  await ap.evaluate(()=>{ SY.retry=0; return syncRun('prueba'); }); await synced(ap);
  check('siri_cleared_after_push', ibA.text==='' && fake.t.tasks.has('ib-ib-after') && isEnc(fake.t.tasks.get('ib-ib-after').title) && fake.inbox.find(x=>x.id==='ib-old2').text==='' && fake.inbox.find(x=>x.id==='ib-old2').url===null, {ibA});
  check('siri_cleared', !!ibn.taken && ibn.text==='' && ibt && isEnc(ibt.title) && await ap.evaluate(()=>!!task('ib-ib-new')&&task('ib-ib-new').title.startsWith('Llamar a Pepe')), {ibn, t:ibt&&ibt.title});

  /* ---------- B (desktop): sync paused until the password ---------- */
  const B = await device(browser, {tag:'B', seed:SEED_B(), desk:true}); const bp=B.page;
  await signIn(bp, true);
  check('B_locked', await until(bp, ()=>SY.status==='locked'), await bp.evaluate(()=>({st:SY.status, err:SY.error})));
  check('B_unlock_sheet_auto', await until(bp, ()=>!!document.querySelector('#sheet.on [data-role=cxpw]')));
  const bCalls = fake.calls.filter(c=>c.startsWith('B:'));
  check('B_no_pull_push', !bCalls.some(c=>/:(pull|upsert|markDeleted|byIds|inboxList)/.test(c)) && bCalls.includes('B:cryptoGet') && !fake.t.tasks.has('b1'), bCalls);
  await bp.waitForTimeout(300); await shot(bp, 'desk-unlock-sheet');
  // Realtime while locked: A's change does not land here
  await ap.evaluate(()=>updTask('a3', {title:'Llamar al fontanero hoy'})); await synced(ap); await bp.waitForTimeout(500);
  check('B_nothing_merged', await bp.evaluate(()=>!task('a1')&&!task('a3')&&DB.tasks.length===1&&!/e1:[A-Za-z0-9_-]{30}/.test(JSON.stringify(DB))));
  await bp.fill('#sheet [data-role=cxpw]', 'Otra clave 123!'); await bp.click('#sheet .hbtn.ok');
  check('B_wrong_password', await until(bp, ()=>document.querySelector('#sheet [data-role=cxerr]').textContent==='Contraseña incorrecta', null, 15000) && await bp.evaluate(()=>!CR.key&&SY.status==='locked'&&LOG.some(e=>e.m==='Contraseña de cifrado incorrecta')));
  await shot(bp, 'desk-unlock-wrong');
  await bp.fill('#sheet [data-role=cxpw]', PW1); await bp.click('#sheet .hbtn.ok');
  check('B_unlocked', await until(bp, ()=>!!CR.key&&!document.querySelector('#sheet.on'), null, 15000) && await synced(bp));
  const Bx = await bp.evaluate(()=>({a1:task('a1')&&task('a1').title, a3:task('a3')&&task('a3').title, p:proj('p1')&&proj('p1').name, n:(DB.projectNotes.find(n=>n.id==='n1')||{}).body, c:(DB.contacts.find(c=>c.id==='c1')||{}).phone,
    s:(DB.subtasks.find(x=>x.id==='s1')||{}).title, enc:/e1:[A-Za-z0-9_-]{30}/.test(JSON.stringify(DB)), line:syncLine(), spaces:DB.spaces.map(x=>x.name).sort().join()}));
  check('B_sees_plain', Bx.a1==='Preparar comité de dirección' && Bx.a3==='Llamar al fontanero hoy' && Bx.p==='FLC' && Bx.n==='- Cerrar alcance\n[ ] Pedir firma' && Bx.c==='612 345 678' && Bx.s==='Enviar convocatoria' && !Bx.enc && /^Sincronizado/.test(Bx.line) && Bx.spaces==='Personal,Trabajo', Bx);
  check('B_typed_prefix', await bp.evaluate(()=>task('a4')&&task('a4').title==='e1:texto que parece cifrado'));
  // A row that does not open with the key (damaged): left out, said once in the log, never shown as e1:...
  fake.put(U, 'tasks', {id:'tbad', title:'e1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', notes:'', status:'pending', priority:'none', date:today, modified:new Date().toISOString(), created:new Date().toISOString()});
  fake.put(U, 'tasks', {id:'tbad2', title:'e1:BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB', notes:'', status:'pending', priority:'none', date:today, modified:new Date().toISOString(), created:new Date().toISOString()});
  await bp.evaluate(()=>syncRun('prueba')); await synced(bp);
  check('B_unreadable_kept', await bp.evaluate(()=>task('tbad')&&task('tbad').title===CRYPTO_PLACEHOLDER&&task('tbad2')&&task('tbad2').title===CRYPTO_PLACEHOLDER&&LOG.filter(e=>/no se puede descifrar/.test(e.m)).length===1&&!JSON.stringify(DB).includes('e1:AAAA')&&!JSON.stringify(DB).includes(CRYPTO_UNREAD)));
  // Changing such a task never sends the placeholder: the server keeps its own text
  await bp.evaluate(()=>updTask('tbad', {priority:'high'})); await synced(bp);
  check('B_placeholder_never_pushed', fake.t.tasks.get('tbad').priority==='high' && fake.t.tasks.get('tbad').title==='e1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', fake.t.tasks.get('tbad'));
  // A ciphertext copied into another row by a device on an older version (a duplicate, the next of a series) opens there too
  fake.put(U, 'tasks', {id:'cp1', title:fake.t.tasks.get('a1').title, notes:'', status:'pending', priority:'none', date:today, modified:new Date().toISOString(), created:new Date().toISOString()});
  // A text that does not open in a row this device has: its own value stays, the rest of the newer copy comes
  const a3row=fake.t.tasks.get('a3'), a3title=a3row.title; Object.assign(a3row, {title:'e1:'+'D'.repeat(50), priority:'mid', modified:new Date().toISOString(), server_ts:fake.ts()});
  await bp.evaluate(()=>syncRun('prueba')); await synced(bp);
  const bx2 = await bp.evaluate(()=>({cp:task('cp1')&&task('cp1').title, a3:task('a3').title, pri:task('a3').priority, bad:task('a3').cxBad||null}));
  check('B_copied_cipher_opens', bx2.cp==='Preparar comité de dirección', bx2);
  check('B_unreadable_local_kept', bx2.a3==='Llamar al fontanero hoy' && bx2.pri==='mid' && !bx2.bad, bx2);
  // Its next change sends this device's text, readable again
  await bp.evaluate(()=>updTask('a3', {priority:'high'})); await synced(bp);
  const a3dec = await bp.evaluate(async([v])=>cryptoDec(CR.key, v, cryptoAad('tasks','title')).catch(()=>null), [fake.t.tasks.get('a3').title]);
  check('B_unreadable_repaired', a3dec==='Llamar al fontanero hoy' && fake.t.tasks.get('a3').title!==a3title, a3dec);
  // A plain file uploaded after activation by a device on an older version: opened, and encrypted in place
  const oldPath=U+'/tvn/old.jpg'; fake.store.set(oldPath, {b64:PHOTO.toString('base64'), mime:'image/jpeg'});
  fake.put(U, 'attachments', {id:'ph2', task_id:'tvn', kind:'photo', path:oldPath, mime:'image/jpeg', size:PHOTO.length, width:10, height:10, duration_ms:null, purged:null, modified:new Date().toISOString(), created:new Date().toISOString()});
  await bp.evaluate(()=>syncRun('prueba')); await synced(bp);
  const ph2 = await bp.evaluate(async()=>{ const a=DB.attachments.find(x=>x.id==='ph2'); const b=a&&await attDownload(a); return b?b.size:null; });
  check('B_plain_file_reencrypted', ph2===PHOTO.length && Buffer.from(fake.store.get(oldPath).b64,'base64').slice(0,8).toString()==='TAREASE1', ph2);
  check('B_own_task_up_encrypted', fake.t.tasks.has('b1') && isEnc(fake.t.tasks.get('b1').title) && plainLeft().length===0, plainLeft());
  const photo = await bp.evaluate(async()=>{ const a=DB.attachments.find(x=>x.id==='ph1'); const b=a&&await attDownload(a); return b?{size:b.size, type:b.type, head:new TextDecoder().decode(new Uint8Array(await b.arrayBuffer()).slice(0,15))}:null; });
  check('B_photo_opens', photo && photo.size===PHOTO.length && photo.type==='image/jpeg' && photo.head==='JPEG fake photo', photo);
  await toSettings(bp, true); s = await section(bp); check('B_section_on', s && /^Cifrado activado el/.test(s.cells[0]), s); await shot(bp, 'desk-section-on');
  await sheetShot(bp, 'desk-activate-sheet', ()=>{ CR.row=null; cryptoActivateSheet(); document.querySelector('#sheet [data-role=cx1]').value='Correcta horse'; crRulesPaint(document.querySelector('#sheet'), document.querySelector('#sheet [data-role=cx1]'), document.querySelector('#sheet [data-role=cx2]')); });
  await bp.evaluate(()=>{ CR.force=true; return crFetch(SY.user); });
  await sheetShot(bp, 'desk-progress', ()=>{ CR.prog={n:120, of:840}; crProgSheet(); });
  await sheetShot(bp, 'desk-pass-sheet', ()=>cryptoPassSheet());

  /* ---------- A changes the password; B keeps syncing ---------- */
  const salt0 = fake.keys.get(U).salt;
  await toSettings(ap); await ap.click('[data-act=cxPass]'); await ap.waitForTimeout(650);
  await ap.fill('#sheet [data-role=cx0]', 'No es esta 1!'); await ap.fill('#sheet [data-role=cx1]', PW2); await ap.fill('#sheet [data-role=cx2]', PW2); await ap.click('#sheet .hbtn.ok');
  check('pass_wrong_current', await until(ap, ()=>document.querySelector('#sheet [data-role=cxerr]').textContent==='Contraseña incorrecta', null, 15000) && fake.keys.get(U).salt===salt0);
  await shot(ap, 'ip-light-pass-sheet');
  await ap.fill('#sheet [data-role=cx0]', PW1); await ap.click('#sheet .hbtn.ok');
  check('pass_changed', await until(ap, ()=>!document.querySelector('#sheet.on')&&LOG.some(e=>e.m==='Contraseña de cifrado cambiada'), null, 20000) && fake.keys.get(U).salt!==salt0 && fake.keys.get(U).kid===mid.key.kid, fake.keys.get(U));
  await settled(ap);
  await bp.evaluate(()=>updTask('a1', {notes:'Notas escritas en el ordenador'})); await synced(bp);
  check('B_still_syncs', isEnc(fake.t.tasks.get('a1').notes) && await until(ap, ()=>task('a1').notes==='Notas escritas en el ordenador'), fake.t.tasks.get('a1').notes);

  /* ---------- The session ends without «Cerrar sesión» (another app signed out globally): notice, key kept ---------- */
  const lost = async (page, desk, tag) => {
    await page.evaluate(()=>{ localStorage.removeItem('fake-session'); window.__fakeAuth(null, 'SIGNED_OUT'); }); // the session revoked elsewhere: signOut never called
    const shown = await until(page, ()=>document.getElementById('toast').classList.contains('on')&&document.getElementById('toastText').textContent==='Se ha cerrado la sesión. Inicia sesión para sincronizar');
    await toSettings(page, desk);
    const st = await page.evaluate(async()=>({user:!!SY.user, key:!!CR.key, idb:!!(await cryptoKeyLoad()), lost:!!syncState().lost, cells:[...document.querySelectorAll('.group-title')].find(x=>x.textContent==='Cuenta').nextElementSibling.textContent, log:LOG.some(e=>/La sesión se ha cerrado sin pedirlo/.test(e.m))}));
    check(tag+'_lost_notice', shown && !st.user && st.key && st.idb && st.lost && /Se ha cerrado la sesión\. Inicia sesión para sincronizar/.test(st.cells) && st.log, st);
    await page.evaluate(()=>{ document.querySelector('[data-act=signIn]').scrollIntoView({block:'center'}); }); await shot(page, tag==='B'?'desk-session-lost':'ip-dark-session-lost');
    const n0 = fake.calls.filter(c=>c===tag+':cryptoGet').length;
    await page.click('[data-act=signIn]');
    check(tag+'_back_no_password', await synced(page) && await page.evaluate(()=>!!CR.key&&!document.querySelector('#sheet.on')&&!syncState().lost) && fake.calls.filter(c=>c===tag+':cryptoGet').length>n0, fake.calls.filter(c=>c.startsWith(tag+':')).slice(-6)); };
  await lost(bp, true, 'B');

  /* ---------- C (iPhone, dark): the new password only ---------- */
  const C = await device(browser, {tag:'C', seed:SEED_B(), dark:true}); const cp=C.page;
  await signIn(cp); check('C_locked', await until(cp, ()=>SY.status==='locked') && await until(cp, ()=>!!document.querySelector('#sheet.on [data-role=cxpw]')));
  await cp.waitForTimeout(400); await shot(cp, 'ip-dark-unlock-sheet');
  await cp.fill('#sheet [data-role=cxpw]', PW1); await cp.click('#sheet .hbtn.ok');
  check('C_old_password_refused', await until(cp, ()=>document.querySelector('#sheet [data-role=cxerr]').textContent==='Contraseña incorrecta', null, 15000) && await cp.evaluate(()=>!CR.key));
  await cp.evaluate(()=>closeSheet()); await settled(cp); await toSettings(cp);
  s = await section(cp); const lineC = await account(cp);
  check('C_section_locked', s && s.cells.join('|')==='Falta la contraseña de cifrado|Desbloquear' && lineC==='Falta la contraseña de cifrado', {s, lineC});
  await shot(cp, 'ip-dark-section-locked');
  await cp.click('[data-act=cxUnlock]'); await cp.waitForTimeout(650); await cp.fill('#sheet [data-role=cxpw]', PW2); await cp.click('#sheet .hbtn.ok');
  check('C_new_password', await until(cp, ()=>!!CR.key&&!document.querySelector('#sheet.on'), null, 15000) && await synced(cp) && await cp.evaluate(()=>task('a1').notes==='Notas escritas en el ordenador'&&task('a3').title==='Llamar al fontanero hoy'));
  await settled(cp); s = await section(cp); check('C_section_on', s && /^Cifrado activado/.test(s.cells[0]), s); await shot(cp, 'ip-dark-section-on');
  await lost(cp, false, 'C');
  await sheetShot(cp, 'ip-dark-activate-sheet', ()=>{ const row=CR.row; CR.row=null; cryptoActivateSheet(); CR.row=row; });
  await sheetShot(cp, 'ip-dark-progress', ()=>{ CR.prog={n:120, of:840}; crProgSheet(); });
  await sheetShot(ap, 'ip-light-unlock-sheet', ()=>cryptoUnlockSheet());
  await sheetShot(ap, 'ip-light-progress-sim', ()=>{ CR.prog={n:120, of:840}; crProgSheet(); });
  // Signing out forgets the key of this device, in every window of the app, and the others do not call it a lost session
  const cp2 = await C.ctx.newPage(); fake.tags.set(cp2, 'C2'); cp2.on('pageerror', e=>errors.push('C2 pageerror: '+e.message));
  await cp2.exposeBinding('fakeServer', (src, op, a)=>fake.handle(src.page, op, a)); await cp2.addInitScript(fakeAdapter); await cp2.addInitScript(u=>{ window.__fakeUser=u; }, USER); await cp2.goto(URL0); await synced(cp2); await until(cp2, ()=>!!CR.key);
  await cp.click('[data-act=signOut]'); await cp.waitForTimeout(600); await cp.click('#asheet .it[data-i="0"]');
  check('C_signout_forgets', await until(cp, async()=>!SY.user&&!CR.key&&!(await cryptoKeyLoad())) , await cp.evaluate(()=>LOG.slice(-4).map(e=>e.m)));
  await cp2.evaluate(()=>window.__fakeAuth(null, 'SIGNED_OUT')); await cp2.waitForTimeout(300);
  const c2 = await cp2.evaluate(()=>({key:!!CR.key, user:!!SY.user, lost:!!syncState().lost, toast:document.getElementById('toast').classList.contains('on')&&document.getElementById('toastText').textContent}));
  check('C_other_window', !c2.key && !c2.user && !c2.lost && !/Se ha cerrado la sesión/.test(c2.toast||''), c2);

  /* ---------- A device on an older version: refused, and it says so ---------- */
  const O = await device(browser, {tag:'O', seed:SEED_B(), old:true}); const op=O.page;
  await signIn(op);
  check('old_refused', await until(op, ()=>SY.status==='error'&&syncLine()==='Actualiza la app: el cifrado está activado'&&LOG.some(e=>/^Actualiza la app: el cifrado está activado/.test(e.m)), null, 15000) && fake.refused>0 && plainLeft().length===0,
    {st:await op.evaluate(()=>({s:SY.status, e:SY.error, line:syncLine()})), refused:fake.refused, left:plainLeft()});
  await op.waitForTimeout(300); await shot(op, 'ip-light-old-device');
  // That older version kept the server's ciphertext as text and moved its cursors past it; say its pass had finished (owner set)
  const oldKept = await op.evaluate(()=>{ const st=syncState(); st.owner=SY.user.id; syncWrite(st); const x=task('a1'); return {t:x&&x.title, cur:!!st.cursor.tasks}; });
  check('old_kept_cipher', /^e1:[A-Za-z0-9_-]{30}/.test(oldKept.t||'') && oldKept.cur, oldKept);
  // Updated to this version: the password, then the encrypted tables come again and the ciphertext kept here goes back to text
  await op.evaluate(()=>localStorage.setItem('__updated','1')); await op.reload(); await op.waitForTimeout(600);
  check('old_updated_locked', await until(op, ()=>SY.status==='locked'&&!!document.querySelector('#sheet.on [data-role=cxpw]')));
  await op.fill('#sheet [data-role=cxpw]', PW2); await op.click('#sheet .hbtn.ok');
  check('old_updated_unlocked', await until(op, ()=>!!CR.key&&!document.querySelector('#sheet.on'), null, 15000) && await synced(op));
  const Ox = await op.evaluate(()=>({t:task('a1')&&task('a1').title, p:proj('p1')&&proj('p1').name, any:/e1:[A-Za-z0-9_-]{30}/.test(JSON.stringify(DB)), log:LOG.map(e=>e.m).filter(m=>/^Cifrado:/.test(m))}));
  const a1now = fake.t.tasks.get('a1').title, a1dec = await ap.evaluate(async([v])=>cryptoDec(CR.key, v, cryptoAad('tasks','title')), [a1now]);
  check('old_repaired', Ox.t==='Preparar comité de dirección' && Ox.p==='FLC' && !Ox.any && Ox.log.includes('Cifrado: las tablas cifradas se descargan enteras una vez') && Ox.log.includes('Cifrado: textos guardados cifrados en este dispositivo vuelven a ser texto'), Ox);
  check('old_never_double', a1dec==='Preparar comité de dirección' && plainLeft().length===0, {a1dec});
  // The upload layer keeps a value that already opens as it is (never encrypted twice), and encrypts one that does not
  const seal = await op.evaluate(async([v])=>{ const o=await cryptoSealRow(CR.key, 'tasks', {id:'a1', title:v, notes:'e1:nota que no abre'}); return {same:o.title===v, notes:o.notes!=='e1:nota que no abre'&&o.notes.startsWith('e1:')&&(await cryptoDec(CR.key, o.notes, cryptoAad('tasks','notes')))==='e1:nota que no abre'}; }, [a1now]);
  check('seal_keeps_cipher', seal.same && seal.notes, seal);
  // The pull opens with the key kept on the device even when this window has lost it from memory (7), and with a key of this user when the
  // account looks off; never as text (5)
  const pk = await op.evaluate(async()=>{ CR.key=null; CR.kid=null; CR.owner=null; const a=await SY.remote.pull('tasks', null, 1000); const one=!!CR.key;
    return {one, a:a.some(r=>r.id==='a1'&&r.title==='Preparar comité de dirección')&&!a.some(r=>/^e1:[A-Za-z0-9_-]{30}/.test(r.title||''))}; });
  fake.hide=true; const pk2 = await op.evaluate(async()=>{ CR.force=true; const a=await SY.remote.pull('tasks', null, 1000); return a.some(r=>r.id==='a1'&&r.title==='Preparar comité de dirección')&&!a.some(r=>/^e1:[A-Za-z0-9_-]{30}/.test(r.title||'')); }); fake.hide=false;
  await op.evaluate(()=>{ CR.force=true; return crFetch(SY.user); });
  check('pull_stored_and_off_key', pk.one && pk.a && pk2, {pk, pk2});

  /* ---------- A database without the migration: the rest syncs, Cifrado cannot be activated ---------- */
  const D = await device(browser, {tag:'D', seed:{spaces:[{id:'trabajo',name:'Trabajo',order:0,created:T0}], projects:[], tasks:[tk('d1', {title:'Tarea de D'})], voiceNotes:[], settings:{tipsSeen:true}}, absent:true, user:{uid:'9b2f6d3e-0000-4000-8000-00000000d001', email:'d@example.com'}}); const dp=D.page;
  await signIn(dp); check('D_syncs', await synced(dp));
  await toSettings(dp); s = await section(dp);
  check('D_absent', s && s.cells.join('|')==='CifradoNo disponible' && /Falta poner al día Supabase con 0012_encryption\.sql/.test(s.foot) && await dp.evaluate(()=>LOG.filter(e=>/crypto_keys: falta 0012_encryption\.sql/.test(e.m)).length===1)
    && fake.t.tasks.get('d1').title==='Tarea de D', s);
  const DU='9b2f6d3e-0000-4000-8000-00000000d001';
  fake.put(DU, 'tasks', {id:'dx', title:'e1:'+'C'.repeat(60), notes:'', status:'pending', priority:'none', date:today, modified:new Date().toISOString(), created:new Date().toISOString()});
  const dGets = await dp.evaluate(async()=>{ const n0=window.__cg||0; CR.force=true; await syncRun('prueba'); return (window.__cg||0)-n0; }); await synced(dp);
  check('D_off_text_as_text', await dp.evaluate(()=>task('dx')&&task('dx').title==='e1:'+'C'.repeat(60)) && dGets===1, {dGets});
  const busyUp = await dp.evaluate(async()=>{ CR.busy=true; try{ await SY.remote.fileUpload(SY.user.id+'/d1/x.jpg', new Blob(['abc'], {type:'image/jpeg'}), 'image/jpeg'); return 'sent'; }catch(e){ return e.code; } finally{ CR.busy=false; } });
  check('D_busy_upload_waits', busyUp==='tareas_wait' && !fake.store.has(DU+'/d1/x.jpg'), busyUp);
  await D.ctx.close();
  /* ---------- Turned on elsewhere while this device thought it was off: the refusal makes it look again ---------- */
  const V='9b2f6d3e-0000-4000-8000-00000000e001', E = await device(browser, {tag:'E', seed:{spaces:[{id:'trabajo',name:'Trabajo',order:0,created:T0}], projects:[], tasks:[tk('e1', {title:'Tarea de E'})], voiceNotes:[], settings:{tipsSeen:true}}, user:{uid:V, email:'e@example.com'}}); const ep=E.page;
  await signIn(ep); check('E_off_synced', await synced(ep) && fake.t.tasks.get('e1').title==='Tarea de E');
  fake.keys.set(V, Object.assign({}, fake.keys.get(U))); // another device of this account has just turned encryption on
   await ep.evaluate(()=>updTask('e1', {title:'Tarea de E cambiada'}));
  check('E_refused_then_locked', await until(ep, ()=>SY.status==='locked'&&syncLine()==='Falta la contraseña de cifrado'&&!!document.querySelector('#sheet.on [data-role=cxpw]')&&LOG.some(e=>/El servidor pide texto cifrado/.test(e.m)), null, 15000)
    && fake.t.tasks.get('e1').title==='Tarea de E', await ep.evaluate(()=>({s:SY.status, e:SY.error, log:LOG.slice(-5).map(x=>x.m)})));
  // A file never goes up plain on a cached «off»: the upload layer reads the key row first
  const eUp = await ep.evaluate(async()=>{ CR.row=null; CR.at=Date.now(); try{ await SY.remote.fileUpload(SY.user.id+'/e1/x.jpg', new Blob(['abc'], {type:'image/jpeg'}), 'image/jpeg'); return 'sent'; }catch(e){ return e.code; } });
  check('E_plain_upload_rechecks', eUp==='tareas_locked' && !fake.store.has(V+'/e1/x.jpg'), eUp);
  await E.ctx.close();

  /* ---------- G: the server's answer to the key row is lost and the row cannot be read either: key and flag stay, the next pass decides ---------- */
  const W='9b2f6d3e-0000-4000-8000-00000000f001', G = await device(browser, {tag:'G', seed:{spaces:[{id:'trabajo',name:'Trabajo',order:0,created:T0}], projects:[], tasks:[tk('g1', {title:'Tarea de G'})], voiceNotes:[], settings:{tipsSeen:true}}, user:{uid:W, email:'g@example.com'}}); const gp=G.page;
  await signIn(gp); check('G_synced', await synced(gp));
  fake.lose={put:1, afterPut:2};
  await gp.evaluate(pw=>cryptoActivate(pw), PW1);
  const g1 = await gp.evaluate(async()=>({f:crFlag(), idb:!!(await cryptoKeyLoad()), key:!!CR.key, toast:document.getElementById('toastText').textContent}));
  check('G_unknown_kept', !!g1.f && g1.idb && !g1.key && g1.toast==='No se pudo confirmar el cifrado. Se comprobará al sincronizar' && fake.keys.has(W) && fake.keys.get(W).kid===g1.f.kid, g1);
  fake.lose={}; await gp.evaluate(()=>syncRun('prueba'));
  check('G_confirmed_and_migrated', await until(gp, ()=>!crFlag()&&!!CR.key&&CR.row&&!!CR.row.migrated, null, 30000) && !!fake.keys.get(W).migrated && isEnc(fake.t.tasks.get('g1').title), await gp.evaluate(()=>({f:crFlag(), row:CR.row, log:LOG.slice(-8).map(e=>e.m)})));
  // The work of a device lost midway: any device with the key finishes it while the row says it is not done
  fake.keys.get(W).migrated=null; fake.put(W, 'tasks', {id:'g2', title:'Dejada en claro', notes:'', status:'pending', priority:'none', date:today, modified:new Date().toISOString(), created:new Date().toISOString()});
  await gp.evaluate(()=>{ CR.force=true; CR.resumeAt=0; return syncRun('prueba'); });
  // (waits on the server: this device's own copy of the row says done until the next pass reads it again)
  for(let t0=Date.now(); Date.now()-t0<30000 && !(isEnc(fake.t.tasks.get('g2').title) && fake.keys.get(W).migrated); ) await sleep(200);
  check('G_other_device_finishes', isEnc(fake.t.tasks.get('g2').title) && !!fake.keys.get(W).migrated && await until(gp, ()=>CR.row&&!!CR.row.migrated&&!CR.migrating, null, 20000), {g2:fake.t.tasks.get('g2').title, m:fake.keys.get(W).migrated});
  // A passing error of the server (PGRST002, a schema cache loading) stops the run and never marks it done; it is not a missing table
  check('absent_strict', await gp.evaluate(()=>['subtasks','project_notes','contacts','attachments','inbox'].every(t=>!syncAbsent(new Set(), t, {code:'PGRST002', message:'Could not query the database for the schema cache. Retrying.'}))));
  fake.keys.get(W).migrated=null; fake.put(W, 'subtasks', {id:'gs1', task_id:'g1', title:'Paso en claro', done:false, sort_order:0, modified:new Date().toISOString(), created:new Date().toISOString()}); 
  await synced(gp);
  // the migration's own scan meets the passing error (a sync pass running meanwhile must not take it instead)
  await gp.evaluate(async()=>{ await crFetch(SY.user); CR.resumeAt=0; const orig=crScan; let n=1;
    crScan=async(R, table, fn)=>{ if(table==='subtasks'&&n>0){ n--; return orig(Object.assign(Object.create(R), {pull:async()=>{ throw new Error('PGRST002 Could not query the database for the schema cache. Retrying.'); }}), table, fn); } return orig(R, table, fn); };
    try{ await cryptoMigrate(); } finally{ crScan=orig; } });
  check('G_transient_not_done', fake.keys.get(W).migrated===null && fake.t.subtasks.get('gs1').title==='Paso en claro' && await gp.evaluate(()=>LOG.some(e=>/^Cifrado interrumpido: PGRST002/.test(e.m))));
  await gp.evaluate(async()=>{ CR.resumeAt=0; await cryptoMigrate(); });
  check('G_transient_then_done', !!fake.keys.get(W).migrated && isEnc(fake.t.subtasks.get('gs1').title));
  // Done already on the server (another device): a run that thinks it is not reads the row under the lock and does nothing
  const gSkip = await gp.evaluate(async()=>{ const n0=LOG.filter(e=>e.m==='Cifrado: cifrando los datos del servidor').length; CR.row.migrated=null; CR.resumeAt=0; await cryptoMigrate();
    return {scans:LOG.filter(e=>e.m==='Cifrado: cifrando los datos del servidor').length-n0, said:LOG.some(e=>e.m==='Cifrado: el servidor ya estaba cifrado'), migrated:!!CR.row.migrated}; });
  check('G_done_elsewhere_skips', gSkip.scans===0 && gSkip.said && gSkip.migrated, gSkip);
  // A file that keeps failing: tried three times, then set aside so the rest is marked done; Ajustes says so
  const PG=W+'/g1/mal.jpg'; fake.store.set(PG, {b64:PHOTO.toString('base64'), mime:'image/jpeg'}); fake.failPath=PG; fake.keys.get(W).migrated=null;
  fake.put(W, 'attachments', {id:'pg1', task_id:'g1', kind:'photo', path:PG, mime:'image/jpeg', size:PHOTO.length, width:10, height:10, duration_ms:null, purged:null, modified:new Date().toISOString(), created:new Date().toISOString()});
  for(let i=0;i<8&&!fake.keys.get(W).migrated;i++){ await synced(gp); await gp.evaluate(async()=>{ await crFetch(SY.user); CR.resumeAt=0; await cryptoMigrate(); }); await until(gp, ()=>!CR.migrating); }
  fake.failPath=null; await toSettings(gp); s = await section(gp);
  const gsa = 'G_file_set_aside'; check(gsa, !!fake.keys.get(W).migrated && s && s.cells.includes('1 archivo no se pudo cifrar') && await gp.evaluate(()=>LOG.filter(e=>/no se ha podido cifrar/.test(e.m)).length===3), {s, migrated:fake.keys.get(W).migrated});
  // Set aside, tried again about once a day: once it goes through it leaves the list and Ajustes no longer counts it
  await gp.evaluate(()=>{ const F=crFiles(CR.kid); F.asideAt=0; crFilesWrite(F); return crRetryAside(); }); await gp.waitForTimeout(300);
  s = await section(gp);
  check('G_aside_retried', Buffer.from(fake.store.get(PG).b64,'base64').slice(0,8).toString()==='TAREASE1' && await gp.evaluate(()=>crAside()===0) && s && !s.cells.some(c=>/no se pud/.test(c)), s);
  // A rate limit (or 401, 403, 408) on a file is a failure to retry, never «not found»: the file is not counted as done while plain
  const PR=W+'/g1/limite.jpg'; fake.store.set(PR, {b64:PHOTO.toString('base64'), mime:'image/jpeg'}); fake.rateLimitPath=PR; fake.keys.get(W).migrated=null;
  fake.put(W, 'attachments', {id:'pr1', task_id:'g1', kind:'photo', path:PR, mime:'image/jpeg', size:PHOTO.length, width:10, height:10, duration_ms:null, purged:null, modified:new Date().toISOString(), created:new Date().toISOString()});
  await synced(gp); await gp.evaluate(async()=>{ await crFetch(SY.user); CR.resumeAt=0; await cryptoMigrate(); });
  const rl = {m:fake.keys.get(W).migrated, done:await gp.evaluate(p=>crFiles(CR.kid).done.includes(p), PR)};
  fake.rateLimitPath=null; await synced(gp); await gp.evaluate(async()=>{ await crFetch(SY.user); CR.resumeAt=0; await cryptoMigrate(); });
  check('G_rate_limit_retried', rl.m===null && !rl.done && !!fake.keys.get(W).migrated && Buffer.from(fake.store.get(PR).b64,'base64').slice(0,8).toString()==='TAREASE1', rl);
  // The migration sends only id, modified and the encrypted columns: a change made meanwhile without touching modified stays
  fake.keys.get(W).migrated=null; fake.put(W, 'tasks', {id:'g4', title:'Cuarta en claro', notes:'', status:'pending', priority:'none', date:'2099-01-01', modified:new Date().toISOString(), created:new Date().toISOString()});
  fake.hook={table:'tasks', id:'g4', keys:null, fn:row=>{ row.priority='high'; row.date='2099-02-02'; }};
  await synced(gp); await gp.evaluate(async()=>{ await crFetch(SY.user); CR.resumeAt=0; await cryptoMigrate(); });
  const g4=fake.t.tasks.get('g4');
  check('G_migration_columns_only', fake.hook.keys && fake.hook.keys.join()==='id,modified,notes,title' && g4.priority==='high' && g4.date==='2099-02-02' && isEnc(g4.title) && !!fake.keys.get(W).migrated, {keys:fake.hook.keys, g4});
  fake.hook=null;
  // Password change: the answer lost (the row tells it went through); another device changed it meanwhile (nothing overwritten)
  fake.lose={patch:1}; const pc1 = await gp.evaluate(([a,b])=>cryptoChangePassword(a,b), [PW1, PW2]); const w1=fake.keys.get(W).wrapped;
  fake.racePatch=true; const pc2 = await gp.evaluate(([a,b])=>cryptoChangePassword(a,b), [PW2, PW1]);
  check('G_password_answers', pc1==='ok' && pc2==='other' && fake.keys.get(W).wrapped==='cambiada-en-otro-dispositivo' && w1!=='cambiada-en-otro-dispositivo', {pc1, pc2});
  // A schema cache still loading (PGRST002) is not a missing table; PGRST205 is
  check('absent_codes', await gp.evaluate(()=>!syncAbsent(new Set(), 'crypto_keys', {code:'PGRST002', message:'Could not query the database for the schema cache. Retrying.'}) && syncAbsent(new Set(), 'crypto_keys', {code:'PGRST205', message:"Could not find the table 'public.crypto_keys' in the schema cache"})));
  await G.ctx.close();

  /* ---------- The service worker: an encrypted reminder shows in clear ---------- */
  const pay = {title:fake.t.tasks.get('a1').title, body:fake.t.projects.get('p1').name, tag:'a1', data:{taskId:'a1', projectId:'p1', url:'./?task=a1'}};
  const helper = await ap.evaluate(async([p])=>({ok:await cryptoPushPayload(p), wrong:await cryptoPushPayload(Object.assign({}, p, {title:'e1:'+'A'.repeat(60)})), plain:await cryptoPushPayload({title:'Hola', body:'FLC', data:{}})}), [pay]);
  check('push_helper', helper.ok.title==='Preparar comité de dirección' && helper.ok.body==='FLC' && helper.wrong.title==='Recordatorio' && helper.wrong.body==='FLC' && helper.plain.title==='Hola', helper);
  const cdp=await A.ctx.newCDPSession(ap); let regId=null; cdp.on('ServiceWorker.workerRegistrationUpdated', e=>e.registrations.forEach(x=>{ if(!x.isDeleted) regId=x.registrationId; }));
  await cdp.send('ServiceWorker.enable'); await until(ap, ()=>navigator.serviceWorker.controller!==null, null, 6000); await ap.waitForTimeout(300);
  const sw=A.ctx.serviceWorkers()[0];
  await cdp.send('ServiceWorker.deliverPushMessage', {origin:URL0, registrationId:String(regId), data:JSON.stringify(pay)}); await ap.waitForTimeout(900);
  let shown = sw ? await sw.evaluate(async()=>(await self.registration.getNotifications()).map(x=>({title:x.title, body:x.body, tag:x.tag}))) : null;
  check('sw_push_decrypted', shown && shown.some(x=>x.tag==='a1'&&x.title==='Preparar comité de dirección'&&x.body==='FLC'), shown);
  // Without the key on the device: «Recordatorio», nothing secret
  await ap.evaluate(()=>cryptoKeyForget()); await sw.evaluate(async()=>{ for(const n of await self.registration.getNotifications()) n.close(); });
  await cdp.send('ServiceWorker.deliverPushMessage', {origin:URL0, registrationId:String(regId), data:JSON.stringify(Object.assign({}, pay, {tag:'a1b'}))}); await ap.waitForTimeout(900);
  shown = await sw.evaluate(async()=>(await self.registration.getNotifications()).map(x=>({title:x.title, body:x.body, tag:x.tag})));
  check('sw_push_without_key', shown.some(x=>x.tag==='a1b'&&x.title==='Recordatorio'&&x.body===''), shown);
  await A.ctx.close(); await B.ctx.close(); await C.ctx.close(); await O.ctx.close();
}

(async()=>{
  await new Promise(res=>srv.listen(PORT,res)); const browser = await chromium.launch({channel:'chromium'}); // the new headless mode shows notifications (as rm-P)
  try{ await sqlTests(); await appTests(browser); }
  catch(e){ fails.push('exception'); errors.push(String(e&&e.stack||e)); }
  console.log(JSON.stringify({r, fails, errors}, null, 1));
  await browser.close(); srv.close(); process.exit(fails.length||errors.length?1:0);
})();
