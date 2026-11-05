require('./lib/out.js'); // outputs (screenshots, downloads) go to tests/out
// Block 8 (Supabase sync), port 9610. Two "devices" (separate browser contexts and storage) against an in-memory fake server that
// reproduces the SQL of supabase/migrations/0001_init.sql: server_ts set on every write (one per request, as now() per transaction),
// the "newest modified wins" trigger (older updates skipped and left out of the answer), owner kept, per-owner rows (RLS),
// soft deletes and realtime events to every subscriber of the owner. The fake goes in through the app's remote adapter
// (window.__tareasRemote); nothing reaches the network. Also: the app without config, the account UI on iPhone and desktop,
// pull to refresh, and the vendored supabase-js (createClient, request shapes and the ?code= cleanup) with every request intercepted.
const { chromium } = require('playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = path.resolve(__dirname, '..'), PORT = 9610, URL0 = 'http://localhost:'+PORT+'/';
const OUT = path.join(__dirname, 'out', 'S'); fs.mkdirSync(OUT, {recursive:true});
const TYPES = {'.html':'text/html','.css':'text/css','.js':'application/javascript','.webmanifest':'application/manifest+json','.png':'image/png'};
const served = [];
// config.js is always missing here (as in a deploy without it): the fake comes in through the adapter, not the config.
// regress.sh writes a local config.js with nulls for the other tests; this server never serves it
const missing = [];
const srv = http.createServer((req,res)=>{ let p = decodeURIComponent(req.url.split('?')[0]); served.push(p); if(p==='/') p='/index.html'; const f=path.join(ROOT,p);
  if(p==='/config.js'||!fs.existsSync(f)){ missing.push(p); res.writeHead(404,{'Content-Type':'text/html'}); res.end('<h1>404</h1>'); return; }
  if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){ res.writeHead(404,{'Content-Type':'text/html'}); res.end('<h1>404</h1>'); return; }
  res.writeHead(200,{'Content-Type':TYPES[path.extname(f)]||'application/octet-stream'}); res.end(fs.readFileSync(f)); });

/* ---------- Fake server ---------- */
// Updated by decision 29 (attachments): the app syncs a fifth table, so the fake server has it too (0003_attachments.sql)
const TABLES = ['spaces','projects','tasks','voice_notes','attachments','subtasks','project_notes','contacts']; // decisions 46 and 47: the app syncs the steps and the project notes too (0005, 0006)
const COLS = { spaces:['name','sort_order','members'], projects:['space_id','name','color','sort_order','archived'],
  tasks:['space_id','project_id','title','date','reminder','priority','status','notes','carried','assignees','completed'], voice_notes:['task_id','text'],
  attachments:['task_id','kind','path','mime','size','width','height','duration_ms','purged'], subtasks:['task_id','title','done','sort_order'], project_notes:['project_id','title','body','pinned'], contacts:['name','email','phone'] };
class Fake {
  constructor(){ this.t={}; TABLES.forEach(x=>this.t[x]=new Map()); this.last=0; this.subs=new Map(); this.muted=new Set(); this.down=new Set(); this.calls=[]; }
  ts(){ this.last=Math.max(Date.now(), this.last+1); return new Date(this.last).toISOString(); } // one per request: now() of its transaction
  write(owner, table, rows){ if(!owner) throw new Error('JWT required'); const ts=this.ts(), out=[], changed=[];
    const m=this.t[table]; // validate the whole statement first: a failing row fails the request (one transaction)
    rows.forEach(r=>{ if(!r.id) throw new Error('null id'); if(!r.modified) throw new Error('null value in column "modified"');
      if(r.priority!=null && !['high','mid','none'].includes(r.priority)) throw new Error('violates check constraint priority');
      if(r.status!=null && !['pending','done'].includes(r.status)) throw new Error('violates check constraint status');
      const ex=m.get(r.id); if(ex && ex.owner_id!==owner) throw new Error('new row violates row-level security policy'); });
    rows.forEach(r=>{ const ex=m.get(r.id);
      if(!ex){ const row={id:r.id, owner_id:owner}; COLS[table].forEach(c=>row[c]=(c==='members'||c==='assignees')?[]:null); Object.assign(row,{created:null, deleted:null}, r, {owner_id:owner, server_ts:ts}); m.set(r.id,row); out.push({id:r.id}); changed.push(row); return; }
      if(Date.parse(r.modified) < Date.parse(ex.modified)) return; // trigger: RETURN NULL, the row is skipped
      Object.assign(ex, r, {owner_id:ex.owner_id, server_ts:ts}); out.push({id:r.id}); changed.push(ex); });
    changed.forEach(row=>this.notify(table, row)); return out; }
  notify(table, row){ const copy=JSON.parse(JSON.stringify(row));
    for(const [page, uid] of this.subs){ if(uid!==row.owner_id || this.muted.has(page) || this.down.has(page)) continue;
      setTimeout(()=>{ page.evaluate(([t,r])=>window.__fakeRT&&window.__fakeRT(t,r), [table, copy]).catch(()=>{}); }, 40); } }
  rows(owner, table){ return [...this.t[table].values()].filter(r=>r.owner_id===owner); }
  handle(page, op, a){ this.calls.push(op); if(this.down.has(page) && op!=='signIn') throw new Error('Failed to fetch');
    const own=a&&a.owner;
    switch(op){
      case 'signIn': return {id:a.uid, email:a.email};
      case 'pull': { let rs=this.rows(own, a.table); if(a.after) rs=rs.filter(r=>Date.parse(r.server_ts)>Date.parse(a.after));
        rs.sort((x,y)=>x.server_ts<y.server_ts?-1:x.server_ts>y.server_ts?1:x.id<y.id?-1:1); return JSON.parse(JSON.stringify(rs.slice(0,a.limit))); }
      case 'byIds': return JSON.parse(JSON.stringify(this.rows(own, a.table).filter(r=>a.ids.includes(r.id))));
      case 'upsert': return this.write(own, a.table, a.rows);
      case 'markDeleted': return this.write(own, a.table, a.items.map(x=>({id:x.id, deleted:x.ts, modified:x.ts})));
      case 'subscribe': this.subs.set(page, a.uid); return true;
      case 'unsubscribe': this.subs.delete(page); return true;
    } throw new Error('op '+op); }
}
const fake = new Fake();
const USER = {uid:'9b2f6d3e-0000-4000-8000-00000000e001', email:'enric@example.com'};
// The adapter the app sees: same methods as supabaseRemote(), every call goes to the fake through a binding
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
    subscribe(uid, onRow, onStatus){ window.__fakeRT=(t,r)=>onRow(t,r); window.fakeServer('subscribe',{uid}); setTimeout(()=>onStatus('SUBSCRIBED'),0); return ()=>{ window.__fakeRT=null; window.fakeServer('unsubscribe',{}); }; }
  };
}

const r={}, fails=[], errors=[]; const check=(name, ok, info)=>{ r[name]=ok?true:(info===undefined?false:info); if(!ok) fails.push(name); };
const now=new Date().toISOString(), today=(()=>{ const d=new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); })();
const SEED_A = { spaces:[{id:'trabajo',name:'Trabajo',order:0,created:'2026-10-31T08:00:00.000Z'},{id:'personal',name:'Personal',order:1,created:'2026-10-31T08:00:00.000Z'}],
  projects:[{id:'pa-flc',spaceId:'trabajo',name:'FLC',color:'#007AFF',order:0,archived:false,created:'2026-10-31T09:00:00.000Z',modified:'2026-10-31T09:00:00.000Z'}],
  tasks:[
    {id:'ta-1',title:'Preparar comité',spaceId:'trabajo',projectId:'pa-flc',date:today,reminder:null,priority:'high',status:'pending',notes:'Orden del día',carried:false,created:'2026-10-31T10:00:00.000Z',modified:'2026-10-31T10:00:00.000Z',completed:null},
    {id:'ta-2',title:'Revisar SOW',spaceId:'trabajo',projectId:null,date:null,reminder:null,priority:'none',status:'pending',notes:'',carried:false,created:'2026-10-31T10:01:00.000Z',modified:'2026-10-31T10:01:00.000Z',completed:null},
    {id:'ta-3',title:'Llamar al fontanero',spaceId:'personal',projectId:null,date:today,reminder:null,priority:'mid',status:'pending',notes:'',carried:false,created:'2026-10-31T10:02:00.000Z',modified:'2026-10-31T10:02:00.000Z',completed:null}],
  voiceNotes:[{id:'va-1',taskId:'ta-1',text:'Incluir el punto de riesgos',created:'2026-10-31T11:00:00.000Z'},{id:'va-2',taskId:'ta-2',text:'Pedir la versión firmada',created:'2026-10-31T11:01:00.000Z'}],
  settings:{tipsSeen:true, theme:'dark'} };
const SEED_B = { spaces:[{id:'trabajo',name:'TRABAJO',order:0,created:'2026-11-01T08:00:00.000Z'},{id:'personal',name:'Personal',order:1,created:'2026-11-01T08:00:00.000Z'}],
  projects:[], voiceNotes:[],
  tasks:[{id:'tb-1',title:'Tarea de B',spaceId:'trabajo',projectId:null,date:today,reminder:null,priority:'none',status:'pending',notes:'',carried:false,created:'2026-11-01T10:00:00.000Z',modified:'2026-11-01T10:00:00.000Z',completed:null}],
  settings:{tipsSeen:true, theme:'light'} };

async function device(browser, o){
  const vp = o.desk ? {viewport:{width:1280,height:800}, deviceScaleFactor:1} : {viewport:{width:390,height:844}, deviceScaleFactor:2, isMobile:true, hasTouch:true};
  const ctx = await browser.newContext(vp); const page = await ctx.newPage();
  page.on('pageerror', e=>errors.push(o.tag+' pageerror: '+e.message)); page.on('console', m=>{ if(m.type()==='error') errors.push(o.tag+' console: '+m.text()); });
  if(o.fake){ await page.exposeBinding('fakeServer', (src, op, a)=>fake.handle(src.page, op, a)); await page.addInitScript(fakeAdapter); await page.addInitScript(u=>{ window.__fakeUser=u; }, USER); }
  await page.addInitScript(s=>{ if(!localStorage.getItem('tareas-v1')) localStorage.setItem('tareas-v1', s); }, JSON.stringify(o.seed));
  await page.goto(URL0); await page.waitForTimeout(600); return {ctx, page};
}
const until = async (page, fn, arg, ms=8000)=>{ const t0=Date.now(); for(;;){ let v=false; try{ v=await page.evaluate(fn, arg); }catch(e){} if(v) return true; if(Date.now()-t0>ms) return false; await page.waitForTimeout(100); } };
const synced = page => until(page, ()=>SY&&SY.user&&!SY.running&&SY.status==='ok'&&syncCollect(true).count===0);
const acct = page => page.evaluate(()=>{ const g=[...document.querySelectorAll('.group-title')].find(x=>x.textContent==='Cuenta'); if(!g) return null; const grp=g.nextElementSibling, foot=grp.nextElementSibling; return {cells:[...grp.querySelectorAll('.cell')].map(c=>c.textContent.trim()), foot:foot&&foot.className==='footnote'?foot.textContent:''}; });
const serverTitle = id => (fake.t.tasks.get(id)||{}).title;
const localTask = (page, id) => page.evaluate(id=>{ const x=task(id); return x?{title:x.title, spaceId:x.spaceId, modified:x.modified}:null; }, id);
async function pullDown(page, sel){ const b=await page.evaluate(s=>{ const e=document.querySelector(s); const q=e.getBoundingClientRect(); return {x:q.x+q.width/2, y:q.y+40}; }, sel);
  const cdp=await page.context().newCDPSession(page); await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:b.x,y:b.y}]});
  for(let i=1;i<=12;i++){ await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:b.x,y:b.y+i*14}]}); await page.waitForTimeout(16); }
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]}); await cdp.detach(); }

(async()=>{
  await new Promise(res=>srv.listen(PORT,res)); const browser = await chromium.launch();
  try{
  /* ---------- 1. No config: the app as before ---------- */
  { served.length=0; const {ctx, page} = await device(browser, {tag:'N', seed:SEED_A});
    await page.evaluate(()=>{ addTask({title:'Sin cuenta', date:todayStr()}); render(); });
    await page.click('[data-tab=ajustes]'); await page.waitForTimeout(300);
    const s = await page.evaluate(()=>({SY, cfg:window.TAREAS_CONFIG===undefined, sync:localStorage.getItem('tareas-sync'), ptr:!!document.querySelector('.ptr'), lib:!!window.supabase, ver:document.querySelector('.screen.root[data-root=ajustes] .footnote:last-child').textContent}));
    const a = await acct(page);
    check('noconfig_state', s.SY===null && s.cfg && s.sync===null && !s.ptr && !s.lib && /^Tareas v/.test(s.ver), s);
    check('noconfig_ui', a && a.cells.join('|')==='SincronizaciónSolo en este iPhone' && a.foot==='Sincronización no disponible en esta versión.', a);
    // The service worker precaches the library for offline use; the page itself never loads it without config
    check('noconfig_requests', served.includes('/config.js') && !(await page.evaluate(()=>!!document.querySelector('script[src*="vendor/"]'))));
    await page.screenshot({path:path.join(OUT,'s0-noconfig.png')}); await ctx.close();
    const d = await device(browser, {tag:'ND', seed:SEED_A, desk:true}); await d.page.evaluate(()=>setDeskView('settings')); await d.page.waitForTimeout(300);
    const ad = await acct(d.page); check('noconfig_desk', ad && /Solo en este dispositivo/.test(ad.cells[0]) && ad.foot==='Sincronización no disponible en esta versión.', ad); await d.ctx.close(); }

  /* ---------- 2. Device A (iPhone): signed out, then first connection ---------- */
  const A = await device(browser, {tag:'A', seed:SEED_A, fake:true});
  await A.page.evaluate(()=>{ generateDemo(); }); await A.page.waitForTimeout(500);
  await A.page.click('[data-tab=ajustes]'); await A.page.waitForTimeout(300);
  let a = await acct(A.page);
  check('A_signedOut_ui', a && a.cells[0]==='Iniciar sesión con Google' && /^Al iniciar sesión, tus tareas se guardan en tu cuenta/.test(a.foot), a);
  check('A_noCallsSignedOut', fake.calls.length===0, fake.calls);
  const before = await A.page.evaluate(()=>({tasks:DB.tasks.length}));
  await A.page.click('[data-act=signIn]'); check('A_firstSync', await synced(A.page));
  const A1 = await A.page.evaluate(async()=>{ const b=await BK.list(); const snap=b.length?await BK.get(b[0].date):null;
    return {spaces:DB.spaces.map(s=>s.id), active:DB.settings.activeSpace, t1:task('ta-1').spaceId, p:proj('pa-flc').spaceId, t3:task('ta-3').spaceId,
      backup:snap?{date:snap.date, tasks:snap.data.tasks.length, spaces:snap.data.spaces.map(s=>s.id)}:null, theme:DB.settings.theme, log:LOG.map(e=>e.m)}; });
  const sp = [...fake.t.spaces.values()];
  check('A_remap', !A1.spaces.includes('trabajo') && !A1.spaces.includes('personal') && A1.t1===A1.spaces[0] && A1.p===A1.spaces[0] && A1.t3===A1.spaces[1] && A1.active===A1.spaces[0], A1);
  check('A_backupBefore', A1.backup && A1.backup.date===today && A1.backup.tasks===before.tasks && A1.backup.spaces.includes('trabajo'), A1.backup);
  check('A_uploaded', sp.length===2 && sp.map(s=>s.name).sort().join()==='Personal,Trabajo' && fake.t.projects.size===1 && fake.t.tasks.size===3 && fake.t.voice_notes.size===0 && fake.t.tasks.get('ta-1').space_id===A1.spaces[0] && fake.t.tasks.get('ta-1').date===today && /Orden del día\n\n\d+\/\d+ \d\d:\d\d: Incluir el punto de riesgos$/.test(fake.t.tasks.get('ta-1').notes), // decision 49: the voice notes went into Notas at the start and never went up
    {spaces:sp.map(s=>s.name), p:fake.t.projects.size, t:fake.t.tasks.size, v:fake.t.voice_notes.size});
  check('A_demoNotPushed', TABLES.every(t=>[...fake.t[t].keys()].every(id=>!id.startsWith('demo-'))) && before.tasks>100);
  check('A_logged', ['Copia local antes de la primera sincronización','Primera conexión completada'].every(m=>A1.log.includes(m)) && A1.log.some(m=>/^Sincronización \(inicio|sesión\)/.test(m)) && A1.log.some(m=>/^Espacio Trabajo con identificador nuevo/.test(m)), A1.log.slice(-8));
  a = await acct(A.page);
  check('A_signedIn_ui', a && a.cells[0]==='Cuenta'+USER.email && a.cells[1]==='Sincronizado hace un momento' && a.cells[2]==='Cambios pendientesNinguno' && a.cells[3]==='Sincronizar ahora' && a.cells[4]==='Cerrar sesión' && a.foot==='Al cerrar sesión, los datos se quedan en este iPhone y dejan de sincronizarse.', a);
  await A.page.screenshot({path:path.join(OUT,'s1-account-iphone.png')});

  /* ---------- 3. Device B (desktop): merge with the space matched by name ---------- */
  const B = await device(browser, {tag:'B', seed:SEED_B, fake:true, desk:true});
  await B.page.evaluate(()=>setDeskView('settings')); await B.page.waitForTimeout(300);
  let b = await acct(B.page); check('B_signedOut_ui', b && b.cells[0]==='Iniciar sesión con Google' && /dispositivo/.test(b.foot), b);
  await B.page.click('[data-act=signIn]'); check('B_firstSync', await synced(B.page));
  const B1 = await B.page.evaluate(()=>({spaces:DB.spaces.map(s=>s.id+':'+s.name), tb:task('tb-1')&&task('tb-1').spaceId, ta1:!!task('ta-1'), vn:DB.voiceNotes.length, active:DB.settings.activeSpace, theme:DB.settings.theme}));
  check('B_merge', fake.t.spaces.size===2 && B1.spaces.length===2 && B1.tb===A1.spaces[0] && B1.ta1 && B1.vn===0 && B1.active===A1.spaces[0] && fake.t.tasks.get('tb-1').space_id===A1.spaces[0], {B1, server:fake.t.spaces.size});
  check('A_gotB_realtime', await until(A.page, ()=>!!task('tb-1')), 'A never received tb-1');
  b = await acct(B.page); check('B_signedIn_ui', b && b.cells[1]==='Sincronizado hace un momento' && b.foot==='Al cerrar sesión, los datos se quedan en este dispositivo y dejan de sincronizarse.', b);
  await B.page.screenshot({path:path.join(OUT,'s2-account-desktop.png')});
  // Decision 4: settings stay on each device
  check('settings_local', (await A.page.evaluate(()=>DB.settings.theme))==='dark' && B1.theme==='light' && !Object.keys(fake.t).includes('settings'));

  /* ---------- 4. Edit conflict: the newest modified wins, both ways ---------- */
  fake.down.add(A.page); await A.ctx.setOffline(true); await A.page.waitForTimeout(200);
  await A.page.evaluate(()=>updTask('ta-2',{title:'Revisar SOW (A)'})); await B.page.waitForTimeout(30);
  await B.page.evaluate(()=>updTask('ta-2',{title:'Revisar SOW (B)'})); await synced(B.page);
  check('conflict_serverB', serverTitle('ta-2')==='Revisar SOW (B)');
  fake.down.delete(A.page); await A.ctx.setOffline(false); await synced(A.page);
  check('conflict_newerRemoteWins', (await localTask(A.page,'ta-2')).title==='Revisar SOW (B)' && serverTitle('ta-2')==='Revisar SOW (B)', {a:(await localTask(A.page,'ta-2')), s:serverTitle('ta-2')});
  fake.down.add(B.page); await B.ctx.setOffline(true); await B.page.waitForTimeout(200);
  await B.page.evaluate(()=>updTask('ta-2',{title:'Revisar SOW (B2)'})); await A.page.waitForTimeout(30);
  await A.page.evaluate(()=>updTask('ta-2',{title:'Revisar SOW (A3)'})); await synced(A.page);
  fake.down.delete(B.page); await B.ctx.setOffline(false); await synced(B.page);
  check('conflict_newerLocalElsewhereWins', (await localTask(B.page,'ta-2')).title==='Revisar SOW (A3)' && serverTitle('ta-2')==='Revisar SOW (A3)', {b:await localTask(B.page,'ta-2'), s:serverTitle('ta-2')});
  check('conflict_logged', await B.page.evaluate(()=>LOG.some(e=>/^Conflicto resuelto: gana la copia del servidor/.test(e.m))));

  /* ---------- 5. Delete, and Deshacer after the deletion went up (decision 49: no voice notes left; rm-VN2 covers their deletion) ---------- */
  await A.page.evaluate(()=>deleteTask('ta-1'));
  check('delete_server', await until(A.page, ()=>!SY.running&&SY.status==='ok'&&syncCollect(true).count===0, null, 3500) && !!fake.t.tasks.get('ta-1').deleted, {t:fake.t.tasks.get('ta-1').deleted});
  check('delete_B', await until(B.page, ()=>!task('ta-1')), 'B kept ta-1');
  const toastOn = await A.page.evaluate(()=>document.querySelector('#toast').classList.contains('on') && !!undoFn);
  await A.page.click('#toastBtn'); await synced(A.page);
  check('undo_server', toastOn && fake.t.tasks.get('ta-1').deleted===null, {toastOn, t:fake.t.tasks.get('ta-1').deleted});
  check('undo_B', await until(B.page, ()=>!!task('ta-1') && task('ta-1').spaceId===DB.spaces[0].id), 'B did not get ta-1 back');

  /* ---------- 6. Offline: changes wait and go up on reconnect ---------- */
  fake.down.add(A.page); await A.ctx.setOffline(true); await A.page.waitForTimeout(300);
  const off = await A.page.evaluate(()=>{ const x=addTask({title:'Hecho sin conexión', date:todayStr()}); updTask('ta-3',{priority:'high'}); deleteTask('ta-2'); return x.id; });
  await A.page.waitForTimeout(1900); await A.page.click('[data-tab=ajustes]'); await A.page.waitForTimeout(300);
  a = await acct(A.page);
  check('offline_ui', a && a.cells[1]==='Sin conexión. Se sincronizará al volver' && a.cells[2]==='Cambios pendientes3', a); // new task, edit, deleted task
  await A.page.screenshot({path:path.join(OUT,'s3-offline-iphone.png')});
  check('offline_notSent', !fake.t.tasks.has(off) && fake.t.tasks.get('ta-3').priority==='mid' && !fake.t.tasks.get('ta-2').deleted);
  fake.down.delete(A.page); await A.ctx.setOffline(false); await synced(A.page);
  check('offline_sentOnReconnect', fake.t.tasks.has(off) && fake.t.tasks.get('ta-3').priority==='high' && !!fake.t.tasks.get('ta-2').deleted);
  check('offline_B', await until(B.page, id=>!!task(id) && task('ta-3').priority==='high' && !task('ta-2'), off), 'B missing offline changes');
  check('demo_neverPushed', TABLES.every(t=>[...fake.t[t].keys()].every(id=>!id.startsWith('demo-'))));

  /* ---------- 6b. Restoring a local backup while signed in applies to every device (agreed with Enric) ---------- */
  {
    const t3old = await A.page.evaluate(async()=>{ await dailyBackup(true); return task('ta-3').title; });
    const nid = await A.page.evaluate(()=>addTask({title:'Tras la copia', date:null, projectId:null, priority:'none'}).id);
    await A.page.evaluate(()=>updTask('ta-3',{title:'Cambio tras la copia'}));
    check('restore_presync', await synced(A.page) && fake.t.tasks.has(nid) && serverTitle('ta-3')==='Cambio tras la copia');
    check('restore_B_has', await until(B.page, id=>!!task(id), nid), 'B never got the new task');
    await A.page.evaluate(()=>restoreBackup(todayStr())); await A.page.waitForTimeout(700);
    const txt = await A.page.evaluate(()=>document.querySelector('#asheet').textContent);
    check('restore_warns', /en todos tus dispositivos/.test(txt), txt);
    await A.page.click('#asheet .it[data-i="0"]'); await A.page.waitForTimeout(400);
    check('restore_local', await A.page.evaluate(([id,t])=>!task(id) && task('ta-3').title===t, [nid,t3old]));
    check('restore_server', await synced(A.page) && !!fake.t.tasks.get(nid).deleted && serverTitle('ta-3')===t3old, {del:fake.t.tasks.get(nid), t3:serverTitle('ta-3'), t3old});
    check('restore_B', await until(B.page, ([id,t])=>!task(id) && task('ta-3').title===t, [nid,t3old]), 'B did not follow the restore');
  }

  /* ---------- 7. Realtime while a sheet is open on the iPhone ---------- */
  await A.page.click('[data-tab=tareas]'); await A.page.waitForTimeout(300);
  await A.page.click('.screen.root[data-root=tareas] .fab'); await A.page.waitForTimeout(500);
  await A.page.fill('#sheet .titlein', 'Escribiendo algo'); await A.page.waitForTimeout(100);
  await B.page.evaluate(()=>updTask('ta-3',{title:'Llamar al fontanero hoy'}));
  const rt = await until(A.page, ()=>task('ta-3').title==='Llamar al fontanero hoy');
  const sh = await A.page.evaluate(()=>({open:document.querySelector('#sheet').classList.contains('on'), val:document.querySelector('#sheet .titlein').value, focus:document.activeElement&&document.activeElement.classList.contains('titlein')}));
  check('realtime_sheetKept', rt && sh.open && sh.val==='Escribiendo algo' && sh.focus, {rt, sh});
  await A.page.evaluate(()=>closeSheet()); await A.page.waitForTimeout(800);
  await A.page.evaluate(()=>{ const s=[...DB.spaces].find(s=>s.name==='Personal'); if(DB.settings.activeSpace!==s.id){ DB.settings.activeSpace=s.id; save(); render(); } }); await A.page.waitForTimeout(400);
  check('realtime_drawn', await A.page.evaluate(()=>[...document.querySelectorAll('.screen.root[data-root=tareas] .row-title')].some(e=>e.textContent==='Llamar al fontanero hoy')));

  /* ---------- 8. Pull to refresh on the iPhone list and in a project ---------- */
  fake.muted.add(A.page); // realtime cut for A: only a pull brings the change
  await B.page.evaluate(()=>updTask('ta-3',{title:'Fontanero (desde B)'})); await synced(B.page);
  await A.page.waitForTimeout(400); const stale = (await localTask(A.page,'ta-3')).title;
  await A.page.evaluate(()=>{ const s=document.querySelector('.screen.root[data-root=tareas] .scroll'); s.scrollTop=0; });
  await pullDown(A.page, '.screen.root[data-root=tareas] .scroll'); await A.page.waitForTimeout(150);
  const spin = await A.page.evaluate(()=>{ const p=document.querySelector('.ptr'); return {on:p.classList.contains('on'), spin:p.classList.contains('spin'), hold:document.querySelector('.screen.root[data-root=tareas]').classList.contains('ptr-hold')}; });
  await A.page.screenshot({path:path.join(OUT,'s4-pull-iphone.png')});
  await A.page.waitForTimeout(700);
  const note = await A.page.evaluate(()=>document.querySelector('.ptr .ptr-text').textContent);
  await A.page.screenshot({path:path.join(OUT,'s5-pull-done.png')});
  check('pull_list', stale!=='Fontanero (desde B)' && spin.on && spin.spin && spin.hold && /^Sincronizado a las \d\d:\d\d$/.test(note) && (await localTask(A.page,'ta-3')).title==='Fontanero (desde B)', {stale, spin, note});
  await A.page.waitForTimeout(1600);
  await B.page.evaluate(()=>{ const p=DB.projects.find(p=>p.id==='pa-flc'); p.name='FLC Fase 2'; p.modified=new Date().toISOString(); save(); }); await synced(B.page);
  await A.page.evaluate(()=>{ DB.settings.activeSpace=DB.spaces.find(s=>s.name==='Trabajo').id; save(); render(); push('project','pa-flc'); }); await A.page.waitForTimeout(800);
  await pullDown(A.page, '.pushed-screen.project .scroll'); await A.page.waitForTimeout(1500);
  check('pull_project', await A.page.evaluate(()=>proj('pa-flc').name==='FLC Fase 2' && document.querySelector('.pushed-screen.project .nav-title').textContent.includes('FLC Fase 2')), await A.page.evaluate(()=>proj('pa-flc').name));
  await A.page.evaluate(()=>pop()); await A.page.waitForTimeout(700); fake.muted.delete(A.page);

  /* ---------- 9. Sign out keeps the data and stops the sync ---------- */
  await B.page.evaluate(()=>setDeskView('settings')); await B.page.waitForTimeout(300);
  await B.page.click('[data-act=signOut]'); await B.page.waitForTimeout(400);
  await B.page.click('#asheet .al-btn.def'); await B.page.waitForTimeout(600); // decision 28c: the desktop confirms with a macOS alert
  const n0 = fake.calls.length, tB = await B.page.evaluate(()=>DB.tasks.length);
  await B.page.evaluate(()=>{ addTask({title:'Solo en B'}); }); await B.page.waitForTimeout(2200);
  b = await acct(B.page);
  check('signOut', b && b.cells[0]==='Iniciar sesión con Google' && tB>3 && !fake.calls.slice(n0).some(c=>c==='upsert') && ![...fake.t.tasks.values()].some(t=>t.title==='Solo en B'), {b, calls:fake.calls.slice(n0)});
  await B.page.screenshot({path:path.join(OUT,'s6-signedout-desktop.png')});

  /* ---------- 10. The account section in dark mode, for a look ---------- */
  await A.page.click('[data-tab=ajustes]'); await A.page.waitForTimeout(400); await A.page.screenshot({path:path.join(OUT,'s7-account-dark.png')});
  await A.ctx.close(); await B.ctx.close();

  /* ---------- 11. Vendored supabase-js: loads, createClient works, request shapes, ?code= cleanup and ?add= ---------- */
  { const ctx = await browser.newContext({viewport:{width:390,height:844}, isMobile:true, hasTouch:true}); const page = await ctx.newPage(); const reqs=[];
    page.on('pageerror', e=>errors.push('V pageerror: '+e.message));
    await page.route('https://tareas-test.supabase.co/**', route=>{ const q=route.request(); reqs.push({m:q.method(), u:q.url(), h:q.headers(), b:q.postData()});
      if(q.url().includes('/auth/v1/token')) return route.fulfill({status:400, contentType:'application/json', body:JSON.stringify({error:'invalid_grant', error_description:'bad code'})});
      return route.fulfill({status:200, contentType:'application/json', body:q.method()==='GET'?'[]':JSON.stringify([{id:'x1'}])}); });
    await page.addInitScript(()=>{ window.TAREAS_CONFIG={url:'https://tareas-test.supabase.co', anonKey:'dummy-key'}; });
    await page.addInitScript(s=>{ if(!localStorage.getItem('tareas-v1')) localStorage.setItem('tareas-v1', s); }, JSON.stringify(SEED_A));
    await page.goto(URL0+'?code=abc123&x=1'); await page.waitForTimeout(1500);
    const v = await page.evaluate(async()=>{ const c=window.supabase.createClient('https://tareas-test.supabase.co','dummy-key',{auth:{persistSession:false, autoRefreshToken:false, detectSessionInUrl:false}});
      const rm=supabaseRemote({url:'https://tareas-test.supabase.co', anonKey:'dummy-key'}); await rm.init();
      const pulled=await rm.pull('tasks','2026-11-02T09:00:00.123Z',1000); const up=await rm.upsert('tasks',[{id:'x1', modified:'2026-11-02T09:00:00.000Z'}]); const del=await rm.markDeleted('voice_notes',[{id:'x2', ts:'2026-11-02T10:00:00.000Z'}]);
      return {lib:typeof window.supabase.createClient, from:typeof c.from, auth:typeof c.auth.signInWithOAuth, pulled, up, del, search:location.search, SY:!!SY, user:SY&&SY.user, script:!!document.querySelector('script[src="vendor/supabase-js-2.117.3.umd.js"]'), log:LOG.map(e=>e.m).slice(-6)}; });
    const pull = reqs.find(q=>q.m==='GET' && q.u.includes('/rest/v1/tasks')), up = reqs.find(q=>q.m==='POST' && q.u.includes('/rest/v1/tasks')), dl = reqs.find(q=>q.m==='POST' && q.u.includes('/rest/v1/voice_notes'));
    check('vendor_loads', v.lib==='function' && v.from==='function' && v.auth==='function' && v.script && v.SY && v.user===null, v);
    check('vendor_codeCleaned', v.search==='?x=1' && v.log.some(m=>/^Inicio de sesión (rechazado|no completado)/.test(m)), {search:v.search, log:v.log});
    check('vendor_pullShape', !!pull && /select=\*/.test(pull.u) && /order=server_ts\.asc%2Cid\.asc|order=server_ts\.asc,id\.asc/.test(pull.u) && /limit=1000/.test(pull.u) && /server_ts=gt\.2026-11-02T09%3A00%3A00\.123Z|server_ts=gt\.2026-11-02T09:00:00\.123Z/.test(pull.u) && pull.h.apikey==='dummy-key', pull&&pull.u);
    check('vendor_upsertShape', !!up && /on_conflict=id/.test(up.u) && /resolution=merge-duplicates/.test(up.h.prefer||'') && /return=representation/.test(up.h.prefer||'') && /missing=default/.test(up.h.prefer||'') && /select=id/.test(up.u), up&&{u:up.u, p:up.h.prefer});
    check('vendor_deleteShape', !!dl && JSON.parse(dl.b)[0].deleted==='2026-11-02T10:00:00.000Z' && JSON.parse(dl.b)[0].modified==='2026-11-02T10:00:00.000Z' && Object.keys(JSON.parse(dl.b)[0]).length===3, dl&&dl.b);
    check('vendor_noRealNetwork', reqs.every(q=>q.u.startsWith('https://tareas-test.supabase.co/')));
    // ?add= keeps working with the config present
    await page.goto(URL0+'?add=Comprar%20pan'); await page.waitForTimeout(1200);
    const add = await page.evaluate(()=>({open:document.querySelector('#sheet').classList.contains('on'), val:(document.querySelector('#sheet .titlein')||{}).value, search:location.search}));
    check('add_entry', add.open && add.val==='Comprar pan' && add.search==='', add);
    await ctx.close(); }
  }catch(e){ fails.push('exception'); errors.push(String(e&&e.stack||e)); }
  // Supabase's GoTrue logs the rejected test code as an error on purpose (section 11)
  // The missing config.js logs a 404 in the console (the only file missing, checked below); offline it is a failed fetch
  const errs = errors.filter(e=>!/V console: .*(invalid_grant|bad code|400)/.test(e) && !/Failed to load resource: (the server responded with a status of 404|net::ERR_INTERNET_DISCONNECTED|net::ERR_FAILED)/.test(e));
  check('only_config_missing', missing.every(p=>p==='/config.js'), [...new Set(missing)]);
  console.log(JSON.stringify({r, fails, errors:errs}, null, 1));
  await browser.close(); srv.close(); process.exit(fails.length||errs.length?1:0);
})();
