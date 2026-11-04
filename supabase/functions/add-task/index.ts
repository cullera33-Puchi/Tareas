// Tareas: Siri and the iOS Shortcut (Supabase Edge Function "add-task", 0010_inbox.sql).
//
// Deploy: in the Supabase dashboard, Edge Functions, create a function named exactly add-task, paste this file and turn "Verify JWT" off
// (the Shortcut carries no session: it proves who it is with the personal key made in Ajustes, Atajo de iOS). It needs no secrets:
// SUPABASE_URL and the service role key are injected by Supabase. No imports: the database through PostgREST with fetch, the hash with WebCrypto.
//
// Call (what the Shortcut sends):
//   POST <project>/functions/v1/add-task
//   Authorization: Bearer <key>        (or the header x-tareas-key: <key>)
//   Body, any of:  application/json {"text": "...", "url": "...", "source": "siri" | "share"}
//                  text/plain       the text itself
//                  a form (multipart or urlencoded) with the fields text, url and source
// The key's sha-256 (hex) is looked up in shortcut_keys; a row not revoked gives the owner, and the text goes into the owner's inbox.
// The app makes the task when it syncs, with the spoken words for date, time, project, priority and time estimate.
//
// Answers, in plain text so the Shortcut can show it or Siri can read it aloud:
//   200 «Añadida: <text>»
//   400 no text (a link alone is taken as the text), a text over 500 characters or a link over 2000
//   401 no key, an unknown key or a revoked one
//   405 not a POST
//   429 more than 60 phrases in the last hour for that owner
//   500 anything else (logged)

const MAX_TEXT = 500;
const MAX_URL = 2000;
const MAX_BODY = 20000; // bytes read at most: a longer body is refused before parsing
const RATE_PER_HOUR = 60;

type Conf = { url: string; key: string };
type In = { text: string; url: string | null; source: 'siri' | 'share' };

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
  if (!url || !key) throw new Error('SUPABASE_URL or the service role key is missing');
  return { url, key };
}

const text = (body: string, status = 200) => new Response(body, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });

export async function sha256Hex(s: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
  return Array.from(d, b => b.toString(16).padStart(2, '0')).join('');
}

/* ---------- Database (PostgREST, service role: skips row level security) ---------- */
async function rest(c: Conf, method: string, path: string, body?: unknown, prefer?: string) {
  const h: Record<string, string> = { apikey: c.key, 'Content-Type': 'application/json' };
  if (c.key.startsWith('eyJ')) h.Authorization = 'Bearer ' + c.key; // the legacy JWT also goes as the bearer; a new secret key only as apikey
  if (prefer) h.Prefer = prefer;
  const r = await fetch(c.url + '/rest/v1/' + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  const t = await r.text();
  if (!r.ok) throw new Error(method + ' ' + path.split('?')[0] + ': ' + r.status + ' ' + t.slice(0, 300));
  return { data: t ? JSON.parse(t) : null, headers: r.headers };
}
const qs = (o: Record<string, string>) => Object.entries(o).map(([k, v]) => k + '=' + encodeURIComponent(v)).join('&');

/* ---------- The request ---------- */
// A value the Shortcut sent: a string, a number, or a list (the share sheet may give several items: the first one counts)
const str = (v: unknown): string => {
  if (Array.isArray(v)) v = v.find(x => typeof x === 'string' || typeof x === 'number');
  if (typeof v === 'string') return v; if (typeof v === 'number') return String(v);
  if (v && typeof v === 'object' && typeof (v as { url?: unknown }).url === 'string') return (v as { url: string }).url;
  return '';
};
function keyOf(req: Request): string {
  const a = (req.headers.get('authorization') || '').trim(), m = a.match(/^Bearer\s+(.+)$/i);
  return (m ? m[1] : (req.headers.get('x-tareas-key') || '')).trim();
}
async function readBody(req: Request): Promise<Record<string, unknown> | null> {
  const type = (req.headers.get('content-type') || '').toLowerCase();
  if (type.includes('multipart/form-data') || type.includes('application/x-www-form-urlencoded')) {
    const len = Number(req.headers.get('content-length') || 0); if (len > MAX_BODY) return null;
    const f = await req.formData(); const o: Record<string, unknown> = {};
    for (const k of ['text', 'url', 'source']) { const v = f.get(k); if (typeof v === 'string') o[k] = v; }
    return o;
  }
  const raw = await req.text(); if (new TextEncoder().encode(raw).length > MAX_BODY) return null;
  // JSON when it reads as a JSON object (Shortcuts sometimes sends JSON without the header); otherwise the body is the text itself
  const t = raw.trim();
  if (type.includes('json') || t.startsWith('{')) {
    try { const j = JSON.parse(t); if (j && typeof j === 'object' && !Array.isArray(j)) return j; if (typeof j === 'string') return { text: j }; } catch { if (type.includes('json')) return {}; }
  }
  return { text: raw };
}
export function validate(o: Record<string, unknown> | null): In | string {
  if (!o) return 'El texto es demasiado largo. Máximo ' + MAX_TEXT + ' caracteres';
  const u = str(o.url).trim();
  if (u.length > MAX_URL) return 'El enlace es demasiado largo. Máximo ' + MAX_URL + ' caracteres';
  // A link shared alone (Safari's share sheet gives no text): the link is the text too
  const t = str(o.text).replace(/\s+/g, ' ').trim() || (u.length <= MAX_TEXT ? u : '');
  if (!t) return 'Falta el texto de la tarea';
  if (t.length > MAX_TEXT) return 'El texto es demasiado largo. Máximo ' + MAX_TEXT + ' caracteres';
  const s = str(o.source).trim().toLowerCase();
  return { text: t, url: u || null, source: s === 'share' || (!s && u) ? 'share' : 'siri' };
}

export async function handler(req: Request): Promise<Response> {
  const t0 = Date.now();
  if (req.method !== 'POST') return text('Usa POST para añadir una tarea', 405);
  try {
    const c = conf();
    const key = keyOf(req);
    if (!key) return text('Falta la clave del atajo. Créala en Tareas, Ajustes, Atajo de iOS', 401);
    const hash = await sha256Hex(key);
    const rows = (await rest(c, 'GET', 'shortcut_keys?' + qs({ key_hash: 'eq.' + hash, select: 'owner_id,revoked', limit: '1' }))).data as { owner_id: string; revoked: string | null }[];
    if (!rows.length) { console.log(JSON.stringify({ event: 'bad-key' })); return text('Clave no válida. Crea una nueva en Tareas, Ajustes, Atajo de iOS', 401); }
    if (rows[0].revoked) { console.log(JSON.stringify({ event: 'revoked-key' })); return text('Clave revocada. Crea una nueva en Tareas, Ajustes, Atajo de iOS', 401); }
    const owner = rows[0].owner_id;
    const v = validate(await readBody(req));
    if (typeof v === 'string') return text(v, 400);
    // At most RATE_PER_HOUR phrases an hour per owner: a Shortcut stuck in a loop cannot fill the inbox
    const since = new Date(Date.now() - 3600e3).toISOString();
    const r = await rest(c, 'GET', 'inbox?' + qs({ owner_id: 'eq.' + owner, created: 'gte.' + since, select: 'id', limit: '1' }), undefined, 'count=exact');
    const n = Number((r.headers.get('content-range') || '').split('/')[1]);
    if (Number.isFinite(n) && n >= RATE_PER_HOUR) { console.log(JSON.stringify({ event: 'rate-limited', n })); return text('Demasiadas tareas en una hora. Prueba más tarde', 429); }
    await rest(c, 'POST', 'inbox', [{ owner_id: owner, text: v.text, url: v.url, source: v.source }], 'return=minimal');
    console.log(JSON.stringify({ event: 'added', source: v.source, url: !!v.url, chars: v.text.length, ms: Date.now() - t0 }));
    return text('Añadida: ' + v.text);
  } catch (e) {
    console.error(JSON.stringify({ event: 'error', error: String((e as Error)?.message || e) }));
    return text('No se pudo añadir la tarea. Prueba otra vez', 500);
  }
}

// Tests import the module with TAREAS_NO_SERVE set and serve handler themselves
if (G.Deno && !G.TAREAS_NO_SERVE) G.Deno.serve(handler);
