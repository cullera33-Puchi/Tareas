/* Service worker: app shell cache and update notice.
   Bump CACHE on every release so installed devices pick up the new version. */
const CACHE = 'tareas-v0.33.1';
// Every file the app loads: a missing one would leave the installed app unable to start offline (index.html lists the scripts in order)
const SHELL = ['./', './index.html', './css/app.css',
  './js/core.js', './js/render.js', './js/events.js', './js/menus.js', './js/sheets.js', './js/attachments.js', './js/steps.js', './js/notes.js', './js/status.js', './js/suggest.js', './js/crypto.js', './js/sync.js', './js/e2e.js', './js/push.js', './js/inbox.js', './js/people.js', './js/lifecycle.js', './js/desktop.js', './js/desktop-calendar.js', './js/desktop-render.js', './js/desktop-add.js', './js/boot.js',
  './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png', './vendor/supabase-js-2.117.3.umd.js'];
// Decision 63a: the encryption primitives, to show the title of a reminder whose text arrives encrypted (cryptoPushPayload)
importScripts('./js/crypto.js');
// Written at deploy time from the repository secrets (block 8). Cached when present; a copy without it (404) still installs and runs local only.
const OPTIONAL = ['./config.js'];

self.addEventListener('install', e => {
  // cache: 'reload' skips the HTTP cache so a stale copy from the host never gets installed.
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(SHELL.map(u => fetch(u, { cache: 'reload' }).then(r => { if (!r.ok) throw new Error(u); return c.put(u, r); }))
    .concat(OPTIONAL.map(u => fetch(u, { cache: 'reload' }).then(r => r.ok ? c.put(u, r) : null).catch(() => null))))));
  // Do not call skipWaiting here: the page offers the update and asks for it.
});

self.addEventListener('activate', e => {
  // Other apps on the same github.io origin share CacheStorage: delete only this app's old caches.
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('tareas-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('message', e => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  // novedades.json (decision 64): network only, never cached, so the notes of a new version are read before installing it.
  // Without respondWith the browser fetches it itself; offline it fails and the page falls back to the usual update notice.
  if (new URL(req.url).pathname.endsWith('/novedades.json')) return;
  // config.js (Supabase URL and public key, written at deploy) goes network first, so corrected keys reach installed
  // phones on the next deploy without a new version; offline, the cached copy is used.
  if (new URL(req.url).pathname.endsWith('/config.js')) {
    e.respondWith(fetch(req, { cache: 'no-store' }).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put('./config.js', copy)); }
      return res;
    }).catch(() => caches.match('./config.js').then(r => r || new Response('window.TAREAS_CONFIG = null;\n', { headers: { 'Content-Type': 'application/javascript' } }))));
    return;
  }
  // Navigations always resolve to the cached shell so the app opens offline.
  // If the shell is missing (for example another app on the origin removed the cache), the network copy refills it.
  if (req.mode === 'navigate') {
    e.respondWith(caches.open(CACHE).then(c => c.match('./index.html').then(r => r || fetch(req).then(res => {
      const p = new URL(req.url).pathname;
      if (res.ok && (p.endsWith('/') || p.endsWith('/index.html'))) {
        const w = c.put('./index.html', res.clone()).catch(() => {});
        try { e.waitUntil(w); } catch (err) {}
      }
      return res;
    }))));
    return;
  }
  // Cache first for the rest of the shell; the cache is refreshed only on install.
  e.respondWith(caches.match(req).then(r => r || fetch(req).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
    return res;
  })));
});

/* Block 9: reminders as notifications. The server (supabase/functions/send-reminders) sends {title, body, tag, badge, data:{taskId, projectId, url}};
   a push is always shown (userVisibleOnly). A tap opens that task: the open app gets a message, a closed one starts with ?task=id. */
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { body: e.data ? e.data.text() : '' }; }
  const data = d.data && typeof d.data === 'object' ? d.data : {};
  const icon = new URL('icons/icon-192.png', self.registration.scope).href;
  // Decision 55: where the browser shows buttons on a notification (desktop browsers; iOS shows none), a reminder offers 10 min and 1 h
  const acts = data.taskId && !data.test && self.Notification && Notification.maxActions > 0 ? { actions: [{ action: 'snooze10', title: '10 min' }, { action: 'snooze60', title: '1 h' }] } : {};
  // Decision 63a: an encrypted title and project name open with the key of this device; without it, «Recordatorio» and nothing secret
  const shown = cryptoPushPayload(d).catch(() => Object.assign({}, d, { title: 'Recordatorio', body: '' })).then(p =>
    self.registration.showNotification(p.title || 'Tareas', Object.assign({ body: p.body || '', icon, badge: icon, tag: d.tag || data.taskId || 'tareas', data, timestamp: Date.now() }, acts)));
  // The icon's count, worked out by the server when it sent the reminder (the app sets it again when it opens)
  const badged = typeof d.badge === 'number' && self.navigator && self.navigator.setAppBadge
    ? (d.badge > 0 ? self.navigator.setAppBadge(d.badge) : self.navigator.clearAppBadge()).catch(() => {}) : Promise.resolve();
  // An open app writes it in its log
  const told = self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    .then(list => list.forEach(c => c.postMessage({ type: 'push', taskId: data.taskId || null, test: !!data.test })));
  e.waitUntil(Promise.all([shown, badged, told]));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const data = e.notification.data || {}, id = data.taskId || null, scope = self.registration.scope;
  // Decision 55: an action postpones the reminder; this worker has no localStorage, so the app does it (with Deshacer) from ?snooze= or the message
  const snooze = id && e.action === 'snooze10' ? 10 : id && e.action === 'snooze60' ? 60 : null;
  const target = new URL(id ? './?task=' + encodeURIComponent(id) + (snooze ? '&snooze=' + snooze : '') : './', scope).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    const c = list.find(w => w.url.startsWith(scope));
    if (c) {
      if (id) c.postMessage({ type: 'openTask', taskId: id, snooze });
      return c.focus ? c.focus().catch(() => self.clients.openWindow(target)) : self.clients.openWindow(target);
    }
    return self.clients.openWindow(target);
  }));
});
