import {
  eventoPublico, entrarNoEvento, recuperarParticipacao, listarParticipantes, listarGaleria, listarAlbum,
  excluirPropriaMidia, denunciarMidia, lerSessao, salvarSessao, removerSessao, urlsMidias, traduzirErro,
} from "./api.js";
import {
  app, $, $$, esc, icone, cabecalho, rodape, carregando, mensagemTela, toast, abrirModal, confirmar,
  copiarTexto, formatarData, segundos, TIPOS_EVENTO,
} from "./ui.js";

const TAMANHO_PAGINA = 36;
let lightboxAtual = null;
const fecharLightbox = () => lightboxAtual?.();

/* ============================================================
   Grade com carregamento progressivo
   ============================================================ */
function montarGrade(alvo, { slug, buscar, sessao, mostrarNome = true, textoVazio }) {
  const estado = { itens: [], fim: false, carregando: false };
  alvo.innerHTML = `<div class="grade"></div><div class="sentinela" aria-hidden="true"></div><div class="estado-grade"></div>`;
  const grade = $(".grade", alvo);
  const sentinela = $(".sentinela", alvo);
  const msg = $(".estado-grade", alvo);

  const tile = (m, i, url) => `<button class="tile" data-i="${i}" aria-label="Abrir ${m.tipo === "video" ? "vídeo" : "foto"} de ${esc(m.nome_publico)}">
    ${url ? `<img src="${esc(url)}" alt="" loading="lazy" decoding="async">` : `<span class="tile-vazio">${icone(m.tipo === "video" ? "video" : "imagem", 28)}</span>`}
    ${m.tipo === "video" ? `<span class="tile-play">${icone("play", 16)}<small>${segundos(m.duracao_segundos)}</small></span>` : ""}
    ${mostrarNome ? `<span class="tile-nome">${esc(m.nome_publico)}</span>` : ""}</button>`;

  async function carregar() {
    if (estado.carregando || estado.fim) return;
    estado.carregando = true;
    msg.innerHTML = `<div class="spinner pequeno"></div>`;
    try {
      const antes = estado.itens.at(-1)?.enviado_em ?? null;
      const novos = await buscar(antes);
      if (novos.length < TAMANHO_PAGINA) estado.fim = true;
      const urls = novos.length ? await urlsMidias(slug, novos.map((m) => m.midia_id), "miniatura") : {};
      for (const m of novos) {
        const i = estado.itens.push(m) - 1;
        grade.insertAdjacentHTML("beforeend", tile(m, i, urls[m.midia_id]));
      }
      msg.innerHTML = estado.itens.length === 0 ? `<div class="vazio cartao"><p class="suave">${esc(textoVazio)}</p></div>` : "";
    } catch (e) {
      msg.innerHTML = `<p class="erro-texto">${esc(traduzirErro(e))} <button class="link" data-retentar>Tentar de novo</button></p>`;
    } finally {
      estado.carregando = false;
      if (!estado.fim) {
        observador.unobserve(sentinela);
        observador.observe(sentinela);
      }
    }
  }

  const observador = new IntersectionObserver((e) => e[0].isIntersecting && carregar(), { rootMargin: "600px" });
  observador.observe(sentinela);

  alvo.addEventListener("click", (e) => {
    if (e.target.closest("[data-retentar]")) return carregar();
    const t = e.target.closest(".tile");
    if (!t) return;
    abrirLightbox({ slug, itens: estado.itens, indice: Number(t.dataset.i), sessao, aoExcluir: recarregar });
  });

  function recarregar() {
    estado.itens = [];
    estado.fim = false;
    grade.innerHTML = "";
    carregar();
  }

  return () => {
    observador.disconnect();
    fecharLightbox();
  };
}

/* ============================================================
   Visualizador (ampliar foto, reproduzir vídeo)
   ============================================================ */
function abrirLightbox({ slug, itens, indice, sessao, aoExcluir }) {
  fecharLightbox();
  let i = indice;
  let rodada = 0;
  const el = document.createElement("div");
  el.className = "lightbox";
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-modal", "true");
  el.innerHTML = `
    <button class="lb-fechar" data-lb="fechar" aria-label="Fechar">${icone("x", 24)}</button>
    <button class="lb-nav ant" data-lb="ant" aria-label="Anterior">${icone("seta", 24)}</button>
    <button class="lb-nav prox" data-lb="prox" aria-label="Próxima">${icone("seta", 24)}</button>
    <div class="lb-palco"></div><div class="lb-info"></div>`;
  document.body.append(el);
  document.body.classList.add("sem-rolagem");

  const palco = $(".lb-palco", el);
  const info = $(".lb-info", el);

  async function mostrar() {
    const minha = ++rodada;
    const m = itens[i];
    $(".ant", el).hidden = i === 0;
    $(".prox", el).hidden = i === itens.length - 1;
    palco.innerHTML = `<div class="spinner claro"></div>`;
    const propria = sessao && sessao.id === m.participante_id;
    info.innerHTML = `<div><strong>${esc(m.nome_publico)}</strong><span class="pequeno">${formatarData(m.enviado_em)}</span></div>
      <div class="lb-botoes">
        <button class="btn-icone" data-lb="baixar" aria-label="Baixar original" title="Baixar original">${icone("baixar")}</button>
        <button class="btn-icone" data-lb="denunciar" aria-label="Denunciar" title="Denunciar">${icone("bandeira")}</button>
        ${propria ? `<button class="btn-icone" data-lb="excluir" aria-label="Excluir minha mídia" title="Excluir">${icone("lixeira")}</button>` : ""}
      </div>`;
    try {
      const urls = await urlsMidias(slug, [m.midia_id], "original");
      if (minha !== rodada) return;
      if (m.tipo === "video") {
        palco.innerHTML = `<video src="${esc(urls[m.midia_id])}" controls autoplay playsinline></video>`;
      } else {
        palco.innerHTML = `<img src="${esc(urls[m.midia_id])}" alt="Foto enviada por ${esc(m.nome_publico)}">`;
        $("img", palco).onerror = async () => {
          const mini = await urlsMidias(slug, [m.midia_id], "miniatura").catch(() => ({}));
          if (minha === rodada && mini[m.midia_id]) $("img", palco).src = mini[m.midia_id];
        };
      }
    } catch (e) {
      if (minha === rodada) palco.innerHTML = `<p class="claro-texto">${esc(traduzirErro(e))}</p>`;
    }
    // pré-carrega a próxima miniatura/original sem bloquear
    const vizinha = itens[i + 1];
    if (vizinha?.tipo === "foto") urlsMidias(slug, [vizinha.midia_id], "original").catch(() => {});
  }

  const ir = (d) => {
    const n = i + d;
    if (n >= 0 && n < itens.length) {
      i = n;
      mostrar();
    }
  };

  const fechar = () => {
    document.removeEventListener("keydown", tecla);
    el.remove();
    lightboxAtual = null;
    if (!$(".modal-fundo")) document.body.classList.remove("sem-rolagem");
  };
  lightboxAtual = fechar;

  const tecla = (e) => {
    if ($(".modal-fundo")) return;
    if (e.key === "Escape") fechar();
    if (e.key === "ArrowLeft") ir(-1);
    if (e.key === "ArrowRight") ir(1);
  };
  document.addEventListener("keydown", tecla);

  let toqueX = null;
  el.addEventListener("touchstart", (e) => (toqueX = e.touches[0].clientX), { passive: true });
  el.addEventListener("touchend", (e) => {
    if (toqueX === null) return;
    const dx = e.changedTouches[0].clientX - toqueX;
    if (Math.abs(dx) > 60) ir(dx < 0 ? 1 : -1);
    toqueX = null;
  });

  el.addEventListener("click", async (e) => {
    const acao = e.target.closest("[data-lb]")?.dataset.lb;
    const m = itens[i];
    if (!acao) {
      if (e.target === el || e.target === palco) fechar();
      return;
    }
    if (acao === "fechar") return fechar();
    if (acao === "ant") return ir(-1);
    if (acao === "prox") return ir(1);
    try {
      if (acao === "baixar") {
        const u = await urlsMidias(slug, [m.midia_id], "original", true);
        const a = document.createElement("a");
        a.href = u[m.midia_id];
        a.rel = "noopener";
        document.body.append(a);
        a.click();
        a.remove();
      }
      if (acao === "denunciar") denunciar(slug, m.midia_id);
      if (acao === "excluir") {
        const ok = await confirmar({ titulo: "Excluir esta mídia?", texto: "Ela deixa de aparecer no álbum e na galeria do evento.", rotulo: "Excluir", perigo: true });
        if (!ok) return;
        const feito = await excluirPropriaMidia(sessao.id, sessao.codigo, m.midia_id);
        if (!feito) return toast("Não foi possível confirmar sua autorização para excluir.", "erro");
        toast("Mídia excluída.", "ok");
        fechar();
        aoExcluir?.();
      }
    } catch (erro) {
      toast(traduzirErro(erro), "erro");
    }
  });

  mostrar();
}

function denunciar(slug, midiaId) {
  const m = abrirModal(`<h2>Denunciar mídia</h2><p class="suave">Conte brevemente o motivo. O administrador do evento vai analisar.</p>
    <form class="formulario" id="form-denuncia"><textarea name="motivo" rows="3" maxlength="500" required placeholder="Ex.: conteúdo inadequado"></textarea>
    <div class="acoes"><button type="button" class="btn" data-fechar>Cancelar</button><button class="btn btn-principal" type="submit">Enviar denúncia</button></div></form>`);
  $("#form-denuncia", m.el).onsubmit = async (e) => {
    e.preventDefault();
    try {
      await denunciarMidia(slug, midiaId, new FormData(e.target).get("motivo"));
      m.fechar();
      toast("Denúncia enviada. Obrigado.", "ok");
    } catch (erro) {
      toast(traduzirErro(erro), "erro");
    }
  };
}

/* ============================================================
   Participação: entrar e recuperar
   ============================================================ */
const AVISO_LINK = `Qualquer pessoa com o link pode acessar este evento, e o link pode ser encaminhado a terceiros.`;

function entrar(slug, aoConcluir) {
  const m = abrirModal(`<h2>Como você quer aparecer?</h2>
    <p class="suave">Informe só o seu nome. Ele será exibido junto das suas fotos e vídeos. Não pedimos e-mail nem telefone.</p>
    <form class="formulario" id="form-entrar">
      <label>Seu nome<input name="nome" maxlength="60" required autocomplete="given-name" placeholder="Ex.: Ana"></label>
      <p class="aviso pequeno">${AVISO_LINK}</p>
      <div class="acoes"><button type="button" class="btn" data-fechar>Cancelar</button><button class="btn btn-principal" type="submit">Continuar</button></div>
    </form>`);
  $("#form-entrar", m.el).onsubmit = async (e) => {
    e.preventDefault();
    const botao = $("button[type=submit]", e.target);
    botao.disabled = true;
    try {
      const nome = new FormData(e.target).get("nome").trim();
      const r = await entrarNoEvento(slug, nome);
      const sessao = { id: r.novo_participante_id, codigo: r.codigo_acesso, nome };
      salvarSessao(slug, sessao);
      m.fechar();
      mostrarCodigo(sessao, aoConcluir);
    } catch (erro) {
      toast(traduzirErro(erro), "erro");
      botao.disabled = false;
    }
  };
}

function mostrarCodigo(sessao, aoConcluir) {
  const codigoCompleto = `${sessao.id}.${sessao.codigo}`;
  const m = abrirModal(
    `<h2>Guarde seu código</h2>
    <p class="suave">Ele permite recuperar seu álbum e excluir suas mídias se você trocar de aparelho ou limpar o navegador. Anote ou copie agora.</p>
    <div class="codigo">${esc(codigoCompleto)}</div>
    <div class="acoes"><button class="btn" id="copiar-codigo">${icone("copiar", 18)} Copiar código</button><button class="btn btn-principal" data-fechar>Já guardei</button></div>`,
    { aoFechar: () => aoConcluir?.() }
  );
  $("#copiar-codigo", m.el).onclick = async () => toast((await copiarTexto(codigoCompleto)) ? "Código copiado." : "Não foi possível copiar.", "ok");
}

function recuperar(slug, aoConcluir) {
  const m = abrirModal(`<h2>Recuperar minha participação</h2>
    <p class="suave">Cole o código que foi mostrado quando você entrou no evento.</p>
    <form class="formulario" id="form-recuperar">
      <label>Código de acesso<input name="codigo" required autocomplete="off" spellcheck="false"></label>
      <div class="acoes"><button type="button" class="btn" data-fechar>Cancelar</button><button class="btn btn-principal" type="submit">Recuperar</button></div>
    </form>`);
  $("#form-recuperar", m.el).onsubmit = async (e) => {
    e.preventDefault();
    const bruto = new FormData(e.target).get("codigo").trim();
    const [id, codigo] = bruto.split(".");
    try {
      const nome = id && codigo ? await recuperarParticipacao(slug, id, codigo) : null;
      if (!nome) return toast("Código não reconhecido. Confira e tente de novo.", "erro");
      salvarSessao(slug, { id, codigo, nome });
      m.fechar();
      toast(`Bem-vindo de volta, ${nome}.`, "ok");
      aoConcluir?.();
    } catch (erro) {
      toast(traduzirErro(erro), "erro");
    }
  };
}

/* ============================================================
   Página inicial do evento
   ============================================================ */
export async function eventoHome(_ctx, slug) {
  carregando();
  let ev, participantes;
  try {
    [ev, participantes] = await Promise.all([eventoPublico(slug), listarParticipantes(slug)]);
  } catch (e) {
    return mensagemTela("Não foi possível abrir o evento", traduzirErro(e), `<button class="btn" onclick="location.reload()">Tentar de novo</button>`);
  }
  if (!ev) return mensagemTela("Evento não encontrado", "Confira se o link está completo ou peça um novo ao organizador.");

  const sessao = lerSessao(slug);
  const meusDados = sessao ? participantes.find((p) => p.participante_id === sessao.id) : null;

  const cartoes = participantes
    .map(
      (p) => `<a class="cartao participante" href="#/e/${slug}/album/${p.participante_id}">
      <span class="avatar" aria-hidden="true">${esc(p.nome_publico.trim().charAt(0).toUpperCase())}</span>
      <span><strong>${esc(p.nome_publico)}</strong><small>${p.total_midias} ${Number(p.total_midias) === 1 ? "memória" : "memórias"}</small></span></a>`
    )
    .join("");

  app().innerHTML = `${cabecalho()}
  <main>
    <section class="capa" id="capa"><div class="capa-veu"></div>
      <div class="contido capa-conteudo">
        <span class="etiqueta etiqueta-clara">${esc(TIPOS_EVENTO[ev.tipo] || "Evento")}${ev.data_evento ? ` · ${formatarData(ev.data_evento)}` : ""}</span>
        <h1>${esc(ev.nome)}</h1>
        ${ev.descricao ? `<p class="lead">${esc(ev.descricao)}</p>` : ""}
        <div class="acoes">
          ${ev.recebimento_aberto ? `<button class="btn btn-principal btn-grande" data-acao="compartilhar">${icone("camera", 20)} Compartilhar suas fotos</button>` : ""}
          <a class="btn btn-grande btn-claro" href="#/e/${slug}/galeria">Ver todas as memórias</a>
        </div>
      </div>
    </section>

    <div class="contido">
      ${!ev.recebimento_aberto ? `<div class="aviso aviso-neutro">Os envios deste evento foram encerrados. Você ainda pode ver todas as memórias.</div>` : ""}
      ${
        sessao
          ? `<div class="cartao faixa-participante"><span>Você participa como <strong>${esc(sessao.nome)}</strong></span>
             <span class="faixa-acoes">${meusDados ? `<a href="#/e/${slug}/album/${sessao.id}">Meu álbum</a>` : ""}<button class="link" data-acao="codigo">Ver meu código</button><button class="link" data-acao="sair">Não sou eu</button></span></div>`
          : `<p class="pequeno suave centro-texto">Já participou antes neste aparelho ou em outro? <button class="link" data-acao="recuperar">Recuperar minha participação</button></p>`
      }

      <section class="secao-curta">
        <h2>Álbuns dos participantes</h2>
        ${participantes.length ? `<div class="grade-participantes">${cartoes}</div>` : `<div class="vazio cartao"><p class="suave">Ninguém entrou ainda. Seja a primeira pessoa a compartilhar.</p></div>`}
      </section>
      <p class="aviso pequeno">${AVISO_LINK}</p>
    </div>
  </main>${rodape()}`;

  // capa: usa a foto mais recente como fundo, se existir
  listarGaleria(slug, 12, null)
    .then(async (itens) => {
      const foto = itens.find((m) => m.tipo === "foto");
      if (!foto) return;
      const u = await urlsMidias(slug, [foto.midia_id], "miniatura");
      if (u[foto.midia_id]) $("#capa").style.backgroundImage = `url("${u[foto.midia_id]}")`;
    })
    .catch(() => {});

  const irEnviar = () => (location.hash = `#/e/${slug}/enviar`);
  app().onclick = (e) => {
    const acao = e.target.closest("[data-acao]")?.dataset.acao;
    if (acao === "compartilhar") lerSessao(slug) ? irEnviar() : entrar(slug, irEnviar);
    if (acao === "recuperar") recuperar(slug, () => eventoHome(_ctx, slug));
    if (acao === "sair") {
      removerSessao(slug);
      eventoHome(_ctx, slug);
    }
    if (acao === "codigo") mostrarCodigo(sessao);
  };
}

/* ============================================================
   Galeria coletiva e álbum individual
   ============================================================ */
export async function galeria(_ctx, slug) {
  carregando();
  const ev = await eventoPublico(slug).catch(() => null);
  if (!ev) return mensagemTela("Evento não encontrado", "Confira se o link está completo.");
  const sessao = lerSessao(slug);
  app().innerHTML = `${cabecalho(`<a class="btn btn-pequeno" href="#/e/${slug}">${icone("seta", 16)} ${esc(ev.nome)}</a>`)}
  <main class="contido">
    <div class="linha-entre cabeca-pagina"><div><h1>Todas as memórias</h1><p class="suave">${esc(ev.nome)}</p></div>
    ${ev.recebimento_aberto ? `<button class="btn btn-principal" data-acao="enviar">${icone("camera", 18)} Compartilhar</button>` : ""}</div>
    <div id="area-grade"></div>
  </main>${rodape()}`;
  app().onclick = (e) => {
    if (!e.target.closest("[data-acao=enviar]")) return;
    lerSessao(slug) ? (location.hash = `#/e/${slug}/enviar`) : entrar(slug, () => (location.hash = `#/e/${slug}/enviar`));
  };
  return montarGrade($("#area-grade"), {
    slug,
    sessao,
    buscar: (antes) => listarGaleria(slug, TAMANHO_PAGINA, antes),
    textoVazio: "Ainda não há memórias por aqui.",
  });
}

export async function album(_ctx, slug, participanteId) {
  carregando();
  const [ev, participantes] = await Promise.all([eventoPublico(slug).catch(() => null), listarParticipantes(slug).catch(() => [])]);
  const pessoa = participantes.find((p) => p.participante_id === participanteId);
  if (!ev || !pessoa) return mensagemTela("Álbum não encontrado", "Este álbum não existe ou o link está incompleto.", `<a class="btn" href="#/e/${slug}">Voltar ao evento</a>`);
  const sessao = lerSessao(slug);
  const meu = sessao?.id === participanteId;
  app().innerHTML = `${cabecalho(`<a class="btn btn-pequeno" href="#/e/${slug}">${icone("seta", 16)} ${esc(ev.nome)}</a>`)}
  <main class="contido">
    <div class="linha-entre cabeca-pagina"><div><span class="etiqueta">Álbum${meu ? " · seu álbum" : ""}</span><h1>${esc(pessoa.nome_publico)}</h1>
    <p class="suave">${pessoa.total_midias} ${Number(pessoa.total_midias) === 1 ? "memória" : "memórias"}</p></div>
    ${meu && ev.recebimento_aberto ? `<a class="btn btn-principal" href="#/e/${slug}/enviar">${icone("camera", 18)} Enviar mais</a>` : ""}</div>
    <div id="area-grade"></div>
  </main>${rodape()}`;
  return montarGrade($("#area-grade"), {
    slug,
    sessao,
    mostrarNome: false,
    buscar: (antes) => listarAlbum(slug, participanteId, TAMANHO_PAGINA, antes),
    textoVazio: "Este álbum ainda não tem memórias.",
  });
}
