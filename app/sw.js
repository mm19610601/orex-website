// Lápide do service worker do /app.
//
//   O /app deixou de ser a aplicação e passou a ser a porta de entrada: quem
//   trabalha instala /fotografias, /rtls ou /agenda, e cada uma tem o seu
//   vigia. Este ficheiro já não devia existir — mas TEM de existir.
//
//   A razão: quando um service worker some, o browser não o esquece. Tenta
//   buscar o ficheiro, recebe 404, dá a actualização por falhada e mantém o
//   VELHO activo, indefinidamente. Cada telemóvel que abriu o /app ficaria
//   para sempre com um vigia a servir da cache uma página que já não existe —
//   e em obra, sem rede, era só isso que veria.
//
//   Por isso a saída não é apagar: é publicar uma versão que não faz nada
//   excepto despedir-se. Limpa o que guardou, larga os clientes e desinscreve-
//   -se. Na visita seguinte já não há vigia nenhum e o /app é uma página
//   normal, como devia.
//
//   Quando todos os aparelhos tiverem passado por aqui, este ficheiro pode
//   desaparecer. Não há pressa: custa 1 kB.

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    // Tudo o que o vigia antigo guardou, incluindo o index.html velho.
    const nomes = await caches.keys();
    await Promise.all(nomes.map((n) => caches.delete(n)));
    // Desinscrever-se antes de recarregar os clientes: pela outra ordem, a
    // página recarregada ainda apanhava este worker e ficava um ciclo.
    await self.registration.unregister();
    const clientes = await self.clients.matchAll({ type: "window" });
    for (const c of clientes) c.navigate(c.url).catch(() => {});
  })());
});

// Sem fetch handler: nada passa por aqui. A rede é a rede.
