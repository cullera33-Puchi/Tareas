require('./lib/out.js'); // outputs (screenshots, downloads) go to tests/out
// Decision 63c and d: the storage quota, and the suggestions and incidents. Port 8818 (8810 to 8829 reserved for the team). Screenshots in
// tests/out/TM (qt-*). Against the team's fake server (tests/lib/team-fake.js), whose Storage refuses a file that would pass the quota.
//  Quota: Susana (member, iPhone, light) with 1 MB: photos go up until the next one would not fit; it waits on the device with «No queda
//  espacio. Borra adjuntos o pide más al administrador» once, the note under Adjuntos says so, Ajustes says «Almacenamiento: N de 1 MB»
//  in orange, a new photo or recording is refused at once; the server refused nothing the app tried; the admin raises the quota and the
//  waiting file goes up. The admin has no limit.
//  Feedback: Susana sends an incident with the app's log ticked; what the server keeps is a 't1:' copy for the admin's key only (not hers),
//  with nothing of the text, version or log in clear; Susana cannot list it; Enric (desktop) sees «Sugerencias e incidencias: 1 nueva»,
//  opens it (vista), reads the text, version, device and log, marks it resuelta. A suggestion has no log choice.
const { chromium } = require('playwright');
const fs = require('fs'); const path = require('path');
const TF = require('./lib/team-fake.js'); const { until, synced, settled, sheetIn, toSettings, signIn, activate, hideToast, tk, seed } = TF;
const PORT = 8818, OUT = path.join(__dirname, 'out', 'TM'); fs.mkdirSync(OUT, {recursive:true});
const r={}, fails=[], errors=[]; const check=(name, ok, info)=>{ r[name]=ok?true:(info===undefined?false:info); if(!ok) fails.push(name); };
const shot=(page, name)=>page.screenshot({path:path.join(OUT, name+'.png')});

async function run(browser){
  const fake = new TF.Fake();
  const UE = fake.user('9b2f6d3e-0000-4000-8000-0000000000e1', 'enric@example.com', 'Enric Vidal'), US = fake.user('9b2f6d3e-0000-4000-8000-0000000000e2', 'susana@example.com', 'Susana Gil');
  fake.bootstrap(); fake.members.push({id:'m-s', email:'susana@example.com', name:'Susana Gil', role:'member', quota:1048576, invited:new Date().toISOString(), revoked:null, last_access:null, user_id:null});
  const dev = o => TF.device(browser, fake, o, PORT, errors);
  const E = await dev({tag:'E', desk:true, user:UE, seed:seed([tk('e1', {title:'Revisar'})])}); const ep=E.page;
  await signIn(ep, true); await synced(ep); await activate(ep, 'Clave de Enric 2026!'); await ep.evaluate(()=>{ if(document.querySelector('#sheet.on')) closeSheet(); });
  check('E_ready', await until(ep, ()=>!!TM.priv&&SY.status==='ok', null, 20000));
  const S = await dev({tag:'S', user:US, seed:seed([tk('s1', {title:'Fotos de la obra'})])}); const sp=S.page;
  await signIn(sp); await until(sp, ()=>SY.status==='needkey'); await sp.evaluate(()=>{ if(document.querySelector('#sheet.on')) closeSheet(); }); await settled(sp);
  await activate(sp, 'Susana gil #2026x'); await sp.evaluate(()=>{ if(document.querySelector('#sheet.on')) closeSheet(); });
  check('S_ready', await until(sp, ()=>!!TM.priv&&SY.status==='ok', null, 25000) && await sp.evaluate(()=>TM.me.quota===1048576));
  await settled(sp);

  /* ---------- Quota ---------- */
  // Three «photos» of 400 KB as the app keeps them (the processing of a real photo is rm-AT's): two fit in 1 MB, the third waits
  const addFake = (page, id) => page.evaluate(async id=>{ const b=new Blob([new Uint8Array(400*1024).fill(7)], {type:'image/jpeg'}), now=new Date().toISOString();
    await FS.putFile(id, b, {pending:true, thumb:b}); DB.attachments.push({id, taskId:'s1', kind:'photo', path:null, mime:'image/jpeg', size:b.size, width:10, height:10, durationMs:null, created:now, modified:now}); save(); attFlushSoon(0); }, id);
  await addFake(sp, 'ph1'); await addFake(sp, 'ph2');
  check('two_up', await until(sp, ()=>DB.attachments.filter(a=>a.path).length===2, null, 15000) && fake.store.size===2, [...fake.store.keys()]);
  await addFake(sp, 'ph3');
  check('third_waits', await until(sp, ()=>TM.noSpace&&!UQ.running, null, 10000) && await sp.evaluate(()=>!att('ph3').path) && !fake.refusedUploads && fake.store.size===2, {refused:fake.refusedUploads, n:fake.store.size});
  const toast1 = await sp.evaluate(()=>document.getElementById('toastText').textContent);
  check('no_space_toast', toast1==='No queda espacio. Borra adjuntos o pide más al administrador', toast1);
  await sp.evaluate(()=>openDetail('s1')); await sp.waitForTimeout(700);
  const note = await sp.evaluate(()=>{ const n=document.querySelector('.pushed-screen .att-note'); return n&&n.textContent; });
  check('att_note', note==='No queda espacio en tu cuenta: 1 adjunto espera en este iPhone. Borra adjuntos o pide más al administrador.', note);
  await hideToast(sp); await sp.evaluate(()=>document.querySelector('.pushed-screen .att-group').scrollIntoView({block:'center'})); await sp.waitForTimeout(200); await shot(sp, 'qt-ip-light-sin-espacio');
  // A new photo: refused at once (the picker never opens)
  await sp.evaluate(()=>{ TM.used0=TM.me.used; TM.me.used=TM.me.quota; }); await sp.click('.pushed-screen [data-act=attPhoto]');
  check('photo_refused', await until(sp, ()=>document.getElementById('toastText').textContent==='No queda espacio. Borra adjuntos o pide más al administrador'&&!document.getElementById('attFile')), null);
  await sp.evaluate(()=>{ TM.me.used=TM.used0; });
  await sp.evaluate(()=>{ while(UI.stack.length) pop(); }); await toSettings(sp);
  // The count is the larger of the server's and this device's uploads (an answer on its way never lowers it): wait for the real value
  const stCell = ()=>{ const c=[...document.querySelectorAll('.team-acc .cell')].find(x=>/^Almacenamiento/.test(x.textContent)); if(!c) return null; c.scrollIntoView({block:'center'}); return {t:c.textContent, warn:!!c.querySelector('.val.warn')}; };
  await until(sp, ()=>{ const c=[...document.querySelectorAll('.team-acc .cell')].find(x=>/^Almacenamiento/.test(x.textContent)); return !!c&&c.textContent==='Almacenamiento0,8 MB de 1 MB'; }, null, 8000);
  const st = await sp.evaluate(stCell);
  check('settings_storage', st && st.t==='Almacenamiento0,8 MB de 1 MB' && st.warn, st);
  // A server answer that left before the last upload ended never lowers the count
  const kept = await sp.evaluate(async()=>{ const real=SY.remote.teamMe; SY.remote.teamMe=async()=>{ const r=await real(); r.used=409600; TM.upAt=Date.now(); return r; }; try{ TM.force=true; await teamFetch(SY.user); } finally{ SY.remote.teamMe=real; } return TM.me.used; });
  check('used_never_lowered_by_late_answer', kept===819200, kept);
  await sp.waitForTimeout(200); await shot(sp, 'qt-ip-light-almacenamiento');
  // The admin raises the quota: the file waiting goes up
  fake.members.find(m=>m.id==='m-s').quota=5*1048576; await sp.evaluate(()=>{ TM.force=true; return syncRun('prueba'); }); await sp.evaluate(()=>attFlushSoon(0));
  check('after_raise', await until(sp, ()=>!!att('ph3').path, null, 15000) && fake.store.size===3 && await sp.evaluate(()=>TM.me.quota===5242880), [...fake.store.keys()]);
  // The server's own refusal (another device filled it meanwhile): the file waits, the quota is read again
  fake.members.find(m=>m.id==='m-s').quota=1300000; await sp.evaluate(()=>{ TM.me.quota=null; TM.noSpace=false; }); await addFake(sp, 'ph4');
  check('server_refusal', await until(sp, ()=>TM.noSpace&&TM.me.quota===1300000, null, 15000) && await sp.evaluate(()=>!att('ph4').path) && fake.refusedUploads>=1, {refused:fake.refusedUploads});
  // The admin has no limit
  check('admin_unlimited', await ep.evaluate(()=>TM.me.quota===null&&!teamFull(1e12)));

  /* ---------- Sugerencia o incidencia ---------- */
  await sp.evaluate(()=>{ TM.dirAt=0; }); await sp.evaluate(()=>syncRun('prueba')); await until(sp, ()=>TM.dir.some(m=>m.admin&&m.pub));
  await sp.click('[data-act=tmFeedback]'); await sheetIn(sp);
  const fb0 = await sp.evaluate(()=>({log:document.querySelector('#sheet .fblog').hidden, seg:[...document.querySelectorAll('#sheet .fbseg button')].map(b=>b.textContent).join()}));
  await sp.click('#sheet [data-k=incidencia]');
  const fb1 = await sp.evaluate(()=>document.querySelector('#sheet .fblog').hidden);
  check('feedback_sheet', fb0.log===true && fb0.seg==='Sugerencia,Incidencia' && fb1===false, {fb0, fb1});
  await sp.fill('#sheet [data-role=fbtext]', 'Al pasar la tarea a mañana desaparece el recordatorio'); await sp.check('#sheet [data-role=fblog]');
  await shot(sp, 'qt-ip-light-incidencia');
  await sp.click('#sheet .hbtn.ok');
  check('feedback_sent', await until(sp, ()=>!document.querySelector('#sheet.on')) && fake.feedback.length===1, fake.feedback);
  const f = fake.feedback[0], raw = Buffer.from(f.payload.slice(3), 'base64').toString('latin1');
  check('feedback_cipher', /^t1:/.test(f.payload) && f.kind==='incidencia' && f.recipient_id===UE.uid && !/recordatorio|Inicio v|v0\.\d|Chrome|susana/i.test(raw), {kind:f.kind, len:f.payload.length});
  const sOpen = await sp.evaluate(async v=>{ try{ await teamOpen(v, 'feedback'); return 'opened'; }catch(e){ return 'refused'; } }, f.payload);
  const sList = await sp.evaluate(()=>SY.remote.feedbackList());
  check('feedback_only_admin', sOpen==='refused' && Array.isArray(sList) && sList.length===0, {sOpen, sList});
  // Enric reads it
  await toSettings(ep, true); await ep.evaluate(()=>teamListLoad(true)); await until(ep, ()=>(TM.inbox||[]).length===1&&!!TM.inbox[0].body);
  await ep.waitForTimeout(300);
  const cellE = await ep.evaluate(()=>{ const c=document.querySelector('[data-act=tmInbox]'); return c&&c.textContent; });
  check('admin_cell', cellE==='Sugerencias e incidencias1 nueva', cellE);
  await ep.click('[data-act=tmInbox]'); await sheetIn(ep); await shot(ep, 'qt-desk-buzon');
  await ep.click('#sheet [data-fb]'); await until(ep, ()=>!!document.querySelector('#sheet .fbone'));
  const one = await ep.evaluate(()=>({t:document.querySelector('#sheet .fb-t').textContent, m:document.querySelector('#sheet .fb-m').textContent, log:document.querySelector('#sheet .fb-log pre').textContent}));
  check('admin_reads', one.t==='Al pasar la tarea a mañana desaparece el recordatorio' && /^v\d+\.\d+\.\d+, \w+, \w+, 390 x 844$/.test(one.m) && /Inicio v/.test(one.log), one);
  check('marked_vista', await until(ep, ()=>true) && fake.feedback[0].status==='vista');
  await ep.evaluate(()=>{ document.querySelector('#sheet .fb-log').open=true; }); await ep.waitForTimeout(250); await shot(ep, 'qt-desk-incidencia');
  await ep.click('#sheet [data-st=resuelta]'); check('marked_resuelta', await until(ep, ()=>!!document.querySelector('#sheet [data-st=vista]')) && fake.feedback[0].status==='resuelta');
  await ep.evaluate(()=>closeSheet()); await settled(ep);
  // A suggestion: no log; the admin cannot send to himself (no entry for him)
  await sp.evaluate(()=>feedbackSend('sugerencia', 'Poder ordenar los pasos por fecha', false)); check('suggestion', fake.feedback.length===2 && fake.feedback[1].kind==='sugerencia');
  check('admin_no_send', await ep.evaluate(()=>!/tmFeedback/.test(teamSectionHTML('este dispositivo'))));
  await E.ctx.close(); await S.ctx.close();
}

(async()=>{
  const srv = await TF.serve(PORT); const browser = await chromium.launch();
  try { await run(browser); } catch(e){ errors.push(e.stack||e.message); }
  await browser.close(); srv.close();
  console.log(JSON.stringify({r, fails, errors}, null, 1)); process.exit(fails.length||errors.length?1:0);
})();
