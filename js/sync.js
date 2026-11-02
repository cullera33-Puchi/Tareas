'use strict';
/* Tareas. Sync (block 8): Supabase adapter, merge, upload and download runs, realtime, and the Cuenta section of Ajustes.
   A classic script: index.html loads every file of js/ in order and they share their global names. Only declarations and
   listeners run at load; the start itself (first screen, timers, sync, service worker) is in boot.js, the last file. */
/* ======================= SYNC (block 8): Supabase =======================
   The data on the device stays the truth for the screen (rule 7): this block copies it to Supabase and back in the background,
   and never blocks a tap. Without config.js (or signed out) none of it runs and the app works as before.
   - Remote adapter (SY.remote): the only part that talks to the network. supabaseRemote() builds it from config.js; a test puts
     its own fake in window.__tareasRemote. Methods: init, onAuth, signIn, signOut, pull, byIds, upsert, markDeleted, subscribe.
   - What changed, without touching every action: 'tareas-sync' keeps, per table and id, a signature of the version the server
     has (known). A local record whose signature differs goes up; a known id missing here goes up as deleted, with the time the
     deletion was first seen (del); 'x' marks an id the server holds as deleted. A record back after its deletion went up
     (Deshacer, a restored copy) takes a new modified, so it wins over that deletion.
   - Pull: the rows changed after each table's cursor (server_ts, with an overlap: a write can commit after a later one), merged
     with "the newest modified wins" and applied through reloadFromStorage, so open sheets, focused fields and typing are kept.
   - Never synced: the settings (decision 4), demo- ids (decision 3). 'trabajo' and 'personal' get a real id first (decision 2).
   - First connection on a device (or with another account): a local backup, then everything is pulled, the initial spaces are
     matched by name, the newest copy of each record wins and the rest goes up (decision 5). */
const SYNC_KEY='tareas-sync', SUPABASE_JS='vendor/supabase-js-2.117.3.umd.js';
const SYNC_PAGE=1000, SYNC_CHUNK=200, SYNC_OVERLAP=30e3, SYNC_DEBOUNCE=1500, EPOCH='1970-01-01T00:00:00.000Z';
const SYNC_TABLES=[{list:'spaces', table:'spaces'},{list:'projects', table:'projects'},{list:'tasks', table:'tasks'},{list:'voiceNotes', table:'voice_notes'},{list:'attachments', table:'attachments'}]; // attachments after tasks (decision 29)
const INITIAL_SPACES=['trabajo','personal'];
// Local field, column and kind; id, created and modified are common to all.
// tsOpt (block 9, reminder_sent): sent only when set, so the tasks' signatures from before block 9 stay the same and nothing is sent again;
// the database clears it when the reminder changes and keeps the server's value when an unchanged reminder comes without it (0002_push.sql)
// textN, tsN (decisions 38 and 39, repeat and focus): left out of the signature while null, so the tasks from before them keep theirs and
// nothing is sent again; but sent as null when cleared (syncSendRow). A database without the column (0004_repeat_focus.sql not run yet)
// is found on the first upload that names it: from then on, in this session, the column is left out both ways and the value stays on the device
const SYNC_FIELDS={
  spaces:[['name','name','text'],['order','sort_order','int']],
  projects:[['spaceId','space_id','id'],['name','name','text'],['color','color','id'],['order','sort_order','int'],['archived','archived','bool']],
  tasks:[['spaceId','space_id','id'],['projectId','project_id','id'],['title','title','text'],['date','date','day'],['reminder','reminder','ts'],['priority','priority','pri'],['status','status','status'],['notes','notes','text'],['carried','carried','bool'],['completed','completed','ts'],['reminderSent','reminder_sent','tsOpt'],['repeat','repeat','textN'],['focus','focus','tsN'],['waitingFor','waiting_for','textN']],
  voice_notes:[['taskId','task_id','id'],['text','text','text']],
  // Decision 29 (0003_attachments.sql): the record of a photo or a recording; its file goes to Storage first (attFlush)
  attachments:[['taskId','task_id','id'],['kind','kind','kind'],['path','path','id'],['mime','mime','id'],['size','size','int'],['width','width','int'],['height','height','int'],['durationMs','duration_ms','int']] };
const syncTs = v => { if(!v) return null; const d=new Date(v); return isNaN(d) ? null : d.toISOString(); };
const SYNC_TO={ id:v=>v==null||v===''?null:String(v), text:v=>v==null?'':String(v), int:v=>v==null||v===''||isNaN(+v)?null:Math.round(+v), bool:v=>!!v,
  day:v=>/^\d{4}-\d{2}-\d{2}$/.test(String(v||''))?v:null, ts:syncTs, tsOpt:syncTs, tsN:syncTs, textN:v=>v==null||v===''?null:String(v), pri:v=>['high','mid','none'].includes(v)?v:'none', status:v=>['pending','done','waiting'].includes(v)?v:'pending', kind:v=>['photo','audio'].includes(v)?v:null };
const syncNullable = k => k==='textN'||k==='tsN';
// Columns the database turned out not to have (table.column), for this session: 0004_repeat_focus.sql not run yet
const SYNC_NOCOL=new Set();
const syncNoCol = (table, c) => SYNC_NOCOL.has(table+'.'+c);
// A local record as a row: always the same keys in the same order, so the signature only changes with the content
function syncToRow(table, rec){ const row={id:String(rec.id), created:syncTs(rec.created)};
  SYNC_FIELDS[table].forEach(([f,c,k])=>{ let v=SYNC_TO[k](rec[f]); if(k==='status'&&v==='waiting'&&syncNoCol(table,'status:waiting')) v='pending'; // decision 41 on a database that refuses it: pending there, waiting here
    if(syncNullable(k)){ if(v!==null&&!syncNoCol(table,c)) row[c]=v; } else if(k!=='tsOpt'||v!==null) row[c]=v; });
  row.modified=syncTs(rec.modified)||row.created||EPOCH;
  row.deleted=null; // sent every time: a record back after its deletion clears the server's mark
  return row; }
// The row that goes up: a nullable column the signature left out goes as null, so a value cleared here is cleared there too
function syncSendRow(table, row){ let out=row; SYNC_FIELDS[table].forEach(([f,c,k])=>{ if(syncNullable(k)&&!(c in row)&&!syncNoCol(table,c)){ if(out===row) out=Object.assign({}, row); out[c]=null; } }); return out; }
// A row as a local record. A voice note keeps no modified until it is edited (decision 19). A nullable column the row lacks (a database
// without it) is left out, and the merge keeps the device's value
function syncFromRow(table, row){ const rec={id:row.id, created:syncTs(row.created)};
  SYNC_FIELDS[table].forEach(([f,c,k])=>{ if(syncNullable(k)&&!(c in row)) return; rec[f]=SYNC_TO[k](row[c]); });
  const m=syncTs(row.modified); if(table!=='voice_notes' || (m && m!==rec.created)) rec.modified=m; return rec; }
// A short hash of the row text (cyrb53): the signature kept for each record
function syncHash(str){ let h1=0xdeadbeef, h2=0x41c6ce57; for(let i=0;i<str.length;i++){ const c=str.charCodeAt(i); h1=Math.imul(h1^c,2654435761); h2=Math.imul(h2^c,1597334677); }
  h1=Math.imul(h1^(h1>>>16),2246822507)^Math.imul(h2^(h2>>>13),3266489909); h2=Math.imul(h2^(h2>>>16),2246822507)^Math.imul(h1^(h1>>>13),3266489909);
  return (4294967296*(2097151&h2)+(h1>>>0)).toString(36); }
const syncSig = row => syncHash(JSON.stringify(row));
const syncDemoId = id => String(id).startsWith('demo-');
// Records that never go up: demo data, notes and attachments of demo tasks, the initial spaces until they get their real id, and an attachment
// whose file has not reached Storage yet (no path: attFlush gives it one once uploaded)
const syncSkip = (table, rec) => syncDemoId(rec.id) || (table==='spaces'&&INITIAL_SPACES.includes(rec.id)) || ((table==='voice_notes'||table==='attachments')&&syncDemoId(rec.taskId)) || (table==='attachments'&&!rec.path);
// A table the database does not have yet (attachments before 0003_attachments.sql ran): left out of this session's sync
const syncMissing = table => !!(SY&&SY.remote&&SY.remote.missing&&SY.remote.missing.has(table));
function syncState(){ let s=null; try{ s=JSON.parse(localStorage.getItem(SYNC_KEY)||'null'); }catch(e){}
  if(!s||typeof s!=='object') s={}; ['known','cursor','del'].forEach(k=>{ if(!s[k]||typeof s[k]!=='object') s[k]={}; });
  SYNC_TABLES.forEach(({table})=>{ s.known[table]=s.known[table]||{}; s.del[table]=s.del[table]||{}; }); return s; }
function syncWrite(s){ try{ localStorage.setItem(SYNC_KEY, JSON.stringify(s)); return true; }catch(e){ log('warn','No se pudo guardar el estado de la sincronización: '+(e&&e.message||e)); return false; } }
const syncTime = v => { const t=Date.parse(v||''); return isNaN(t)?0:t; };
const syncOffline = e => !navigator.onLine || /fetch|network|load failed|conexi|timeout|abort/i.test(String(e&&(e.message||e.name)||e));

/* ---------- Remote adapter: Supabase ---------- */
function loadScript(src){ return new Promise((res,rej)=>{ const s=document.createElement('script'); s.src=src; s.onload=()=>res(); s.onerror=()=>rej(new Error('No se pudo cargar '+src)); document.head.appendChild(s); }); }
// After the Google sign-in: the code and any error leave the address, other parameters (such as ?add=) stay
function cleanAuthUrl(){ try{ const u=new URL(location.href); const err=u.searchParams.get('error_description')||u.searchParams.get('error');
  let n=0; ['code','error','error_code','error_description','state'].forEach(k=>{ if(u.searchParams.has(k)){ u.searchParams.delete(k); n++; } });
  if(n) history.replaceState(history.state, '', u.pathname+(u.searchParams.toString()?'?'+u.searchParams:'')+u.hash);
  if(err){ log('error','Inicio de sesión rechazado: '+err); toast('No se pudo iniciar sesión'); } }catch(e){} }
function supabaseRemote(cfg){
  let client=null; const T=SYNC_TABLES.map(t=>t.table); const fnUrl=cfg.url+'/functions/v1/send-reminders';
  const db=()=>{ if(!client) throw new Error('Cliente de Supabase no cargado'); return client; };
  const rows=({data,error})=>{ if(error) throw error; return data||[]; };
  const user=u=>u?{id:u.id, email:u.email||''}:null;
  let noSent=false; const stripSent=r=>{ if(!('reminder_sent' in r)) return r; const c=Object.assign({}, r); delete c.reminder_sent; return c; };
  // Decision 29 published before 0003_attachments.sql ran: the table is not there, the rest syncs as before and the attachments stay on the device
  const missing=new Set(), absent=(table, error)=>{ if(table!=='attachments'||!error) return false; const m=String(error.message||'')+' '+String(error.code||'');
    if(!/42P01|PGRST20[0-9]|does not exist|could not find the table|schema cache/i.test(m)) return false;
    if(!missing.has(table)){ missing.add(table); log('warn','La base de datos no tiene todavía la tabla '+table+': falta 0003_attachments.sql. Los adjuntos se quedan en este dispositivo'); } return true; };
  return { missing,
    async init(){
      if(!client){ if(!window.supabase) await loadScript(SUPABASE_JS);
        client=window.supabase.createClient(cfg.url, cfg.anonKey, {auth:{flowType:'pkce', detectSessionInUrl:true, persistSession:true, autoRefreshToken:true, storageKey:'tareas-auth'}}); }
      const back=new URLSearchParams(location.search).has('code'); // back from Google: getSession exchanges the code first
      const {data, error}=await client.auth.getSession(); cleanAuthUrl(); if(error) throw error;
      const u=user(data&&data.session&&data.session.user);
      if(back && !u){ log('error','Inicio de sesión no completado: la vuelta de Google no trajo sesión'); toast('No se pudo iniciar sesión'); }
      return u; },
    // The callback runs outside the auth lock: calling the client from inside it can wait for ever
    onAuth(cb){ db().auth.onAuthStateChange((ev, session)=>{ if(ev==='SIGNED_IN'||ev==='SIGNED_OUT'||ev==='USER_UPDATED') setTimeout(()=>cb(user(session&&session.user), ev), 0); }); },
    async signIn(){ const {error}=await db().auth.signInWithOAuth({provider:'google', options:{redirectTo:location.origin+location.pathname}}); if(error) throw error; },
    async signOut(){ const {error}=await db().auth.signOut({scope:'local'}); if(error) throw error; },
    async pull(table, after, limit){ let q=db().from(table).select('*').order('server_ts',{ascending:true}).order('id',{ascending:true}).limit(limit); if(after) q=q.gt('server_ts', after); const res=await q; if(absent(table, res.error)) return []; return rows(res); },
    async byIds(table, ids){ return rows(await db().from(table).select('*').in('id', ids)); },
    // Rows the server keeps because its copy is newer are left out of the answer (trigger in 0001_init.sql)
    async upsert(table, list){ const send=l=>db().from(table).upsert(l, {onConflict:'id', defaultToNull:false}).select('id');
      let res=await send(noSent?list.map(stripSent):list);
      // Block 9 published before 0002_push.sql ran: without the reminder_sent column the rows go without it (the reminders then may notify once more)
      if(res.error && table==='tasks' && /reminder_sent/.test(res.error.message||'')){ if(!noSent) log('warn','La base de datos no tiene todavía la columna reminder_sent: falta 0002_push.sql'); noSent=true; res=await send(list.map(stripSent)); }
      return rows(res); },
    async markDeleted(table, items){ return rows(await db().from(table).upsert(items.map(x=>({id:x.id, deleted:x.ts, modified:x.ts})), {onConflict:'id', defaultToNull:false}).select('id')); },
    subscribe(uid, onRow, onStatus){ const c=db(); const ch=c.channel('tareas-'+uid);
      T.filter(t=>!missing.has(t)).forEach(t=>ch.on('postgres_changes', {event:'*', schema:'public', table:t, filter:'owner_id=eq.'+uid}, p=>{ if(p&&p.new&&p.new.id) onRow(t, p.new); }));
      ch.subscribe((st, err)=>onStatus(st, err)); return ()=>{ try{ c.removeChannel(ch); }catch(e){} }; },
    // Block 9: the Edge Function's public key, this device's subscription (0002_push.sql) and the account's devices
    async pushKey(){ const r=await fetch(fnUrl+'?publicKey', {headers:{apikey:cfg.anonKey}}); const j=await r.json().catch(()=>({}));
      if(!r.ok) throw new Error('Función de notificaciones: '+(j.error||'HTTP '+r.status)); return j.publicKey; },
    async pushSave(s){ const {error}=await db().rpc('tareas_push_subscribe', {p_id:s.id, p_endpoint:s.endpoint, p_p256dh:s.p256dh, p_auth:s.auth, p_device:s.device}); if(error) throw error; },
    async pushList(){ return rows(await db().from('push_subscriptions').select('id,device,created').is('deleted', null).order('created', {ascending:true})); },
    async pushRevoke(id){ const ts=new Date().toISOString(); return rows(await db().from('push_subscriptions').update({deleted:ts, modified:ts}).eq('id', id).select('id')); },
    async pushTest(id){ const {data}=await db().auth.getSession(); const tok=data&&data.session&&data.session.access_token; if(!tok) throw new Error('Sin sesión');
      const r=await fetch(fnUrl, {method:'POST', headers:{apikey:cfg.anonKey, Authorization:'Bearer '+tok, 'Content-Type':'application/json'}, body:JSON.stringify({test:true, id})});
      const j=await r.json().catch(()=>({})); if(!r.ok) throw new Error('Función de notificaciones: '+(j.error||'HTTP '+r.status)); return j; },
    // Decision 29: the private bucket, a folder per user (0003_attachments.sql); downloads through short-lived signed URLs
    // supabase-js sends a Blob as a form whose file part carries the Blob's own type: the type is set on the Blob itself
    async fileUpload(path, blob, mime){ const type=mime||blob.type||'application/octet-stream', b=blob.type===type?blob:new Blob([blob], {type});
      const {error}=await db().storage.from(ATT_BUCKET).upload(path, b, {contentType:type, upsert:true, cacheControl:'31536000'}); if(error) throw error; },
    async fileUrl(path, ttl){ const {data, error}=await db().storage.from(ATT_BUCKET).createSignedUrl(path, ttl||SIGN_TTL); if(error) throw error; if(!data||!data.signedUrl) throw new Error('Sin enlace firmado'); return data.signedUrl; }
  };
}

/* ---------- Merge ---------- */
// The initial spaces get a real id: the server's space with the same name (accents and case ignored) or a new one.
// pool: the server's spaces on a first connection; otherwise the local ones that already have a real id (a restored old copy)
function syncRemapSpaces(W, pool){ const out=[], used=new Set();
  INITIAL_SPACES.forEach(old=>{ const sp=W.spaces.find(s=>s.id===old); if(!sp) return;
    const match=(pool||W.spaces.filter(s=>!INITIAL_SPACES.includes(s.id))).find(r=>!used.has(r.id) && norm(r.name).trim()===norm(sp.name).trim());
    const nid=match?match.id:uid(); used.add(nid);
    if(match && W.spaces.some(s=>s!==sp && s.id===nid)) W.spaces.splice(W.spaces.indexOf(sp),1); // already here: the copy goes
    else if(match) Object.assign(sp, match); // the server's space as it is there: same id, name and order
    else { sp.id=nid; if(!sp.modified) sp.modified=sp.created||new Date().toISOString(); }
    W.projects.forEach(p=>{ if(p.spaceId===old) p.spaceId=nid; }); W.tasks.forEach(x=>{ if(x.spaceId===old) x.spaceId=nid; });
    if(W.settings && W.settings.activeSpace===old) W.settings.activeSpace=nid;
    if(W.settings && W.settings.workWeek && old in W.settings.workWeek){ const w=Object.assign({}, W.settings.workWeek); w[nid]=w[old]; delete w[old]; W.settings.workWeek=w; } // decision 35: the space's calendar option follows its new id
    out.push({from:old, to:nid, name:sp.name, found:!!match}); });
  return out; }
// Server rows into the working copy W, newest modified first; st.known learns what the server holds. Returns what changed here
function syncMerge(W, st, table, rows, stats){
  const list=SYNC_TABLES.find(t=>t.table===table).list, known=st.known[table], dels=st.del[table];
  const at=new Map(); W[list].forEach((r,i)=>{ if(r&&r.id!=null) at.set(r.id,i); });
  let removed=false;
  rows.forEach(row=>{ if(!row||row.id==null||syncDemoId(row.id)) return; const id=row.id;
    const remote=row.deleted?null:syncFromRow(table,row), rsig=remote?syncSig(syncToRow(table,remote)):'x';
    const i=at.has(id)?at.get(id):-1, local=i>=0?W[list][i]:null;
    if(!local){
      if(remote){ // known and missing here: deleted on this device and not yet sent. The later of the two wins
        const pend=known[id]!==undefined && known[id]!=='x', d=pend?(dels[id]=dels[id]||new Date().toISOString()):null;
        if(pend && syncTime(row.modified)<=syncTime(d)){ known[id]=rsig; return; }
        W[list].push(remote); at.set(id, W[list].length-1); delete dels[id]; stats.added++; }
      known[id]=rsig; return; }
    const lrow=syncToRow(table,local), lsig=syncSig(lrow);
    if(lsig===rsig){ known[id]=rsig; return; }
    const dirty=lsig!==known[id], rm=syncTime(row.modified), lm=syncTime(lrow.modified);
    // Back here after its deletion went up (Deshacer, a restored copy): that deletion is older than the return, which wins
    const takeRemote = !(known[id]==='x' && !remote) && (rm>lm || (rm===lm && !dirty));
    if(dirty && known[id]!=='x') stats.conflicts.push({table, id, won:takeRemote?'servidor':'local'});
    known[id]=rsig; // what the server holds now: a local copy that stays different goes up afterwards
    if(!takeRemote) return;
    if(!remote){ W[list][i]=null; removed=true; stats.removed++;
      if(table==='tasks'){ W.voiceNotes.forEach((v,j)=>{ if(v&&v.taskId===id){ W.voiceNotes[j]=null; } }); W.attachments.forEach((a,j)=>{ if(a&&a.taskId===id){ W.attachments[j]=null; } }); } return; }
    const keep={}; Object.keys(local).forEach(k=>{ if(!(k in lrow) && !SYNC_FIELDS[table].some(f=>f[0]===k)) keep[k]=local[k]; }); // fields this model does not sync stay
    SYNC_FIELDS[table].forEach(([f,c,k])=>{ if(syncNullable(k)&&!(c in row)&&local[f]!=null) keep[f]=local[f]; }); // and a column the server lacks keeps the device's value
    if(table==='tasks'&&syncNoCol(table,'status:waiting')&&local.status==='waiting'&&remote.status==='pending'){ keep.status='waiting'; if(local.waitingFor) keep.waitingFor=local.waitingFor; } // so does a status it cannot hold
    W[list][i]=Object.assign(keep, remote); stats.updated++; });
  if(removed) SYNC_TABLES.forEach(({list:l})=>{ W[l]=W[l].filter(Boolean); });
}
/* Applies server rows to the data, in one synchronous step so no tap can land in between. The result is written to storage and
   taken in by reloadFromStorage: open sheets, a focused field and typing waiting for its save are kept, and the screens redraw.
   pulled: {table: rows}; o.cursor moves the tables' cursors (a pull; realtime events do not); o.pool runs the space matching */
function syncApply(pulled, o){ o=o||{};
  const st=syncState(), stats={added:0, updated:0, removed:0, conflicts:[], remaps:[]};
  const W={spaces:DB.spaces.map(x=>Object.assign({},x)), projects:DB.projects.map(x=>Object.assign({},x)), tasks:DB.tasks.map(x=>Object.assign({},x)), voiceNotes:DB.voiceNotes.map(x=>Object.assign({},x)), attachments:DB.attachments.map(x=>Object.assign({},x)), settings:Object.assign({}, DB.settings)};
  if(o.pool || W.spaces.some(s=>INITIAL_SPACES.includes(s.id))) stats.remaps=syncRemapSpaces(W, o.pool||null);
  SYNC_TABLES.forEach(({table})=>{ const rows=pulled[table]||[]; if(rows.length) syncMerge(W, st, table, rows, stats);
    if(o.cursor) rows.forEach(r=>{ if(syncTime(r.server_ts)>syncTime(st.cursor[table])) st.cursor[table]=r.server_ts; }); });
  const changed=stats.added+stats.updated+stats.removed+stats.remaps.length;
  if(changed){ const t=todayStr(); W.tasks.forEach(x=>{ if(x.status==='pending'&&x.date&&x.date<t) Object.assign(x, dayPatch(x, t, {carried:true})); if(x.focus&&localDay(x.focus)<t) x.focus=null; }); // as rollOver: never overdue, the reminder goes along (decision 25), Ahora of an earlier day emptied (decision 39), modified untouched
    if(!W.spaces.length) return stats; // never leave the app without a space (load would put Trabajo and Personal back)
    const raw=JSON.stringify(Object.assign({}, DB, W));
    try{ localStorage.setItem(KEY, raw); }catch(e){ log('error','Sincronización: no se pudieron guardar los cambios recibidos: '+(e&&e.message||e)); throw e; }
    syncWrite(st); reloadFromStorage('sync');
    stats.conflicts.forEach(c=>log('info','Conflicto resuelto: gana la copia '+(c.won==='servidor'?'del servidor':'local'), {table:c.table, id:c.id}));
    stats.remaps.forEach(r=>log('info','Espacio '+r.name+(r.found?' unido al de la cuenta':' con identificador nuevo'), r));
  } else syncWrite(st);
  return stats; }

/* ---------- Push ---------- */
// What differs from the server now. dry: only count it (Ajustes), without marking anything
function syncCollect(dry){ const st=syncState(), now=new Date().toISOString(), up={}, del={}; let n=0, bumped=false;
  SYNC_TABLES.forEach(({list, table})=>{ const known=st.known[table], dels=st.del[table], here=new Set(); up[table]=[]; del[table]=[]; if(syncMissing(table)) return;
    DB[list].forEach(rec=>{ if(!rec||rec.id==null) return; here.add(rec.id); if(syncSkip(table, rec)) return;
      if(known[rec.id]==='x' && !dry){ rec.modified=now; bumped=true; } // back after its deletion went up: this copy is the newest
      const row=syncToRow(table, rec), s=syncSig(row); if(s!==known[rec.id]){ up[table].push({row:syncSendRow(table, row), s}); n++; }
      if(!dry) delete dels[rec.id]; });
    Object.keys(known).forEach(id=>{ if(known[id]==='x' || here.has(id) || syncDemoId(id)) return; n++;
      if(!dry){ if(!dels[id]) dels[id]=now; del[table].push({id, ts:dels[id]}); } }); });
  if(!dry){ syncWrite(st); if(bumped){ SY.quiet=true; try{ save(); } finally{ SY.quiet=false; } } }
  return {up, del, count:n}; }
/* An upload that names a column the database lacks (repeat or focus before 0004_repeat_focus.sql) is refused whole: the column is noted
   once, logged, and the same rows go again without it. Any other error goes on as before */
const SYNC_NULLCOLS = table => SYNC_FIELDS[table].filter(([,,k])=>syncNullable(k)).map(([,c])=>c);
function syncColRefused(table, e){ const m=String(e&&(e.message||e.details||e)||'')+' '+String(e&&e.code||'');
  if(!/PGRST204|42703|column|schema cache/i.test(m)) return null; return SYNC_NULLCOLS(table).find(c=>!syncNoCol(table,c)&&new RegExp('(^|\\W)'+c+'(\\W|$)').test(m))||null; }
// The status check of 0001 (pending or done) refuses 'waiting' (decision 41) until 0004 widens it: from then on such tasks go up as pending
const syncWaitRefused = (table, e) => { const m=String(e&&(e.message||e.details||e)||'')+' '+String(e&&e.code||''); return table==='tasks'&&!syncNoCol(table,'status:waiting')&&/23514|check constraint/i.test(m)&&/status/i.test(m); };
const NOCOL_WHAT={repeat:'La repetición', focus:'Ahora', waiting_for:'Esperando a'};
async function syncUpsert(table, rows){ for(;;){ const send=rows.map(r=>{ let o=r; SYNC_NULLCOLS(table).forEach(c=>{ if(syncNoCol(table,c)&&c in o){ if(o===r) o=Object.assign({}, r); delete o[c]; } });
      if(o.status==='waiting'&&syncNoCol(table,'status:waiting')){ if(o===r) o=Object.assign({}, r); o.status='pending'; } return o; });
    try{ return await SY.remote.upsert(table, send); }
    catch(e){ if(syncWaitRefused(table, e)){ SYNC_NOCOL.add(table+'.status:waiting'); log('warn','La base de datos no admite todavía el estado Por confirmar: falta 0004_repeat_focus.sql. Esas tareas se envían como pendientes y siguen por confirmar en este dispositivo'); continue; }
      const c=syncColRefused(table, e); if(!c) throw e; SYNC_NOCOL.add(table+'.'+c); log('warn','La base de datos no tiene todavía la columna '+table+'.'+c+': falta 0004_repeat_focus.sql. '+NOCOL_WHAT[c]+' se queda en este dispositivo'); } } }
async function syncPush(c){ const out={pushed:0, deleted:0, kept:0}; const late={};
  for(const {table} of SYNC_TABLES){
    for(let i=0;i<c.up[table].length;i+=SYNC_CHUNK){ const part=c.up[table].slice(i,i+SYNC_CHUNK);
      const ok=new Set((await syncUpsert(table, part.map(x=>x.row))).map(r=>r.id)); const st=syncState();
      part.forEach(x=>{ if(ok.has(x.row.id)){ st.known[table][x.row.id]=x.s; out.pushed++; } else (late[table]=late[table]||[]).push(x.row.id); }); syncWrite(st); }
    for(let i=0;i<c.del[table].length;i+=SYNC_CHUNK){ const part=c.del[table].slice(i,i+SYNC_CHUNK);
      const ok=new Set((await SY.remote.markDeleted(table, part)).map(r=>r.id)); const st=syncState();
      part.forEach(x=>{ if(ok.has(x.id)){ st.known[table][x.id]='x'; delete st.del[table][x.id]; out.deleted++; } else (late[table]=late[table]||[]).push(x.id); }); syncWrite(st); } }
  // The server kept a newer copy of these: fetch them so the newest wins here too
  const got={}; for(const table of Object.keys(late)){ got[table]=[]; for(let i=0;i<late[table].length;i+=100){ got[table].push(...await SY.remote.byIds(table, late[table].slice(i,i+100))); } out.kept+=late[table].length; }
  if(out.kept) syncApply(got, {});
  return out; }
async function syncPull(cursor){ const out={};
  for(const {table} of SYNC_TABLES){ if(syncMissing(table)){ out[table]=[]; continue; } let after=cursor&&cursor[table]?new Date(syncTime(cursor[table])-SYNC_OVERLAP).toISOString():null; const rows=[];
    for(;;){ const page=await SY.remote.pull(table, after, SYNC_PAGE); if(page.length<SYNC_PAGE){ rows.push(...page); break; }
      // A full page: the rows of its last instant may continue on the next one, so they are asked for again from the one before
      const last=page[page.length-1].server_ts, keep=page.filter(r=>r.server_ts!==last);
      if(!keep.length){ rows.push(...page); after=last; continue; } rows.push(...keep); after=keep[keep.length-1].server_ts; }
    out[table]=rows; }
  return out; }

/* ---------- Runs ---------- */
function syncPaint(){ if(!SY) return; if(SY.user && !SY.running){ try{ SY.pending=syncCollect(true).count; }catch(e){} }
  if(onSettings() && !busyEditing() && !touchDrag) render(); }
function syncStatus(s){ if(!SY||SY.status===s) return; SY.status=s; syncPaint(); }
// Called by save(): the change goes up a moment after the last one
function syncChanged(){ if(!SY||!SY.user||SY.quiet) return; clearTimeout(SY.timer); SY.timer=setTimeout(()=>syncRun('cambio'), SYNC_DEBOUNCE); }
function syncRetry(){ clearTimeout(SY.timer); const ms=Math.min(300e3, 2000*Math.pow(2, SY.retry++)); SY.timer=setTimeout(()=>syncRun('reintento'), ms); }
// One run: pull, merge, push. Resolves true when it reached the server. Runs one at a time (and one per device with Web Locks)
function syncRun(reason){
  if(!SY||!SY.user||!SY.remote) return Promise.resolve(false);
  if(SY.running){ SY.again=true; return SY.runP; }
  clearTimeout(SY.timer);
  if(!SY.ready){ syncInit(); return Promise.resolve(false); }
  if(!navigator.onLine){ SY.status='offline'; syncPaint(); return Promise.resolve(false); }
  SY.running=true; SY.again=false; syncStatus('syncing');
  const body=async()=>{ const t0=Date.now(); const user=SY.user; let st=syncState(); const first=st.owner!==user.id;
    if(first && st.firstFor!==user.id){ // decision 5: a local copy before anything comes in; the account's known state starts empty
      try{ flushEdits(); await BK.put(todayStr()); await refreshBackups(); log('info','Copia local antes de la primera sincronización', {tasks:DB.tasks.length, projects:DB.projects.length}); }
      catch(e){ log('warn','Copia local antes de sincronizar no disponible: '+(e&&e.message||e)); }
      st=syncState(); st.firstFor=user.id; st.known={}; st.cursor={}; st.del={}; syncWrite(st); st=syncState(); }
    const pulled=await syncPull(first?null:st.cursor);
    if(!SY.user || SY.user.id!==user.id) return false; // signed out meanwhile
    const pool=first?(pulled.spaces||[]).filter(r=>!r.deleted).map(r=>syncFromRow('spaces', r)):null;
    const a=syncApply(pulled, {cursor:true, pool});
    const p=await syncPush(syncCollect(false));
    st=syncState(); if(first){ st.owner=user.id; log('info','Primera conexión completada', {spaces:DB.spaces.length, projects:DB.projects.length, tasks:DB.tasks.length, remaps:a.remaps.length}); }
    st.lastSync=new Date().toISOString(); syncWrite(st); SY.lastSync=st.lastSync; SY.retry=0;
    log('info','Sincronización ('+reason+')', {recibidas:a.added+a.updated, eliminadas:a.removed, conflictos:a.conflicts.length, enviadas:p.pushed, borradas:p.deleted, mantenidas:p.kept, ms:Date.now()-t0});
    return true; };
  const locked=()=>(navigator.locks&&navigator.locks.request) ? navigator.locks.request('tareas-sync', body) : body();
  SY.runP=locked().then(ok=>{ SY.running=false; if(ok){ SY.status='ok'; SY.error=''; pushFlush(); attFlushSoon(0); syncResubscribe(); } syncPaint(); if(SY.again) syncChanged(); return !!ok; }, e=>{
    SY.running=false; const off=syncOffline(e); SY.status=off?'offline':'error'; SY.error=String(e&&(e.message||e.code)||e);
    log(off?'warn':'error', 'Sincronización falló ('+reason+'): '+SY.error); syncRetry(); syncPaint(); return false; });
  return SY.runP; }
// The realtime channel leaves out a table the database lacks (attachments before 0003): once a run finds it missing, the channel is made again
const syncMissingKey = () => SY&&SY.remote&&SY.remote.missing?[...SY.remote.missing].join():'';
function syncResubscribe(){ if(SY.unsub&&SY.subKey!==syncMissingKey()){ SY.unsub(); SY.unsub=null; syncSubscribe(); } }
function syncSubscribe(){ if(SY.unsub||!SY.user||!SY.remote.subscribe) return; SY.subKey=syncMissingKey();
  let was=false; SY.unsub=SY.remote.subscribe(SY.user.id, (table,row)=>{ SY.rt.push([table,row]); clearTimeout(SY.rtT); SY.rtT=setTimeout(syncRealtime, 250); }, (st, err)=>{
    if(st==='SUBSCRIBED'){ if(was) syncRun('tiempo real'); was=true; } // back after a cut: catch up with what came meanwhile
    else if(st==='CHANNEL_ERROR'||st==='TIMED_OUT') log('warn','Tiempo real: '+st+(err?' '+(err.message||err):'')); }); }
// Changes from another device, a few at a time, through the same merge
function syncRealtime(){ const ev=SY.rt.splice(0); if(!ev.length||!SY.user) return;
  if(syncState().owner!==SY.user.id){ SY.again=true; return; } // the first connection is still matching the spaces: a run afterwards picks these up
  const pulled={}; ev.forEach(([t,row])=>{ (pulled[t]=pulled[t]||[]).push(row); });
  try{ const a=syncApply(pulled, {}); const n=a.added+a.updated+a.removed; if(n) log('info','Cambios recibidos en tiempo real', {recibidas:a.added+a.updated, eliminadas:a.removed, conflictos:a.conflicts.length}); if(n||a.conflicts.length) syncChanged(); }
  catch(e){ log('error','Tiempo real: '+(e&&e.message||e)); } }
function syncSetUser(user, why){
  const st=syncState();
  if(user){ const changed=!SY.user||SY.user.id!==user.id; SY.user={id:user.id, email:user.email||''}; st.user=SY.user; syncWrite(st);
    if(changed) log('info','Sesión iniciada', SY.user.email);
    syncSubscribe(); if(changed || why==='inicio') syncRun(why==='inicio'?'inicio':'sesión'); }
  else if(SY.user){ log('info', why==='SIGNED_OUT'?'Sesión cerrada':'Sesión no válida: se deja de sincronizar'); SY.user=null; st.user=null; syncWrite(st);
    if(SY.unsub){ SY.unsub(); SY.unsub=null; } clearTimeout(SY.timer); SY.status='idle'; }
  syncPaint(); }
// Loads the client and reads the session. Offline at start a known session is kept: it is checked when the connection returns
function syncInit(){ if(!SY||!SY.remote||SY.initP) return; SY.initP=SY.remote.init().then(user=>{ SY.ready=true;
    if(!SY.authBound){ SY.authBound=true; SY.remote.onAuth((u, ev)=>syncSetUser(u, ev)); }
    if(user) syncSetUser(user, 'inicio'); else if(SY.user && !navigator.onLine) syncStatus('offline'); else syncSetUser(null, 'inicio'); }, e=>{
    log('warn','Sincronización no disponible: '+(e&&e.message||e)); SY.status=syncOffline(e)?'offline':'error'; syncPaint(); })
  .finally(()=>{ SY.initP=null; }); }
// The project URL as stored in the repository secret, written in any usual form: the full URL, without https://, with a path
// such as /auth/v1/callback or /rest/v1, in quotes, or only the project ref. Returns the origin or null.
function normSupabaseUrl(v){ let u=String(v||'').trim().replace(/^["']|["']$/g,'').trim(); if(!u) return null;
  if(!/^https?:\/\//i.test(u)) u=/^[a-z0-9]{15,30}$/i.test(u)?'https://'+u+'.supabase.co':'https://'+u;
  try{ const x=new URL(u); return /\./.test(x.hostname)?x.origin:null; }catch(e){ return null; } }
function syncBoot(){
  const cfg=window.TAREAS_CONFIG, fake=window.__tareasRemote; // __tareasRemote: a test's stand-in for the server
  const url=cfg&&normSupabaseUrl(cfg.url), key=cfg&&cfg.anonKey&&String(cfg.anonKey).trim().replace(/^["']|["']$/g,'');
  if(cfg&&cfg.url&&!url) log('warn','La dirección de Supabase guardada no es válida', {length:String(cfg.url).length});
  const remote=fake||(url&&key?supabaseRemote({url, anonKey:key}):null); if(!remote) return; // no config: local only, as before
  const st=syncState();
  SY={remote, user:st.user||null, status:'idle', error:'', ready:false, running:false, again:false, runP:null, timer:0, retry:0, pending:0, unsub:null, rt:[], rtT:0, quiet:false, lastSync:st.lastSync||null, initP:null, authBound:false};
  window.addEventListener('online', ()=>{ SY.retry=0; UQ.retry=0; if(!SY.ready) syncInit(); else syncRun('conexión'); }); // the run uploads the attachments waiting (attFlush) once it reaches the server
  window.addEventListener('offline', ()=>syncStatus('offline'));
  document.addEventListener('visibilitychange', ()=>{ if(document.visibilityState==='visible' && SY.user) syncRun('vuelta'); });
  setInterval(()=>{ if(onSettings() && SY.user && !busyEditing()) render(); }, 6e4); // "hace 3 min" stays true
  syncInit(); if(onSettings()) render(); }
async function syncSignIn(){ if(!SY) return; if(!navigator.onLine){ toast('Sin conexión'); return; }
  try{ if(!SY.ready){ syncInit(); await SY.initP; } flushHeld(true); flushEdits(); log('info','Inicio de sesión con Google'); await SY.remote.signIn(); }
  catch(e){ log('error','Inicio de sesión falló: '+(e&&e.message||e)); toast('No se pudo iniciar sesión'); } }
function syncSignOutSheet(){ const dev=UI.wide?'este dispositivo':'este iPhone';
  confirmSheet('Cerrar sesión', 'Los datos se quedan en '+dev+' y dejan de sincronizarse.', async()=>{ await pushSignOut(); try{ await SY.remote.signOut(); }catch(e){ log('warn','Cerrar sesión: '+(e&&e.message||e)); } syncSetUser(null, 'SIGNED_OUT'); toast('Sesión cerrada'); }); }

/* ---------- Ajustes, Cuenta ---------- */
function syncAgo(iso){ const t=syncTime(iso); if(!t) return ''; const m=Math.floor((Date.now()-t)/6e4);
  if(m<1) return 'hace un momento'; if(m<60) return 'hace '+m+' min';
  const d=localDay(iso); if(d===todayStr()) return 'hoy a las '+fmtTime(iso); if(d===addDays(todayStr(),-1)) return 'ayer a las '+fmtTime(iso);
  const x=new Date(iso); return 'el '+x.getDate()+' '+MESES[x.getMonth()]+' a las '+fmtTime(iso); }
function syncLine(){ if(!SY||!SY.user) return '';
  if(SY.status==='offline') return 'Sin conexión. Se sincronizará al volver';
  if(SY.status==='syncing') return 'Sincronizando';
  if(SY.status==='error') return 'No se pudo sincronizar. Se volverá a intentar';
  return SY.lastSync?'Sincronizado '+syncAgo(SY.lastSync):'Pendiente de la primera sincronización'; }
function syncAccountHTML(dev){
  if(!SY) return '<div class="group-title">Cuenta</div><div class="group"><div class="cell"><span class="lbl">Sincronización</span><span class="val">Solo en '+dev+'</span></div></div>'+
    '<div class="footnote">Sincronización no disponible en esta versión.</div>';
  if(!SY.user) return '<div class="group-title">Cuenta</div><div class="group"><button class="cell link" data-act="signIn"><span class="lbl">Iniciar sesión con Google</span></button></div>'+
    '<div class="footnote">'+(SY.status==='offline'?'Sin conexión. ':'')+'Al iniciar sesión, tus tareas se guardan en tu cuenta y llegan a tus otros dispositivos. Lo que ya hay en '+dev+' se conserva.</div>';
  const n=SY.pending||0, line=syncLine();
  return '<div class="group-title">Cuenta</div><div class="group sync-acc"><div class="cell"><span class="lbl">Cuenta</span><span class="val">'+esc(SY.user.email||'Google')+'</span></div>'+
    '<div class="cell"><span class="lbl sync-line'+(SY.status==='error'||SY.status==='offline'?' warn':'')+'">'+esc(line)+'</span></div>'+
    '<div class="cell"><span class="lbl">Cambios pendientes</span><span class="val">'+(n?n:'Ninguno')+'</span></div>'+
    '<button class="cell link" data-act="syncNow"'+(SY.status==='syncing'?' disabled':'')+'><span class="lbl">Sincronizar ahora</span></button>'+
    '<button class="cell" data-act="signOut"><span class="lbl" style="color:var(--red)">Cerrar sesión</span></button></div>'+
    '<div class="footnote">Al cerrar sesión, los datos se quedan en '+dev+' y dejan de sincronizarse.</div>'; }
