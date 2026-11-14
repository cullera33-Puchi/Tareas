require('./lib/out.js'); // outputs (screenshots, downloads) go to tests/out
// Decision 63b, c and d (the team, decision 71). Port 8810 (8810 to 8829 reserved for the team: rm-TM, rm-AV, rm-QT). Screenshots in tests/out/TM.
//  1. SQL: supabase/migrations/0013_team.sql (no DROP) run twice in PGlite after 0001 to 0012, with stand-ins for auth (users with email,
//     confirmation, creation time and metadata), Storage (objects with metadata) and the Auth admin role. The oldest account becomes the
//     admin; tareas_team_me links an invitation by the confirmed email and takes the Google name; the restrictive gate on every table:
//     a stranger reads and writes nothing (not even rows of their own), a member writes synced data only with the encryption key row,
//     removing the access blocks reads and writes at once; admin-only functions; the Auth hook; the directory (names, emails, keys);
//     notices (4 hours per task and person, recipient checks, who reads and marks); feedback (only the admin reads it); the storage
//     quota; the removal after 30 days (never an admin or an active member, logged); a fresh project whose first account becomes the
//     admin. Then all.sql twice and check.sql all OK.
//  2. send-reminders under Deno against a fake PostgREST and Storage: the push of a notice («Enric te ha enviado una tarea») and of a
//     suggestion («Nueva sugerencia»), each once, nothing of the content; reminders of an account without access not sent; the removal
//     after 30 days (files through the Storage API first, then the rows); before 0013 nothing of this runs and the rest works.
//  3. The app against an in-memory fake (see the second part of this file).
const { chromium } = require('playwright');
const http = require('http'); const fs = require('fs'); const path = require('path'); const { spawn } = require('child_process'); const crypto = require('crypto');
const ROOT = path.resolve(__dirname, '..'), PORT = 8810, REST_PORT = 8811, FN_PORT = 8812, PUSH_PORT = 8813, URL0 = 'http://localhost:'+PORT+'/';
const OUT = path.join(__dirname, 'out', 'TM'); fs.mkdirSync(OUT, {recursive:true});
const DEPS = path.join(ROOT, 'node_modules');
const r={}, fails=[], errors=[]; const check=(name, ok, info)=>{ r[name]=ok?true:(info===undefined?false:info); if(!ok) fails.push(name); };
const sleep=ms=>new Promise(res=>setTimeout(res,ms));

/* ======================= 1. SQL ======================= */
async function pgSetup(){
  const { PGlite } = await import(path.join(DEPS, '@electric-sql/pglite/dist/index.js'));
  const db = new PGlite();
  await db.exec(`
    create role authenticated; create role anon; create role service_role; create role supabase_auth_admin; create schema auth; create schema extensions;
    create table auth.users (id uuid primary key, email text, email_confirmed_at timestamptz, created_at timestamptz default now(), raw_user_meta_data jsonb default '{}');
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
    grant usage on schema auth to authenticated, anon; grant execute on function auth.uid() to authenticated, anon;
    create schema cron; create table cron.job (jobid serial primary key, jobname text unique, schedule text, command text);
    create function cron.schedule(n text, s text, c text) returns bigint language sql as $$ insert into cron.job (jobname, schedule, command) values (n, s, c) returning jobid $$;
    create function cron.unschedule(n text) returns boolean language sql as $$ delete from cron.job where jobname = n returning true $$;
    create schema net; create function net.http_post(url text, body jsonb default '{}', params jsonb default '{}', headers jsonb default '{}', timeout_milliseconds int default 5000) returns bigint language sql as $$ select 1::bigint $$;
    create schema storage;
    create table storage.buckets (id text primary key, name text not null, public boolean default false, file_size_limit bigint, allowed_mime_types text[], created_at timestamptz default now());
    create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets (id), name text, owner uuid, metadata jsonb, created_at timestamptz default now(), unique (bucket_id, name));
    create function storage.foldername(name text) returns text[] language plpgsql as $$ declare p text[]; begin p := string_to_array(name, '/'); return p[1:array_length(p, 1) - 1]; end $$;
    alter table storage.objects enable row level security;
    grant usage on schema storage to authenticated, anon; grant select, insert, update, delete on storage.objects to authenticated;
    grant usage on schema public to service_role, authenticated;
  `);
  return db; }
const strip = s => s.replace(/^create extension if not exists pg_(cron|net).*$/mg, '-- (extension stand-in)');
const MIGS = ['0001_init.sql','0002_push.sql','0003_attachments.sql','0004_repeat_focus.sql','0005_subtasks.sql','0006_project_notes.sql','0007_deadline.sql','0008_estimate_postponed.sql','0009_closed_day.sql','0010_inbox.sql','0011_contacts.sql','0012_encryption.sql'];
const E='00000000-0000-4000-8000-0000000000e1', S='00000000-0000-4000-8000-0000000000e2', X='00000000-0000-4000-8000-0000000000e3', P='00000000-0000-4000-8000-0000000000e4';
async function sqlTests(){
  const rd = f => fs.readFileSync(path.join(ROOT, 'supabase/migrations', f), 'utf8');
  const mig = rd('0013_team.sql'), body = mig.split('\n').filter(l=>!/^\s*--/.test(l)).join('\n');
  check('sql_no_drop', !/\bdrop\b/i.test(mig), mig.match(/.*\bdrop\b.*/gi));
  let db = await pgSetup();
  for(const f of MIGS) await db.exec(strip(rd(f)));
  // The accounts that exist when it runs: Enric first
  await db.exec(`insert into auth.users (id, email, email_confirmed_at, created_at, raw_user_meta_data) values
    ('${E}', 'enric@example.com', now(), '2026-10-01', '{"full_name":"Enric Vidal"}'),
    ('${S}', 'Susana@Example.com', now(), '2026-11-05', '{"full_name":"Susana Gil"}'),
    ('${X}', 'extrana@example.com', now(), '2026-11-05 10:00', '{}'),
    ('${P}', 'pablo@example.com', null, '2026-11-05 11:00', '{"name":"Pablo"}')`);
  let err = null; try { await db.exec(mig); await db.exec(mig); } catch(e){ err = e.message; }
  check('sql_runs_twice', !err, err);
  const q = async (sql, params) => (await db.query(sql, params)).rows;
  const tryq = async (sql, params) => { try { return {rows: await q(sql, params)}; } catch(e){ return {error: e.message, detail: e.detail}; } };
  const as = async (uid, fn, role) => { await db.exec(`set test.uid = '${uid}'; set role ${role||'authenticated'};`); try { return await fn(); } finally { await db.exec(`reset role; reset test.uid;`); } };
  const me = uid => as(uid, async()=>(await q(`select public.tareas_team_me() m`))[0].m);
  // The admin: the oldest account, once
  const tm = await q(`select email, name, role, quota, user_id from public.team_members order by created`);
  check('sql_bootstrap_admin', tm.length===1 && tm[0].role==='admin' && tm[0].user_id===E && tm[0].quota===null && tm[0].name==='Enric Vidal' && tm[0].email==='enric@example.com', tm);
  const pol = await q(`select tablename, policyname, permissive from pg_policies where policyname like '%team_gate' order by 1`);
  check('sql_gate_policies', pol.length===13 && pol.every(p=>p.permissive==='RESTRICTIVE') && pol.map(p=>p.tablename).join()==='attachments,contacts,crypto_keys,inbox,objects,project_notes,projects,push_subscriptions,shortcut_keys,spaces,subtasks,tasks,voice_notes', pol);
  const meE = await me(E), meX = await me(X);
  check('sql_me', meE && meE.role==='admin' && meE.quota===null && meE.used===0 && meX===null, {meE, meX});
  // Data written before: Enric's task (he is admin, no key needed), a stranger's row written by the service (any way in)
  const ins = (id, title) => `insert into public.tasks (id, title, modified) values ('${id}', '${title}', now()) returning id`;
  const eT = await as(E, () => tryq(ins('te1', 'De Enric')));
  await db.exec(`insert into public.tasks (id, owner_id, title, modified) values ('tx0', '${X}', 'De la extraña', now())`);
  const xSel = await as(X, () => tryq(`select id from public.tasks`)), xIns = await as(X, () => tryq(ins('tx1', 'Intento')));
  const xUpd = await as(X, () => tryq(`update public.tasks set title = 'cambio', modified = now() + interval '1 day' where id = 'tx0' returning id`));
  const xKey = await as(X, () => tryq(`insert into public.crypto_keys (kid, salt, iterations, wrapped) values ('kx', 's', 1, 'w') returning owner_id`));
  const xStore = await as(X, () => tryq(`insert into storage.objects (bucket_id, name, metadata) values ('attachments', '${X}/t/a.jpg', '{"size":10}') returning id`));
  check('sql_stranger_blocked', eT.rows && eT.rows.length===1 && xSel.rows && xSel.rows.length===0 && /row-level security/.test(xIns.error||'') && xUpd.rows && xUpd.rows.length===0 && /row-level security/.test(xKey.error||'') && /row-level security/.test(xStore.error||''), {eT, xSel, xIns, xUpd, xKey, xStore});
  // Admin-only calls
  const sList = await as(S, () => tryq(`select * from public.tareas_team_list()`)), sInv = await as(S, () => tryq(`select public.tareas_team_invite('x@example.com')`));
  const bad = await as(E, () => tryq(`select public.tareas_team_invite('no es correo')`));
  const inv = await as(E, () => tryq(`select public.tareas_team_invite('  SUSANA@example.com ', 'Susana') id`));
  const invP = await as(E, () => tryq(`select public.tareas_team_invite('pablo@example.com') id`));
  const inv2 = await as(E, () => tryq(`select public.tareas_team_invite('susana@example.com') id`));
  check('sql_admin_only', /tareas_team_admin_only/.test(sList.error||'') && /tareas_team_admin_only/.test(sInv.error||'') && /tareas_team_bad_email/.test(bad.error||'') && inv.rows && inv2.rows && inv.rows[0].id===inv2.rows[0].id, {sList, sInv, bad, inv, inv2});
  // Susana signs in: linked by her confirmed email (any case), Google's name kept only when the invitation has none; Pablo's email is not confirmed
  const meS = await me(S), meP = await me(P);
  const sRow = (await q(`select user_id, name, last_access is not null la, quota from public.team_members where lower(email) = 'susana@example.com'`))[0];
  check('sql_link_invited', meS && meS.role==='member' && meS.quota===52428800 && sRow.user_id===S && sRow.name==='Susana' && sRow.la && meP===null, {meS, meP, sRow});
  // A member writes synced data only with the encryption key row (decision 71.1)
  const sNoKey = await as(S, () => tryq(ins('ts1', 'e1:AAAA')));
  const sNoKeyFile = await as(S, () => tryq(`insert into storage.objects (bucket_id, name, metadata) values ('attachments', '${S}/t/clear.jpg', '{"size":10}') returning id`));
  const sKey = await as(S, () => tryq(`insert into public.crypto_keys (kid, salt, iterations, wrapped, ecdh_pub, ecdh_priv) values ('ks', 's', 1, 'w', 'PUBS', 'e1:priv') returning owner_id`));
  const sYes = await as(S, () => tryq(ins('ts1', 'e1:AAAA'))), sSee = await as(S, () => tryq(`select id from public.tasks order by id`)), eSee = await as(E, () => tryq(`select id from public.tasks order by id`));
  check('sql_member_needs_key', /row-level security/.test(sNoKey.error||'') && /row-level security/.test(sNoKeyFile.error||'') && sKey.rows && sYes.rows && sYes.rows.length===1 && sSee.rows.map(x=>x.id).join()==='ts1' && eSee.rows.map(x=>x.id).join()==='te1', {sNoKey, sNoKeyFile, sKey, sYes, sSee, eSee});
  // The directory: names, emails and public keys of the active, linked members; nothing for a stranger
  const dS = await as(S, () => tryq(`select * from public.tareas_team_directory()`)), dX = await as(X, () => tryq(`select * from public.tareas_team_directory()`));
  check('sql_directory', dS.rows && dS.rows.length===2 && dS.rows.map(d=>d.email+':'+(d.pub||'')+':'+d.admin).join()==='enric@example.com::true,susana@example.com:PUBS:false' && Object.keys(dS.rows[0]).join()==='user_id,name,email,pub,admin' && dX.rows && dX.rows.length===0, {dS, dX});
  const lst = await as(E, () => tryq(`select email, role, quota, used, joined, has_key from public.tareas_team_list()`));
  check('sql_list', lst.rows && lst.rows.map(x=>x.email+':'+x.role+':'+x.joined+':'+x.has_key).join()==='enric@example.com:admin:true:false,pablo@example.com:member:false:false,susana@example.com:member:true:true', lst);
  // The Auth hook: an invited email in, others out (a removed one too)
  const hook = async em => (await q(`select public.tareas_before_user_created($1::jsonb) r`, [JSON.stringify({user:{email:em}, metadata:{}})]))[0].r;
  const h1 = await hook('Pablo@Example.com'), h2 = await hook('nadie@example.com');
  const hookPriv = await as(S, () => tryq(`select public.tareas_before_user_created('{}'::jsonb)`));
  const hookGrant = (await q(`select has_function_privilege('supabase_auth_admin', 'public.tareas_before_user_created(jsonb)', 'EXECUTE') g`))[0].g;
  check('sql_hook', JSON.stringify(h1)==='{}' && h2.error && h2.error.http_code===403 && h2.error.message==='Esta cuenta no tiene acceso' && /permission denied/.test(hookPriv.error||'') && hookGrant, {h1, h2, hookPriv, hookGrant});
  // Notices: Susana tells Enric; the same task waits 4 hours; never to herself or to a stranger
  const note = (to, ref) => `insert into public.team_notices (recipient_id, task_ref, payload) values ('${to}', '${ref}', 't1:xyz') returning id, sender_id, pushed`;
  const n1 = await as(S, () => tryq(note(E, 'ts1'))), n2 = await as(S, () => tryq(note(E, 'ts1'))), n3 = await as(S, () => tryq(note(E, 'ts2')));
  const n4 = await as(S, () => tryq(note(S, 'ts3'))), n5 = await as(S, () => tryq(note(X, 'ts3'))), n6 = await as(X, () => tryq(note(E, 'tx1')));
  const nForge = await as(S, () => tryq(`insert into public.team_notices (sender_id, recipient_id, task_ref, payload, pushed) values ('${E}', '${E}', 'f', 't1:x', now()) returning sender_id, pushed`));
  check('sql_notice_rules', n1.rows && n1.rows[0].sender_id===S && n1.rows[0].pushed===null && /tareas_notice_too_soon/.test(n2.error||'') && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(n2.detail||'') && n3.rows && /tareas_notice_bad_recipient/.test(n4.error||'') && /tareas_notice_bad_recipient/.test(n5.error||'') && !!n6.error && nForge.rows && nForge.rows[0].sender_id===S && nForge.rows[0].pushed===null, {n1, n2, n3, n4, n5, n6, nForge});
  await db.exec(`update public.team_notices set created = now() - interval '4 hours 1 minute' where task_ref = 'ts1'`);
  const n7 = await as(S, () => tryq(note(E, 'ts1')));
  const eN = await as(E, () => tryq(`select task_ref from public.team_notices order by task_ref`)), xN = await as(X, () => tryq(`select id from public.team_notices`));
  const eTake = await as(E, () => tryq(`update public.team_notices set taken = now() where task_ref = 'ts2' returning id`));
  const sTake = await as(S, () => tryq(`update public.team_notices set dismissed = now() where task_ref = 'ts1' returning id`));
  const ePay = await as(E, () => tryq(`update public.team_notices set payload = 'x' returning id`));
  check('sql_notice_access', n7.rows && eN.rows.map(x=>x.task_ref).join()==='f,ts1,ts1,ts2' && xN.rows.length===0 && eTake.rows.length===1 && sTake.rows.length===0 && /permission denied/.test(ePay.error||''), {n7, eN, xN, eTake, sTake, ePay});
  // Feedback: to the admin only; only the admin reads it and sets its status
  const fb = (to, kind) => `insert into public.team_feedback (recipient_id, kind, payload) values ('${to}', '${kind}', 't1:fb')`; // the sender cannot read it back: no returning
  const f1 = await as(S, () => tryq(fb(E, 'incidencia'))), f2 = await as(S, () => tryq(fb(S, 'sugerencia'))), f3 = await as(S, () => tryq(fb(E, 'queja')));
  const sF = await as(S, () => tryq(`select id from public.team_feedback`)), eF = await as(E, () => tryq(`select kind, status from public.team_feedback`));
  const eSt = await as(E, () => tryq(`update public.team_feedback set status = 'vista' returning status`)), eBad = await as(E, () => tryq(`update public.team_feedback set status = 'otra' returning status`));
  const sSt = await as(S, () => tryq(`update public.team_feedback set status = 'resuelta' returning status`));
  check('sql_feedback', f1.rows && !f1.error && /tareas_feedback_bad_recipient/.test(f2.error||'') && !!f3.error && sF.rows.length===0 && eF.rows.length===1 && eF.rows[0].status==='nueva' && eSt.rows && eSt.rows[0].status==='vista' && !!eBad.error && sSt.rows.length===0, {f1, f2, f3, sF, eF, eSt, eBad, sSt});
  // Storage quota: 50 MB for Susana; a replaced file counts once; the admin has none; the quota can change
  await db.exec(`insert into storage.buckets (id, name) values ('attachments', 'attachments') on conflict do nothing`);
  const obj = (uid, name, size) => `insert into storage.objects (bucket_id, name, metadata) values ('attachments', '${uid}/${name}', '{"size":${size}}') on conflict (bucket_id, name) do update set metadata = excluded.metadata returning name`;
  const o1 = await as(S, () => tryq(obj(S, 't/a1.jpg', 30e6))), o2 = await as(S, () => tryq(obj(S, 't/a2.jpg', 25e6))), o3 = await as(S, () => tryq(obj(S, 't/a1.jpg', 31e6)));
  const o4 = await as(S, () => tryq(obj(S, 't/a3.jpg', 52428800-31e6))), o5 = await as(S, () => tryq(`insert into storage.objects (bucket_id, name) values ('attachments', '${S}/t/a4.jpg') returning name`));
  const oE = await as(E, () => tryq(obj(E, 't/big.jpg', 400e6))), used = (await me(S)).used;
  const sid = (await q(`select id from public.team_members where user_id = '${S}'`))[0].id;
  const qSet = await as(S, () => tryq(`select public.tareas_team_quota('${sid}', null)`)), qOk = await as(E, () => tryq(`select public.tareas_team_quota('${sid}', 100000000)`));
  const o6 = await as(S, () => tryq(obj(S, 't/a5.jpg', 19e6)));
  check('sql_quota', o1.rows && /row-level security/.test(o2.error||'') && o3.rows && o4.rows && /row-level security/.test(o5.error||'') && oE.rows && used===52428800 && /admin_only/.test(qSet.error||'') && qOk.rows && o6.rows, {o1, o2, o3, o4, o5, oE, used, qSet, o6});
  // At most 20 notices an hour per sender, whatever the task: Susana sends to Enric with new task refs until the server says no
  let capErr = null, capN = 0; for(let i=0;i<30&&!capErr;i++){ const rr = await as(S, () => tryq(note(E, 'cap'+i))); if(rr.error) capErr = rr.error; else capN++; }
  const inHour = (await q(`select count(*)::int n from public.team_notices where sender_id = '${S}' and created > now() - interval '1 hour'`))[0].n;
  check('sql_notice_cap', /tareas_notice_too_many/.test(capErr||'') && inHour===20 && capN>0, {capErr, capN, inHour});
  // A device is saved only by an account with access (tareas_push_subscribe of 0002, gated in 0013)
  const subX = await as(X, () => tryq(`select public.tareas_push_subscribe('dX', 'https://push/x', 'k', 'a', 'X')`)), subE = await as(E, () => tryq(`select public.tareas_push_subscribe('dE', 'https://push/e', 'k', 'a', 'E')`));
  check('sql_push_gate', /tareas_team_no_access/.test(subX.error||'') && subE.rows && subE.rows.length===1, {subX, subE});
  // Removing the access: blocked at once (reads, writes, the directory, files), never the admin, and their devices and Siri key stop
  await db.exec(`insert into public.push_subscriptions (id, owner_id, endpoint, p256dh, auth, modified) values ('dS', '${S}', 'https://push/s', 'k', 'a', now()); insert into public.shortcut_keys (owner_id, key_hash, space_id) values ('${S}', 'hashS', 'sp')`);
  const sRev = await as(S, () => tryq(`select public.tareas_team_revoke('${sid}')`));
  const eid = (await q(`select id from public.team_members where user_id = '${E}'`))[0].id;
  const selfRev = await as(E, () => tryq(`select public.tareas_team_revoke('${eid}')`));
  const rev = await as(E, () => tryq(`select public.tareas_team_revoke('${sid}')`));
  const afterSel = await as(S, () => tryq(`select id from public.tasks`)), afterIns = await as(S, () => tryq(ins('ts9', 'e1:BBBB'))), afterMe = await me(S);
  const afterDir = await as(S, () => tryq(`select * from public.tareas_team_directory()`)), afterObj = await as(S, () => tryq(`select name from storage.objects`));
  const afterN = await as(S, () => tryq(note(E, 'ts8'))), dev = (await q(`select deleted is not null d from public.push_subscriptions where id = 'dS'`))[0].d;
  const eStill = await as(E, () => tryq(`select id from public.tasks`)), skS = (await q(`select revoked is not null r from public.shortcut_keys where owner_id = '${S}'`))[0].r;
  const subS = await as(S, () => tryq(`select public.tareas_push_subscribe('dS2', 'https://push/s2', 'k', 'a', 'S')`));
  check('sql_revoke_stops_siri_push', skS && /tareas_team_no_access/.test(subS.error||''), {skS, subS});
  // Invited again within 30 days: the access comes back (an invitation never accepted, here); revoked again for the rest
  await as(E, () => q(`select public.tareas_team_invite('quique@example.com')`)); const qid = (await q(`select id from public.team_members where email = 'quique@example.com'`))[0].id;
  await as(E, () => q(`select public.tareas_team_revoke('${qid}')`)); const reinv = await as(E, () => tryq(`select public.tareas_team_invite('quique@example.com') id`));
  const qBack = (await q(`select revoked is null a from public.team_members where id = '${qid}'`))[0].a; await as(E, () => q(`select public.tareas_team_revoke('${qid}')`));
  check('sql_reinvite_within_30', reinv.rows && reinv.rows[0].id===qid && qBack, {reinv, qBack});
  check('sql_revoke_blocks', /tareas_team_admin_only/.test(sRev.error||'') && /not_removable/.test(selfRev.error||'') && rev.rows && afterSel.rows.length===0 && /row-level security/.test(afterIns.error||'') && afterMe===null && afterDir.rows.length===0 && afterObj.rows.length===0 && !!afterN.error && dev && eStill.rows.length===1, {sRev, selfRev, afterSel, afterIns, afterMe, afterDir, afterObj, afterN, dev});
  const h3 = await hook('susana@example.com');
  check('sql_hook_removed', h3.error && h3.error.http_code===403, h3);
  // The function: who may be notified; then the removal after 30 days
  const allowed = (await q(`select array_agg(a order by a) ids from public.tareas_team_allowed(array['${E}','${S}','${X}']::uuid[]) a`))[0].ids;
  const svcGrant = (await q(`select has_function_privilege('service_role', 'public.tareas_team_remove(uuid)', 'EXECUTE') a, has_function_privilege('authenticated', 'public.tareas_team_remove(uuid)', 'EXECUTE') b, has_function_privilege('authenticated', 'public.tareas_team_to_remove()', 'EXECUTE') c`))[0];
  check('sql_allowed', JSON.stringify(allowed)===JSON.stringify([E]) && svcGrant.a && !svcGrant.b && !svcGrant.c, {allowed, svcGrant});
  const early = await q(`select * from public.tareas_team_to_remove()`), earlyRm = (await q(`select public.tareas_team_remove('${sid}') r`))[0].r;
  // Pablo: invited, never signed in, removed 40 days ago; Susana removed 31 days ago with files and rows
  const pid = (await q(`select id from public.team_members where email = 'pablo@example.com'`))[0].id;
  await as(E, () => q(`select public.tareas_team_revoke('${pid}')`));
  await db.exec(`update public.team_members set revoked = now() - interval '31 days' where id = '${sid}'; update public.team_members set revoked = now() - interval '40 days' where id = '${pid}';
    insert into public.projects (id, owner_id, name, modified) values ('ps1', '${S}', 'e1:p', now()); insert into public.contacts (id, owner_id, name, modified) values ('cs1', '${S}', 'e1:c', now());`);
  const due = await q(`select member_id, user_id, files from public.tareas_team_to_remove() order by member_id = '${pid}' desc`);
  // While their data are being deleted, an invitation is refused (a new one once it ends)
  const removing = await as(E, () => tryq(`select public.tareas_team_invite('susana@example.com')`));
  // and once deleted, the same email is a new invitation (checked after the removal below)
  check('sql_invite_removing', /tareas_team_removing/.test(removing.error||'') && (await q(`select revoked is not null r from public.team_members where id = '${sid}'`))[0].r, removing);
  const nS = (await q(`select count(*)::int n from public.team_notices where sender_id = '${S}' or recipient_id = '${S}'`))[0].n;
  const adminRm = (await q(`select public.tareas_team_remove('${eid}') r`))[0].r;
  const rmS = (await q(`select public.tareas_team_remove('${sid}') r`))[0].r, rmP = (await q(`select public.tareas_team_remove('${pid}') r`))[0].r;
  const left = (await q(`select (select count(*) from public.tasks where owner_id = '${S}')::int t, (select count(*) from public.crypto_keys where owner_id = '${S}')::int k, (select count(*) from public.team_notices where sender_id = '${S}' or recipient_id = '${S}')::int n,
    (select count(*) from public.team_feedback where sender_id = '${S}')::int f, (select count(*) from auth.users where id = '${S}')::int u, (select count(*) from public.team_members)::int m, (select count(*) from public.tasks where owner_id = '${E}')::int e, (select count(*) from public.team_log where event = 'removed')::int l`))[0];
  check('sql_removal', early.length===0 && earlyRm.skipped && due.length===2 && due[0].member_id===pid && due[0].files.length===0 && due[1].files.length===3 && adminRm.skipped
    && rmS.tasks===1 && rmS.projects===1 && rmS.contacts===1 && rmS.crypto_keys===1 && rmS.team_notices===nS && nS>=20 && rmS.account===1 && rmP && !rmP.skipped
    && left.t===0 && left.k===0 && left.n===0 && left.f===0 && left.u===0 && left.m===2 && left.e===1 && left.l===2, {early, earlyRm, due, adminRm, rmS, rmP, left});
  const fresh = await as(E, () => tryq(`select public.tareas_team_invite('susana@example.com') id`));
  check('sql_invite_after_removal', fresh.rows && fresh.rows[0].id!==sid && (await q(`select revoked is null and user_id is null a from public.team_members where lower(email) = 'susana@example.com'`))[0].a, fresh);
  await db.close();
  // A fresh project: no account when it runs; the first one to sign in is the admin, the hook lets only that first one in
  db = await pgSetup(); for(const f of MIGS) await db.exec(strip(rd(f))); await db.exec(mig);
  const qf = async (sql, params) => (await db.query(sql, params)).rows;
  const hook0 = (await qf(`select public.tareas_before_user_created('{"user":{"email":"a@example.com"}}'::jsonb) r`))[0].r;
  await db.exec(`insert into auth.users (id, email, email_confirmed_at) values ('${E}', 'enric@example.com', now())`);
  const hook1 = (await qf(`select public.tareas_before_user_created('{"user":{"email":"b@example.com"}}'::jsonb) r`))[0].r;
  await db.exec(`set test.uid = '${E}'; set role authenticated;`); const t0 = await db.query(`insert into public.tasks (id, title, modified) values ('t', 'x', now()) returning id`).then(x=>x.rows.length, e=>e.message);
  const m0 = (await db.query(`select public.tareas_team_me() m`)).rows[0].m; await db.exec(`reset role; reset test.uid;`);
  const chk = (await qf(fs.readFileSync(path.join(ROOT, 'supabase/check.sql'), 'utf8'))).find(x=>x['N.º']===36);
  check('sql_fresh_project', JSON.stringify(hook0)==='{}' && hook1.error && t0===1 && m0 && m0.role==='admin', {hook0, hook1, t0, m0});
  check('sql_check_admin_email', chk && /enric@example\.com/.test(chk.Pieza) && chk.Estado==='OK', chk);
  await db.close();
  // all.sql: every migration in order, twice, on a fresh database; check.sql says OK on every row
  db = await pgSetup(); const all = strip(fs.readFileSync(path.join(ROOT, 'supabase/all.sql'), 'utf8'));
  err = null; try { await db.exec(all); await db.exec(all); } catch(e){ err = e.message; }
  check('sql_all_twice', !err && /0001 a 00\d\d/.test(all.split('\n')[0]) && /migrations\/0013_team\.sql/.test(all) && (all.match(/^-- ========== migrations\//mg)||[]).length===fs.readdirSync(path.join(ROOT,'supabase/migrations')).filter(f=>f.endsWith('.sql')).length, err);
  let rows = []; try { rows = (await db.query(fs.readFileSync(path.join(ROOT, 'supabase/check.sql'), 'utf8'))).rows; } catch(e){ err = e.message; }
  check('sql_check_all_ok', rows.length>=40 && rows.every(x=>x.Estado==='OK') && rows.filter(x=>/\(0013\)/.test(x.Pieza)).length>=6, {err, bad:rows.filter(x=>x.Estado!=='OK'), n:rows.length});
  await db.close();
}

/* ======================= 2. send-reminders under Deno ======================= */
const b64u = b => Buffer.from(b).toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
function newDevice(){ const ecdh = crypto.createECDH('prime256v1'); ecdh.generateKeys(); const auth = crypto.randomBytes(16); return { ecdh, auth, p256dh: b64u(ecdh.getPublicKey()), authB64: b64u(auth) }; }
// A small PostgREST: eq, is.null, in, lte, select; PATCH with return=representation; the rpc the function calls; Storage's DELETE
const FN = { t:{}, objects:new Set(), log:[], pushes:[], noTeam:false, rpcFail:false };
function fnMatch(row, filters){ return filters.every(([k, v]) => { const x = row[k];
  if (v === 'is.null') return x === null || x === undefined; if (v === 'not.is.null') return x !== null && x !== undefined; if (v.startsWith('eq.')) return String(x) === v.slice(3);
  if (v.startsWith('lte.')) return x != null && Date.parse(x) <= Date.parse(v.slice(4));
  if (v.startsWith('in.(')) return v.slice(4, -1).split(',').map(s => s.replace(/^"|"$/g, '')).includes(String(x)); throw new Error('filter ' + v); }); }
async function fnServers(){
  const rest = http.createServer((req, res) => { let b=''; req.on('data', c=>b+=c); req.on('end', () => {
    const u = new URL(req.url, 'http://x'), body = b ? JSON.parse(b) : undefined, prefer = req.headers['prefer']||''; FN.log.push({method:req.method, path:u.pathname, body, key:req.headers['apikey']});
    const send = (st, o) => { res.writeHead(st, {'Content-Type':'application/json'}); res.end(o===undefined?'':JSON.stringify(o)); };
    const team = /team_|tareas_team/.test(u.pathname);
    if (FN.noTeam && team) return send(404, {code:'PGRST205', message:"Could not find the table in the schema cache"});
    if (FN.noFollow && u.pathname === '/rest/v1/team_notices' && /done|planned/.test(u.search)) return send(400, {code:'42703', message:'column team_notices.done does not exist'}); // before 0014
    if (u.pathname === '/rest/v1/rpc/tareas_team_allowed') { if (FN.rpcFail) return send(500, {message:'boom'}); if (FN.allowedAbsent) return send(404, {code:'PGRST202', message:'Could not find the function public.tareas_team_allowed'}); return send(200, (body.p_ids||[]).filter(id => (FN.t.team_members||[]).some(m => m.user_id===id && !m.revoked))); }
    if (u.pathname === '/rest/v1/rpc/tareas_team_to_remove') return send(200, (FN.t.team_members||[]).filter(m => m.role==='member' && m.revoked && Date.parse(m.revoked) < Date.now()-30*864e5).map(m => ({member_id:m.id, user_id:m.user_id, files:[...FN.objects].filter(o => o.startsWith(m.user_id+'/'))})));
    if (u.pathname === '/rest/v1/rpc/tareas_team_remove') { const m = FN.t.team_members.find(x => x.id===body.p_member); if (!m || m.role!=='member') return send(200, {skipped:true});
      FN.t.team_members = FN.t.team_members.filter(x => x!==m); FN.t.tasks = FN.t.tasks.filter(x => x.owner_id!==m.user_id); return send(200, {tasks:1}); }
    if (u.pathname === '/rest/v1/rpc/tareas_attachments_to_purge') return send(200, []);
    if (u.pathname === '/storage/v1/object/attachments' && req.method === 'DELETE') { const gone = (body.prefixes||[]).filter(p => FN.objects.has(p)); gone.forEach(p => FN.objects.delete(p)); return send(200, gone.map(name => ({name}))); }
    const table = u.pathname.replace('/rest/v1/', ''), rows = FN.t[table]; if (!rows) return send(404, {message:'no table '+table});
    const filters = [], meta = {}; for (const [k, v] of u.searchParams) { if (['select','limit','on_conflict'].includes(k)) meta[k] = v; else filters.push([k, v]); }
    const pick = r => { if (!meta.select) return Object.assign({}, r); const o = {}; meta.select.split(',').forEach(c => o[c] = r[c] === undefined ? null : r[c]); return o; };
    if (req.method === 'GET') return send(200, rows.filter(x => fnMatch(x, filters)).map(pick));
    if (req.method === 'PATCH') { const m = rows.filter(x => fnMatch(x, filters)); m.forEach(x => Object.assign(x, body)); return send(200, /return=representation/.test(prefer) ? m.map(pick) : undefined); }
    if (req.method === 'POST') { (Array.isArray(body)?body:[body]).forEach(x => { if (!rows.find(y => y.id===x.id)) rows.push(Object.assign({}, x)); }); return send(201); }
    if (req.method === 'DELETE') { FN.t[table] = rows.filter(x => !fnMatch(x, filters)); return send(200); }
    send(405); }); });
  const push = http.createServer((req, res) => { const ch=[]; req.on('data', c=>ch.push(c)); req.on('end', () => { FN.pushes.push({url:req.url, body:Buffer.concat(ch)}); res.writeHead(201); res.end(); }); });
  await new Promise(r=>rest.listen(REST_PORT, r)); await new Promise(r=>push.listen(PUSH_PORT, r));
  const wrapper = path.join(OUT, 'serve-fn.ts');
  fs.writeFileSync(wrapper, `(globalThis as any).TAREAS_NO_SERVE = true;\nconst m = await import('file://${ROOT}/supabase/functions/send-reminders/index.ts');\nDeno.serve({ port: ${FN_PORT}, hostname: '127.0.0.1', onListen(){ console.log('listening'); } }, m.handler);\n`);
  const deno = spawn(process.env.DENO || 'deno', ['run', '--allow-net', '--allow-env', '--allow-read', wrapper], { env: Object.assign({}, process.env, {
    SUPABASE_URL: 'http://127.0.0.1:' + REST_PORT, SUPABASE_SERVICE_ROLE_KEY: 'eyJservice', SUPABASE_ANON_KEY: 'anon-key', DENO_DIR: path.join(OUT, 'denodir'), NO_COLOR: '1' }) });
  const st = { out:'' }; deno.stdout.on('data', d => st.out += d); deno.stderr.on('data', d => st.out += d);
  for (let i = 0; i < 300 && !/listening/.test(st.out); i++) await sleep(100);
  return { st, stop(){ deno.kill(); rest.close(); push.close(); } };
}
async function fnTests(){
  const ece = require(path.join(DEPS, 'http_ece'));
  const S1 = await fnServers(); const call = async () => { const res = await fetch('http://127.0.0.1:'+FN_PORT+'/', {method:'POST', headers:{'Content-Type':'application/json'}, body:'{}'}); return {status:res.status, json:await res.json().catch(()=>null)}; };
  try {
    check('fn_started', /listening/.test(S1.st.out), S1.st.out.slice(-600));
    const now = Date.now(), iso = ms => new Date(now + ms).toISOString(), EP = n => 'http://127.0.0.1:'+PUSH_PORT+'/push/'+n;
    const dE = newDevice(), dS = newDevice(), dX = newDevice();
    FN.t = { push_keys:[], push_subscriptions:[
        {id:'sE', owner_id:E, endpoint:EP('e'), p256dh:dE.p256dh, auth:dE.authB64, deleted:null}, {id:'sS', owner_id:S, endpoint:EP('s'), p256dh:dS.p256dh, auth:dS.authB64, deleted:null},
        {id:'sX', owner_id:X, endpoint:EP('x'), p256dh:dX.p256dh, auth:dX.authB64, deleted:null} ],
      tasks:[ {id:'rE', owner_id:E, title:'e1:titulo', project_id:null, date:null, reminder:iso(-6e4), reminder_sent:null, deleted:null, status:'pending'},
        {id:'rX', owner_id:X, title:'Sin acceso', project_id:null, date:null, reminder:iso(-6e4), reminder_sent:null, deleted:null, status:'pending'} ],
      projects:[], attachments:[],
      team_members:[ {id:'mE', user_id:E, name:'Enric Vidal', email:'enric@example.com', role:'admin', revoked:null}, {id:'mS', user_id:S, name:'Susana Gil', email:'susana@example.com', role:'member', revoked:null},
        {id:'mO', user_id:P, name:'Antigua', email:'antigua@example.com', role:'member', revoked:iso(-31*864e5)} ],
      team_notices:[ {id:'n1', sender_id:E, recipient_id:S, task_ref:'t1', payload:'t1:SECRETO', created:iso(-5e3), pushed:null}, {id:'n0', sender_id:E, recipient_id:S, task_ref:'t0', payload:'t1:x', created:iso(-2*36e5), pushed:null} ],
      team_feedback:[ {id:'f1', sender_id:S, recipient_id:E, kind:'incidencia', payload:'t1:LOG', created:iso(-5e3), pushed:null, status:'nueva'} ] };
    FN.objects = new Set([P+'/t/a.jpg', P+'/t/b.m4a', S+'/t/c.jpg']);
    const c1 = await call(); const got = dev => FN.pushes.filter(p => p.url===(dev===dE?'/push/e':dev===dS?'/push/s':'/push/x')).map(p => JSON.parse(ece.decrypt(p.body, {version:'aes128gcm', privateKey:dev.ecdh, authSecret:dev.authB64}).toString()));
    const pe = got(dE), ps = got(dS), px = got(dX);
    check('fn_team_counts', c1.status===200 && c1.json.notices===2 && c1.json.feedback===1 && c1.json.teamSent===2 && c1.json.due===2 && c1.json.sent===1, c1.json);
    check('fn_notice_push', ps.length===1 && ps[0].title==='Tareas' && ps[0].body==='Enric te ha enviado una tarea' && ps[0].data.url==='./?open=received' && !JSON.stringify(ps[0]).includes('SECRETO'), ps);
    check('fn_feedback_push', pe.length===2 && pe.some(m => m.body==='Nueva incidencia' && m.data.url==='./?open=feedback') && pe.some(m => m.data.taskId==='rE') && !JSON.stringify(pe).includes('LOG'), pe);
    check('fn_no_access_no_reminder', px.length===0 && !!FN.t.tasks.find(x=>x.id==='rX').reminder_sent, px);
    check('fn_marked_once', FN.t.team_notices.every(n => n.pushed) && FN.t.team_feedback[0].pushed, FN.t.team_notices);
    // The removal: the files first, the rows on the next run; nobody else's files
    check('fn_removal_files', c1.json.removedFiles===2 && !FN.objects.has(P+'/t/a.jpg') && FN.objects.has(S+'/t/c.jpg') && FN.t.team_members.length===3, {j:c1.json, o:[...FN.objects]});
    FN.pushes.length = 0; const c2 = await call();
    check('fn_removal_rows', c2.json.removedMembers===1 && FN.t.team_members.map(m=>m.id).join()==='mE,mS' && c2.json.notices===0 && FN.pushes.length===0 && /"event":"member-removed"/.test(S1.st.out), c2.json);
    // Decision 78 (0014): Susana completed a task Enric sent her: «Susana ha completado una tarea que le enviaste» to Enric's devices, once,
    // nothing of the task, a tap opens his task. Lateness is measured on done_seen (when the server saw it), not on done (the device's
    // clock): one done three hours ago on a phone that was offline but seen a minute ago notifies; one seen two hours ago is marked only
    FN.pushes.length = 0;
    FN.t.team_notices.push({id:'d1', sender_id:E, recipient_id:S, task_ref:'tE1', payload:'t1:SECRETO', created:iso(-864e5), pushed:iso(-864e5), taken:iso(-8e7), planned:null, done:iso(-3*36e5), done_seen:iso(-6e4), done_pushed:null, followed:iso(-8e7)},
      {id:'d2', sender_id:E, recipient_id:S, task_ref:'tE2', payload:'t1:x', created:iso(-864e5), pushed:iso(-864e5), taken:iso(-8e7), planned:null, done:iso(-6e4), done_seen:iso(-2*36e5), done_pushed:null, followed:iso(-8e7)},
      {id:'d3', sender_id:E, recipient_id:S, task_ref:'tE3', payload:'t1:x', created:iso(-864e5), pushed:iso(-864e5), taken:iso(-8e7), planned:'2026-11-20', done:null, done_seen:null, done_pushed:null, followed:iso(-8e7)});
    const f1 = await call(), pf = got(dE), ps2 = got(dS);
    check('fn_follow_push', f1.status===200 && f1.json.completed===2 && f1.json.completedSent===1 && pf.length===1 && pf[0].title==='Tareas' && pf[0].body==='Susana ha completado una tarea que le enviaste' && pf[0].data.taskId==='tE1' && pf[0].data.follow===true && pf[0].data.url==='./?task=tE1' && !JSON.stringify(pf[0]).includes('SECRETO') && ps2.length===0, {j:f1.json, pf, ps2});
    const dn = id => FN.t.team_notices.find(n => n.id===id);
    check('fn_follow_marked', !!dn('d1').done_pushed && !!dn('d2').done_pushed && dn('d3').done_pushed===null && /"completed":2/.test(S1.st.out), FN.t.team_notices.filter(n => /^d/.test(n.id)));
    FN.pushes.length = 0; const f2 = await call();
    check('fn_follow_once', !f2.json.completed && FN.pushes.length===0, f2.json);
    Object.assign(dn('d1'), {done:iso(-1e4), done_seen:iso(-1e4), done_pushed:null}); FN.pushes.length = 0; const f3 = await call(); // the trigger of 0014 empties done_pushed on a new completion (after 4 hours)
    check('fn_follow_again', f3.json.completed===1 && got(dE).length===1 && got(dE)[0].body==='Susana ha completado una tarea que le enviaste', f3.json);
    // An answer of the access check that looks like a missing function (and marks the team missing for the logs) does not turn the
    // follow-up off: this run's own claim of the notices decides
    FN.allowedAbsent = true; FN.t.tasks.push({id:'rE3', owner_id:E, title:'otra más', project_id:null, date:null, reminder:iso(-6e4), reminder_sent:null, deleted:null, status:'pending'});
    Object.assign(dn('d1'), {done:iso(-1e4), done_seen:iso(-1e4), done_pushed:null}); FN.pushes.length = 0; const f6 = await call(), f7 = await call(); FN.allowedAbsent = false;
    Object.assign(dn('d3'), {done:iso(-1e4), done_seen:iso(-1e4)}); FN.pushes.length = 0; const f8 = await call();
    check('fn_follow_not_disabled', f6.json.completed===1 && f6.json.completedSent===1 && f8.json.completed===1 && f8.json.completedSent===1, {f6:f6.json, f7:f7.json, f8:f8.json});
    // Before 0014 (the columns are missing): nothing, said once, the rest goes on
    FN.noFollow = true; Object.assign(dn('d1'), {done:iso(-1e4), done_seen:iso(-1e4), done_pushed:null}); FN.pushes.length = 0; const f4 = await call(), f5 = await call(); FN.noFollow = false;
    check('fn_follow_without_0014', f4.status===200 && !f4.json.completed && !f4.json.followFailed && f5.status===200 && FN.pushes.length===0 && (S1.st.out.match(/"event":"follow-skipped"/g)||[]).length===1 && !dn('d1').done_pushed, {f4:f4.json, f5:f5.json});
    FN.t.team_notices = FN.t.team_notices.filter(n => !/^d\d$/.test(n.id));
    // The allowed answer fails: the reminders still go
    FN.rpcFail = true; FN.t.tasks.push({id:'rE2', owner_id:E, title:'otra', project_id:null, date:null, reminder:iso(-6e4), reminder_sent:null, deleted:null, status:'pending'});
    const c3 = await call(); FN.rpcFail = false;
    check('fn_allowed_fails_open', c3.json.sent===1 && /team-allowed-failed/.test(S1.st.out), c3.json);
    // Before 0013: nothing of the team, reminders as before, said once
    FN.noTeam = true; FN.t.tasks.push({id:'rX2', owner_id:X, title:'antes', project_id:null, date:null, reminder:iso(-6e4), reminder_sent:null, deleted:null, status:'pending'});
    const c4 = await call(), c5 = await call();
    check('fn_without_0013', c4.status===200 && c4.json.sent===1 && c4.json.notices===0 && !c4.json.teamFailed && !c4.json.removalFailed && c5.status===200 && (S1.st.out.match(/"event":"team-skipped"/g)||[]).length===1, {c4:c4.json, c5:c5.json});
  } finally { S1.stop(); }
}

/* ======================= 3. The app ======================= */
const TF = require('./lib/team-fake.js'); const { until, synced, settled, sheetIn, toSettings, signIn, activate, hideToast, tk, seed } = TF;
const shot=(page, name)=>page.screenshot({path:path.join(OUT, name+'.png')});
const PW_E='Clave de Enric 2026!', PW_S='Susana gil #2026x';
async function appTests(browser){
  const fake = new TF.Fake();
  const UE = fake.user('9b2f6d3e-0000-4000-8000-0000000000e1', 'enric@example.com', 'Enric Vidal'), US = fake.user('9b2f6d3e-0000-4000-8000-0000000000e2', 'susana@example.com', 'Susana Gil'), UX = fake.user('9b2f6d3e-0000-4000-8000-0000000000e3', 'extrana@example.com', '');
  const dev = o => TF.device(browser, fake, o, PORT, errors);
  /* ---------- Enric (desktop, light): the oldest account is the admin; Equipo in Ajustes ---------- */
  const E = await dev({tag:'E', desk:true, user:UE, seed:seed([tk('e1', {title:'Preparar comité'})])}); const ep=E.page;
  await signIn(ep, true); check('E_synced', await synced(ep));
  const eSt = await ep.evaluate(()=>({state:TM.state, me:TM.me, overlay:!!document.getElementById('noaccess')}));
  check('E_admin', eSt.state==='admin' && eSt.me.quota===null && !eSt.overlay && fake.members.length===1 && fake.members[0].role==='admin', eSt);
  // An admin without encryption still syncs (decision 71.1 asks it of invited members); the owner already has it: activated here, and the
  // first pass after it makes his key pair (public key on the server, private one encrypted with his data key, a non-extractable copy here)
  await activate(ep, PW_E); await ep.evaluate(()=>{ if(document.querySelector('#sheet.on')) closeSheet(); }); await settled(ep);
  check('E_keys', await until(ep, async()=>!!TM.priv&&!!TM.pub&&!!(await cryptoKdbDo('readonly', st=>st.get('ecdh'))), null, 15000) && /^[A-Za-z0-9_-]{87}$/.test(fake.keys.get(UE.uid).ecdh_pub||'') && /^e1:/.test(fake.keys.get(UE.uid).ecdh_priv||''), fake.keys.get(UE.uid));
  const eKeyX = await ep.evaluate(async()=>{ const r=await cryptoKdbDo('readonly', st=>st.get('ecdh')); try{ await crypto.subtle.exportKey('pkcs8', r.priv); return 'exported'; }catch(e){ return 'refused'; } });
  check('E_priv_not_extractable', eKeyX==='refused', eKeyX);
  await toSettings(ep, true);
  const sec = async page => page.evaluate(()=>{ const t=[...document.querySelectorAll('.group-title')].find(x=>x.textContent==='Equipo'); if(!t) return null; t.scrollIntoView({block:'start'}); const out=[]; let g=t.nextElementSibling;
    while(g&&!g.classList.contains('group-title')){ if(g.classList.contains('group')) out.push(...[...g.querySelectorAll('.cell')].map(c=>c.textContent.trim())); g=g.nextElementSibling; } return out; });
  check('E_section', await until(ep, ()=>!!document.querySelector('.team-members [data-act=tmMember]')), await sec(ep));
  let es = await sec(ep);
  check('E_section_cells', es && es.some(c=>/^Enric VidalAdministrador, 0 MBTú$/.test(c)) && es.includes('Invitar') && es.some(c=>c==='Almacenamiento0 MB, sin límite') && es.some(c=>/^Sugerencias e incidenciasNinguna/.test(c)), es);
  await shot(ep, 'desk-equipo');
  // Invitar: email and name; then the message to send, with the app's address
  await ep.click('[data-act=tmInvite]'); await sheetIn(ep);
  await ep.fill('#sheet [data-role=ivmail]', 'Susana@Example.com'); await ep.fill('#sheet [data-role=ivname]', 'Susana Gil'); await shot(ep, 'desk-invitar');
  await ep.click('#sheet .hbtn.ok');
  check('E_invited', await until(ep, ()=>!!document.querySelector('#sheet.on .invsheet')) && fake.members.some(m=>m.email==='susana@example.com'&&m.role==='member'&&m.quota===52428800&&m.name==='Susana Gil'), fake.members);
  const inv = await ep.evaluate(()=>document.querySelector('#sheet .inv-msg').textContent);
  check('E_invite_text', inv==='Te he dado acceso a Tareas. Entra con tu cuenta de Google en http://localhost:'+PORT+'/', inv);
  await ep.waitForTimeout(300); await shot(ep, 'desk-invitacion'); await ep.evaluate(()=>closeSheet()); await settled(ep);

  /* ---------- A stranger (iPhone, light): «Esta cuenta no tiene acceso», nothing syncs, nothing of the device shows ---------- */
  const X = await dev({tag:'X', user:UX, seed:seed([tk('x1', {title:'Tarea local de este iPhone'})])}); const xp=X.page;
  await signIn(xp);
  check('X_denied', await until(xp, ()=>SY.status==='denied'&&!!document.getElementById('noaccess')), await xp.evaluate(()=>({st:SY.status, tm:TM.state})));
  const xv = await xp.evaluate(()=>{ const o=document.getElementById('noaccess'), r=o.getBoundingClientRect(); return {txt:o.textContent, cover:r.width>=innerWidth&&r.height>=innerHeight, top:document.elementFromPoint(innerWidth/2, 300)===o||o.contains(document.elementFromPoint(innerWidth/2, 300)), line:syncLine()}; });
  const xCalls = fake.calls.filter(c=>c.startsWith('X:'));
  check('X_screen', /Esta cuenta no tiene acceso/.test(xv.txt) && /extrana@example\.com/.test(xv.txt) && xv.cover && xv.top && xv.line==='Esta cuenta no tiene acceso', xv);
  check('X_nothing_synced', !xCalls.some(c=>/:(pull|upsert|markDeleted|byIds|cryptoPut)/.test(c)) && xCalls.includes('X:teamMe') && ![...fake.t.tasks.values()].some(r=>r.owner_id===UX.uid), xCalls);
  await shot(xp, 'ip-light-sin-acceso');
  await xp.click('#noaccess [data-x=out]');
  check('X_signed_out', await until(xp, ()=>!SY.user&&!document.getElementById('noaccess')) && await xp.evaluate(()=>task('x1')&&task('x1').title==='Tarea local de este iPhone'), await xp.evaluate(()=>({u:SY.user, o:!!document.getElementById('noaccess')})));
  await X.ctx.close();

  /* ---------- Susana (iPhone, dark): invited; her first sign-in asks for the encryption password before anything syncs ---------- */
  const S = await dev({tag:'S', dark:true, user:US, seed:seed([tk('s1', {title:'Revisar presupuesto', notes:'Con el cliente'}), tk('s2', {title:'Llamar a proveedores'})])}); const sp=S.page;
  await signIn(sp);
  check('S_needkey', await until(sp, ()=>SY.status==='needkey'&&TM.state==='member'), await sp.evaluate(()=>({st:SY.status, tm:TM.state})));
  check('S_sheet_by_itself', await until(sp, ()=>!!document.querySelector('#sheet.on [data-role=cx1]')&&/Para usar Tareas en equipo/.test(document.querySelector('#sheet .cx-intro').textContent)));
  const sCalls = fake.calls.filter(c=>c.startsWith('S:'));
  check('S_nothing_before_key', !sCalls.some(c=>/:(pull|upsert|markDeleted|byIds)/.test(c)) && sCalls.includes('S:cryptoGet') && fake.members.find(m=>m.email==='susana@example.com').user_id===US.uid, sCalls);
  await sheetIn(sp); await shot(sp, 'ip-dark-contrasena-obligatoria');
  await sp.fill('#sheet [data-role=cx1]', PW_S); await sp.fill('#sheet [data-role=cx2]', PW_S); await sp.check('#sheet [data-role=cxok]'); await sp.click('#sheet .hbtn.ok');
  check('S_activated', await until(sp, ()=>!!CR.row&&!!CR.row.migrated&&!CR.migrating&&SY.status==='ok', null, 30000), await sp.evaluate(()=>({st:SY.status, row:CR.row, log:LOG.slice(-8).map(e=>e.m)})));
  check('S_synced', await synced(sp, 20000));
  const sRows = [...fake.t.tasks.values()].filter(r=>r.owner_id===US.uid);
  check('S_uploaded_encrypted', sRows.length===2 && sRows.every(r=>TF.isEnc(r.title)) && TF.isEnc(sRows.find(r=>r.id==='s1').notes) && !fake.keys.get(US.uid).ecdh_pub===false, {n:sRows.length, k:fake.keys.get(US.uid)});
  check('S_keys', await until(sp, ()=>!!TM.priv, null, 10000) && /^[A-Za-z0-9_-]{87}$/.test(fake.keys.get(US.uid).ecdh_pub||''));
  await sp.evaluate(()=>{ if(document.querySelector('#sheet.on')) closeSheet(); }); await settled(sp);
  await toSettings(sp, false, 'equipo'); const ss = await sec(sp); // v0.37.4: Equipo is its own subscreen
  check('S_section', ss && ss.length===2 && ss[0]==='Almacenamiento0 MB de 50 MB' && ss[1]==='Enviar sugerencia o incidencia', ss);
  await shot(sp, 'ip-dark-equipo-miembro');
  // The rules refuse a change while the account still has access: once it is read again quietly; the second time it is an ordinary
  // sync error (Ajustes says so, the log has an error), never a silent loop
  fake.failRls=2; await sp.evaluate(()=>updTask('s1', {title:'Revisar presupuesto final'}));
  check('S_refused_reported', await until(sp, ()=>SY.status==='error'&&/row-level security/.test(SY.error)&&LOG.some(e=>e.l==='error'&&/Sincronización falló/.test(e.m))&&LOG.some(e=>/se comprueba el acceso/.test(e.m)), null, 20000) && fake.failRls===0,
    await sp.evaluate(()=>({st:SY.status, err:SY.error, log:LOG.slice(-6).map(e=>e.l+' '+e.m)})));
  await sp.evaluate(()=>{ SY.retry=0; return syncRun('prueba'); }); check('S_recovers', await synced(sp, 15000) && await sp.evaluate(()=>!TM.refused));

  /* ---------- Back to Enric: Susana in the list, her quota, her access removed ---------- */
  await ep.evaluate(()=>teamListLoad(true)); await until(ep, ()=>(TM.list||[]).some(m=>m.joined&&m.role==='member'));
  es = await sec(ep); check('E_sees_member', es.some(c=>/^Susana Gilsusana@example\.com, 0 MB de 50 MB(hace un momento|hace \d+ min)$/.test(c)), es);
  const sid = fake.members.find(m=>m.email==='susana@example.com').id;
  await ep.click('[data-act=tmMember][data-id="'+sid+'"]'); await sheetIn(ep);
  const ms = await ep.evaluate(()=>document.querySelector('#sheet .msheet').textContent);
  check('E_member_sheet', /susana@example\.com/.test(ms) && /CifradoActivado/.test(ms) && /Almacenamiento0 MB de 50 MB/.test(ms) && /Quitar acceso/.test(ms) && !/Revisar presupuesto/.test(ms), ms);
  await shot(ep, 'desk-miembro');
  await ep.click('#sheet [data-mq]'); await until(ep, ()=>!!document.querySelector('.pm.open'));
  await ep.evaluate(()=>{ const b=[...document.querySelectorAll('.pm.open .pm-item, .pm.open [role=menuitem], .pm.open button')].find(x=>/^100 MB/.test(x.textContent.trim())); b&&b.click(); });
  check('E_quota', await until(ep, ()=>!!TM.list&&TM.list.some(m=>m.quota===104857600)) && fake.members.find(m=>m.id===sid).quota===104857600, fake.members.find(m=>m.id===sid));
  await ep.evaluate(()=>{ if(document.querySelector('#sheet.on')) closeSheet(); }); await settled(ep);
  await ep.click('[data-act=tmMember][data-id="'+sid+'"]'); await sheetIn(ep); await ep.click('#sheet [data-x=revoke]');
  check('E_revoke_alert', await until(ep, ()=>!!document.querySelector('#asheet.on')&&/No se puede deshacer/.test(document.querySelector('#asheet').textContent)));
  await shot(ep, 'desk-quitar-acceso');
  await ep.evaluate(()=>{ const b=[...document.querySelectorAll('#asheet.on button')].find(x=>x.textContent.trim()==='Quitar acceso'); b.click(); });
  check('E_revoked', await until(ep, ()=>(TM.list||[]).some(m=>m.revoked)) && !!fake.members.find(m=>m.id===sid).revoked, fake.members);
  await settled(ep); es = await sec(ep); check('E_list_after', es.some(c=>/^Susana Gil/.test(c)&&/Sin acceso/.test(c)), es);
  // Susana: blocked at once. Her next change is refused by the server; the app reads the account again and shows the full screen
  const before = JSON.stringify([...fake.t.tasks.values()].filter(r=>r.owner_id===US.uid));
  await sp.evaluate(()=>{ updTask('s2', {title:'Llamar a proveedores hoy'}); });
  check('S_blocked', await until(sp, ()=>SY.status==='denied'&&!!document.getElementById('noaccess'), null, 15000), await sp.evaluate(()=>({st:SY.status, err:SY.error, log:LOG.slice(-5).map(e=>e.m)})));
  check('S_nothing_written', JSON.stringify([...fake.t.tasks.values()].filter(r=>r.owner_id===US.uid))===before);
  await shot(sp, 'ip-dark-acceso-quitado');
  // The member sheet of a removed member: when the data go, and Invitar de nuevo
  await ep.click('[data-act=tmMember][data-id="'+sid+'"]'); await sheetIn(ep);
  const rm = await ep.evaluate(()=>document.querySelector('#sheet .msheet').textContent);
  check('E_removed_sheet', /Sin acceso desde el \d+ de [a-z]+\. Sus datos se borran el \d+ de [a-z]+\./.test(rm) && /Invitar de nuevo/.test(rm), rm);
  await ep.evaluate(()=>closeSheet()); await settled(ep);
  // More than 30 days later the data are being deleted: no Invitar de nuevo, and the server refuses an invitation meanwhile
  fake.members.find(m=>m.id===sid).revoked=new Date(Date.now()-31*864e5).toISOString(); await ep.evaluate(()=>teamListLoad(true));
  await ep.click('[data-act=tmMember][data-id="'+sid+'"]'); await sheetIn(ep);
  const rm2 = await ep.evaluate(()=>document.querySelector('#sheet .msheet').textContent);
  check('E_removing_sheet', /Se está borrando\. Invítale de nuevo cuando termine\./.test(rm2) && !/Invitar de nuevo/.test(rm2), rm2);
  await ep.evaluate(()=>closeSheet()); await settled(ep);
  await ep.evaluate(()=>{ toast(''); return teamReinvite({email:'susana@example.com'}); });
  check('E_removing_invite', await ep.evaluate(()=>document.getElementById('toastText').textContent)==='Se está borrando. Invítale de nuevo cuando termine' && !!fake.members.find(m=>m.id===sid).revoked);
  // The admin cannot remove himself: no button, and the server says no
  const selfRm = await ep.evaluate(async id=>{ try{ await SY.remote.teamRevoke(id); return 'done'; }catch(e){ return e.message; } }, fake.members.find(m=>m.role==='admin').id);
  check('E_not_self', /not_removable/.test(selfRm), selfRm);
  // Only the admin calls the admin functions
  const sAdm = await sp.evaluate(async()=>{ try{ await SY.remote.teamList(); return 'listed'; }catch(e){ return e.message; } });
  check('S_not_admin', /admin_only/.test(sAdm), sAdm);
  await S.ctx.close();

  /* ---------- A database without 0013: as before (no Equipo, no full screen, sync as usual) ---------- */
  fake.team = false;
  const A = await dev({tag:'A', user:UE, seed:seed([tk('a1', {title:'Sin equipo'})]), init:()=>{ window.__noTeamTest=true; }}); const ap=A.page;
  await ap.evaluate(()=>{ localStorage.setItem('tareas-crypto-skip','1'); }); await signIn(ap);
  check('absent_works', await until(ap, ()=>TM.state==='absent'&&SY.status!=='denied', null, 15000) && await ap.evaluate(()=>!document.getElementById('noaccess')&&!teamOn()&&teamSectionHTML('este iPhone')===''), await ap.evaluate(()=>({tm:TM.state, st:SY.status})));
  await A.ctx.close(); fake.team = true;
  await E.ctx.close();
  await switchTests(browser);
}

/* ---------- Another account on the same device: never merged; emptied on «Continuar» only when nothing of the other account is unsent ---------- */
async function switchTests(browser){
  const f2 = new TF.Fake(); f2.team = false; // the rule is the sync's, with or without 0013
  const UA = f2.user('9b2f6d3e-0000-4000-8000-0000000000a1', 'ana@example.com', 'Ana'), UB = f2.user('9b2f6d3e-0000-4000-8000-0000000000b1', 'bruno@example.com', 'Bruno');
  f2.put = (owner, table, row) => f2.t[table].set(row.id, Object.assign({owner_id:owner, created:row.modified, deleted:null}, row, {server_ts:f2.ts()}));
  f2.put(UB.uid, 'tasks', {id:'b1', title:'De Bruno en el servidor', status:'pending', priority:'none', modified:'2026-11-05T09:00:00.000Z'});
  const D = await TF.device(browser, f2, {tag:'D', user:UA, seed:seed([tk('a1', {title:'De Ana'}), tk('a2', {title:'Otra de Ana'})])}, PORT, errors); const dp=D.page;
  const as = async u => { await dp.evaluate(u=>{ window.__fakeUser=u; }, u); await signIn(dp); };
  const out = async () => { await dp.evaluate(()=>syncSignOut()); await until(dp, ()=>!SY.user); };
  const asked = () => until(dp, ()=>SY.status==='other'&&!!document.querySelector('#asheet.on')&&performance.now()-sheetOpenedAt>500, null, 10000); // a sheet ignores taps for 450 ms
  const btns = () => dp.evaluate(()=>[...document.querySelectorAll('#asheet.on button')].map(b=>b.textContent.trim()));
  const tap = label => dp.evaluate(l=>{ [...document.querySelectorAll('#asheet.on button')].find(x=>x.textContent.trim()===l).click(); }, label);
  const noData = () => f2.rows(UB.uid, 'tasks').length===1 && ![...f2.store.keys()].some(k=>k.startsWith(UB.uid+'/')) && !f2.calls.some(c=>/^D:(pull|upsert|markDeleted|byIds|upload)/.test(c));
  await as(UA); check('A_first', await synced(dp) && f2.rows(UA.uid, 'tasks').length===2); await out();
  // 1. A photo of Ana's not uploaded yet: Bruno cannot empty the device; only «Cerrar sesión»; no restore meanwhile
  await dp.evaluate(async()=>{ const b=new Blob([new Uint8Array(2048).fill(3)], {type:'image/jpeg'}), now=new Date().toISOString();
    await FS.putFile('pa1', b, {pending:true, thumb:b}); DB.attachments.push({id:'pa1', taskId:'a1', kind:'photo', path:null, mime:'image/jpeg', size:b.size, width:1, height:1, durationMs:null, created:now, modified:now}); save(); });
  f2.calls.length=0; await as(UB); check('photo_blocks', await asked());
  const q1 = await dp.evaluate(()=>document.querySelector('#asheet').textContent), b1 = await btns();
  check('photo_blocks_text', /Este dispositivo tiene cambios sin enviar de otra cuenta \(\d+\)\. Entra con esa cuenta para enviarlos antes de usar aquí otra\./.test(q1) && !b1.includes('Continuar') && b1.includes('Cerrar sesión') && noData(), {q1, b1, calls:f2.calls});
  await shot(dp, 'ip-light-otra-cuenta-sin-enviar');
  const rsOther = await dp.evaluate(async()=>{ await BK.put(todayStr()); await refreshBackups(); restoreBackup(BACKUPS[0].date); return document.getElementById('toastText').textContent; });
  check('restore_refused_other_state', rsOther==='Este dispositivo tiene datos de otra cuenta. No se puede restaurar ahora', rsOther);
  await tap('Cerrar sesión'); check('B_out1', await until(dp, ()=>!SY.user) && noData());
  // Ana sends it, then leaves a change unsent: blocked again
  await as(UA); check('A_sends_photo', await synced(dp) && await until(dp, ()=>!!att('pa1').path, null, 10000) && [...f2.store.keys()].some(k=>k.startsWith(UA.uid+'/'))); await out();
  await dp.evaluate(()=>updTask('a2', {title:'Otra de Ana, cambiada sin conexión'})); f2.calls.length=0; await as(UB);
  check('task_blocks', await asked() && /cambios sin enviar de otra cuenta \(1\)/.test(await dp.evaluate(()=>document.querySelector('#asheet').textContent)) && !(await btns()).includes('Continuar') && noData());
  await tap('Cerrar sesión'); await until(dp, ()=>!SY.user);
  // Ana's last pass keeps the tables her database lacks (here contacts, as before 0011): a contact made here later is not «unsent»
  await dp.evaluate(()=>{ window.__tareasRemote.missing=new Set(['contacts']); });
  await as(UA); await synced(dp); check('A_sent_all', f2.rows(UA.uid, 'tasks').some(r=>r.id==='a2'&&r.title==='Otra de Ana, cambiada sin conexión'));
  check('missing_kept', await dp.evaluate(()=>(syncState().missing||[]).includes('contacts'))); await dp.evaluate(()=>{ delete window.__tareasRemote.missing; }); await out();
  // 3. Not unsent: rollOver's changes (synced fields, modified untouched), demo data, an attachment whose task is gone, a file whose attachment is
  // gone, and a table the database lacks
  await dp.evaluate(async()=>{ const x=task('a1'); x.date='2026-01-01'; x.carried=true; const b=new Blob([new Uint8Array(64)], {type:'image/jpeg'}), now=new Date().toISOString();
    DB.attachments.push({id:'demo-att', taskId:'demo-t1', kind:'photo', path:null, mime:'image/jpeg', size:64, created:now, modified:now}); await FS.putFile('demo-att', b, {pending:true});
    DB.attachments.push({id:'orphan', taskId:'gone-task', kind:'photo', path:null, mime:'image/jpeg', size:64, created:now, modified:now}); await FS.putFile('orphan', b, {pending:true});
    await FS.putFile('ghost', b, {pending:true}); DB.contacts.push({id:'c-new', name:'Contacto sin tabla', created:now, modified:now}); save(); });
  const np0 = await dp.evaluate(()=>syncOtherPending()); check('pending_precise', np0===0, np0);
  // 2. Nothing unsent: Continuar. From its start nothing is saved or synced (a change and a pass tried in the middle leave no trace)
  f2.calls.length=0; await as(UB); check('B_other', await asked());
  const q2 = await dp.evaluate(()=>document.querySelector('#asheet').textContent), b2 = await btns();
  check('B_question', /Este dispositivo tiene datos de otra cuenta\. Ya están todos en esa cuenta\./.test(q2) && /bruno@example\.com/.test(q2) && b2.includes('Continuar') && b2.includes('Cerrar sesión') && noData(), {q2, b2});
  await shot(dp, 'ip-light-otra-cuenta');
  // Another window of the app with Ana's data, and Ana's push subscription on this browser
  const P2 = await D.ctx.newPage(); await P2.goto('http://localhost:'+PORT+'/'); await until(P2, ()=>!!task('a1'));
  await dp.evaluate(a=>{ PS.sub={endpoint:'https://push.example/ana', keys:{}}; PS.savedFor=a; pushWrite(); }, UA.uid);
  await dp.evaluate(()=>{ const put=BK.put.bind(BK); BK.put=async(...a)=>{ const r=await put(...a); if(SY.switching){ const k='tareas-v1', before=localStorage.getItem(k); addTask({title:'Durante el cambio'}); const ran=syncRun('prueba');
      localStorage.setItem('__probe', JSON.stringify({unchanged:localStorage.getItem(k)===before, cover:!!document.getElementById('switching')&&app.inert, ran:String(ran)})); ran.then(v=>{ const p=JSON.parse(localStorage.getItem('__probe')); p.ranValue=v; localStorage.setItem('__probe', JSON.stringify(p)); }); } return r; }; });
  await tap('Continuar'); await dp.waitForLoadState('load');
  check('B_fresh', await synced(dp, 20000) && await dp.evaluate(()=>DB.tasks.map(x=>x.id).join()==='b1'&&!DB.attachments.length&&!DB.tasks.some(x=>x.title==='Durante el cambio')), await dp.evaluate(()=>({t:DB.tasks.map(x=>x.title), st:SY.status})));
  const probe = await dp.evaluate(()=>JSON.parse(localStorage.getItem('__probe')||'null'));
  check('no_save_or_sync_during_switch', probe && probe.unchanged && probe.cover && probe.ranValue===false && !f2.rows(UB.uid, 'tasks').some(r=>r.title==='Durante el cambio') && !f2.rows(UA.uid, 'tasks').some(r=>r.title==='Durante el cambio'), probe);
  const after = await dp.evaluate(async()=>({files:(await FS.allMeta()).length, team:localStorage.getItem('tareas-team'), cx:localStorage.getItem('tareas-crypto'), key:await cryptoKeyLoad().catch(()=>null), bk:(await BK.list()).map(b=>({k:b.date, o:b.owner})), owner:syncState().owner}));
  const tail = await dp.evaluate(()=>({log:logText(), line:LOG.some(e=>e.m==='Dispositivo vaciado para otra cuenta'), push:localStorage.getItem('tareas-push'), sub:!!PS.sub, marker:localStorage.getItem('tareas-switching')}));
  check('switch_clears_log_push', !/ana@example\.com/.test(tail.log) && tail.line && !tail.sub && !(tail.push&&JSON.parse(tail.push).sub) && !tail.marker, tail);
  check('other_window_blank', await until(P2, ()=>!task('a1')&&!localStorage.getItem('tareas-switching'), null, 15000) && await dp.evaluate(()=>!task('a1')&&!!task('b1')), await P2.evaluate(()=>DB.tasks.map(x=>x.id)));
  await P2.close();
  check('B_emptied', after.files===0 && !after.team && !after.cx && !after.key && after.owner===UB.uid && after.bk.every(b=>b.o===UA.uid) && after.bk.some(b=>/#/.test(b.k)) && f2.rows(UA.uid, 'tasks').length===2, after);
  // Ana's copies never restore into Bruno's account
  await dp.evaluate(()=>refreshBackups()); const rs = await dp.evaluate(async a=>{ const b=BACKUPS.find(x=>x.owner===a); restoreBackup(b.date); await new Promise(r=>setTimeout(r,100)); return {toast:document.getElementById('toastText').textContent, sheet:!!document.querySelector('#asheet.on, #sheet.on')}; }, UA.uid);
  check('B_backup_not_restored', rs.toast==='Esta copia es de otra cuenta. Inicia sesión con ella para restaurarla' && !rs.sheet, rs);
  // 3. Back to Ana the same day: Bruno's copy has its own key, Ana's stays
  await dp.evaluate(()=>updTask('b1', {title:'De Bruno, cambiada aquí'})); await synced(dp); const bkA = after.bk.map(b=>b.k); await out();
  f2.calls.length=0; await as(UA); check('A_other', await asked()); await tap('Continuar'); await dp.waitForLoadState('load');
  check('A_back', await synced(dp, 20000) && await dp.evaluate(()=>!DB.tasks.some(x=>x.id==='b1')&&!!task('a1')) && !f2.rows(UA.uid, 'tasks').some(r=>r.id==='b1') && f2.rows(UB.uid, 'tasks').length===1);
  const bks = await dp.evaluate(async()=>(await BK.list()).map(b=>({k:b.date, o:b.owner, n:b.tasks})));
  check('both_backups_kept', bkA.every(k=>bks.some(b=>b.k===k&&b.o===UA.uid)) && bks.some(b=>b.o===UB.uid&&b.n===1), {bkA, bks});
  const rs2 = await dp.evaluate(async b=>{ await refreshBackups(); const x=BACKUPS.find(o=>o.owner===b); restoreBackup(x.date); await new Promise(r=>setTimeout(r,100)); return document.getElementById('toastText').textContent; }, UB.uid);
  check('A_refuses_B_copy', rs2==='Esta copia es de otra cuenta. Inicia sesión con ella para restaurarla', rs2);
  // 4. The desktop: Intro is «Cerrar sesión», never «Continuar»
  const K = await TF.device(browser, f2, {tag:'K', desk:true, user:UA, seed:seed([tk('k1', {title:'En el ordenador'})])}, PORT, errors); const kp=K.page;
  await signIn(kp, true); await synced(kp); await kp.evaluate(()=>syncSignOut()); await until(kp, ()=>!SY.user);
  await kp.evaluate(u=>{ window.__fakeUser=u; }, UB); await signIn(kp, true);
  check('K_alert', await until(kp, ()=>SY.status==='other'&&!!document.querySelector('#asheet.on .al')&&performance.now()-sheetOpenedAt>500, null, 10000));
  await kp.keyboard.press('Enter');
  check('K_enter_signs_out', await until(kp, ()=>!SY.user) && await kp.evaluate(()=>!!task('k1')&&syncState().owner!==null));
  await K.ctx.close();
  await switchMore(browser);
  // A device that never synced with an account still brings its data in (decision 5): unchanged
  const N = await TF.device(browser, f2, {tag:'N', desk:true, user:UA, seed:seed([tk('n1', {title:'Antes de cualquier cuenta'})])}, PORT, errors); const np=N.page;
  await signIn(np, true); check('new_device_merges', await synced(np) && f2.rows(UA.uid, 'tasks').some(r=>r.id==='n1') && await np.evaluate(()=>!!task('a1')&&!!task('n1')));
  await D.ctx.close(); await N.ctx.close();
}
/* A first pass that never ended, a hung file store, «Vaciar de todos modos», the desktop's blocked alert, failed writes, the daily copy and
   the marker of another window */
async function switchMore(browser){
  const f3 = new TF.Fake(); f3.team = false;
  const A3 = f3.user('9b2f6d3e-0000-4000-8000-0000000000a3', 'alba@example.com', 'Alba'), B3 = f3.user('9b2f6d3e-0000-4000-8000-0000000000b3', 'blas@example.com', 'Blas');
  const F = await TF.device(browser, f3, {tag:'F', user:A3, seed:seed([tk('f1', {title:'De Alba sin enviar'}), tk('f2', {title:'Otra de Alba'})])}, PORT, errors); const fp=F.page;
  // 1. Alba's first pass pulls but its upload fails: no owner yet, but the device is hers (firstFor)
  f3.failRls=99; await signIn(fp); check('F_first_failed', await until(fp, ()=>SY.status==='error', null, 15000) && await fp.evaluate(a=>!syncState().owner&&syncState().firstFor===a, A3.uid));
  f3.failRls=0; await fp.evaluate(()=>syncSignOut()); await until(fp, ()=>!SY.user);
  await fp.evaluate(async()=>{ const b=new Blob([new Uint8Array(512)], {type:'image/jpeg'}), now=new Date().toISOString(); await FS.putFile('fp1', b, {pending:true});
    DB.attachments.push({id:'fp1', taskId:'f1', kind:'photo', path:null, mime:'image/jpeg', size:512, created:now, modified:now}); save(); FS.allMeta=()=>new Promise(()=>{}); }); // 8. the file store hangs
  await fp.evaluate(u=>{ window.__fakeUser=u; }, B3); f3.calls.length=0; await signIn(fp);
  check('F_other', await until(fp, ()=>SY.status==='other'&&!!document.querySelector('#asheet.on')&&performance.now()-sheetOpenedAt>500, null, 15000) && await fp.evaluate(a=>syncPrevOwner()===a&&syncOtherOwner(), A3.uid));
  const fq = await fp.evaluate(()=>({t:document.querySelector('#asheet').textContent, b:[...document.querySelectorAll('#asheet.on button')].map(x=>x.textContent.trim())}));
  check('F_blocked_unknown', /^Este dispositivo tiene cambios sin enviar de otra cuenta\. Entra con esa cuenta/.test(fq.t) && fq.b.join()==='Cerrar sesión,Vaciar de todos modos,Cancelar' && f3.rows(B3.uid, 'tasks').length===0 && !f3.calls.some(c=>/:(pull|upsert|markDeleted|upload)/.test(c)), {fq, calls:f3.calls});
  await shot(fp, 'ip-light-sin-enviar-vaciar');
  await fp.evaluate(()=>{ [...document.querySelectorAll('#asheet.on button')].find(x=>x.textContent.trim()==='Vaciar de todos modos').click(); });
  check('F_confirm', await until(fp, ()=>!!document.querySelector('#asheet.on')&&/solo quedarán en una copia de este dispositivo\. Las fotos y audios sin subir se perderán\./.test(document.querySelector('#asheet').textContent)&&performance.now()-sheetOpenedAt>500, null, 5000));
  await shot(fp, 'ip-light-vaciar-confirmar');
  await fp.evaluate(()=>{ [...document.querySelectorAll('#asheet.on button')].find(x=>x.textContent.trim()==='Vaciar').click(); }); await fp.waitForLoadState('load');
  check('F_emptied', await synced(fp, 20000) && await fp.evaluate(()=>!DB.tasks.length&&!DB.attachments.length) && f3.rows(B3.uid, 'tasks').length===0 && f3.rows(A3.uid, 'tasks').length===0
    && await fp.evaluate(async a=>{ const b=(await BK.list()).find(x=>x.owner===a&&/#/.test(x.date)); if(!b) return false; const sn=await BK.get(b.date); return sn.data.tasks.some(x=>x.id==='f1'); }, A3.uid));
  await F.ctx.close();
  // The desktop's blocked alert: Intro signs out; the destructive way takes a click and a confirmation
  const G = await TF.device(browser, f3, {tag:'G', desk:true, user:A3, seed:seed([tk('g1', {title:'De Alba en el ordenador'})])}, PORT, errors); const gp=G.page;
  await signIn(gp, true); await synced(gp); await gp.evaluate(()=>syncSignOut()); await until(gp, ()=>!SY.user); await gp.evaluate(()=>updTask('g1', {title:'Cambiada sin enviar'}));
  const bIn = async () => { await gp.evaluate(u=>{ window.__fakeUser=u; }, B3); await signIn(gp, true); return until(gp, ()=>SY.status==='other'&&!!document.querySelector('#asheet.on .al')&&performance.now()-sheetOpenedAt>500, null, 10000); };
  check('G_alert', await bIn() && await gp.evaluate(()=>[...document.querySelectorAll('#asheet.on .al-btn')].map(b=>b.textContent).join()==='Cerrar sesión,Vaciar de todos modos,Cancelar'&&/\(1\)/.test(document.querySelector('#asheet .al-t').textContent)));
  await shot(gp, 'desk-sin-enviar-vaciar');
  await gp.keyboard.press('Enter'); check('G_enter_signs_out', await until(gp, ()=>!SY.user) && await gp.evaluate(()=>task('g1').title==='Cambiada sin enviar'));
  // 6. The sync state cannot be written: nothing changes. The data cannot be blanked: the old state comes back as it was
  await bIn(); await gp.evaluate(()=>closeSheet()); const st0 = await gp.evaluate(()=>localStorage.getItem('tareas-sync'));
  const w1 = await gp.evaluate(async()=>{ const real=syncWrite; syncWrite=()=>false; try{ await syncSwitchAccount(true); } finally{ syncWrite=real; } return {t:document.getElementById('toastText').textContent, sync:localStorage.getItem('tareas-sync'), g1:!!task('g1'), stored:/g1/.test(localStorage.getItem('tareas-v1')), sw:SY.switching, cover:!!document.getElementById('switching'), marker:localStorage.getItem('tareas-switching')}; });
  check('write_sync_fails', w1.t==='No se pudo cambiar de cuenta. No se ha cambiado nada' && w1.sync===st0 && w1.g1 && w1.stored && !w1.sw && !w1.cover && !w1.marker, w1);
  const w2 = await gp.evaluate(async()=>{ const real=Storage.prototype.setItem; Storage.prototype.setItem=function(k,v){ if(k==='tareas-v1') throw new Error('QuotaExceededError'); return real.call(this,k,v); };
    try{ await syncSwitchAccount(true); } finally{ Storage.prototype.setItem=real; } return {sync:localStorage.getItem('tareas-sync'), g1:!!task('g1'), stored:/g1/.test(localStorage.getItem('tareas-v1')), sw:SY.switching, other:syncOtherOwner()}; });
  check('write_data_fails', w2.sync===st0 && w2.g1 && w2.stored && !w2.sw && w2.other, w2);
  // 9. Today's own-key copy of this account counts as today's daily copy
  const d9 = await gp.evaluate(async()=>{ await BK.clear(); localStorage.removeItem('tareas-bk-skip'); await BK.put(todayStr(), syncPrevOwner(), true); await refreshBackups(); const n=BACKUPS.length; await dailyBackup(false); await refreshBackups(); return [n, BACKUPS.length]; });
  check('daily_counts_own_key', d9[0]===1 && d9[1]===1, d9);
  // 5. With the marker of a switch, no window saves; at the next start a sync state already for the new account means blank data
  const m5 = await gp.evaluate(()=>{ localStorage.setItem('tareas-switching', '{"to":"x"}'); const before=localStorage.getItem('tareas-v1'); addTask({title:'Desde otra ventana'}); const same=localStorage.getItem('tareas-v1')===before; localStorage.removeItem('tareas-switching'); return same; });
  check('marker_blocks_save', m5);
  // 3. That restart also forgets what the sync state knew (nothing of the new account is then taken for deleted); the missing tables stay
  const r3 = await gp.evaluate(b=>{ localStorage.setItem('tareas-switching', JSON.stringify({to:b.uid})); syncWrite({user:{id:b.uid, email:b.email}, firstFor:b.uid, known:{tasks:{g9:'sig'}}, cursor:{tasks:'2026-11-05T00:00:00.000Z'}, del:{}, missing:['contacts']});
    const had=DB.tasks.length; syncSwitchBoot(); const st=syncState(); return {had, n:DB.tasks.length, known:Object.keys(st.known.tasks||{}).length, cursor:st.cursor.tasks||null, missing:st.missing, first:st.firstFor===b.uid, marker:localStorage.getItem('tareas-switching')}; }, B3);
  check('boot_resets_known', r3.had>0 && r3.n===0 && r3.known===0 && !r3.cursor && JSON.stringify(r3.missing)==='["contacts"]' && r3.first && !r3.marker, r3);
  await gp.evaluate(()=>{ addTask({title:'g1'}); }); // data again, for the restart below
  await gp.evaluate(b=>{ localStorage.setItem('tareas-switching', JSON.stringify({to:b.uid})); localStorage.setItem('tareas-sync', JSON.stringify({user:{id:b.uid, email:b.email}, firstFor:b.uid, known:{}, cursor:{}, del:{}})); }, B3);
  await gp.reload(); await gp.waitForTimeout(500);
  check('boot_reblanks', await gp.evaluate(()=>!DB.tasks.length&&!/g1/.test(localStorage.getItem('tareas-v1'))&&!localStorage.getItem('tareas-switching')));
  await G.ctx.close();
  // 1. What counts as unsent after a pass: an edit made during the pass (after its clean moment), a row still different at its end, and with the
  // clock moved back anything different; a roll-over change alone never
  const H = await TF.device(browser, f3, {tag:'H', user:A3, seed:seed([tk('h1', {title:'Uno'}), tk('h2', {title:'Dos'})])}, PORT, errors); const hp=H.page;
  await hp.evaluate(()=>{ localStorage.removeItem('tareas-sync'); }); await hp.reload(); await signIn(hp); await synced(hp);
  const st1 = await hp.evaluate(()=>{ const st=syncState(); return {clean:st.cleanAt, last:st.lastSync, dirty:st.dirty}; });
  check('pass_marks_clean', !!st1.clean && Date.parse(st1.clean)<=Date.parse(st1.last) && Array.isArray(st1.dirty) && st1.dirty.length===0, st1);
  await hp.evaluate(()=>syncSignOut()); await until(hp, ()=>!SY.user);
  const p1 = await hp.evaluate(async()=>{ const out={}; const x=task('h1'); x.date='2026-01-02'; x.carried=true; out.roll=await syncOtherPending(); // roll-over only
    let st=syncState(); const clean=Date.parse(st.cleanAt); st.lastSync=new Date(clean+60e3).toISOString(); syncWrite(st);
    const y=task('h2'); y.title='Editada durante la pasada'; y.modified=new Date(clean+30e3).toISOString(); out.during=await syncOtherPending();
    st=syncState(); st.dirty=['tasks:h1']; syncWrite(st); out.dirty=await syncOtherPending();
    st=syncState(); st.dirty=[]; st.cleanAt=new Date(Date.now()+864e5).toISOString(); syncWrite(st); y.modified=new Date(Date.now()-864e5*2).toISOString(); out.clockBack=await syncOtherPending(); return out; });
  check('pending_clean_rules', p1.roll===0 && p1.during===1 && p1.dirty===2 && p1.clockBack===2, p1);
  // 2. Copies: seven of this account (or none) are kept; another account's never count and are never removed automatically
  // 6. A copy made after a switch but before the new account's first pass carries the new account
  const c2 = await hp.evaluate(async()=>{ await BK.clear(); for(let i=0;i<3;i++) await BK.put('2026-10-0'+(i+1), 'otra-cuenta', true); for(let i=1;i<=9;i++) await BK.put('2026-10-'+String(10+i), undefined);
    const l=await BK.list(); const st=syncState(); syncWrite({user:null, firstFor:'cuenta-nueva', known:{}, cursor:{}, del:{}}); await BK.put('2026-09-01'); const l2=await BK.list(); localStorage.setItem('tareas-sync', JSON.stringify(st));
    return {other:l.filter(b=>b.owner==='otra-cuenta').length, mine:l.filter(b=>b.owner!=='otra-cuenta').length, oldest:l.filter(b=>b.owner!=='otra-cuenta').map(b=>b.date).sort()[0], newOwner:(l2.find(b=>b.date==='2026-09-01')||{}).owner}; });
  check('backups_other_kept', c2.other===3 && c2.mine===7 && c2.oldest==='2026-10-13', c2);
  check('backup_owner_prev', c2.newOwner==='cuenta-nueva', c2);
  await H.ctx.close();
}

module.exports = { pgSetup, strip, MIGS, fnTests, sqlTests, results:{r, fails, errors} };
if(require.main === module) (async()=>{
  try { await sqlTests(); } catch(e){ errors.push('sql: '+(e.stack||e.message)); }
  try { await fnTests(); } catch(e){ errors.push('fn: '+(e.stack||e.message)); }
  const srv = await TF.serve(PORT); const browser = await chromium.launch();
  try { await appTests(browser); } catch(e){ errors.push('app: '+(e.stack||e.message)); }
  await browser.close(); srv.close();
  console.log(JSON.stringify({r, fails, errors}, null, 1)); process.exit(fails.length||errors.length?1:0);
})();
