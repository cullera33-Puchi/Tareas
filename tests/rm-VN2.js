require('./lib/out.js'); // outputs (screenshots, downloads) go to tests/out
// Decision 49 (Dictar en Notas y «Nota de voz» para el audio), port 10500.
//  1. Sync: voice notes on the server (an older device uploaded them) come into a device on this version: each becomes a line at the end
//     of its task's notes («d/m HH:MM: texto», local time, creation order, a blank line before them when the notes had text), and goes up
//     as deleted; a line already in the notes is not added twice; a deleted one never shows; one whose task is missing stays as it is;
//     one more arriving in real time is folded and its deletion goes up. One log line per pass.
//  2. iPhone, local: the start folds them (a demo task too), running it again changes nothing, an older export imported twice adds the
//     lines once; the detail has no voice notes group nor dictation button, the recording button and sheet are called «Nota de voz»;
//     no microphone indicator on the row; the share text has no «Notas de voz» section. Screenshots light and dark.
//  3. Desktop: the inspector without voice notes; the add bar's microphone (Dictar) writes into Notas after what is there, with a mock
//     SpeechRecognition, and no voice note record is created.
const { chromium } = require('playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = path.resolve(__dirname, '..'), PORT = 10500, URL0 = 'http://localhost:'+PORT+'/';
const OUT = path.join(__dirname, 'out', 'VN2'); fs.mkdirSync(OUT, {recursive:true});
const TYPES = {'.html':'text/html','.css':'text/css','.js':'application/javascript','.webmanifest':'application/manifest+json','.png':'image/png'};
const srv = http.createServer((req,res)=>{ let p = decodeURIComponent(req.url.split('?')[0]); if(p==='/') p='/index.html'; const f=path.join(ROOT,p);
  if(p==='/config.js'){ res.writeHead(200,{'Content-Type':'application/javascript'}); res.end('window.TAREAS_CONFIG={"url":null,"anonKey":null};'); return; }
  if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){ res.writeHead(404,{'Content-Type':'text/html'}); res.end('<h1>404</h1>'); return; }
  res.writeHead(200,{'Content-Type':TYPES[path.extname(f)]||'application/octet-stream'}); res.end(fs.readFileSync(f)); });

/* ---------- Fake server (as rm-S: newest modified wins, soft deletes, realtime to the owner's pages) ---------- */
const TABLES = ['spaces','projects','tasks','voice_notes','attachments','subtasks','project_notes'];
const COLS = { spaces:['name','sort_order','members'], projects:['space_id','name','color','sort_order','archived'],
  tasks:['space_id','project_id','title','date','reminder','priority','status','notes','carried','assignees','completed'], voice_notes:['task_id','text'],
  attachments:['task_id','kind','path','mime','size','width','height','duration_ms','purged'], subtasks:['task_id','title','done','sort_order'], project_notes:['project_id','title','body','pinned'] };
class Fake {
  constructor(){ this.t={}; TABLES.forEach(x=>this.t[x]=new Map()); this.last=0; this.subs=new Map(); }
  ts(){ this.last=Math.max(Date.now(), this.last+1); return new Date(this.last).toISOString(); }
  write(owner, table, rows){ const ts=this.ts(), out=[], changed=[], m=this.t[table];
    rows.forEach(r=>{ if(!r.id||!r.modified) throw new Error('bad row'); });
    rows.forEach(r=>{ const ex=m.get(r.id);
      if(!ex){ const row={id:r.id, owner_id:owner}; COLS[table].forEach(c=>row[c]=(c==='members'||c==='assignees')?[]:null); Object.assign(row,{created:null, deleted:null}, r, {owner_id:owner, server_ts:ts}); m.set(r.id,row); out.push({id:r.id}); changed.push(row); return; }
      if(Date.parse(r.modified) < Date.parse(ex.modified)) return;
      Object.assign(ex, r, {owner_id:ex.owner_id, server_ts:ts}); out.push({id:r.id}); changed.push(ex); });
    changed.forEach(row=>this.notify(table, row)); return out; }
  notify(table, row){ const copy=JSON.parse(JSON.stringify(row));
    for(const [page, uid] of this.subs){ if(uid!==row.owner_id) continue; setTimeout(()=>{ page.evaluate(([t,r])=>window.__fakeRT&&window.__fakeRT(t,r), [table, copy]).catch(()=>{}); }, 40); } }
  rows(owner, table){ return [...this.t[table].values()].filter(r=>r.owner_id===owner); }
  handle(page, op, a){ const own=a&&a.owner;
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
const USER = {uid:'9b2f6d3e-0000-4000-8000-00000000e049', email:'enric@example.com'};
function fakeAdapter(){
  const call=(op,a)=>window.fakeServer(op,a); const owner=()=>{ const s=JSON.parse(localStorage.getItem('fake-session')||'null'); return s&&s.id; };
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
function fakeSR(){ window.__srStarts=0; window.SpeechRecognition = window.webkitSpeechRecognition = class { start(){ window.__srStarts++; this._t=setTimeout(()=>{ const res=[[{transcript:'texto dictado'}]]; res[0].isFinal=true; this.onresult&&this.onresult({resultIndex:0, results:res}); }, 120); } stop(){ clearTimeout(this._t); } }; }

const r={}, fails=[], errors=[]; const check=(name, ok, info)=>{ r[name]=ok?true:(info===undefined?false:info); if(!ok) fails.push(name); };
const OLD='2026-11-01T00:00:00.000Z';
const T=(id, o)=>Object.assign({id, title:'Tarea '+id, spaceId:'trabajo', projectId:null, date:null, reminder:null, priority:'none', status:'pending', notes:'', carried:false, created:OLD, modified:OLD, completed:null}, o);
// Europe/Madrid: 17:40Z on 2 Nov is 18:40; 08:05Z on 1 Nov is 09:05; 07:00Z on 30 Oct is 08:00 (winter time from 25 Oct)
const L1='1/11 09:05: Pedir la versión firmada', L2='2/11 18:40: Incluir el punto de riesgos', L3='30/10 08:00: Llamar antes de las 10';
const N1='Orden del día\n\n'+L1+'\n'+L2, N3='Ya dicho\n\n2/11 10:00: Repetida';

async function device(browser, o){
  const vp = o.desk ? {viewport:{width:1280,height:800}, deviceScaleFactor:1} : {viewport:{width:390,height:844}, deviceScaleFactor:2, isMobile:true, hasTouch:true};
  const ctx = await browser.newContext(Object.assign(vp, {timezoneId:'Europe/Madrid', colorScheme:o.dark?'dark':'light'})); const page = await ctx.newPage();
  page.on('pageerror', e=>errors.push(o.tag+' pageerror: '+e.message)); page.on('console', m=>{ if(m.type()==='error') errors.push(o.tag+' console: '+m.text()); });
  if(o.fake){ await page.exposeBinding('fakeServer', (src, op, a)=>fake.handle(src.page, op, a)); await page.addInitScript(fakeAdapter); await page.addInitScript(u=>{ window.__fakeUser=u; }, USER); }
  if(o.sr) await page.addInitScript(fakeSR);
  await page.addInitScript(s=>{ if(!localStorage.getItem('tareas-v1')) localStorage.setItem('tareas-v1', s); }, JSON.stringify(o.seed));
  await page.goto(URL0); await page.waitForFunction(()=>typeof DB!=='undefined'&&DB&&document.querySelector('#app')); return {ctx, page};
}
const until = async (page, fn, arg, ms=8000)=>{ const t0=Date.now(); for(;;){ let v=false; try{ v=await page.evaluate(fn, arg); }catch(e){} if(v) return true; if(Date.now()-t0>ms) return false; await page.waitForTimeout(100); } };
const synced = page => until(page, ()=>SY&&SY.user&&!SY.running&&SY.status==='ok'&&syncCollect(true).count===0);
const settled = page => page.waitForFunction(()=>!app.classList.contains('navigating')&&!document.querySelector('.sheet.on.drag'), null, {timeout:5000}).catch(()=>{});

(async()=>{
  await new Promise(res=>srv.listen(PORT,res)); const browser = await chromium.launch();
  try{
  /* ---------- 1. Sync ---------- */
  { const own=USER.uid, sv=(id, o)=>Object.assign({id, space_id:'sp-w', project_id:null, title:'Tarea '+id, date:null, reminder:null, priority:'none', status:'pending', notes:'', carried:false, completed:null, created:OLD, modified:OLD}, o);
    fake.write(own, 'spaces', [{id:'sp-w', name:'Trabajo', sort_order:0, created:OLD, modified:OLD}, {id:'sp-p', name:'Personal', sort_order:1, created:OLD, modified:OLD}]);
    fake.write(own, 'tasks', [sv('t1',{title:'Preparar comité', notes:'Orden del día'}), sv('t2',{title:'Llamar a Marta'}), sv('t3',{title:'Revisar SOW', notes:N3})]);
    const vn=(id, task_id, text, created, deleted)=>({id, task_id, text, created, modified:deleted||created, deleted:deleted||null});
    fake.write(own, 'voice_notes', [vn('v1','t1','Incluir el punto de riesgos','2026-11-02T17:40:00.000Z'), vn('v2','t1','Pedir la versión firmada','2026-11-01T08:05:00.000Z'),
      vn('v3','t2','Llamar antes de las 10','2026-10-30T07:00:00.000Z'), vn('v4','t3','Repetida','2026-11-02T09:00:00.000Z'),
      vn('vd','t1','Borrada','2026-11-02T10:00:00.000Z','2026-11-02T11:00:00.000Z'), vn('v5','tx-gone','Sin tarea','2026-11-02T12:00:00.000Z')]);
    const A = await device(browser, {tag:'A', fake:true, seed:{spaces:[{id:'trabajo',name:'Trabajo',order:0,created:OLD},{id:'personal',name:'Personal',order:1,created:OLD}], projects:[], tasks:[], voiceNotes:[], settings:{tipsSeen:true}}});
    await A.page.click('[data-tab=ajustes]'); await A.page.click('[data-act=signIn]'); check('sync_first', await synced(A.page));
    const a = await A.page.evaluate(()=>({t1:task('t1')&&task('t1').notes, t2:task('t2')&&task('t2').notes, t3:task('t3')&&task('t3').notes, t3m:task('t3')&&task('t3').modified, vn:DB.voiceNotes.map(v=>v.id), log:LOG.filter(e=>/^Notas de voz pasadas a Notas/.test(e.m)).map(e=>e.m)}));
    check('sync_lines', a.t1===N1 && a.t2===L3 && a.t3===N3, a);
    check('sync_line_there_untouched', a.t3m===OLD, a.t3m);
    check('sync_orphan_stays', a.vn.join()==='v5', a.vn);
    check('sync_logged_once', a.log.join('|')==='Notas de voz pasadas a Notas: 4', a.log);
    const S = id=>fake.t.voice_notes.get(id)||{};
    const sd = {v1:S('v1').deleted, v2:S('v2').deleted, v3:S('v3').deleted, v4:S('v4').deleted, vd:S('vd').deleted, v5:S('v5').deleted, t1:fake.t.tasks.get('t1').notes, t2:fake.t.tasks.get('t2').notes, t3m:fake.t.tasks.get('t3').modified};
    check('sync_deleted_on_server', ['v1','v2','v3','v4'].every(k=>!!sd[k]) && sd.vd==='2026-11-02T11:00:00.000Z' && sd.v5===null, sd);
    check('sync_tasks_up', sd.t1===N1 && sd.t2===L3 && sd.t3m===OLD, sd);
    // A device on an older version adds one more: it arrives in real time, is folded and its deletion goes up
    fake.write(own, 'voice_notes', [vn('v6','t2','Desde el iPhone antiguo','2026-11-02T20:30:00.000Z')]);
    const L6='2/11 21:30: Desde el iPhone antiguo'; // in the past: a deletion is newer than the note
    check('rt_folded', await until(A.page, l=>task('t2').notes===l && !DB.voiceNotes.some(v=>v.id==='v6'), L3+'\n\n'+L6), await A.page.evaluate(()=>task('t2').notes));
    check('rt_deleted_on_server', await (async()=>{ for(let i=0;i<80;i++){ if(S('v6').deleted && fake.t.tasks.get('t2').notes===L3+'\n\n'+L6) return true; await new Promise(r=>setTimeout(r,100)); } return false; })(), {v6:S('v6'), t2:fake.t.tasks.get('t2').notes});
    // The step on its own: twice changes nothing; a copy of a folded note (same text and time) adds no line; a note without its task stays
    const st = await A.page.evaluate(()=>{ const before=task('t1').notes; const n0=foldVoiceNotes(DB);
      const W={tasks:[{id:'w1', notes:'Hola'}], voiceNotes:[{id:'x1', taskId:'w1', text:'Primera', created:'2026-11-02T17:40:00.000Z'}, {id:'x2', taskId:'nope', text:'Huérfana', created:'2026-11-02T17:40:00.000Z'}]};
      const n1=foldVoiceNotes(W), once=W.tasks[0].notes; W.voiceNotes.push({id:'x3', taskId:'w1', text:'Primera', created:'2026-11-02T17:40:00.000Z'}); const n2=foldVoiceNotes(W);
      DB.voiceNotes.push({id:'v1b', taskId:'t1', text:'Incluir el punto de riesgos', created:'2026-11-02T17:40:00.000Z'}); const n3=foldVoiceNotes(DB); save();
      return {n0, n1, n2, n3, once, twice:W.tasks[0].notes, left:W.voiceNotes.map(v=>v.id).join(), same:task('t1').notes===before, dbvn:DB.voiceNotes.map(v=>v.id).join()}; });
    check('idempotent', st.n0===0 && st.n1===1 && st.once==='Hola\n\n2/11 18:40: Primera' && st.n2===1 && st.twice===st.once && st.left==='x2' && st.n3===1 && st.same && st.dbvn==='v5', st);
    await A.page.click('[data-tab=tareas]'); await A.page.evaluate(()=>openDetail('t1')); await settled(A.page); await A.page.waitForTimeout(600);
    await A.page.screenshot({path:path.join(OUT,'vn2-sync-detail.png')});
    await A.ctx.close(); }

  /* ---------- 2. iPhone, local ---------- */
  for(const dark of [false, true]){
    const seed={spaces:[{id:'trabajo',name:'Trabajo',order:0,created:OLD},{id:'personal',name:'Personal',order:1,created:OLD}], projects:[{id:'p1', spaceId:'trabajo', name:'FLC', color:'#FF9500', order:0, archived:false, created:OLD, modified:OLD}],
      tasks:[T('t1',{title:'Preparar comité', projectId:'p1', notes:'Orden del día', date:'2026-11-03'}), T('t2',{title:'Llamar a Marta', date:'2026-11-03'}), T('demo-t-1-1',{title:'Tarea de prueba', notes:''})],
      voiceNotes:[{id:'v1',taskId:'t1',text:'Incluir el punto de riesgos',created:'2026-11-02T17:40:00.000Z'},{id:'v2',taskId:'t1',text:'Pedir la versión firmada',created:'2026-11-01T08:05:00.000Z'},
        {id:'v3',taskId:'t2',text:'Llamar antes de las 10',created:'2026-10-30T07:00:00.000Z'},{id:'demo-v-1-1',taskId:'demo-t-1-1',text:'Nota dictada de prueba',created:'2026-11-02T17:40:00.000Z'}],
      attachments:[{id:'au1', taskId:'t1', kind:'audio', path:null, mime:'audio/mp4', size:4000, width:null, height:null, durationMs:65000, created:'2026-11-02T16:00:00.000Z', modified:'2026-11-02T16:00:00.000Z'}], settings:{tipsSeen:true}};
    const tag=dark?'Md':'M'; const {ctx, page} = await device(browser, {tag, seed, dark});
    const s0 = await page.evaluate(()=>({t1:task('t1').notes, t2:task('t2').notes, demo:task('demo-t-1-1').notes, vn:DB.voiceNotes.length, stored:JSON.parse(localStorage.getItem('tareas-v1')).voiceNotes.length, m:task('t1').modified!==task('t1').created}));
    check(tag+'_start_folded', s0.t1===N1 && s0.t2===L3 && s0.demo==='2/11 18:40: Nota dictada de prueba' && !s0.vn && !s0.stored && s0.m, s0);
    // Row: no microphone, the paperclip of the recording
    const row = await page.evaluate(()=>{ const rw=document.querySelector('.row[data-id="t1"]'), x=rw&&rw.querySelector('.inds'), nz=h=>{ const d=document.createElement('span'); d.innerHTML=h; return d.innerHTML; }; return {mic:!!x&&x.innerHTML.includes(nz(I.mic)), clip:!!x&&x.innerHTML.includes(nz(I.clip)), html:x?'':(rw?rw.outerHTML.slice(0,600):'no row')}; });
    check(tag+'_row_no_mic', !row.mic && row.clip, row);
    await page.evaluate(()=>openDetail('t1')); await settled(page); await page.waitForTimeout(500);
    const d = await page.evaluate(()=>{ const s=document.querySelector('.pushed-screen'); return {titles:[...s.querySelectorAll('.group-title')].map(e=>e.textContent), voice:!!s.querySelector('[data-act=voice]'), vn:!!s.querySelector('.vn[data-vn]'), notes:s.querySelector('[data-role=notes]').value, audio:(s.querySelector('[data-act=attAudio] .lbl')||{}).textContent, au:(s.querySelector('.au-name')||{}).textContent}; });
    check(tag+'_detail', !d.titles.includes('Notas de voz') && d.titles.includes('Adjuntos') && !d.voice && !d.vn && d.notes===N1 && d.audio==='Nota de voz' && /^Nota de voz, /.test(d.au||''), d);
    await page.evaluate(()=>{ const s=document.querySelector('.pushed-screen .scroll'); s.scrollTop=s.scrollHeight; }); await page.waitForTimeout(200);
    await page.screenshot({path:path.join(OUT,'vn2-m-detail'+(dark?'-dark':'')+'.png')});
    if(!dark){
      // The recording sheet is «Nota de voz»
      await page.tap('.pushed-screen [data-act=attAudio]'); await page.waitForFunction(()=>sheet.classList.contains('on')); await page.waitForTimeout(600);
      const rs = await page.evaluate(()=>document.querySelector('#sheet .shead h2').textContent); check('M_rec_sheet', rs==='Nota de voz', rs);
      await page.screenshot({path:path.join(OUT,'vn2-m-record.png')});
      await page.evaluate(()=>closeSheet()); await page.waitForTimeout(700);
      // Share text: the lines are in Notas, no «Notas de voz» section
      const sh = await page.evaluate(()=>shareText('t1'));
      check('M_share', sh.includes('\nNotas:\n'+'Orden del día\n\n1/11 09:05: Pedir la versión firmada\n2/11 18:40: Incluir el punto de riesgos\n') && !/Notas de voz/.test(sh), sh);
      // CSV: no «Notas de voz» column
      const head = await page.evaluate(()=>csvText().split('\r\n')[0].replace(/^﻿/,''));
      check('M_csv', !/Notas de voz/.test(head) && head.includes('"Notas";"Pasos"'), head);
      // An export from before decision 49, imported twice: the lines once, no voice notes left, the key still exported
      const imp = await page.evaluate(()=>{ const old={app:'tareas', version:'0.25.1', spaces:DB.spaces, projects:[], tasks:[{id:'i1', title:'Importada', spaceId:'trabajo', projectId:null, date:null, reminder:null, priority:'none', status:'pending', notes:'Texto', carried:false, created:'2026-10-20T10:00:00.000Z', modified:'2026-10-20T10:00:00.000Z', completed:null}],
          voiceNotes:[{id:'iv1', taskId:'i1', text:'Dictada antes', created:'2026-10-20T11:00:00.000Z'}]};
        importData(JSON.stringify(old)); const a=task('i1').notes; importData(JSON.stringify(old)); return {a, b:task('i1').notes, vn:DB.voiceNotes.length, key:Array.isArray(exportData().voiceNotes)}; });
      check('M_import_twice', imp.a==='Texto\n\n20/10 13:00: Dictada antes' && imp.b===imp.a && !imp.vn && imp.key, imp);
      // Search finds the text that was a voice note
      const sr = await page.evaluate(()=>{ const m=queryMatcher('punto de riesgos'); return DB.tasks.filter(m).map(x=>x.id).join(); }); check('M_search', sr==='t1', sr);
    }
    await ctx.close(); }

  /* ---------- 3. Desktop ---------- */
  { const seed={spaces:[{id:'trabajo',name:'Trabajo',order:0,created:OLD},{id:'personal',name:'Personal',order:1,created:OLD}], projects:[],
      tasks:[T('t1',{title:'Preparar comité', notes:'Orden del día', date:'2026-11-03'})], voiceNotes:[{id:'v2',taskId:'t1',text:'Pedir la versión firmada',created:'2026-11-01T08:05:00.000Z'}], attachments:[], settings:{tipsSeen:true}};
    const {ctx, page} = await device(browser, {tag:'D', seed, desk:true, sr:true});
    await page.evaluate(()=>openDetail('t1')); await page.waitForTimeout(500);
    const ins = await page.evaluate(()=>({vn:!!document.querySelector('#desk .vn[data-vn]'), voice:!!document.querySelector('#desk [data-act=voice]'), titles:[...document.querySelectorAll('#desk .group-title')].map(e=>e.textContent), notes:document.querySelector('#desk [data-role=notes]').value, audio:(document.querySelector('#desk [data-act=attAudio] .lbl')||{}).textContent}));
    check('D_inspector', !ins.vn && !ins.voice && !ins.titles.includes('Notas de voz') && ins.notes==='Orden del día\n\n'+L1 && ins.audio==='Nota de voz', ins);
    await page.screenshot({path:path.join(OUT,'vn2-d-inspector.png')});
    await page.keyboard.press('Escape'); await page.waitForTimeout(300);
    const AB='#desk [data-role=addbar]';
    await page.click(AB); await page.keyboard.type('Enviar acta'); await page.waitForFunction(()=>AX.open);
    await page.click('#desk [data-role=addnotes]'); await page.keyboard.type('Antes');
    const btn0 = await page.evaluate(()=>({t:document.querySelector('#desk .axbt[data-ax=voice]').textContent, title:document.querySelector('#desk .axbt[data-ax=voice]').title}));
    await page.click('#desk .axbt[data-ax=voice]'); await page.waitForFunction(()=>AX.notes==='Antes texto dictado');
    const rec = await page.evaluate(()=>({rec:!!AX.rec, v:document.querySelector('#desk [data-role=addnotes]').value, ph:document.querySelector('#desk [data-role=addnotes]').placeholder, t:document.querySelector('#desk .axbt[data-ax=voice]').textContent, extra:!!document.querySelector('#desk [data-role=addvoice]')}));
    check('D_dictates_into_notes', btn0.t==='Dictar' && btn0.title==='Dictar en Notas' && rec.rec && rec.v==='Antes texto dictado' && /^Escuchando/.test(rec.ph) && rec.t==='Escuchando' && !rec.extra, {btn0, rec});
    await page.screenshot({path:path.join(OUT,'vn2-d-dictating.png')});
    await page.click('#desk .axbt[data-ax=voice]'); await page.waitForFunction(()=>!AX.rec);
    await page.click('#desk [data-role=addnotes]'); await page.keyboard.press('End'); await page.keyboard.press('Enter'); await page.waitForTimeout(400);
    const x = await page.evaluate(()=>{ const t=DB.tasks.find(o=>o.title==='Enviar acta'); return t&&{notes:t.notes, vn:DB.voiceNotes.length}; });
    check('D_added_with_notes', x && x.notes==='Antes texto dictado' && x.vn===0, x);
    // Dark
    await page.emulateMedia({colorScheme:'dark'}); await page.evaluate(()=>openDetail('t1')); await page.waitForTimeout(500); await page.screenshot({path:path.join(OUT,'vn2-d-inspector-dark.png')});
    await ctx.close(); }
  }catch(e){ errors.push('fatal: '+(e&&e.stack||e)); }
  await browser.close(); srv.close();
  console.log(JSON.stringify({r, fails, errors}, null, 1));
  process.exit(fails.length||errors.length?1:0);
})();
