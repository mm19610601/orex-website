// Service worker de uma das páginas de trabalho.
//
//   Rede primeiro para o código próprio, cache como rede de segurança. Cache
//   primeiro fazia com que uma alteração só aparecesse na SEGUNDA abertura —
//   e ninguém liga isso a um service worker: fica a pensar que o botão novo
//   não existe.
//
//   O /app/orex.js entra na cache porque é o coração da página: sem ele, numa
//   obra sem rede, não abria nada.
// O nome da cache leva o nome da página: as quatro moram no mesmo domínio e
// partilham o armazenamento. Com um nome só, subir a versão numa delas fazia
// o activate apagar o que as outras tinham guardado para trabalhar sem rede.
const VERSAO = "orex-" + (self.location.pathname.split("/")[1] || "raiz") + "-v1";
const ESSENCIAL = ["./", "./index.html", "./manifest.json",
                   "../app/orex.js", "../app/comum.css", "../app/icone-192.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSAO).then(c => c.addAll(ESSENCIAL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k !== VERSAO).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== self.location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then(r => { if (r && r.ok) caches.open(VERSAO).then(c => c.put(e.request, r.clone())); return r; })
      .catch(() => caches.match(e.request).then(a => a || caches.match("./index.html")))
  );
});
