require('./lib/out.js'); // outputs (screenshots, downloads) go to tests/out
// Decision 63b: «Avisar a…» and Recibidas. Port 8815 (8810 to 8829 reserved for the team). Screenshots in tests/out/TM (av-*).
//  Against the team's fake server (tests/lib/team-fake.js): Enric (admin, desktop, light), Susana (member, iPhone, dark) and Pablo (member,
//  signed in, without the encryption password yet). Susana's task (notes, date, priority, estimate, deadline, steps): «Avisar a…» in the
//  long press menu, the detail and its menu; the member list (Pablo shown, not choosable); a phrase; what the server keeps is a 't1:' copy
//  that does not hold the task's text, which only Enric's key opens (not Susana's, not another key); the same task to the same person waits
//  4 hours (the sheet says until when; the server refuses it too); «Avisado a Enric hace un momento» on Susana's task, never synced.
//  Enric: realtime brings it, the sidebar's Recibidas (1), its view with «De Susana», the phrase and the meta; «Añadir a mis tareas» with a
//  project makes an ordinary task with title, notes, date, priority, estimate, deadline and steps (their ticks), marks it taken, and
//  Deshacer brings it back; «Descartar» another one. Enric to Susana: the line «1 tarea recibida» at the top of Hoy on the iPhone and its
//  sheet. Desktop: «Avisar a…» in the context menu and the inspector.
const { chromium } = require('playwright');
const fs = require('fs'); const path = require('path');
const TF = require('./lib/team-fake.js'); const { until, synced, settled, sheetIn, toSettings, signIn, activate, hideToast, tk, seed, today } = TF;
const PORT = 8815, OUT = path.join(__dirname, 'out', 'AV'); fs.mkdirSync(OUT, {recursive:true});
const r={}, fails=[], errors=[]; const check=(name, ok, info)=>{ r[name]=ok?true:(info===undefined?false:info); if(!ok) fails.push(name); };
const shot=(page, name)=>page.screenshot({path:path.join(OUT, name+'.png')});
const addDays=(d,n)=>{ const x=new Date(d+'T12:00:00'); x.setDate(x.getDate()+n); return x.toISOString().slice(0,10); };

async function run(browser){
  const fake = new TF.Fake(); fake.follow = false; // a database with 0013 and without 0014: the lines of v0.36.2 (rm-NF follows the tasks with 0014)
  const UE = fake.user('9b2f6d3e-0000-4000-8000-0000000000e1', 'enric@example.com', 'Enric Vidal'), US = fake.user('9b2f6d3e-0000-4000-8000-0000000000e2', 'susana@example.com', 'Susana Gil'),
    UP = fake.user('9b2f6d3e-0000-4000-8000-0000000000e4', 'pablo@example.com', 'Pablo Ruiz');
  fake.bootstrap(); ['susana@example.com','pablo@example.com'].forEach(email=>fake.members.push({id:'m-'+email, email, name:null, role:'member', quota:52428800, invited:new Date().toISOString(), revoked:null, last_access:null, user_id:null}));
  const dev = o => TF.device(browser, fake, o, PORT, errors);
  const D2=addDays(today(), 2), D5=addDays(today(), 5);
  /* ---------- Three people signed in; Enric and Susana with their keys ---------- */
  const E = await dev({tag:'E', desk:true, user:UE, seed:seed([tk('e1', {title:'Cerrar acta'})], {projects:[{id:'pe', spaceId:'trabajo', name:'FLC', color:'#007AFF', order:0, archived:false, created:TF.T0, modified:TF.T0}]})}); const ep=E.page;
  await signIn(ep, true); await synced(ep); await activate(ep, 'Clave de Enric 2026!'); await ep.evaluate(()=>{ if(document.querySelector('#sheet.on')) closeSheet(); });
  check('E_ready', await until(ep, ()=>!!TM.priv&&SY.status==='ok', null, 20000));
  const S = await dev({tag:'S', dark:true, user:US, seed:seed([tk('s1', {title:'Preparar la demo del lunes', notes:'Revisar el guion\nProbar el proyector', date:D2, priority:'high', estimate:60, deadline:D5}), tk('s2', {title:'Pedir sala'})],
    {subtasks:[{id:'st1', taskId:'s1', title:'Guion', done:true, order:1024, created:TF.T0, modified:TF.T0}, {id:'st2', taskId:'s1', title:'Proyector', done:false, order:2048, created:TF.T0, modified:TF.T0}]})}); const sp=S.page;
  await signIn(sp); await until(sp, ()=>SY.status==='needkey'); await sp.evaluate(()=>{ if(document.querySelector('#sheet.on')) closeSheet(); }); await settled(sp);
  await activate(sp, 'Susana gil #2026x'); await sp.evaluate(()=>{ if(document.querySelector('#sheet.on')) closeSheet(); });
  check('S_ready', await until(sp, ()=>!!TM.priv&&SY.status==='ok', null, 25000), await sp.evaluate(()=>({st:SY.status, tm:TM.state})));
  const P = await dev({tag:'P', user:UP}); const pp=P.page; await signIn(pp); check('P_needkey', await until(pp, ()=>SY.status==='needkey'));
  await sp.evaluate(()=>{ TM.dirAt=0; return syncRun('prueba'); }); await until(sp, ()=>TM.dir.length===3);
  await settled(sp);

  /* ---------- Susana: Avisar a… in the long press menu and in the detail ---------- */
  await sp.evaluate(()=>{ UI.tab='tareas'; DB.settings.filter='todas'; render(); }); await sp.waitForTimeout(400);
  await sp.evaluate(()=>rowMenu('s1', {row:visibleRow('s1'), x:200, y:300})); await until(sp, ()=>!!document.querySelector('.pm.open'));
  const lp = await sp.evaluate(()=>[...document.querySelectorAll('.pm.open .pm-list *')].map(b=>b.textContent.trim()).filter(Boolean));
  check('S_longpress_item', lp.some(t=>t==='Avisar a…'), lp);
  await sp.waitForTimeout(500); await shot(sp, 'av-ip-dark-menu');
  // The lifted row keeps the space between its items (Entrega martes  1 h)
  const gap = await sp.evaluate(()=>{ const ss=[...document.querySelectorAll('.pm-lift .row-meta>span')]; return ss.length>1?parseFloat(getComputedStyle(ss[1]).marginLeft):-1; });
  check('lift_meta_gap', gap>5, gap);
  await sp.evaluate(()=>closeMenu(true)); await settled(sp);
  await sp.evaluate(()=>openDetail('s1')); await sp.waitForTimeout(700);
  const cell = await sp.evaluate(()=>{ const b=document.querySelector('.pushed-screen [data-act=tmNotice]'); return b?b.textContent:null; });
  check('S_detail_cell', cell==='Avisar a…', cell);
  await sp.click('.pushed-screen [data-act=tmNotice]'); await sheetIn(sp);
  const list = await sp.evaluate(()=>[...document.querySelectorAll('#sheet .pprow')].map(b=>({t:b.textContent, off:b.classList.contains('off')})));
  check('S_member_list', list.length===2 && list.some(x=>/^Enric Vidalenric@example\.com$/.test(x.t)&&!x.off) && list.some(x=>/^Pablo RuizTodavía no ha entrado en la app$/.test(x.t)&&x.off) && await sp.evaluate(()=>document.querySelector('#sheet .hbtn.ok').disabled), list);
  await sp.click('#sheet .pprow:not(.off)'); await sp.fill('#sheet [data-role=ntmsg]', 'Lo vemos el lunes a primera hora');
  await shot(sp, 'av-ip-dark-avisar');
  await sp.click('#sheet .hbtn.ok');
  check('S_sent', await until(sp, ()=>!document.querySelector('#sheet.on')&&!!task('s1').sentTo) && fake.notices.length===1, fake.notices);
  const n1 = fake.notices[0];
  check('server_only_cipher', /^t1:[A-Za-z0-9_-]{100,}$/.test(n1.payload) && !/demo|guion|proyector|lunes/i.test(Buffer.from(n1.payload.slice(3),'base64').toString('latin1')) && n1.recipient_id===UE.uid && n1.sender_id===US.uid && n1.task_ref==='s1', n1);
  const sOpen = await sp.evaluate(async v=>{ try{ await teamOpen(v, 'notice'); return 'opened'; }catch(e){ return 'refused'; } }, n1.payload);
  check('sender_cannot_open', sOpen==='refused', sOpen);
  await sp.waitForTimeout(300); const note = await sp.evaluate(()=>{ const b=document.querySelector('.pushed-screen .ntnote'); return b&&b.textContent; });
  check('S_note', /^Avisado a Enric hoy a las \d\d:\d\d: sin respuesta todavía$/.test(note||''), note);
  check('S_note_local', await sp.evaluate(()=>!JSON.stringify(syncToRow('tasks', task('s1'))).includes('sentTo')) && ![...fake.t.tasks.values()].some(x=>JSON.stringify(x).includes('sentTo')));
  await shot(sp, 'av-ip-dark-avisado');
  // The same task to Enric again: the sheet says until when and does not send; the server refuses it too
  await sp.click('.pushed-screen [data-act=tmNotice]'); await sheetIn(sp); await sp.click('#sheet .pprow:not(.off)');
  const soon = await sp.evaluate(()=>({txt:document.querySelector('#sheet .nt-when').textContent, dis:document.querySelector('#sheet .hbtn.ok').disabled}));
  check('S_too_soon_sheet', /^Ya le avisaste de esta tarea hace un momento\. Podrás volver a avisarle a las \d\d:\d\d\.$/.test(soon.txt) && soon.dis, soon);
  await sp.evaluate(()=>closeSheet()); await settled(sp);
  const srv = await sp.evaluate(async to=>{ task('s1').sentTo=[]; return noticeSend('s1', to, ''); }, UE.uid);
  check('S_too_soon_server', srv==='soon' && fake.notices.length===1 && await sp.evaluate(()=>/Ya le avisaste de esta tarea hace poco\. Podrás volver a avisarle a las \d\d:\d\d\./.test(document.getElementById('toastText').textContent)), srv);
  // At most 20 notices an hour per sender (the server's rule): the app says so
  const real = fake.notices.slice(); for(let i=0;i<20;i++) fake.notices.push({id:'cap'+i, sender_id:US.uid, recipient_id:UE.uid, task_ref:'c'+i, payload:'t1:x', created:new Date().toISOString(), taken:new Date().toISOString()});
  const capR = await sp.evaluate(to=>{ task('s2').sentTo=[]; return noticeSend('s2', to, ''); }, UE.uid); const capT = await sp.evaluate(()=>document.getElementById('toastText').textContent);
  fake.notices.length=0; fake.notices.push(...real);
  check('S_cap', capR==='no' && capT==='Has enviado muchos avisos seguidos. Prueba dentro de un rato', {capR, capT});
  // Another task, to discard
  await sp.evaluate(to=>noticeSend('s2', to, ''), UE.uid); check('S_second', fake.notices.length===2);
  /* ---------- Susana's second device (iPhone, light): what she sent, from the server ---------- */
  const S2 = await dev({tag:'S2', user:US}); const s2p=S2.page; await signIn(s2p);
  check('S2_unlocked', await until(s2p, ()=>SY.status==='locked', null, 15000) && await s2p.evaluate(async()=>{ await cryptoUnlock('Susana gil #2026x'); return true; }) && await until(s2p, ()=>SY.status==='ok'&&!!task('s1')&&TM.sent.length===2&&!!TM.priv, null, 20000), await s2p.evaluate(()=>({st:SY.status, sent:TM.sent.length})));
  await s2p.evaluate(()=>{ if(document.querySelector('#sheet.on')) closeSheet(); }); await settled(s2p);
  await s2p.evaluate(()=>openDetail('s1')); await s2p.waitForTimeout(700);
  const l0 = await s2p.evaluate(()=>[...document.querySelectorAll('.pushed-screen .ntnote .ntline')].map(x=>x.textContent));
  check('S2_no_answer_yet', l0.length===1 && /^Avisado a Enric hoy a las \d\d:\d\d: sin respuesta todavía$/.test(l0[0]) && await s2p.evaluate(()=>!(task('s1').sentTo||[]).length), l0);
  check('sent_never_payload', (fake.sentAsked||[]).length>0 && fake.sentAsked.every(c=>/^id,recipient_id,task_ref,created,taken,dismissed(,planned,done)?$/.test(c)), fake.sentAsked);

  /* ---------- Enric: Recibidas ---------- */
  check('E_received', await until(ep, ()=>TM.recv.length===2, null, 10000), await ep.evaluate(()=>TM.recv));
  const side = await ep.evaluate(()=>{ const b=document.querySelector('.side [data-view=received]'); return b&&b.textContent; });
  check('E_sidebar', side==='Recibidas2', side);
  await ep.click('.side [data-view=received]'); await ep.waitForTimeout(400);
  const cards = await ep.evaluate(()=>[...document.querySelectorAll('.recvview .recv')].map(c=>({h:c.querySelector('.rv-h b').textContent, t:c.querySelector('.rv-t').textContent, p:(c.querySelector('.rv-p')||{}).textContent||'', m:(c.querySelector('.rv-m')||{}).textContent||''})));
  check('E_cards', cards.length===2 && cards[0].h==='De Susana' && cards[0].t==='Preparar la demo del lunes' && cards[0].p==='«Lo vemos el lunes a primera hora»' && /Prioridad alta/.test(cards[0].m) && /1 h/.test(cards[0].m) && /2 pasos/.test(cards[0].m) && /Entrega/.test(cards[0].m), cards);
  await hideToast(ep); await shot(ep, 'av-desk-recibidas');
  const id1 = fake.notices[0].id;
  await ep.click('.recv[data-recv="'+id1+'"] [data-act=tmRecvAdd]'); await until(ep, ()=>!!document.querySelector('.pm.open'));
  await ep.evaluate(()=>{ const b=[...document.querySelectorAll('.pm.open *')].find(x=>x.children.length<=2&&/^FLC$/.test(x.textContent.trim())&&x.closest('[role=menuitem], .pm-item, button')); (b.closest('[role=menuitem], .pm-item, button')||b).click(); });
  check('E_added', await until(ep, ()=>DB.tasks.some(x=>x.title==='Preparar la demo del lunes')) && !!fake.notices[0].taken, fake.notices[0]);
  const made = await ep.evaluate(()=>{ const x=DB.tasks.find(t=>t.title==='Preparar la demo del lunes'); return {x, steps:stepsOf(x.id).map(s=>s.title+':'+s.done)}; });
  check('E_task_copy', /^De Susana, \d{1,2} de [a-z]+: «Lo vemos el lunes a primera hora»\n\nRevisar el guion\nProbar el proyector$/.test(made.x.notes) && made.x.date===D2 && made.x.priority==='high' && made.x.estimate===60 && made.x.deadline===D5 && made.x.projectId==='pe' && made.x.spaceId===made.x.spaceId && made.steps.join()==='Guion:true,Proyector:false' && !made.x.sentTo, made);
  check('E_synced_encrypted', await synced(ep) && TF.isEnc(fake.t.tasks.get(made.x.id).title), fake.t.tasks.get(made.x.id));
  // Deshacer: the task goes, the copy comes back (and on the server)
  await ep.click('#toastBtn'); check('E_undo', await until(ep, ()=>!DB.tasks.some(x=>x.title==='Preparar la demo del lunes')&&TM.recv.length===2) && !fake.notices[0].taken);
  await ep.click('.recv[data-recv="'+id1+'"] [data-act=tmRecvAdd]'); await until(ep, ()=>!!document.querySelector('.pm.open'));
  await ep.evaluate(()=>{ const b=[...document.querySelectorAll('.pm.open *')].find(x=>/^Sin proyecto$/.test(x.textContent.trim())&&x.closest('[role=menuitem], .pm-item, button')); (b.closest('[role=menuitem], .pm-item, button')||b).click(); });
  check('E_added_again', await until(ep, ()=>DB.tasks.some(x=>x.title==='Preparar la demo del lunes'&&!x.projectId)&&TM.recv.length===1) && !!fake.notices[0].taken);
  await ep.click('[data-act=tmRecvDrop]'); check('E_dropped', await until(ep, ()=>TM.recv.length===0) && !!fake.notices[1].dismissed && !fake.notices[1].taken);
  await ep.waitForTimeout(400); const empty = await ep.evaluate(()=>document.querySelector('.recvview').textContent);
  check('E_empty', /No hay tareas recibidas/.test(empty), empty);
  await hideToast(ep); await ep.waitForTimeout(300); await shot(ep, 'av-desk-recibidas-vacia');
  check('E_sidebar_zero', await ep.evaluate(()=>{ const b=document.querySelector('.side [data-view=received]'); return b&&b.textContent==='Recibidas0'; }));
  // Susana's second device: what Enric did with each, from the server
  await s2p.evaluate(()=>teamSentFetch(true)); await s2p.waitForTimeout(300);
  const l1 = await s2p.evaluate(()=>{ render(); return {s1:noticeLines(task('s1')), s2:noticeLines(task('s2'))}; });
  check('S2_added_dropped', l1.s1.length===1 && /: la ha añadido a sus tareas$/.test(l1.s1[0]) && l1.s2.length===1 && /: la ha descartado$/.test(l1.s2[0]), l1);
  await s2p.waitForTimeout(400); await shot(s2p, 'av-ip-light-detalle-avisos');
  await s2p.evaluate(()=>{ while(UI.stack.length) pop(); }); await s2p.waitForTimeout(600);
  await s2p.evaluate(()=>noticeSheet('s1')); await sheetIn(s2p);
  const ago = await s2p.evaluate(()=>[...document.querySelectorAll('#sheet .pprow')].map(b=>b.textContent));
  check('S2_sheet_ago', ago.some(t=>/^Enric Vidalenric@example\.comAvisado hace un momento$/.test(t)), ago);
  await s2p.click('#sheet .pprow:not(.off)'); check('S2_sheet_soon', await s2p.evaluate(()=>/^Ya le avisaste de esta tarea/.test(document.querySelector('#sheet .nt-when').textContent)&&document.querySelector('#sheet .hbtn.ok').disabled));
  await shot(s2p, 'av-ip-light-avisar-avisado');
  await s2p.evaluate(()=>closeSheet()); await settled(s2p);
  // Desktop: the context menu and the inspector offer it too
  await ep.evaluate(()=>setDeskView('todas')); await ep.waitForTimeout(300);
  const dm = await ep.evaluate(()=>deskTaskMenu('e1').groups.flat().map(i=>i.label));
  check('E_desk_menu', dm.includes('Avisar a…'), dm);
  await ep.evaluate(()=>openDetail('e1')); await ep.waitForTimeout(500);
  check('E_inspector', await ep.evaluate(()=>!!document.querySelector('.pane [data-act=tmNotice], .inspector [data-act=tmNotice], [data-act=tmNotice]')));
  await shot(ep, 'av-desk-inspector');
  await ep.click('[data-act=tmNotice]'); await sheetIn(ep); await ep.click('#sheet .pprow:not(.off)'); await ep.click('#sheet .hbtn.ok');
  check('E_sent', await until(ep, ()=>!document.querySelector('#sheet.on')) && fake.notices.length===3 && fake.notices[2].recipient_id===US.uid);

  /* ---------- Susana: the line at the top of Hoy and its sheet ---------- */
  await sp.evaluate(()=>{ while(UI.stack.length) pop(); DB.settings.filter='hoy'; render(); });
  check('S_banner', await until(sp, ()=>{ const b=document.querySelector('.recvban'); return b&&b.textContent.trim()==='1 tarea recibida'; }, null, 10000));
  await sp.waitForTimeout(600); await shot(sp, 'av-ip-dark-hoy-recibida');
  await sp.click('.recvban [data-act=tmRecv]'); await sheetIn(sp);
  const sc = await sp.evaluate(()=>[...document.querySelectorAll('#sheet .recv')].map(c=>c.querySelector('.rv-h b').textContent+'|'+c.querySelector('.rv-t').textContent));
  check('S_sheet', sc.join()==='De Enric|Cerrar acta', sc); await shot(sp, 'av-ip-dark-recibidas');
  // Added without a phrase: the origin line alone
  await sp.click('#sheet [data-act=tmRecvAdd]'); await until(sp, ()=>!!document.querySelector('.pm.open'));
  await sp.waitForTimeout(300); await sp.locator('.pm.open .pm-it', {hasText:'Sin proyecto'}).click();
  check('S_added_origin', await until(sp, ()=>DB.tasks.some(x=>x.title==='Cerrar acta')) && await sp.evaluate(()=>/^De Enric, \d{1,2} de [a-z]+$/.test(DB.tasks.find(x=>x.title==='Cerrar acta').notes)) && !!fake.notices[2].taken, await sp.evaluate(()=>(DB.tasks.find(x=>x.title==='Cerrar acta')||{}).notes));
  await sp.evaluate(()=>{ if(document.querySelector('#sheet.on')) closeSheet(); }); await settled(sp);
  // Enric's inspector: what Susana did with it
  await ep.evaluate(()=>teamSentFetch(true)); await ep.evaluate(()=>{ setDeskView('todas'); openDetail('e1'); }); await ep.waitForTimeout(500);
  const il = await ep.evaluate(()=>[...document.querySelectorAll('.intnotes .ntline')].map(x=>x.textContent));
  check('E_inspector_lines', il.length===1 && /^Avisado a Susana hoy a las \d\d:\d\d: la ha añadido a sus tareas$/.test(il[0]), il);
  await hideToast(ep); await shot(ep, 'av-desk-inspector-avisos');
  await ep.click('[data-act=tmNotice]'); await sheetIn(ep); await shot(ep, 'av-desk-avisar-avisado');
  check('E_sheet_ago', await ep.evaluate(()=>[...document.querySelectorAll('#sheet .pprow')].some(b=>/Avisado hace un momento$/.test(b.textContent))));
  await ep.evaluate(()=>closeSheet()); await settled(ep);
  // The server says nothing (no 0013 method answer): this device's own record stands, said once
  const fb = await ep.evaluate(async()=>{ const was=TM.sent; TM.sent=[]; const real=SY.remote.noticeSent; SY.remote.noticeSent=async()=>{ throw new Error('PGRST205'); };
    try{ await teamSentFetch(true); return {lines:noticeLines(task('e1')), logged:LOG.some(e=>/avisos enviados no disponibles/.test(e.m))}; } finally{ SY.remote.noticeSent=real; TM.sent=was; } });
  check('sent_fallback_local', fb.lines.length===1 && /sin respuesta todavía$/.test(fb.lines[0]) && fb.logged, fb);
  // Pablo, without the password, has no key to send or receive with; nobody sees what was not for them
  check('P_nothing', await pp.evaluate(()=>!canNotice({status:'pending'})&&TM.recv.length===0));
  check('noticeList_own', (await sp.evaluate(()=>SY.remote.noticeList(SY.user.id))).length===0 && (await pp.evaluate(uid=>SY.remote.noticeList(uid), UE.uid)).length===0);
  await E.ctx.close(); await S.ctx.close(); await P.ctx.close(); await S2.ctx.close();
  // A single-user setup without 0013: no Recibidas entry at all
  fake.team=false; const UN = fake.user('9b2f6d3e-0000-4000-8000-0000000000f9', 'solo@example.com', 'Solo'); const N = await dev({tag:'N', desk:true, user:UN, seed:seed([tk('n1')])}); const np=N.page;
  await signIn(np, true); check('no_team_no_entry', await until(np, ()=>TM.state==='absent'&&SY.status==='ok', null, 15000) && await np.evaluate(()=>!document.querySelector('.side [data-view=received]')));
  await N.ctx.close(); fake.team=true;
}

(async()=>{
  const srv = await TF.serve(PORT); const browser = await chromium.launch();
  try { await run(browser); } catch(e){ errors.push(e.stack||e.message); }
  await browser.close(); srv.close();
  console.log(JSON.stringify({r, fails, errors}, null, 1)); process.exit(fails.length||errors.length?1:0);
})();
