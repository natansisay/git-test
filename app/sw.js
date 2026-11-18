// מאפשר לאפליקציה לעבוד גם בלי אינטרנט אחרי הפתיחה הראשונה
const CACHE = 'erdata-v3';
const FILES = ['./', 'index.html', 'style.css', 'app.js', 'content.js', 'store.js', 'voice.js', 'recorder.js', 'config.js', 'ai.js', 'prompts.js', 'icon.svg', 'manifest.webmanifest'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// קודם רשת (כדי לקבל עדכונים), ואם אין – מהמטמון
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then(res => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
        return res;
      })
      .catch(() => caches.match(e.request).then(r => r || Response.error()))
  );
});
