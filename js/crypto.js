'use strict';
/* Tareas. End-to-end encryption (decision 63a): the primitives, shared by the page and the service worker (sw.js loads this file with
   importScripts). No DOM, no app globals: only WebCrypto, IndexedDB and plain values, so it runs the same in both places.
   - The account's data key: a random 256-bit AES-GCM key. It never leaves a device in clear: the server keeps it wrapped (AES-KW) by a
     key derived from the encryption password (PBKDF2-SHA256, CRYPTO_ITER rounds, a random 16-byte salt). Changing the password wraps
     the same data key again, so nothing has to be encrypted again.
   - A text value: 'e1:' + base64url(12-byte random IV || ciphertext and tag), AES-GCM with the additional data 'table.column', so a
     value only opens in its own table and column. '' and null are never encrypted. A value without the prefix is plain (from before).
   - A file: the ASCII magic TAREASE1, a 12-byte IV and the ciphertext, with the storage path as additional data. A file without the
     magic is an old plain file and is read as it is.
   - On a device: the data key as a NON-extractable CryptoKey in IndexedDB 'tareas-keys' (other apps share the origin: keep the prefix),
     with its key id (kid, also in the server row) and the account it belongs to. The service worker reads it to show a reminder. */
const CRYPTO_ITER=600000, CRYPTO_KDB='tareas-keys', CRYPTO_PREFIX='e1:', CRYPTO_MAGIC='TAREASE1';
// The encrypted columns of each synced table (server names); everything else stays plain (dates, reminder, priority, status, ids, counts)
const CRYPTO_COLS={ tasks:['title','notes','waiting_for','responsible'], projects:['name'], spaces:['name'], subtasks:['title'],
  project_notes:['title','body'], contacts:['name','email','phone'], voice_notes:['text'] };
const cryptoTE=new TextEncoder(), cryptoTD=new TextDecoder();
const cryptoSubtle = () => { const c=self.crypto; if(!c||!c.subtle) throw new Error('Este navegador no permite cifrar'); return c.subtle; };
function cryptoRandom(n){ const b=new Uint8Array(n); self.crypto.getRandomValues(b); return b; }
function cryptoB64(u){ u=u instanceof Uint8Array?u:new Uint8Array(u); let s=''; for(let i=0;i<u.length;i+=0x8000) s+=String.fromCharCode.apply(null, u.subarray(i, i+0x8000));
  return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,''); }
function cryptoUnb64(s){ s=String(s||'').replace(/-/g,'+').replace(/_/g,'/'); while(s.length%4) s+='='; const b=atob(s), u=new Uint8Array(b.length); for(let i=0;i<b.length;i++) u[i]=b.charCodeAt(i); return u; }
const cryptoIsEnc = v => typeof v==='string' && v.startsWith(CRYPTO_PREFIX);
// The additional data of a text value: its table and column (not the row: a device on an older version may copy a value into another row,
// such as a duplicate or the next task of a series, and it must still open there)
const cryptoAad = (table, col) => cryptoTE.encode(table+'.'+col);
// A column that does not open: the layer marks it so the merge keeps this device's value, or shows CRYPTO_PLACEHOLDER and never sends it back
const CRYPTO_UNREAD='\u0000tareas-unreadable', CRYPTO_PLACEHOLDER='(texto no legible)';

/* ---------- Keys ---------- */
// The key that wraps the data key, from the password. salt: base64url
async function cryptoDerive(password, salt, iterations){ const s=cryptoSubtle();
  const base=await s.importKey('raw', cryptoTE.encode(String(password).normalize('NFC')), 'PBKDF2', false, ['deriveKey']);
  return s.deriveKey({name:'PBKDF2', hash:'SHA-256', salt:cryptoUnb64(salt), iterations:iterations||CRYPTO_ITER}, base, {name:'AES-KW', length:256}, false, ['wrapKey','unwrapKey']); }
// A new data key: extractable only so it can be wrapped once; the device keeps the copy unwrapped as non-extractable (cryptoUnwrap)
const cryptoNewKey = () => cryptoSubtle().generateKey({name:'AES-GCM', length:256}, true, ['encrypt','decrypt']);
async function cryptoWrap(dataKey, kek){ return cryptoB64(await cryptoSubtle().wrapKey('raw', dataKey, kek, 'AES-KW')); }
// A wrong password fails here: AES-KW checks its own integrity
async function cryptoUnwrap(wrapped, kek, extractable){ return cryptoSubtle().unwrapKey('raw', cryptoUnb64(wrapped), kek, 'AES-KW', {name:'AES-GCM', length:256}, !!extractable, ['encrypt','decrypt']); }
// Everything the server row needs, from a password and a data key (a new account key, or the same one with a new password)
// (kek: the wrapping key itself, so the caller can unwrap its own copy without deriving twice; it never goes to the server)
async function cryptoSeal(password, dataKey){ const salt=cryptoB64(cryptoRandom(16)), kek=await cryptoDerive(password, salt, CRYPTO_ITER);
  return {salt, iterations:CRYPTO_ITER, wrapped:await cryptoWrap(dataKey, kek), kek}; }
// The data key of a server row {salt, iterations, wrapped}; throws on a wrong password
async function cryptoOpen(password, row, extractable){ const kek=await cryptoDerive(password, row.salt, row.iterations); return cryptoUnwrap(row.wrapped, kek, extractable); }

/* ---------- Values ---------- */
// Always encrypts what it is given (cryptoSealRow decides what needs it)
async function cryptoEnc(key, value, aad){ if(value==null||value==='') return value; const v=String(value);
  const iv=cryptoRandom(12), ct=new Uint8Array(await cryptoSubtle().encrypt({name:'AES-GCM', iv, additionalData:aad}, key, cryptoTE.encode(v)));
  const out=new Uint8Array(12+ct.length); out.set(iv); out.set(ct, 12); return CRYPTO_PREFIX+cryptoB64(out); }
// A plain value comes back as it is; an encrypted one that does not open (another key, another row) throws
async function cryptoDec(key, value, aad){ if(!cryptoIsEnc(value)) return value; const b=cryptoUnb64(value.slice(CRYPTO_PREFIX.length));
  if(b.length<12+16) throw new Error('Valor cifrado incompleto');
  return cryptoTD.decode(await cryptoSubtle().decrypt({name:'AES-GCM', iv:b.subarray(0,12), additionalData:aad}, key, b.subarray(12))); }
/* A row as the server will hold it: every listed column that is not empty encrypted, except a value that already opens with this key and
   its additional data, which goes as it is (never encrypted twice). Returns the same object when nothing changes */
async function cryptoSealRow(key, table, row){ const cols=CRYPTO_COLS[table]; if(!cols||!row) return row; let out=row;
  for(const c of cols){ const v=row[c]; if(!(c in row)||v==null||v==='') continue; const aad=cryptoAad(table, c);
    if(cryptoIsEnc(v)){ try{ await cryptoDec(key, v, aad); continue; }catch(e){} } // 'e1:...' that does not open is someone's text: encrypted
    if(out===row) out=Object.assign({}, row); out[c]=await cryptoEnc(key, v, aad); }
  return out; }
// The server's row opened: each listed column that starts with 'e1:' decrypted. One that does not open is CRYPTO_UNREAD, or throws with strict
async function cryptoDecRow(key, table, row, strict){ const cols=CRYPTO_COLS[table]; if(!cols||!row) return row; let out=row;
  for(const c of cols){ if(!cryptoIsEnc(row[c])) continue; if(out===row) out=Object.assign({}, row);
    try{ out[c]=await cryptoDec(key, row[c], cryptoAad(table, c)); }catch(e){ if(strict) throw e; out[c]=CRYPTO_UNREAD; } }
  return out; }
const cryptoRowUnread = (table, row) => !!(row && CRYPTO_COLS[table] && CRYPTO_COLS[table].some(c=>row[c]===CRYPTO_UNREAD));
const cryptoRowEnc = (table, row) => !!(row && CRYPTO_COLS[table] && CRYPTO_COLS[table].some(c=>cryptoIsEnc(row[c])));

/* ---------- Files ---------- */
const cryptoMagic = cryptoTE.encode(CRYPTO_MAGIC);
function cryptoFileEnc(bytes){ const u=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes); if(u.length<cryptoMagic.length) return false;
  for(let i=0;i<cryptoMagic.length;i++) if(u[i]!==cryptoMagic[i]) return false; return true; }
async function cryptoEncFile(key, bytes, path){ const u=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes); if(cryptoFileEnc(u)) return u;
  const iv=cryptoRandom(12), ct=new Uint8Array(await cryptoSubtle().encrypt({name:'AES-GCM', iv, additionalData:cryptoTE.encode(String(path))}, key, u));
  const out=new Uint8Array(cryptoMagic.length+12+ct.length); out.set(cryptoMagic); out.set(iv, cryptoMagic.length); out.set(ct, cryptoMagic.length+12); return out; }
async function cryptoDecFile(key, bytes, path){ const u=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes); if(!cryptoFileEnc(u)) return u;
  const m=cryptoMagic.length; return new Uint8Array(await cryptoSubtle().decrypt({name:'AES-GCM', iv:u.subarray(m, m+12), additionalData:cryptoTE.encode(String(path))}, key, u.subarray(m+12))); }

/* ---------- The key on this device ---------- */
function cryptoKdb(){ return new Promise((res, rej)=>{ let r; try{ r=indexedDB.open(CRYPTO_KDB, 1); }catch(e){ rej(e); return; }
  r.onupgradeneeded=()=>{ const d=r.result; if(!d.objectStoreNames.contains('keys')) d.createObjectStore('keys', {keyPath:'id'}); };
  r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error||new Error('IndexedDB')); r.onblocked=()=>rej(new Error('IndexedDB bloqueada')); }); }
async function cryptoKdbDo(mode, fn){ const d=await cryptoKdb();
  try{ return await new Promise((res, rej)=>{ const tx=d.transaction('keys', mode), st=tx.objectStore('keys'); let out; const q=fn(st); if(q) q.onsuccess=()=>{ out=q.result; };
    tx.oncomplete=()=>res(out); tx.onerror=()=>rej(tx.error||new Error('IndexedDB')); tx.onabort=()=>rej(tx.error||new Error('IndexedDB')); }); }
  finally{ d.close(); } }
// {key, kid, owner} or null
async function cryptoKeyLoad(){ const r=await cryptoKdbDo('readonly', st=>st.get('data')); return r&&r.key?{key:r.key, kid:r.kid||null, owner:r.owner||null}:null; }
const cryptoKeySave = (key, kid, owner) => cryptoKdbDo('readwrite', st=>st.put({id:'data', key, kid, owner, saved:new Date().toISOString()}));
const cryptoKeyForget = () => cryptoKdbDo('readwrite', st=>st.delete('data'));

/* ---------- A reminder in the service worker ---------- */
// The title (tasks.title) and the project name (projects.name) of a push, opened with the key of this device.
// Without a key, or when a value does not open, nothing secret is shown: «Recordatorio» as the title and no project
async function cryptoPushPayload(d){ d=d||{};
  if(!cryptoIsEnc(d.title)&&!cryptoIsEnc(d.body)) return d;
  let k=null; try{ k=await cryptoKeyLoad(); }catch(e){}
  const open=async(v, table, col)=>{ if(!cryptoIsEnc(v)) return v; if(!k) return null; try{ return await cryptoDec(k.key, v, cryptoAad(table, col)); }catch(e){ return null; } };
  const title=await open(d.title, 'tasks', 'title'), body=await open(d.body, 'projects', 'name');
  return Object.assign({}, d, {title:title==null?'Recordatorio':title, body:body==null?'':body}); }
