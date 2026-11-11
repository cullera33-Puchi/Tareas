require('./lib/out.js'); // outputs (screenshots, downloads) go to tests/out
// v0.37.1: the session when the device wakes, realtime after it, and conflicts that were only bookkeeping. Port 8832. Against the team's
// fake (tests/lib/team-fake.js) with tokens that expire (fake.jwt): a request with an expired token runs as anon, as on the real server.
//  1. A session expired while the device slept is refreshed before the pass: no request as anon, no «se comprueba el acceso», the change
//     goes up; the realtime channel is made again with the new token.
//  2. A refusal of the row rules (or «permission denied for function tareas_team_me») while the token had expired: not lost access; the
//     session is refreshed and the pass repeated once, quietly. A 401 «JWT expired» too. A refresh that does not answer: the pass waits.
//  3. A member whose access was really removed still gets «Esta cuenta no tiene acceso».
//  4. Realtime: a channel refused for an expired token gets the new one; normal disconnects are info, at most once a minute; three in a
//     row, or anything else, a warning.
//  5. Two devices that both roll the same tasks over in the morning end with identical tasks and count no conflict; postponed is counted
//     once. Two quick edits of the same task on one device count no conflict.
const { chromium } = require('playwright');
const fs = require('fs'); const path = require('path');
const TF = require('./lib/team-fake.js'); const { until, synced, settled, signIn, tk, seed, today } = TF;
const PORT = 8832, OUT = path.join(__dirname, 'out', 'AU'); fs.mkdirSync(OUT, {recursive:true});
const r={}, fails=[], errors=[]; const check=(name, ok, info)=>{ r[name]=ok?true:(info===undefined?false:info); if(!ok) fails.push(name); };
const logs = (page, re) => page.evaluate(src=>LOG.filter(e=>new RegExp(src).test(e.m)).map(e=>e.l+' '+e.m+(e.x?' '+e.x:'')), re.source);

async function sessionTests(browser){
  const fake = new TF.Fake(); fake.jwt = true;
  const UE = fake.user('9b2f6d3e-0000-4000-8000-0000000000e1', 'enric@example.com', 'Enric Vidal'), US = fake.user('9b2f6d3e-0000-4000-8000-0000000000e2', 'susana@example.com', 'Susana Gil');
  fake.bootstrap(); fake.members.push({id:'m-s', email:'susana@example.com', name:null, role:'member', quota:52428800, invited:new Date().toISOString(), revoked:null, last_access:null, user_id:null});
  const dev = o => TF.device(browser, fake, o, PORT, errors);
  const E = await dev({tag:'E', desk:true, user:UE, seed:seed([tk('a1', {title:'Primera'}), tk('a2', {title:'Segunda'})])}); const ep=E.page;
  await signIn(ep, true); check('E_synced', await synced(ep) && await ep.evaluate(()=>TM.state==='admin'));
  const tok = () => ep.evaluate(()=>JSON.parse(localStorage.getItem('fake-session')).token);
  // The device slept: its token expired 9207 seconds ago, on the device and on the server
  const expire = async () => { const t = await tok(); fake.tokens.set(t, Date.now()-1000); await ep.evaluate(()=>{ const s=JSON.parse(localStorage.getItem('fake-session')); s.exp=Date.now()-9207e3; localStorage.setItem('fake-session', JSON.stringify(s)); }); };
  const mark = () => ep.evaluate(()=>LOG.length);
  const since = (n, re) => ep.evaluate(([n, src])=>LOG.slice(n).filter(e=>new RegExp(src).test(e.m)).map(e=>e.l+' '+e.m), [n, re.source]);

  /* ---------- 1. Expired at resume: refreshed before the pass ---------- */
  await expire(); const t0 = await tok(), r0 = fake.refreshes, a0 = fake.anonCalls.length, s0 = fake.subTokens.length, n0 = await mark();
  await ep.evaluate(()=>{ updTask('a1', {title:'Primera, cambiada al volver'}); return syncRun('vuelta'); }); await synced(ep);
  const t1 = await tok();
  check('resume_refreshed_first', fake.refreshes===r0+1 && fake.anonCalls.length===a0 && t1!==t0 && (await since(n0, /Sesión renovada antes de sincronizar/)).length===1
    && !(await since(n0, /se comprueba el acceso|Sincronización falló/)).length && fake.t.tasks.get('a1').title==='Primera, cambiada al volver', {refreshes:fake.refreshes-r0, anon:fake.anonCalls.slice(a0), log:await since(n0, /./)});
  check('resume_channel_new_token', await until(ep, ()=>true) && fake.subTokens.length>s0 && fake.subTokens[fake.subTokens.length-1]===t1, {subs:fake.subTokens.slice(s0), t1});

  /* ---------- 2. A refusal while the token had expired (a race with the refresh): not lost access, refreshed and repeated once ---------- */
  const race = () => ep.evaluate(()=>{ const real=SY.remote.ensureSession; let n=0; SY.remote.ensureSession=async function(f){ if(n++===0) return 'ok'; SY.remote.ensureSession=real; return real.call(this, f); }; });
  await expire(); await race(); const a1 = fake.anonCalls.length, n1 = await mark();
  await ep.evaluate(()=>{ updTask('a2', {title:'Segunda, con la sesión caducada'}); return syncRun('cambio'); }); await synced(ep);
  check('rls_expired_retried', fake.anonCalls.slice(a1).some(c=>/upsert/.test(c)) && fake.t.tasks.get('a2').title==='Segunda, con la sesión caducada' && await ep.evaluate(()=>TM.state==='admin'&&!document.getElementById('noaccess')&&SY.status==='ok')
    && (await since(n1, /la sesión había caducado/)).length===1 && !(await since(n1, /se comprueba el acceso|Sincronización falló|tiene acceso/)).length, {anon:fake.anonCalls.slice(a1), log:await since(n1, /./)});
  // The access check itself as anon: «permission denied for function tareas_team_me»
  await expire(); await race(); const a2 = fake.anonCalls.length, n2 = await mark();
  await ep.evaluate(()=>{ TM.force=true; return syncRun('vuelta'); }); await synced(ep);
  check('team_me_anon_retried', fake.anonCalls.slice(a2).some(c=>/teamMe/.test(c)) && await ep.evaluate(()=>TM.state==='admin'&&!document.getElementById('noaccess')) && !(await since(n2, /Sincronización falló|tiene acceso/)).length, {anon:fake.anonCalls.slice(a2), log:await since(n2, /./)});
  // A token the server no longer takes while the device thinks it is fresh: 401 «JWT expired»
  fake.jwt401 = true; fake.tokens.set(await tok(), Date.now()-1000); const n3 = await mark();
  await ep.evaluate(()=>{ updTask('a1', {title:'Primera, tras un 401'}); return syncRun('cambio'); }); await synced(ep); fake.jwt401 = false;
  check('jwt_401_retried', fake.t.tasks.get('a1').title==='Primera, tras un 401' && (await since(n3, /la sesión había caducado/)).length===1 && !(await since(n3, /Sincronización falló/)).length, await since(n3, /./));
  // A refresh that does not answer (the network just after waking): the pass waits, nothing goes as anon; it goes once the refresh works
  await expire(); fake.refreshFail = 1; const a4 = fake.anonCalls.length, n4 = await mark();
  await ep.evaluate(()=>{ updTask('a2', {title:'Segunda, sin red al despertar'}); return syncRun('vuelta'); });
  const waited = await ep.evaluate(()=>({st:SY.status, err:SY.error}));
  await ep.evaluate(()=>syncRun('reintento')); await synced(ep);
  check('refresh_fail_waits', waited.st==='offline' && fake.anonCalls.length===a4 && (await since(n4, /en espera/)).length===1 && fake.t.tasks.get('a2').title==='Segunda, sin red al despertar', {waited, anon:fake.anonCalls.slice(a4), log:await since(n4, /./)});

  /* ---------- 3. Real removal of access: still the full screen ---------- */
  const S = await dev({tag:'S', user:US}); const sp=S.page; await signIn(sp); await until(sp, ()=>SY.status==='needkey', null, 15000);
  fake.members.find(m=>m.email==='susana@example.com').revoked = new Date().toISOString();
  await sp.evaluate(()=>{ if(document.querySelector('#sheet.on')) closeSheet(); TM.force=true; return syncRun('equipo'); });
  check('revoked_denied', await until(sp, ()=>TM.state==='denied'&&!!document.getElementById('noaccess')&&/Esta cuenta no tiene acceso/.test(document.getElementById('noaccess').textContent), null, 10000));
  await S.ctx.close();

  /* ---------- 4. Realtime ---------- */
  // A channel refused for an expired token: refreshed, and made again with the new token
  await expire(); const s5 = fake.subTokens.length, n5 = await mark();
  await ep.evaluate(()=>{ SY.rtFails=0; SY.rtInfoAt=0; SY.rtWarnAt=0; window.__fakeRTStatus('CHANNEL_ERROR', {message:'InvalidJWTToken: Token has expired 9207 seconds ago'}); });
  const t5 = await (async()=>{ for(let i=0;i<50;i++){ if(fake.subTokens.length>s5) break; await new Promise(r=>setTimeout(r,100)); } return tok(); })();
  check('rt_token_healed', fake.subTokens.length>s5 && fake.subTokens[fake.subTokens.length-1]===t5 && fake.tokens.get(t5)>Date.now() && (await since(n5, /canal de nuevo/)).length===1
    && !(await since(n5, /Tiempo real/)).some(l=>/^warn/.test(l)), {subs:fake.subTokens.slice(s5), t5, log:await since(n5, /Tiempo real/)});
  // Normal disconnects: info, at most once a minute; the third in a row is a warning; anything else is a warning
  const n6 = await mark();
  await ep.evaluate(()=>{ SY.rtFails=0; SY.rtInfoAt=0; SY.rtWarnAt=0; window.__fakeRTStatus('CHANNEL_ERROR', {message:'socket closed 1006'}); window.__fakeRTStatus('TIMED_OUT'); });
  const l6 = await since(n6, /Tiempo real/);
  await ep.evaluate(()=>{ window.__fakeRTStatus('CHANNEL_ERROR', {message:'socket closed 1001 (No channels joined)'}); });
  const l7 = await since(n6, /Tiempo real/);
  await ep.evaluate(()=>{ window.__fakeRTStatus('SUBSCRIBED'); SY.rtWarnAt=0; window.__fakeRTStatus('CHANNEL_ERROR', {message:'unexpected payload'}); });
  const l8 = await since(n6, /Tiempo real/);
  check('rt_log_levels', l6.length===1 && /^info Tiempo real: CHANNEL_ERROR socket closed 1006$/.test(l6[0]) && l7.length===2 && /^warn .*1001.*3 fallos seguidos/.test(l7[1])
    && l8.length===3 && /^warn Tiempo real: CHANNEL_ERROR unexpected payload$/.test(l8[2]), {l6, l7, l8});
  /* ---------- The real adapter's check (supabaseRemote.ensureSession) against a stand-in client ---------- */
  const unit = await ep.evaluate(async()=>{ const was=window.supabase, now=()=>Math.floor(Date.now()/1000), out={}, setAuth=[];
    let sess=null, getErr=null, refresh=null;
    window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:sess}, error:getErr}), refreshSession:async()=>refresh(), onAuthStateChange(){}}, realtime:{setAuth:t=>{ setAuth.push(t); }}})};
    try{ const R=supabaseRemote({url:'https://x.supabase.co', anonKey:'k'}); sess={access_token:'a1', expires_at:now()+3600}; await R.init();
      out.fresh=await R.ensureSession();
      sess={access_token:'a1', expires_at:now()-9207}; refresh=async()=>({data:{session:{access_token:'a2', expires_at:now()+3600}}, error:null}); out.expired=await R.ensureSession(); out.setAuth=setAuth.slice();
      // getSession refreshed it by itself: the token it returns replaced one that had expired
      // (the last check saw a token about to expire; the device slept; getSession came back with another one)
      sess={access_token:'a5', expires_at:now()+62}; out.near=await R.ensureSession(); await new Promise(r=>setTimeout(r, 2500));
      sess={access_token:'a3', expires_at:now()+3600}; refresh=async()=>({data:{session:null}, error:{name:'AuthRetryableFetchError', message:'Failed to fetch'}});
      out.bySelf=await R.ensureSession(); out.setAuth2=setAuth.slice();
      // an ordinary hourly refresh while the app was open is not a wake-up
      sess={access_token:'a7', expires_at:now()+3600}; out.hourly=await R.ensureSession();
      sess=null; getErr={name:'AuthRetryableFetchError', message:'Failed to fetch'}; out.netFail=await R.ensureSession();
      getErr=null; sess=null; out.none=await R.ensureSession();
      sess={access_token:'a4', expires_at:now()-5}; refresh=async()=>({data:{session:null}, error:{name:'AuthApiError', message:'Invalid Refresh Token: Refresh Token Not Found'}}); out.badRefresh=await R.ensureSession();
      localStorage.setItem('tareas-auth', JSON.stringify({access_token:'z', expires_at:now()+30})); out.stSoon=await R.sessionState();
      localStorage.setItem('tareas-auth', JSON.stringify({access_token:'z', expires_at:now()+3600})); out.stFresh=await R.sessionState(); localStorage.removeItem('tareas-auth'); out.stNone=await R.sessionState();
    } finally{ window.supabase=was; } return out; });
  check('adapter_ensure_session', unit.fresh==='ok' && unit.expired==='refreshed' && unit.setAuth.includes('a2') && unit.near==='ok' && unit.bySelf==='refreshed' && unit.setAuth2.includes('a3') && unit.hourly==='ok' && unit.netFail==='failed' && unit.none==='none' && unit.badRefresh==='none'
    && unit.stSoon==='expired' && unit.stFresh==='fresh' && unit.stNone==='none', unit);
  await E.ctx.close();
}

/* ---------- 5. Conflicts that were only bookkeeping ---------- */
async function conflictTests(browser){
  const fake = new TF.Fake(); fake.team = false; const U = fake.user('9b2f6d3e-0000-4000-8000-0000000000f1', 'enric@example.com', 'Enric');
  const t = today(), y = (()=>{ const d=new Date(t+'T12:00:00'); d.setDate(d.getDate()-1); return d.toISOString().slice(0,10); })();
  const M = y+'T09:00:00.000Z', at = (d, hm) => new Date(d+'T'+hm+':00').toISOString();
  const tasks = [tk('t1', {date:y, modified:M, created:M}), tk('t2', {date:y, reminder:at(y,'07:30'), reminderSent:at(y,'07:30'), modified:M, created:M}),
    tk('t3', {date:y, reminder:at(y,'10:00'), modified:M, created:M}), tk('t4', {date:y, repeat:'D1@'+y+'#abcd1234;s', modified:M, created:M}),
    tk('t5', {date:y, deadline:t, postponed:2, carriedSince:y, modified:M, created:M})];
  const mk = async tag => { const ctx = await browser.newContext({viewport:{width:1280, height:800}}); const page = await ctx.newPage(); fake.tags.set(page, tag);
    page.on('pageerror', e=>errors.push(tag+' pageerror: '+e.message)); page.on('console', m=>{ if(m.type()==='error'&&!/Failed to fetch/.test(m.text())) errors.push(tag+' console: '+m.text()); });
    await page.clock.install({time:new Date(y+'T18:00:00')});
    await page.exposeBinding('fakeServer', (src, op, a)=>fake.handle(src.page, op, a)); await page.addInitScript(TF.fakeAdapter); await page.addInitScript(u=>{ window.__fakeUser=u; }, U);
    await page.addInitScript(s=>{ if(!localStorage.getItem('tareas-v1')) localStorage.setItem('tareas-v1', s); }, JSON.stringify(seed(tasks)));
    await page.goto('http://localhost:'+PORT+'/'); await page.waitForTimeout(800); return {ctx, page}; };
  const A = await mk('A'), B = await mk('B'); const ap=A.page, bp=B.page;
  await signIn(ap, true); await synced(ap); await signIn(bp, true); await synced(bp);
  const passes = p => p.evaluate(()=>LOG.filter(e=>/^Sincronización \(/.test(e.m)).map(e=>JSON.parse(e.x||'{}')));
  const before = (await passes(bp)).length;
  // The iPhone rolls over at 7:00, the desktop when it wakes at 8:06 (a reminder at 7:30 is already past on both)
  await ap.clock.setSystemTime(new Date(t+'T07:00:00')); await ap.evaluate(()=>{ rollOver(); return syncRun('vuelta'); }); await synced(ap);
  await bp.clock.setSystemTime(new Date(t+'T08:06:00')); await bp.evaluate(()=>{ rollOver(); return syncRun('vuelta'); }); await synced(bp);
  await ap.evaluate(()=>syncRun('prueba')); await synced(ap);
  const show = p => p.evaluate(()=>DB.tasks.map(x=>({id:x.id, date:x.date, carried:!!x.carried, postponed:x.postponed||null, cs:x.carriedSince||null, rem:x.reminder||null, rs:x.reminderSent||null, rep:x.repeat||null, dl:x.deadline||null, mod:x.modified})).sort((a,b)=>a.id<b.id?-1:1));
  const a = await show(ap), b = await show(bp), bPasses = (await passes(bp)).slice(before), aPasses = (await passes(ap));
  check('rollover_identical', JSON.stringify(a)===JSON.stringify(b) && a.every(x=>x.date===t) && a.every(x=>x.mod===M), {a, b});
  check('rollover_no_conflict', bPasses.length>0 && bPasses.every(p=>!p.conflictos) && aPasses.every(p=>!p.conflictos), {bPasses, aPasses});
  check('rollover_postponed_once', a.find(x=>x.id==='t1').postponed===1 && a.find(x=>x.id==='t5').postponed===3 && a.find(x=>x.id==='t1').cs===y && a.find(x=>x.id==='t2').rs===at(t,'07:30') && a.find(x=>x.id==='t3').rem===at(t,'10:00') && a.find(x=>x.id==='t3').rs===null, a);
  // Two quick edits of the same task on one device: the second pass pulls the first upload again (the pull overlaps), no conflict
  const p0 = (await passes(ap)).length;
  await ap.evaluate(()=>{ updTask('t1', {date:addDays(todayStr(), 2)}); return syncRun('cambio'); }); await synced(ap);
  await ap.evaluate(()=>{ updTask('t1', {priority:'high'}); return syncRun('cambio'); }); await synced(ap);
  const quick = (await passes(ap)).slice(p0);
  check('own_edits_no_conflict', quick.length===2 && quick.every(p=>!p.conflictos&&p.enviadas===1) && fake.t.tasks.get('t1').priority==='high', quick);
  // A real conflict is still counted, and the newer copy still wins
  await bp.evaluate(()=>syncRun('prueba')); await synced(bp);
  await ap.evaluate(()=>{ updTask('t3', {title:'Desde el iPhone'}); return syncRun('cambio'); }); await synced(ap);
  await bp.clock.setSystemTime(new Date(Date.now()+60e3)); const q0 = (await passes(bp)).length;
  await bp.evaluate(()=>{ SY.quiet=true; try{ updTask('t3', {title:'Desde el ordenador, después'}); } finally{ SY.quiet=false; } return syncRun('cambio'); }); await synced(bp);
  const real = (await passes(bp)).slice(q0);
  check('real_conflict_counted', real.some(p=>p.conflictos===1) && fake.t.tasks.get('t3').title==='Desde el ordenador, después', {real, srv:fake.t.tasks.get('t3').title});
  await A.ctx.close(); await B.ctx.close();
}

(async()=>{
  const srv = await TF.serve(PORT); const browser = await chromium.launch();
  try { await sessionTests(browser); } catch(e){ errors.push('session: '+(e.stack||e.message)); }
  try { await conflictTests(browser); } catch(e){ errors.push('conflicts: '+(e.stack||e.message)); }
  await browser.close(); srv.close();
  console.log(JSON.stringify({r, fails, errors}, null, 1)); process.exit(fails.length||errors.length?1:0);
})();
