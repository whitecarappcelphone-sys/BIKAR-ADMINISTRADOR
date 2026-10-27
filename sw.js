/* ============================================================
   BIKAR TRANSPORTES — Service Worker
   Panel de Administración BIKAR
   Compatible con:
     - Registro directo:  navigator.serviceWorker.register('./sw.js')
     - Registro vía Blob:  navigator.serviceWorker.register(blobURL)
   ============================================================ */

const SW_VERSION = 'bikar-admin-v1.1.0';
const CACHE_NAME = `bikar-admin-cache-${SW_VERSION}`;
const RUNTIME_CACHE = `bikar-admin-runtime-${SW_VERSION}`;

/* Recursos esenciales del shell (precache) */
const PRECACHE_URLS = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png'
];

/* ---------- INSTALL ---------- */
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) =>
        // addAll falla si un recurso individual falla -> Promise.allSettled
        Promise.allSettled(
          PRECACHE_URLS.map((url) =>
            cache.add(new Request(url, { cache: 'reload' }))
          )
        )
      )
      .then(() => self.skipWaiting())
  );
});

/* ---------- ACTIVATE ---------- */
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k !== CACHE_NAME && k !== RUNTIME_CACHE)
            .map((k) => caches.delete(k))
        )
      )
      .then(() => {
        if ('navigationPreload' in self.registration) {
          return self.registration.navigationPreload.enable();
        }
        return null;
      })
      .then(() => self.clients.claim())
  );
});

/* ---------- FETCH ---------- */
self.addEventListener('fetch', (event) => {
  const request = event.request;

  if (request.method !== 'GET') return;

  let url;
  try {
    url = new URL(request.url);
  } catch (e) {
    return;
  }

  const sameOrigin = url.origin === self.location.origin;

  /* 1) API de Supabase: SIEMPRE red, nunca caché (datos en vivo) */
  if (
    url.hostname.endsWith('supabase.co') ||
    url.hostname.includes('supabase') ||
    url.pathname.includes('/rest/v1/')
  ) {
    event.respondWith(
      fetch(request).catch(
        () =>
          new Response(
            JSON.stringify({
              error: 'Sin conexión con el servidor de BIKAR Transportes.',
            }),
            { status: 503, headers: { 'Content-Type': 'application/json' } }
          )
      )
    );
    return;
  }

  /* 2) Video de fondo: NO cachear (streaming directo, evita lag) */
  if (url.pathname.endsWith('.mp4') || request.destination === 'video') {
    event.respondWith(fetch(request).catch(() => new Response('', { status: 503 })));
    return;
  }

  /* 3) Navegación: Network-first con fallback al shell (offline) */
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const preload = await event.preloadResponse;
          if (preload) {
            const cache = await caches.open(RUNTIME_CACHE);
            cache.put('./index.html', preload.clone());
            return preload;
          }

          const network = await fetch(request);
          const cache = await caches.open(RUNTIME_CACHE);
          cache.put('./index.html', network.clone());
          return network;
        } catch (err) {
          const cached =
            (await caches.match('./index.html')) ||
            (await caches.match('./')) ||
            (await caches.match(CACHE_NAME + '/index.html'));

          return (
            cached ||
            new Response(
              '<!doctype html><html lang="es"><head><meta charset="utf-8">' +
                '<meta name="viewport" content="width=device-width,initial-scale=1">' +
                '<title>BIKAR Transportes — Offline</title></head>' +
                '<body style="font-family:system-ui;background:#316D87;color:#fff;' +
                'display:grid;place-items:center;min-height:100vh;margin:0;text-align:center">' +
                '<div><h1 style="font-size:2rem">BIKAR Transportes</h1>' +
                '<p>Sin conexión a internet. Los datos en vivo requieren red.</p></div>' +
                '</body></html>',
              {
                status: 200,
                headers: { 'Content-Type': 'text/html; charset=utf-8' },
              }
            )
          );
        }
      })()
    );
    return;
  }

  /* 4) Recursos estáticos del mismo origen: Stale-while-revalidate */
  if (sameOrigin) {
    event.respondWith(
      caches.match(request).then((cached) => {
        const network = fetch(request)
          .then((response) => {
            if (response && response.status === 200 && response.type === 'basic') {
              const copy = response.clone();
              caches.open(RUNTIME_CACHE).then((cache) => cache.put(request, copy));
            }
            return response;
          })
          .catch(() => cached);

        return cached || network;
      })
    );
    return;
  }

  /* 5) Externos (CDN de Supabase, Google Fonts): Cache-first */
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request)
        .then((response) => {
          if (response && (response.status === 200 || response.type === 'opaque')) {
            const copy = response.clone();
            caches.open(RUNTIME_CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached);
    })
  );
});

/* ---------- MENSAJES ---------- */
self.addEventListener('message', (event) => {
  const data = event.data;
  if (data === 'SKIP_WAITING' || (data && data.type === 'SKIP_WAITING')) {
    self.skipWaiting();
  }
  if (data === 'GET_VERSION' && event.source) {
    event.source.postMessage({ type: 'VERSION', version: SW_VERSION });
  }
});
