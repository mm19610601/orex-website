// Service worker — a peça que faz a app existir fora de rede.
//
//   A obra é o pior sítio para se depender da internet: cave, estrutura de
//   betão, o telefone com uma barra. A app tem de abrir na mesma. Por isso o
//   seu próprio código vive em cache e serve-se de lá primeiro.
//
//   O que NÃO passa por aqui: o Supabase. Chamadas à rede de dados nunca se
//   guardam em cache — uma resposta velha seria pior do que não haver resposta.
//   Falhando, quem trata é a fila da app, não este ficheiro.

const VERSAO = "orex-app-v3";   // subir a cada alteração da app, senão os telefones ficam com a velha
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

  // Cache primeiro: abrir depressa importa mais do que ter a última versão do
  // ícone. Actualiza-se em segundo plano, e da próxima vez já está fresco.
  e.respondWith(
    caches.match(e.request).then((achou) => {
      const rede = fetch(e.request)
        .then((r) => {
          if (r && r.ok) caches.open(VERSAO).then((c) => c.put(e.request, r.clone()));
          return r;
        })
        .catch(() => achou || caches.match("./index.html"));
      return achou || rede;
    })
  );
});
