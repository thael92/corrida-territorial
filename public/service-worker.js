const CACHE_NAME = 'corrida-territorial-v1';
const urlsToCache = [
    '/',
    '/index.html',
    '/styles.css',
    '/app.js',
    '/manifest.json',
    'https://www.soundjay.com/buttons/sounds/button-7.mp3' // Cache do som
];

// Instala o Service Worker e armazena os assets em cache
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                console.log('Cache aberto');
                return cache.addAll(urlsToCache);
            })
    );
});

// Intercepta as requisições e serve do cache se disponível
self.addEventListener('fetch', event => {
    event.respondWith(
        caches.match(event.request)
            .then(response => {
                // Se encontrar no cache, retorna. Senão, busca na rede.
                return response || fetch(event.request);
            })
    );
});
