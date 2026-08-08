// Service worker — a peça que faz a app existir fora de rede.
//
//   A obra é o pior sítio para se depender da internet: cave, estrutura de
//   betão, o telefone com uma barra. A app tem de abrir na mesma. Por isso o
//   seu próprio código vive em cache — mas serve-se dela como REDE DE
//   SEGURANÇA, não como primeira escolha: ver em baixo porquê.
//
//   O que NÃO passa por aqui: o Supabase. Chamadas à rede de dados nunca se
//   guardam em cache — uma resposta velha seria pior do que não haver resposta.
//   Falhando, quem trata é a fila da app, não este ficheiro.

const VERSAO = "orex-app-v4";   // subir a cada alteração da app, senão os telefones ficam com a velha
const ESSENCIAL = [
  "./",
  "./index.html",
  "./manifest.json",
  "./icone-192.png",
  "./icone-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSAO).then((c) => c.addAll(ESSENCIAL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== VERSAO).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  // Só o que é nosso e é do próprio ecrã. O resto vai à rede como sempre.
  if (e.request.method !== "GET" || url.origin !== self.location.origin) return;
  if (!url.pathname.startsWith("/app/")) return;

  // A app em si vai à rede primeiro. Cache primeiro parece mais rápido, mas
  // fazia com que uma alteração só aparecesse na SEGUNDA vez que se abria — e
  // ninguém liga uma coisa dessas ao service worker: fica a pensar que o botão
  // novo não existe. São 35 kB; o segundo que se perde vale a confusão que
  // poupa. Sem rede, serve-se o que está guardado, que é o que interessa.
  const eApp = url.pathname.endsWith("/app/") || url.pathname.endsWith("index.html")
            || url.pathname.endsWith("sw.js") || url.pathname.endsWith("manifest.json");

  if (eApp) {
    e.respondWith(
      fetch(e.request)
        .then((r) => {
          if (r && r.ok) caches.open(VERSAO).then((c) => c.put(e.request, r.clone()));
          return r;
        })
        .catch(() => caches.match(e.request).then(a => a || caches.match("./index.html")))
    );
    return;
  }

  // Os ícones não mudam: cache primeiro, e actualiza-se em segundo plano.
  e.respondWith(
    caches.match(e.request).then((achou) => {
      const rede = fetch(e.request)
        .then((r) => {
          if (r && r.ok) caches.open(VERSAO).then((c) => c.put(e.request, r.clone()));
          return r;
        })
        .catch(() => achou);
      return achou || rede;
    })
  );
});
