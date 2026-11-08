require('./lib/out.js'); // outputs (screenshots, downloads) go to tests/out
// Decision 78: the follow-up of the tasks sent with «Avisar a…». Port 8830 (8830 to 8839: rm-NF, rm-PC). Screenshots in tests/out/NF.
//  1. SQL: supabase/migrations/0014_notice_follow.sql (no DROP, no DELETE, ends reloading the schema) run twice in PGlite after 0001 to 0013,
//     with rm-TM's stand-ins. The sender cannot start a notice planned, done, seen or followed; the recipient sets planned and done (done_seen
//     and followed come from the triggers; followed on the first write naming planned or done, even unchanged, and never again; taken alone
//     does not); the sender, a stranger and a server call made as someone else cannot; the other columns stay locked; done_pushed goes back
//     to empty on a new completion only when it is empty or older than 4 hours; a completion in the future is now. all.sql twice, check.sql.
//  2. The app, two people against the team's fake (tests/lib/team-fake.js): Enric (desktop, light; and his iPhone, light) sends two tasks to
//     Víctor (iPhone, light). Víctor adds one: its id is 'nt-', the notice's id and a random part. The first follow-up write marks it
//     followed: «la ha añadido, sin fecha prevista»; a date: «prevista para…»; completed: «la ha completado hoy» and «Hecha por Víctor» in
//     green (iPhone and desktop), gone once Enric completes his own; reopened: «prevista para…» again; completed again within 4 hours: not
//     told again; after 4 hours: told again; a stale device never takes a completion back. The second one added and deleted: «la ha
//     descartado» (remembered on the device), back with Deshacer. A notice taken but never followed reads «la ha añadido a sus tareas». An
//     older task is never touched; nothing is read while nothing changed; only open linked tasks or those changed in 90 days, with a UUID;
//     a task whose notice is not taken yet leaves the next pass free to read. Without 0014: nothing written, said once; the sender's lines
//     as in v0.36.2. A tap on the completion push opens Enric's task without the postpone bar, after reading the sent notices again.
//  send-reminders (the notification of a completion, once, late ones marked, before 0014 nothing) is tested under Deno in rm-TM.
const { chromium } = require('playwright');
const fs = require('fs'); const path = require('path');
const TF = require('./lib/team-fake.js'); const { until, synced, settled, sheetIn, signIn, activate, hideToast, tk, seed, today } = TF;
const { pgSetup, strip, MIGS } = require('./rm-TM.js');
const ROOT = path.resolve(__dirname, '..'), PORT = 8830, OUT = path.join(__dirname, 'out', 'NF'); fs.mkdirSync(OUT, {recursive:true});
const r={}, fails=[], errors=[]; const check=(name, ok, info)=>{ r[name]=ok?true:(info===undefined?false:info); if(!ok) fails.push(name); };
const shot=(page, name)=>page.screenshot({path:path.join(OUT, name+'.png')});
const addDays=(d,n)=>{ const x=new Date(d+'T12:00:00'); x.setDate(x.getDate()+n); return x.toISOString().slice(0,10); };

/* ======================= 1. SQL ======================= */
const E='00000000-0000-4000-8000-0000000000e1', V='00000000-0000-4000-8000-0000000000e5', X='00000000-0000-4000-8000-0000000000e3';
async function sqlTests(){
  const rd = f => fs.readFileSync(path.join(ROOT, 'supabase/migrations', f), 'utf8');
  const mig = rd('0014_notice_follow.sql');
  check('sql_no_drop_delete', !/drop|delete/i.test(mig), mig.match(/.*(drop|delete).*/gi));
  let db = await pgSetup();
  for(const f of MIGS) await db.exec(strip(rd(f)));
  await db.exec(`insert into auth.users (id, email, email_confirmed_at, created_at, raw_user_meta_data) values
    ('${E}', 'enric@example.com', now(), '2026-10-01', '{"full_name":"Enric Vidal"}'),
    ('${V}', 'victor@example.com', now(), '2026-11-05', '{"full_name":"Víctor Sanz"}'),
    ('${X}', 'extrana@example.com', now(), '2026-11-05 10:00', '{}')`);
  await db.exec(rd('0013_team.sql'));
  let err = null; try { await db.exec(mig); await db.exec(mig); } catch(e){ err = e.message; }
  check('sql_runs_twice', !err, err);
  const q = async (sql) => (await db.query(sql)).rows;
  const tryq = async (sql) => { try { return {rows: await q(sql)}; } catch(e){ return {error: e.message}; } };
  const as = async (uid, fn, role) => { await db.exec(`set test.uid = '${uid}'; set role ${role||'authenticated'};`); try { return await fn(); } finally { await db.exec(`reset role; reset test.uid;`); } };
  await as(E, () => q(`select public.tareas_team_invite('victor@example.com', 'Víctor') id`));
  await as(V, () => q(`select public.tareas_team_me() m`));
  // The sender cannot start a notice planned, done, seen or followed
  const n0 = await as(E, () => tryq(`insert into public.team_notices (recipient_id, task_ref, payload, planned, done, done_seen, done_pushed, followed) values ('${V}', 'e1', 't1:x', '2026-12-01', now(), now(), now(), now()) returning id, planned, done, done_seen, done_pushed, followed`));
  const nid = n0.rows && n0.rows[0].id;
  check('sql_insert_empty', n0.rows && ['planned','done','done_seen','done_pushed','followed'].every(c=>n0.rows[0][c]===null), n0);
  const row = async (id) => (await q(`select planned::text, done, done_seen, done_pushed, followed, taken, dismissed, payload, task_ref from public.team_notices where id = '${id||nid}'`))[0];
  // Taken alone does not make it followed
  await as(V, () => q(`update public.team_notices set taken = now() where id = '${nid}'`)); const takenOnly = await row();
  // The recipient sets planned and done: seen now, followed now
  const v1 = await as(V, () => tryq(`update public.team_notices set planned = '2026-11-20', done = now() - interval '3 hours' where id = '${nid}' returning planned::text, done, done_seen, done_pushed, followed`));
  check('sql_recipient_sets', takenOnly.followed===null && v1.rows && v1.rows.length===1 && v1.rows[0].planned==='2026-11-20' && !!v1.rows[0].done && v1.rows[0].done_pushed===null && !!v1.rows[0].followed
    && v1.rows[0].done_seen - v1.rows[0].done > 2.9*3600e3, {takenOnly, v1});
  // followed: the first update that names planned or done, even with the values it already had; it never moves afterwards
  const n2 = (await as(E, () => q(`insert into public.team_notices (recipient_id, task_ref, payload) values ('${V}', 'e2', 't1:x') returning id`)))[0].id;
  await as(V, () => q(`update public.team_notices set taken = now() where id = '${n2}'`));
  const same = await as(V, () => tryq(`update public.team_notices set planned = null where id = '${n2}' returning followed`)); const f2a = (await row(n2)).followed;
  await as(V, () => q(`update public.team_notices set planned = '2026-11-21' where id = '${n2}'`)); const f2b = (await row(n2)).followed;
  check('sql_followed_first_write', same.rows && !!same.rows[0].followed && f2a && f2b && f2a.getTime()===f2b.getTime(), {same, f2a, f2b});
  // The sender and a stranger cannot (the policy: no row), nor a server call made as the sender (the trigger)
  const e1 = await as(E, () => tryq(`update public.team_notices set planned = '2026-12-24', done = null where id = '${nid}' returning id`));
  const x1 = await as(X, () => tryq(`update public.team_notices set planned = '2026-12-24' where id = '${nid}' returning id`));
  await db.exec(`set test.uid = '${E}'`); const s1 = await tryq(`update public.team_notices set planned = '2026-12-24' where id = '${nid}' returning id`); await db.exec(`reset test.uid`);
  const after = await row();
  check('sql_others_cannot', e1.rows && e1.rows.length===0 && (x1.error || x1.rows.length===0) && /tareas_notice_follow_recipient_only/.test(s1.error||'') && after.planned==='2026-11-20' && !!after.done, {e1, x1, s1, after});
  // The other columns stay locked for the recipient; done_seen and followed are the triggers' alone (the server cannot move them either)
  const locked = [];
  for(const set of [`done_pushed = now()`, `done_seen = now()`, `followed = null`, `payload = 'x'`, `task_ref = 'z'`, `recipient_id = '${E}'`, `pushed = now()`]) locked.push((await as(V, () => tryq(`update public.team_notices set ${set} where id = '${nid}' returning id`))).error||'passed');
  await q(`update public.team_notices set done_seen = '2020-01-01', followed = null where id = '${nid}'`); const kept = await row();
  check('sql_recipient_locked', locked.every(e=>/permission denied/.test(e)) && kept.done_seen.getTime()===after.done_seen.getTime() && kept.followed.getTime()===after.followed.getTime(), {locked, kept, after});
  // done_pushed: the server's claim; a reopen keeps it; a new completion within 4 hours keeps it (no new notification); after 4 hours it
  // empties it (told again); a new time of an already done one does not
  const claim = (await q(`update public.team_notices set done_pushed = now() where done is not null and done_pushed is null returning id`)).length;
  await as(V, () => q(`update public.team_notices set done = null where id = '${nid}'`)); const reopened = await row();
  await as(V, () => q(`update public.team_notices set done = now() where id = '${nid}'`)); const soon = await row();
  await q(`update public.team_notices set done_pushed = now() - interval '5 hours' where id = '${nid}'`);
  await as(V, () => q(`update public.team_notices set done = null where id = '${nid}'`)); await as(V, () => q(`update public.team_notices set done = now() where id = '${nid}'`)); const later = await row();
  await q(`update public.team_notices set done_pushed = now() - interval '5 hours' where id = '${nid}'`);
  await as(V, () => q(`update public.team_notices set done = now() - interval '1 minute' where id = '${nid}'`)); const moved = await row();
  check('sql_done_pushed_reset', claim===1 && reopened.done===null && !!reopened.done_pushed && !!soon.done && !!soon.done_pushed && soon.done_seen>reopened.done_seen
    && !!later.done && later.done_pushed===null && !!moved.done_pushed && moved.done_seen.getTime()===later.done_seen.getTime(), {claim, reopened, soon, later, moved});
  // The server itself (no user) may set planned; a completion in the future is now
  const srv = await tryq(`update public.team_notices set planned = null where id = '${nid}' returning id`);
  const fut = await as(V, () => tryq(`update public.team_notices set done = now() + interval '2 days' where id = '${nid}' returning done <= now() + interval '1 minute' ok`));
  check('sql_server_and_future', srv.rows && srv.rows.length===1 && fut.rows && fut.rows[0].ok===true, {srv, fut});
  await db.close();
  // all.sql twice on a fresh database; check.sql OK on every row, the three of 0014 among them
  db = await pgSetup(); const all = strip(fs.readFileSync(path.join(ROOT, 'supabase/all.sql'), 'utf8'));
  err = null; try { await db.exec(all); await db.exec(all); } catch(e){ err = e.message; }
  check('sql_all_twice', !err && /0001 a 0014/.test(all.split('\n')[0]) && /migrations\/0014_notice_follow\.sql/.test(all), err);
  let rows = []; try { rows = (await db.query(fs.readFileSync(path.join(ROOT, 'supabase/check.sql'), 'utf8'))).rows; } catch(e){ err = e.message; }
  check('sql_check_all_ok', rows.length>=46 && rows.every(x=>x.Estado==='OK') && rows.filter(x=>/\(0014\)/.test(x.Pieza)).length===3 && /notify pgrst, 'reload schema';\s*$/.test(fs.readFileSync(path.join(ROOT, 'supabase/migrations/0014_notice_follow.sql'), 'utf8')), {err, bad:rows.filter(x=>x.Estado!=='OK'), n:rows.length});
  await db.close();
  // A database with 0013 and without 0014: check.sql says FALTA on those three rows (and does not fail)
  db = await pgSetup(); for(const f of MIGS) await db.exec(strip(rd(f))); await db.exec(rd('0013_team.sql'));
  rows = []; err = null; try { rows = (await db.query(fs.readFileSync(path.join(ROOT, 'supabase/check.sql'), 'utf8'))).rows; } catch(e){ err = e.message; }
  check('sql_check_without_0014', !err && rows.filter(x=>/\(0014\)/.test(x.Pieza)).every(x=>x.Estado==='FALTA'), {err, rows:rows.filter(x=>/\(0014\)/.test(x.Pieza))});
  await db.close();
  const readme = fs.readFileSync(path.join(ROOT, 'supabase/README.md'), 'utf8');
  check('sql_readme', /`migrations\/0014_notice_follow\.sql`/.test(readme) && /suma de las catorce en orden/.test(readme), null);
}

/* ======================= 2. The app ======================= */
const PW_E='Clave de Enric 2026!', PW_V='Victor sanz #2026x';
async function appTests(browser){
  const fake = new TF.Fake();
  const UE = fake.user('9b2f6d3e-0000-4000-8000-0000000000e1', 'enric@example.com', 'Enric Vidal'), UV = fake.user('9b2f6d3e-0000-4000-8000-0000000000e5', 'victor@example.com', 'Víctor Sanz');
  fake.bootstrap(); fake.members.push({id:'m-v', email:'victor@example.com', name:null, role:'member', quota:52428800, invited:new Date().toISOString(), revoked:null, last_access:null, user_id:null});
  const dev = o => TF.device(browser, fake, o, PORT, errors);
  const D3=addDays(today(), 3), D5=addDays(today(), 5), T1=addDays(today(), 1);
  const pe={id:'pe', spaceId:'trabajo', name:'FLC', color:'#007AFF', order:0, archived:false, created:TF.T0, modified:TF.T0};
  /* ---------- Enric (desktop) and Víctor (iPhone), with their keys ---------- */
  const Ed = await dev({tag:'E', desk:true, user:UE, seed:seed([tk('e1', {title:'Revisar el presupuesto de FLC', projectId:'pe', date:null}), tk('e2', {title:'Enviar el acta del comité', projectId:'pe'}), tk('e3', {title:'Preparar la demo'})], {projects:[pe]})}); const ep=Ed.page;
  await signIn(ep, true); await synced(ep); await activate(ep, PW_E); await ep.evaluate(()=>{ if(document.querySelector('#sheet.on')) closeSheet(); });
  check('E_ready', await until(ep, ()=>!!TM.priv&&SY.status==='ok', null, 20000));
  const Vd = await dev({tag:'V', user:UV, seed:seed([tk('v0', {title:'Una tarea de Enric de antes'})])}); const vp=Vd.page;
  await signIn(vp); await until(vp, ()=>SY.status==='needkey'); await vp.evaluate(()=>{ if(document.querySelector('#sheet.on')) closeSheet(); }); await settled(vp);
  await activate(vp, PW_V); await vp.evaluate(()=>{ if(document.querySelector('#sheet.on')) closeSheet(); });
  check('V_ready', await until(vp, ()=>!!TM.priv&&SY.status==='ok', null, 25000), await vp.evaluate(()=>({st:SY.status, tm:TM.state})));
  await ep.evaluate(()=>{ TM.dirAt=0; return syncRun('prueba'); }); await until(ep, ()=>TM.dir.length===2&&TM.dir.every(m=>m.pub), null, 15000);
  // An older notice, added before this version (its task has another id): never followed
  const oldAt=new Date(Date.now()-3*864e5).toISOString();
  fake.notices.push({id:'00000000-0000-4000-8000-00000000old1', sender_id:UE.uid, recipient_id:UV.uid, task_ref:'e-antigua', payload:'t1:x', created:oldAt, pushed:oldAt, taken:oldAt, dismissed:null, planned:null, done:null, done_pushed:null});
  /* ---------- Enric sends two tasks ---------- */
  const s1 = await ep.evaluate(to=>noticeSend('e1', to, 'Para la semana que viene'), UV.uid), s2 = await ep.evaluate(to=>noticeSend('e2', to, ''), UV.uid);
  const n1 = fake.notices.find(n=>n.task_ref==='e1'), n2 = fake.notices.find(n=>n.task_ref==='e2'), nOld = fake.notices.find(n=>n.task_ref==='e-antigua');
  check('E_sent', s1==='ok' && s2==='ok' && !!n1 && !!n2, {s1, s2});
  /* ---------- Víctor adds the first: the task keeps the notice's id ---------- */
  await vp.evaluate(()=>syncRun('prueba')); check('V_received', await until(vp, ()=>TM.recv.length===2, null, 15000), await vp.evaluate(()=>TM.recv.length));
  await vp.evaluate(id=>recvAdd(id, null), n1.id);
  // The id: 'nt-', the notice's id and a random part nobody else can guess (a sender could otherwise take the id first)
  check('V_linked_task', await until(vp, id=>!!noticeTaskOf(id), n1.id));
  const nid1 = await vp.evaluate(id=>noticeTaskOf(id).id, n1.id);
  check('V_linked_id', new RegExp('^nt-'+n1.id+'-[0-9a-f]{8}$').test(nid1) && !!n1.taken && await vp.evaluate(([id, nid])=>DB.tasks.filter(x=>x.title==='Revisar el presupuesto de FLC').map(x=>x.id).join()===id&&noticeOfTask(id)===nid, [nid1, n1.id]), nid1);
  await synced(vp); check('V_synced', fake.t.tasks.has(nid1) && TF.isEnc(fake.t.tasks.get(nid1).title));
  /* ---------- Enric's iPhone: «la ha añadido, sin fecha prevista» ---------- */
  const E2 = await dev({tag:'E2', user:UE}); const e2p=E2.page; await signIn(e2p);
  check('E2_unlocked', await until(e2p, ()=>SY.status==='locked', null, 15000) && await e2p.evaluate(async pw=>{ await cryptoUnlock(pw); return true; }, PW_E) && await until(e2p, ()=>SY.status==='ok'&&!!task('e1')&&TM.sent.length===3, null, 20000), await e2p.evaluate(()=>({st:SY.status, sent:TM.sent.length})));
  await e2p.evaluate(()=>{ if(document.querySelector('#sheet.on')) closeSheet(); }); await settled(e2p);
  const lines = async (page, id) => { await page.evaluate(()=>teamSentFetch(true)); return page.evaluate(id=>noticeLines(task(id)), id); };
  // The recipient's first follow-up write marks the notice followed, even with no date; only then «sin fecha prevista»
  check('V_followed', await (async()=>{ for(let i=0;i<150;i++){ if(n1.followed) return true; await new Promise(r=>setTimeout(r,100)); } return false; })() && n1.planned===null, n1);
  let l = await lines(e2p, 'e1');
  check('E2_added_no_date', l.length===1 && /^Avisado a Víctor hoy a las \d\d:\d\d: la ha añadido, sin fecha prevista$/.test(l[0]), l);
  /* ---------- Víctor gives it a date: «prevista para…» ---------- */
  await vp.evaluate(([id, d])=>updTask(id, {date:d}), [nid1, D3]);
  check('V_planned_up', await until(vp, ()=>true) && await (async()=>{ for(let i=0;i<150;i++){ if(n1.planned===D3) return true; await new Promise(r=>setTimeout(r,100)); } return false; })(), n1);
  l = await lines(e2p, 'e1'); const dw3 = await e2p.evaluate(d=>dayWords(d), D3);
  check('E2_planned', l.length===1 && l[0].endsWith(': la ha añadido, prevista para '+dw3), {l, dw3});
  await e2p.evaluate(()=>openDetail('e1')); await e2p.waitForTimeout(800); await hideToast(e2p);
  const dl = await e2p.evaluate(()=>[...document.querySelectorAll('.pushed-screen .ntnote .ntline')].map(x=>x.textContent));
  check('E2_detail_line', dl.length===1 && dl[0]===l[0], dl);
  await shot(e2p, 'nf-ip-light-prevista');
  /* ---------- Víctor completes it: «la ha completado hoy» and «Hecha por Víctor» ---------- */
  const waitN = async (fn, ms=15000) => { const t0=Date.now(); while(Date.now()-t0<ms){ if(fn()) return true; await new Promise(r=>setTimeout(r,100)); } return false; };
  await vp.evaluate(id=>completeTask(id), nid1);
  check('V_done_up', await waitN(()=>!!n1.done&&n1.planned===D3) && n1.done_pushed===null, n1);
  n1.done_pushed = new Date().toISOString(); // send-reminders told Enric
  l = await lines(e2p, 'e1');
  check('E2_completed', l.length===1 && /: la ha completado hoy$/.test(l[0]), l);
  await e2p.evaluate(()=>{ while(UI.stack.length) pop(); UI.tab='tareas'; DB.settings.filter='todas'; render(); }); await e2p.waitForTimeout(700);
  const ipRow = await e2p.evaluate(()=>{ const b=document.querySelector('.row[data-id=e1] .doneby'); return b&&{t:b.textContent, c:getComputedStyle(b).color}; });
  check('E2_row_marker', ipRow && ipRow.t==='Hecha por Víctor' && ipRow.c==='rgb(36, 138, 61)', ipRow);
  await hideToast(e2p); await shot(e2p, 'nf-ip-light-hecha');
  await ep.evaluate(()=>teamSentFetch(true)); await ep.evaluate(()=>{ setDeskView('todas'); render(); }); await ep.waitForTimeout(400);
  const dkRow = await ep.evaluate(()=>{ const b=document.querySelector('.main .row[data-id=e1] .rc-per .dtag'); const h=document.querySelector('.main .colhead .rc-per'); return b&&{t:b.textContent, c:getComputedStyle(b).color, head:h&&getComputedStyle(h).display!=='none'}; });
  check('E_desk_marker', dkRow && dkRow.t==='Hecha por Víctor' && dkRow.c==='rgb(36, 138, 61)' && dkRow.head, dkRow);
  await ep.evaluate(()=>openDetail('e1')); await ep.waitForTimeout(500);
  const il = await ep.evaluate(()=>[...document.querySelectorAll('.intnotes .ntline')].map(x=>x.textContent));
  check('E_inspector_completed', il.length===1 && /^Avisado a Víctor hoy a las \d\d:\d\d: la ha completado hoy$/.test(il[0]), il);
  await hideToast(ep); await shot(ep, 'nf-desk-hecha');
  /* ---------- Víctor reopens it: «prevista para…» again; completed again: done_pushed empty again ---------- */
  await vp.evaluate(id=>completeTask(id), nid1);
  check('V_reopened_up', await waitN(()=>n1.done===null) && !!n1.done_pushed && n1.planned===D3, n1);
  l = await lines(e2p, 'e1'); await e2p.evaluate(()=>render()); await e2p.waitForTimeout(300);
  check('E2_reopened', l.length===1 && l[0].endsWith(': la ha añadido, prevista para '+dw3) && await e2p.evaluate(()=>!document.querySelector('.row[data-id=e1] .doneby')), l);
  await vp.evaluate(id=>completeTask(id), nid1);
  // Completed again within 4 hours of the notification: Enric is not told again (done_pushed kept); done_seen is now
  const seen0 = n1.done_seen; await new Promise(r=>setTimeout(r, 20));
  check('V_done_again', await waitN(()=>!!n1.done) && !!n1.done_pushed && n1.done_seen!==seen0, n1);
  // Four hours later, a reopen and a new completion tell him again
  n1.done_pushed = new Date(Date.now()-5*3600e3).toISOString();
  await vp.evaluate(id=>completeTask(id), nid1); await waitN(()=>n1.done===null); await vp.evaluate(id=>completeTask(id), nid1);
  check('V_done_after_4h', await waitN(()=>!!n1.done) && n1.done_pushed===null, n1);
  // A stale device (its task reopened before that completion) never takes the completion back
  const stale = await vp.evaluate(async([id, done])=>{ const x=task(id), keep=JSON.stringify(x); Object.assign(x, {status:'pending', completed:null, modified:new Date(Date.parse(done)-6e4).toISOString()});
    TM.followSig=null; await teamFollowSync(); Object.assign(x, JSON.parse(keep)); TM.followSig=null; return true; }, [nid1, n1.done]);
  check('stale_no_undone', stale && !!n1.done, n1);
  // Enric completes his own task: the marker goes
  await ep.evaluate(()=>teamSentFetch(true)); await ep.evaluate(()=>{ render(); }); await ep.waitForTimeout(300);
  const before = await ep.evaluate(()=>!!document.querySelector('.main .row[data-id=e1] .dtag'));
  await ep.evaluate(()=>completeTask('e1')); await ep.waitForTimeout(300); await ep.evaluate(()=>render());
  check('E_marker_gone_when_done', before && await ep.evaluate(()=>noticeDoneBy(task('e1'))===''&&!document.querySelector('.main .row[data-id=e1] .dtag')));
  // Several people, and only each person's latest notice counts
  const many = await ep.evaluate(([v, t1])=>{ const sv=TM.sent, dv=TM.dir; try{ TM.dir=dv.concat({id:'ana', name:'Ana Pons', email:'ana@example.com', pub:'x'});
      const n=(id, to, at, done)=>({id, to, ref:'e3', at, taken:at, dismissed:null, follow:true, planned:null, done});
      TM.sent=[n('a', v, '2026-11-01T10:00:00Z', '2026-11-02T10:00:00Z'), n('b', 'ana', '2026-11-01T11:00:00Z', '2026-11-03T10:00:00Z')]; const two=noticeDoneBy(task('e3'));
      TM.sent.push(n('c', v, '2026-11-04T10:00:00Z', null)); const latest=noticeDoneBy(task('e3'));
      return {two, latest}; } finally{ TM.sent=sv; TM.dir=dv; } }, [UV.uid, T1]);
  check('marker_names', many.two==='Hecha por Víctor y Ana' && many.latest==='Hecha por Ana', many);
  /* ---------- The second one, added and taken out of the list: «la ha descartado»; Deshacer brings it back ---------- */
  await vp.evaluate(id=>recvAdd(id, null), n2.id); await until(vp, id=>!!noticeTaskOf(id), n2.id); const nid2 = await vp.evaluate(id=>noticeTaskOf(id).id, n2.id);
  check('V_second_added', await until(vp, id=>!!task(id), nid2) && await synced(vp));
  const kept = await vp.evaluate(id=>{ const x=JSON.parse(JSON.stringify(task(id))); deleteTask(id); return x; }, nid2);
  check('V_deleted_dismissed', await waitN(()=>!!n2.dismissed) && !!n2.taken, n2);
  l = await lines(e2p, 'e2');
  check('E2_dismissed', l.length===1 && /: la ha descartado$/.test(l[0]), l);
  await vp.evaluate(x=>{ DB.tasks.push(x); save(); }, kept); // what Deshacer does
  check('V_gone_remembered', await vp.evaluate(id=>followGone().has(id)&&JSON.parse(localStorage.getItem('tareas-team')).followGone.includes(id), n2.id));
  check('V_back_undismissed', await waitN(()=>n2.dismissed===null) && await vp.evaluate(()=>TM.recv.length===0) && await vp.evaluate(id=>!followGone().has(id), n2.id), n2);
  l = await lines(e2p, 'e2');
  check('E2_back', l.length===1 && /: la ha añadido, prevista para hoy$/.test(l[0]), l); // Enric's task was for today
  /* ---------- The older task is never touched; nothing is read while nothing changed ---------- */
  check('old_untouched', nOld.dismissed===null && nOld.planned===null && nOld.done===null && !fake.followMarks.some(m=>m.id===nOld.id) && await vp.evaluate(()=>!!task('v0')), {nOld, marks:fake.followMarks});
  await synced(vp); const reads0 = fake.calls.filter(c=>c==='V:noticeFollow').length;
  await vp.evaluate(()=>syncRun('prueba')); await vp.evaluate(()=>syncRun('prueba'));
  const reads1 = fake.calls.filter(c=>c==='V:noticeFollow').length;
  check('no_read_without_change', reads0>0 && reads1===reads0, {reads0, reads1});
  check('logs_counts_only', await vp.evaluate(()=>!JSON.stringify(LOG).includes('Revisar el presupuesto')&&LOG.some(e=>/seguimiento de tareas recibidas enviado/.test(e.m))));
  /* ---------- A tap on the notification opens Enric's task, without the bar to postpone its reminder ---------- */
  const tap = await e2p.evaluate(t1=>{ updTask('e3', {reminder:new Date(t1+'T09:00:00').toISOString()}); openTaskFromPush('e3', 'prueba', null, true); const a={id:detailTaskId(), bar:UI.snooze||null};
    while(UI.stack.length) pop(); openTaskFromPush('e3', 'prueba', null, false); const b={id:detailTaskId(), bar:UI.snooze||null}; while(UI.stack.length) pop(); return {a, b}; }, T1);
  check('push_open_follow', tap.a.id==='e3' && !tap.a.bar && tap.b.id==='e3' && tap.b.bar==='e3', tap);
  // The tap reads what the recipient did at once (and so does a completion told to an open app)
  const asked0 = fake.sentAsked.length; await e2p.evaluate(()=>{ openTaskFromPush('e1', 'prueba', null, true); }); await e2p.waitForTimeout(500);
  await e2p.evaluate(()=>{ while(UI.stack.length) pop(); }); const asked1 = fake.sentAsked.length;
  check('push_open_reads_sent', asked1>asked0, {asked0, asked1});
  /* ---------- A notice taken but never followed (an app before 0.37.0): «la ha añadido a sus tareas», not «sin fecha prevista» ---------- */
  fake.notices.push({id:'00000000-0000-4000-8000-0000000000f2', sender_id:UE.uid, recipient_id:UV.uid, task_ref:'e3', payload:'t1:x', created:oldAt, pushed:oldAt, taken:oldAt, dismissed:null, planned:null, done:null, done_seen:null, done_pushed:null, followed:null});
  l = await lines(e2p, 'e3');
  check('unfollowed_wording', l.length===1 && /: la ha añadido a sus tareas$/.test(l[0]), l);
  /* ---------- Which linked tasks are followed: open ones and those changed in the last 90 days, ids made of a notice's UUID only ---------- */
  const wanted = await vp.evaluate(()=>{ const t=new Date().toISOString(), old=new Date(Date.now()-100*864e5).toISOString(), add=[
      {id:'nt-not-a-uuid', title:'x', status:'pending'}, {id:'nt-11111111-2222-4333-8444-555555555555-ab12cd34', title:'x', status:'done', completed:old, modified:old},
      {id:'nt-11111111-2222-4333-8444-666666666666-ab12cd34', title:'x', status:'done', completed:t, modified:t}, {id:'nt-11111111-2222-4333-8444-777777777777-ab12cd34', title:'x', status:'pending', modified:old}];
    DB.tasks.push(...add.map(x=>Object.assign({spaceId:'trabajo', date:null, notes:'', created:old}, x))); try{ return [...followWanted().keys()]; } finally{ DB.tasks=DB.tasks.filter(x=>!add.some(a=>a.id===x.id)); } });
  check('follow_volume', !wanted.includes('not-a-uuid') && !wanted.some(id=>/5555$/.test(id)) && wanted.some(id=>/6666$/.test(id)) && wanted.some(id=>/7777$/.test(id)) && !fake.followAsked.flat().some(id=>!/^[0-9a-f-]{36}$/.test(id)), {wanted, asked:fake.followAsked.flat().filter(id=>!/^[0-9a-f-]{36}$/.test(id))});
  // A linked task whose notice is not taken yet (the mark of «Añadir» still on its way) leaves the next pass free to read again
  const race = await vp.evaluate(async()=>{ const id='11111111-2222-4333-8444-888888888888', x={id:'nt-'+id+'-ab12cd34', title:'x', spaceId:'trabajo', status:'pending', date:null, notes:'', created:new Date().toISOString(), modified:new Date().toISOString()};
    DB.tasks.push(x); TM.followSig=null; try{ await teamFollowSync(); return TM.followSig; } finally{ DB.tasks=DB.tasks.filter(t=>t!==x); TM.followSig=null; } });
  fake.notices.push({id:'11111111-2222-4333-8444-888888888888', sender_id:UE.uid, recipient_id:UV.uid, task_ref:'zz', payload:'t1:x', created:oldAt, pushed:oldAt, taken:null, dismissed:null, planned:null, done:null, done_seen:null, done_pushed:null, followed:null});
  const race2 = await vp.evaluate(async()=>{ const id='11111111-2222-4333-8444-888888888888', x={id:'nt-'+id+'-ab12cd34', title:'x', spaceId:'trabajo', status:'pending', date:null, notes:'', created:new Date().toISOString(), modified:new Date().toISOString()};
    DB.tasks.push(x); TM.followSig=null; try{ await teamFollowSync(); return TM.followSig; } finally{ DB.tasks=DB.tasks.filter(t=>t!==x); TM.followSig=null; } });
  fake.notices = fake.notices.filter(n=>n.id!=='11111111-2222-4333-8444-888888888888');
  check('follow_race_reads_again', typeof race==='string' && race2===null, {race, race2});
  /* ---------- Without 0014: nothing written, said once; the sender's lines as in v0.36.2 ---------- */
  fake.follow = false; const marks0 = fake.followMarks.length;
  await vp.evaluate(([id, d])=>{ TM.followOff=0; TM.followSig=null; updTask(id, {date:d}); }, [nid2, D5]); await synced(vp);
  await vp.evaluate(()=>syncRun('prueba')); await vp.waitForTimeout(300);
  check('no0014_recipient', fake.followMarks.length===marks0 && n2.planned===today() && await vp.evaluate(()=>LOG.filter(e=>/falta 0014_notice_follow\.sql/.test(e.m)).length===1), {marks:fake.followMarks.length, n2});
  await e2p.evaluate(()=>{ TM.followOff=0; }); l = await lines(e2p, 'e1'); await lines(e2p, 'e1');
  check('no0014_sender', l.length===1 && /: la ha añadido a sus tareas$/.test(l[0]) && fake.sentAsked[fake.sentAsked.length-1]==='id,recipient_id,task_ref,created,taken,dismissed' && await e2p.evaluate(()=>LOG.filter(e=>/falta 0014_notice_follow\.sql/.test(e.m)).length===1), {l, asked:fake.sentAsked.slice(-3)});
  fake.follow = true;
  await Ed.ctx.close(); await Vd.ctx.close(); await E2.ctx.close();
}

(async()=>{
  try { await sqlTests(); } catch(e){ errors.push('sql: '+(e.stack||e.message)); }
  const srv = await TF.serve(PORT); const browser = await chromium.launch();
  try { await appTests(browser); } catch(e){ errors.push('app: '+(e.stack||e.message)); }
  await browser.close(); srv.close();
  console.log(JSON.stringify({r, fails, errors}, null, 1)); process.exit(fails.length||errors.length?1:0);
})();
