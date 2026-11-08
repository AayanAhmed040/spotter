// Striqs service worker: makes the app installable and fast to reopen.
// - App shell & hashed assets: cache-first.
// - MediaPipe WASM + pose model (large, versioned URLs): cache-first, so the second workout starts instantly.
// - API requests and Auth0 are never cached.
const VERSION = 'striqs-v2'
const SHELL = ['/', '/manifest.webmanifest', '/icon.svg', '/icons/icon-192.png']
// Setup / hero videos (web/public/media) are large and optional: never pre-cached.

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  )
})

const isModelAsset = (url) =>
  url.hostname === 'storage.googleapis.com' && url.pathname.startsWith('/mediapipe-models/') ||
  url.hostname === 'cdn.jsdelivr.net' && url.pathname.includes('@mediapipe/tasks-vision@')

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.pathname.startsWith('/api/') || url.hostname.endsWith('auth0.com')) return

  if (isModelAsset(url) || (url.origin === location.origin && url.pathname.startsWith('/assets/'))) {
    e.respondWith(
      caches.open(VERSION).then(async (c) => {
        const hit = await c.match(req)
        if (hit) return hit
        const res = await fetch(req)
        if (res.ok) c.put(req, res.clone())
        return res
      }),
    )
    return
  }

  // Navigations: network first, fall back to the cached shell when offline.
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).catch(() => caches.match('/')))
  }
})
