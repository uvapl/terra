/*
 * Copyright 2020 WebAssembly Community Group participants
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// Copied from:
// https://developers.google.com/web/fundamentals/primers/service-workers/
// https://developers.google.com/web/fundamentals/primers/service-workers/lifecycle
// https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers

const CACHE_NAME = 'v1';
const expectedCaches = [CACHE_NAME];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll([
        `/static/js/vendor/ace.js`,
        `/static/js/vendor/keybinding-sublime.js`,
        `/static/js/vendor/mode-c_cpp.js`,
        `/static/css/vendor/goldenlayout-base.css`,
        `/static/css/vendor/goldenlayout-light-theme.css`,
        `/static/js/vendor/goldenlayout.min.js`,
        `/static/js/vendor/jquery.min.js`,
        `/static/js/vendor/xterm.fit.min.js`,
        `/static/js/vendor/xterm.min.js`,
        `/static/css/vendor/xterm.min.css`,
        '/',
        '/index.html',
        '/static/css/main.css',
        '/static/wasm/memfs',
        '/static/js/wasm/utils.js',
        '/static/js/wasm/layout_components.js',
        '/static/js/worker.js',
        '/static/js/constants.js',
        '/static/js/main.js',
      ]);
    })
  );
});

self.addEventListener('activate', event => {
  // delete any caches that aren't in expectedCaches
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.map(key => {
        if (!expectedCaches.includes(key)) {
          return caches.delete(key);
        }
      })
    ))
  );
});

self.addEventListener('fetch', function(event) {
  event.respondWith(
    caches.match(event.request)
      .then(function(response) {
        // Cache hit - return response
        if (response) {
          return response;
        }
        console.log(`got uncached ${event.request.url}`);
        return fetch(event.request).then(function(response) {
          // Check if we received a valid response
          if (!response || response.status !== 200 ||
            response.type !== 'basic') {
            return response;
          }

          // IMPORTANT: Clone the response. A response is a stream
          // and because we want the browser to consume the response
          // as well as the cache consuming the response, we need
          // to clone it so we have two streams.
          var responseToCache = response.clone();

          caches.open(CACHE_NAME).then(function(cache) {
            cache.put(event.request, responseToCache);
          });

          return response;
        });
      })
  )
});
