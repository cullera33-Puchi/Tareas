// The team's tests (rm-TM, rm-AV, rm-QT, decision 63 b, c and d): an in-memory server with the rules of 0013_team.sql, and the page's
// adapter that talks to it. Rows by owner as rm-S and rm-E2E; on top: the membership gate on every table (a stranger or a removed member
// reads nothing and writes nothing; a member writes synced data only with the key row), the team functions, notices (4 hours per task and
// person), feedback (only the admin reads it), the storage quota and realtime for notices.
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const TYPES = {'.html':'text/html','.css':'text/css','.js':'application/javascript','.webmanifest':'application/manifest+json','.png':'image/png','.json':'application/json'};
function serve(port){ const srv = http.createServer((req,res)=>{ let p = decodeURIComponent(req.url.split('?')[0]); if(p==='/') p='/index.html';
    if(p==='/config.js'){ res.writeHead(200,{'Content-Type':'application/javascript'}); res.end('window.TAREAS_CONFIG = {"url":null,"anonKey":null};\n'); return; }
    const f=path.join(ROOT,p); if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){ res.writeHead(404,{'Content-Type':'text/html'}); res.end('<h1>404</h1>'); return; }
    res.writeHead(200,{'Content-Type':TYPES[path.extname(f)]||'application/octet-stream'}); res.end(fs.readFileSync(f)); });
  return new Promise(r=>srv.listen(port, ()=>r(srv))); }
const TABLES = ['spaces','projects','tasks','voice_notes','attachments','subtasks','project_notes','contacts'];
const ENC = { tasks:['title','notes','waiting_for','responsible'], projects:['name'], spaces:['name'], subtasks:['title'], project_notes:['title','body'], contacts:['name','email','phone'], voice_notes:['text'] };
const isEnc = v => typeof v==='string' && v.startsWith('e1:');
const RLS = t => new Error('new row violates row-level security policy for table "'+t+'"');
let nid = 0; const newId = () => '00000000-0000-4000-8000-'+String(++nid).padStart(12, '0');
class Fake {
  constructor(){ this.t={}; TABLES.forEach(x=>this.t[x]=new Map()); this.last=0; this.subs=new Map(); this.tags=new Map(); this.calls=[]; this.keys=new Map(); this.store=new Map();
    this.users=new Map(); this.members=[]; this.notices=[]; this.feedback=[]; this.team=true; this.inbox=[]; this.follow=true; this.followMarks=[]; }
  // Accounts in creation order: the first one becomes the admin when nobody is (tareas_team_bootstrap)
  user(uid, email, name){ this.users.set(uid, {uid, email, name:name||''}); return {uid, email}; }
  ts(){ this.last=Math.max(Date.now(), this.last+1); return new Date(this.last).toISOString(); }
  bootstrap(){ if(this.members.some(m=>m.role==='admin')) return; const u=[...this.users.values()][0]; if(!u) return;
    this.members.push({id:newId(), email:u.email.toLowerCase(), name:u.name||null, role:'admin', quota:null, invited:this.ts(), revoked:null, last_access:null, user_id:u.uid}); }
  member(uid){ if(!uid) return null; this.bootstrap(); let m=this.members.find(x=>x.user_id===uid); if(m) return m.revoked?null:m;
    const u=this.users.get(uid); if(!u) return null; m=this.members.find(x=>!x.user_id&&!x.revoked&&x.email===u.email.toLowerCase()); return m||null; }
  role(uid){ const m=this.member(uid); return m?m.role:null; }
  writeOk(uid){ const r=this.role(uid); return r==='admin'||(r==='member'&&this.keys.has(uid)); }
  used(uid, except){ let n=0; for(const [p,o] of this.store) if(p.startsWith(uid+'/')&&p!==except) n+=o.size; return n; }
  write(owner, table, rows){ if(!owner) throw new Error('JWT required'); if(this.team&&!this.writeOk(owner)) throw RLS(table);
    if(this.failRls>0){ this.failRls--; throw RLS(table); } // a refusal of the rules while the account still has access (a test's switch)
    const ts=this.ts(), out=[], changed=[], m=this.t[table];
    rows.forEach(r=>{ if(!r.id) throw new Error('null id'); if(!r.modified) throw new Error('null value in column "modified"');
      const ex=m.get(r.id); if(ex && ex.owner_id!==owner) throw RLS(table);
      if(this.keys.has(owner) && ENC[table]) ENC[table].forEach(c=>{ const v=r[c]; if(v!=null && v!=='' && !isEnc(v)) throw new Error('tareas_plaintext_refused: '+table+'.'+c); }); });
    rows.forEach(r=>{ const ex=m.get(r.id);
      if(!ex){ const row=Object.assign({id:r.id, owner_id:owner, created:null, deleted:null}, r, {owner_id:owner, server_ts:ts}); m.set(r.id,row); out.push({id:r.id}); changed.push(row); return; }
      if(Date.parse(r.modified) < Date.parse(ex.modified)) return;
      Object.assign(ex, r, {owner_id:ex.owner_id, server_ts:ts}); out.push({id:r.id}); changed.push(ex); });
    changed.forEach(row=>this.notify(row.owner_id, table, row)); return out; }
  notify(uid, table, row){ const copy=JSON.parse(JSON.stringify(row));
    for(const [page, u] of this.subs){ if(u!==uid) continue; setTimeout(()=>{ page.evaluate(([t,r])=>window.__fakeRT&&window.__fakeRT(t,r), [table, copy]).catch(()=>{}); }, 30); } }
  rows(owner, table){ if(this.team&&!this.role(owner)) return []; return [...this.t[table].values()].filter(r=>r.owner_id===owner); }
  err(message, details){ return {__err:{message, details:details||null}}; }
  handle(page, op, a){ this.calls.push((this.tags.get(page)||'?')+':'+op+(a&&a.table?':'+a.table:'')); const own=a&&a.owner, ok=()=>!this.team||!!this.role(own), admin=()=>this.team&&this.role(own)==='admin';
    switch(op){
      case 'signIn': return {id:a.uid, email:a.email};
      case 'pull': { let rs=this.rows(own, a.table); if(a.after) rs=rs.filter(r=>Date.parse(r.server_ts)>Date.parse(a.after));
        rs.sort((x,y)=>x.server_ts<y.server_ts?-1:x.server_ts>y.server_ts?1:x.id<y.id?-1:1); return JSON.parse(JSON.stringify(rs.slice(0,a.limit))); }
      case 'byIds': return JSON.parse(JSON.stringify(this.rows(own, a.table).filter(r=>a.ids.includes(r.id))));
      case 'upsert': try{ return this.write(own, a.table, a.rows); }catch(e){ return this.err(e.message); }
      case 'markDeleted': try{ return this.write(own, a.table, a.items.map(x=>({id:x.id, deleted:x.ts, modified:x.ts}))); }catch(e){ return this.err(e.message); }
      case 'subscribe': this.subs.set(page, a.uid); return true;
      case 'unsubscribe': this.subs.delete(page); return true;
      case 'cryptoGet': { if(!ok()) return null; const k=this.keys.get(own); return k?JSON.parse(JSON.stringify(k)):null; }
      case 'cryptoPut': if(!ok()) return this.err(RLS('crypto_keys').message); if(this.keys.has(own)) return this.err('duplicate key value violates unique constraint "crypto_keys_pkey"');
        this.keys.set(own, Object.assign({migrated:null, ecdh_pub:null, ecdh_priv:null}, a.row, {owner_id:undefined})); return true;
      case 'cryptoPatch': { if(!ok()) return []; const k=this.keys.get(own); if(!k||Object.keys(a.match).some(c=>a.match[c]===null?k[c]!=null:k[c]!==a.match[c])) return []; Object.assign(k, a.patch); return [{kid:k.kid}]; }
      case 'upload': { if(!a.path.startsWith(own+'/')||(this.team&&!this.role(own))) return this.err('new row violates row-level security policy');
        const size=Buffer.from(a.b64, 'base64').length, m=this.member(own); if(this.team&&m&&m.quota!=null&&this.used(own, a.path)+Math.max(size,1)>m.quota){ this.refusedUploads=(this.refusedUploads||0)+1; return this.err('new row violates row-level security policy'); }
        this.store.set(a.path, {b64:a.b64, mime:a.mime, size}); return true; }
      case 'download': { if(this.team&&!this.role(own)) return this.err('HTTP 400 {"statusCode":"404","error":"not_found","message":"Object not found"}'); const o=this.store.get(a.path); if(!o) return this.err('HTTP 400 {"statusCode":"404","error":"not_found","message":"Object not found"}'); return o; }
      case 'inboxList': return []; case 'inboxTake': return []; case 'inboxClear': return [];
      // The team (0013_team.sql)
      case 'teamMe': { if(!this.team) return {absent:true}; const m=this.member(own); if(!m) return null; const u=this.users.get(own);
        if(!m.user_id){ m.user_id=own; if(!m.name&&u&&u.name) m.name=u.name; } m.last_access=new Date().toISOString();
        return {id:m.id, role:m.role, name:m.name, email:m.email, quota:m.quota, used:this.used(own)}; }
      case 'teamDir': if(!ok()) return []; return this.members.filter(m=>!m.revoked&&m.user_id).map(m=>({user_id:m.user_id, name:m.name, email:m.email, pub:(this.keys.get(m.user_id)||{}).ecdh_pub||null, admin:m.role==='admin'}));
      case 'teamList': if(!admin()) return this.err('tareas_team_admin_only'); return this.members.map(m=>({id:m.id, email:m.email, name:m.name, role:m.role, quota:m.quota, used:m.user_id?this.used(m.user_id):0, invited:m.invited, revoked:m.revoked, last_access:m.last_access, joined:!!m.user_id, has_key:!!(m.user_id&&this.keys.has(m.user_id))}));
      case 'teamInvite': { if(!admin()) return this.err('tareas_team_admin_only'); const em=String(a.email).trim().toLowerCase(); if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) return this.err('tareas_team_bad_email');
        let m=this.members.find(x=>x.email===em); if(m&&m.revoked&&Date.parse(m.revoked)<Date.now()-30*864e5) return this.err('tareas_team_removing'); if(m){ m.revoked=null; m.invited=this.ts(); if(a.name) m.name=a.name; } else { m={id:newId(), email:em, name:a.name||null, role:'member', quota:52428800, invited:this.ts(), revoked:null, last_access:null, user_id:null}; this.members.push(m); } return m.id; }
      case 'teamQuota': { if(!admin()) return this.err('tareas_team_admin_only'); const m=this.members.find(x=>x.id===a.id); if(m) m.quota=a.quota; return true; }
      case 'teamRevoke': { if(!admin()) return this.err('tareas_team_admin_only'); const m=this.members.find(x=>x.id===a.id); if(!m||m.role==='admin'||m.user_id===own) return this.err('tareas_team_not_removable'); m.revoked=m.revoked||new Date().toISOString(); return true; }
      case 'noticeSend': { if(!ok()) return this.err(RLS('team_notices').message); const r=a.row, to=r.recipient_id; if(to===own||!this.role(to)) return this.err('tareas_notice_bad_recipient');
        const last=this.notices.filter(n=>n.sender_id===own&&n.recipient_id===to&&n.task_ref===r.task_ref).map(n=>Date.parse(n.created)).sort((x,y)=>y-x)[0];
        if(this.notices.filter(n=>n.sender_id===own&&Date.parse(n.created)>Date.now()-3600e3).length>=20) return this.err('tareas_notice_too_many');
        if(last&&last>Date.now()-4*3600e3) return this.err('tareas_notice_too_soon', new Date(last+4*3600e3).toISOString().slice(0,19)+'Z');
        const n={id:newId(), sender_id:own, recipient_id:to, task_ref:r.task_ref, payload:r.payload, created:new Date().toISOString(), pushed:null, taken:null, dismissed:null, planned:null, done:null, done_pushed:null}; this.notices.push(n);
        this.notify(to, 'team_notices', {id:n.id}); return true; }
      case 'noticeList': if(!ok()) return []; return this.notices.filter(n=>n.recipient_id===own&&n.recipient_id===a.uid&&!n.taken&&!n.dismissed).map(n=>({id:n.id, sender_id:n.sender_id, payload:n.payload, created:n.created}));
      // The sender's own notices, only the columns asked for (never payload: the test checks what was asked)
      case 'noticeSent': { (this.sentAsked=this.sentAsked||[]).push(a.cols); if(this.sentFail) return this.err('HTTP 500 boom'); if(!ok()) return [];
        const cols=String(a.cols||'').split(','), since=Date.parse(a.since)||0; if(!this.follow&&cols.some(c=>c==='planned'||c==='done')) return this.err('column team_notices.planned does not exist');
        return this.notices.filter(n=>n.sender_id===own&&Date.parse(n.created)>=since).sort((x,y)=>Date.parse(y.created)-Date.parse(x.created)).slice(0,500).map(n=>Object.fromEntries(cols.map(c=>[c, n[c]===undefined?null:n[c]]))); }
      // Decision 78 (0014): the recipient's own notices by id, the columns of the follow-up; without 0014 the columns are missing
      case 'noticeFollow': { if(!this.follow) return this.err('column team_notices.planned does not exist'); if(!ok()) return [];
        return this.notices.filter(n=>n.recipient_id===own&&a.ids.includes(n.id)).map(n=>({id:n.id, taken:n.taken, dismissed:n.dismissed, planned:n.planned, done:n.done})); }
      // The grants of 0013 and 0014 (the recipient writes taken and dismissed, and planned and done once 0014 ran) and the trigger of 0014
      case 'noticeMark': { if(!ok()) return []; const keys=Object.keys(a.patch||{}), allowed=['taken','dismissed'].concat(this.follow?['planned','done']:[]);
        const bad=keys.find(k=>!allowed.includes(k)); if(bad) return this.err(['planned','done'].includes(bad)?'column "'+bad+'" of relation "team_notices" does not exist':'permission denied for table team_notices');
        const n=this.notices.find(x=>x.id===a.id&&x.recipient_id===own); if(!n) return [];
        if(keys.some(k=>k==='planned'||k==='done')) this.followMarks.push({id:n.id, patch:Object.assign({}, a.patch)});
        const wasDone=n.done; Object.assign(n, a.patch); if(!wasDone&&n.done) n.done_pushed=null; return [{id:n.id}]; }
      case 'feedbackSend': { if(!ok()) return this.err(RLS('team_feedback').message); if(this.role(a.row.recipient_id)!=='admin') return this.err('tareas_feedback_bad_recipient');
        this.feedback.push({id:newId(), sender_id:own, recipient_id:a.row.recipient_id, kind:a.row.kind, payload:a.row.payload, created:new Date().toISOString(), status:'nueva', pushed:null}); return true; }
      case 'feedbackList': if(!admin()) return []; return this.feedback.filter(f=>f.recipient_id===own).slice().reverse().map(f=>({id:f.id, sender_id:f.sender_id, kind:f.kind, payload:f.payload, created:f.created, status:f.status}));
      case 'feedbackMark': { if(!admin()) return []; const f=this.feedback.find(x=>x.id===a.id&&x.recipient_id===own); if(!f) return []; f.status=a.status; return [{id:f.id}]; }
    } throw new Error('op '+op); }
}
// The page's adapter (added with addInitScript): every call goes through the exposed binding fakeServer; {__err} becomes a thrown error
function fakeAdapter(){
  const call=async(op,a)=>{ if(!navigator.onLine) throw new TypeError('Failed to fetch'); const r=await window.fakeServer(op,a); if(r&&r.__err){ const e=new Error(r.__err.message); e.details=r.__err.details; throw e; } return r; };
  const owner=()=>{ const s=JSON.parse(localStorage.getItem('fake-session')||'null'); return s&&s.id; };
  const b64=async blob=>new Promise((res,rej)=>{ const rd=new FileReader(); rd.onload=()=>res(String(rd.result).split(',')[1]||''); rd.onerror=()=>rej(rd.error); rd.readAsDataURL(blob); });
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
    async fileUpload(path, blob, mime){ return call('upload', {owner:owner(), path, b64:await b64(blob), mime}); },
    async fileDownload(path){ const o=await call('download', {owner:owner(), path}); const s=atob(o.b64), u=new Uint8Array(s.length); for(let i=0;i<s.length;i++) u[i]=s.charCodeAt(i); return new Blob([u], {type:o.mime}); },
    inboxList:()=>call('inboxList', {owner:owner()}), inboxTake:(ids, ts, o)=>call('inboxTake', {owner:owner(), ids, ts, o:o||null}), inboxClear:()=>call('inboxClear', {owner:owner()}),
    cryptoGet:()=>call('cryptoGet', {owner:owner()}), cryptoPut:row=>call('cryptoPut', {owner:owner(), row}), cryptoPatch:(own, match, patch)=>call('cryptoPatch', {owner:owner(), match, patch}),
    teamMe:()=>call('teamMe', {owner:owner()}), teamDir:()=>call('teamDir', {owner:owner()}), teamList:()=>call('teamList', {owner:owner()}),
    teamInvite:(email, name)=>call('teamInvite', {owner:owner(), email, name}), teamQuota:(id, quota)=>call('teamQuota', {owner:owner(), id, quota}), teamRevoke:id=>call('teamRevoke', {owner:owner(), id}),
    noticeSend:row=>call('noticeSend', {owner:owner(), row}), noticeList:uid=>call('noticeList', {owner:owner(), uid}), noticeMark:(id, patch)=>call('noticeMark', {owner:owner(), id, patch}), noticeSent:(uid, since, cols)=>call('noticeSent', {owner:owner(), uid, since, cols:cols||TEAM_SENT_COLS}), noticeFollow:(uid, ids)=>call('noticeFollow', {owner:owner(), uid, ids}),
    feedbackSend:row=>call('feedbackSend', {owner:owner(), row}), feedbackList:()=>call('feedbackList', {owner:owner()}), feedbackMark:(id, status)=>call('feedbackMark', {owner:owner(), id, status})
  };
}
const T0 = '2026-11-04T08:00:00.000Z';
const today=()=>{ const d=new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); };
const tk = (id, o) => Object.assign({id, title:id, spaceId:'trabajo', projectId:null, date:today(), reminder:null, priority:'none', status:'pending', notes:'', carried:false, created:T0, modified:T0, completed:null}, o);
const seed = (tasks, extra) => Object.assign({ spaces:[{id:'trabajo',name:'Trabajo',order:0,created:T0},{id:'personal',name:'Personal',order:1,created:T0}], projects:[], tasks:tasks||[], voiceNotes:[], attachments:[], subtasks:[], projectNotes:[], contacts:[], settings:{tipsSeen:true} }, extra||{});
// A browser context for one person: iPhone (390 x 844) or desktop (1280 x 800), light or dark, its own account and seed
async function device(browser, fake, o, port, errors){
  const vp = o.desk ? {viewport:{width:1280,height:800}, deviceScaleFactor:1} : {viewport:{width:390,height:844}, deviceScaleFactor:2, isMobile:true, hasTouch:true};
  if(o.dark) vp.colorScheme='dark';
  const ctx = await browser.newContext(vp); const page = await ctx.newPage(); fake.tags.set(page, o.tag);
  page.on('pageerror', e=>errors.push(o.tag+' pageerror: '+e.message)); page.on('console', m=>{ if(m.type()==='error'&&!/Failed to fetch/.test(m.text())) errors.push(o.tag+' console: '+m.text()); });
  await page.exposeBinding('fakeServer', (src, op, a)=>fake.handle(src.page, op, a)); await page.addInitScript(fakeAdapter); await page.addInitScript(u=>{ window.__fakeUser=u; }, o.user);
  if(o.init) await page.addInitScript(o.init);
  await page.addInitScript(s=>{ if(!localStorage.getItem('tareas-v1')) localStorage.setItem('tareas-v1', s); }, JSON.stringify(o.seed||seed()));
  await page.goto('http://localhost:'+port+'/'); await page.waitForTimeout(500); return {ctx, page}; }
const until = async (page, fn, arg, ms=10000)=>{ const t0=Date.now(); for(;;){ let v=false; try{ v=await page.evaluate(fn, arg); }catch(e){} if(v) return true; if(Date.now()-t0>ms) return false; await page.waitForTimeout(100); } };
const synced = (page, ms) => until(page, ()=>SY&&SY.user&&!SY.running&&SY.status==='ok'&&!CR.busy&&!CR.migrating&&syncCollect(true).count===0, null, ms||15000);
const settled = page => until(page, ()=>!document.querySelector('#sheet.on')&&!document.querySelector('#asheet.on')&&!document.querySelector('.pm.open'), null, 4000);
const sheetIn = page => until(page, ()=>{ const s=document.querySelector('#sheet.on'); if(!s) return false; const r=s.getBoundingClientRect(); return getComputedStyle(s).transform==='none'||Math.abs(r.bottom-innerHeight)<2||document.body.classList.contains('desktop'); }, null, 4000).then(()=>page.waitForTimeout(550));
async function toSettings(page, desk){ if(desk) await page.evaluate(()=>setDeskView('settings')); else { await page.evaluate(()=>{ if(UI.stack.length) pop(); }); await page.click('[data-tab=ajustes]'); } await page.waitForTimeout(400); }
const signIn = async (page, desk) => { await toSettings(page, desk); await page.click('[data-act=signIn]'); };
// Activation with a password, as the sheet does it (tests of the team, not of the sheet: rm-E2E covers it)
const activate = (page, pw) => page.evaluate(async p=>{ await cryptoActivate(p); }, pw);
const hideToast = page => page.evaluate(()=>{ const t=document.getElementById('toast'); t.classList.remove('on'); });
module.exports = { serve, Fake, fakeAdapter, device, until, synced, settled, sheetIn, toSettings, signIn, activate, hideToast, tk, seed, today, T0, ENC, isEnc };
