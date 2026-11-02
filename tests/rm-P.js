require('./lib/out.js'); // outputs (screenshots, downloads) go to tests/out
// Decision 25 and block 9 (Web Push reminders), port 9710 (function 9711, fake PostgREST 9712, fake push service 9713).
//  1. SQL: supabase/migrations/0002_push.sql run twice in PGlite (PostgreSQL in WebAssembly) after 0001, with stand-ins for auth, pg_cron and
//     pg_net: backfill, cron job, private keys, the subscribe function, row level security and the reminder_sent trigger rules.
//  2. Edge Function: supabase/functions/send-reminders/index.ts run by Deno (DENO env var or deno on PATH) against a fake PostgREST and a fake
//     push service. Every message is decrypted with http_ece (web-push's own decryption) and every VAPID JWT verified.
//  3. Decision 25 on the iPhone and the desktop: rollOver, Aplazar, bulk, Cerrar el día, the review, planning, reopening, H M V S, Fecha
//     menu, calendar drops; each with its Deshacer. The manual Fecha moves it too (decision 27a); Recordatorio edits are left alone.
//  4. The app: the permission sheet, every Ajustes state, the subscription through the fake remote (offline first), devices and Revocar,
//     Probar notificación through the real function, sign out; reminder_sent through the sync (fake server with the trigger's rules).
//  5. sw.js: a push (CDP ServiceWorker.deliverPushMessage) shows the notification and sets the badge; a tap opens the task (open app or
//     ?task= on start, iPhone and desktop). End to end: a due reminder goes from the function through the push service to the notification.
// Uses the new headless Chromium (channel 'chromium'): the old headless shell refuses the notification permission.
const { chromium } = require('playwright');
const http = require('http'); const fs = require('fs'); const path = require('path'); const crypto = require('crypto'); const { spawn } = require('child_process');
const ROOT = path.resolve(__dirname, '..'), PORT = 9710, URL0 = 'http://localhost:'+PORT+'/';
const FN_PORT = 9711, REST_PORT = 9712, PUSH_PORT = 9713;
const PDIR = path.join(__dirname, 'out', 'P'), DEPS = path.join(ROOT, 'node_modules'), OUT = PDIR; fs.mkdirSync(OUT, {recursive:true});
const TYPES = {'.html':'text/html','.css':'text/css','.js':'application/javascript','.webmanifest':'application/manifest+json','.png':'image/png'};
const srv = http.createServer((req,res)=>{ let p = decodeURIComponent(req.url.split('?')[0]); if(p==='/') p='/index.html';
  if(p==='/config.js'){ res.writeHead(200,{'Content-Type':'application/javascript'}); res.end('window.TAREAS_CONFIG = {"url":null,"anonKey":null};\n'); return; } // local only; the fake comes in through the adapter
  const f=path.join(ROOT,p); if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){ res.writeHead(404,{'Content-Type':'text/html'}); res.end('<h1>404</h1>'); return; }
  res.writeHead(200,{'Content-Type':TYPES[path.extname(f)]||'application/octet-stream'}); res.end(fs.readFileSync(f)); });

const r={}, fails=[], errors=[]; const check=(name, ok, info)=>{ r[name]=ok?true:(info===undefined?false:info); if(!ok) fails.push(name); };
const pad=n=>String(n).padStart(2,'0'); const dstr=d=>d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());
const addD=(s,n)=>{ const d=new Date(s+'T12:00:00'); d.setDate(d.getDate()+n); return dstr(d); };
const today=dstr(new Date()), yest=addD(today,-1), tomorrow=addD(today,1), past2=addD(today,-2);
const at=(day, hms)=>new Date(day+'T'+hms).toISOString(); // local time, as the page
const b64u=b=>Buffer.from(b).toString('base64url');
const sameTs=(a,b)=>(a==null&&b==null)||(a!=null&&b!=null&&Date.parse(a)===Date.parse(b));
const IOS_UA='Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

/* ======================= 1. SQL ======================= */
async function sqlTests(){
  const { PGlite } = await import(path.join(DEPS, '@electric-sql/pglite/dist/index.js'));
  const db = new PGlite();
  await db.exec(`
    create role authenticated; create role anon; create schema auth; create schema extensions;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
    grant usage on schema auth to authenticated, anon; grant execute on function auth.uid() to authenticated, anon;
    create schema cron; create table cron.job (jobid serial primary key, jobname text unique, schedule text, command text);
    create function cron.schedule(n text, s text, c text) returns bigint language sql as $$ insert into cron.job (jobname, schedule, command) values (n, s, c) returning jobid $$;
    create function cron.unschedule(n text) returns boolean language sql as $$ delete from cron.job where jobname = n returning true $$;
    create schema net; create table net.calls (id serial primary key, url text, body jsonb, headers jsonb, timeout int);
    create function net.http_post(url text, body jsonb default '{}', params jsonb default '{}', headers jsonb default '{}', timeout_milliseconds int default 5000)
      returns bigint language sql as $$ insert into net.calls (url, body, headers, timeout) values (url, body, headers, timeout_milliseconds) returning id $$;
  `);
  const strip = s => s.replace(/^create extension if not exists pg_(cron|net).*$/mg, '-- (extension stand-in)');
  const m1 = fs.readFileSync(path.join(ROOT, 'supabase/migrations/0001_init.sql'), 'utf8');
  const m2 = fs.readFileSync(path.join(ROOT, 'supabase/migrations/0002_push.sql'), 'utf8');
  check('sql_extensions_named', /create extension if not exists pg_cron/.test(m2) && /create extension if not exists pg_net/.test(m2));
  await db.exec(m1);
  const A = '00000000-0000-4000-8000-00000000000a', Bu = '00000000-0000-4000-8000-00000000000b';
  await db.exec(`insert into auth.users values ('${A}'), ('${Bu}')`);
  await db.exec(`insert into public.tasks (id, owner_id, title, reminder, status, modified) values
    ('old', '${A}', 'Pasada', now() - interval '3 hours', 'pending', now()), ('fut', '${A}', 'Futura', now() + interval '3 hours', 'pending', now())`);
  let err = null; try { await db.exec(strip(m2)); await db.exec(strip(m2)); } catch(e){ err = e.message; }
  check('sql_runs_twice', !err, err);
  const q = async (sql, params) => (await db.query(sql, params)).rows;
  const back = await q(`select id, reminder_sent is not null as sent from public.tasks order by id`);
  check('sql_backfill', back.length===2 && back.find(r=>r.id==='old').sent && !back.find(r=>r.id==='fut').sent, back);
  const jobs = await q(`select jobname, schedule, command from cron.job`);
  check('sql_cron_job', jobs.length===1 && jobs[0].schedule==='* * * * *' && /net\.http_post/.test(jobs[0].command), jobs);
  await db.exec(jobs[0].command); let calls = await q(`select * from net.calls`); const noUrl = calls.length===0;
  await db.exec(`insert into public.push_keys (id, public_key, private_jwk) values (1, 'PUB', '{"kty":"EC"}')`);
  await db.exec(`update public.push_keys set function_url = 'https://ref.supabase.co/functions/v1/send-reminders' where id = 1`);
  await db.exec(jobs[0].command); calls = await q(`select * from net.calls`);
  check('sql_cron_calls_function', noUrl && calls.length===1 && calls[0].url==='https://ref.supabase.co/functions/v1/send-reminders' && JSON.stringify(calls[0].body)==='{}', calls);
  const as = async (uid, fn) => { await db.exec(`set test.uid = '${uid}'; set role authenticated;`); try { return await fn(); } finally { await db.exec(`reset role; reset test.uid;`); } };
  const tryq = async (sql, params) => { try { return {rows: await q(sql, params)}; } catch(e){ return {error: e.message}; } };
  const keysA = await as(A, () => tryq(`select * from public.push_keys`));
  check('sql_keys_private', !!keysA.error && /permission denied/.test(keysA.error), keysA);
  const sub = (uid, id, ep, k) => as(uid, () => tryq(`select public.tareas_push_subscribe($1, $2, $3, $4, $5) as id`, [id, ep, k, 'AU', 'iPhone']));
  const s1 = await sub(A, 'sub-1', 'https://push.example/1', 'P'); check('sql_subscribe', s1.rows && s1.rows[0].id==='sub-1', s1);
  const s2 = await sub(Bu, 'sub-2', 'https://push.example/1', 'P2');
  const subs = await q(`select id, owner_id from public.push_subscriptions order by id`);
  check('sql_subscribe_moves', s2.rows && subs.length===1 && subs[0].id==='sub-2' && subs[0].owner_id===Bu, subs);
  const seenA = await as(A, () => tryq(`select id from public.push_subscriptions`)), seenB = await as(Bu, () => tryq(`select id from public.push_subscriptions`));
  check('sql_subs_rls', seenA.rows && seenA.rows.length===0 && seenB.rows && seenB.rows.length===1, {seenA, seenB});
  const anonTry = await (async()=>{ await db.exec(`set role anon`); try { return await tryq(`select public.tareas_push_subscribe('x','y','z','w','d')`); } finally { await db.exec(`reset role`); } })();
  check('sql_subscribe_needs_login', !!anonTry.error, anonTry);
  const rv = await as(Bu, () => tryq(`update public.push_subscriptions set deleted = now(), modified = now() + interval '1 second' where id = 'sub-2' returning id`));
  check('sql_revoke', rv.rows && rv.rows.length===1, rv);
  const re = await sub(Bu, 'sub-2', 'https://push.example/1', 'P2'); const back2 = await q(`select deleted from public.push_subscriptions where id = 'sub-2'`);
  check('sql_subscribe_again', re.rows && back2.length===1 && back2[0].deleted===null, {re, back2}); // even after a revoke made with a clock ahead
  await as(A, () => tryq(`insert into public.tasks (id, title, reminder, status, modified) values ('r1', 'x', '2026-11-02T09:00:00Z', 'pending', '2026-11-02T08:00:00Z')`));
  await db.exec(`update public.tasks set reminder_sent = '2026-11-02T09:00:30Z' where id = 'r1'`);
  const sentOf = async id => (await q(`select reminder_sent from public.tasks where id = $1`, [id]))[0].reminder_sent;
  const upd = (id, set) => as(A, () => tryq(`update public.tasks set ${set} where id = '${id}' returning id`));
  await upd('r1', `title = 'otro', reminder_sent = null, modified = '2026-11-02T10:00:00Z'`); const kept = await sentOf('r1');
  await upd('r1', `reminder = '2026-11-03T09:00:00Z', modified = '2026-11-02T10:01:00Z'`); const cleared = await sentOf('r1');
  await upd('r1', `reminder = '2026-11-02T07:00:00Z', reminder_sent = '2026-11-02T10:02:00Z', modified = '2026-11-02T10:02:00Z'`); const marked = await sentOf('r1');
  await upd('r1', `reminder = '2026-11-02T07:00:00Z', reminder_sent = '2026-11-02T10:03:00Z', modified = '2026-11-01T00:00:00Z'`); const older = await sentOf('r1');
  check('sql_reminder_sent_rules', kept && +new Date(kept)===Date.parse('2026-11-02T09:00:30Z') && cleared===null && marked && +new Date(marked)===Date.parse('2026-11-02T10:02:00Z') && +new Date(older)===+new Date(marked), {kept, cleared, marked, older});
  const cols = await q(`select column_name from information_schema.columns where table_schema='public' and table_name='push_subscriptions' order by ordinal_position`);
  check('sql_subs_columns', cols.map(c=>c.column_name).join()==='id,owner_id,endpoint,p256dh,auth,device,created,modified,deleted,server_ts', cols.map(c=>c.column_name));
  await db.close();
}

/* ======================= Fakes: PostgREST, push service, the function under Deno ======================= */
// A small PostgREST over a store: the queries the function makes (eq, lte, is.null, in, select, limit, on_conflict, Prefer count and resolution)
class Rest {
  constructor(store){ this.s = store; this.log = []; }
  match(row, filters){ return filters.every(([k, v]) => { const x = row[k];
    if (v === 'is.null') return x === null || x === undefined;
    if (v.startsWith('eq.')) return String(x) === v.slice(3);
    if (v.startsWith('lte.')) return x !== null && x !== undefined && (/^\d{4}-\d{2}-\d{2}$/.test(v.slice(4)) ? String(x) <= v.slice(4) : Date.parse(x) <= Date.parse(v.slice(4)));
    if (v.startsWith('in.(')) return v.slice(4, -1).split(',').map(s => s.replace(/^"|"$/g, '')).includes(String(x));
    throw new Error('filter ' + v); }); }
  handle(req, body){ const u = new URL(req.url, 'http://x'); const table = u.pathname.replace('/rest/v1/', ''); const rows = this.s.list(table); if (!rows) return [404, {message:'no table '+table}];
    const filters = [], meta = {}; for (const [k, v] of u.searchParams) { if (['select','limit','on_conflict'].includes(k)) meta[k] = v; else filters.push([k, v]); }
    const prefer = req.headers['prefer'] || ''; this.log.push({method:req.method, table, filters, auth:req.headers['authorization'], apikey:req.headers['apikey']});
    const pick = r => { if (!meta.select || meta.select === '*') return Object.assign({}, r); const o = {}; meta.select.split(',').forEach(c => o[c] = r[c] === undefined ? null : r[c]); return o; };
    if (req.method === 'GET') { let m = rows.filter(r => this.match(r, filters)); const n = m.length; if (meta.limit) m = m.slice(0, +meta.limit);
      return [200, m.map(pick), /count=exact/.test(prefer) ? {'Content-Range': (m.length ? '0-' + (m.length-1) : '*') + '/' + n} : {}]; }
    if (req.method === 'POST') { (Array.isArray(body) ? body : [body]).forEach(x => { if (rows.find(y => y.id === x.id)) { if (!/ignore-duplicates/.test(prefer)) throw new Error('duplicate'); return; } this.s.insert(table, Object.assign({}, x)); }); return [201, null]; }
    if (req.method === 'PATCH') { const m = rows.filter(x => this.match(x, filters)); m.forEach(x => { Object.assign(x, body); this.s.touch(table, x); }); return [200, /return=representation/.test(prefer) ? m.map(pick) : null]; }
    if (req.method === 'DELETE') { rows.filter(x => this.match(x, filters)).forEach(x => this.s.remove(table, x)); return [200, null]; }
    return [405, null]; }
}
const arrayStore = () => { const t = { tasks:[], projects:[], push_subscriptions:[], push_keys:[] };
  return { t, list: n => t[n], insert: (n, x) => t[n].push(x), remove: (n, x) => { t[n] = t[n].filter(y => y !== x); }, touch: () => {} }; };
let REST = null, PUSHES = [], GONE = new Set();
async function startServers(){
  const restSrv = http.createServer((req, res) => { let b = ''; req.on('data', c => b += c); req.on('end', () => {
    try {
      if (req.url.startsWith('/auth/v1/user')) { const m = /^Bearer jwt-(.+)$/.exec(req.headers['authorization'] || '');
        if (m) { res.writeHead(200, {'Content-Type':'application/json'}); res.end(JSON.stringify({id:m[1]})); } else { res.writeHead(401); res.end('{"msg":"invalid"}'); } return; }
      const [st, out, hdr] = REST.handle(req, b ? JSON.parse(b) : undefined);
      res.writeHead(st, Object.assign({'Content-Type':'application/json'}, hdr || {})); res.end(out === null || out === undefined ? '' : JSON.stringify(out));
    } catch(e){ res.writeHead(500); res.end(JSON.stringify({message:e.message})); } }); });
  const pushSrv = http.createServer((req, res) => { const ch = []; req.on('data', c => ch.push(c)); req.on('end', () => {
    PUSHES.push({ url:req.url, headers:req.headers, body:Buffer.concat(ch) }); res.writeHead(GONE.has(req.url) ? 410 : 201); res.end(); }); });
  await new Promise(r => restSrv.listen(REST_PORT, r)); await new Promise(r => pushSrv.listen(PUSH_PORT, r));
  const wrapper = path.join(PDIR, 'serve-fn.ts');
  fs.writeFileSync(wrapper, `(globalThis as any).TAREAS_NO_SERVE = true;\nconst m = await import('file://${ROOT}/supabase/functions/send-reminders/index.ts');\nDeno.serve({ port: ${FN_PORT}, hostname: '127.0.0.1', onListen(){ console.log('listening'); } }, m.handler);\n`);
  const deno = spawn(process.env.DENO || 'deno', ['run', '--allow-net', '--allow-env', '--allow-read', wrapper], { env: Object.assign({}, process.env, {
    SUPABASE_URL: 'http://127.0.0.1:' + REST_PORT, SUPABASE_SERVICE_ROLE_KEY: 'eyJservice', SUPABASE_ANON_KEY: 'anon-key', DENO_DIR: path.join(PDIR, 'denodir'), NO_COLOR: '1' }) });
  const st = { out:'' }; deno.stdout.on('data', d => st.out += d); deno.stderr.on('data', d => st.out += d);
  for (let i = 0; i < 150 && !/listening/.test(st.out); i++) await sleep(100);
  return { st, stop(){ deno.kill(); restSrv.close(); pushSrv.close(); } };
}
const FN = 'http://127.0.0.1:' + FN_PORT + '/';
const fnCall = async (method, q, body, headers) => { const res = await fetch(FN + (q || ''), { method, headers: Object.assign({'Content-Type':'application/json'}, headers || {}), body: body === undefined ? undefined : JSON.stringify(body) });
  const t = await res.text(); let j = null; try { j = JSON.parse(t); } catch(e){} return { status:res.status, json:j, headers:res.headers }; };
function newDevice(){ const ecdh = crypto.createECDH('prime256v1'); ecdh.generateKeys(); const auth = crypto.randomBytes(16); return { ecdh, auth, p256dh: b64u(ecdh.getPublicKey()), authB64: b64u(auth) }; }
function verifyVapid(header, now){ const m = /^vapid t=([^,]+), k=(.+)$/.exec(header || ''); if (!m) return {ok:false, why:'shape'};
  const [h, p, s] = m[1].split('.'); const pub = Buffer.from(m[2], 'base64url');
  const key = crypto.createPublicKey({ key:{ kty:'EC', crv:'P-256', x:b64u(pub.subarray(1,33)), y:b64u(pub.subarray(33,65)) }, format:'jwk' });
  const ok = crypto.verify('sha256', Buffer.from(h + '.' + p), { key, dsaEncoding:'ieee-p1363' }, Buffer.from(s, 'base64url'));
  const head = JSON.parse(Buffer.from(h, 'base64url')), claims = JSON.parse(Buffer.from(p, 'base64url'));
  return { ok, head, claims, k:m[2], expOk: claims.exp > now/1000 && claims.exp <= now/1000 + 24*3600 }; }
let ece = null; const decrypt = (body, dev) => JSON.parse(ece.decrypt(body, { version:'aes128gcm', privateKey:dev.ecdh, authSecret:dev.authB64 }).toString());

/* ======================= 2. Edge Function ======================= */
async function fnTests(st){
  const webpush = require(path.join(DEPS, 'web-push'));
  { const k = webpush.generateVAPIDKeys(); const h = webpush.getVapidHeaders('https://web.push.apple.com', 'https://x.supabase.co', k.publicKey, k.privateKey, 'aes128gcm').Authorization;
    const v = verifyVapid(h, Date.now()); check('fn_verifier_on_webpush', v.ok && v.head.alg==='ES256' && v.head.typ==='JWT' && Object.keys(v.claims).sort().join()==='aud,exp,sub', v);
    const d = newDevice(); const ct = webpush.encrypt(d.p256dh, d.authB64, 'hola', 'aes128gcm');
    check('fn_ece_on_webpush', ece.decrypt(ct.cipherText, { version:'aes128gcm', privateKey:d.ecdh, authSecret:d.authB64 }).toString()==='hola'); }
  const store = arrayStore(); REST = new Rest(store); PUSHES.length = 0; GONE.clear();
  const SUPA = 'http://127.0.0.1:' + REST_PORT;
  check('fn_deno_started', /listening/.test(st.out), st.out.slice(0, 500));
  const pre = await fnCall('OPTIONS', '?publicKey'); check('fn_cors', pre.status===204 && pre.headers.get('access-control-allow-origin')==='*' && /authorization/.test(pre.headers.get('access-control-allow-headers')||''), pre.status);
  const k1 = await fnCall('GET', '?publicKey'), k2 = await fnCall('GET', '?publicKey'); const row = store.t.push_keys[0];
  check('fn_public_key', k1.status===200 && k1.json && /^[A-Za-z0-9_-]{87}$/.test(k1.json.publicKey) && k2.json.publicKey===k1.json.publicKey && store.t.push_keys.length===1 && row.public_key===k1.json.publicKey && row.private_jwk && row.private_jwk.d && !('d' in k1.json), {k1:k1.json});
  check('fn_url_stored', row.function_url===SUPA+'/functions/v1/send-reminders', row.function_url);
  check('fn_service_role_headers', REST.log.every(l => l.apikey==='eyJservice' && l.auth==='Bearer eyJservice'));
  const now = Date.now(), iso = ms => new Date(now + ms).toISOString(), day = new Date().toISOString().slice(0, 10);
  const dA1 = newDevice(), dA2 = newDevice(), dB = newDevice(), EP = n => 'http://127.0.0.1:'+PUSH_PORT+'/push/'+n;
  store.t.push_subscriptions.push(
    { id:'sA1', owner_id:'user-A', endpoint:EP('a1'), p256dh:dA1.p256dh, auth:dA1.authB64, deleted:null },
    { id:'sA2', owner_id:'user-A', endpoint:EP('a2'), p256dh:dA2.p256dh, auth:dA2.authB64, deleted:null },
    { id:'sAx', owner_id:'user-A', endpoint:EP('revoked'), p256dh:dA2.p256dh, auth:dA2.authB64, deleted:iso(-60e3) },
    { id:'sB', owner_id:'user-B', endpoint:EP('b'), p256dh:dB.p256dh, auth:dB.authB64, deleted:null });
  GONE.add('/push/a2'); store.t.projects.push({ id:'p1', name:'FLC', deleted:null });
  const T = (id, o) => Object.assign({ id, owner_id:'user-A', title:'Tarea '+id, project_id:null, date:day, reminder:null, reminder_sent:null, status:'pending', deleted:null }, o);
  store.t.tasks.push(T('t1', { project_id:'p1', reminder:iso(-60e3), title:'Preparar comité' }), T('t2', { reminder:iso(10*60e3) }), T('t3', { reminder:iso(-60e3), status:'done' }),
    T('t4', { reminder:iso(-60e3), deleted:iso(-30e3) }), T('t5', { reminder:iso(-60e3), reminder_sent:iso(-50e3) }), T('t6', { owner_id:'user-B', reminder:iso(-2*36e5) }),
    T('t7', { reminder:iso(-30e3), title:'Llamar a Marta' }), T('t8', { owner_id:'user-C', reminder:iso(-30e3) }), T('t9', {}), T('t10', { date:'2026-01-01' }), T('t11', { date:null }));
  const r1 = await fnCall('POST', '', {});
  const sentIds = store.t.tasks.filter(t => t.reminder_sent && t.id!=='t5').map(t => t.id).sort();
  check('fn_cron_counts', r1.status===200 && r1.json && r1.json.due===4 && r1.json.late===1 && r1.json.sent===2 && r1.json.gone===1 && r1.json.failed===0, r1.json);
  check('fn_cron_marked', sentIds.join()==='t1,t6,t7,t8', sentIds); // t6 is more than an hour late: marked without notifying; t8's owner has no device
  const toA1 = PUSHES.filter(p => p.url==='/push/a1'), toA2 = PUSHES.filter(p => p.url==='/push/a2');
  check('fn_cron_targets', toA1.length===2 && toA2.length===2 && PUSHES.length===4, PUSHES.map(p => p.url));
  check('fn_gone_deleted', !store.t.push_subscriptions.some(s => s.id==='sA2') && store.t.push_subscriptions.some(s => s.id==='sA1'), store.t.push_subscriptions.map(s => s.id));
  const msgs = toA1.map(p => { let pt = null, err = null; try { pt = decrypt(p.body, dA1); } catch(e){ err = e.message; } return { pt, err, h:p.headers, v:verifyVapid(p.headers['authorization'], Date.now()) }; });
  const m1 = msgs.find(m => m.pt && m.pt.tag==='t1'), m7 = msgs.find(m => m.pt && m.pt.tag==='t7');
  check('fn_payload_t1', m1 && m1.pt.title==='Preparar comité' && m1.pt.body==='FLC' && m1.pt.data.taskId==='t1' && m1.pt.data.url==='./?task=t1' && m1.pt.badge===6, m1 && m1.pt || msgs.map(m=>m.err));
  check('fn_payload_t7', m7 && m7.pt.title==='Llamar a Marta' && m7.pt.body==='Recordatorio', m7 && m7.pt);
  check('fn_push_headers', msgs.every(m => m.h['content-encoding']==='aes128gcm' && m.h['content-type']==='application/octet-stream' && +m.h['ttl']>0 && m.h['urgency']==='high'), msgs.map(m=>m.h));
  check('fn_vapid', msgs.every(m => m.v.ok && m.v.expOk && m.v.claims.aud==='http://127.0.0.1:'+PUSH_PORT && m.v.claims.sub===SUPA && m.v.k===row.public_key && m.v.head.alg==='ES256'), msgs.map(m=>m.v));
  let cross = false; try { decrypt(toA1[0].body, dB); cross = true; } catch(e){} check('fn_payload_bound_to_device', !cross);
  const r2 = await fnCall('POST', '', {}); check('fn_cron_once', r2.json && r2.json.due===0 && PUSHES.length===4, r2.json);
  const r3 = await fnCall('POST', '', undefined); check('fn_cron_empty_body', r3.status===200 && r3.json && r3.json.due===0, r3.json);
  // Decision 41: a task Por confirmar notifies too, and on its review day it counts in the badge (one without a date, or a later one, does not)
  store.t.tasks.push(T('w1', { status:'waiting', reminder:iso(-20e3), title:'Esperando la firma' }), T('w2', { status:'waiting', date:null }), T('w3', { status:'waiting', date:'2099-01-01' }));
  const nW = PUSHES.length, r4 = await fnCall('POST', '', {}); const pw = PUSHES.slice(nW).filter(p => p.url==='/push/a1').map(p => decrypt(p.body, dA1));
  check('fn_waiting_notifies', r4.json && r4.json.due===1 && r4.json.sent===1 && pw.length===1 && pw[0].tag==='w1' && pw[0].title==='Esperando la firma' && pw[0].badge===7 && !!store.t.tasks.find(t=>t.id==='w1').reminder_sent, {json:r4.json, pw}); // the badge of t1 was 6, plus w1
  GONE.clear(); store.t.push_subscriptions.push({ id:'sA3', owner_id:'user-A', endpoint:EP('a3'), p256dh:dA2.p256dh, auth:dA2.authB64, deleted:null });
  const n0 = PUSHES.length; const tNo = await fnCall('POST', '', {test:true}), tBad = await fnCall('POST', '', {test:true}, {Authorization:'Bearer nope'});
  check('fn_test_needs_session', tNo.status===401 && tBad.status===401 && PUSHES.length===n0, [tNo.status, tBad.status]);
  const tOne = await fnCall('POST', '', {test:true, id:'sA1'}, {Authorization:'Bearer jwt-user-A'}); const one = PUSHES.slice(n0); const pt = one[0] && decrypt(one[0].body, dA1);
  check('fn_test_one', tOne.status===200 && tOne.json.sent===1 && one.length===1 && one[0].url==='/push/a1' && pt && pt.body==='Notificación de prueba' && pt.data.test===true, {json:tOne.json, urls:one.map(p=>p.url), pt});
  const n1 = PUSHES.length; const tAll = await fnCall('POST', '', {test:true}, {Authorization:'Bearer jwt-user-A'});
  check('fn_test_all_own', tAll.json && tAll.json.sent===2 && PUSHES.slice(n1).map(p=>p.url).sort().join()==='/push/a1,/push/a3', {json:tAll.json});
  check('fn_method', (await fnCall('PUT', '', {})).status===405);
  check('fn_logs', /"event":"reminders"/.test(st.out) && /"event":"vapid-created"/.test(st.out) && /"event":"function-url-stored"/.test(st.out), st.out.slice(-800));
}

/* ======================= Fake sync server (rm-S's, plus reminder_sent and push_subscriptions) ======================= */
// Updated by decision 29 (attachments): the app syncs a fifth table, so the fake server has it too
const TABLES = ['spaces','projects','tasks','voice_notes','attachments'];
class Fake {
  constructor(){ this.t={}; TABLES.concat(['push_subscriptions']).forEach(x=>this.t[x]=new Map()); this.last=0; this.subs=new Map(); this.down=new Set(); this.calls=[]; this.upserts=[]; }
  ts(){ this.last=Math.max(Date.now(), this.last+1); return new Date(this.last).toISOString(); }
  write(owner, table, rows){ if(!owner) throw new Error('JWT required'); const ts=this.ts(), out=[], changed=[]; const m=this.t[table];
    rows.forEach(r=>{ if(!r.id||!r.modified) throw new Error('bad row'); const ex=m.get(r.id); if(ex && ex.owner_id!==owner) throw new Error('rls'); });
    if(table==='tasks') this.upserts.push(...rows.map(r=>JSON.parse(JSON.stringify(r))));
    rows.forEach(r=>{ const ex=m.get(r.id);
      if(!ex){ const row=Object.assign({id:r.id, owner_id:owner, created:null, deleted:null, reminder_sent:null}, r, {owner_id:owner, server_ts:ts}); m.set(r.id,row); out.push({id:r.id}); changed.push(row); return; }
      if(Date.parse(r.modified) < Date.parse(ex.modified)) return;
      // 0002_push.sql, trigger tareas_reminder_sent (a column absent from the write keeps its stored value, as PostgREST does)
      let rs = table==='tasks' ? ('reminder_sent' in r ? r.reminder_sent : ex.reminder_sent) : undefined;
      if(table==='tasks'){ const nr='reminder' in r ? r.reminder : ex.reminder; if(!sameTs(nr, ex.reminder)){ if(sameTs(rs, ex.reminder_sent)) rs=null; } else if(rs==null) rs=ex.reminder_sent; }
      Object.assign(ex, r, {owner_id:ex.owner_id, server_ts:ts}); if(table==='tasks') ex.reminder_sent=rs; out.push({id:r.id}); changed.push(ex); });
    changed.forEach(row=>this.notify(table, row)); return out; }
  touch(table, row){ row.server_ts=this.ts(); this.notify(table, row); } // a write by the function (service role): the trigger moves server_ts
  notify(table, row){ if(!TABLES.includes(table)) return; const copy=JSON.parse(JSON.stringify(row));
    for(const [page, uid] of this.subs){ if(uid!==row.owner_id || this.down.has(page)) continue; setTimeout(()=>{ page.evaluate(([t,r])=>window.__fakeRT&&window.__fakeRT(t,r), [table, copy]).catch(()=>{}); }, 40); } }
  rows(owner, table){ return [...this.t[table].values()].filter(r=>r.owner_id===owner); }
  async handle(page, op, a){ this.calls.push(op); if(this.down.has(page) && op!=='signIn') throw new Error('Failed to fetch'); const own=a&&a.owner;
    switch(op){
      case 'signIn': return {id:a.uid, email:a.email};
      case 'pull': { let rs=this.rows(own, a.table); if(a.after) rs=rs.filter(r=>Date.parse(r.server_ts)>Date.parse(a.after));
        rs.sort((x,y)=>x.server_ts<y.server_ts?-1:x.server_ts>y.server_ts?1:x.id<y.id?-1:1); return JSON.parse(JSON.stringify(rs.slice(0,a.limit))); }
      case 'byIds': return JSON.parse(JSON.stringify(this.rows(own, a.table).filter(r=>a.ids.includes(r.id))));
      case 'upsert': return this.write(own, a.table, a.rows);
      case 'markDeleted': return this.write(own, a.table, a.items.map(x=>({id:x.id, deleted:x.ts, modified:x.ts})));
      case 'subscribe': this.subs.set(page, a.uid); return true;
      case 'unsubscribe': this.subs.delete(page); return true;
      // Block 9, as 0002_push.sql and the function
      case 'pushKey': { const k=await fnCall('GET', '?publicKey'); if(k.status!==200) throw new Error('HTTP '+k.status); return k.json.publicKey; }
      case 'pushSave': { if(!own) throw new Error('not signed in'); const m=this.t.push_subscriptions; const s=a.sub;
        for(const [id,row] of m) if((row.endpoint===s.endpoint && id!==s.id) || (id===s.id && row.owner_id!==own)) m.delete(id);
        const ex=m.get(s.id), now=new Date().toISOString(); m.set(s.id, Object.assign(ex||{created:now}, {id:s.id, owner_id:own, endpoint:s.endpoint, p256dh:s.p256dh, auth:s.auth, device:s.device, modified:now, deleted:null})); return null; }
      case 'pushList': return [...this.t.push_subscriptions.values()].filter(x=>x.owner_id===own && !x.deleted).sort((x,y)=>x.created<y.created?-1:1).map(x=>({id:x.id, device:x.device, created:x.created}));
      case 'pushRevoke': { const x=this.t.push_subscriptions.get(a.id); if(!x||x.owner_id!==own) return []; x.deleted=x.modified=new Date().toISOString(); return [{id:a.id}]; }
      case 'pushTest': { const res=await fnCall('POST', '', {test:true, id:a.id}, {Authorization:'Bearer jwt-'+own}); if(res.status!==200) throw new Error('HTTP '+res.status); return res.json; }
    } throw new Error('op '+op); }
}
let fake = new Fake();
const USER = {uid:'9b2f6d3e-0000-4000-8000-00000000e001', email:'enric@example.com'};
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
    pushKey:()=>call('pushKey',{}), pushSave:s=>call('pushSave',{owner:owner(), sub:s}), pushList:()=>call('pushList',{owner:owner()}),
    pushRevoke:id=>call('pushRevoke',{owner:owner(), id}), pushTest:id=>call('pushTest',{owner:owner(), id})
  };
}
// The browser's push side, which a test cannot reach for real (no push service here): permission, subscribe and getSubscription.
// requests records the event being handled when the permission was asked (it must be the tap's click)
function pushStub(cfg){
  const P=window.__push={perm:cfg.perm||'default', answer:cfg.answer||'granted', sub:null, requests:[], subscribes:[], unsubs:0};
  if(cfg.standalone) Object.defineProperty(navigator, 'standalone', {get:()=>true, configurable:true});
  if(cfg.noPush){ try{ delete window.PushManager; }catch(e){} return; }
  try{ Object.defineProperty(Notification, 'permission', {get:()=>P.perm, configurable:true}); }catch(e){}
  Notification.requestPermission=function(){ P.requests.push(window.event?window.event.type:null); P.perm=P.answer; return Promise.resolve(P.perm); };
  const mk=buf=>({endpoint:cfg.endpoint, options:{applicationServerKey:buf, userVisibleOnly:true}, toJSON(){ return {endpoint:cfg.endpoint, expirationTime:null, keys:{p256dh:cfg.p256dh, auth:cfg.auth}}; }, unsubscribe(){ P.unsubs++; P.sub=null; return Promise.resolve(true); }});
  const b64=buf=>btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  PushManager.prototype.getSubscription=function(){ return Promise.resolve(P.sub); };
  PushManager.prototype.subscribe=function(o){ const k=o.applicationServerKey; const buf=k instanceof ArrayBuffer?k:k.buffer.slice(k.byteOffset,k.byteOffset+k.byteLength);
    P.subscribes.push({userVisibleOnly:o.userVisibleOnly, key:b64(buf)}); P.sub=mk(buf); return Promise.resolve(P.sub); };
}
async function device(browser, o){
  const vp = o.desk ? {viewport:{width:1280,height:800}, deviceScaleFactor:1} : {viewport:{width:390,height:844}, deviceScaleFactor:2, isMobile:true, hasTouch:true};
  if(o.ios) vp.userAgent=IOS_UA; if(o.dark) vp.colorScheme='dark';
  const ctx = await browser.newContext(vp); if(o.notify) await ctx.grantPermissions(['notifications'], {origin:'http://localhost:'+PORT});
  const page = await ctx.newPage();
  page.on('pageerror', e=>errors.push(o.tag+' pageerror: '+e.message)); page.on('console', m=>{ if(m.type()==='error') errors.push(o.tag+' console: '+m.text()); });
  if(o.fake){ await page.exposeBinding('fakeServer', (src, op, a)=>fake.handle(src.page, op, a)); await page.addInitScript(fakeAdapter); await page.addInitScript(u=>{ window.__fakeUser=u; }, USER); }
  if(o.session) await page.addInitScript(u=>{ if(!localStorage.getItem('fake-session')) localStorage.setItem('fake-session', JSON.stringify({id:u.uid, email:u.email})); }, USER);
  if(o.push!==false) await page.addInitScript(pushStub, Object.assign({endpoint:'http://127.0.0.1:'+PUSH_PORT+'/push/'+(o.tag||'x'), p256dh:'', auth:''}, o.push||{}));
  await page.addInitScript(s=>{ if(!localStorage.getItem('tareas-v1')) localStorage.setItem('tareas-v1', s); }, JSON.stringify(o.seed||{spaces:[{id:'trabajo',name:'Trabajo',order:0},{id:'personal',name:'Personal',order:1}], projects:[], tasks:[], voiceNotes:[], settings:{tipsSeen:true}}));
  await page.goto(URL0+(o.query||'')); await page.waitForTimeout(o.wait||600); return {ctx, page};
}
const until = async (page, fn, arg, ms=8000)=>{ const t0=Date.now(); for(;;){ let v=false; try{ v=await page.evaluate(fn, arg); }catch(e){} if(v) return true; if(Date.now()-t0>ms) return false; await page.waitForTimeout(100); } };
const synced = page => until(page, ()=>SY&&SY.user&&!SY.running&&SY.status==='ok'&&syncCollect(true).count===0);
const tk = (page, id) => page.evaluate(id=>{ const x=task(id); return x?{date:x.date, reminder:x.reminder, sent:x.reminderSent||null, carried:x.carried, status:x.status}:null; }, id);
const undo = async page => { await page.click('#toastBtn'); await page.waitForTimeout(300); };
const pushSection = page => page.evaluate(()=>{ const g=[...document.querySelectorAll('.group-title')].filter(x=>x.textContent==='Notificaciones'||x.textContent==='Dispositivos con notificaciones').map(t=>{ const grp=t.nextElementSibling, foot=grp&&grp.nextElementSibling;
  return {title:t.textContent, cells:[...grp.querySelectorAll('.cell')].map(c=>c.textContent.trim()), foot:foot&&foot.classList.contains('footnote')?foot.textContent:''}; }); return g; });
const toastText = page => page.evaluate(()=>document.querySelector('#toast').classList.contains('on')?document.querySelector('#toastText').textContent:'');
const sheetH2 = page => page.evaluate(()=>{ const s=document.querySelector('#sheet'); return s.classList.contains('on')&&s.querySelector('h2')?s.querySelector('h2').textContent:''; });
const C='2026-10-30T10:00:00.000Z';
const T=(id, o)=>Object.assign({id, title:'Tarea '+id, spaceId:'trabajo', projectId:null, date:today, reminder:null, priority:'none', status:'pending', notes:'', carried:false, created:C, modified:C, completed:null}, o);
const SP=[{id:'trabajo',name:'Trabajo',order:0,created:C},{id:'personal',name:'Personal',order:1,created:C}];

/* ======================= 3. Decision 25 ======================= */
async function decisionTests(browser){
  const seed={spaces:SP, projects:[], voiceNotes:[], settings:{tipsSeen:true, summaryDay:yest}, tasks:[
    T('r1',{date:yest, reminder:at(yest,'00:00:30')}), T('r2',{date:yest, reminder:at(yest,'23:59:30')}), T('r3',{date:yest, reminder:at(past2,'08:00:00')}),
    T('r4',{date:null, reminder:at(tomorrow,'10:00:00')}),
    T('m1',{reminder:at(today,'09:15:00')}), T('m2',{reminder:at(today,'10:00:00')}), T('m3',{reminder:at(today,'11:00:00')}), T('m4',{}),
    T('d1',{date:yest, reminder:at(yest,'08:00:00'), status:'done', completed:at(yest,'12:00:00')}),
    T('f1',{reminder:at(today,'23:59:00')})]};
  const {ctx, page} = await device(browser, {tag:'D', seed, push:false});
  const nowMs=Date.now();
  // rollOver at start: the reminder goes with the date; a time already past is kept and marked as sent; one on another day stays
  const r1=await tk(page,'r1'), r2=await tk(page,'r2'), r3=await tk(page,'r3'), r4=await tk(page,'r4');
  const r1past=Date.parse(at(today,'00:00:30'))<=nowMs, r2past=Date.parse(at(today,'23:59:30'))<=nowMs;
  check('A_rollover_moves', r1.date===today && r1.carried && sameTs(r1.reminder, at(today,'00:00:30')) && r2.date===today && sameTs(r2.reminder, at(today,'23:59:30')), {r1, r2});
  check('A_rollover_past_marked', (!!r1.sent)===r1past && (!!r2.sent)===r2past, {r1, r2, r1past, r2past});
  check('A_rollover_other_day', r3.date===today && sameTs(r3.reminder, at(past2,'08:00:00')) && r4.date===null && sameTs(r4.reminder, at(tomorrow,'10:00:00')), {r3, r4});
  check('A_rollover_keeps_modified', await page.evaluate(()=>['r1','r2','r3'].every(id=>task(id).modified==='2026-10-30T10:00:00.000Z')));
  // Aplazar from the row's menu (postponeMenu): Mañana, then Deshacer
  await page.evaluate(()=>postponeSheet('m1')); await page.waitForTimeout(650);
  await page.locator('#pmenu .pm-it', {hasText:'Mañana'}).first().click(); await page.waitForTimeout(500);
  let m1=await tk(page,'m1'); const t1=await toastText(page);
  check('A_postpone', m1.date===tomorrow && sameTs(m1.reminder, at(tomorrow,'09:15:00')) && m1.sent===null && /Aplazada a mañana/.test(t1), {m1, t1});
  await undo(page); m1=await tk(page,'m1');
  check('A_postpone_undo', m1.date===today && sameTs(m1.reminder, at(today,'09:15:00')) && (!!m1.sent)===(Date.parse(at(today,'09:15:00'))<=Date.now()), m1);
  // Selection and Aplazar (bulkPostponeSheet, bulkReschedule)
  await page.evaluate(()=>{ startSelect('m2'); UI.select.ids.add('m3'); updateSelectUI(); }); await page.waitForTimeout(300);
  await page.evaluate(()=>bulkPostponeSheet(document.querySelector('[data-act=bulkPostpone]'))); await page.waitForTimeout(650);
  await page.locator('#pmenu .pm-it', {hasText:'Próxima semana'}).first().click(); await page.waitForTimeout(500);
  const nw=await page.evaluate(()=>nextWeekday(1,true)); let m2=await tk(page,'m2'), m3=await tk(page,'m3');
  check('A_bulk', m2.date===nw && sameTs(m2.reminder, at(nw,'10:00:00')) && m3.date===nw && sameTs(m3.reminder, at(nw,'11:00:00')), {m2, m3, nw});
  await undo(page); m2=await tk(page,'m2'); m3=await tk(page,'m3');
  check('A_bulk_undo', m2.date===today && sameTs(m2.reminder, at(today,'10:00:00')) && m3.date===today && sameTs(m3.reminder, at(today,'11:00:00')), {m2, m3});
  // Cerrar el día, Todo a mañana (rescheduleMany), then Deshacer
  await page.evaluate(()=>closeDaySheet()); await page.waitForTimeout(650);
  await page.click('#sheet [data-cd=all]'); await page.waitForTimeout(500);
  const all=await page.evaluate(()=>['r1','r2','m1','m2','f1'].map(id=>({id, date:task(id).date, rem:task(id).reminder, sent:task(id).reminderSent||null})));
  const exp={r1:'00:00:30', r2:'23:59:30', m1:'09:15:00', m2:'10:00:00', f1:'23:59:00'};
  check('A_closeday', all.every(o=>o.date===tomorrow && sameTs(o.rem, at(tomorrow, exp[o.id])) && o.sent===null), all);
  await undo(page);
  const allBack=await page.evaluate(()=>['r1','r2','m1','m2','f1'].map(id=>({id, date:task(id).date, rem:task(id).reminder, sent:task(id).reminderSent||null, carried:task(id).carried})));
  check('A_closeday_undo', allBack.every(o=>o.date===today && sameTs(o.rem, at(today, exp[o.id])) && (!!o.sent)===(Date.parse(at(today, exp[o.id]))<=Date.now())) && allBack.find(o=>o.id==='r1').carried, allBack);
  // The review of the carried tasks (reviewStep): Viernes for the first, Terminar, Deshacer in the balance
  await page.evaluate(()=>reviewStart('carried')); await page.waitForTimeout(650);
  const first=await page.evaluate(()=>document.querySelector('#sheet .plan-title').textContent.replace('Tarea ',''));
  await page.click('#sheet [data-rv=man]'); await page.waitForTimeout(650);
  const rvd=await tk(page, first); const expRem=first==='r3'?at(past2,'08:00:00'):at(tomorrow, exp[first]); // r3's reminder is on another day: it stays
  check('A_review', rvd.date===tomorrow && rvd.carried===false && sameTs(rvd.reminder, expRem), {first, rvd});
  await page.click('#sheet [data-x=end]'); await page.waitForTimeout(650); await page.click('#sheet [data-x=undo]'); await page.waitForTimeout(500);
  const rvb=await tk(page, first); check('A_review_undo', rvb.date===today && rvb.carried===true && (first==='r3'?sameTs(rvb.reminder, at(past2,'08:00:00')):sameTs(rvb.reminder, at(today, exp[first]))), {first, rvb});
  // Planning (planStep): an undated task's reminder is not on any old day, so it stays where it is
  await page.evaluate(()=>{ UI.projFilter=null; planStart(); }); await page.waitForTimeout(650);
  await page.locator('#sheet .chip', {hasText:'Mañana'}).first().click(); await page.waitForTimeout(500);
  const r4b=await tk(page,'r4'); check('A_plan', r4b.date===tomorrow && sameTs(r4b.reminder, at(tomorrow,'10:00:00')), r4b);
  await page.evaluate(()=>closeSheet()); await page.waitForTimeout(500);
  // Reopening a task done yesterday brings it to today (as rollOver), with its reminder
  await page.evaluate(()=>completeTask('d1', true)); const d1=await tk(page,'d1');
  check('A_reopen', d1.status==='pending' && d1.date===today && d1.carried && sameTs(d1.reminder, at(today,'08:00:00')) && (!!d1.sent)===(Date.parse(at(today,'08:00:00'))<=Date.now()), d1);
  // Decision 27a (changed on purpose, rm-Q covers it in full): the manual Fecha now takes a reminder on the old day along, as decision 25.
  // Recordatorio sets a new reminder that will notify (reminderSent cleared)
  await page.evaluate(()=>openDetail('f1')); await page.waitForTimeout(700);
  await page.click('.screen.detail [data-act=pickDate]'); await page.waitForTimeout(650);
  await page.locator('#sheet .chip', {hasText:'Mañana'}).first().click(); await page.waitForTimeout(600);
  const f1=await tk(page,'f1'); check('A_manual_fecha_moves_reminder', f1.date===tomorrow && sameTs(f1.reminder, at(tomorrow,'23:59:00')), f1);
  await page.evaluate(()=>{ task('f1').reminderSent='2026-11-01T00:00:00.000Z'; save(); });
  await page.click('.screen.detail [data-act=pickReminder]'); await page.waitForTimeout(650);
  await page.locator('#sheet .chip', {hasText:'Mañana a las 9:00'}).click(); await page.waitForTimeout(400);
  const f1b=await tk(page,'f1'); check('A_manual_reminder_resets_sent', f1b.sent===null && new Date(f1b.reminder).getHours()===9, f1b);
  // Local only (no config): no notification sheet after the first reminder, and no line under Recordatorio
  await page.waitForTimeout(500); check('A_noSync_no_offer', (await sheetH2(page))==='' && await page.evaluate(()=>!document.querySelector('.screen.detail .push-note')));
  await page.screenshot({path:path.join(OUT,'p-detail-local.png')});
  await ctx.close();

  // Desktop: H M V S (deskShortcut, setTaskDate), the Fecha menu (dateMenu), calendar drops (dropTask, dropMany), each with Deshacer
  const seedD={spaces:SP, projects:[], voiceNotes:[], settings:{tipsSeen:true}, tasks:[T('w1',{reminder:at(today,'16:30:00')}), T('w2',{reminder:at(today,'17:00:00')}), T('w3',{reminder:at(today,'18:00:00')}), T('w4',{reminder:at(tomorrow,'07:00:00')})]};
  const D=await device(browser, {tag:'DD', seed:seedD, desk:true, push:false}); const dp=D.page;
  await dp.evaluate(()=>openDetail('w1')); await dp.waitForTimeout(400);
  await dp.evaluate(()=>{ document.activeElement&&document.activeElement.blur&&document.activeElement.blur(); deskShortcut('m'); }); await dp.waitForTimeout(500);
  let w1=await tk(dp,'w1'); check('A_desk_key_M', w1.date===tomorrow && sameTs(w1.reminder, at(tomorrow,'16:30:00')), w1);
  await undo(dp); w1=await tk(dp,'w1'); check('A_desk_key_M_undo', w1.date===today && sameTs(w1.reminder, at(today,'16:30:00')), w1);
  const vie2=await dp.evaluate(()=>{ const m=dateMenu('w1'), g=m.groups[0]; const it=g.find(i=>i.label==='Viernes')||g.find(i=>i.label==='Próxima semana'); const d=it.label==='Viernes'?nextWeekday(5,true):nextWeekday(1,true); it.fn(); return d; }); await dp.waitForTimeout(400);
  w1=await tk(dp,'w1'); check('A_desk_menu_viernes', w1.date===vie2 && sameTs(w1.reminder, at(vie2,'16:30:00')), {w1, vie2});
  await undo(dp); w1=await tk(dp,'w1'); check('A_desk_menu_undo', w1.date===today && sameTs(w1.reminder, at(today,'16:30:00')), w1);
  const d3=addD(today,3);
  await dp.evaluate(d=>dropTask('w2', {dataset:{day:d}}), d3); await dp.waitForTimeout(400);
  let w2=await tk(dp,'w2'); check('A_drop_day', w2.date===d3 && sameTs(w2.reminder, at(d3,'17:00:00')), w2);
  await undo(dp); w2=await tk(dp,'w2'); check('A_drop_day_undo', w2.date===today && sameTs(w2.reminder, at(today,'17:00:00')), w2);
  await dp.evaluate(d=>dropMany(['w2','w3','w4'], {dataset:{day:d}}), d3); await dp.waitForTimeout(400);
  const many=await dp.evaluate(()=>['w2','w3','w4'].map(id=>({id, date:task(id).date, rem:task(id).reminder})));
  check('A_drop_many', many[0].date===d3 && sameTs(many[0].rem, at(d3,'17:00:00')) && sameTs(many[1].rem, at(d3,'18:00:00')) && many[2].date===d3 && sameTs(many[2].rem, at(tomorrow,'07:00:00')), many); // w4's reminder was not on its day
  await undo(dp); const manyB=await dp.evaluate(()=>['w2','w3','w4'].map(id=>({date:task(id).date, rem:task(id).reminder})));
  check('A_drop_many_undo', manyB.every(o=>o.date===today) && sameTs(manyB[1].rem, at(today,'18:00:00')), manyB);
  // Unchanged rules: "Todo el día" drops a time on the task's day; a half hour sets that time
  await dp.evaluate(d=>dropTask('w3', {dataset:{allday:'1', day:d}}), d3); await dp.waitForTimeout(300);
  const w3=await tk(dp,'w3'); check('A_drop_allday', w3.date===d3 && w3.reminder===null, w3); await undo(dp);
  await dp.evaluate(d=>dropTask('w3', {dataset:{slot:d+'T14:30'}}), d3); await dp.waitForTimeout(300);
  const w3b=await tk(dp,'w3'); check('A_drop_slot', w3b.date===d3 && sameTs(w3b.reminder, at(d3,'14:30:00')) && w3b.sent===null, w3b);
  await D.ctx.close();
}

/* ======================= 4. Notifications in the app ======================= */
async function appTests(browser, st){
  fake = new Fake();
  // Rest over the fake's tables, so the function sees what the devices synced, and its writes reach them (realtime)
  const extra={push_keys:[]};
  REST = new Rest({ list:n=>extra[n]||(fake.t[n]?[...fake.t[n].values()]:null), insert:(n,x)=>{ if(extra[n]) extra[n].push(x); else fake.t[n].set(x.id,x); }, remove:(n,x)=>{ if(extra[n]) extra[n]=extra[n].filter(y=>y!==x); else fake.t[n].delete(x.id); }, touch:(n,x)=>fake.touch(n,x) });
  PUSHES.length=0; GONE.clear();

  // States in Ajustes: not installed (iPhone in Safari), unsupported, no config, signed out
  { const {ctx, page}=await device(browser, {tag:'S1', ios:true}); await page.click('[data-tab=ajustes]'); await page.waitForTimeout(300);
    const s=await pushSection(page); check('N_notInstalled', s.length===1 && s[0].cells[0]==='NotificacionesSin instalar' && /instalada en la pantalla de inicio/.test(s[0].foot), s);
    await page.screenshot({path:path.join(OUT,'p-settings-notinstalled.png')}); await ctx.close(); }
  { const {ctx, page}=await device(browser, {tag:'S2', push:{noPush:true}}); await page.click('[data-tab=ajustes]'); await page.waitForTimeout(300);
    const s=await pushSection(page); check('N_unsupported', s.length===1 && s[0].cells[0]==='NotificacionesNo disponibles' && /no puede recibir/.test(s[0].foot), s); await ctx.close(); }
  { const {ctx, page}=await device(browser, {tag:'S3', ios:true, push:{standalone:true}}); await page.click('[data-tab=ajustes]'); await page.waitForTimeout(300);
    const s=await pushSection(page); check('N_noSync', s.length===1 && s[0].cells[0]==='NotificacionesNo disponibles' && /cuenta/.test(s[0].foot), s); await ctx.close(); }
  const seedA={spaces:SP, projects:[{id:'pa',spaceId:'trabajo',name:'FLC',color:'#007AFF',order:0,archived:false,created:C,modified:C}], voiceNotes:[], settings:{tipsSeen:true}, tasks:[T('n1',{title:'Preparar comité', projectId:'pa'}), T('n2',{title:'Revisar SOW'})]};
  { const {ctx, page}=await device(browser, {tag:'S4', ios:true, fake:true, push:{standalone:true}, seed:seedA}); await page.click('[data-tab=ajustes]'); await page.waitForTimeout(300);
    const s=await pushSection(page); check('N_signedOut', s.length===1 && s[0].cells[0]==='NotificacionesSin cuenta' && /Inicia sesión/.test(s[0].foot), s);
    // The first reminder, signed out: one sheet that says why it will not notify
    await page.click('[data-tab=tareas]'); await page.waitForTimeout(300); await page.evaluate(()=>openDetail('n1')); await page.waitForTimeout(700);
    await page.click('.screen.detail [data-act=pickReminder]'); await page.waitForTimeout(650); await page.locator('#sheet .chip', {hasText:'Mañana a las 9:00'}).click(); await page.waitForTimeout(900);
    const txt=await page.evaluate(()=>document.querySelector('#sheet').textContent);
    check('N_offer_signedOut', (await sheetH2(page))==='Notificaciones' && /Inicia sesión en Ajustes/.test(txt) && !/Permitir/.test(txt), txt);
    await page.waitForTimeout(400); await page.click('#sheet [data-x=ok]'); await page.waitForTimeout(600);
    check('N_note_signedOut', /Inicia sesión en Ajustes para que el recordatorio avise/.test(await page.evaluate(()=>(document.querySelector('.screen.detail .push-note')||{}).textContent||'')));
    await ctx.close(); }
  // Safari tab on the iPhone: the first reminder explains that the app must be installed
  { const {ctx, page}=await device(browser, {tag:'S5', ios:true, fake:true, session:true, seed:seedA}); await page.evaluate(()=>openDetail('n1')); await page.waitForTimeout(700);
    await page.click('.screen.detail [data-act=pickReminder]'); await page.waitForTimeout(650); await page.locator('#sheet .chip', {hasText:'Mañana a las 9:00'}).click(); await page.waitForTimeout(900);
    const txt=await page.evaluate(()=>document.querySelector('#sheet').textContent);
    check('N_offer_notInstalled', /instalada en la pantalla de inicio/.test(txt) && !/Permitir/.test(txt), txt); await ctx.close(); }

  // The installed iPhone app, signed in: the explanation sheet, the permission inside the tap, the subscription stored for the account
  const devA=newDevice();
  const A=await device(browser, {tag:'A', ios:true, fake:true, notify:true, push:{standalone:true, p256dh:devA.p256dh, auth:devA.authB64}, seed:seedA});
  const ap=A.page; await ap.click('[data-tab=ajustes]'); await ap.waitForTimeout(300); await ap.click('[data-act=signIn]'); check('N_A_synced', await synced(ap));
  let s=await pushSection(ap); check('N_off', s[0] && s[0].cells.join('|')==='PermisoSin pedir|Activar notificaciones' && /aunque la app esté cerrada/.test(s[0].foot), s);
  await ap.screenshot({path:path.join(OUT,'p-settings-off.png')});
  await ap.click('[data-tab=tareas]'); await ap.waitForTimeout(300); await ap.evaluate(()=>openDetail('n1')); await ap.waitForTimeout(700);
  await ap.click('.screen.detail [data-act=pickReminder]'); await ap.waitForTimeout(650); await ap.locator('#sheet .chip', {hasText:'Mañana a las 9:00'}).click(); await ap.waitForTimeout(900);
  const offer=await ap.evaluate(()=>document.querySelector('#sheet').textContent);
  check('N_offer_sheet', (await sheetH2(ap))==='Notificaciones' && /necesita permiso para enviar notificaciones a este iPhone/.test(offer) && /Permitir/.test(offer) && /Ahora no/.test(offer), offer);
  await ap.screenshot({path:path.join(OUT,'p-offer-sheet.png')});
  await ap.waitForTimeout(300); await ap.tap('#sheet [data-x=yes]');
  check('N_subscribed', await until(ap, ()=>PS.sub&&PS.savedFor===SY.user.id), await ap.evaluate(()=>({ps:PS, push:window.__push})));
  const P1=await ap.evaluate(()=>window.__push); const keyNow=(await fnCall('GET','?publicKey')).json.publicKey;
  check('N_permission_in_tap', P1.requests.length===1 && P1.requests[0]==='click', P1.requests);
  check('N_subscribe_options', P1.subscribes.length===1 && P1.subscribes[0].userVisibleOnly===true && P1.subscribes[0].key===keyNow, {sub:P1.subscribes, keyNow});
  const rowA=[...fake.t.push_subscriptions.values()][0];
  check('N_saved_on_server', fake.t.push_subscriptions.size===1 && rowA.owner_id===USER.uid && rowA.endpoint==='http://127.0.0.1:'+PUSH_PORT+'/push/A' && rowA.p256dh===devA.p256dh && rowA.auth===devA.authB64 && rowA.device==='iPhone', rowA);
  check('N_toast_on', /Notificaciones activadas/.test(await toastText(ap)));
  // Asked once: the next reminder shows no sheet
  await ap.click('.screen.detail [data-act=pickReminder]'); await ap.waitForTimeout(650); await ap.locator('#sheet .chip', {hasText:'En una hora'}).click(); await ap.waitForTimeout(900);
  check('N_offer_once', (await sheetH2(ap))==='' && await ap.evaluate(()=>!document.querySelector('.screen.detail .push-note')));
  const logA=await ap.evaluate(()=>LOG.map(e=>e.m));
  check('N_logged', ['Permiso de notificaciones: granted','Suscripción a notificaciones creada','Suscripción guardada en la cuenta'].every(m=>logA.includes(m)), logA.slice(-10));
  // Ajustes when on: this device, the test button, the list with another device of the account
  fake.t.push_subscriptions.set('other', {id:'other', owner_id:USER.uid, endpoint:'http://127.0.0.1:'+PUSH_PORT+'/push/mac', p256dh:newDevice().p256dh, auth:b64u(crypto.randomBytes(16)), device:'Mac con Chrome', created:at(yest,'10:00:00'), modified:at(yest,'10:00:00'), deleted:null});
  await ap.evaluate(()=>pop()); await ap.waitForTimeout(600); await ap.click('[data-tab=ajustes]'); await ap.evaluate(()=>pushDevices(true)); await ap.waitForTimeout(500);
  s=await pushSection(ap);
  check('N_on', s[0] && s[0].cells.join('|')==='PermisoConcedido|Este dispositivoiPhone|Probar notificación' && s[1] && s[1].cells.length===2 && s[1].cells.some(c=>c==='Mac con ChromeDesde ayerRevocar') && s[1].cells.some(c=>c==='iPhoneEsteRevocar'), s);
  await ap.screenshot({path:path.join(OUT,'p-settings-on.png')});
  // Probar notificación: through the real function to this device only; decrypted with its keys
  const n0=PUSHES.length; await ap.click('[data-act=pushTest]'); await until(ap, ()=>!PS.testing);
  const tp=PUSHES.slice(n0); let tpay=null; try{ tpay=decrypt(tp[0].body, devA); }catch(e){}
  check('N_test', tp.length===1 && tp[0].url==='/push/A' && tpay && tpay.body==='Notificación de prueba' && /Notificación de prueba enviada/.test(await toastText(ap)), {urls:tp.map(p=>p.url), tpay});
  // Revocar another device (soft delete), then this one (it stops here too)
  await ap.click('[data-push-revoke=other]'); await ap.waitForTimeout(600); await ap.click('#asheet .it[data-i="0"]'); await ap.waitForTimeout(500);
  check('N_revoke_other', !!fake.t.push_subscriptions.get('other').deleted && (await pushSection(ap))[1].cells.length===1, (await pushSection(ap)));
  // Offline: Activar after a revoke stores the subscription when the connection comes back
  await ap.evaluate(()=>{ const id=PS.id; return id; }).then(id=>ap.click('[data-push-revoke="'+id+'"]')); await ap.waitForTimeout(600); await ap.click('#asheet .it[data-i="0"]'); await ap.waitForTimeout(500);
  const rv=await ap.evaluate(()=>({st:pushStatus(), sub:PS.sub, unsubs:window.__push.unsubs}));
  check('N_revoke_self', rv.st==='off' && rv.sub===null && rv.unsubs===1 && !!fake.t.push_subscriptions.get(rowA.id).deleted, rv);
  fake.down.add(ap); await ap.click('[data-act=pushEnable]');
  await until(ap, ()=>!!PS.sub && !PS.busy); s=await pushSection(ap);
  check('N_pending_offline', s[0] && /Probar notificación/.test(s[0].cells.join('|')) && /se añadirá a tu cuenta al sincronizar/.test(s[0].foot) && await ap.evaluate(()=>document.querySelector('[data-act=pushTest]').disabled) && !!fake.t.push_subscriptions.get(rowA.id).deleted, s);
  fake.down.delete(ap); await ap.evaluate(()=>syncRun('prueba'));
  check('N_flush_after_sync', await until(ap, ()=>PS.savedFor===SY.user.id) && !fake.t.push_subscriptions.get(rowA.id).deleted, fake.t.push_subscriptions.get(rowA.id));
  // Removed on the server (its push service said 410): the device notices when it reads the list
  fake.t.push_subscriptions.delete(rowA.id); await ap.evaluate(()=>pushDevices(true)); await ap.waitForTimeout(400);
  check('N_gone_detected', await ap.evaluate(()=>pushStatus()==='off' && !PS.sub));
  await ap.click('[data-act=pushEnable]'); check('N_reenabled', await until(ap, ()=>PS.savedFor===SY.user.id) && fake.t.push_subscriptions.has(rowA.id));
  // At start, a subscription the browser dropped is made again (pushCheck); one it cannot make leaves Activar in Ajustes
  const nsub=await ap.evaluate(()=>window.__push.subscribes.length); await ap.evaluate(()=>{ window.__push.sub=null; pushCheck(); });
  check('N_check_resubscribes', await until(ap, n=>window.__push.subscribes.length===n+1 && !!window.__push.sub && pushStatus()==='on', nsub));
  await ap.evaluate(()=>{ window.__push.sub=null; window.__keep=PushManager.prototype.subscribe; PushManager.prototype.subscribe=()=>Promise.reject(new Error('AbortError')); pushCheck(); });
  check('N_check_fails_to_off', await until(ap, ()=>pushStatus()==='off' && !PS.sub));
  await ap.evaluate(()=>{ PushManager.prototype.subscribe=window.__keep; }); await ap.click('[data-act=pushEnable]'); await until(ap, ()=>PS.savedFor===SY.user.id);
  // Probar notificación when the push service no longer knows this device: the function deletes it and the app says so
  GONE.add('/push/A'); await ap.click('[data-act=pushTest]'); await until(ap, ()=>!PS.testing);
  check('N_test_gone', /ya no está en la cuenta/.test(await toastText(ap)) && await until(ap, ()=>pushStatus()==='off'), await toastText(ap));
  GONE.clear(); await ap.click('[data-act=pushEnable]'); await until(ap, ()=>PS.savedFor===SY.user.id);

  // reminder_sent through the sync: a reminder set on this device notifies from the function, the device learns it was sent, no loop
  fake.upserts.length=0;
  await ap.evaluate(()=>{ updTask('n2', {reminder:new Date(Date.now()+60e3).toISOString()}); }); check('N_sync_up', await synced(ap));
  const upN2=fake.upserts.filter(u=>u.id==='n2'); const n1up=fake.upserts.filter(u=>u.id==='n1');
  check('N_row_without_sent', upN2.length>=1 && !('reminder_sent' in upN2[upN2.length-1]) && fake.t.tasks.get('n2').reminder_sent===null, upN2);
  // time passes on the server: the reminder is due; the cron call sends it to this device
  const sv=fake.t.tasks.get('n2'); sv.reminder=new Date(Date.now()-20e3).toISOString(); const nP=PUSHES.length;
  const cron=await fnCall('POST','',{});
  const got=PUSHES.slice(nP); let pay=null; try{ pay=decrypt(got[0].body, devA); }catch(e){}
  check('N_e2e_function', cron.json && cron.json.sent===1 && got.length===1 && pay && pay.title==='Revisar SOW' && pay.body==='Recordatorio' && pay.data.taskId==='n2', {cron:cron.json, pay});
  check('N_sent_pulled', await until(ap, ()=>!!task('n2').reminderSent) && await synced(ap) && fake.t.tasks.get('n2').reminder_sent, await tk(ap,'n2'));
  // An edit of another field from a device that has the mark keeps it; postponing clears it on the server (the reminder will notify again)
  await ap.evaluate(()=>updTask('n2',{title:'Revisar SOW firmado'})); await synced(ap);
  const keptSent=fake.t.tasks.get('n2').reminder_sent;
  await ap.evaluate(()=>{ rescheduleTask('n2', addDays(todayStr(),1), 'mañana'); }); await synced(ap);
  const moved=fake.t.tasks.get('n2'), local=await tk(ap,'n2');
  check('N_sent_rules_via_sync', !!keptSent && moved.reminder_sent===null && local.sent===null && Date.parse(moved.reminder)>Date.now(), {keptSent, moved:{r:moved.reminder, s:moved.reminder_sent}, local});
  // A reminder moved by rollOver to a time already past goes up marked, so the function never sends it
  await ap.evaluate(()=>{ const x=task('n1'); x.date=addDays(todayStr(),-1); x.reminder=new Date(new Date(x.date+'T00:00:00').getTime()+20e3).toISOString(); x.reminderSent=null; save(); DB.settings.summaryDay=''; checkDay(); });
  await synced(ap); const n1s=fake.t.tasks.get('n1');
  const before=PUSHES.length; const cron2=await fnCall('POST','',{});
  check('N_rollover_past_not_sent', n1s.date===today && !!n1s.reminder_sent && cron2.json.due===0 && PUSHES.length===before, {n1:{d:n1s.date, r:n1s.reminder, s:n1s.reminder_sent}, cron2:cron2.json});

  // The push reaches the service worker: the notification, the badge, the page log; a tap opens the task
  const cdp=await A.ctx.newCDPSession(ap); let regId=null; cdp.on('ServiceWorker.workerRegistrationUpdated', e=>e.registrations.forEach(x=>{ if(!x.isDeleted) regId=x.registrationId; }));
  await cdp.send('ServiceWorker.enable'); await until(ap, ()=>navigator.serviceWorker.controller!==null, null, 4000); await ap.waitForTimeout(300);
  const sw=A.ctx.serviceWorkers()[0];
  await sw.evaluate(()=>{ self.__badge=[]; Object.defineProperty(self.navigator,'setAppBadge',{value:n=>{ self.__badge.push(n); return Promise.resolve(); }, configurable:true}); Object.defineProperty(self.navigator,'clearAppBadge',{value:()=>{ self.__badge.push(0); return Promise.resolve(); }, configurable:true}); });
  await ap.evaluate(()=>{ pop&&UI.stack.length&&pop(); UI.tab='tareas'; render(); }); await ap.waitForTimeout(400);
  await cdp.send('ServiceWorker.deliverPushMessage', {origin:URL0, registrationId:String(regId), data:JSON.stringify(pay)}); await ap.waitForTimeout(700);
  const shown=await sw.evaluate(async()=>({n:(await self.registration.getNotifications()).map(x=>({title:x.title, body:x.body, tag:x.tag, data:x.data, icon:x.icon, badge:x.badge})), badge:self.__badge}));
  const nn=shown.n.find(x=>x.tag==='n2');
  check('SW_push_shows', nn && nn.title==='Revisar SOW' && nn.body==='Recordatorio' && nn.data.taskId==='n2' && /icons\/icon-192\.png$/.test(nn.icon) && /icons\/icon-192\.png$/.test(nn.badge), shown);
  check('SW_badge', shown.badge.length===1 && shown.badge[0]===pay.badge && typeof pay.badge==='number', {badge:shown.badge, pay:pay.badge});
  check('SW_page_logged', await until(ap, ()=>LOG.some(e=>e.m==='Notificación recibida')));
  await sw.evaluate(async()=>{ const n=(await self.registration.getNotifications({tag:'n2'}))[0]; self.dispatchEvent(new NotificationEvent('notificationclick', {notification:n})); }).catch(()=>{});
  check('SW_click_opens', await until(ap, ()=>detailTaskId()==='n2'), await ap.evaluate(()=>({d:detailTaskId(), log:LOG.slice(-3).map(e=>e.m)})));
  check('SW_click_closes', (await sw.evaluate(async()=>(await self.registration.getNotifications({tag:'n2'})).length))===0);
  await ap.waitForTimeout(600); await ap.screenshot({path:path.join(OUT,'p-opened-from-push.png')});
  // A text push (not JSON) still shows
  await cdp.send('ServiceWorker.deliverPushMessage', {origin:URL0, registrationId:String(regId), data:'Hola'}); await ap.waitForTimeout(600);
  const txtN=await sw.evaluate(async()=>(await self.registration.getNotifications()).map(x=>x.title+'|'+x.body)); check('SW_text_push', txtN.includes('Tareas|Hola'), txtN);
  // Denied: Ajustes and the line under Recordatorio say it will not notify here
  await ap.evaluate(()=>{ window.__push.perm='denied'; pop(); }); await ap.waitForTimeout(600); await ap.click('[data-tab=ajustes]'); await ap.waitForTimeout(300);
  s=await pushSection(ap); check('N_denied', s[0] && s[0].cells[0]==='PermisoDenegado' && /Ajustes del iPhone/.test(s[0].foot), s);
  await ap.screenshot({path:path.join(OUT,'p-settings-denied.png')});
  await ap.click('[data-tab=tareas]'); await ap.evaluate(()=>openDetail('n2')); await ap.waitForTimeout(700);
  check('N_note_denied', (await ap.evaluate(()=>(document.querySelector('.screen.detail .push-note')||{}).textContent||''))==='Sin permiso de notificaciones: el recordatorio no avisará en este iPhone.');
  await ap.screenshot({path:path.join(OUT,'p-detail-denied.png')});
  // Sign out: this device leaves the account
  await ap.evaluate(()=>{ window.__push.perm='granted'; pop(); }); await ap.waitForTimeout(600); await ap.click('[data-tab=ajustes]'); await ap.waitForTimeout(300);
  await ap.click('[data-act=signOut]'); await ap.waitForTimeout(600); await ap.click('#asheet .it[data-i="0"]'); await ap.waitForTimeout(700);
  check('N_signout_revokes', await ap.evaluate(()=>pushStatus()==='signedOut' && !PS.sub) && !!fake.t.push_subscriptions.get(rowA.id).deleted);
  await A.ctx.close();

  // Denied in the permission prompt itself
  { const {ctx, page}=await device(browser, {tag:'S6', ios:true, fake:true, session:true, push:{standalone:true, answer:'denied'}, seed:seedA, dark:true}); await synced(page);
    await page.evaluate(()=>openDetail('n1')); await page.waitForTimeout(700);
    await page.click('.screen.detail [data-act=pickReminder]'); await page.waitForTimeout(650); await page.locator('#sheet .chip', {hasText:'Mañana a las 9:00'}).click(); await page.waitForTimeout(1000);
    await page.tap('#sheet [data-x=yes]'); await page.waitForTimeout(500);
    check('N_prompt_denied', /Sin permiso de notificaciones/.test(await toastText(page)) && await page.evaluate(()=>pushStatus()==='denied' && !PS.sub && window.__push.subscribes.length===0) && /no avisará en este iPhone/.test(await page.evaluate(()=>(document.querySelector('.screen.detail .push-note')||{}).textContent||'')));
    await page.waitForTimeout(500); await page.screenshot({path:path.join(OUT,'p-dark-detail-denied.png')});
    await page.evaluate(()=>pop()); await page.waitForTimeout(600); await page.click('[data-tab=ajustes]'); await page.waitForTimeout(400); await page.screenshot({path:path.join(OUT,'p-dark-settings-denied.png')});
    await ctx.close(); }

  // Desktop: Ajustes in the Mac layout, dark
  { const {ctx, page}=await device(browser, {tag:'S7', desk:true, fake:true, session:true, notify:true, dark:true, push:{p256dh:devA.p256dh, auth:devA.authB64}, seed:seedA}); await synced(page);
    await page.evaluate(()=>setDeskView('settings')); await page.waitForTimeout(300); let sd=await pushSection(page);
    check('N_desk_off', sd[0] && sd[0].cells.join('|')==='PermisoSin pedir|Activar notificaciones', sd);
    await page.click('[data-act=pushEnable]'); await until(page, ()=>PS.savedFor===SY.user.id); await page.evaluate(()=>pushDevices(true)); await page.waitForTimeout(500);
    sd=await pushSection(page); check('N_desk_on', sd[0] && /Este dispositivoLinux con Chrome|Este dispositivo/.test(sd[0].cells[1]) && sd[1] && sd[1].cells.length>=1, sd);
    await page.screenshot({path:path.join(OUT,'p-desk-settings-dark.png')});
    // The inspector says when it will not notify
    await page.evaluate(()=>{ window.__push.perm='denied'; updTask('n1',{reminder:new Date(Date.now()+36e5).toISOString()}); setDeskView('hoy'); openDetail('n1'); }); await page.waitForTimeout(500);
    check('N_desk_note', /no avisará en este dispositivo/.test(await page.evaluate(()=>(document.querySelector('.ifoot .push-note')||{}).textContent||'')));
    await ctx.close(); }

  // A tap on a notification while the app was closed: ?task=id opens the task (iPhone and desktop)
  { const {ctx, page}=await device(browser, {tag:'Q1', seed:seedA, query:'?task=n1', wait:1000});
    check('SW_query_iphone', await until(page, ()=>detailTaskId()==='n1' && location.search==='')); await ctx.close(); }
  { const {ctx, page}=await device(browser, {tag:'Q2', seed:seedA, desk:true, query:'?task=n2', wait:1000});
    check('SW_query_desk', await until(page, ()=>detailTaskId()==='n2' && !!document.querySelector('#desk .pane'))); await ctx.close(); }
  { const {ctx, page}=await device(browser, {tag:'Q3', seed:seedA, query:'?task=nada', wait:1000});
    check('SW_query_missing', /La tarea ya no existe/.test(await toastText(page)) && await page.evaluate(()=>detailTaskId()===null)); await ctx.close(); }
}

(async()=>{
  await new Promise(res=>srv.listen(PORT,res)); ece=require(path.join(DEPS, 'http_ece'));
  let servers=null, browser=null;
  try{
    try{ await sqlTests(); }catch(e){ check('sql_crash', false, e.stack); }
    servers=await startServers();
    try{ await fnTests(servers.st); }catch(e){ check('fn_crash', false, e.stack); }
    browser=await chromium.launch({channel:'chromium'});
    try{ await decisionTests(browser); }catch(e){ check('decision_crash', false, e.stack); }
    try{ await appTests(browser, servers.st); }catch(e){ check('app_crash', false, e.stack); }
  } finally { if(browser) await browser.close(); if(servers) servers.stop(); srv.close(); }
  const errs=errors.filter(e=>!/Failed to fetch|net::ERR_INTERNET_DISCONNECTED/.test(e));
  console.log(JSON.stringify({r, errors:fails.concat(errs)}, null, 1));
  process.exit(fails.length||errs.length?1:0);
})();
