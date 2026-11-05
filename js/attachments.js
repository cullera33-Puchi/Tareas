'use strict';
/* Tareas. Attachments (decision 29): photos and recorded audio, files on the device, upload queue, player, recorder and photo viewer.
   A classic script: index.html loads every file of js/ in order and they share their global names. Only declarations and
   listeners run at load; the start itself (first screen, timers, sync, service worker) is in boot.js, the last file. */
/* ======================= ATTACHMENTS (decision 29): photos and recorded audio =======================
   A task holds photos and recordings in DB.attachments: {id, taskId, kind 'photo' or 'audio', path, mime, size, width, height,
   durationMs, created, modified}. The files themselves never go in localStorage:
   - On the device (FS, IndexedDB 'tareas-files'): whatever is captured is stored here first and shown from here at once. Stores: files
     (the file), thumbs (a JPEG of each photo, 320 px on its short side) and meta (sizes, last use, waiting to upload). Up to FILE_CAP
     (200 MB, decision 29.3): past it the files used longest ago leave the device, never one still waiting to upload; thumbnails stay.
   - Upload (attFlush): signed in and online, each file waiting goes to the private bucket at <owner>/<task>/<id>.<ext>. Only then does
     the record get its path and go up with the sync (SYNC_TABLES), so another device never gets a record whose file is not there yet.
     Retried with a growing wait, logged. Signed out, or without config, the attachments stay on this device and the detail says so.
   - Download on demand: a record with a path and no file here is fetched through a short-lived signed URL (SY.remote.fileDownload),
     kept (FS) and, for a photo, given its thumbnail.
   - Deleting: the record goes (the sync marks it deleted everywhere) and the file stays in the cache and in Storage, so Deshacer and a
     restored copy bring it back; send-reminders removes the file from Storage 24 hours later (decision 29.4).
   - Screens: the Adjuntos group of the detail (iPhone and inspector), the photo viewer (openViewer) and the recorder (recordSheet).
     Object URLs are made when a file is shown and revoked once nothing on screen shows it (fuGC). */
const FILES_DB='tareas-files', ATT_BUCKET='attachments';
const ATT_EXT={'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/heic':'heic','image/gif':'gif','audio/mp4':'m4a','audio/x-m4a':'m4a','audio/aac':'aac','audio/webm':'webm','audio/ogg':'ogg','audio/mpeg':'mp3','audio/wav':'wav'};
let FILE_CAP=200*1024*1024, REC_MAX_MS=10*60*1000; // decisions 29.3 and 29.2 (a test lowers them)
const PHOTO_MAX=2048, PHOTO_Q=0.82, THUMB_SIDE=320, THUMB_Q=0.72, SIGN_TTL=300, AUDIO_BPS=48000; // decision 29.1; voice quality for 29.2
const baseMime = m => String(m||'').split(';')[0].trim().toLowerCase();
const att = id => DB.attachments.find(a=>a.id===id);
const attOf = (taskId, kind) => DB.attachments.filter(a=>a.taskId===taskId&&(!kind||a.kind===kind)).sort((a,b)=>a.created<b.created?-1:a.created>b.created?1:0);
const fmtDur = (ms, floor) => { const s=Math.max(0, (floor?Math.floor:Math.round)((ms||0)/1000)); return Math.floor(s/60)+':'+String(s%60).padStart(2,'0'); };
// The tasks with attachments, worked out once per data version (the paperclip of the rows)
let attSetV=-1, attSetC=null;
function hasAtt(taskId){ if(attSetV!==dataVer||!attSetC){ attSetC=new Set(DB.attachments.map(a=>a.taskId)); attSetV=dataVer; } return attSetC.has(taskId); }
// Changes made here to what a render drew (a thumbnail arriving, the progress of a recording) are not changes that need a redraw (R18)
function attOwn(fn){ markDirty(rowWatch.takeRecords()); try{ fn(); } finally{ rowWatch.takeRecords(); } }
const AST=new Map(); // id: 'load' (downloading), 'err' (failed), 'off' (no account or connection), 'none' (the file is nowhere)
const canShareFiles = () => { try{ return !!(navigator.canShare&&navigator.canShare({files:[new File([new Blob(['x'],{type:'image/jpeg'})], 'foto.jpg', {type:'image/jpeg'})]})); }catch(e){ return false; } };
const isSafari = () => isIOS() || (/Safari\//.test(navigator.userAgent) && !/Chrome|Chromium|Edg\//.test(navigator.userAgent));

/* ---------- Files on the device ---------- */
const FS={ p:null, touched:new Map(), evT:0,
  open(){ if(!this.p){ this.p=new Promise((res,rej)=>{ let r; try{ r=indexedDB.open(FILES_DB,1); }catch(e){ rej(e); return; }
      r.onupgradeneeded=()=>{ const d=r.result; ['files','thumbs','meta'].forEach(n=>{ if(!d.objectStoreNames.contains(n)) d.createObjectStore(n,{keyPath:'id'}); }); };
      r.onsuccess=()=>{ const d=r.result; d.onversionchange=()=>{ d.close(); FS.p=null; }; d.onclose=()=>{ FS.p=null; }; res(d); };
      r.onerror=()=>rej(r.error); r.onblocked=()=>rej(new Error('Base de archivos bloqueada')); });
      this.p.catch(()=>{ this.p=null; }); }
    return this.p; },
  // One transaction: fn gets the stores and returns a request (its result is the answer) or a value; resolves once it is written
  async tx(names, mode, fn){ const d=await this.open(); return new Promise((res,rej)=>{ let t, out;
    try{ t=d.transaction(names, mode); out=fn(...names.map(n=>t.objectStore(n))); }catch(e){ rej(e); return; }
    t.oncomplete=()=>res(out&&typeof IDBRequest!=='undefined'&&out instanceof IDBRequest?out.result:out); t.onerror=()=>rej(t.error); t.onabort=()=>rej(t.error||new Error('Escritura cancelada')); }); },
  get(store, id){ return this.tx([store],'readonly',s=>s.get(id)); },
  async getFile(id){ const r=await this.get('files', id); if(!r) return null; this.touch(id); return new Blob([r.buf], {type:r.mime||''}); },
  async getThumb(id){ const r=await this.get('thumbs', id); return r?new Blob([r.buf], {type:'image/jpeg'}):null; },
  meta(id){ return this.get('meta', id); },
  allMeta(){ return this.tx(['meta'],'readonly',s=>s.getAll()); },
  // ArrayBuffers rather than Blobs: every WebKit version keeps them
  async putFile(id, blob, o){ o=o||{}; const buf=await blob.arrayBuffer(), tb=o.thumb?await o.thumb.arrayBuffer():null, now=Date.now();
    await this.tx(['files','thumbs','meta'],'readwrite',(f,t,m)=>{ f.put({id, buf, mime:baseMime(blob.type)}); if(tb) t.put({id, buf:tb});
      const rq=m.get(id); rq.onsuccess=()=>{ const old=rq.result||{}; m.put({id, size:buf.byteLength, tsize:tb?tb.byteLength:(old.tsize||0), pending:!!o.pending, file:true, used:now}); }; });
    this.evictSoon(); },
  async putThumb(id, blob){ const tb=await blob.arrayBuffer();
    await this.tx(['thumbs','meta'],'readwrite',(t,m)=>{ t.put({id, buf:tb}); const rq=m.get(id); rq.onsuccess=()=>{ const x=rq.result||{id, size:0, pending:false, file:false, used:Date.now()}; x.tsize=tb.byteLength; m.put(x); }; }); },
  async setPending(id, v){ await this.tx(['meta'],'readwrite',m=>{ const rq=m.get(id); rq.onsuccess=()=>{ if(rq.result){ rq.result.pending=v; m.put(rq.result); } }; }); },
  // The last use, written at most once a minute per file
  touch(id){ const t=Date.now(); if(t-(this.touched.get(id)||0)<6e4) return; this.touched.set(id,t);
    this.tx(['meta'],'readwrite',m=>{ const rq=m.get(id); rq.onsuccess=()=>{ if(rq.result){ rq.result.used=t; m.put(rq.result); } }; }).catch(()=>{}); },
  async total(){ return (await this.allMeta()).reduce((n,m)=>n+(m.file?m.size:0)+(m.tsize||0), 0); },
  evictSoon(){ clearTimeout(this.evT); this.evT=setTimeout(()=>this.evict().catch(e=>log('warn','Caché de adjuntos: '+(e&&e.message||e))), 300); },
  // Decision 29.3: past the cap, the files used longest ago leave the device (their thumbnails stay); one still waiting to upload never does.
  // A file whose attachment has been gone for a day (deleted, no Deshacer left) goes whole
  async evict(){ const ms=await this.allMeta(), live=new Set(DB.attachments.map(a=>a.id)), day=Date.now()-864e5;
    const gone=ms.filter(m=>!live.has(m.id)&&m.used<day), goneIds=new Set(gone.map(m=>m.id));
    let total=ms.reduce((n,m)=>n+(goneIds.has(m.id)?0:(m.file?m.size:0)+(m.tsize||0)), 0); const before=total, drop=[];
    if(total>FILE_CAP) ms.filter(m=>m.file&&!goneIds.has(m.id)&&!(m.pending&&live.has(m.id))).sort((a,b)=>a.used-b.used).some(m=>{ if(total<=FILE_CAP) return true; drop.push(m); total-=m.size; return false; });
    if(!gone.length&&!drop.length) return;
    await this.tx(['files','thumbs','meta'],'readwrite',(f,t,m)=>{ gone.forEach(x=>{ f.delete(x.id); t.delete(x.id); m.delete(x.id); }); drop.forEach(x=>{ f.delete(x.id); m.put(Object.assign({}, x, {file:false, size:0})); }); });
    log('info','Caché de adjuntos', {quitados:drop.length, huerfanos:gone.length, antes:before, ahora:total, limite:FILE_CAP}); }
};

/* ---------- Object URLs ---------- */
const FU=new Map(); // 'id|t' (thumbnail) or 'id|f' (file): its object URL while something shows it
const fuGet = (id, k) => FU.get(id+'|'+k)||null;
function fuMake(id, k, blob){ const key=id+'|'+k; let u=FU.get(key); if(!u){ u=URL.createObjectURL(blob); FU.set(key, u); } return u; }
let fuT=0; function fuGCSoon(){ clearTimeout(fuT); fuT=setTimeout(fuGC, 900); }
// Whatever no screen shows any more is let go; a recording playing whose row has gone stops
function fuGC(){ const keep=new Set(); document.querySelectorAll('[data-att],[data-au],[data-vw-id]').forEach(e=>keep.add(e.dataset.att||e.dataset.au||e.dataset.vwId));
  if(VW) VW.ids.forEach(i=>keep.add(i));
  if(AP.id&&!keep.has(AP.id)) apStop();
  for(const [key,u] of FU){ if(!keep.has(key.slice(0, key.lastIndexOf('|')))){ URL.revokeObjectURL(u); FU.delete(key); } } }

/* ---------- Getting a file: here, or downloaded ---------- */
const FDL=new Map(); // downloads under way, one per attachment
async function attFile(a){ const b=await FS.getFile(a.id).catch(()=>null); return b||attDownload(a); }
function attDownload(a){ if(FDL.has(a.id)) return FDL.get(a.id);
  if(!a.path){ AST.set(a.id,'none'); return Promise.resolve(null); } // captured on another device that never uploaded it, or imported
  if(!SY||!SY.user||!SY.remote.fileDownload||!navigator.onLine||cryptoLocked()){ AST.set(a.id,'off'); return Promise.resolve(null); } // decision 63a: without the key an encrypted file cannot open
  AST.set(a.id,'load'); const t0=Date.now();
  const p=(async()=>{ const raw=await SY.remote.fileDownload(a.path, SIGN_TTL), blob=baseMime(raw.type)===baseMime(a.mime)?raw:new Blob([raw], {type:a.mime||raw.type});
      await FS.putFile(a.id, blob, {pending:false}).catch(e=>log('warn','Adjunto descargado pero no guardado en el dispositivo: '+(e&&e.message||e)));
      AST.delete(a.id); log('info', a.kind==='photo'?'Foto descargada':'Audio descargado', {size:blob.size, ms:Date.now()-t0}); return blob; })()
    .catch(e=>{ const off=syncOffline(e); AST.set(a.id, off?'off':'err'); log(off?'warn':'error','Adjunto no descargado: '+(e&&(e.message||e.error)||e), {id:a.id}); return null; })
    .finally(()=>FDL.delete(a.id));
  FDL.set(a.id, p); return p; }
// A photo's thumbnail: kept on the device, or made from the file (a remote photo, after its first download)
async function attThumbUrl(a){ const u=fuGet(a.id,'t'); if(u) return u;
  let tb=await FS.getThumb(a.id).catch(()=>null);
  if(!tb){ const f=await attFile(a); if(!f) return null;
    try{ const img=await decodeImage(f); try{ tb=await drawJpeg(img, thumbSize(img.w, img.h), THUMB_Q); } finally{ img.close(); } FS.putThumb(a.id, tb).catch(()=>{}); }
    catch(e){ log('warn','Miniatura no generada: '+(e&&e.message||e)); tb=f; } }
  return fuMake(a.id,'t',tb); }

/* ---------- Photos: decode upright, reduce, compress ---------- */
// The image as the camera held it (EXIF orientation applied). WebKit draws an <img> upright for sure; elsewhere createImageBitmap does it
async function decodeImage(blob){
  if(window.createImageBitmap && !isSafari()){ try{ const b=await createImageBitmap(blob, {imageOrientation:'from-image'}); return {src:b, w:b.width, h:b.height, close:()=>{ try{ b.close(); }catch(e){} }}; }catch(e){} }
  const url=URL.createObjectURL(blob); const img=new Image(); img.decoding='async';
  try{ await new Promise((res,rej)=>{ img.onload=res; img.onerror=()=>rej(new Error('No se pudo leer la imagen')); img.src=url; }); if(img.decode) await img.decode().catch(()=>{});
    return {src:img, w:img.naturalWidth, h:img.naturalHeight, close:()=>URL.revokeObjectURL(url)}; }
  catch(e){ URL.revokeObjectURL(url); throw e; } }
const fitSize = (w, h, max) => { const s=Math.min(1, max/Math.max(w,h)); return {w:Math.max(1,Math.round(w*s)), h:Math.max(1,Math.round(h*s))}; };
const thumbSize = (w, h) => { const s=Math.min(1, THUMB_SIDE/Math.min(w,h), 1280/Math.max(w,h)); return {w:Math.max(1,Math.round(w*s)), h:Math.max(1,Math.round(h*s))}; };
function drawJpeg(img, sz, q){ const c=document.createElement('canvas'); c.width=sz.w; c.height=sz.h; const g=c.getContext('2d');
  g.imageSmoothingEnabled=true; g.imageSmoothingQuality='high'; g.fillStyle='#fff'; g.fillRect(0,0,sz.w,sz.h); g.drawImage(img.src, 0, 0, sz.w, sz.h);
  return new Promise((res,rej)=>c.toBlob(b=>{ c.width=c.height=0; b?res(b):rej(new Error('No se pudo comprimir la imagen')); }, 'image/jpeg', q)); }
// Decision 29.1: at most 2048 px on its long side, JPEG of good quality (re-encoding also leaves the location and the rest of the EXIF out)
async function processPhoto(file){ const img=await decodeImage(file);
  try{ if(!img.w||!img.h) throw new Error('Imagen vacía'); const sz=fitSize(img.w, img.h, PHOTO_MAX);
    const blob=await drawJpeg(img, sz, PHOTO_Q), thumb=await drawJpeg(img, thumbSize(sz.w, sz.h), THUMB_Q);
    return {blob, thumb, w:sz.w, h:sz.h}; }
  finally{ img.close(); } }

/* ---------- Adding ---------- */
// Inside the tap: iOS offers the camera or the library for an image input
function pickPhotos(taskId){ let inp=$('#attFile'); if(!inp){ inp=document.createElement('input'); inp.type='file'; inp.id='attFile'; inp.accept='image/*'; inp.multiple=true; inp.tabIndex=-1; inp.setAttribute('aria-hidden','true'); inp.style.cssText='position:fixed;left:-100px;top:0;width:1px;height:1px;opacity:0'; document.body.appendChild(inp); }
  inp.value=''; inp.onchange=()=>{ const fs=[...(inp.files||[])]; inp.value=''; if(fs.length) addPhotos(taskId, fs); }; inp.click(); }
async function addPhotos(taskId, files){
  const imgs=files.filter(f=>/^image\//.test(f.type||'')||/\.(jpe?g|png|heic|heif|webp|gif)$/i.test(f.name||''));
  if(!imgs.length){ toast('Solo se pueden añadir fotos'); return 0; }
  let n=0;
  for(const f of imgs){ if(!task(taskId)) break; const t0=Date.now();
    try{ const p=await processPhoto(f); const id=uid(), now=new Date().toISOString();
      await FS.putFile(id, p.blob, {pending:true, thumb:p.thumb}); if(!task(taskId)) break;
      fuMake(id,'t',p.thumb); // on screen at once, from the device
      DB.attachments.push({id, taskId, kind:'photo', path:null, mime:'image/jpeg', size:p.blob.size, width:p.w, height:p.h, durationMs:null, created:now, modified:now});
      updTask(taskId,{}); n++; attPaint(taskId);
      log('info','Foto añadida', {w:p.w, h:p.h, size:p.blob.size, original:f.size, ms:Date.now()-t0}); }
    catch(e){ log('error','Foto no añadida: '+(e&&e.message||e), {type:f.type, size:f.size}); toast(/quota|space|IndexedDB|abort|bloque/i.test(String(e&&(e.name+' '+e.message)))?'No hay espacio para guardar la foto en el dispositivo':'No se pudo añadir la foto'); } }
  if(n){ haptic(8); attFlushSoon(); } return n; }
// The Adjuntos group of the screens showing that task changes at once, even while its title or notes are being typed; the rest (the paperclip
// of the list, the pane's own drawing) follows with the next render, now or once the typing ends
function attPaint(taskId){ attRefresh(taskId); if(busyEditing()||touchDrag){ staleView=true; return; } render(); }
function attRefresh(taskId){ const x=task(taskId); if(!x) return;
  const boxes=[...document.querySelectorAll('.att-wrap[data-att-task="'+CSS.escape(taskId)+'"]')];
  boxes.forEach(b=>{ const t=document.createElement('template'); t.innerHTML=attWrapHTML(x); const nb=t.content.firstElementChild; b.replaceWith(nb);
    if(!UI.wide) nb.querySelectorAll('.vn[data-au]').forEach(bindVnGestures); attHydrate(nb); }); }
const attWrapHTML = x => '<div class="att-wrap" data-att-task="'+esc(x.id)+'">'+attGroupHTML(x)+'</div>';
function deleteAttachment(id){ const i=DB.attachments.findIndex(a=>a.id===id); if(i<0) return; const [a]=DB.attachments.splice(i,1);
  if(AP.id===id) apStop(); if(task(a.taskId)) updTask(a.taskId,{}); else save(); haptic(14); attPaint(a.taskId);
  log('info', a.kind==='photo'?'Foto eliminada':'Audio eliminado');
  toast(a.kind==='photo'?'Foto eliminada':'Nota de voz eliminada', ()=>{ if(!DB.attachments.some(x=>x.id===a.id)) DB.attachments.push(a); save(); attPaint(a.taskId); }); }
// A task's attachments leave with it and come back with its Deshacer (deleteTask, the bulk and review deletions, a space)
function cutAttachments(ids){ const out=DB.attachments.filter(a=>ids.has(a.taskId)); if(out.length){ DB.attachments=DB.attachments.filter(a=>!ids.has(a.taskId)); if(AP.id&&out.some(a=>a.id===AP.id)) apStop(); } return out; }
function putAttachments(list){ (list||[]).forEach(a=>{ if(!DB.attachments.some(x=>x.id===a.id)) DB.attachments.push(a); }); }

/* ---------- Upload queue ---------- */
const UQ={running:false, timer:0, retry:0};
function attFlushSoon(ms){ clearTimeout(UQ.timer); UQ.timer=setTimeout(attFlush, ms==null?400:ms); }
async function attFlush(){ if(UQ.running||!SY||!SY.user||!SY.remote.fileUpload||!navigator.onLine||syncMissing('attachments')||cryptoLocked()) return; // decision 63a: uploads wait for the key
  const user=SY.user.id, todo=DB.attachments.filter(a=>!a.path&&!syncDemoId(a.id)&&task(a.taskId)&&!syncDemoId(a.taskId)).map(a=>a.id); if(!todo.length) return;
  UQ.running=true; let done=0;
  try{ for(const id of todo){ if(!SY.user||SY.user.id!==user||!navigator.onLine) break; const a=att(id); if(!a||a.path||!task(a.taskId)) continue;
      const blob=await FS.getFile(id).catch(()=>null); if(!blob){ if(AST.get(id)!=='none'){ AST.set(id,'none'); log('warn','Adjunto sin archivo en este dispositivo: no se puede subir', {id}); } continue; }
      const mime=baseMime(a.mime)||baseMime(blob.type), path=user+'/'+a.taskId+'/'+id+'.'+(ATT_EXT[mime]||'bin'), t0=Date.now();
      await SY.remote.fileUpload(path, blob, mime);
      await FS.setPending(id, false).catch(()=>{});
      const cur=att(id); if(cur&&!cur.path){ cur.path=path; cur.modified=new Date().toISOString(); save(); } done++;
      log('info', a.kind==='photo'?'Foto subida':'Audio subido', {size:blob.size, ms:Date.now()-t0}); }
    UQ.retry=0; }
  catch(e){ const off=syncOffline(e), ms=Math.min(300e3, 3000*Math.pow(2, UQ.retry++)); log(off?'warn':'error','Subida de adjunto falló: '+(e&&(e.message||e.error)||e), {reintento:Math.round(ms/1000)+' s'}); attFlushSoon(ms); }
  finally{ UQ.running=false; if(done){ const id=detailTaskId(); if(id&&hasAtt(id)) attPaint(id); } } }
// Under the group: where the files are while they have not reached the account
function attNote(taskId){ const all=attOf(taskId); if(!all.length) return ''; const dev=UI.wide?'este dispositivo':'este iPhone';
  if(!SY) return 'Los adjuntos se guardan solo en '+dev+'.';
  const n=all.filter(a=>!a.path).length; if(!n) return '';
  if(!SY.user) return 'Se guardan en '+dev+' y se subirán a tu cuenta al iniciar sesión.';
  if(!navigator.onLine) return 'Se subirán a tu cuenta al volver la conexión.';
  return 'Subiendo '+n+(n===1?' adjunto':' adjuntos')+' a tu cuenta.'; }

/* ---------- The Adjuntos group of the detail ---------- */
function attGroupHTML(x){ const ps=attOf(x.id,'photo'), as=attOf(x.id,'audio'), note=attNote(x.id);
  const tile=a=>{ const u=fuGet(a.id,'t'), st=AST.get(a.id), miss=!u&&(st==='err'||st==='none'||st==='off');
    return '<button class="att-ph'+(u?'':miss?' miss':' wait')+'" data-att="'+esc(a.id)+'" aria-label="Foto'+(miss?' no disponible':'')+'"><img data-att-img="'+esc(a.id)+'" alt="" draggable="false"'+(u?' src="'+u+'"':'')+'></button>'; };
  const row=a=>'<div class="vn att-au" data-au="'+esc(a.id)+'"><div class="vn-bg r"><button data-aact="del">Eliminar</button></div><div class="vn-c au-c">'+
    '<button class="au-play" data-aact="play" aria-label="Reproducir">'+I.play+I.pause+'</button><div class="au-body"><div class="au-top"><span class="au-name">Nota de voz, '+esc(fmtDateTime(a.created).toLowerCase())+'</span>'+
    '<span class="au-t"><span class="au-cur">0:00</span> de '+fmtDur(a.durationMs)+'</span></div><div class="au-bar" data-aact="seek"><i></i></div></div></div></div>';
  return '<div class="group-title">Adjuntos</div><div class="group att-group">'+(ps.length?'<div class="att-grid">'+ps.map(tile).join('')+'</div>':'')+as.map(row).join('')+
    '<button class="cell link" data-act="attPhoto"'+(UI.wide?' title="También puedes arrastrar fotos aquí"':'')+'>'+I.photo+'<span class="lbl">Añadir foto</span></button>'+
    '<button class="cell link" data-act="attAudio">'+I.wave+'<span class="lbl">Nota de voz</span></button></div>'+(note?'<div class="footnote att-note">'+note+'</div>':''); }
// After a draw: the thumbnails not in memory yet come from the device (or are downloaded); the audio rows show the one playing
function attHydrate(root){ if(!root) return;
  root.querySelectorAll('img[data-att-img]:not([src])').forEach(img=>{ const a=att(img.dataset.attImg); if(!a) return;
    attThumbUrl(a).then(u=>{ if(!img.isConnected) return; const b=img.closest('.att-ph');
      attOwn(()=>{ if(u){ img.src=u; if(b) b.classList.remove('wait','miss'); } else if(b){ b.classList.remove('wait'); b.classList.add('miss'); b.setAttribute('aria-label','Foto no disponible'); } }); }); });
  if(AP.id&&root.querySelector('[data-au="'+CSS.escape(AP.id)+'"]')) apPaint(); }

/* ---------- Playing a recording (one at a time) ---------- */
const AP={el:null, id:null, raf:0, durMs:0, loading:false};
function apEl(){ if(!AP.el){ const a=AP.el=new Audio(); a.preload='auto';
    a.addEventListener('ended', ()=>{ a.currentTime=0; apPaint(); }); a.addEventListener('pause', apPaint); a.addEventListener('playing', apPaint);
    a.addEventListener('error', ()=>{ if(!AP.id||!a.getAttribute('src')) return; log('error','No se pudo reproducir el audio', {code:a.error&&a.error.code, mime:(att(AP.id)||{}).mime}); toast('No se pudo reproducir la nota de voz'); apStop(); }); }
  return AP.el; }
async function apToggle(id){ const a=att(id); if(!a) return; const el=apEl();
  if(AP.id===id&&el.getAttribute('src')){ if(el.paused) el.play().catch(apFail); else el.pause(); return; }
  if(AP.id===id&&AP.loading) return;
  apStop(); AP.id=id; AP.durMs=a.durationMs||0;
  let u=fuGet(id,'f');
  if(!u){ AP.loading=true; apPaint(); const b=await attFile(a); AP.loading=false; if(AP.id!==id) return;
    if(!b){ AP.id=null; apPaint(); toast(navigator.onLine?'Nota de voz no disponible':'Sin conexión'); return; } u=fuMake(id,'f',b); }
  el.src=u; el.play().catch(apFail); apPaint(); }
// iOS may refuse to play once the download has taken the tap's moment: the recording stays loaded and the next tap plays it
function apFail(e){ if(e&&e.name==='NotAllowedError'){ apPaint(); return; } if(e&&e.name==='AbortError') return; log('warn','Reproducción: '+(e&&e.message||e)); }
function apStop(){ const el=AP.el; AP.id=null; AP.loading=false; if(el){ el.pause(); el.removeAttribute('src'); try{ el.load(); }catch(e){} } apPaint(); }
function apSeek(id, frac){ const el=AP.el; if(!el||AP.id!==id) return; const d=isFinite(el.duration)&&el.duration>0?el.duration:AP.durMs/1000; if(d){ el.currentTime=Math.max(0, Math.min(d-0.05, frac*d)); apTick(); } }
function apPaint(){ cancelAnimationFrame(AP.raf); const el=AP.el, on=!!(el&&AP.id&&!el.paused);
  attOwn(()=>document.querySelectorAll('.vn[data-au]').forEach(r=>{ const me=r.dataset.au===AP.id; r.classList.toggle('playing', me&&on); r.classList.toggle('loading', me&&AP.loading);
    const b=r.querySelector('.au-play'); if(b) b.setAttribute('aria-label', me&&on?'Pausar':'Reproducir');
    if(!me){ const i=r.querySelector('.au-bar i'), c=r.querySelector('.au-cur'); if(i&&i.style.transform) i.style.transform=''; if(c&&c.textContent!=='0:00') c.textContent='0:00'; } }));
  apTick(); }
function apTick(){ const el=AP.el; if(!el||!AP.id) return; const d=isFinite(el.duration)&&el.duration>0?el.duration*1000:AP.durMs, t=el.currentTime*1000, p=d?Math.min(1, t/d):0;
  attOwn(()=>document.querySelectorAll('.vn[data-au="'+CSS.escape(AP.id)+'"]').forEach(r=>{ const i=r.querySelector('.au-bar i'); if(i) i.style.transform='scaleX('+p.toFixed(4)+')'; const c=r.querySelector('.au-cur'), s=fmtDur(t); if(c&&c.textContent!==s) c.textContent=s; }));
  if(!el.paused) AP.raf=requestAnimationFrame(apTick); }
// The desktop: a click on a recording (not on its play button or bar) offers what can be done with it, at the pointer
function audioMenu(id, ev){ const el=document.querySelector('.vn[data-au="'+CSS.escape(id)+'"]'); const at=ev&&ev.clientX!=null&&UI.wide?{x:ev.clientX, y:ev.clientY}:{anchor:el};
  popMenu(Object.assign(at, {groups:[[{label:AP.id===id&&AP.el&&!AP.el.paused?'Pausar':'Reproducir', icon:MI.play, fn:()=>apToggle(id)}],[{label:'Eliminar nota de voz', icon:MI.trash, red:true, fn:()=>deleteAttachment(id)}]]})); }
function photoMenu(id, ev){ const a=att(id); if(!a) return; const at=ev&&ev.clientX!=null?{x:ev.clientX, y:ev.clientY}:{anchor:document.querySelector('.att-ph[data-att="'+CSS.escape(id)+'"]')};
  popMenu(Object.assign(at, {groups:[[{label:'Abrir', icon:MI.eye, fn:()=>openViewer(a.taskId, id)}],[{label:'Eliminar foto', icon:MI.trash, red:true, fn:()=>deleteAttachment(id)}]]})); }

/* ---------- Recording ---------- */
// Decision 29.2: m4a (AAC) where the browser records it, which every device plays; WebM with Opus otherwise
function recMime(){ const MR=window.MediaRecorder; if(!MR||!MR.isTypeSupported) return '';
  const list=['audio/mp4;codecs=mp4a.40.2','audio/mp4','audio/aac','audio/webm;codecs=opus','audio/webm']; // m4a (AAC) first on every browser that records it, so an iPhone always plays what the computer recorded
  return list.find(t=>{ try{ return MR.isTypeSupported(t); }catch(e){ return false; } })||''; }
const playerHTML = () => '<div class="au-c"><button class="au-play" data-x="play" aria-label="Reproducir">'+I.play+I.pause+'</button><div class="au-body"><div class="au-top"><span class="au-name">Grabación</span><span class="au-t"><span class="au-cur">0:00</span> de <span class="au-dur">0:00</span></span></div><div class="au-bar" data-x="seek"><i></i></div></div></div>';
// The sheet: elapsed time, a big button that records and stops, then the recording to listen to before Guardar. Up to REC_MAX_MS, then it
// stops by itself. Closing it in any way stops the recording and lets the microphone go; one not saved asks first (decision 28b)
function recordSheet(taskId){ if(!task(taskId)) return;
  const can=!!(navigator.mediaDevices&&navigator.mediaDevices.getUserMedia&&window.MediaRecorder);
  const R={state:'idle', rec:null, stream:null, chunks:[], blob:null, mime:'', t0:0, ms:0, timer:0, url:null, gen:0, saveAfter:false, pa:null, raf:0, auto:false};
  const maxMin=Math.round(REC_MAX_MS/6e4);
  openSheet(sheadHTML('Nota de voz','Descartar','Guardar')+'<div class="recw"><div class="rec-time">0:00</div><button class="recbtn" data-x="rec" aria-label="Grabar"'+(can?'':' disabled')+'><span class="c"></span><span class="s"></span></button>'+
    '<div class="hint rec-hint">'+(can?'Toca para grabar. Hasta '+maxMin+(maxMin===1?' minuto.':' minutos.'):'Este navegador no puede grabar notas de voz.')+'</div><div class="rec-prev" hidden>'+playerHTML()+'</div></div>', s=>{
    const ok=$('.hbtn.ok',s), btn=$('.recbtn',s), time=$('.rec-time',s), hint=$('.rec-hint',s), prev=$('.rec-prev',s);
    ok.disabled=true;
    const say=(t, warn)=>{ hint.textContent=t; hint.classList.toggle('warn', !!warn); };
    const tick=()=>{ const ms=R.state==='rec'?Date.now()-R.t0:R.ms; time.textContent=fmtDur(Math.min(ms, REC_MAX_MS), true); if(R.state==='rec'&&ms>=REC_MAX_MS) stop(true); };
    const release=()=>{ if(R.stream){ R.stream.getTracks().forEach(t=>{ try{ t.stop(); }catch(e){} }); R.stream=null; } };
    const unplay=()=>{ cancelAnimationFrame(R.raf); if(R.pa){ R.pa.pause(); R.pa.removeAttribute('src'); try{ R.pa.load(); }catch(e){} R.pa=null; } prev.classList.remove('playing'); if(R.url){ URL.revokeObjectURL(R.url); R.url=null; } };
    const ptick=()=>{ const a=R.pa; if(!a) return; const d=isFinite(a.duration)&&a.duration>0?a.duration*1000:R.ms, t=a.currentTime*1000; $('.au-bar i',prev).style.transform='scaleX('+(d?Math.min(1,t/d):0).toFixed(4)+')'; $('.au-cur',prev).textContent=fmtDur(t); if(!a.paused) R.raf=requestAnimationFrame(ptick); };
    const finish=()=>{ release(); clearInterval(R.timer); const type=baseMime(R.mime||(R.chunks[0]&&R.chunks[0].type))||'audio/mp4';
      R.blob=R.chunks.length?new Blob(R.chunks, {type}):null; R.chunks=[]; R.rec=null; btn.classList.remove('on'); btn.setAttribute('aria-label','Grabar de nuevo'); btn.disabled=false;
      if(!R.blob||!R.blob.size){ R.state='idle'; R.blob=null; say('No se grabó nada. Toca para intentarlo de nuevo.', true); log('warn','Grabación vacía'); return; }
      R.state='done'; tick(); log('info','Audio grabado', {ms:R.ms, size:R.blob.size, mime:type});
      if(R.saveAfter){ saveRec(); return; }
      ok.disabled=false; say(R.auto?'Grabación detenida al llegar a '+maxMin+(maxMin===1?' minuto.':' minutos.')+' Escúchala y guárdala.':'Escucha la grabación y guárdala, o toca para grabar de nuevo.');
      R.url=URL.createObjectURL(R.blob); $('.au-dur',prev).textContent=fmtDur(R.ms); $('.au-cur',prev).textContent='0:00'; $('.au-bar i',prev).style.transform=''; prev.hidden=false; };
    const stop=auto=>{ if(R.state!=='rec') return; R.ms=Math.min(REC_MAX_MS, Date.now()-R.t0); clearInterval(R.timer); R.state='stopping'; R.auto=!!auto; btn.disabled=true; haptic(10);
      if(auto) log('info','Grabación detenida por el límite');
      try{ R.rec.stop(); }catch(e){ finish(); } };
    const start=()=>{ const my=++R.gen; unplay(); prev.hidden=true; R.blob=null; R.auto=false; ok.disabled=true; btn.disabled=true; say('Pidiendo acceso al micrófono');
      navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true, noiseSuppression:true, autoGainControl:true}}).then(stream=>{
        if(my!==R.gen||!btn.isConnected){ stream.getTracks().forEach(t=>t.stop()); return; } // the sheet went meanwhile
        R.stream=stream; R.mime=recMime(); const o={audioBitsPerSecond:AUDIO_BPS}; if(R.mime) o.mimeType=R.mime;
        let rec; try{ rec=new MediaRecorder(stream, o); }catch(e){ rec=new MediaRecorder(stream); }
        R.rec=rec; R.chunks=[]; if(!R.mime) R.mime=rec.mimeType||'';
        rec.ondataavailable=e=>{ if(my===R.gen&&e.data&&e.data.size) R.chunks.push(e.data); };
        rec.onstop=()=>{ if(my===R.gen) finish(); };
        rec.onerror=e=>{ if(my!==R.gen) return; log('error','Grabación: '+(e&&e.error&&(e.error.name+' '+e.error.message)||'error')); if(R.state==='rec') stop(false); };
        rec.start(1000); R.t0=Date.now(); R.ms=0; R.state='rec'; R.timer=setInterval(tick, 250); tick();
        btn.disabled=false; btn.classList.add('on'); btn.setAttribute('aria-label','Parar'); say('Grabando. Toca para parar.'); ok.disabled=false; haptic(10);
        log('info','Grabación iniciada', {mime:rec.mimeType||R.mime||'?'}); })
      .catch(e=>{ if(my!==R.gen) return; btn.disabled=false; const denied=e&&(e.name==='NotAllowedError'||e.name==='SecurityError');
        say(denied?(UI.wide?'Sin permiso para el micrófono. Permítelo en los ajustes del navegador.':'Sin permiso para el micrófono. Actívalo en la app Ajustes del iPhone.'):'No se pudo usar el micrófono.', true);
        log(denied?'warn':'error','Micrófono: '+(e&&(e.name+' '+e.message)||e)); }); };
    const cleanup=()=>{ R.gen++; clearInterval(R.timer); if(R.rec&&R.rec.state!=='inactive'){ R.rec.onstop=null; try{ R.rec.stop(); }catch(e){} } R.rec=null; release(); unplay(); R.state='idle'; };
    const saveRec=()=>{ const blob=R.blob, ms=Math.round(R.ms); if(!blob) return; R.blob=null; R.state='saved';
      const id=uid(), now=new Date().toISOString(), mime=baseMime(blob.type)||'audio/mp4';
      FS.putFile(id, blob, {pending:true}).then(()=>{ if(!task(taskId)) return; fuMake(id,'f',blob);
          DB.attachments.push({id, taskId, kind:'audio', path:null, mime, size:blob.size, width:null, height:null, durationMs:ms, created:now, modified:now});
          updTask(taskId,{}); haptic(8); log('info','Audio añadido', {ms, size:blob.size, mime}); attFlushSoon(); attPaint(taskId); })
        .catch(e=>{ log('error','Audio no guardado: '+(e&&e.message||e)); toast('No se pudo guardar la nota de voz en el dispositivo'); });
      closeSheet(); };
    stopRec=cleanup; // closeSheet stops a recording and lets the microphone go, however the sheet closes
    sheetGuard=()=>R.state==='rec'||R.state==='stopping'||R.state==='done'?{title:'La grabación no se ha guardado.', label:'Descartar grabación', discard:cleanup}:null;
    s.onclick=e=>{ const b=e.target.closest('[data-x]'); if(!b||ghostSheet(e)) return; const x=b.dataset.x;
      if(x==='rec'){ if(R.state==='rec') stop(false); else if(R.state==='idle'||R.state==='done') start(); return; }
      if(x==='play'){ if(!R.url) return; if(!R.pa){ R.pa=new Audio(R.url); R.pa.addEventListener('ended', ()=>{ prev.classList.remove('playing'); R.pa.currentTime=0; ptick(); }); R.pa.addEventListener('pause', ()=>prev.classList.remove('playing')); }
        if(R.pa.paused){ R.pa.play().then(()=>{ prev.classList.add('playing'); ptick(); }).catch(err=>log('warn','Escucha de la grabación: '+(err&&err.message||err))); } else R.pa.pause(); return; }
      if(x==='seek'){ if(!R.pa) return; const r=b.getBoundingClientRect(), d=isFinite(R.pa.duration)&&R.pa.duration>0?R.pa.duration:R.ms/1000; R.pa.currentTime=Math.max(0, Math.min(d, (e.clientX-r.left)/r.width*d)); ptick(); return; }
      if(x==='cancel'){ requestCloseSheet(); return; }
      if(x==='ok'){ if(R.state==='rec'){ R.saveAfter=true; stop(false); return; } if(R.state==='done') saveRec(); } }; }); }

/* ---------- The photo viewer ---------- */
// Full screen, black. A finger slides between the photos of the task (the next one follows it), two fingers zoom (only transform),
// a double tap zooms in and out, a drag down closes it. Compartir sends the file through the share sheet where the browser can,
// otherwise it downloads it; Eliminar has its Deshacer. The desktop adds arrows, the keys and the trackpad pinch
let VW=null; const VW_GAP=20;
function openViewer(taskId, id){ const list=attOf(taskId,'photo'), i=list.findIndex(a=>a.id===id); if(i<0) return;
  closeMenu(true); if(VW) closeViewer(true); if(openVn) closeVn(openVn);
  const share=canShareFiles(), el=document.createElement('div'); el.className='viewer'; el.setAttribute('role','dialog'); el.setAttribute('aria-modal','true'); el.setAttribute('aria-label','Fotos');
  el.innerHTML='<div class="vw-bg"></div><div class="vw-stage"><div class="vw-track"></div></div><div class="vw-bar"><button class="vw-b" data-vw="close" aria-label="Cerrar" title="Cerrar (Esc)">'+XICON+'</button><span class="vw-n"></span><span class="vw-r">'+
    '<button class="vw-b" data-vw="share" aria-label="'+(share?'Compartir':'Descargar')+'" title="'+(share?'Compartir':'Descargar')+'">'+(share?I.share:I.download)+'</button><button class="vw-b" data-vw="del" aria-label="Eliminar" title="Eliminar">'+I.trash+'</button></span></div>'+
    (UI.wide?'<button class="vw-nav l" data-vw="prev" aria-label="Anterior">'+I.chevL+'</button><button class="vw-nav r" data-vw="next" aria-label="Siguiente">'+I.chevR+'</button>':'');
  document.body.appendChild(el);
  VW={el, taskId, ids:list.map(a=>a.id), i, s:1, tx:0, ty:0, blobs:new Map(), ptr:new Map(), g:null, lastTap:0, from:document.activeElement, share};
  vwLayout(); el.getBoundingClientRect(); el.classList.add('on'); log('info','Visor de fotos abierto', {n:list.length});
  el.addEventListener('click', vwClick); el.addEventListener('pointerdown', vwDown); el.addEventListener('pointermove', vwMove); el.addEventListener('pointerup', vwUp); el.addEventListener('pointercancel', vwUp);
  el.addEventListener('wheel', vwWheel, {passive:false}); // a double tap or double click zooms through vwUp, on the iPhone and the desktop alike
  el.addEventListener('contextmenu', e=>e.preventDefault()); window.addEventListener('resize', vwLayout);
  const c=$('[data-vw=close]', el); if(c&&UI.wide) c.focus({preventScroll:true}); }
function closeViewer(now){ const v=VW; if(!v) return; VW=null; window.removeEventListener('resize', vwLayout); v.el.classList.remove('on'); v.el.style.pointerEvents='none';
  setTimeout(()=>{ v.el.remove(); fuGCSoon(); }, now||RM.matches?0:320); if(v.from&&v.from.isConnected&&UI.wide) try{ v.from.focus({preventScroll:true}); }catch(e){} }
const vwW = () => innerWidth, vwH = () => innerHeight;
// The photo in its slide: as large as the screen allows, centred
function vwFit(a){ const W=vwW(), H=vwH(), w=a.width||W, h=a.height||H, s=Math.min(W/w, H/h); return {w:w*s, h:h*s}; }
function vwLayout(){ const v=VW; if(!v) return; const tr=$('.vw-track', v.el), W=vwW();
  const want=new Set([v.i-1, v.i, v.i+1].filter(k=>k>=0&&k<v.ids.length).map(k=>v.ids[k]));
  [...tr.children].forEach(sl=>{ if(!want.has(sl.dataset.vwId)) sl.remove(); });
  v.ids.forEach((id,k)=>{ if(!want.has(id)) return; let sl=tr.querySelector('[data-vw-id="'+CSS.escape(id)+'"]'); const a=att(id); if(!a) return;
    if(!sl){ sl=document.createElement('div'); sl.className='vw-slide'; sl.dataset.vwId=id; sl.innerHTML='<img class="vw-img" alt="" draggable="false">'; tr.appendChild(sl); vwLoad(id, sl); }
    const f=vwFit(a), im=$('.vw-img', sl); sl.style.transform='translate3d('+(k*(W+VW_GAP))+'px,0,0)';
    Object.assign(im.style, {width:f.w+'px', height:f.h+'px', left:(W-f.w)/2+'px', top:(vwH()-f.h)/2+'px'}); });
  vwTrack(0, false); vwApply(false);
  $('.vw-n', v.el).textContent=(v.i+1)+' de '+v.ids.length;
  const pv=$('[data-vw=prev]', v.el), nx=$('[data-vw=next]', v.el); if(pv) pv.disabled=v.i===0; if(nx) nx.disabled=v.i>=v.ids.length-1; }
function vwLoad(id, sl){ const a=att(id), im=$('.vw-img', sl); if(!a) return; const t=fuGet(id,'t'), f=fuGet(id,'f'); if(f){ im.src=f; return; } if(t) im.src=t; sl.classList.add('wait');
  attFile(a).then(b=>{ if(!sl.isConnected) return; sl.classList.remove('wait'); if(!b){ if(!t) toast(navigator.onLine?'Foto no disponible':'Sin conexión'); return; } if(VW) VW.blobs.set(id, b); im.src=fuMake(id,'f',b); }); }
const vwCur = () => VW&&VW.el.querySelector('.vw-slide[data-vw-id="'+CSS.escape(VW.ids[VW.i])+'"] .vw-img');
function vwTrack(dx, anim){ const tr=$('.vw-track', VW.el); tr.classList.toggle('anim', !!anim); tr.style.transform='translate3d('+(-VW.i*(vwW()+VW_GAP)+dx)+'px,0,0)'; }
function vwApply(anim){ const im=vwCur(); if(!im) return; im.classList.toggle('anim', !!anim); im.style.transform=VW.s===1&&!VW.tx&&!VW.ty?'':'translate3d('+VW.tx+'px,'+VW.ty+'px,0) scale('+VW.s+')'; }
// Within the edges: a zoomed photo never leaves a gap it does not need
function vwClamp(){ const v=VW, a=att(v.ids[v.i]); if(!a) return; const f=vwFit(a), mx=Math.max(0,(f.w*v.s-vwW())/2), my=Math.max(0,(f.h*v.s-vwH())/2);
  v.tx=Math.max(-mx, Math.min(mx, v.tx)); v.ty=Math.max(-my, Math.min(my, v.ty)); }
function vwGo(k){ const v=VW; if(!v) return; k=Math.max(0, Math.min(v.ids.length-1, k)); const moved=k!==v.i; v.i=k; v.s=1; v.tx=v.ty=0;
  vwLayout(); vwTrack(0, !RM.matches); if(moved) haptic(4); }
function vwZoomAt(x, y){ const v=VW; if(!v) return; if(v.s>1){ v.s=1; v.tx=v.ty=0; } else { const s=2.5, cx=x-vwW()/2, cy=y-vwH()/2; v.tx=cx-s*(cx-v.tx)/v.s; v.ty=cy-s*(cy-v.ty)/v.s; v.s=s; vwClamp(); } vwApply(!RM.matches); }
function vwWheel(e){ const v=VW; if(!v) return; e.preventDefault(); if(!e.ctrlKey&&v.s===1){ if(Math.abs(e.deltaX)>30&&Math.abs(e.deltaX)>Math.abs(e.deltaY)&&!v.wheelT){ v.wheelT=setTimeout(()=>{ if(VW) VW.wheelT=0; }, 400); vwGo(v.i+(e.deltaX>0?1:-1)); } return; }
  if(!e.ctrlKey){ v.tx-=e.deltaX; v.ty-=e.deltaY; vwClamp(); vwApply(false); return; } // two fingers on a trackpad: pan a zoomed photo
  const s=Math.max(1, Math.min(5, v.s*Math.exp(-e.deltaY/100))), cx=e.clientX-vwW()/2, cy=e.clientY-vwH()/2; v.tx=cx-s*(cx-v.tx)/v.s; v.ty=cy-s*(cy-v.ty)/v.s; v.s=s; if(s===1) v.tx=v.ty=0; vwClamp(); vwApply(false); }
function vwDown(e){ const v=VW; if(!v||e.target.closest('.vw-bar,.vw-nav')||(e.pointerType==='mouse'&&e.button!==0)) return; v.ptr.set(e.pointerId, {x:e.clientX, y:e.clientY});
  try{ v.el.setPointerCapture(e.pointerId); }catch(err){}
  const pts=[...v.ptr.values()];
  if(pts.length===2){ const [p,q]=pts, d=Math.hypot(p.x-q.x, p.y-q.y)||1, mx=(p.x+q.x)/2-vwW()/2, my=(p.y+q.y)/2-vwH()/2;
    if(v.g&&v.g.mode==='swipe') vwTrack(0, true); v.g={mode:'pinch', d0:d, s0:v.s, qx:(mx-v.tx)/v.s, qy:(my-v.ty)/v.s}; return; }
  if(pts.length>2) return;
  v.g={mode:'pending', x0:e.clientX, y0:e.clientY, t0:e.timeStamp, tx0:v.tx, ty0:v.ty, lx:e.clientX, ly:e.clientY, lt:e.timeStamp, vx:0, vy:0, moved:false}; }
function vwMove(e){ const v=VW; if(!v||!v.ptr.has(e.pointerId)) return; v.ptr.set(e.pointerId, {x:e.clientX, y:e.clientY}); const g=v.g; if(!g) return;
  if(g.mode==='pinch'){ const pts=[...v.ptr.values()]; if(pts.length<2) return; const [p,q]=pts, d=Math.hypot(p.x-q.x, p.y-q.y)||1, mx=(p.x+q.x)/2-vwW()/2, my=(p.y+q.y)/2-vwH()/2;
    let s=g.s0*d/g.d0; if(s<1) s=1-(1-s)*0.4; s=Math.min(6, s); v.s=s; v.tx=mx-s*g.qx; v.ty=my-s*g.qy; vwApply(false); return; }
  const dx=e.clientX-g.x0, dy=e.clientY-g.y0, dt=e.timeStamp-g.lt;
  if(dt>0){ g.vx=0.6*(e.clientX-g.lx)/dt+0.4*g.vx; g.vy=0.6*(e.clientY-g.ly)/dt+0.4*g.vy; g.lx=e.clientX; g.ly=e.clientY; g.lt=e.timeStamp; }
  if(g.mode==='pending'){ if(Math.hypot(dx,dy)<8) return; g.moved=true; g.mode=v.s>1?'pan':Math.abs(dx)>=Math.abs(dy)?'swipe':(dy>0?'down':'pan'); }
  if(g.mode==='pan'){ if(v.s<=1) return; v.tx=g.tx0+dx; v.ty=g.ty0+dy; vwApply(false); return; }
  if(g.mode==='swipe'){ const edge=(v.i===0&&dx>0)||(v.i===v.ids.length-1&&dx<0); vwTrack(edge?dx*0.35:dx, false); return; }
  if(g.mode==='down'){ const y=Math.max(0, dy), p=Math.min(1, y/(vwH()*0.6)), tr=$('.vw-stage', v.el); tr.style.transition='none'; tr.style.transform='translate3d('+dx*0.5+'px,'+y+'px,0) scale('+(1-p*0.25).toFixed(4)+')'; $('.vw-bg', v.el).style.opacity=String(1-p); } }
function vwUp(e){ const v=VW; if(!v) return; v.ptr.delete(e.pointerId); const g=v.g; if(!g) return;
  if(g.mode==='pinch'){ if(v.ptr.size) { const [p]=[...v.ptr.values()]; v.g={mode:'pan', x0:p.x, y0:p.y, tx0:v.tx, ty0:v.ty, lx:p.x, ly:p.y, lt:e.timeStamp, vx:0, vy:0, moved:true}; return; }
    if(v.s<1.05){ v.s=1; v.tx=v.ty=0; } vwClamp(); vwApply(!RM.matches); v.g=null; return; }
  if(v.ptr.size) return; v.g=null; const dx=e.clientX-g.x0, dy=e.clientY-g.y0, fresh=e.timeStamp-g.lt<80;
  if(g.mode==='pending'){ if(e.type==='pointercancel') return; // a tap: a second one soon after zooms, a single one shows or hides the bars
    if(e.timeStamp-v.lastTap<300){ v.lastTap=0; clearTimeout(v.tapT); vwZoomAt(e.clientX, e.clientY); return; }
    v.lastTap=e.timeStamp; if(e.pointerType!=='mouse'){ clearTimeout(v.tapT); v.tapT=setTimeout(()=>{ if(VW===v) v.el.classList.toggle('bare'); }, 300); } return; }
  if(g.mode==='pan'){ vwClamp(); vwApply(!RM.matches); return; }
  if(g.mode==='swipe'){ const vx=fresh?g.vx:0, W=vwW(); let k=v.i; if(dx<-W/3||vx<-FLICK) k++; else if(dx>W/3||vx>FLICK) k--; k=Math.max(0, Math.min(v.ids.length-1, k));
    if(k!==v.i) vwGo(k); else vwTrack(0, !RM.matches); return; }
  if(g.mode==='down'){ const vy=fresh?g.vy:0, st=$('.vw-stage', v.el); if(dy>140||(vy>FLICK&&dy>40)){ closeViewer(); return; }
    st.style.transition=''; st.style.transform=''; $('.vw-bg', v.el).style.opacity=''; } }
function vwClick(e){ const b=e.target.closest('[data-vw]'); if(!b||!VW) return; const k=b.dataset.vw, id=VW.ids[VW.i];
  if(k==='close') closeViewer(); else if(k==='prev') vwGo(VW.i-1); else if(k==='next') vwGo(VW.i+1); else if(k==='share') vwShare(id); else if(k==='del') vwDelete(); }
// Inside the tap: the file is already in memory (the share sheet of iOS opens only from the tap itself)
function vwShare(id){ const a=att(id), b=VW&&VW.blobs.get(id); if(!a) return; if(!b){ toast('La foto aún se está cargando'); return; }
  const name='foto-'+localDay(a.created)+'.'+(ATT_EXT[baseMime(a.mime)]||'jpg'), file=new File([b], name, {type:baseMime(a.mime)||'image/jpeg'});
  if(VW.share&&navigator.share){ navigator.share({files:[file]}).then(()=>log('info','Foto compartida')).catch(e=>{ if(!e||e.name!=='AbortError') log('warn','Compartir foto: '+(e&&e.message||e)); }); return; }
  const l=document.createElement('a'); l.href=fuMake(id,'f',b); l.download=name; document.body.appendChild(l); l.click(); l.remove(); toast('Foto descargada'); log('info','Foto descargada a un archivo'); }
function vwDelete(){ const v=VW; if(!v) return; const id=v.ids[v.i]; v.ids.splice(v.i,1); v.blobs.delete(id); deleteAttachment(id);
  if(!v.ids.length){ closeViewer(); return; } if(v.i>=v.ids.length) v.i=v.ids.length-1; v.s=1; v.tx=v.ty=0; vwLayout(); }
// While it is open the keys are its own: arrows, Esc, Supr; nothing reaches the lists behind
window.addEventListener('keydown', e=>{ if(!VW) return; const k=e.key;
  if(k==='Tab') return; e.stopPropagation();
  if(k==='Escape'){ e.preventDefault(); if(VW.s>1){ VW.s=1; VW.tx=VW.ty=0; vwApply(!RM.matches); } else closeViewer(); }
  else if(k==='ArrowRight'){ e.preventDefault(); vwGo(VW.i+1); } else if(k==='ArrowLeft'){ e.preventDefault(); vwGo(VW.i-1); }
  else if(k==='Delete'||k==='Backspace'){ e.preventDefault(); vwDelete(); }
  else if(k==='+'||k==='='||k==='-'){ e.preventDefault(); if((k==='-')===(VW.s>1)) vwZoomAt(vwW()/2, vwH()/2); } }, true);

/* ---------- Desktop: photos dragged from the computer onto the inspector ---------- */
const dragFiles = e => !!(e.dataTransfer&&[...(e.dataTransfer.types||[])].includes('Files'));
function attBindDrop(d){
  const lit=pn=>attOwn(()=>d.querySelectorAll('.pane.filedrop').forEach(p=>{ if(p!==pn) p.classList.remove('filedrop'); }));
  d.addEventListener('dragover', e=>{ if(!dragFiles(e)) return; const pn=e.target.closest('.pane[data-task]'); e.preventDefault(); e.dataTransfer.dropEffect=pn?'copy':'none'; lit(pn); if(pn&&!pn.classList.contains('filedrop')) attOwn(()=>pn.classList.add('filedrop')); });
  d.addEventListener('dragleave', e=>{ if(!dragFiles(e)) return; const pn=e.target.closest('.pane.filedrop'); if(pn&&!pn.contains(e.relatedTarget)) attOwn(()=>pn.classList.remove('filedrop')); });
  d.addEventListener('drop', e=>{ if(!dragFiles(e)) return; e.preventDefault(); const pn=e.target.closest('.pane[data-task]'); lit(null); if(!pn||!task(pn.dataset.task)) return;
    const fs=[...(e.dataTransfer.files||[])]; log('info','Fotos soltadas en el panel', {n:fs.length}); if(fs.length) addPhotos(pn.dataset.task, fs); }); }
// A file let go anywhere else never replaces the app with the picture
window.addEventListener('dragover', e=>{ if(dragFiles(e)&&!e.defaultPrevented){ e.preventDefault(); e.dataTransfer.dropEffect='none'; } });
window.addEventListener('drop', e=>{ if(dragFiles(e)) e.preventDefault(); });
