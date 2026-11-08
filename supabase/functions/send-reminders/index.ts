// Tareas, block 9: reminders as Web Push notifications (Supabase Edge Function "send-reminders").
//
// Deploy: in the Supabase dashboard, Edge Functions, create a function named exactly send-reminders, paste this file and turn
// "Verify JWT" off. It needs no secrets: SUPABASE_URL and the service role key are injected by Supabase. Optional VAPID_SUBJECT
// (a mailto: or https: address for the push services); without it the project URL is used.
//
// Calls (all harmless for anyone: each one only does what is already due, or acts on the caller's own devices):
//   GET  ?publicKey            {publicKey}: the VAPID public key the app subscribes with. The first call ever creates the key pair
//                              and keeps it in push_keys (only the service role reads that table), so nobody handles a private key.
//   POST (pg_cron, every minute, body {})
//                              Sends the reminders that are due: pending or waiting tasks (decision 41), not deleted, reminder <= now and not sent yet.
//                              Each one is marked as sent first (one statement, so two runs never send it twice), then goes to every
//                              device of its owner. Devices whose push service answers 404 or 410 no longer exist and are deleted.
//                              Then the purge of attachments (decision 29.4, 0003_attachments.sql): files of attachments deleted more than
//                              24 hours ago, or whose task was, are removed from the private bucket "attachments" and their rows marked
//                              purged (and deleted, when only the task was). A few per run; a file already gone counts as removed, so a
//                              run cut halfway is simply repeated by the next one. Before 0003 runs it does nothing.
//                              Then the team (decision 63, 0013_team.sql): the notification of each task sent with «Avisar a…» to its
//                              recipient («Enric te ha enviado una tarea», nothing of the task) and of each suggestion or incident to the
//                              admin («Nueva sugerencia», «Nueva incidencia»), each once; and the removal of the members whose access was
//                              removed more than 30 days ago (their files through the Storage API first, then their rows, membership and
//                              account). A reminder of an account without access is marked and not sent. Before 0013 runs none of it does.
//                              Then (decision 78, 0014_notice_follow.sql) «Víctor ha completado una tarea que le enviaste» to the sender of a
//                              task its recipient has completed, once per completion; nothing of the task. Before 0014 runs it does nothing.
//   POST {test:true, id?} with the user's JWT in Authorization
//                              A test notification to the caller's own devices (only the one with that id when given).
//
// No dependencies: the database through PostgREST with fetch, the payload encryption (RFC 8291, aes128gcm) and the VAPID
// signature (RFC 8292, ES256) with WebCrypto.

const FUNCTION_NAME = 'send-reminders';
// A reminder found more than this late (the job stopped for a while, or a device sent it after its time) is marked without notifying
const LATE_LIMIT_MS = 60 * 60 * 1000;
// How long a push service keeps a message for a device that is off (seconds)
const PUSH_TTL = 4 * 3600;
// Decision 29.4: the Storage bucket of the attachments, and how many files one run removes at most
const ATT_BUCKET = 'attachments';
const PURGE_LIMIT = 50;

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

type Conf = { url: string; key: string; anon: string; subject: string };
type Sub = { id: string; owner_id: string; endpoint: string; p256dh: string; auth: string };
type Vapid = { publicKey: string; key: CryptoKey };
type Message = { title: string; body: string; tag: string; badge?: number; data: Record<string, unknown> };

// deno-lint-ignore no-explicit-any
const G = globalThis as any;
const env = (k: string): string => (G.Deno ? G.Deno.env.get(k) : (G.process?.env?.[k])) || '';
const firstKey = (json: string): string => {
  try { const o = JSON.parse(json || '{}'); return o.default || Object.values(o)[0] || ''; } catch { return ''; }
};

function conf(): Conf {
  const url = env('SUPABASE_URL').replace(/\/+$/, '');
  // The legacy service role JWT, or the new secret key of projects that use the new API keys
  const key = env('SUPABASE_SERVICE_ROLE_KEY') || firstKey(env('SUPABASE_SECRET_KEYS'));
  const anon = env('SUPABASE_ANON_KEY') || firstKey(env('SUPABASE_PUBLISHABLE_KEYS')) || key;
  if (!url || !key) throw new Error('SUPABASE_URL or the service role key is missing');
  return { url, key, anon, subject: env('VAPID_SUBJECT') || url };
}

/* ---------- Bytes ---------- */
const te = new TextEncoder();
const b64u = (b: Uint8Array): string => {
  let s = ''; for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const unb64u = (s: string): Uint8Array => {
  const t = atob(String(s).replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (String(s).length % 4)) % 4));
  const out = new Uint8Array(t.length); for (let i = 0; i < t.length; i++) out[i] = t.charCodeAt(i); return out;
};
const concat = (...parts: (Uint8Array | number[])[]): Uint8Array => {
  const n = parts.reduce((a, p) => a + p.length, 0), out = new Uint8Array(n); let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; } return out;
};
// WebCrypto takes the bytes as they are (a cast that also type-checks on the older TypeScript of some runtimes)
const B = (u: Uint8Array): BufferSource => u as unknown as BufferSource;
async function hmac(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey('raw', B(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, B(data)));
}

/* ---------- Web Push encryption (RFC 8291 with RFC 8188 aes128gcm, one record) ---------- */
export async function encryptPayload(payload: Uint8Array, p256dh: string, authSecret: string): Promise<Uint8Array> {
  const ua = unb64u(p256dh), secret = unb64u(authSecret);
  if (ua.length !== 65 || secret.length !== 16) throw new Error('invalid subscription keys');
  const uaKey = await crypto.subtle.importKey('raw', B(ua), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const eph = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']) as CryptoKeyPair;
  const asPub = new Uint8Array(await crypto.subtle.exportKey('raw', eph.publicKey));
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, eph.privateKey, 256));
  // IKM = HKDF(auth secret, ECDH secret, "WebPush: info" || 0 || ua_public || as_public, 32)
  const ikm = await hmac(await hmac(secret, shared), concat(te.encode('WebPush: info\0'), ua, asPub, [1]));
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, concat(te.encode('Content-Encoding: aes128gcm\0'), [1]))).slice(0, 16);
  const nonce = (await hmac(prk, concat(te.encode('Content-Encoding: nonce\0'), [1]))).slice(0, 12);
  const key = await crypto.subtle.importKey('raw', B(cek), 'AES-GCM', false, ['encrypt']);
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: B(nonce) }, key, B(concat(payload, [2])))); // 2: last record
  const header = new Uint8Array(16 + 4 + 1 + 65);
  header.set(salt, 0); new DataView(header.buffer).setUint32(16, 4096); header[20] = 65; header.set(asPub, 21);
  return concat(header, sealed);
}

/* ---------- VAPID (RFC 8292): an ES256 JWT for the push service of each endpoint ---------- */
export async function vapidHeader(endpoint: string, v: Vapid, subject: string, now = Date.now()): Promise<string> {
  const enc = (o: unknown) => b64u(te.encode(JSON.stringify(o)));
  const unsigned = enc({ typ: 'JWT', alg: 'ES256' }) + '.' + enc({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: subject });
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, v.key, B(te.encode(unsigned)))); // r || s
  return 'vapid t=' + unsigned + '.' + b64u(sig) + ', k=' + v.publicKey;
}

async function sendPush(sub: Sub, msg: Message, v: Vapid, c: Conf): Promise<{ id: string; status: number; error?: string }> {
  try {
    const body = await encryptPayload(te.encode(JSON.stringify(msg)), sub.p256dh, sub.auth);
    const r = await fetch(sub.endpoint, {
      method: 'POST', body: B(body),
      headers: { Authorization: await vapidHeader(sub.endpoint, v, c.subject), 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: String(PUSH_TTL), Urgency: 'high' },
    });
    const text = r.ok ? '' : (await r.text()).slice(0, 200);
    return r.ok ? { id: sub.id, status: r.status } : { id: sub.id, status: r.status, error: text };
  } catch (e) {
    return { id: sub.id, status: 0, error: String((e as Error)?.message || e) };
  }
}

/* ---------- Database (PostgREST, service role: skips row level security) ---------- */
async function rest(c: Conf, method: string, path: string, body?: unknown, prefer?: string) {
  const h: Record<string, string> = { apikey: c.key, 'Content-Type': 'application/json' };
  if (c.key.startsWith('eyJ')) h.Authorization = 'Bearer ' + c.key; // the legacy JWT also goes as the bearer; a new secret key only as apikey
  if (prefer) h.Prefer = prefer;
  const r = await fetch(c.url + '/rest/v1/' + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  if (!r.ok) throw new Error(method + ' ' + path.split('?')[0] + ': ' + r.status + ' ' + text.slice(0, 300));
  return { data: text ? JSON.parse(text) : null, headers: r.headers };
}
const qs = (o: Record<string, string>) => Object.entries(o).map(([k, v]) => k + '=' + encodeURIComponent(v)).join('&');
const inList = (ids: string[]) => 'in.(' + ids.map(i => '"' + String(i).replace(/"/g, '') + '"').join(',') + ')';

// The key pair, created on the first call. Kept for the life of this instance
let cached: Vapid | null = null;
async function vapid(c: Conf): Promise<Vapid> {
  if (cached) return cached;
  const read = async () => (await rest(c, 'GET', 'push_keys?id=eq.1&select=public_key,private_jwk,function_url')).data as { public_key: string; private_jwk: JsonWebKey; function_url: string | null }[];
  let rows = await read();
  if (!rows.length) {
    const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']) as CryptoKeyPair;
    const pub = b64u(new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey)));
    const jwk = await crypto.subtle.exportKey('jwk', kp.privateKey);
    // Two first calls at once: the row stored first wins and both use it
    await rest(c, 'POST', 'push_keys?on_conflict=id', [{ id: 1, public_key: pub, private_jwk: jwk }], 'resolution=ignore-duplicates,return=minimal');
    rows = await read();
    console.log(JSON.stringify({ event: 'vapid-created' }));
  }
  const row = rows[0];
  // The cron job reads the function's address here (0002_push.sql), so the owner never types the project ref
  const self = c.url + '/functions/v1/' + FUNCTION_NAME;
  if (row.function_url !== self) {
    await rest(c, 'PATCH', 'push_keys?id=eq.1', { function_url: self }, 'return=minimal');
    console.log(JSON.stringify({ event: 'function-url-stored', url: self }));
  }
  const key = await crypto.subtle.importKey('jwk', row.private_jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  cached = { publicKey: row.public_key, key };
  return cached;
}

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
// Decision 63a: an encrypted value ('e1:...') goes whole, never clipped: the device opens it with its key (sw.js), and a cut one would not open.
// Title and project share the push's room (about 4 KB in all): up to 2400 characters for an encrypted title and 600 for an encrypted project
// name; past either, the notification says only «Recordatorio», with no project
const E_TITLE = 2400, E_PROJECT = 600;
function pushText(title: string, project: string) {
  const et = title.startsWith('e1:'), ep = project.startsWith('e1:');
  if ((et && title.length > E_TITLE) || (ep && project.length > E_PROJECT)) return { title: 'Recordatorio', body: '' };
  return { title: et ? title : clip(title, 180), body: ep ? project : clip(project, 80) };
}

// Sends to the given devices; the ones that no longer exist are deleted. Returns the counts
async function deliver(c: Conf, v: Vapid, jobs: { sub: Sub; msg: Message }[]) {
  const res = await Promise.all(jobs.map(j => sendPush(j.sub, j.msg, v, c)));
  const gone = [...new Set(res.filter(r => r.status === 404 || r.status === 410).map(r => r.id))];
  if (gone.length) await rest(c, 'DELETE', 'push_subscriptions?id=' + encodeURIComponent(inList(gone)), undefined, 'return=minimal');
  const failed = res.filter(r => r.status !== 404 && r.status !== 410 && !(r.status >= 200 && r.status < 300));
  failed.slice(0, 5).forEach(f => console.error(JSON.stringify({ event: 'push-failed', status: f.status, error: f.error })));
  return { sent: res.filter(r => r.status >= 200 && r.status < 300).length, failed: failed.length, gone: gone.length };
}

/* ---------- Cron: the reminders that are due ---------- */
async function sendDue(c: Conf) {
  const now = new Date(), nowIso = now.toISOString();
  // Claim: mark as sent in one statement. A run at the same time finds them already marked
  const claimed = (await rest(c, 'PATCH', 'tasks?' + qs({ reminder: 'lte.' + nowIso, reminder_sent: 'is.null', deleted: 'is.null', status: 'in.(pending,waiting)', select: 'id,owner_id,title,project_id,date,reminder' }), // decision 41: Por confirmar notifies too
    { reminder_sent: nowIso }, 'return=representation')).data as { id: string; owner_id: string; title: string | null; project_id: string | null; date: string | null; reminder: string }[];
  if (!claimed.length) return { due: 0, late: 0, sent: 0, failed: 0, gone: 0 };
  let fresh = claimed.filter(t => now.getTime() - Date.parse(t.reminder) <= LATE_LIMIT_MS);
  const late = claimed.length - fresh.length;
  if (!fresh.length) return { due: claimed.length, late, sent: 0, failed: 0, gone: 0 };
  // Decision 63b: an account whose access was removed gets no reminder (already marked above, so it never goes)
  const allowed = await teamAllowed(c, [...new Set(fresh.map(t => t.owner_id))]);
  if (allowed) fresh = fresh.filter(t => allowed.has(t.owner_id));
  if (!fresh.length) return { due: claimed.length, late, sent: 0, failed: 0, gone: 0 };
  const owners = [...new Set(fresh.map(t => t.owner_id))];
  const subs = (await rest(c, 'GET', 'push_subscriptions?' + qs({ owner_id: inList(owners), deleted: 'is.null', select: 'id,owner_id,endpoint,p256dh,auth' }))).data as Sub[];
  if (!subs.length) return { due: claimed.length, late, sent: 0, failed: 0, gone: 0, devices: 0 };
  const pids = [...new Set(fresh.map(t => t.project_id).filter(Boolean))] as string[];
  const names = new Map<string, string>();
  if (pids.length) ((await rest(c, 'GET', 'projects?' + qs({ id: inList(pids), deleted: 'is.null', select: 'id,name' }))).data as { id: string; name: string }[]).forEach(p => names.set(p.id, p.name));
  // The icon's badge: the owner's pending tasks up to the task's day, and the waiting ones whose review day it is or has passed (decision 41):
  // the app's own count, with that day as today. A waiting task without a date has no date, so the date filter leaves it out
  const badges = new Map<string, number>();
  for (const t of fresh) {
    const k = t.owner_id + '|' + t.date; if (!t.date || badges.has(k)) continue;
    const r = await rest(c, 'GET', 'tasks?' + qs({ owner_id: 'eq.' + t.owner_id, status: 'in.(pending,waiting)', deleted: 'is.null', date: 'lte.' + t.date, select: 'id', limit: '1' }), undefined, 'count=exact');
    const n = Number((r.headers.get('content-range') || '').split('/')[1]); if (Number.isFinite(n)) badges.set(k, n);
  }
  const jobs: { sub: Sub; msg: Message }[] = [];
  for (const t of fresh) {
    const msg: Message = {
      ...pushText(t.title || 'Recordatorio', (t.project_id && names.get(t.project_id)) || 'Recordatorio'),
      tag: t.id,
      data: { taskId: t.id, projectId: t.project_id || null, url: './?task=' + encodeURIComponent(t.id) }, // projectId: which project the name belongs to
    };
    const b = badges.get(t.owner_id + '|' + t.date); if (b !== undefined) msg.badge = b;
    subs.filter(s => s.owner_id === t.owner_id).forEach(sub => jobs.push({ sub, msg }));
  }
  const out = await deliver(c, await vapid(c), jobs);
  return { due: claimed.length, late, devices: subs.length, ...out };
}

/* ---------- Purge: files of attachments deleted more than 24 hours ago (decision 29.4) ---------- */
// The Storage API with the service role: one request removes up to PURGE_LIMIT objects. Objects that no longer exist are simply not in the answer
async function removeObjects(c: Conf, paths: string[]) {
  const h: Record<string, string> = { apikey: c.key, 'Content-Type': 'application/json' };
  if (c.key.startsWith('eyJ')) h.Authorization = 'Bearer ' + c.key;
  const r = await fetch(c.url + '/storage/v1/object/' + ATT_BUCKET, { method: 'DELETE', headers: h, body: JSON.stringify({ prefixes: paths }) });
  const text = await r.text();
  if (!r.ok) throw new Error('storage delete: ' + r.status + ' ' + text.slice(0, 300));
  try { const j = JSON.parse(text || '[]'); return Array.isArray(j) ? j.length : 0; } catch { return 0; }
}
let purgeMissing = false; // 0003_attachments.sql not run yet: said once per instance
async function purgeAttachments(c: Conf): Promise<Record<string, number>> {
  let rows: { id: string; path: string | null; deleted: string | null }[];
  try {
    rows = (await rest(c, 'POST', 'rpc/tareas_attachments_to_purge', { p_limit: PURGE_LIMIT })).data || [];
  } catch (e) {
    const m = String((e as Error)?.message || e);
    if (/ 404 |PGRST202|Could not find the function|does not exist/i.test(m)) {
      if (!purgeMissing) { purgeMissing = true; console.log(JSON.stringify({ event: 'purge-skipped', reason: '0003_attachments.sql not run' })); }
      return { purged: 0 };
    }
    throw e;
  }
  purgeMissing = false;
  if (!rows.length) return { purged: 0 };
  const paths = [...new Set(rows.map(r => r.path).filter(Boolean))] as string[];
  const removed = paths.length ? await removeObjects(c, paths) : 0;
  // Only after Storage answered: a failure leaves the rows as they were, for the next run
  const nowIso = new Date().toISOString();
  const ids = (list: typeof rows) => encodeURIComponent(inList(list.map(r => r.id)));
  const own = rows.filter(r => r.deleted), byTask = rows.filter(r => !r.deleted);
  if (own.length) await rest(c, 'PATCH', 'attachments?id=' + ids(own), { purged: nowIso }, 'return=minimal');
  // Deleted with their task only: marked deleted too, so every device lets them go (modified stays: the newest-wins rule accepts it)
  if (byTask.length) await rest(c, 'PATCH', 'attachments?id=' + ids(byTask), { purged: nowIso, deleted: nowIso }, 'return=minimal');
  return { purged: rows.length, files: paths.length, removed };
}

/* ---------- The team (decision 63, 0013_team.sql) ---------- */
// A request that failed because 0013 is not there yet (the table or the function is missing): said once per instance, then quiet
const absent = (e: unknown) => / 404 |PGRST20[25]|42P01|42883|Could not find|does not exist/i.test(String((e as Error)?.message || e));
let teamMissing = false;
function teamSkip(e: unknown, what: string): boolean {
  if (!absent(e)) return false;
  if (!teamMissing) { teamMissing = true; console.log(JSON.stringify({ event: 'team-skipped', reason: '0013_team.sql not run', what })); }
  return true;
}
// The accounts of the list with access, or null without 0013 (everyone, as before)
async function teamAllowed(c: Conf, ids: string[]): Promise<Set<string> | null> {
  try {
    const rows = (await rest(c, 'POST', 'rpc/tareas_team_allowed', { p_ids: ids })).data as (string | Record<string, string>)[] | null;
    return new Set((rows || []).map(r => typeof r === 'string' ? r : Object.values(r)[0]));
  } catch (e) {
    // Never holds the reminders back: without the answer they all go, as before 0013
    if (!teamSkip(e, 'allowed')) console.error(JSON.stringify({ event: 'team-allowed-failed', error: String((e as Error)?.message || e) }));
    return null;
  }
}
// A member's first name for «Enric te ha enviado una tarea»: the first word of the directory's name, else the start of the email
const firstName = (m?: { name?: string | null; email?: string | null }) =>
  (String(m?.name || '').trim().split(/\s+/)[0] || String(m?.email || '').split('@')[0] || 'Alguien');
// Claims what has not been pushed yet (one statement, as the reminders: a run at the same time finds them marked) and notifies.
// Older than an hour (the job stopped for a while): marked without notifying
async function sendTeam(c: Conf): Promise<Record<string, number>> {
  const nowIso = new Date().toISOString(), fresh = (iso: string) => Date.now() - Date.parse(iso) <= LATE_LIMIT_MS;
  let notices: { id: string; sender_id: string; recipient_id: string; created: string }[] = [];
  let feedback: { id: string; recipient_id: string; kind: string; created: string }[] = [];
  try {
    notices = (await rest(c, 'PATCH', 'team_notices?' + qs({ pushed: 'is.null', select: 'id,sender_id,recipient_id,created' }), { pushed: nowIso }, 'return=representation')).data || [];
    feedback = (await rest(c, 'PATCH', 'team_feedback?' + qs({ pushed: 'is.null', select: 'id,recipient_id,kind,created' }), { pushed: nowIso }, 'return=representation')).data || [];
  } catch (e) {
    if (teamSkip(e, 'notices')) return { notices: 0, feedback: 0 };
    throw e;
  }
  const ns = notices.filter(n => fresh(n.created)), fs = feedback.filter(f => fresh(f.created));
  if (!ns.length && !fs.length) return { notices: notices.length, feedback: feedback.length };
  const to = [...new Set([...ns.map(n => n.recipient_id), ...fs.map(f => f.recipient_id)])];
  const subs = (await rest(c, 'GET', 'push_subscriptions?' + qs({ owner_id: inList(to), deleted: 'is.null', select: 'id,owner_id,endpoint,p256dh,auth' }))).data as Sub[];
  const senders = [...new Set(ns.map(n => n.sender_id))];
  const names = new Map<string, { name: string | null; email: string | null }>();
  if (senders.length) ((await rest(c, 'GET', 'team_members?' + qs({ user_id: inList(senders), select: 'user_id,name,email' }))).data as { user_id: string; name: string | null; email: string | null }[]).forEach(m => names.set(m.user_id, m));
  const jobs: { sub: Sub; msg: Message }[] = [];
  for (const n of ns) {
    const msg: Message = { title: 'Tareas', body: firstName(names.get(n.sender_id)) + ' te ha enviado una tarea', tag: 'notice-' + n.id, data: { open: 'received', url: './?open=received' } };
    subs.filter(s => s.owner_id === n.recipient_id).forEach(sub => jobs.push({ sub, msg }));
  }
  for (const f of fs) {
    const msg: Message = { title: 'Tareas', body: f.kind === 'incidencia' ? 'Nueva incidencia' : 'Nueva sugerencia', tag: 'feedback-' + f.id, data: { open: 'feedback', url: './?open=feedback' } };
    subs.filter(s => s.owner_id === f.recipient_id).forEach(sub => jobs.push({ sub, msg }));
  }
  const out = jobs.length ? await deliver(c, await vapid(c), jobs) : { sent: 0, failed: 0, gone: 0 };
  return { notices: notices.length, feedback: feedback.length, teamSent: out.sent, teamFailed: out.failed };
}
/* Decision 78 (0014_notice_follow.sql): a task sent with «Avisar a…» that its recipient has completed. Claimed in one statement (done set,
   done_pushed empty), as the others; its sender's devices get «Víctor ha completado una tarea que le enviaste», nothing of the task, and a
   tap opens the sender's own task (task_ref). Completed more than an hour before: marked without notifying. A sender without access gets
   nothing. Before 0014 (no such columns): nothing, said once per instance */
let followMissing = false;
async function sendFollow(c: Conf): Promise<Record<string, number>> {
  const nowIso = new Date().toISOString();
  let rows: { id: string; sender_id: string; recipient_id: string; task_ref: string; done: string }[] = [];
  try {
    rows = (await rest(c, 'PATCH', 'team_notices?' + qs({ done: 'not.is.null', done_pushed: 'is.null', select: 'id,sender_id,recipient_id,task_ref,done' }), { done_pushed: nowIso }, 'return=representation')).data || [];
  } catch (e) {
    if (!absent(e)) throw e;
    if (!followMissing) { followMissing = true; console.log(JSON.stringify({ event: 'follow-skipped', reason: '0014_notice_follow.sql not run' })); }
    return { completed: 0 };
  }
  let fresh = rows.filter(n => Date.now() - Date.parse(n.done) <= LATE_LIMIT_MS);
  if (!fresh.length) return { completed: rows.length };
  const allowed = await teamAllowed(c, [...new Set(fresh.map(n => n.sender_id))]);
  if (allowed) fresh = fresh.filter(n => allowed.has(n.sender_id));
  if (!fresh.length) return { completed: rows.length };
  const subs = (await rest(c, 'GET', 'push_subscriptions?' + qs({ owner_id: inList([...new Set(fresh.map(n => n.sender_id))]), deleted: 'is.null', select: 'id,owner_id,endpoint,p256dh,auth' }))).data as Sub[];
  const names = new Map<string, { name: string | null; email: string | null }>();
  ((await rest(c, 'GET', 'team_members?' + qs({ user_id: inList([...new Set(fresh.map(n => n.recipient_id))]), select: 'user_id,name,email' }))).data as { user_id: string; name: string | null; email: string | null }[]).forEach(m => names.set(m.user_id, m));
  const jobs: { sub: Sub; msg: Message }[] = [];
  for (const n of fresh) {
    const ref = String(n.task_ref || '');
    const msg: Message = { title: 'Tareas', body: firstName(names.get(n.recipient_id)) + ' ha completado una tarea que le enviaste', tag: 'done-' + n.id,
      data: { taskId: ref, follow: true, url: './?task=' + encodeURIComponent(ref) } };
    subs.filter(s => s.owner_id === n.sender_id).forEach(sub => jobs.push({ sub, msg }));
  }
  const out = jobs.length ? await deliver(c, await vapid(c), jobs) : { sent: 0, failed: 0, gone: 0 };
  return { completed: rows.length, completedSent: out.sent, completedFailed: out.failed };
}
// The removal 30 days after the access was removed (decision 71.4): the files first (a few hundred per run), then the rows, once none is left.
// tareas_team_remove checks again the 30 days and never touches an admin or an active member
async function removeMembers(c: Conf): Promise<Record<string, number>> {
  let due: { member_id: string; user_id: string | null; files: string[] | null }[];
  try {
    due = (await rest(c, 'POST', 'rpc/tareas_team_to_remove', {})).data || [];
  } catch (e) {
    if (teamSkip(e, 'removal')) return { removedMembers: 0 };
    throw e;
  }
  let removedMembers = 0, removedFiles = 0;
  for (const m of due) {
    const files = (m.files || []).filter(Boolean);
    if (files.length) { removedFiles += await removeObjects(c, files); continue; } // the rows go on a later run, once the folder is empty
    const res = (await rest(c, 'POST', 'rpc/tareas_team_remove', { p_member: m.member_id })).data;
    if (res && !res.skipped) { removedMembers++; console.log(JSON.stringify({ event: 'member-removed', member: m.member_id, rows: res })); }
  }
  return { removedMembers, removedFiles };
}

/* ---------- Test: the caller's own devices ---------- */
async function sendTest(c: Conf, req: Request, body: { id?: string }) {
  const jwt = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!jwt) return json({ error: 'sign-in required' }, 401);
  const u = await fetch(c.url + '/auth/v1/user', { headers: { apikey: c.anon, Authorization: 'Bearer ' + jwt } });
  const user = u.ok ? await u.json() : null;
  if (!user || !user.id) return json({ error: 'invalid session' }, 401);
  const q: Record<string, string> = { owner_id: 'eq.' + user.id, deleted: 'is.null', select: 'id,owner_id,endpoint,p256dh,auth' };
  if (body.id) q.id = 'eq.' + String(body.id);
  const subs = (await rest(c, 'GET', 'push_subscriptions?' + qs(q))).data as Sub[];
  const msg: Message = { title: 'Tareas', body: 'Notificación de prueba', tag: 'tareas-test', data: { test: true, url: './' } };
  const out = subs.length ? await deliver(c, await vapid(c), subs.map(sub => ({ sub, msg }))) : { sent: 0, failed: 0, gone: 0 };
  return json({ devices: subs.length, ...out });
}

const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

export async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  const t0 = Date.now();
  try {
    const c = conf();
    if (req.method === 'GET') {
      if (new URL(req.url).searchParams.has('publicKey')) return json({ publicKey: (await vapid(c)).publicKey });
      return json({ ok: true });
    }
    if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);
    let body: { test?: boolean; id?: string } = {};
    try { body = await req.json(); } catch { body = {}; }
    if (body && body.test === true) {
      const r = await sendTest(c, req, body);
      console.log(JSON.stringify({ event: 'test', status: r.status, ms: Date.now() - t0 }));
      return r;
    }
    const out = await sendDue(c);
    if (out.due) console.log(JSON.stringify({ event: 'reminders', ...out, ms: Date.now() - t0 }));
    // The reminders go first; a purge that fails is logged and tried again on the next run, and never holds them back
    let purge: Record<string, number> = { purged: 0 };
    try { purge = await purgeAttachments(c); } catch (e) { console.error(JSON.stringify({ event: 'purge-failed', error: String((e as Error)?.message || e) })); purge = { purged: 0, purgeFailed: 1 }; }
    if (purge.purged) console.log(JSON.stringify({ event: 'purge', ...purge, ms: Date.now() - t0 }));
    // The team: its notifications, then the removals. Each failure is logged and tried again on the next run
    let team: Record<string, number> = {};
    try { team = await sendTeam(c); } catch (e) { console.error(JSON.stringify({ event: 'team-failed', error: String((e as Error)?.message || e) })); team = { teamFailed: 1 }; }
    // Decision 78: what a recipient has completed (only with the team there: before 0013 nothing of it exists)
    if (!teamMissing) { try { Object.assign(team, await sendFollow(c)); } catch (e) { console.error(JSON.stringify({ event: 'follow-failed', error: String((e as Error)?.message || e) })); team.followFailed = 1; } }
    if (team.notices || team.feedback || team.completed) console.log(JSON.stringify({ event: 'team', ...team, ms: Date.now() - t0 }));
    let removal: Record<string, number> = {};
    try { removal = await removeMembers(c); } catch (e) { console.error(JSON.stringify({ event: 'removal-failed', error: String((e as Error)?.message || e) })); removal = { removalFailed: 1 }; }
    return json({ ...out, ...purge, ...team, ...removal });
  } catch (e) {
    console.error(JSON.stringify({ event: 'error', error: String((e as Error)?.message || e) }));
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
}

// Tests import the module with TAREAS_NO_SERVE set and serve handler themselves
if (G.Deno && !G.TAREAS_NO_SERVE) G.Deno.serve(handler);
