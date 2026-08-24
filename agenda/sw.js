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

// ── AVISOS ─────────────────────────────────────────────────────────────────
//
//   O `push` chega com a página fechada — é para isso que existe. O aviso é
//   desenhado aqui, com o que vier no corpo; se não vier nada (há serviços que
//   entregam o push sem carga), mostra-se um aviso genérico em vez de nada,
//   porque um push silencioso faz o browser queixar-se e, em alguns, revogar a
//   permissão.
self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { titulo: e.data && e.data.text() }; }
  const titulo = d.titulo || "OREX";
  e.waitUntil(self.registration.showNotification(titulo, {
    body: d.corpo || "",
    icon: "../app/icone-192.png",
    badge: "../app/icone-192.png",
    // A etiqueta agrupa: dois avisos do mesmo compromisso substituem-se em vez
    // de se empilharem no ecrã de bloqueio.
    tag: d.id ? "orex-" + d.id : undefined,
    data: { ligacao: d.ligacao || "/agenda/", motivo: d.motivo || null },
    // Um prazo que já passou não se descarta sem se ver — os outros sim.
    requireInteraction: d.motivo === "prazo_passado",
  }));
});

//   Carregar no aviso leva à agenda. Se ela já estiver aberta nalgum
//   separador, traz-se esse à frente em vez de abrir mais um — abrir um
//   segundo separador da mesma coisa é o defeito mais comum destas páginas.
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const destino = (e.notification.data && e.notification.data.ligacao) || "/agenda/";
  e.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then((js) => {
    for (const c of js) if (c.url.includes("/agenda") && "focus" in c) return c.focus();
    return clients.openWindow(destino);
  }));
});
