require('./lib/out.js'); // outputs (screenshots, downloads) go to tests/out
// Decision 88: shared tasks between members of the team (0016_shared.sql, js/share.js). Port 8837. Screenshots in tests/out/SH.
//  1. SQL (PGlite): runs twice and creates and removes nothing; the texts sealed with the task key; only the owner adds people, members of
//     the team, with sealed keys; who reads what; any participant edits and completes, an older copy is ignored, only the owner deletes;
//     events (completed, postponed with a newer modified; never the start of a day); the person leaves, the owner removes and adds again
//     (the task touched, told again); each person's own part; all.sql twice and check.sql OK.
//  2. The app against the team's fake server: Enric (admin, desktop) shares a task with steps with Víctor (member, iPhone): «Compartir con…»
//     instead of «Avisar a…», what the server keeps (sealed texts, keys for each, his own part, the old rows gone), Recibidas on Víctor's
//     iPhone, «Añadir a mis tareas», the common part both ways (title, date, steps, completed), the own part never shared (reminder,
//     project), the events, leaving, «No, gracias», removed by the owner and deleted by the owner (with their notices), the restrictions.
const fs = require('fs'); const path = require('path');
const { chromium } = require('playwright');
const TF = require('./lib/team-fake.js'); const { until, synced, settled, sheetIn, signIn, activate, tk, seed, today } = TF;
const { pgSetup, strip, MIGS } = require('./rm-TM.js');
const ROOT = path.resolve(__dirname, '..'), PORT = 8837, OUT = path.join(__dirname, 'out', 'SH'); fs.mkdirSync(OUT, {recursive:true});
const r={}, fails=[], errors=[]; const check=(name, ok, info)=>{ r[name]=ok?true:(info===undefined?false:info); if(!ok) fails.push(name); };
const shot=(page, name)=>page.screenshot({path:path.join(OUT, name+'.png')});
const addDays=(d,n)=>{ const x=new Date(d+'T12:00:00'); x.setDate(x.getDate()+n); return x.toISOString().slice(0,10); };

/* ======================= 1. SQL ======================= */
const SE='00000000-0000-4000-8000-0000000000e1', SV='00000000-0000-4000-8000-0000000000e5', SX='00000000-0000-4000-8000-0000000000e3', SA='00000000-0000-4000-8000-0000000000e6';
async function sqlTests(){
  const rd=f=>fs.readFileSync(path.join(ROOT,'supabase/migrations',f),'utf8'), mig=rd('0016_shared.sql');
  const body=mig.split('\n').filter(l=>!/^\s*--/.test(l)).join('\n').replace(/on delete cascade/gi,'');
  check('sql_no_drop_delete', !/\b(drop|delete|truncate)\b/i.test(body), body.match(/.*\b(drop|delete|truncate)\b.*/gi));
  let db=await pgSetup(); for(const f of MIGS) await db.exec(strip(rd(f)));
  await db.exec(`insert into auth.users (id,email,email_confirmed_at,created_at,raw_user_meta_data) values ('${SE}','enric@example.com',now(),'2026-10-01','{}'),('${SV}','victor@example.com',now(),'2026-11-05','{}'),('${SA}','ana@example.com',now(),'2026-11-05','{}'),('${SX}','x@example.com',now(),'2026-11-05 10:00','{}')`);
  await db.exec(rd('0013_team.sql')); await db.exec(rd('0014_notice_follow.sql')); await db.exec(rd('0015_someday.sql'));
  let err=null; try{ await db.exec(mig); await db.exec(mig); }catch(e){ err=e.message; } check('sql_runs_twice', !err, err);
  const q=async s=>(await db.query(s)).rows, tryq=async s=>{ try{ return {rows:await q(s)}; }catch(e){ return {error:e.message}; } };
  const as=async(uid,fn)=>{ await db.exec(`set test.uid='${uid}'; set role authenticated;`); try{ return await fn(); } finally{ await db.exec(`reset role; reset test.uid;`); } };
  await as(SE,()=>q(`select public.tareas_team_invite('victor@example.com','Víctor')`)); await as(SE,()=>q(`select public.tareas_team_invite('ana@example.com','Ana')`));
  for(const u of [SV,SA]) await as(u,()=>q(`select public.tareas_team_me()`));
  for(const u of [SE,SV,SA]) await as(u,()=>q(`insert into public.crypto_keys (owner_id,kid,salt,iterations,wrapped) values ('${u}','k','s',1,'w')`));
  const plain=await as(SE,()=>tryq(`insert into public.shared_tasks (id,title,modified) values ('t1','Hola',now())`));
  const ins=await as(SE,()=>tryq(`insert into public.shared_tasks (id,title,notes,steps,date,status,modified,created) values ('t1','s1:aaa','s1:bbb','s1:ccc','2026-11-20','pending','2026-11-18T10:00:00Z',now()) returning owner_id`));
  check('sql_task_insert', /tareas_plaintext_refused/.test(plain.error||'') && ins.rows&&ins.rows[0].owner_id===SE, {plain, ins});
  const m0=await as(SE,()=>tryq(`insert into public.shared_members (id,task_id,user_id,key,modified,created) values ('t1:${SE}','t1','${SE}','t1:k0',now(),now()),('t1:${SV}','t1','${SV}','t1:k1',now(),now()) returning id, pushed`));
  const mx=await as(SE,()=>tryq(`insert into public.shared_members (id,task_id,user_id,key,modified) values ('t1:${SX}','t1','${SX}','t1:kx',now())`));
  const mp=await as(SE,()=>tryq(`insert into public.shared_members (id,task_id,user_id,key,modified) values ('t1:${SA}','t1','${SA}','plainkey',now())`));
  const mv=await as(SV,()=>tryq(`insert into public.shared_members (id,task_id,user_id,key,modified) values ('t1:${SA}','t1','${SA}','t1:ka',now())`));
  check('sql_members_insert', m0.rows&&m0.rows.length===2&&!!m0.rows.find(x=>x.id==='t1:'+SE).pushed&&m0.rows.find(x=>x.id==='t1:'+SV).pushed===null && !!mx.error && /plaintext_refused/.test(mp.error||'') && !!mv.error, {m0, mx, mp, mv});
  const rv=await as(SV,()=>q(`select id from public.shared_tasks`)), rvm=await as(SV,()=>q(`select id from public.shared_members order by id`)), ra=await as(SA,()=>q(`select id from public.shared_tasks`)), rx=await as(SX,()=>q(`select id from public.shared_tasks`));
  check('sql_read_rules', rv.length===1 && rvm.length===2 && ra.length===0 && rx.length===0, {rv, rvm, ra, rx});
  await as(SV,()=>q(`update public.shared_tasks set title='s1:zzz', status='done', completed=now(), modified='2026-11-18T11:00:00Z' where id='t1'`));
  await as(SV,()=>q(`update public.shared_tasks set title='s1:old', modified='2026-11-18T09:00:00Z' where id='t1'`));
  await as(SV,()=>q(`update public.shared_tasks set deleted=now(), modified='2026-11-18T11:30:00Z' where id='t1'`));
  let t=(await q(`select title, status, deleted from public.shared_tasks where id='t1'`))[0], ev=await q(`select task_id, actor_id, kind from public.shared_events`);
  check('sql_edit_complete_event', t.title==='s1:zzz'&&t.status==='done'&&t.deleted===null && ev.length===1&&ev[0].actor_id===SV&&ev[0].kind==='done', {t, ev});
  await as(SE,()=>q(`update public.shared_tasks set status='pending', completed=null, modified='2026-11-18T12:00:00Z' where id='t1'`));
  await as(SE,()=>q(`update public.shared_tasks set date='2026-11-21', carried=true where id='t1'`));
  await as(SE,()=>q(`update public.shared_tasks set date='2026-11-25', modified='2026-11-18T13:00:00Z' where id='t1'`));
  ev=await q(`select kind, actor_id from public.shared_events order by id`);
  check('sql_events_later', ev.length===2&&ev[1].kind==='later'&&ev[1].actor_id===SE, ev);
  await as(SV,()=>q(`update public.shared_members set key='t1:hack', removed=now(), modified=now() where id='t1:${SV}'`));
  let mrow=(await q(`select key, removed from public.shared_members where id='t1:${SV}'`))[0];
  await as(SV,()=>q(`update public.shared_members set left_at=now(), modified=now() where id='t1:${SV}'`));
  const afterLeave=await as(SV,()=>q(`select id from public.shared_tasks`)), ownRow=await as(SV,()=>q(`select id, left_at from public.shared_members`));
  check('sql_member_rules', mrow.key==='t1:k1'&&mrow.removed===null && afterLeave.length===0 && ownRow.length===1&&!!ownRow[0].left_at, {mrow, afterLeave, ownRow});
  const ts0=(await q(`select server_ts from public.shared_tasks where id='t1'`))[0].server_ts;
  await as(SA,()=>q(`update public.shared_members set left_at=null, modified=now() where id='t1:${SV}'`)); // a third person: no row to touch
  const stillLeft=(await q(`select left_at from public.shared_members where id='t1:${SV}'`))[0].left_at;
  await as(SE,()=>q(`update public.shared_members set left_at=null, modified=now() + interval '1 second' where id='t1:${SV}'`)); // the owner adds him again
  const back1=await as(SV,()=>q(`select id from public.shared_tasks`)), ts1=(await q(`select server_ts from public.shared_tasks where id='t1'`))[0].server_ts;
  await as(SE,()=>q(`update public.shared_members set removed=now(), modified=now() + interval '2 second' where id='t1:${SV}'`));
  const rem=await as(SV,()=>q(`select id from public.shared_tasks`));
  await as(SE,()=>q(`update public.shared_members set removed=null, modified=now() + interval '3 second' where id='t1:${SV}'`));
  const back=await as(SV,()=>q(`select id from public.shared_tasks`)), pushed=(await q(`select pushed from public.shared_members where id='t1:${SV}'`))[0].pushed;
  check('sql_remove_readd', !!stillLeft && back1.length===1 && ts1>ts0 && rem.length===0 && back.length===1 && pushed===null, {stillLeft, back1, ts0, ts1, rem, back, pushed});
  await as(SV,()=>q(`insert into public.shared_views (id,task_id,space_id,reminder,reminder_sent,modified) values ('t1:${SV}','t1','s1','2026-11-20T08:00:00Z',now(),now())`));
  const vE=await as(SE,()=>q(`select id from public.shared_views`)), vV=await as(SV,()=>q(`select id from public.shared_views`));
  await as(SV,()=>q(`update public.shared_views set reminder='2026-11-21T08:00:00Z', modified=now()+interval '1 second' where id='t1:${SV}'`));
  const rs=(await q(`select reminder_sent from public.shared_views where id='t1:${SV}'`))[0].reminder_sent;
  const pr=await as(SV,()=>tryq(`update public.shared_views set responsible='Luis', modified=now()+interval '2 second' where id='t1:${SV}'`));
  check('sql_views', vE.length===0&&vV.length===1&&rs===null&&/plaintext_refused/.test(pr.error||''), {vE, vV, rs, pr});
  await as(SE,()=>q(`update public.shared_tasks set deleted=now(), modified=now()+interval '1 hour' where id='t1'`));
  const del=(await q(`select deleted from public.shared_tasks where id='t1'`))[0].deleted, evr=await as(SV,()=>tryq(`select * from public.shared_events`));
  check('sql_owner_deletes', !!del && !!evr.error, {del, evr});
  await db.close();
  db=await pgSetup(); const all=strip(fs.readFileSync(path.join(ROOT,'supabase/all.sql'),'utf8')); err=null; try{ await db.exec(all); await db.exec(all); }catch(e){ err=e.message; }
  let rows=[]; try{ rows=(await db.query(fs.readFileSync(path.join(ROOT,'supabase/check.sql'),'utf8'))).rows; }catch(e){ err=err||e.message; }
  check('sql_all_check', !err && /0001 a 0016/.test(all.split('\n')[0]) && rows.length>=50 && rows.every(x=>x.Estado==='OK') && rows.filter(x=>/\(0016\)/.test(x.Pieza)).length===3, {err, bad:rows.filter(x=>x.Estado!=='OK')});
  await db.close();
}

/* ======================= 2. The app ======================= */
async function appTests(browser){
  const fake=new TF.Fake(); fake.shared=true;
  const UE=fake.user('9b2f6d3e-0000-4000-8000-0000000000e1','enric@example.com','Enric Vidal'), UV=fake.user('9b2f6d3e-0000-4000-8000-0000000000e5','victor@example.com','Víctor Sanz');
  fake.bootstrap(); fake.members.push({id:'m-v', email:'victor@example.com', name:null, role:'member', quota:52428800, invited:new Date().toISOString(), revoked:null, last_access:null, user_id:null});
  const dev=o=>TF.device(browser, fake, o, PORT, errors), D2=addDays(today(),2), D4=addDays(today(),4);
  const E=await dev({tag:'E', desk:true, user:UE, seed:seed([tk('e1', {title:'Preparar SteerCo', notes:'Repasar el informe de riesgos', date:D2, priority:'high', projectId:'pe'}), tk('e2', {title:'Revisar SOW'})],
    {projects:[{id:'pe', spaceId:'trabajo', name:'FLC', color:'#007AFF', order:0, archived:false, created:TF.T0, modified:TF.T0}], subtasks:[{id:'s1', taskId:'e1', title:'Agenda', done:true, order:1024, created:TF.T0, modified:TF.T0},{id:'s2', taskId:'e1', title:'Riesgos', done:false, order:2048, created:TF.T0, modified:TF.T0}]})}); const ep=E.page;
  await signIn(ep, true); await synced(ep); await activate(ep, 'Clave de Enric 2026!'); await ep.evaluate(()=>{ if(document.querySelector('#sheet.on')) closeSheet(); });
  check('E_ready', await until(ep, ()=>!!TM.priv&&SY.status==='ok', null, 20000));
  const V=await dev({tag:'V', user:UV, seed:seed([tk('v1', {title:'Tarea de Víctor'})], {projects:[{id:'pv', spaceId:'trabajo', name:'OCA', color:'#34C759', order:0, archived:false, created:TF.T0, modified:TF.T0}]})}); const vp=V.page;
  await signIn(vp); await until(vp, ()=>SY.status==='needkey'); await vp.evaluate(()=>{ if(document.querySelector('#sheet.on')) closeSheet(); }); await settled(vp);
  await activate(vp, 'Victor sanz #2026x'); await vp.evaluate(()=>{ if(document.querySelector('#sheet.on')) closeSheet(); });
  check('V_ready', await until(vp, ()=>!!TM.priv&&SY.status==='ok', null, 25000));
  await ep.evaluate(()=>{ TM.dirAt=0; return syncRun('prueba'); }); await until(ep, ()=>TM.dir.length===2&&TM.dir.every(m=>m.pub));
  await vp.evaluate(()=>{ TM.dirAt=0; return syncRun('prueba'); }); await until(vp, ()=>TM.dir.length===2);
  await vp.evaluate(()=>{ UI.stack.forEach(x=>x.el.remove()); UI.stack=[]; UI.tab='tareas'; DB.settings.filter='todas'; render(); });
  let x;
  /* ---------- Enric: «Compartir con…» replaces «Avisar a…» ---------- */
  x=await ep.evaluate(()=>{ const labels=m=>m.groups.flat().map(i=>i.label); return {desk:labels(deskTaskMenu('e1')), on:shOn(), can:canShare(task('e1'))}; });
  check('E_menu', x.on && x.can && x.desk.includes('Compartir con…') && !x.desk.some(l=>/Avisar/.test(l)), x);
  await ep.evaluate(()=>openDetail('e1')); await ep.waitForTimeout(500);
  x=await ep.evaluate(()=>{ const b=document.querySelector('#desk .pane [data-act=tmShare]'); return b&&b.textContent; });
  check('E_inspector_cell', x==='Compartir con…', x);
  await ep.click('#desk .pane [data-act=tmShare]'); await sheetIn(ep);
  x=await ep.evaluate(()=>[...document.querySelectorAll('#sheet .pprow')].map(b=>b.textContent));
  check('E_sheet', x.length===1 && /^Víctor/.test(x[0]), x);
  await ep.click('#sheet .pprow'); await shot(ep, 'e1-compartir');
  await ep.click('#sheet .hbtn.ok'); await until(ep, ()=>!document.querySelector('#sheet.on')&&!!task('e1').share);
  await synced(ep);
  const st=fake.t.shared_tasks.get('e1'), mm=[...fake.t.shared_members.values()], vw=[...fake.t.shared_views.values()], oldTask=fake.t.tasks.get('e1'), oldSteps=['s1','s2'].map(id=>fake.t.subtasks.get(id));
  check('E_server', !!st && /^s1:/.test(st.title) && /^s1:/.test(st.notes) && /^s1:/.test(st.steps) && st.owner_id===UE.uid && st.priority==='high' && st.date===D2 && !/SteerCo|riesgos|Agenda/i.test(JSON.stringify(st))
    && mm.length===2 && mm.every(m=>/^t1:/.test(m.key)) && vw.length===1 && vw[0].owner_id===UE.uid && vw[0].project_id==='pe'
    && !!(oldTask&&oldTask.deleted) && oldSteps.every(s=>s&&s.deleted), {st, mm:mm.length, vw, oldTask:oldTask&&oldTask.deleted, oldSteps:oldSteps.map(s=>s&&s.deleted)});
  await ep.evaluate(()=>{ setDeskView('todas'); openDetail('e1'); }); await ep.waitForTimeout(500);
  x=await ep.evaluate(()=>({cell:(document.querySelector('#desk .pane [data-act=tmShare]')||{}).textContent, row:!!document.querySelector('#desk .main .row[data-id=e1] .ish')}));
  check('E_shared_marks', x.cell==='Compartida con Víctor' && x.row, x);
  await shot(ep, 'e2-compartida');
  /* ---------- Víctor: Recibidas, then his task ---------- */
  await vp.evaluate(()=>syncRun('prueba')); await until(vp, ()=>recvCount()===1, null, 15000);
  await vp.evaluate(()=>{ DB.settings.filter='hoy'; render(); }); await vp.waitForTimeout(300);
  x=await vp.evaluate(()=>({n:recvCount(), pend:shPendingList().map(t=>t.title), inLists:pendingFor('todas').some(t=>t.id==='e1'), ban:(document.querySelector('.recvban .lbl')||{}).textContent}));
  check('V_received', x.n===1 && x.pend[0]==='Preparar SteerCo' && !x.inLists && x.ban==='1 tarea recibida', x);
  await vp.evaluate(()=>recvSheet()); await sheetIn(vp);
  x=await vp.evaluate(()=>({h:(document.querySelector('#sheet .shrecv .rv-h b')||{}).textContent, t:(document.querySelector('#sheet .shrecv .rv-t')||{}).textContent, m:(document.querySelector('#sheet .shrecv .rv-m')||{}).textContent}));
  check('V_card', x.h==='Enric ha compartido contigo' && x.t==='Preparar SteerCo' && /2 pasos/.test(x.m||''), x);
  await shot(vp, 'v1-recibidas');
  await vp.click('#sheet [data-act=tmShAdd]'); await until(vp, ()=>menuOpen()&&!menuFresh());
  await vp.locator('#pmenu .pm-it').filter({hasText:'OCA'}).first().click();
  await until(vp, ()=>!!task('e1')&&!!task('e1').spaceId); await vp.evaluate(()=>{ if(document.querySelector('#sheet.on')) closeSheet(); }); await settled(vp); await synced(vp);
  x=await vp.evaluate(()=>{ const t=task('e1'); return {title:t.title, notes:t.notes, steps:stepsOf('e1').map(s=>s.title+(s.done?'*':'')).join(), p:t.projectId, pri:t.priority, date:t.date, share:t.share, inList:pendingFor('todas').some(y=>y.id==='e1'), recv:recvCount()}; });
  check('V_added', x.title==='Preparar SteerCo' && x.notes==='Repasar el informe de riesgos' && x.steps==='Agenda*,Riesgos' && x.p==='pv' && x.pri==='high' && x.date===D2 && x.share===UE.uid && x.inList && x.recv===0, x);
  check('V_view_server', [...fake.t.shared_views.values()].some(v=>v.owner_id===UV.uid&&v.project_id==='pv'));
  await vp.evaluate(()=>openDetail('e1')); await vp.waitForTimeout(600);
  x=await vp.evaluate(()=>({cell:(document.querySelector('.pushed-screen [data-act=tmShare] .lbl')||{}).textContent, menu:shareItems(task('e1')).map(i=>i.label)}));
  check('V_detail', x.cell==='Compartida por Enric' && x.menu[0]==='Personas de la tarea', x);
  await shot(vp, 'v2-detalle');
  /* ---------- The common part both ways; the own part never ---------- */
  await vp.evaluate(()=>{ updTask('e1', {title:'Preparar SteerCo de diciembre'}); toggleStep('s2'); updTask('e1', {reminder:new Date(Date.now()+86400e3).toISOString()}); });
  await synced(vp); await ep.evaluate(()=>syncRun('prueba')); await until(ep, ()=>task('e1').title==='Preparar SteerCo de diciembre');
  x=await ep.evaluate(()=>({t:task('e1').title, steps:stepsOf('e1').map(s=>s.title+(s.done?'*':'')).join(), rem:task('e1').reminder||null, p:task('e1').projectId}));
  check('E_sees_common', x.t==='Preparar SteerCo de diciembre' && x.steps==='Agenda*,Riesgos*' && x.rem===null && x.p==='pe', x);
  await ep.evaluate(()=>{ addStep('e1', 'Enviar convocatoria'); updTask('e1', {priority:'mid'}); }); await synced(ep);
  await vp.evaluate(()=>syncRun('prueba')); await until(vp, ()=>stepsOf('e1').length===3&&task('e1').priority==='mid');
  check('V_sees_step', await vp.evaluate(()=>stepsOf('e1').map(s=>s.title).join()==='Agenda,Riesgos,Enviar convocatoria'&&!!task('e1').reminder));
  // Víctor postpones it (a later day): an event by him
  await vp.evaluate(d=>{ const t=task('e1'); updTask('e1', dayPatch(t, d)); }, D4); await synced(vp);
  check('event_later', (fake.sharedEvents||[]).some(e=>e.kind==='later'&&e.actor_id===UV.uid), fake.sharedEvents);
  /* ---------- Restrictions ---------- */
  x=await vp.evaluate(()=>({some:canSomeday(task('e1')), rep:(setRepeat('e1','D1'), task('e1').repeat||null), share:canShare(task('e1'))}));
  check('restrictions', x.some===false && x.rep===null && x.share===false, x);
  /* ---------- Víctor leaves; Enric adds him again; «No, gracias» ---------- */
  await vp.evaluate(()=>shLeave('e1')); await synced(vp);
  check('V_left', await vp.evaluate(()=>!task('e1')) && !!fake.t.shared_members.get('e1:'+UV.uid).left_at && !fake.t.shared_tasks.get('e1').deleted);
  await ep.evaluate(()=>syncRun('prueba')); await until(ep, ()=>shOthers(task('e1')).length===0);
  await ep.evaluate(uid=>shShare('e1', [uid]), UV.uid); await synced(ep);
  await vp.evaluate(()=>syncRun('prueba')); check('V_back_pending', await until(vp, ()=>recvCount()===1&&!!task('e1')&&!task('e1').spaceId, null, 15000));
  await vp.evaluate(()=>shLeave('e1')); await synced(vp);
  check('V_declined', await vp.evaluate(()=>!task('e1')&&recvCount()===0) && !!fake.t.shared_members.get('e1:'+UV.uid).left_at);
  /* ---------- Removed by the owner, then deleted by the owner ---------- */
  await ep.evaluate(()=>syncRun('prueba')); await ep.evaluate(uid=>shShare('e1', [uid]), UV.uid); await synced(ep);
  await vp.evaluate(()=>syncRun('prueba')); await until(vp, ()=>recvCount()===1); await vp.evaluate(()=>shAccept('e1', null)); await synced(vp);
  await ep.evaluate(uid=>shRemove('e1', uid), UV.uid); await synced(ep);
  await vp.evaluate(()=>syncRun('prueba')); await until(vp, ()=>!task('e1'));
  x=await vp.evaluate(()=>document.getElementById('toastText').textContent);
  check('V_removed_notice', x==='Enric ha dejado de compartir «Preparar SteerCo de diciembre»', x);
  await ep.evaluate(uid=>shShare('e1', [uid]), UV.uid); await synced(ep);
  await vp.evaluate(()=>syncRun('prueba')); await until(vp, ()=>recvCount()===1); await vp.evaluate(()=>shAccept('e1', null)); await synced(vp);
  x=await ep.evaluate(()=>{ confirmDelete('e1'); const a=document.querySelector('#asheet.on, .alert, #sheet.on'); return a&&a.textContent; }); await ep.waitForTimeout(300);
  check('E_delete_text', /también para Víctor/.test(x||''), x);
  await ep.evaluate(()=>{ closeSheet(); deleteTask('e1'); }); await synced(ep);
  check('E_deleted_server', !!fake.t.shared_tasks.get('e1').deleted);
  await vp.evaluate(()=>syncRun('prueba')); await until(vp, ()=>!task('e1'));
  x=await vp.evaluate(()=>document.getElementById('toastText').textContent);
  check('V_deleted_notice', x==='Enric ha eliminado «Preparar SteerCo de diciembre»', x);
  /* ---------- A participant's delete is a leave ---------- */
  await ep.evaluate(()=>{ addTask({id:'e3', title:'Llamar al cliente', date:todayStr()}); }); await ep.evaluate(uid=>shShare('e3', [uid]), UV.uid); await synced(ep);
  await vp.evaluate(()=>syncRun('prueba')); await until(vp, ()=>recvCount()===1); await vp.evaluate(()=>shAccept('e3', null)); await synced(vp);
  x=await vp.evaluate(()=>{ confirmDelete('e3'); const a=document.querySelector('#asheet.on'); return a&&a.textContent; });
  check('V_delete_is_leave', /desaparecerá de tus tareas/.test(x||'') && /Salir de la tarea/.test(x||''), x);
  await vp.evaluate(()=>closeSheet());
  // Completed by Víctor: an event; Enric sees it done
  await vp.evaluate(()=>completeTask('e3')); await vp.waitForTimeout(1800); await synced(vp);
  check('event_done', (fake.sharedEvents||[]).some(e=>e.kind==='done'&&e.actor_id===UV.uid&&e.task_id==='e3'));
  await ep.evaluate(()=>syncRun('prueba')); check('E_sees_done', await until(ep, ()=>task('e3').status==='done'));
  await E.ctx.close(); await V.ctx.close();
}

(async()=>{
  try{ await sqlTests(); }catch(e){ fails.push('sql_exception'); errors.push('sql: '+String(e&&e.stack||e)); }
  const srv=await TF.serve(PORT); const browser=await chromium.launch();
  try{ await appTests(browser); }catch(e){ fails.push('app_exception'); errors.push('app: '+String(e&&e.stack||e)); }
  console.log(JSON.stringify({r, fails, errors}, null, 1));
  await browser.close(); srv.close(); process.exit(fails.length||errors.length?1:0);
})();
