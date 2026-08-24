// orex.js — o que todas as páginas da app partilham.
//
//   O site tem quatro portas — /app para emparelhar, /agenda, /fotografias e
//   /rtls para trabalhar. Todas precisam da mesma coisa: saber quem é este
//   telemóvel, ter uma fila que sobrevive à falta de rede, e saber para que
//   obras pode enviar.
//
//   Se cada página trouxesse a sua cópia disto, passavam a ser quatro sítios
//   onde corrigir o mesmo bug — e nesta app já corrigi o mesmo bug duas vezes
//   por o ter escrito duas vezes.
//
//   O que torna a separação possível: localStorage e IndexedDB são partilhados
//   por ORIGEM, não por caminho. Emparelhar em /app dá credencial às outras
//   três sem repetir nada.
//
//   Expõe-se em window.OREX. Sem módulos ES, sem construção: é carregado por
//   <script src="/app/orex.js"> e funciona em qualquer página do domínio.
"use strict";
window.OREX = (function () {

// O modulo nao desenha nada. Quando alguma coisa muda — a fila, o
// emparelhamento — avisa, e cada pagina decide o que fazer com isso. Foi
// assim que se conseguiu tirar daqui as chamadas a pintar() sem partir nada.
const _ouvintes = [];
function avisar(que, dados) {
  for (const f of _ouvintes) { try { f(que, dados); } catch (e) { console.warn("[orex]", e); } }
}


/* ══════════════════════════════════════════════════════════════════════════
   Guardados no telefone
   ────────────────────────────────────────────────────────────────────────── */
const G = {
  cred:     "orex.cred",      // credencial deste aparelho (inclui a palavra-passe)
  sessao:   "orex.sessao",    // token em curso; descartável
  destinos: "orex.destinos",  // empresas e obras — para funcionar sem rede
  ultimo:   "orex.ultimo",    // última obra escolhida; poupa toques
};
const ler  = (k) => { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch { return null; } };
const grav = (k, v) => localStorage.setItem(k, JSON.stringify(v));

const uuid = () => (crypto.randomUUID ? crypto.randomUUID()
  : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, c =>
      (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)));

/* ══════════════════════════════════════════════════════════════════════════
   A fila (IndexedDB)

   O sítio onde a fotografia fica em segurança entre o disparo e a rede. É o
   coração da app: sem isto, uma fotografia tirada numa cave perdia-se.
   ────────────────────────────────────────────────────────────────────────── */
let _db = null;
function bd() {
  if (_db) return Promise.resolve(_db);
  return new Promise((ok, mal) => {
    const p = indexedDB.open("orex-obra", 1);
    p.onupgradeneeded = () => {
      const d = p.result;
      if (!d.objectStoreNames.contains("fila")) d.createObjectStore("fila", { keyPath: "idLocal" });
    };
    p.onsuccess = () => { _db = p.result; ok(_db); };
    p.onerror = () => mal(p.error);
  });
}
function trans(modo, f) {
  return bd().then(d => new Promise((ok, mal) => {
    const t = d.transaction("fila", modo), s = t.objectStore("fila");
    const r = f(s);
    t.oncomplete = () => ok(r && r.result !== undefined ? r.result : r);
    t.onerror = () => mal(t.error);
  }));
}
const filaPor   = ()   => trans("readonly",  s => s.getAll());
const filaGrav  = (it) => trans("readwrite", s => s.put(it));
const filaTira  = (id) => trans("readwrite", s => s.delete(id));

/* ══════════════════════════════════════════════════════════════════════════
   Credencial e autenticação

   O aparelho tem conta própria no Supabase. À primeira abertura troca a
   palavra-passe: a que veio no QR deixa de servir, e o retrato que alguém
   tenha feito do ecrã com ela passa a ser papel velho.

   A troca é feita em dois tempos — grava-se a nova ANTES de a pedir, como
   `passwordNova`, e só se promove depois de funcionar. Assim, se a app morrer
   a meio, a próxima abertura experimenta as duas e o telefone não fica preso
   do lado de fora.
   ────────────────────────────────────────────────────────────────────────── */
const cred = () => ler(G.cred);

async function chamarAuth(caminho, corpo) {
  const c = cred();
  const r = await fetch(`${c.url}/auth/v1/${caminho}`, {
    method: "POST",
    headers: { apikey: c.chave, "Content-Type": "application/json" },
    body: JSON.stringify(corpo),
  });
  return { ok: r.ok, d: await r.json().catch(() => ({})) };
}

// O QR traz um bilhete, não uma credencial. Troca-se aqui, por dentro do
// HTTPS — é o passo que faz com que fotografar o código no ecrã não sirva de
// nada a ninguém. E serve uma vez só: à segunda tentativa já não existe.
//
//   É a ÚNICA chamada que vai com a chave publicável e sem sessão, porque
//   neste momento o telemóvel ainda não tem nenhuma. É por isso que a
//   mov_resgatar fica aberta ao papel anon de propósito (migração 152) — e é
//   por isso que ela própria valida o código, o prazo e o aparelho por dentro.
//
//   Esta função ficou de fora quando o app/index.html se dividiu em orex.js:
//   estava exportada e não estava declarada, e o ficheiro inteiro rebentava a
//   carregar com "resgatar is not defined". Como o window.OREX nunca chegava a
//   existir, morriam as quatro páginas, não só o emparelhamento.
async function resgatar(url, chave, codigo) {
  const r = await fetch(`${url}/rest/v1/rpc/mov_resgatar`, {
    method: "POST",
    headers: { apikey: chave, "Content-Type": "application/json" },
    body: JSON.stringify({ p_codigo: codigo }),
  });
  const d = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`O OREX não respondeu ao emparelhamento (${r.status}).`);
  if (!d || !d.email) throw new Error(
    "Este código já foi usado, expirou, ou o aparelho foi revogado. Gera outro no OREX.");
  return d;
}

async function autenticar() {
  const c = cred();
  if (!c) throw new Error("Este telemóvel ainda não está emparelhado.");

  const s = ler(G.sessao);
  if (s?.access_token && s.expira > Date.now() + 60000) return s.access_token;

  let d = null, ultimoErro = null;
  if (s?.refresh_token) {
    const r = await chamarAuth("token?grant_type=refresh_token", { refresh_token: s.refresh_token });
    if (r.ok) d = r.d;
  }
  if (!d) {
    // As duas por ordem: a nova primeiro, porque é a que deve estar em vigor.
    for (const pw of [c.passwordNova, c.password].filter(Boolean)) {
      const r = await chamarAuth("token?grant_type=password", { email: c.email, password: pw });
      if (r.ok) {
        d = r.d;
        if (pw !== c.password) { c.password = pw; delete c.passwordNova; grav(G.cred, c); }
        break;
      }
      ultimoErro = r.d;
    }
  }
  if (!d?.access_token) {
    throw new Error(ultimoErro?.error_description || ultimoErro?.msg
      || "Esta credencial já não é aceite. Provavelmente o aparelho foi revogado — pede um novo QR.");
  }
  grav(G.sessao, { ...d, expira: Date.now() + (d.expires_in || 3600) * 1000 });
  return d.access_token;
}

async function trocarPassword() {
  const c = cred();
  if (c.trocada) return;
  const nova = Array.from(crypto.getRandomValues(new Uint8Array(24)))
    .map(b => "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"[b % 55]).join("");
  c.passwordNova = nova; grav(G.cred, c);          // primeiro guardar, depois pedir

  const tok = await autenticar();
  const r = await fetch(`${c.url}/auth/v1/user`, {
    method: "PUT",
    headers: { apikey: c.chave, Authorization: `Bearer ${tok}`, "Content-Type": "application/json" },
    body: JSON.stringify({ password: nova }),
  });
  if (!r.ok) return;                                // fica para a próxima abertura
  const d = cred();
  d.password = nova; delete d.passwordNova; d.trocada = true; grav(G.cred, d);
  localStorage.removeItem(G.sessao);                // a sessão antiga já não interessa
}

/* ══════════════════════════════════════════════════════════════════════════
   Destinos — para onde este telefone pode mandar
   ────────────────────────────────────────────────────────────────────────── */
// Quando o aparelho é revogado no OREX, a app tem de dar por isso.
//
// Antes não dava: ficava com a credencial guardada, as fotografias e as
// posições falhavam uma a uma na fila, e o ecrã de emparelhamento nunca
// voltava. Quem revogou o telemóvel via-o continuar como se nada fosse.
//
// A fila NÃO se apaga. O que lá está foi tirado por alguém e pode ser enviado
// assim que o aparelho voltar a ser emparelhado.
function desligarPorRevogacao(porque) {
  localStorage.removeItem(G.cred);
  localStorage.removeItem(G.sessao);
  localStorage.removeItem(G.destinos);
  avisar("revogado", { porque: porque + " Lê um QR novo para voltar a ligar. O que está na fila fica à espera." });
}

async function buscarDestinos() {
  const c = cred(), tok = await autenticar();
  const r = await fetch(`${c.url}/rest/v1/rpc/mov_destinos`, {
    method: "POST",
    headers: { apikey: c.chave, Authorization: `Bearer ${tok}`, "Content-Type": "application/json" },
    body: "{}",
  });
  if (!r.ok) throw new Error(`O servidor recusou a lista de obras (${r.status}).`);
  // A chamada correu bem e não veio nada: não é falta de rede, é o servidor a
  // dizer que este aparelho já não existe para ele. Sinal definitivo.
  const d = await r.json();
  if (!d || !d.empresas) {
    desligarPorRevogacao("Este telemóvel foi desligado do OREX.");
    throw new Error("Aparelho revogado.");
  }
  grav(G.destinos, { ...d, em: Date.now() });
  return d;
}

/* ══════════════════════════════════════════════════════════════════════════
   Enviar

   Ficheiro primeiro, registo depois. Ao contrário ficaria uma linha a apontar
   para uma fotografia que não existe — e essa é a avaria que dá trabalho a
   perceber. Um ficheiro sem linha é só espaço ocupado.
   ────────────────────────────────────────────────────────────────────────── */
async function detalheErro(r, oQue) {
  let t = ""; try { const d = await r.json(); t = d.message || d.msg || d.error || ""; } catch {}
  if (r.status === 401 || r.status === 403)
    return `Sem autorização para enviar ${oQue}. O aparelho pode ter sido revogado.`;
  if (r.status === 413) return "A fotografia é grande demais para o servidor a aceitar.";
  return `Falhou o envio d${oQue === "a fotografia" ? "a fotografia" : "o registo"} (${r.status})${t ? ": " + t : ""}`;
}

// Uma chamada a uma função do Supabase, com a sessão deste aparelho.
async function rpc(nome, corpo) {
  const c = cred(), tok = await autenticar();
  const r = await fetch(`${c.url}/rest/v1/rpc/${nome}`, {
    method: "POST",
    headers: { apikey: c.chave, Authorization: `Bearer ${tok}`, "Content-Type": "application/json" },
    body: JSON.stringify(corpo || {}),
  });
  if (!r.ok) throw new Error(await detalheErro(r, nome));
  return r.json();
}

async function enviarUm(it) {
  // ── O QUE SE ESCREVE NUM ASSUNTO ────────────────────────────────────────
  //
  //   Um comentário escrito em obra sem rede vive nesta fila como uma
  //   fotografia vive. Vai com a HORA A QUE FOI ESCRITO (`tiradaEm`), e não com
  //   a hora a que chega: escrito às 9h numa cave e enviado às 14h, pertence às
  //   9h — senão aparece depois de respostas que lhe são posteriores.
  //
  //   E vai com o `idLocal`, que é a chave desta fila. Se a rede cair depois de
  //   o servidor ter gravado mas antes de responder, a próxima tentativa manda
  //   o mesmo `idLocal` e o servidor devolve o que já tinha — o comentário não
  //   entra duas vezes.
  if (it.tipo === "fio" || it.tipo === "feito") {
    if (it.tipo === "feito") {
      const r = await rpc("mov_assunto_feito", { p_marcacao: it.assunto, p_nota: it.texto || null });
      if (r && r.ok === false) throw new Error(r.erro || "não consegui fechar o assunto");
      return;
    }
    const r = await rpc("mov_fio_escrever", {
      p_marcacao: it.assunto, p_texto: it.texto,
      p_especie: it.especie || "comentario",
      p_quando: it.tiradaEm, p_idlocal: it.idLocal,
    });
    if (r && r.ok === false) throw new Error(r.erro || "não consegui escrever no assunto");
    return;
  }

  const c = cred();
  let tok = await autenticar();
  // Uma posição é só a linha — não há imagem para subir.
  const posicao = it.tipo === "posicao";
  const caminho = posicao ? null : `${c.aparelhoId}/${it.tiradaEm.slice(0, 7)}/${it.idLocal}.jpg`;

  if (!posicao) {
    const por = async (t) => fetch(`${c.url}/storage/v1/object/orex-movel/${caminho}`, {
      method: "POST",
      headers: { apikey: c.chave, Authorization: `Bearer ${t}`, "Content-Type": "image/jpeg", "x-upsert": "true" },
      body: it.foto,
    });
    let r1 = await por(tok);
    if (r1.status === 401) { localStorage.removeItem(G.sessao); tok = await autenticar(); r1 = await por(tok); }
    if (!r1.ok) throw new Error(await detalheErro(r1, "a fotografia"));
  }

  const r2 = await fetch(`${c.url}/rest/v1/Mov_Captura`, {
    method: "POST",
    headers: { apikey: c.chave, Authorization: `Bearer ${tok}`, "Content-Type": "application/json",
               Prefer: "return=minimal" },
    body: JSON.stringify({
      IdLocal: it.idLocal, AparelhoID: c.aparelhoId, OwnerID: it.ownerId,
      Destino: posicao ? "rtls" : "obra", RefID: it.obraId, TiradaEm: it.tiradaEm,
      Lat: it.lat ?? null, Lng: it.lng ?? null, PrecisaoM: it.precisao ?? null,
      Nota: it.nota || null, Ficheiro: caminho,
    }),
  });
  // Já lá estava: a fotografia chegou numa tentativa anterior cuja resposta se
  // perdeu. Repetir seria criar um duplicado; dar por enviada é a verdade.
  if (r2.status === 409) return;
  if (!r2.ok) throw new Error(await detalheErro(r2, "o registo"));
}

let _aEnviar = false;
async function escoarFila(porOrdem) {
  if (_aEnviar || !navigator.onLine || !cred()) return;
  _aEnviar = true;
  try {
    const itens = (await filaPor()).sort((a, b) => a.tiradaEm.localeCompare(b.tiradaEm));
    for (const it of itens) {
      if (it.estado === "enviando") continue;
      // Uma falha recente não se repete já — evita gastar bateria contra uma
      // parede. O botão "tentar agora" ignora esta espera, que é para isso.
      if (!porOrdem && it.proxima && it.proxima > Date.now()) continue;
      it.estado = "enviando"; await filaGrav(it);
      avisar("fila");
      try {
        await enviarUm(it);
        await filaTira(it.idLocal);
        esquecerMiniatura(it.idLocal);
      } catch (e) {
        it.estado = "falhou"; it.erro = e.message;
        it.tentativas = (it.tentativas || 0) + 1;
        it.proxima = Date.now() + Math.min(10 * 60000, 15000 * 2 ** Math.min(it.tentativas, 5));
        await filaGrav(it);
        // "Sem autorização" pode ser um sinal de que o aparelho foi revogado
        // enquanto a app estava aberta. Vale a pena confirmar uma vez: se foi,
        // buscarDestinos desliga e volta ao emparelhamento, em vez de a fila
        // ficar a bater na parede de dez em dez minutos.
        if (/autoriza/i.test(e.message)) {
          try { await buscarDestinos(); } catch { /* já tratou */ }
          if (!cred()) break;
        }
      }
      avisar("fila");
    }
  } finally { _aEnviar = false; avisar("fila"); }
}

/* ══════════════════════════════════════════════════════════════════════════
   Fotografia

   Reduzida antes de entrar na fila. Um telemóvel actual dá 6 MB por foto; numa
   obra com meia barra de rede isso não sobe. 1600 px chegam para se ver o que
   se quis mostrar, e cabem em ~300 kB.
   ────────────────────────────────────────────────────────────────────────── */
function encolher(ficheiro, lado = 1600, q = 0.82) {
  return new Promise((ok, mal) => {
    const img = new Image(), url = URL.createObjectURL(ficheiro);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const e = Math.min(1, lado / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * e); c.height = Math.round(img.height * e);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      c.toBlob(b => b ? ok(b) : mal(new Error("Não consegui preparar a fotografia.")), "image/jpeg", q);
    };
    img.onerror = () => { URL.revokeObjectURL(url); mal(new Error("Não consegui ler a fotografia.")); };
    img.src = url;
  });
}

// Onde foi tirada. Best-effort: sem sinal de GPS a fotografia vai na mesma —
// perder a fotografia por causa da localização seria trocar o essencial pelo
// acessório. Por isso aqui é depressa, e a pontaria fica para quem a pede.
function ondeEstou(ms = 8000) {
  return new Promise(ok => {
    if (!navigator.geolocation) return ok({});
    navigator.geolocation.getCurrentPosition(
      p => ok({ lat: p.coords.latitude, lng: p.coords.longitude, precisao: p.coords.accuracy }),
      () => ok({}), { enableHighAccuracy: true, timeout: ms, maximumAge: 10000 });
  });
}

// Afinar a posição.
//
//   Uma leitura só é quase sempre má: o telefone responde à primeira com o que
//   tem à mão — a antena de rede, o wi-fi do vizinho — e isso dá 20 a 40 m. O
//   GPS ainda está a apanhar satélites nesse momento.
//
//   Fica-se a ouvir. De segundo a segundo chegam leituras cada vez melhores e
//   guarda-se a melhor; pára-se quando chega ao alvo, ou ao fim do tempo. Vinte
//   segundos parado ao ar livre costumam levar de ±30 m a ±5 m.
//
//   `maximumAge: 0` é essencial: sem isso o telefone devolve alegremente uma
//   leitura velha em cache — a mesma que se está a tentar melhorar.
function afinarPosicao({ alvoM = 8, segundos = 20, aoVivo } = {}) {
  return new Promise(ok => {
    if (!navigator.geolocation) return ok({});
    let melhor = null, vigia = null, relogio = null, acabou = false;
    const acabar = () => {
      if (acabou) return; acabou = true;
      if (vigia != null) navigator.geolocation.clearWatch(vigia);
      clearTimeout(relogio);
      ok(melhor || {});
    };
    vigia = navigator.geolocation.watchPosition(
      p => {
        const c = { lat: p.coords.latitude, lng: p.coords.longitude, precisao: p.coords.accuracy };
        if (!melhor || c.precisao < melhor.precisao) melhor = c;
        if (aoVivo) aoVivo(melhor);
        if (melhor.precisao <= alvoM) acabar();
      },
      () => { /* uma leitura falhada não estraga as outras */ },
      { enableHighAccuracy: true, maximumAge: 0, timeout: segundos * 1000 }
    );
    relogio = setTimeout(acabar, segundos * 1000);
  });
}

/* ══════════════════════════════════════════════════════════════════════════
   O que as páginas usam
   ────────────────────────────────────────────────────────────────────────── */
return {
  // Quem é este telemóvel
  cred, autenticar, trocarPassword, resgatar, desligarPorRevogacao,
  guardarCred: (c) => grav(G.cred, c),
  esquecerTudo() {
    localStorage.removeItem(G.cred); localStorage.removeItem(G.sessao);
    localStorage.removeItem(G.destinos);
  },
  // Para onde pode enviar
  buscarDestinos,
  destinosEmCache: () => ler(G.destinos) || { empresas: [] },
  empresas: () => (ler(G.destinos) || {}).empresas || [],
  ultimoAlvo: () => ler(G.ultimo) || {},
  guardarUltimoAlvo: (v) => grav(G.ultimo, v),
  // A fila
  fila: filaPor, filaGrav, filaTira, escoarFila,
  // Escrever num assunto sem rede: entra na fila e sai quando houver. Devolve
  // logo o item, para a página o poder mostrar no fio antes de ele ter saído —
  // que é o que faz a app parecer que responde mesmo dentro de uma cave.
  async comentar(assunto, texto, especie) {
    const it = { idLocal: uuid(), tipo: "fio", assunto, texto,
                 especie: especie || "comentario",
                 tiradaEm: new Date().toISOString(), estado: "por enviar" };
    await filaGrav(it); avisar("fila");
    escoarFila().catch(() => {});
    return it;
  },
  async darPorFeito(assunto, nota) {
    const it = { idLocal: uuid(), tipo: "feito", assunto, texto: nota || null,
                 tiradaEm: new Date().toISOString(), estado: "por enviar" };
    await filaGrav(it); avisar("fila");
    escoarFila().catch(() => {});
    return it;
  },
  rpc,
  limparFila: () => trans("readwrite", (s) => s.clear()),
  // Ferramentas
  uuid, encolher, ondeEstou, afinarPosicao,
  // Avisos para a página desenhar o que precisar
  aoMudar(f) { _ouvintes.push(f); },
};
})();
