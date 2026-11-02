require('./lib/out.js'); // outputs (screenshots, downloads) go to tests/out
// Decision 28 (minor decisions of 2 November), port 9820.
//  a. Deleting a space takes its projects (archived too), tasks (old completed too) and voice notes, after a confirmation that counts them,
//     with a local copy first and one Deshacer; the only space still cannot go. Sync: the deletion and its Deshacer reach another device
//     (fake server copied from rm-S.js, same rules).
//  b. Closing Nota de voz (new or edit) or Nueva tarea with text not saved asks first: Descartar or Seguir editando (iPhone action sheet,
//     desktop alert); saving, no text or an unchanged edit close at once. The 450 ms guard stays.
//  c. Desktop: confirmations are a macOS alert (icon, bold title, text, Cancelar and Eliminar on the right; Intro, Esc, Tab trapped,
//     light backdrop, 0.2 s scale and fade, fade only with Reduce Motion). The iPhone keeps the bottom action sheet.
//  d. Hours view: Todo el día shows up to three tasks a day and "N más", which opens Día; no inner scroll; drops onto the strip still work.
//  e. Desktop sidebar: projects reorder by dragging (insertion line, auto-scroll, Esc, Deshacer) or Alt and an arrow; tasks still drop on projects.
const { chromium } = require('playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = path.resolve(__dirname, '..'), PORT = 9820, URL0 = 'http://localhost:'+PORT+'/';
const OUT = path.join(__dirname, 'out', 'Q2'); fs.mkdirSync(OUT, {recursive:true});
const TYPES = {'.html':'text/html','.css':'text/css','.js':'application/javascript','.webmanifest':'application/manifest+json','.png':'image/png'};
const srv = http.createServer((req,res)=>{ let p = decodeURIComponent(req.url.split('?')[0]); if(p==='/') p='/index.html'; const f=path.join(ROOT,p);
  if(p==='/config.js'){ res.writeHead(200,{'Content-Type':'application/javascript'}); res.end('window.TAREAS_CONFIG = {"url":null,"anonKey":null};\n'); return; }
  if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){ res.writeHead(404,{'Content-Type':'text/html'}); res.end('<h1>404</h1>'); return; }
  res.writeHead(200,{'Content-Type':TYPES[path.extname(f)]||'application/octet-stream'}); res.end(fs.readFileSync(f)); });
const r={}, fails=[], errors=[]; const check=(name, ok, info)=>{ r[name]=ok?true:(info===undefined?false:info); if(!ok) fails.push(name); };
/* ----- Fake server, adapter and device(): copied from rm-S.js (block 8) ----- */
/* ---------- Fake server ---------- */
// Updated by decision 29 (attachments): the app syncs a fifth table, so the fake server has it too (0003_attachments.sql)
const TABLES = ['spaces','projects','tasks','voice_notes','attachments','subtasks']; // decision 46: the app syncs the steps too (0005_subtasks.sql)
const COLS = { spaces:['name','sort_order','members'], projects:['space_id','name','color','sort_order','archived'],
  tasks:['space_id','project_id','title','date','reminder','priority','status','notes','carried','assignees','completed'], voice_notes:['task_id','text'],
  attachments:['task_id','kind','path','mime','size','width','height','duration_ms','purged'], subtasks:['task_id','title','done','sort_order'] };
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

/* ---------- Seeds and helpers ---------- */
const pad=n=>String(n).padStart(2,'0'); const dstr=d=>d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());
const today=dstr(new Date()), tomorrow=(()=>{ const d=new Date(); d.setDate(d.getDate()+1); return dstr(d); })();
const C='2026-10-31T09:00:00.000Z', OLD=new Date(Date.now()-60*864e5).toISOString(), RECENT=new Date(Date.now()-3600e3).toISOString();
const T=(id, o)=>Object.assign({id, title:'Tarea '+id, spaceId:'trabajo', projectId:null, date:today, reminder:null, priority:'none', status:'pending', notes:'', carried:false, created:C, modified:C, completed:null}, o);
const P=(id, o)=>Object.assign({id, spaceId:'trabajo', name:'Proyecto '+id, color:'#007AFF', order:0, archived:false, created:C, modified:C}, o);
const SEED = { spaces:[{id:'trabajo',name:'Trabajo',order:0,created:C},{id:'personal',name:'Personal',order:1,created:C}],
  projects:[P('p1',{name:'FLC'}), P('p2',{name:'Antiguo', archived:true, order:1}), P('p3',{name:'Obra', color:'#34C759', order:2}), P('pp',{spaceId:'personal', name:'Casa'})],
  tasks:[T('t1',{projectId:'p1', title:'Preparar comité'}), T('t2',{projectId:'p2', status:'done', completed:OLD, title:'Cerrar fase uno'}), T('t3',{title:'Revisar SOW'}),
    T('t4',{projectId:'p3', status:'done', completed:RECENT, title:'Pedir planos'}), T('t5',{projectId:'p1', title:'Enviar acta'}), T('tp1',{spaceId:'personal', projectId:'pp', title:'Llamar al fontanero'})],
  voiceNotes:[{id:'v1',taskId:'t1',text:'Incluir el punto de riesgos',created:C},{id:'v2',taskId:'t3',text:'Pedir la versión firmada',created:C},{id:'vp',taskId:'tp1',text:'Antes del viernes',created:C}],
  settings:{tipsSeen:true} };
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function tapAt(page, x, y){ const cdp=await page.context().newCDPSession(page); await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]}); await sleep(40); await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]}); await cdp.detach(); }
async function box(page, sel){ return page.evaluate(s=>{ const e=document.querySelector(s); if(!e) return null; const q=e.getBoundingClientRect(); return {x:q.x,y:q.y,w:q.width,h:q.height,cx:q.x+q.width/2,cy:q.y+q.height/2}; }, sel); }
async function tap(page, sel){ const b=await box(page, sel); if(!b) throw new Error('no '+sel); await tapAt(page, b.cx, b.cy); }
async function drag(page, x, y, dx, dy, n=10){ const cdp=await page.context().newCDPSession(page); await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
  for(let i=1;i<=n;i++){ await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+dx*i/n,y:y+dy*i/n}]}); await sleep(16); } await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]}); await cdp.detach(); }
const ui = page => page.evaluate(()=>{ const as=document.querySelector('#asheet'); return {sheet:document.querySelector('#sheet').classList.contains('on'), asheet:as.classList.contains('on'), alert:as.classList.contains('alert'),
  t:(as.querySelector('.t,.al-t')||{}).textContent||'', x:(as.querySelector('.al-x')||{}).textContent||'', btns:[...as.querySelectorAll('button')].map(b=>b.textContent), red:[...as.querySelectorAll('.red')].map(b=>b.textContent),
  focus:document.activeElement?(document.activeElement.textContent||document.activeElement.tagName):'', tag:document.activeElement&&document.activeElement.tagName, scrimLight:document.querySelector('#scrim').classList.contains('light'), scrim:document.querySelector('#scrim').classList.contains('on')}; });
const counts = page => page.evaluate(()=>({spaces:DB.spaces.map(s=>s.id).join(','), projects:DB.projects.length, tasks:DB.tasks.length, vns:DB.voiceNotes.length, active:DB.settings.activeSpace}));
const toastOn = page => page.evaluate(()=>document.querySelector('#toast').classList.contains('on')?document.querySelector('#toastText').textContent:'');

(async()=>{
  await new Promise(res=>srv.listen(PORT,res)); const browser = await chromium.launch();
  try{
  /* ================= a. iPhone, local ================= */
  { const {ctx, page} = await device(browser, {tag:'Ma', seed:SEED});
    await page.click('[data-tab=ajustes]'); await sleep(400);
    await tap(page, '[data-edit-space="trabajo"]'); await sleep(600);
    check('a_delButton_notEmpty', await page.evaluate(()=>!!document.querySelector('#sheet [data-x=del]')));
    await tap(page, '#sheet [data-x=del]'); await sleep(600);
    let u = await ui(page);
    check('a_confirm', u.asheet && !u.alert && !u.sheet && u.t==='Se eliminarán 3 proyectos, 5 tareas y 2 notas de voz del espacio "Trabajo". Podrás deshacerlo durante unos segundos.' && u.red.join()==='Eliminar espacio', u);
    await page.screenshot({path:path.join(OUT,'q2-m-delete-space.png')});
    await tap(page, '#asheet .it.red');
    await until(page, ()=>DB.spaces.length===1);
    let c = await counts(page);
    check('a_cascade', c.spaces==='personal' && c.projects===1 && c.tasks===1 && c.vns===1 && c.active==='personal', c);
    const bk = await page.evaluate(async()=>{ const l=await BK.list(); const s=l.length?await BK.get(l[0].date):null; return {date:l[0]&&l[0].date, tasks:s&&s.data.tasks.length, spaces:s&&s.data.spaces.map(x=>x.id).join(','), log:LOG.map(e=>e.m)}; });
    check('a_backupBefore', bk.date===today && bk.tasks===6 && bk.spaces==='trabajo,personal' && bk.log.includes('Copia local antes de eliminar un espacio') && bk.log.includes('Espacio eliminado'), bk);
    check('a_toast', (await toastOn(page))==='Espacio eliminado');
    await page.click('#toastBtn'); await sleep(500);
    c = await counts(page); check('a_undo', c.spaces==='trabajo,personal' && c.projects===4 && c.tasks===6 && c.vns===3 && c.active==='trabajo', c);
    check('a_undo_ui', await page.evaluate(()=>document.querySelectorAll('[data-edit-space]').length===2));
    // The other space while another is active: the active one stays
    await page.evaluate(()=>{ const un=deleteSpace('personal'); window.__un=un; }); c = await counts(page);
    check('a_other_space', c.spaces==='trabajo' && c.active==='trabajo' && c.tasks===5, c);
    // The only space: no Eliminar, and deleteSpace refuses
    await page.evaluate(()=>{ render(); spaceSheet('trabajo'); }); await sleep(500);
    const only = await page.evaluate(()=>({del:!!document.querySelector('#sheet [data-x=del]'), hint:(document.querySelector('#sheet .hint')||{}).textContent, refused:deleteSpace('trabajo')===null, n:DB.spaces.length}));
    check('a_only_space', !only.del && only.hint==='Es el único espacio; no se puede eliminar.' && only.refused && only.n===1, only);
    await page.evaluate(()=>{ closeSheet(); window.__un(); render(); }); await sleep(600);
    c = await counts(page); check('a_undo_other', c.spaces==='trabajo,personal' && c.tasks===6 && c.vns===3, c);
    // An empty space says so
    await page.evaluate(()=>{ addSpace('Vacío'); render(); }); const vid = await page.evaluate(()=>DB.spaces.find(s=>s.name==='Vacío').id);
    await page.evaluate(id=>confirmDeleteSpace(DB.spaces.find(s=>s.id===id)), vid); await sleep(300);
    u = await ui(page); check('a_empty_text', u.t==='El espacio "Vacío" está vacío.', u); await page.evaluate(()=>closeSheet()); await sleep(500);
    await ctx.close(); }

  /* ================= b. iPhone ================= */
  { const {ctx, page} = await device(browser, {tag:'Mb', seed:SEED});
    const nv = ()=>page.evaluate(()=>DB.voiceNotes.length);
    const n0 = await nv();
    await page.evaluate(()=>openDetail('t1')); await sleep(700);
    // New note with text: the backdrop asks
    await tap(page, '.pushed-screen [data-act=voice]'); await sleep(300);
    await page.focus('#sheet textarea'); await page.keyboard.type('Texto sin guardar'); await sleep(400);
    await tapAt(page, 195, 80); await sleep(60);
    let u = await ui(page); check('b_backdrop_asks', u.sheet && u.asheet && !u.alert && u.red.join()==='Descartar nota' && u.btns.includes('Seguir editando') && u.t==='La nota no se ha guardado.', u);
    await tapAt(page, 195, 80); await sleep(100); // a second tap within 450 ms (a ghost) is ignored
    u = await ui(page); check('b_guard_kept', u.sheet && u.asheet, u);
    await page.screenshot({path:path.join(OUT,'q2-m-discard.png')});
    await sleep(500); await tap(page, '#asheet .it.cancel'); await sleep(500);
    u = await ui(page); check('b_keep_editing', u.sheet && !u.asheet && u.tag==='TEXTAREA' && await page.evaluate(()=>document.querySelector('#sheet textarea').value==='Texto sin guardar'), u);
    // Descartar in the header asks too; Descartar nota closes without saving
    await tap(page, '#sheet [data-x=cancel]'); await sleep(550);
    u = await ui(page); check('b_header_asks', u.sheet && u.asheet && u.red.join()==='Descartar nota', u);
    await tap(page, '#asheet .it.red'); await sleep(600);
    u = await ui(page); check('b_discarded', !u.sheet && !u.asheet && (await nv())===n0, {u, n:await nv()});
    // A drag down with text: the sheet goes back up and asks; Guardar then closes at once and saves
    await tap(page, '.pushed-screen [data-act=voice]'); await sleep(300);
    await page.focus('#sheet textarea'); await page.keyboard.type('Nota arrastrada'); await sleep(500);
    { const b=await box(page, '#sheet .handle'); await drag(page, b.cx, b.cy+4, 0, 240, 10); await sleep(600); }
    u = await ui(page); const tr = await page.evaluate(()=>document.querySelector('#sheet').style.transform);
    check('b_drag_asks', u.sheet && u.asheet && tr==='', {u, tr});
    await tap(page, '#asheet .it.cancel'); await sleep(500);
    await tap(page, '#sheet [data-x=ok]'); await sleep(600);
    u = await ui(page); check('b_save_closes', !u.sheet && !u.asheet && (await nv())===n0+1, {u, n:await nv()});
    // No text: closes at once
    await tap(page, '.pushed-screen [data-act=voice]'); await sleep(600); await tapAt(page, 195, 80); await sleep(600);
    u = await ui(page); check('b_empty_closes', !u.sheet && !u.asheet, u);
    // Edit: unchanged closes at once, changed asks
    await page.evaluate(()=>voiceSheet('t1','v1')); await sleep(600); await tap(page, '#sheet [data-x=cancel]'); await sleep(600);
    u = await ui(page); check('b_edit_unchanged', !u.sheet && !u.asheet, u);
    await page.evaluate(()=>voiceSheet('t1','v1')); await sleep(300); await page.focus('#sheet textarea'); await page.keyboard.type(' y plazos'); await sleep(400);
    await tap(page, '#sheet [data-x=cancel]'); await sleep(550);
    u = await ui(page); check('b_edit_changed_asks', u.asheet && u.t==='Los cambios de la nota no se han guardado.', u);
    await tap(page, '#asheet .it.red'); await sleep(600);
    check('b_edit_discarded', await page.evaluate(()=>DB.voiceNotes.find(v=>v.id==='v1').text==='Incluir el punto de riesgos' && !document.querySelector('#sheet').classList.contains('on')));
    await page.evaluate(()=>pop()); await sleep(700);
    // Nueva tarea
    const nt = ()=>page.evaluate(()=>DB.tasks.length); const t0 = await nt();
    await tap(page, '.screen.root:not(.hidden-tab) .fab'); await sleep(300); await page.keyboard.type('Algo pendiente'); await sleep(400);
    await tapAt(page, 195, 80); await sleep(150);
    u = await ui(page); check('b_add_asks', u.sheet && u.asheet && u.red.join()==='Descartar tarea' && u.t==='La tarea no se ha añadido.', u);
    await sleep(400); await tap(page, '#asheet .it.cancel'); await sleep(500);
    u = await ui(page); check('b_add_keep', u.sheet && !u.asheet && u.tag==='INPUT' && await page.evaluate(()=>document.querySelector('#sheet .titlein').value==='Algo pendiente'), u);
    await tapAt(page, 195, 80); await sleep(550); await tap(page, '#asheet .it.red'); await sleep(600);
    u = await ui(page); check('b_add_discarded', !u.sheet && (await nt())===t0, u);
    // After an Enter (added, field empty) the backdrop closes at once
    await tap(page, '.screen.root:not(.hidden-tab) .fab'); await sleep(300); await page.keyboard.type('Tarea en serie'); await page.keyboard.press('Enter'); await sleep(500);
    await tapAt(page, 195, 80); await sleep(600);
    u = await ui(page); check('b_add_empty_closes', !u.sheet && !u.asheet && (await nt())===t0+1, u);
    // A pasted list waiting asks with the plural
    await tap(page, '.screen.root:not(.hidden-tab) .fab'); await sleep(300); await page.evaluate(()=>{ const i=document.querySelector('#sheet .titlein'); const dt=new DataTransfer(); dt.setData('text/plain','Uno\nDos'); i.dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt, bubbles:true, cancelable:true})); }); await sleep(500);
    await tapAt(page, 195, 80); await sleep(150); u = await ui(page); check('b_add_list_asks', u.asheet && u.red.join()==='Descartar tareas', u);
    await sleep(400); await tap(page, '#asheet .it.red'); await sleep(600);
    await ctx.close(); }

  /* ================= c and b on the desktop ================= */
  { const {ctx, page} = await device(browser, {tag:'Dc', seed:SEED, desk:true});
    await page.evaluate(()=>confirmDelete('t3')); await sleep(350);
    let u = await ui(page);
    const geo = await page.evaluate(()=>{ const a=document.querySelector('#asheet .al'), q=a.getBoundingClientRect(), bs=[...document.querySelectorAll('#asheet .al-btn')].map(b=>b.getBoundingClientRect().x), cs=getComputedStyle(document.querySelector('#asheet'));
      return {w:Math.round(q.width), cx:Math.round(q.x+q.width/2), cy:Math.round(q.y+q.height/2), icon:!!document.querySelector('#asheet .al-icon'), rightIsDef:bs[1]>bs[0]&&document.querySelectorAll('#asheet .al-btn')[1].classList.contains('def'), dur:cs.transitionDuration, redColor:getComputedStyle(document.querySelector('#asheet .al-btn.def')).color, weight:getComputedStyle(document.querySelector('#asheet .al-t')).fontWeight, role:a.getAttribute('role')}; });
    check('c_alert', u.asheet && u.alert && u.t==='Eliminar tarea' && /^"Revisar SOW" se eliminará/.test(u.x) && u.btns.join()==='Cancelar,Eliminar' && u.red.join()==='Eliminar' && u.focus==='Eliminar' && u.scrimLight, u);
    check('c_alert_geometry', geo.icon && geo.rightIsDef && geo.w===260 && Math.abs(geo.cx-640)<=2 && Math.abs(geo.cy-400)<=2 && /0\.2s/.test(geo.dur) && +geo.weight>=700 && geo.role==='alertdialog', geo);
    await page.screenshot({path:path.join(OUT,'q2-d-alert.png')});
    await page.keyboard.press('Tab'); let f1=(await ui(page)).focus; await page.keyboard.press('Tab'); let f2=(await ui(page)).focus; await page.keyboard.press('Shift+Tab'); let f3=(await ui(page)).focus;
    check('c_tab_trapped', f1==='Cancelar' && f2==='Eliminar' && f3==='Cancelar', [f1,f2,f3]);
    await page.keyboard.press('n'); await sleep(200); check('c_keys_blocked', (await ui(page)).asheet && await page.evaluate(()=>!document.querySelector('#sheet').classList.contains('on')));
    await page.keyboard.press('Escape'); await sleep(400);
    u = await ui(page); check('c_esc_cancels', !u.asheet && !u.scrim && await page.evaluate(()=>!!task('t3')), u);
    await page.evaluate(()=>confirmDelete('t3')); await sleep(350); await page.keyboard.press('Enter'); await sleep(700);
    check('c_enter_deletes', await page.evaluate(()=>!task('t3')) && (await toastOn(page))==='Tarea eliminada');
    await page.evaluate(()=>confirmDelete('t5')); await sleep(350); await page.click('#asheet .al-btn:not(.def)'); await sleep(400);
    check('c_click_cancel', await page.evaluate(()=>!!task('t5')) && !(await ui(page)).asheet);
    await page.evaluate(()=>confirmDelete('t5')); await sleep(350); await page.click('#asheet .al-btn.def'); await sleep(700);
    check('c_click_delete', await page.evaluate(()=>!task('t5')));
    // Restore and sign out keep their own word on the button
    await page.evaluate(()=>confirmSheet('Cerrar sesión', 'Los datos se quedan.', ()=>{})); await sleep(350);
    u = await ui(page); check('c_other_word', u.alert && u.btns.join()==='Cancelar,Cerrar sesión', u); await page.keyboard.press('Escape'); await sleep(400);
    // The space: Ajustes, the space sheet (centred), then the alert over nothing
    await page.evaluate(()=>setDeskView('settings')); await sleep(400);
    await page.click('[data-edit-space="trabajo"]'); await sleep(500); await page.click('#sheet [data-x=del]'); await sleep(450);
    u = await ui(page); check('c_space_alert', u.alert && u.t==='Eliminar espacio' && u.x==='Se eliminarán 3 proyectos, 3 tareas y 1 nota de voz del espacio "Trabajo". Podrás deshacerlo durante unos segundos.' && u.btns.join()==='Cancelar,Eliminar', u);
    await page.screenshot({path:path.join(OUT,'q2-d-space-alert.png')});
    await page.keyboard.press('Enter'); await until(page, ()=>DB.spaces.length===1);
    let c = await counts(page); check('c_space_deleted', c.spaces==='personal' && c.tasks===1, c);
    await page.click('#toastBtn'); await sleep(500); c = await counts(page); check('c_space_undo', c.spaces==='trabajo,personal' && c.tasks===4 && c.vns===2, c);
    // b on the desktop: Escape on a voice note with text asks with the alert; Escape again goes back to the text
    await page.evaluate(()=>{ setDeskView('hoy'); openDetail('t1'); }); await sleep(400);
    await page.evaluate(()=>voiceSheet('t1')); await sleep(300); await page.focus('#sheet textarea'); await page.keyboard.type('Escrita en el Mac'); await sleep(300);
    await page.keyboard.press('Escape'); await sleep(350);
    u = await ui(page); check('Db_esc_asks', u.sheet && u.alert && u.t==='La nota no se ha guardado.' && u.btns.join()==='Seguir editando,Descartar nota' && u.focus==='Descartar nota', u);
    await page.screenshot({path:path.join(OUT,'q2-d-discard.png')});
    await page.keyboard.press('Escape'); await sleep(400);
    u = await ui(page); check('Db_keep', u.sheet && !u.asheet && u.tag==='TEXTAREA', u);
    await page.click('#scrim', {position:{x:20,y:20}}); await sleep(400); await page.click('#asheet .al-btn.def'); await sleep(600);
    u = await ui(page); check('Db_discard', !u.sheet && !u.asheet && await page.evaluate(()=>DB.voiceNotes.length===2), u);
    // Dark
    await page.emulateMedia({colorScheme:'dark'}); await page.evaluate(()=>confirmDelete('t1')); await sleep(350); await page.screenshot({path:path.join(OUT,'q2-d-alert-dark.png')}); await page.keyboard.press('Escape'); await sleep(300);
    await ctx.close(); }
  // Reduce Motion: a fade only (no scale while it opens)
  { const ctx = await browser.newContext({viewport:{width:1280,height:800}, reducedMotion:'reduce'}); const page = await ctx.newPage();
    page.on('pageerror', e=>errors.push('R pageerror: '+e.message)); page.on('console', m=>{ if(m.type()==='error') errors.push('R console: '+m.text()); });
    await page.addInitScript(s=>{ if(!localStorage.getItem('tareas-v1')) localStorage.setItem('tareas-v1', s); }, JSON.stringify(SEED)); await page.goto(URL0); await sleep(600);
    await page.evaluate(()=>confirmDelete('t1')); await sleep(30);
    const m = await page.evaluate(()=>getComputedStyle(document.querySelector('#asheet')).transform); await sleep(400);
    const m2 = await page.evaluate(()=>getComputedStyle(document.querySelector('#asheet')).transform);
    const sc = s=>{ const v=(s.match(/matrix\(([^)]+)\)/)||[])[1]; return v?+v.split(',')[0]:1; };
    check('c_reduce_fade', sc(m)===1 && sc(m2)===1 && (await ui(page)).alert, {m, m2});
    await ctx.close(); }
  // iPhone: the bottom action sheet stays
  { const {ctx, page} = await device(browser, {tag:'Mc', seed:SEED});
    await page.evaluate(()=>confirmDelete('t1')); await sleep(400); const u = await ui(page);
    check('c_iphone_sheet', u.asheet && !u.alert && u.red.join()==='Eliminar tarea' && u.btns.includes('Cancelar') && await page.evaluate(()=>!!document.querySelector('#asheet .grp')), u);
    await ctx.close(); }

  /* ================= d. Hours view ================= */
  { const s=JSON.parse(JSON.stringify(SEED)); for(let i=1;i<=5;i++) s.tasks.push(T('h'+i,{date:tomorrow, title:'Sin hora '+i}));
    const at10=new Date(today+'T00:00:00'); at10.setHours(10,0,0,0); s.tasks.push(T('hb',{date:today, reminder:at10.toISOString(), reminderSent:at10.toISOString(), title:'Con hora'}));
    s.settings.calMode='hours';
    const {ctx, page} = await device(browser, {tag:'Dd', seed:s, desk:true});
    await page.evaluate(()=>setDeskView('week')); await sleep(600);
    const strip = d=>page.evaluate(d=>{ const z=document.querySelector('#desk .hallday[data-day="'+d+'"]'); if(!z) return null; const wl=z.querySelector('.wl'), cs=wl&&getComputedStyle(wl);
      return {cards:z.querySelectorAll('.wcard').length, more:(z.querySelector('.hmore')||{}).textContent||'', ov:cs&&cs.overflowY, mh:cs&&cs.maxHeight, sh:wl&&wl.scrollHeight, ch:wl&&wl.clientHeight}; }, d);
    let st = await strip(tomorrow);
    check('d_three_more', st && st.cards===3 && st.more==='2 más' && st.ov==='visible' && st.mh==='none' && st.sh<=st.ch+1, st);
    await page.screenshot({path:path.join(OUT,'q2-d-hours.png')});
    await page.click('#desk .hallday[data-day="'+tomorrow+'"] .hmore'); await sleep(600);
    const v = await page.evaluate(()=>({view:UI.deskView, day:UI.calDay}));
    check('d_more_opens_day', v.view==='day' && v.day===tomorrow, v);
    st = await strip(tomorrow); check('d_day_three', st && st.cards===3 && st.more==='2 más', st);
    await page.click('#desk .hallday .hmore'); await sleep(500);
    st = await strip(tomorrow); check('d_day_all', st && st.cards===5 && st.more==='Mostrar menos', st);
    await page.screenshot({path:path.join(OUT,'q2-d-day.png')});
    await page.click('#desk .hallday .hmore'); await sleep(500); st = await strip(tomorrow); check('d_day_less', st && st.cards===3, st);
    // Drop onto the strip: a timed block of today dropped on tomorrow's strip takes that date and loses its hour
    await page.evaluate(()=>setDeskView('week')); await sleep(600);
    await page.evaluate(()=>{ const c=document.querySelector('#desk .wcard.hb[data-id="hb"]'); c.scrollIntoView({block:'center'}); }); await sleep(300);
    { const a=await box(page, '#desk .wcard.hb[data-id="hb"]'), z=await box(page, '#desk .hallday[data-day="'+tomorrow+'"]');
      await page.mouse.move(a.cx, a.cy); await page.mouse.down(); await page.mouse.move(a.cx+10, a.cy+10, {steps:3}); await page.mouse.move(z.cx, z.y+8, {steps:10}); await page.mouse.up(); await sleep(700); }
    const hb = await page.evaluate(()=>({date:task('hb').date, rem:task('hb').reminder}));
    check('d_drop_strip', hb.date===tomorrow && !hb.rem, hb);
    st = await strip(tomorrow); check('d_more_after_drop', st && st.cards===3 && st.more==='3 más', st);
    await ctx.close(); }

  /* ================= e. Desktop sidebar: projects reordered by dragging (and Alt with an arrow) ================= */
  { const s=JSON.parse(JSON.stringify(SEED)); s.projects.push(P('p4',{name:'Cuarta', order:3}), P('p5',{name:'Quinta', order:4})); s.projects.find(p=>p.id==='p3').order=2; s.projects.find(p=>p.id==='p2').order=1;
    const {ctx, page} = await device(browser, {tag:'De', seed:s, desk:true});
    const order = ()=>page.evaluate(()=>activeProjects().map(p=>p.id).join(','));
    const nums = ()=>page.evaluate(()=>DB.projects.filter(p=>p.spaceId==='trabajo').sort((a,b)=>a.order-b.order).map(p=>p.id+':'+p.order).join(','));
    const side = id=>'#desk .side .it[data-drop-project="'+id+'"]';
    check('e_start', (await order())==='p1,p3,p4,p5');
    const view0 = await page.evaluate(()=>UI.deskView); const mod0 = await page.evaluate(()=>proj('p1').modified);
    { const a=await box(page, side('p1')), z=await box(page, side('p5'));
      await page.mouse.move(a.cx, a.cy); await page.mouse.down(); await page.mouse.move(a.cx, a.cy+12, {steps:3}); await page.mouse.move(a.cx, z.y+4, {steps:10}); await sleep(150);
      r.e_mid = await page.evaluate(()=>{ const l=document.querySelector('.pline'), q=document.querySelector('#desk .side .it[data-drop-project="p5"]').getBoundingClientRect(), m=l&&new DOMMatrix(getComputedStyle(l).transform);
        return {line:!!l, y:m?Math.round(m.m42):null, top:Math.round(q.top), drag:!!document.querySelector('#desk .side .it.pdrag[data-drop-project="p1"]'), over:document.querySelectorAll('#desk .over').length}; });
      await page.screenshot({path:path.join(OUT,'q2-d-project-drag.png')});
      await page.mouse.up(); await sleep(500); }
    check('e_line', r.e_mid.line && r.e_mid.drag && Math.abs(r.e_mid.y-r.e_mid.top)<=2 && r.e_mid.over===0, r.e_mid);
    const n1 = await nums(), m1 = await page.evaluate(()=>({p1:proj('p1').modified, view:UI.deskView}));
    check('e_dropped', (await order())==='p3,p4,p1,p5' && n1==='p3:0,p4:1,p1:2,p5:3,p2:4' && m1.p1!==mod0 && m1.view===view0 && (await toastOn(page))==='Proyecto movido', {o:await order(), n1, m1});
    check('e_iphone_order', await page.evaluate(()=>[...document.querySelectorAll('#desk .side .it[data-drop-project]')].map(e=>e.dataset.dropProject).join(','))==='p3,p4,p1,p5,');
    await page.click('#toastBtn'); await sleep(400);
    check('e_undo', (await order())==='p1,p3,p4,p5' && (await nums())==='p1:0,p2:1,p3:2,p4:3,p5:4', {o:await order(), n:await nums()});
    // Esc cancels
    { const a=await box(page, side('p1')), z=await box(page, side('p5'));
      await page.mouse.move(a.cx, a.cy); await page.mouse.down(); await page.mouse.move(a.cx, z.cy+8, {steps:10}); await page.keyboard.press('Escape'); await sleep(100);
      const gone = await page.evaluate(()=>!document.querySelector('.pline')&&!document.querySelector('.pdrag')); await page.mouse.up(); await sleep(400);
      check('e_esc_cancels', gone && (await order())==='p1,p3,p4,p5' && (await page.evaluate(()=>UI.deskView))===view0, {gone, o:await order()}); }
    // Sin proyecto does not move
    { const a=await box(page, side('')); await page.mouse.move(a.cx, a.cy); await page.mouse.down(); await page.mouse.move(a.cx, a.cy-80, {steps:8});
      const l = await page.evaluate(()=>!!document.querySelector('.pline')); await page.mouse.up(); await sleep(300); check('e_none_fixed', !l && (await order())==='p1,p3,p4,p5'); }
    // Keyboard: Alt and an arrow on a focused project row
    await page.focus(side('p5')); await page.keyboard.press('Alt+ArrowUp'); await sleep(400);
    check('e_keyboard', (await order())==='p1,p3,p5,p4' && await page.evaluate(()=>document.activeElement&&document.activeElement.dataset.dropProject==='p5'), {o:await order()});
    await page.keyboard.press('Alt+ArrowDown'); await sleep(400); check('e_keyboard_back', (await order())==='p1,p3,p4,p5');
    // A task dropped on a sidebar project still works, with its highlight and no insertion line
    await page.evaluate(()=>setDeskView('todas')); await sleep(400);
    { const a=await box(page, '#desk .main .row[data-id="t3"]'), b=await box(page, side('p4'));
      await page.mouse.move(a.x+a.w/3, a.cy); await page.mouse.down(); await page.mouse.move(b.cx, b.cy, {steps:10}); await page.mouse.move(b.cx+2, b.cy+1, {steps:3});
      r.e_task = await page.evaluate(()=>({over:[...document.querySelectorAll('#desk .over')].map(x=>x.dataset.dropProject), line:!!document.querySelector('.pline')})); await page.mouse.up(); await sleep(500); }
    check('e_task_drop', r.e_task.over.join()==='p4' && !r.e_task.line && await page.evaluate(()=>task('t3').projectId==='p4') && (await order())==='p1,p3,p4,p5', r.e_task);
    // Auto-scroll: a short window and many projects
    await page.setViewportSize({width:1100, height:520}); await page.evaluate(()=>{ for(let i=0;i<25;i++) addProject('Extra '+i, '#FF9500'); render(); }); await sleep(400);
    { const sc0 = await page.evaluate(()=>document.querySelector('#desk .side').scrollTop); const a=await box(page, side('p1')); const sb=await box(page, '#desk .side');
      await page.mouse.move(a.cx, a.cy); await page.mouse.down(); await page.mouse.move(a.cx, sb.y+sb.h-8, {steps:10}); await sleep(900);
      const sc1 = await page.evaluate(()=>document.querySelector('#desk .side').scrollTop); await page.mouse.up(); await sleep(400);
      const idx = await page.evaluate(()=>activeProjects().findIndex(p=>p.id==='p1'));
      check('e_autoscroll', sc1>sc0+40 && idx>8, {sc0, sc1, idx}); }
    await ctx.close(); }

  /* ================= a. Sync: the cascade and its Deshacer reach the other device ================= */
  { const A = await device(browser, {tag:'A', seed:SEED, fake:true});
    await A.page.click('[data-tab=ajustes]'); await sleep(300); await A.page.click('[data-act=signIn]'); check('S_A_sync', await synced(A.page));
    const B = await device(browser, {tag:'B', seed:{spaces:SEED.spaces, projects:[], tasks:[], voiceNotes:[], settings:{tipsSeen:true}}, fake:true, desk:true});
    await B.page.evaluate(()=>setDeskView('settings')); await sleep(300); await B.page.click('[data-act=signIn]'); check('S_B_sync', await synced(B.page));
    const sid = await A.page.evaluate(()=>DB.spaces.find(s=>s.name==='Trabajo').id);
    check('S_B_has', await until(B.page, id=>DB.tasks.filter(x=>x.spaceId===id).length===5 && DB.voiceNotes.length===3 && DB.projects.length===4, sid), await counts(B.page));
    await B.page.evaluate(id=>{ DB.settings.activeSpace=id; save(); setDeskView('hoy'); }, sid); await sleep(300);
    await A.page.evaluate(id=>confirmDeleteSpace(DB.spaces.find(s=>s.id===id)), sid); await sleep(550); await tap(A.page, '#asheet .it.red');
    await until(A.page, ()=>DB.spaces.length===1); await A.page.evaluate(()=>{ window.__undo=undoFn; });
    check('S_A_synced_after', await synced(A.page));
    const srvDel = ()=>({space:!!(fake.t.spaces.get(sid)||{}).deleted, projects:['p1','p2','p3'].every(id=>!!(fake.t.projects.get(id)||{}).deleted), tasks:['t1','t2','t3','t4','t5'].every(id=>!!(fake.t.tasks.get(id)||{}).deleted), vns:['v1','v2'].every(id=>!!(fake.t.voice_notes.get(id)||{}).deleted), keep:!(fake.t.tasks.get('tp1')||{}).deleted&&!(fake.t.voice_notes.get('vp')||{}).deleted&&!(fake.t.projects.get('pp')||{}).deleted});
    let sd = srvDel(); check('S_server_deleted', sd.space && sd.projects && sd.tasks && sd.vns && sd.keep, sd);
    check('S_B_gone', await until(B.page, id=>!DB.spaces.some(s=>s.id===id) && DB.tasks.length===1 && DB.projects.length===1 && DB.voiceNotes.length===1, sid), await counts(B.page));
    const bAct = await B.page.evaluate(()=>({active:DB.settings.activeSpace, ok:DB.spaces.some(s=>s.id===DB.settings.activeSpace), title:(document.querySelector('#desk .sidetitle, #desk .side h1, #desk .spacebtn')||{}).textContent||''}));
    check('S_B_active_moved', bAct.ok, bAct);
    await A.page.evaluate(()=>{ window.__undo(); render(); }); check('S_A_undo_synced', await synced(A.page));
    sd = srvDel(); check('S_server_restored', !sd.space && ['t1','t2','t3','t4','t5'].every(id=>!(fake.t.tasks.get(id)||{}).deleted) && ['p1','p2','p3'].every(id=>!(fake.t.projects.get(id)||{}).deleted) && ['v1','v2'].every(id=>!(fake.t.voice_notes.get(id)||{}).deleted), sd);
    check('S_B_restored', await until(B.page, id=>DB.spaces.some(s=>s.id===id) && DB.tasks.length===6 && DB.projects.length===4 && DB.voiceNotes.length===3, sid), await counts(B.page));
    await A.ctx.close(); await B.ctx.close(); }
  }catch(e){ errors.push('fatal: '+(e&&e.stack||e)); }
  await browser.close(); srv.close();
  console.log(JSON.stringify({r, fails, errors}, null, 1));
  process.exit(fails.length||errors.length?1:0);
})();
