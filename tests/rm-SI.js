require('./lib/out.js'); // outputs (screenshots, downloads) go to tests/out
// Siri and the iOS Shortcut (owner, 4 November), ports 10850 (app), 10851 (fake PostgREST for the function), 10852 (add-task under Deno):
//  1. The spoken words (spokenParse, inboxTask): «Llamar a Marta mañana a las 9 proyecto PAM urgente», «urgente» kept inside the title,
//     a project not found or found twice left in the title, accents and case, «media hora», «una hora», «medio día», punctuation of dictation,
//     a name of two words, the day it was said as the base of «mañana», a time already past that day, never a day before today.
//  2. The pickup through a fake server (SY.remote): a realtime insert makes the task at once on the iPhone (id 'ib-'+row id, the key's space,
//     project, priority, reminder), the row taken, the toast and its Deshacer (the task does not come back), two rows in one toast, the share
//     sheet's link in the notes, a closed day giving tomorrow, the same row taken by two devices making one task, the desktop, and a server
//     without 0010 (logged once, the rest syncs, Ajustes says so).
//  3. Ajustes, Atajo de iOS (iPhone light and dark, desktop): signed out, Crear clave (only the sha-256 goes up; the key shown once), Copiar
//     clave, Copiar dirección, Espacio (Deloitte by default, stored on the key), Crear clave nueva and Revocar clave. Screenshots in tests/out/SI.
//  4. SQL: 0010_inbox.sql twice in PGlite after 0001 to 0009 (row level security of both tables, only taken can change, no client inserts in
//     the inbox, realtime), then all.sql twice and check.sql all OK.
//  5. The Edge Function add-task under Deno against a fake PostgREST: good key (JSON, x-tareas-key, plain text, forms), no key, bad key,
//     revoked, empty, too long, a long link, the hourly limit, GET.
const { chromium } = require('playwright');
const http = require('http'); const fs = require('fs'); const path = require('path'); const crypto = require('crypto'); const { spawn } = require('child_process');
const ROOT = path.resolve(__dirname, '..'), PORT = 10850, REST_PORT = 10851, FN_PORT = 10852, URL0 = 'http://localhost:'+PORT+'/';
const OUT = path.join(__dirname, 'out', 'SI'); fs.mkdirSync(OUT, {recursive:true});
const DEPS = path.join(ROOT, 'node_modules');
const TYPES = {'.html':'text/html','.css':'text/css','.js':'application/javascript','.webmanifest':'application/manifest+json','.png':'image/png'};
const srv = http.createServer((req,res)=>{ let p = decodeURIComponent(req.url.split('?')[0]); if(p==='/') p='/index.html';
  if(p==='/config.js'){ res.writeHead(200,{'Content-Type':'application/javascript'}); res.end('window.TAREAS_CONFIG = {"url":null,"anonKey":null};\n'); return; }
  const f=path.join(ROOT,p); if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){ res.writeHead(404,{'Content-Type':'text/html'}); res.end('<h1>404</h1>'); return; }
  res.writeHead(200,{'Content-Type':TYPES[path.extname(f)]||'application/octet-stream'}); res.end(fs.readFileSync(f)); });
const r={}, fails=[], errors=[]; const check=(name, ok, info)=>{ r[name]=ok?true:(info===undefined?false:info); if(!ok) fails.push(name); };
const sleep=ms=>new Promise(res=>setTimeout(res,ms));
const shot=(page, name)=>page.screenshot({path:path.join(OUT, name+'.png')});
const sha = s => crypto.createHash('sha256').update(s, 'utf8').digest('hex');

const AT = (d, h, m) => new Date(2026, 10, d, h, m, 0); // November 2026, local: Wednesday 4 is "today" in part 1
const T0 = '2026-11-01T08:00:00.000Z';
const SEED = () => ({ spaces:[{id:'trabajo',name:'Trabajo',order:0,created:T0},{id:'personal',name:'Personal',order:1,created:T0},{id:'sp-dlt',name:'Deloitte',order:2,created:T0,modified:T0}],
  projects:[ {id:'p-pam', spaceId:'sp-dlt', name:'PAM', color:'#007AFF', order:0, archived:false, created:T0, modified:T0},
    {id:'p-oca', spaceId:'sp-dlt', name:'OCA', color:'#FF9500', order:1, archived:false, created:T0, modified:T0},
    {id:'p-form', spaceId:'sp-dlt', name:'Formación', color:'#34C759', order:2, archived:false, created:T0, modified:T0},
    {id:'p-fmt', spaceId:'sp-dlt', name:'Formatos', color:'#AF52DE', order:3, archived:false, created:T0, modified:T0},
    {id:'p-f2', spaceId:'sp-dlt', name:'Fase 2', color:'#5856D6', order:4, archived:false, created:T0, modified:T0},
    {id:'p-arch', spaceId:'sp-dlt', name:'Archivo viejo', color:'#8E8E93', order:5, archived:true, created:T0, modified:T0},
    {id:'p-casa', spaceId:'personal', name:'Casa', color:'#FF2D55', order:0, archived:false, created:T0, modified:T0} ],
  tasks:[], voiceNotes:[], attachments:[], subtasks:[], projectNotes:[], settings:{tipsSeen:true, activeSpace:'trabajo'} });
async function open(browser, o){
  const vp = o.desk ? {viewport:{width:1280,height:800}, deviceScaleFactor:1} : {viewport:{width:390,height:844}, deviceScaleFactor:2, isMobile:true, hasTouch:true};
  const ctx = await browser.newContext(Object.assign(vp, {colorScheme:o.theme||'light'})); const page = await ctx.newPage();
  if(o.now) await page.clock.install({time:o.now});
  page.on('pageerror', e=>errors.push(o.tag+' pageerror: '+e.message)); page.on('console', m=>{ if(m.type()==='error') errors.push(o.tag+' console: '+m.text()); });
  await page.addInitScript(()=>{ window.__copied=[]; try{ Object.defineProperty(navigator, 'clipboard', {configurable:true, value:{writeText:t=>{ window.__copied.push(t); return Promise.resolve(); }}}); }catch(e){} });
  if(o.fake){ await page.exposeBinding('fakeServer', (src, op, a)=>o.fake.handle(src.page, op, a)); await page.addInitScript(fakeAdapter); await page.addInitScript(u=>{ window.__fakeUser=u; }, USER); }
  await page.addInitScript(s=>{ if(!localStorage.getItem('tareas-v1')) localStorage.setItem('tareas-v1', s); }, JSON.stringify(o.seed||SEED()));
  await page.goto(URL0); await until(page, ()=>typeof DB!=='undefined'&&!!document.querySelector(UI.wide?'#desk .main':'.screen.root')); return {ctx, page};
}
const ev = (page, fn, arg) => page.evaluate(fn, arg);
const until = async (page, fn, arg, ms=8000)=>{ const t0=Date.now(); for(;;){ let v=false; try{ v=await page.evaluate(fn, arg); }catch(e){} if(v) return true; if(Date.now()-t0>ms) return false; await sleep(80); } };
const calm = page => until(page, ()=>!app.classList.contains('navigating') && !HELD.size && !document.querySelector('.row.leaving, .flip, .enter') && !touchDrag);
const menuSettled = page => until(page, ()=>menuOpen() && !menuFresh() && !document.querySelector('#pmenu').getAnimations({subtree:true}).some(a=>a.playState==='running'));
const menuLabels = page => ev(page, ()=>[...document.querySelectorAll('#pmenu .pm-it')].map(b=>b.querySelector('.pm-l').firstChild.textContent));
async function clickItem(page, label){ await menuSettled(page); const ok=await ev(page, l=>{ const b=[...document.querySelectorAll('#pmenu .pm-it')].reverse().find(x=>x.querySelector('.pm-l').firstChild.textContent===l); if(!b) return false; b.click(); return true; }, label); if(!ok) throw new Error('no menu item '+label); }
const toastText = page => ev(page, ()=>document.querySelector('#toast').classList.contains('on')?document.querySelector('#toastText').textContent:'');
// The confirmation: the action sheet on the iPhone, the macOS alert on the desktop; its action button, once its fresh guard is over
async function confirm(page){ await until(page, ()=>document.querySelector('#asheet').classList.contains('on') && !sheetFresh());
  await ev(page, ()=>{ const a=document.querySelector('#asheet'); const b=a.querySelector('.it.red')||a.querySelector('[data-ok]')||[...a.querySelectorAll('button')].pop(); b.click(); }); }
const section = page => ev(page, ()=>{ const t=[...document.querySelectorAll('.group-title')].find(g=>g.textContent==='Atajo de iOS'); if(!t) return null; const g=t.nextElementSibling, f=g.nextElementSibling;
  return {cells:[...g.children].map(c=>c.textContent.replace(/\s+/g,' ').trim()), foot:f&&f.classList.contains('footnote')?f.textContent:''}; });
const scrollToSection = page => ev(page, ()=>{ const t=[...document.querySelectorAll('.group-title')].find(g=>g.textContent==='Atajo de iOS'); if(t) t.scrollIntoView({block:'start'}); });

/* ======================= 1. The spoken words ======================= */
async function grammar(browser){ let x;
  const {ctx, page} = await open(browser, {tag:'G', now:AT(4,10,0)});
  x = await ev(page, ()=>{ const P=(t, base)=>{ const q=spokenParse(t, {spaceId:'sp-dlt', base}); return [q.title, q.date, q.time?q.time.h+':'+q.time.m:null, q.projectId, q.priority, q.estimate].join('|'); };
    return {
      main:P('Llamar a Marta mañana a las 9 proyecto PAM urgente'),
      order:P('Llamar a Marta urgente proyecto pam a las 9 mañana'),
      inside:P('Revisar contrato urgente de OCA'),
      alta:P('Enviar acta PROYECTO formacion PRIORIDAD ALTA'),
      media:P('Escribir correo prioridad media 15 minutos.'),
      ambiguous:P('Preparar informe proyecto form'),
      unknown:P('Preparar informe proyecto xyz mañana'),
      archived:P('Ordenar papeles proyecto archivo'),
      otherSpace:P('Pintar proyecto casa'),
      halfHour:P('Revisar presupuesto media hora'),
      hour:P('Llamar al banco una hora el viernes'),
      inHour:P('Llamar en una hora'),
      halfDay:P('Preparar oferta medio día'),
      lunch:P('Comida de medio día'),
      two:P('Revisar entregables proyecto Fase 2'),
      comma:P('Llamar a Marta, mañana.'),
      typed:P('Correo #oca !!! 30m'),
      evening:P('Cena a las 9 de la noche'),
      accent:P('Reunión el MIÉRCOLES'),
      base:P('Llamar mañana', '2026-11-03'),
      alone:P('Mañana'),
    }; });
  check('g_main', x.main==='Llamar a Marta|2026-11-05|9:0|p-pam|high|', x.main);
  check('g_any_order', x.order==='Llamar a Marta|2026-11-05|9:0|p-pam|high|', x.order);
  check('g_urgente_inside', x.inside==='Revisar contrato urgente de OCA|||||', x.inside);
  check('g_accents_case', x.alta==='Enviar acta|||p-form|high|', x.alta);
  check('g_media_15_punct', x.media==='Escribir correo||||mid|15', x.media);
  check('g_ambiguous_kept', x.ambiguous==='Preparar informe proyecto form|||||', x.ambiguous);
  check('g_unknown_kept', x.unknown==='Preparar informe proyecto xyz|2026-11-05||||', x.unknown);
  check('g_archived_not', x.archived==='Ordenar papeles proyecto archivo|||||', x.archived);
  check('g_other_space_not', x.otherSpace==='Pintar proyecto casa|||||', x.otherSpace);
  check('g_media_hora', x.halfHour==='Revisar presupuesto|||||30', x.halfHour);
  check('g_una_hora', x.hour==='Llamar al banco|2026-11-06||||60', x.hour);
  check('g_en_una_hora', x.inHour==='Llamar en una hora|||||', x.inHour);
  check('g_medio_dia', x.halfDay==='Preparar oferta|||||240' && x.lunch==='Comida de medio día|||||', [x.halfDay, x.lunch]);
  check('g_two_words', x.two==='Revisar entregables|||p-f2||', x.two);
  check('g_comma', x.comma==='Llamar a Marta|2026-11-05||||', x.comma);
  check('g_typed', x.typed==='Correo|||p-oca|high|30', x.typed);
  check('g_evening', x.evening==='Cena||21:0|||', x.evening);
  check('g_weekday_accent', x.accent==='Reunión|2026-11-11||||', x.accent);
  check('g_base_day', x.base==='Llamar|2026-11-04||||', x.base);
  check('g_alone', x.alone==='Mañana|||||', x.alone);
  // inboxTask: the day it was said, a closed day, a time already past, never before today
  x = await ev(page, ()=>{ const T=(text, created, o)=>{ const t=inboxTask(Object.assign({id:'r', text, created, source:'siri'}, o||{}), 'sp-dlt'); return [t.id, t.title, t.date, t.reminder?fmtTime(t.reminder):null, t.reminderSent?'sent':'', t.projectId, t.priority, t.notes, t.spaceId].join('|'); };
    const iso=(d,h,m)=>new Date(2026,10,d,h,m).toISOString();
    const out={ now:T('Llamar a Marta mañana a las 9 proyecto PAM urgente', iso(4,9,50)),
      plain:T('Comprar pan', iso(4,9,50)),
      yesterday:T('Revisar oferta', iso(3,22,0)),
      tomorrowSaidYesterday:T('Llamar mañana', iso(3,22,0)),
      pastTime:T('Llamar a las 9', iso(3,22,0)),
      futureTime:T('Llamar a las 11', iso(4,9,50)),
      laterToday:T('Llamar a las 8', iso(4,9,50)),
      share:T('Leer artículo', iso(4,9,50), {source:'share', url:'https://example.com/a'}),
      shareSiri:T('Leer', iso(4,9,50), {source:'siri', url:'https://example.com/b'}),
      shareOnly:T('https://example.com/c', iso(4,9,50), {source:'share', url:'https://example.com/c'}) };
    const sp=DB.spaces.find(s=>s.id==='sp-dlt'); sp.closedDay='2026-11-04'; out.closed=T('Comprar pan', iso(4,9,50)); out.closedSaid=T('Comprar pan hoy', iso(4,9,50)); sp.closedDay=null;
    return out; });
  check('t_now', x.now==='ib-r|Llamar a Marta|2026-11-05|09:00||p-pam|high||sp-dlt', x.now);
  check('t_plain_today', x.plain==='ib-r|Comprar pan|2026-11-04||||none||sp-dlt', x.plain);
  check('t_yesterday_today', x.yesterday==='ib-r|Revisar oferta|2026-11-04||||none||sp-dlt', x.yesterday);
  check('t_base_said_day', x.tomorrowSaidYesterday==='ib-r|Llamar|2026-11-04||||none||sp-dlt', x.tomorrowSaidYesterday);
  check('t_past_time_next_day', x.pastTime==='ib-r|Llamar|2026-11-04|09:00|sent||none||sp-dlt', x.pastTime); // said at 22:00 on the 3rd: 9:00 of the 4th, already past at 10:00
  check('t_future_time', x.futureTime==='ib-r|Llamar|2026-11-04|11:00|||none||sp-dlt', x.futureTime);
  check('t_time_next_day', x.laterToday==='ib-r|Llamar|2026-11-05|08:00|||none||sp-dlt', x.laterToday); // 8:00 had passed when it was said
  check('t_share_url', x.share==='ib-r|Leer artículo|2026-11-04||||none|https://example.com/a|sp-dlt' && x.shareSiri.split('|')[7]==='' && x.shareOnly.split('|')[1]==='https://example.com/c' && x.shareOnly.split('|')[7]==='', [x.share, x.shareSiri, x.shareOnly]);
  check('t_closed_tomorrow', x.closed.split('|')[2]==='2026-11-05' && x.closedSaid.split('|')[2]==='2026-11-04', [x.closed, x.closedSaid]);
  // The typed quick add is unchanged: no spoken words there
  x = await ev(page, ()=>{ DB.settings.activeSpace='sp-dlt'; const q=quickTask('Llamar proyecto PAM urgente'); DB.settings.activeSpace='trabajo'; return [q.title, q.projectId, q.priority].join('|'); });
  check('typed_unchanged', x==='Llamar proyecto PAM urgente||none', x);
  await ctx.close();
}

/* ======================= Fake server ======================= */
const TABLES = ['spaces','projects','tasks','voice_notes','attachments','subtasks','project_notes'];
class Fake {
  constructor(o){ o=o||{}; this.noInbox=!!o.noInbox; this.t={}; TABLES.forEach(x=>this.t[x]=new Map()); this.last=0; this.subs=new Map(); this.inbox=[]; this.keys=new Map(); this.noTake=false; this.calls=[]; }
  ts(){ this.last=Math.max(Date.now(), this.last+1); return new Date(this.last).toISOString(); }
  write(owner, table, rows){ if(!owner) throw new Error('JWT required'); const ts=this.ts(), out=[], changed=[], m=this.t[table];
    rows.forEach(r=>{ const ex=m.get(r.id);
      if(!ex){ const row=Object.assign({created:null, deleted:null}, r, {owner_id:owner, server_ts:ts}); m.set(r.id,row); out.push({id:r.id}); changed.push(row); return; }
      if(Date.parse(r.modified) < Date.parse(ex.modified)) return;
      Object.assign(ex, r, {owner_id:ex.owner_id, server_ts:ts}); out.push({id:r.id}); changed.push(ex); });
    changed.forEach(row=>this.notify(table, row)); return out; }
  notify(table, row){ const copy=JSON.parse(JSON.stringify(row)); for(const [page, uid] of this.subs){ if(uid!==row.owner_id) continue; setTimeout(()=>{ page.evaluate(([t,r])=>window.__fakeRT&&window.__fakeRT(t,r), [table, copy]).catch(()=>{}); }, 40); } }
  rows(owner, table){ return [...this.t[table].values()].filter(r=>r.owner_id===owner); }
  // What add-task does: a row in the owner's inbox, and the realtime insert
  say(text, o){ o=o||{}; const row={id:crypto.randomUUID(), owner_id:USER.uid, text, url:o.url||null, source:o.source||'siri', created:o.created||new Date().toISOString(), taken:null}; this.inbox.push(row); if(!o.quiet) this.notify('inbox', row); return row; }
  absent(name){ const e=new Error('Could not find the table \'public.'+name+'\' in the schema cache'); e.code='PGRST205'; return e; }
  handle(page, op, a){ const own=a&&a.owner; this.calls.push(op);
    switch(op){
      case 'signIn': return {id:a.uid, email:a.email};
      case 'pull': { let rs=this.rows(own, a.table); if(a.after) rs=rs.filter(x=>Date.parse(x.server_ts)>Date.parse(a.after)); rs.sort((x,y)=>x.server_ts<y.server_ts?-1:x.server_ts>y.server_ts?1:x.id<y.id?-1:1); return JSON.parse(JSON.stringify(rs.slice(0,a.limit))); }
      case 'byIds': return JSON.parse(JSON.stringify(this.rows(own, a.table).filter(x=>a.ids.includes(x.id))));
      case 'upsert': return this.write(own, a.table, a.rows);
      case 'markDeleted': return this.write(own, a.table, a.items.map(x=>({id:x.id, deleted:x.ts, modified:x.ts})));
      case 'subscribe': this.subs.set(page, a.uid); return true;
      case 'unsubscribe': this.subs.delete(page); return true;
      case 'inboxList': if(this.noInbox) throw this.absent('inbox'); if(!own) throw new Error('JWT required');
        return JSON.parse(JSON.stringify(this.inbox.filter(x=>x.owner_id===own&&!x.taken).sort((x,y)=>x.created<y.created?-1:1).map(({id,text,url,source,created})=>({id,text,url,source,created}))));
      case 'inboxTake': if(this.noTake) return []; return this.inbox.filter(x=>x.owner_id===own&&a.ids.includes(x.id)).map(x=>{ x.taken=a.ts; return {id:x.id}; });
      case 'keyGet': if(this.noInbox) throw this.absent('shortcut_keys'); { const k=this.keys.get(own); return k?{space_id:k.space_id, created:k.created, revoked:k.revoked}:null; }
      case 'keyPut': if(a.row.owner_id!==own) throw new Error('new row violates row-level security policy'); this.keys.set(own, Object.assign({}, a.row)); return null;
      case 'keyPatch': { if(a.owner_id!==own) return []; const k=this.keys.get(own); if(!k) return []; Object.assign(k, a.patch); return [{owner_id:own}]; }
    } throw new Error('op '+op); }
}
const USER = {uid:'9b2f6d3e-0000-4000-8000-00000000c5a1', email:'enric@example.com'};
function fakeAdapter(){
  const call=(op,a)=>{ if(!navigator.onLine) return Promise.reject(new TypeError('Failed to fetch')); return window.fakeServer(op,a); };
  const owner=()=>{ const s=JSON.parse(localStorage.getItem('fake-session')||'null'); return s&&s.id; };
  const missing=new Set();
  window.__tareasRemote = { missing, baseUrl:'https://abcdefghijklmnopqrst.supabase.co',
    async init(){ return JSON.parse(localStorage.getItem('fake-session')||'null'); },
    onAuth(cb){ window.__fakeAuth=cb; },
    async signIn(){ const u=await window.fakeServer('signIn', {uid:window.__fakeUser.uid, email:window.__fakeUser.email}); localStorage.setItem('fake-session', JSON.stringify(u)); setTimeout(()=>window.__fakeAuth&&window.__fakeAuth(u,'SIGNED_IN'),0); },
    async signOut(){ localStorage.removeItem('fake-session'); },
    pull:(table, after, limit)=>call('pull',{owner:owner(), table, after, limit}),
    byIds:(table, ids)=>call('byIds',{owner:owner(), table, ids}),
    upsert:(table, rows)=>call('upsert',{owner:owner(), table, rows}),
    markDeleted:(table, items)=>call('markDeleted',{owner:owner(), table, items}),
    subscribe(uid, onRow, onStatus){ window.__fakeRT=(t,r)=>onRow(t,r); window.fakeServer('subscribe',{uid}); setTimeout(()=>onStatus('SUBSCRIBED'),0); return ()=>{ window.__fakeRT=null; window.fakeServer('unsubscribe',{}); }; },
    // As the real adapter: a missing table is noted through syncAbsent and answers empty
    async inboxList(){ try{ return await call('inboxList', {owner:owner()}); }catch(e){ if(syncAbsent(missing, 'inbox', e)) return []; throw e; } },
    inboxTake:(ids, ts)=>call('inboxTake', {owner:owner(), ids, ts}),
    async keyGet(){ try{ return await call('keyGet', {owner:owner()}); }catch(e){ if(syncAbsent(missing, 'shortcut_keys', e)) return null; throw e; } },
    keyPut:row=>call('keyPut', {owner:owner(), row}),
    keyPatch:(owner_id, patch)=>call('keyPatch', {owner:owner(), owner_id, patch})
  };
}
const synced = page => until(page, ()=>SY&&SY.user&&!SY.running&&SY.status==='ok'&&syncCollect(true).count===0);
const goSettings = async page => { await ev(page, ()=>{ if(UI.wide) setDeskView('settings'); else { switchTab('ajustes'); } }); await calm(page); };
const goHoy = async page => { await ev(page, ()=>{ if(UI.wide) setDeskView('hoy'); else switchTab('tareas'); }); await calm(page); };

/* ======================= 2 and 3. Pickup and Ajustes ======================= */
async function app(browser){ let x;
  // Signed out: the section says to sign in first
  { const fk=new Fake(); const S=await open(browser, {tag:'O', fake:fk}); await goSettings(S.page);
    x = await section(S.page); check('so_section', x && x.cells.join()==='Siri y AtajosSin cuenta' && /Inicia sesión primero/.test(x.foot), x); await S.ctx.close(); }
  const fake = new Fake();
  const A = await open(browser, {tag:'A', fake});
  await ev(A.page, ()=>syncSignIn()); check('A_synced', await synced(A.page));
  await goSettings(A.page); await until(A.page, ()=>SK.for===SY.user.id);
  x = await section(A.page); check('ui_none', x && x.cells.join('|')==='ClaveNinguna|EspacioDeloitte|Crear clave' && /un atajo de la app Atajos/.test(x.foot), x);
  await scrollToSection(A.page); await shot(A.page, 'i-ajustes-none-light');
  // Espacio before a key: kept for its creation
  await A.page.click('[data-act=scSpace]'); await menuSettled(A.page); x = await menuLabels(A.page); check('ui_space_menu', x.join()==='Trabajo,Personal,Deloitte', x);
  await clickItem(A.page, 'Trabajo'); await calm(A.page); x = await section(A.page); check('ui_space_local', x.cells[1]==='EspacioTrabajo' && !fake.keys.size, x);
  await A.page.click('[data-act=scSpace]'); await clickItem(A.page, 'Deloitte'); await calm(A.page);
  // Crear clave: only the hash goes up, with the space; the key shown once with the address
  await A.page.click('[data-act=scCreate]'); await until(A.page, ()=>!!SK.newKey&&!SK.busy);
  const key = await ev(A.page, ()=>SK.newKey), krow = fake.keys.get(USER.uid);
  check('key_shape', /^[A-Za-z0-9_-]{43}$/.test(key), key);
  check('key_hash_only', krow && krow.key_hash===sha(key) && krow.space_id==='sp-dlt' && krow.revoked===null && !JSON.stringify(krow).includes(key), krow);
  x = await section(A.page); check('ui_active', x.cells[0]==='ClaveCreada hoy' && x.cells[1]==='Clave nueva'+key && x.cells[2]==='Copiar clave' && x.cells[3]==='Direcciónhttps://abcdefghijklmnopqrst.supabase.co/functions/v1/add-task' && x.cells[4]==='Copiar dirección' && x.cells[5]==='EspacioDeloitte' && x.cells[6]==='Crear clave nueva' && x.cells[7]==='Revocar clave' && /no se volverá a mostrar/.test(x.foot), x);
  x = await ev(A.page, ()=>({stored:JSON.stringify(localStorage).includes(SK.newKey), log:LOG.some(e=>/Clave del atajo creada/.test(e.m)), leak:LOG.some(e=>JSON.stringify(e).includes(SK.newKey))}));
  check('key_not_stored', !x.stored && x.log && !x.leak, x);
  await scrollToSection(A.page); await shot(A.page, 'i-ajustes-key-light');
  await A.page.click('[data-act=scCopyKey]'); await A.page.click('[data-act=scCopyUrl]');
  x = await ev(A.page, ()=>({c:window.__copied.slice(), t:document.querySelector('#toastText').textContent}));
  check('ui_copy', x.c[0]===key && x.c[1]==='https://abcdefghijklmnopqrst.supabase.co/functions/v1/add-task' && x.t==='Dirección copiada', x);
  // Espacio with a key: stored on the server row
  await A.page.click('[data-act=scSpace]'); await clickItem(A.page, 'Trabajo'); await until(A.page, ()=>document.querySelector('#toastText').textContent.startsWith('Las tareas de Siri irán a'));
  const tid = await ev(A.page, ()=>DB.spaces.find(s=>s.name==='Trabajo').id);
  check('ui_space_server', fake.keys.get(USER.uid).space_id===tid && tid!=='trabajo', fake.keys.get(USER.uid));
  await A.page.click('[data-act=scSpace]'); await clickItem(A.page, 'Deloitte'); await until(A.page, ()=>document.querySelector('#toastText').textContent==='Las tareas de Siri irán a Deloitte');
  check('ui_space_back', fake.keys.get(USER.uid).space_id==='sp-dlt');

  /* ---------- Pickup on the iPhone ---------- */
  await goHoy(A.page); await ev(A.page, ()=>{ DB.settings.activeSpace='sp-dlt'; save(); render(); }); await calm(A.page);
  await A.page.click('.screen.root .seg [data-filter=todas]'); await calm(A.page); // the task is for tomorrow
  const said = fake.say('Llamar a Marta mañana a las 9 proyecto PAM urgente');
  const tidA = 'ib-'+said.id;
  check('pick_task', await until(A.page, id=>!!task(id), tidA), await ev(A.page, ()=>LOG.slice(-5)));
  x = await ev(A.page, id=>{ const t=task(id); const tm=addDays(todayStr(),1), r=new Date(tm+'T00:00:00'); r.setHours(9,0,0,0); return {ok:t.title==='Llamar a Marta'&&t.date===tm&&t.reminder===r.toISOString()&&!t.reminderSent&&t.projectId==='p-pam'&&t.priority==='high'&&t.spaceId==='sp-dlt', t, toast:document.querySelector('#toastText').textContent, log:LOG.filter(e=>/Tarea recibida desde Siri/.test(e.m)).length}; }, tidA);
  check('pick_fields', x.ok, x.t); check('pick_toast', x.toast==='1 tarea recibida desde Siri', x.toast); check('pick_log', x.log===1, x.log);
  await until(A.page, id=>!!document.querySelector('.screen.root .row[data-id="'+id+'"]'), tidA); await shot(A.page, 'i-pickup-light');
  // Deshacer (within the toast's 4 seconds): the task goes, also on the server, and never comes back
  await ev(A.page, ()=>document.querySelector('#toastBtn').click()); await calm(A.page);
  check('undo_gone', await until(A.page, id=>!task(id), tidA));
  check('pick_taken', !!fake.inbox.find(q=>q.id===said.id).taken);
  check('undo_server', await synced(A.page) && !!fake.t.tasks.get(tidA) && !!fake.t.tasks.get(tidA).deleted, fake.t.tasks.get(tidA)); // it went up in the pass that took it
  await ev(A.page, ()=>syncRun('manual')); await synced(A.page);
  check('undo_stays_gone', await ev(A.page, id=>!task(id), tidA));
  // Two rows at once: one toast; a shared link in the notes
  fake.say('Comprar pan', {quiet:true}); const sh = fake.say('Leer artículo', {source:'share', url:'https://example.com/articulo', quiet:true});
  await ev(A.page, ()=>syncRun('manual')); await synced(A.page);
  x = await ev(A.page, id=>({t:task(id), toast:document.querySelector('#toastText').textContent, n:DB.tasks.filter(t=>t.id.startsWith('ib-')).length}), 'ib-'+sh.id);
  check('pick_two', x.toast==='2 tareas recibidas desde Siri' && x.n===2, x); // the undone one is gone
  check('pick_share', x.t && x.t.notes==='https://example.com/articulo' && x.t.title==='Leer artículo' && x.t.date===await ev(A.page, ()=>todayStr()), x.t);
  check('pick_all_taken', fake.inbox.every(q=>!!q.taken));
  // A closed day: what was said without a date goes to tomorrow
  await ev(A.page, ()=>{ const sp=DB.spaces.find(s=>s.id==='sp-dlt'); sp.closedDay=todayStr(); sp.modified=new Date().toISOString(); save(); }); await synced(A.page);
  const cl = fake.say('Revisar cierre');
  check('pick_closed', await until(A.page, id=>!!task(id)&&task(id).date===addDays(todayStr(),1), 'ib-'+cl.id), await ev(A.page, id=>task(id), 'ib-'+cl.id));
  await ev(A.page, ()=>{ const sp=DB.spaces.find(s=>s.id==='sp-dlt'); sp.closedDay=null; sp.modified=new Date().toISOString(); save(); }); await synced(A.page);

  /* ---------- Desktop: the same account ---------- */
  const B = await open(browser, {tag:'B', fake, desk:true});
  await ev(B.page, ()=>syncSignIn()); check('B_synced', await synced(B.page));
  check('B_has_tasks', await until(B.page, id=>!!task(id), 'ib-'+cl.id));
  const sb = fake.say('Preparar SteerCo proyecto OCA prioridad media una hora');
  check('B_pick', await until(B.page, id=>{ const t=task(id); return !!t&&t.projectId==='p-oca'&&t.priority==='mid'&&t.estimate===60&&t.title==='Preparar SteerCo'; }, 'ib-'+sb.id), await ev(B.page, id=>task(id), 'ib-'+sb.id));
  check('A_gets_it_once', await until(A.page, id=>DB.tasks.filter(t=>t.id===id).length===1, 'ib-'+sb.id));
  await ev(B.page, ()=>{ DB.settings.activeSpace='sp-dlt'; save(); render(); }); await calm(B.page); await shot(B.page, 'd-pickup-light');
  await goSettings(B.page); await until(B.page, ()=>SK.for===SY.user.id);
  x = await section(B.page); check('B_section', x && x.cells[0]==='ClaveCreada hoy' && x.cells[1]==='Direcciónhttps://abcdefghijklmnopqrst.supabase.co/functions/v1/add-task' && x.cells[3]==='EspacioDeloitte' && !x.cells.some(c=>/Clave nueva/.test(c)), x); // the key itself only where it was made
  await scrollToSection(B.page); await shot(B.page, 'd-ajustes-light');
  // The same row taken by two devices at once (offline take): one task with one id
  fake.noTake = true; const both = fake.say('Enviar acta', {quiet:true});
  await Promise.all([ev(A.page, ()=>inboxPickup()), ev(B.page, ()=>inboxPickup())]);
  x = await Promise.all([A, B].map(D=>ev(D.page, id=>DB.tasks.filter(t=>t.id===id).length, 'ib-'+both.id)));
  check('two_devices_local', x[0]===1 && x[1]===1, x);
  await ev(A.page, ()=>syncRun('manual')); await synced(A.page); await ev(B.page, ()=>syncRun('manual')); await synced(B.page); await ev(A.page, ()=>syncRun('manual')); await synced(A.page);
  x = await Promise.all([A, B].map(D=>ev(D.page, id=>DB.tasks.filter(t=>t.id===id).length, 'ib-'+both.id)));
  const serverN = [...fake.t.tasks.values()].filter(t=>t.title==='Enviar acta').length;
  check('two_devices_one', x[0]===1 && x[1]===1 && serverN===1, {x, serverN});
  x = await ev(A.page, ()=>[ibDone().length, LOG.filter(e=>/Tarea recibida desde Siri/.test(e.m)).length]);
  fake.noTake = false; await ev(A.page, ()=>syncRun('manual')); await synced(A.page);
  const y = await ev(A.page, ()=>[ibDone().length, LOG.filter(e=>/Tarea recibida desde Siri/.test(e.m)).length]);
  check('take_later', !!fake.inbox.find(q=>q.id===both.id).taken && y[1]===x[1] && y[0]<x[0], {x, y});
  // Crear clave nueva (confirmed) and Revocar clave, on the desktop
  await B.page.click('[data-act=scCreate]'); await confirm(B.page); await until(B.page, ()=>!!SK.newKey&&!SK.busy);
  const key2 = await ev(B.page, ()=>SK.newKey); check('key_new', key2!==key && fake.keys.get(USER.uid).key_hash===sha(key2) && fake.keys.get(USER.uid).space_id==='sp-dlt');
  await until(B.page, ()=>!document.querySelector('#asheet').classList.contains('on')); await sleep(400); await shot(B.page, 'd-ajustes-key-light');
  await B.page.click('[data-act=scRevoke]'); await confirm(B.page); await until(B.page, ()=>!!SK.row&&!!SK.row.revoked);
  x = await section(B.page); check('revoked', !!fake.keys.get(USER.uid).revoked && x.cells.join('|')==='ClaveRevocada|EspacioDeloitte|Crear clave', x);
  await A.ctx.close(); await B.ctx.close();

  /* ---------- iPhone dark ---------- */
  { const D = await open(browser, {tag:'AD', fake, theme:'dark'}); await ev(D.page, ()=>syncSignIn()); await synced(D.page);
    await goSettings(D.page); await until(D.page, ()=>SK.for===SY.user.id); await D.page.click('[data-act=scCreate]'); await until(D.page, ()=>!!SK.newKey&&!SK.busy);
    await scrollToSection(D.page); await shot(D.page, 'i-ajustes-key-dark');
    await goHoy(D.page); const sd = fake.say('Llamar al proveedor');
    check('dark_pick', await until(D.page, id=>!!task(id), 'ib-'+sd.id)); await ev(D.page, ()=>{ DB.settings.activeSpace='sp-dlt'; save(); render(); }); await calm(D.page); await shot(D.page, 'i-pickup-dark');
    await D.ctx.close(); }

  /* ---------- A server without 0010 ---------- */
  const nf = new Fake({noInbox:true}), C = await open(browser, {tag:'C', fake:nf});
  await ev(C.page, ()=>syncSignIn()); check('ni_synced', await synced(C.page));
  await ev(C.page, ()=>{ addTask({title:'Sigue sincronizando'}); }); await synced(C.page); await ev(C.page, ()=>syncRun('manual')); await synced(C.page);
  x = await ev(C.page, ()=>({warns:LOG.filter(e=>/0010_inbox/.test(e.m)).map(e=>e.m), errs:LOG.filter(e=>e.l==='error').map(e=>e.m)}));
  check('ni_logged_once', x.warns.length===1 && /tabla inbox/.test(x.warns[0]) && !x.errs.length, x);
  check('ni_rest_syncs', [...nf.t.tasks.values()].some(t=>t.title==='Sigue sincronizando'));
  await goSettings(C.page); x = await section(C.page); check('ni_section', x && x.cells.join()==='Siri y AtajosNo disponible' && /0010_inbox\.sql/.test(x.foot), x);
  check('ni_no_inbox_calls', nf.calls.filter(c=>c==='inboxList').length===1, nf.calls.filter(c=>c==='inboxList').length);
  await C.ctx.close();
}

/* ======================= 4. SQL ======================= */
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
    grant usage on schema public to service_role, authenticated, anon;
  `);
  return db; }
const strip = s => s.replace(/^create extension if not exists pg_(cron|net).*$/mg, '-- (extension stand-in)');
async function sqlTests(){
  const rd = f => fs.readFileSync(path.join(ROOT, 'supabase/migrations', f), 'utf8'), mig = rd('0010_inbox.sql');
  const rest = mig.replace(/drop (policy|trigger) if exists/gi, '').replace(/on delete cascade/gi, '');
  check('sql_no_drop_delete', !/drop|delete/i.test(rest), (rest.match(/.*(drop|delete).*/gi)||[]).slice(0,3));
  let db = await pgSetup();
  for(const f of fs.readdirSync(path.join(ROOT,'supabase/migrations')).filter(f=>f.endsWith('.sql')&&f<'0010').sort()) await db.exec(strip(rd(f)));
  let err = null; try { await db.exec(mig); await db.exec(mig); } catch(e){ err = e.message; }
  check('sql_runs_twice', !err, err);
  const q = async (sql, p) => (await db.query(sql, p)).rows;
  const tryq = async (sql, p) => { try { return {rows: await q(sql, p)}; } catch(e){ return {error: e.message}; } };
  const cols = t => q(`select column_name from information_schema.columns where table_schema='public' and table_name='${t}' order by ordinal_position`).then(r=>r.map(c=>c.column_name).join());
  check('sql_cols', (await cols('inbox'))==='id,owner_id,text,url,source,created,taken' && (await cols('shortcut_keys'))==='owner_id,key_hash,space_id,created,revoked', [await cols('inbox'), await cols('shortcut_keys')]);
  const A = '00000000-0000-4000-8000-0000000000a1', Bu = '00000000-0000-4000-8000-0000000000b1';
  await db.exec(`insert into auth.users values ('${A}'), ('${Bu}')`);
  const as = async (uid, fn) => { await db.exec(`set test.uid = '${uid}'; set role authenticated;`); try { return await fn(); } finally { await db.exec(`reset role; reset test.uid;`); } };
  // The function (service role, here the owner of the tables) writes the rows
  const ia = (await q(`insert into public.inbox (owner_id, text, source) values ($1, 'Llamar a Marta', 'siri') returning id, created, taken`, [A]))[0];
  await q(`insert into public.inbox (owner_id, text, url, source) values ($1, 'De otro', 'https://x', 'share')`, [Bu]);
  check('sql_inbox_defaults', /^[0-9a-f-]{36}$/.test(ia.id) && !!ia.created && ia.taken===null, ia);
  const badSrc = await tryq(`insert into public.inbox (owner_id, text, source) values ($1, 'x', 'mail')`, [A]); check('sql_source_check', !!badSrc.error, badSrc);
  const noText = await tryq(`insert into public.inbox (owner_id, source) values ($1, 'siri')`, [A]); check('sql_text_required', !!noText.error, noText);
  const seen = await as(A, () => tryq(`select id, text from public.inbox`));
  check('sql_inbox_select_own', seen.rows && seen.rows.length===1 && seen.rows[0].text==='Llamar a Marta', seen);
  const ins = await as(A, () => tryq(`insert into public.inbox (owner_id, text, source) values ('${A}', 'yo', 'siri')`));
  check('sql_inbox_no_client_insert', !!ins.error && /permission denied/.test(ins.error), ins);
  const tk = await as(A, () => tryq(`update public.inbox set taken = now() where id = $1 returning id`, [ia.id]));
  const tx = await as(A, () => tryq(`update public.inbox set text = 'otro' where id = $1 returning id`, [ia.id]));
  const tb = await as(A, () => tryq(`update public.inbox set taken = now() where owner_id = '${Bu}' returning id`));
  check('sql_inbox_update_taken_only', tk.rows && tk.rows.length===1 && !!tx.error && /permission denied/.test(tx.error) && tb.rows && tb.rows.length===0, {tk, tx, tb});
  const anon = await (async()=>{ await db.exec(`set role anon`); try { return [await tryq(`select * from public.inbox`), await tryq(`select * from public.shortcut_keys`)]; } finally { await db.exec(`reset role`); } })();
  check('sql_anon_denied', !!anon[0].error && !!anon[1].error, anon);
  // shortcut_keys: own row only; a new key replaces it (upsert)
  const k1 = await as(A, () => tryq(`insert into public.shortcut_keys (key_hash, space_id) values ('h1', 's1') returning owner_id, created, revoked`));
  check('sql_key_insert_own', k1.rows && k1.rows[0].owner_id===A && !!k1.rows[0].created && k1.rows[0].revoked===null, k1);
  const kB = await as(A, () => tryq(`insert into public.shortcut_keys (owner_id, key_hash) values ('${Bu}', 'hx')`));
  check('sql_key_insert_other', !!kB.error, kB);
  const up = await as(A, () => tryq(`insert into public.shortcut_keys (owner_id, key_hash, space_id, created, revoked) values ('${A}', 'h2', 's2', now(), null) on conflict (owner_id) do update set key_hash = excluded.key_hash, space_id = excluded.space_id, created = excluded.created, revoked = excluded.revoked returning key_hash`));
  check('sql_key_upsert', up.rows && up.rows[0].key_hash==='h2', up);
  await q(`insert into public.shortcut_keys (owner_id, key_hash) values ($1, 'hb')`, [Bu]);
  const ks = await as(A, () => tryq(`select owner_id, key_hash from public.shortcut_keys`));
  const kr = await as(A, () => tryq(`update public.shortcut_keys set revoked = now() where owner_id = '${A}' returning owner_id`));
  const kO = await as(A, () => tryq(`update public.shortcut_keys set revoked = now() where owner_id = '${Bu}' returning owner_id`));
  check('sql_key_rls', ks.rows && ks.rows.length===1 && ks.rows[0].key_hash==='h2' && kr.rows && kr.rows.length===1 && kO.rows && kO.rows.length===0, {ks, kr, kO});
  const pub = await q(`select tablename from pg_publication_tables where pubname = 'supabase_realtime' and tablename in ('inbox','shortcut_keys')`);
  check('sql_realtime', pub.map(p=>p.tablename).join()==='inbox', pub);
  await db.close();
  db = await pgSetup(); const all = strip(fs.readFileSync(path.join(ROOT, 'supabase/all.sql'), 'utf8'));
  err = null; try { await db.exec(all); await db.exec(all); } catch(e){ err = e.message; }
  check('sql_all_twice', !err && /0001 a 0010/.test(all.split('\n')[0]) && /migrations\/0010_inbox\.sql/.test(all) && (all.match(/^-- ========== migrations\//mg)||[]).length===fs.readdirSync(path.join(ROOT,'supabase/migrations')).filter(f=>f.endsWith('.sql')).length, err);
  let rows = []; try { rows = (await db.query(fs.readFileSync(path.join(ROOT, 'supabase/check.sql'), 'utf8'))).rows; } catch(e){ err = e.message; }
  check('sql_check_all_ok', rows.length>=27 && rows.every(x=>x.Estado==='OK') && ['tabla inbox \\(0010\\)','tabla shortcut_keys \\(0010\\)','inbox en tiempo real \\(0010\\)'].every(p=>rows.some(x=>new RegExp(p).test(x.Pieza))), {err, bad:rows.filter(x=>x.Estado!=='OK'), n:rows.length});
  // check.sql says FALTA on a database without 0010
  await db.close(); db = await pgSetup(); const upto9 = all.slice(0, all.indexOf('-- ========== migrations/0010_inbox.sql')); await db.exec(upto9);
  rows = (await db.query(fs.readFileSync(path.join(ROOT, 'supabase/check.sql'), 'utf8'))).rows;
  check('sql_check_falta', rows.filter(x=>x.Estado==='FALTA').map(x=>x.Pieza).join('|')==='Siri y Atajo: tabla inbox (0010)|Siri y Atajo: tabla shortcut_keys (0010)|Siri y Atajo: inbox en tiempo real (0010)', rows.filter(x=>x.Estado==='FALTA'));
  await db.close();
  const readme = fs.readFileSync(path.join(ROOT, 'supabase/README.md'), 'utf8');
  check('sql_readme', /`migrations\/0010_inbox\.sql`/.test(readme) && /suma de las diez en orden/.test(readme) && /`add-task`/.test(readme) && /Verify JWT/.test(readme));
}

/* ======================= 5. The Edge Function add-task under Deno ======================= */
async function fnTests(){
  const SR = 'eyJservice', OWNER = '00000000-0000-4000-8000-0000000000a1', KEY = 'k_'+crypto.randomBytes(32).toString('base64url'), OLDKEY = 'old-key';
  const DBF = { keys:[{owner_id:OWNER, key_hash:sha(KEY), revoked:null}, {owner_id:'00000000-0000-4000-8000-0000000000b1', key_hash:sha(OLDKEY), revoked:'2026-11-01T00:00:00Z'}], inbox:[], log:[] };
  const rest = http.createServer((req, res) => { let b=''; req.on('data', c=>b+=c); req.on('end', () => {
    const u = new URL(req.url, 'http://x'); DBF.log.push({method:req.method, path:u.pathname, search:u.search, apikey:req.headers['apikey'], auth:req.headers['authorization'], prefer:req.headers['prefer']});
    const send = (st, o, h) => { res.writeHead(st, Object.assign({'Content-Type':'application/json'}, h||{})); res.end(o===undefined?'':JSON.stringify(o)); };
    if (u.pathname === '/rest/v1/shortcut_keys' && req.method === 'GET') { const h = (u.searchParams.get('key_hash')||'').replace(/^eq\./,''); return send(200, DBF.keys.filter(k=>k.key_hash===h).map(k=>({owner_id:k.owner_id, revoked:k.revoked}))); }
    if (u.pathname === '/rest/v1/inbox' && req.method === 'GET') { const o = (u.searchParams.get('owner_id')||'').replace(/^eq\./,''), since = Date.parse((u.searchParams.get('created')||'').replace(/^gte\./,''));
      const n = DBF.inbox.filter(x=>x.owner_id===o && Date.parse(x.created)>=since).length; return send(200, n?[{id:'x'}]:[], {'Content-Range':(n?'0-0':'*')+'/'+n}); }
    if (u.pathname === '/rest/v1/inbox' && req.method === 'POST') { const rows = JSON.parse(b); rows.forEach(x=>DBF.inbox.push(Object.assign({id:crypto.randomUUID(), created:new Date().toISOString(), taken:null}, x))); res.writeHead(201); res.end(); return; }
    send(404, {message:'no route '+u.pathname}); }); });
  await new Promise(res => rest.listen(REST_PORT, res));
  const wrapper = path.join(OUT, 'serve-add-task.ts');
  fs.writeFileSync(wrapper, `(globalThis as any).TAREAS_NO_SERVE = true;\nconst m = await import('file://${ROOT}/supabase/functions/add-task/index.ts');\nDeno.serve({ port: ${FN_PORT}, hostname: '127.0.0.1', onListen(){ console.log('listening'); } }, m.handler);\n`);
  const deno = spawn(process.env.DENO || 'deno', ['run', '--allow-net', '--allow-env', '--allow-read', wrapper], { env: Object.assign({}, process.env, {
    SUPABASE_URL: 'http://127.0.0.1:' + REST_PORT, SUPABASE_SERVICE_ROLE_KEY: SR, DENO_DIR: path.join(__dirname, 'out', 'P', 'denodir'), NO_COLOR: '1' }) });
  const st = { out:'' }; deno.stdout.on('data', d => st.out += d); deno.stderr.on('data', d => st.out += d);
  for (let i = 0; i < 300 && !/listening/.test(st.out); i++) await sleep(100);
  check('fn_started', /listening/.test(st.out), st.out.slice(-600));
  const F = 'http://127.0.0.1:' + FN_PORT + '/';
  const call = async (body, headers, method) => { const res = await fetch(F, {method:method||'POST', headers:headers||{}, body}); return {status:res.status, type:res.headers.get('content-type'), text:await res.text()}; };
  const J = o => JSON.stringify(o), auth = k => ({'Content-Type':'application/json', Authorization:'Bearer '+k});
  try {
    let c = await call(J({text:'  Llamar a Marta mañana  '}), auth(KEY));
    const last = () => DBF.inbox[DBF.inbox.length-1];
    check('fn_ok_json', c.status===200 && c.text==='Añadida: Llamar a Marta mañana' && /text\/plain/.test(c.type) && last().owner_id===OWNER && last().text==='Llamar a Marta mañana' && last().source==='siri' && last().url===null, {c, row:last()});
    check('fn_service_role', DBF.log.every(l=>l.apikey===SR && l.auth==='Bearer '+SR) && DBF.log.some(l=>l.method==='GET'&&l.path==='/rest/v1/inbox'&&/count=exact/.test(l.prefer||'')), DBF.log);
    c = await call(J({text:'Leer', url:'https://example.com/a'}), {'Content-Type':'application/json', 'x-tareas-key':KEY});
    check('fn_ok_header_share', c.status===200 && last().source==='share' && last().url==='https://example.com/a', {c, row:last()});
    c = await call(J({url:'https://example.com/solo'}), auth(KEY));
    check('fn_url_only', c.status===200 && c.text==='Añadida: https://example.com/solo' && last().text==='https://example.com/solo' && last().source==='share', {c, row:last()});
    c = await call(J({text:'Leer', url:['https://example.com/b'], source:'siri'}), auth(KEY));
    check('fn_url_list', c.status===200 && last().source==='siri' && last().url==='https://example.com/b', {c, row:last()});
    c = await call('Comprar pan', {'Content-Type':'text/plain', Authorization:'Bearer '+KEY});
    check('fn_plain_text', c.status===200 && c.text==='Añadida: Comprar pan' && last().text==='Comprar pan', c);
    c = await call(J({text:'Sin cabecera'}), {Authorization:'Bearer '+KEY}); // Shortcuts may leave the type out
    check('fn_json_no_type', c.status===200 && last().text==='Sin cabecera', c);
    c = await call(new URLSearchParams({text:'Por formulario', source:'share', url:'https://f.example'}), {Authorization:'Bearer '+KEY});
    check('fn_form', c.status===200 && last().text==='Por formulario' && last().source==='share' && last().url==='https://f.example', {c, row:last()});
    const fd = new FormData(); fd.append('text', 'Multiparte');
    c = await call(fd, {Authorization:'Bearer '+KEY}); check('fn_multipart', c.status===200 && last().text==='Multiparte', c);
    const n0 = DBF.inbox.length;
    c = await call(J({text:'x'}), {'Content-Type':'application/json'}); check('fn_no_key', c.status===401 && /Falta la clave/.test(c.text), c);
    c = await call(J({text:'x'}), auth('otra-clave')); check('fn_bad_key', c.status===401 && /Clave no válida/.test(c.text), c);
    c = await call(J({text:'x'}), auth(OLDKEY)); check('fn_revoked', c.status===401 && /Clave revocada/.test(c.text), c);
    c = await call(J({text:'   '}), auth(KEY)); check('fn_empty', c.status===400 && /Falta el texto/.test(c.text), c);
    c = await call(J({text:'a'.repeat(501)}), auth(KEY)); check('fn_too_long', c.status===400 && /demasiado largo/.test(c.text), c);
    c = await call(J({text:'a'.repeat(500)}), auth(KEY)); check('fn_500_ok', c.status===200, c.status);
    c = await call(J({text:'Enlace', url:'https://e.com/'+'a'.repeat(2000)}), auth(KEY)); check('fn_long_url', c.status===400 && /enlace/.test(c.text), c);
    c = await call(undefined, {Authorization:'Bearer '+KEY}, 'GET'); check('fn_get', c.status===405, c);
    check('fn_nothing_stored', DBF.inbox.length===n0+1, DBF.inbox.length-n0);
    // The hourly limit: 60 rows in the last hour refuse the next one; older rows do not count
    const old = new Date(Date.now()-2*3600e3).toISOString(); DBF.inbox.forEach(x=>{ x.created=old; });
    for (let i=0;i<59;i++) DBF.inbox.push({id:'r'+i, owner_id:OWNER, text:'t', created:new Date().toISOString()});
    c = await call(J({text:'La sesenta'}), auth(KEY)); check('fn_rate_60th', c.status===200, c);
    c = await call(J({text:'La sesenta y una'}), auth(KEY)); check('fn_rate_limited', c.status===429 && /Demasiadas tareas/.test(c.text) && !DBF.inbox.some(x=>x.text==='La sesenta y una'), c);
    check('fn_logs', /"event":"added"/.test(st.out) && /"event":"bad-key"/.test(st.out) && /"event":"rate-limited"/.test(st.out) && !st.out.includes(KEY) && !st.out.includes('Llamar a Marta'), st.out.slice(-900));
  } finally { deno.kill(); rest.close(); }
}

(async()=>{
  await new Promise(res=>srv.listen(PORT,res)); const browser = await chromium.launch();
  try{ await sqlTests(); }catch(e){ fails.push('sql_exception'); errors.push('sql: '+String(e&&e.stack||e)); }
  try{ await fnTests(); }catch(e){ fails.push('fn_exception'); errors.push('fn: '+String(e&&e.stack||e)); }
  try{ await grammar(browser); }catch(e){ fails.push('grammar_exception'); errors.push('grammar: '+String(e&&e.stack||e)); }
  try{ await app(browser); }catch(e){ fails.push('app_exception'); errors.push('app: '+String(e&&e.stack||e)); }
  console.log(JSON.stringify({r, fails, errors}, null, 1));
  await browser.close(); srv.close(); process.exit(fails.length||errors.length?1:0);
})();
