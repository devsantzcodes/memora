import QRCode from "https://esm.sh/qrcode@1.5.4";
import { supabase, funcao, traduzirErro, urlPublica } from "./api.js";
import {
  app, $, esc, icone, cabecalho, rodape, carregando, mensagemTela, toast, abrirModal, confirmar,
  copiarTexto, formatarBytes, formatarData, TIPOS_EVENTO,
} from "./ui.js";

/* ---------- Proteção da área (a proteção real está no servidor, via RLS) ---------- */
async function exigirAdmin() {
  const { data } = await supabase.auth.getSession();
  if (!data.session) {
    location.hash = "#/admin/login";
    return false;
  }
  const { data: ehAdmin, error } = await supabase.rpc("eh_admin");
  if (error || !ehAdmin) {
    await supabase.auth.signOut();
    location.hash = "#/admin/login";
    return false;
  }
  return true;
}

async function sair() {
  await supabase.auth.signOut();
  location.hash = "#/admin/login";
}

/* ---------- Login ---------- */
export async function adminLogin() {
  const { data } = await supabase.auth.getSession();
  if (data.session && (await supabase.rpc("eh_admin")).data) {
    location.hash = "#/admin";
    return;
  }
  app().innerHTML = `${cabecalho()}
  <main class="contido muito-estreito">
    <h1>Área do administrador</h1>
    <p class="suave">Entre para criar e gerenciar seus eventos.</p>
    <form id="form-login" class="cartao formulario">
      <label>E-mail<input type="email" name="email" autocomplete="username" required></label>
      <label>Senha<input type="password" name="senha" autocomplete="current-password" required></label>
      <p class="erro-texto" id="erro-login" role="alert" hidden></p>
      <button class="btn btn-principal btn-grande" type="submit">Entrar</button>
    </form>
  </main>`;
  $("#form-login").onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const botao = $("button", e.target);
    botao.disabled = true;
    const erro = $("#erro-login");
    erro.hidden = true;
    const { error } = await supabase.auth.signInWithPassword({ email: f.get("email").trim(), password: f.get("senha") });
    if (error) {
      erro.textContent = "E-mail ou senha incorretos.";
      erro.hidden = false;
      botao.disabled = false;
      return;
    }
    const { data: ehAdmin } = await supabase.rpc("eh_admin");
    if (!ehAdmin) {
      await supabase.auth.signOut();
      erro.textContent = "Esta conta não tem permissão de administrador.";
      erro.hidden = false;
      botao.disabled = false;
      return;
    }
    location.hash = "#/admin";
  };
}

/* ---------- Painel ---------- */
const barraAdmin = () => `<button class="btn btn-pequeno" data-acao="sair">Sair</button>`;

export async function adminPainel() {
  if (!(await exigirAdmin())) return;
  carregando();
  const [ev, est] = await Promise.all([
    supabase.from("eventos").select("*").order("criado_em", { ascending: false }),
    supabase.from("estatisticas_evento").select("*"),
  ]);
  if (ev.error) return mensagemTela("Não foi possível carregar", traduzirErro(ev.error), `<a class="btn" href="#/admin">Tentar de novo</a>`);
  const stats = Object.fromEntries((est.data || []).map((s) => [s.evento_id, s]));

  const cartoes = ev.data
    .map((e) => {
      const s = stats[e.id] || {};
      return `<a class="cartao evento-cartao" href="#/admin/evento/${e.id}">
        <div class="linha-entre"><span class="etiqueta">${esc(TIPOS_EVENTO[e.tipo] || "Outro")}</span>
        <span class="selo ${e.recebimento_aberto ? "ok" : "neutro"}">${e.recebimento_aberto ? "Recebendo" : "Encerrado"}</span></div>
        <h3>${esc(e.nome)}</h3>
        <p class="suave pequeno">${e.data_evento ? formatarData(e.data_evento) : "Sem data definida"}</p>
        <p class="pequeno">${s.total_fotos ?? 0} fotos · ${s.total_videos ?? 0} vídeos · ${s.total_participantes ?? 0} participantes</p>
      </a>`;
    })
    .join("");

  app().innerHTML = `${cabecalho(barraAdmin())}
  <main class="contido">
    <div class="linha-entre cabeca-pagina">
      <div><h1>Seus eventos</h1><p class="suave">Crie, configure e modere os álbuns coletivos.</p></div>
      <button class="btn btn-principal" data-acao="criar">${icone("mais", 18)} Criar evento</button>
    </div>
    ${ev.data.length ? `<div class="grade-cartoes">${cartoes}</div>` : `<div class="vazio cartao"><h3>Nenhum evento ainda</h3><p class="suave">Crie o primeiro para gerar o link e o QR Code.</p></div>`}
  </main>${rodape()}`;

  app().onclick = (e) => {
    const acao = e.target.closest("[data-acao]")?.dataset.acao;
    if (acao === "sair") sair();
    if (acao === "criar") formularioEvento();
  };
}

function camposEvento(e = {}) {
  return `
    <label>Nome do evento<input name="nome" maxlength="120" required value="${esc(e.nome || "")}"></label>
    <label>Descrição (opcional)<textarea name="descricao" rows="3" maxlength="1000">${esc(e.descricao || "")}</textarea></label>
    <div class="duas-colunas">
      <label>Tipo<select name="tipo">${Object.entries(TIPOS_EVENTO)
        .map(([k, v]) => `<option value="${k}" ${e.tipo === k ? "selected" : ""}>${v}</option>`)
        .join("")}</select></label>
      <label>Data (opcional)<input type="date" name="data_evento" value="${esc(e.data_evento || "")}"></label>
    </div>`;
}

function lerCampos(form) {
  const f = new FormData(form);
  return {
    nome: f.get("nome").trim(),
    descricao: f.get("descricao").trim() || null,
    tipo: f.get("tipo"),
    data_evento: f.get("data_evento") || null,
  };
}

function formularioEvento() {
  const m = abrirModal(`<h2>Criar evento</h2>
    <form class="formulario" id="form-evento">${camposEvento()}
      <div class="acoes"><button type="button" class="btn" data-fechar>Cancelar</button><button class="btn btn-principal" type="submit">Criar evento</button></div>
    </form>`);
  $("#form-evento", m.el).onsubmit = async (e) => {
    e.preventDefault();
    const botao = $("button[type=submit]", e.target);
    botao.disabled = true;
    const { data, error } = await supabase.from("eventos").insert(lerCampos(e.target)).select().single();
    if (error) {
      toast(traduzirErro(error), "erro");
      botao.disabled = false;
      return;
    }
    m.fechar();
    toast("Evento criado.", "ok");
    location.hash = `#/admin/evento/${data.id}`;
  };
}

/* ---------- Página de um evento ---------- */
async function linksAdmin(midias) {
  const mapa = {};
  const lotes = [
    ["miniaturas", midias.filter((m) => m.caminho_miniatura), "caminho_miniatura"],
    ["originais", midias.filter((m) => !m.caminho_miniatura && m.tipo === "foto" && m.status === "publicada"), "caminho_original"],
  ];
  for (const [bucket, lista, campo] of lotes) {
    if (!lista.length) continue;
    const { data } = await supabase.storage.from(bucket).createSignedUrls(lista.map((m) => m[campo]), 3600);
    data?.forEach((d, i) => d.signedUrl && (mapa[lista[i].id] = d.signedUrl));
  }
  return mapa;
}

export async function adminEvento(_ctx, id) {
  if (!(await exigirAdmin())) return;
  carregando();

  async function desenhar() {
    const { data: ev } = await supabase.from("eventos").select("*").eq("id", id).maybeSingle();
    if (!ev) return mensagemTela("Evento não encontrado", "Ele pode ter sido excluído.", `<a class="btn" href="#/admin">Voltar ao painel</a>`);

    const [est, mid, den] = await Promise.all([
      supabase.from("estatisticas_evento").select("*").eq("evento_id", id).maybeSingle(),
      supabase
        .from("midias")
        .select("id,tipo,nome_original,tamanho_bytes,status,erro_processamento,caminho_original,caminho_miniatura,enviado_em,participantes(nome_publico)")
        .eq("evento_id", id)
        .in("status", ["publicada", "erro"])
        .order("enviado_em", { ascending: false })
        .limit(200),
      supabase.from("denuncias").select("*").eq("evento_id", id).eq("status", "aberta").order("criada_em", { ascending: false }),
    ]);
    const s = est.data || {};
    const midias = mid.data || [];
    const links = await linksAdmin(midias);
    const link = urlPublica(ev.slug_publico);
    const porId = Object.fromEntries(midias.map((m) => [m.id, m]));

    const tile = (m) => `<figure class="mod-tile ${m.status === "erro" ? "com-erro" : ""}">
      <div class="mod-img">${links[m.id] ? `<img src="${esc(links[m.id])}" alt="" loading="lazy">` : `<span class="tile-vazio">${icone(m.tipo === "video" ? "video" : "imagem", 28)}</span>`}
        ${m.tipo === "video" ? `<span class="tile-play">${icone("play", 16)}</span>` : ""}</div>
      <figcaption><strong>${esc(m.participantes?.nome_publico || "")}</strong>
        <span class="pequeno suave">${formatarBytes(m.tamanho_bytes)}${m.status === "erro" ? " · falhou no processamento" : ""}</span>
        <span class="mod-botoes"><button class="btn btn-pequeno" data-acao="abrir" data-id="${m.id}">${icone("olho", 16)} Original</button>
        <button class="btn btn-pequeno btn-perigo-suave" data-acao="remover" data-id="${m.id}">${icone("lixeira", 16)} Remover</button></span>
      </figcaption></figure>`;

    const denuncias = (den.data || [])
      .map((d) => {
        const m = porId[d.midia_id];
        return `<li class="denuncia"><div>${m && links[m.id] ? `<img src="${esc(links[m.id])}" alt="">` : `<span class="tile-vazio">${icone("bandeira", 22)}</span>`}</div>
          <div><p><strong>Motivo:</strong> ${esc(d.motivo)}</p><p class="pequeno suave">${formatarData(d.criada_em)}</p></div>
          <div class="mod-botoes">${m ? `<button class="btn btn-pequeno btn-perigo-suave" data-acao="remover" data-id="${m.id}">Remover mídia</button>` : ""}
          <button class="btn btn-pequeno" data-acao="dispensar" data-id="${d.id}">Dispensar</button></div></li>`;
      })
      .join("");

    app().innerHTML = `${cabecalho(`<a class="btn btn-pequeno" href="#/admin">Painel</a>${barraAdmin()}`)}
    <main class="contido">
      <div class="linha-entre cabeca-pagina">
        <div><span class="etiqueta">${esc(TIPOS_EVENTO[ev.tipo] || "Outro")}</span><h1>${esc(ev.nome)}</h1>
        <p class="suave">${ev.data_evento ? formatarData(ev.data_evento) : "Sem data definida"}${ev.descricao ? ` · ${esc(ev.descricao)}` : ""}</p></div>
        <span class="selo ${ev.recebimento_aberto ? "ok" : "neutro"}">${ev.recebimento_aberto ? "Recebendo envios" : "Envios encerrados"}</span>
      </div>

      <section class="indicadores">
        <div class="cartao"><strong>${s.total_fotos ?? 0}</strong><span>Fotos</span></div>
        <div class="cartao"><strong>${s.total_videos ?? 0}</strong><span>Vídeos</span></div>
        <div class="cartao"><strong>${s.total_participantes ?? 0}</strong><span>Participantes</span></div>
        <div class="cartao"><strong>${formatarBytes(s.bytes_utilizados)}</strong><span>Espaço usado</span></div>
      </section>

      <section class="cartao bloco">
        <h2>Link público</h2>
        <p class="suave">Qualquer pessoa com este link pode ver o evento e enviar fotos. Ele pode ser encaminhado a terceiros.</p>
        <div class="campo-link"><input readonly value="${esc(link)}" aria-label="Link público"><button class="btn" data-acao="copiar">${icone("copiar", 18)} Copiar</button></div>
        <div class="acoes"><button class="btn" data-acao="qr">${icone("qr", 18)} Ver QR Code</button>
        <a class="btn" href="${esc(link)}" target="_blank" rel="noopener">${icone("link", 18)} Abrir como convidado</a></div>
      </section>

      <section class="cartao bloco">
        <h2>Recebimento de mídias</h2>
        <p class="suave">${ev.recebimento_aberto ? "Os convidados podem enviar novas fotos e vídeos." : "O evento continua disponível para consulta, mas não aceita novos envios."}</p>
        <button class="btn ${ev.recebimento_aberto ? "" : "btn-principal"}" data-acao="alternar">${ev.recebimento_aberto ? "Encerrar envios" : "Reabrir envios"}</button>
      </section>

      ${denuncias ? `<section class="cartao bloco"><h2>Denúncias abertas</h2><ul class="lista-denuncias">${denuncias}</ul></section>` : ""}

      <section class="bloco">
        <div class="linha-entre"><h2>Moderação</h2><button class="btn btn-pequeno" data-acao="atualizar">${icone("atualizar", 16)} Atualizar</button></div>
        ${midias.length ? `<div class="grade-mod">${midias.map(tile).join("")}</div>${midias.length >= 200 ? `<p class="suave pequeno">Mostrando as 200 mídias mais recentes.</p>` : ""}` : `<div class="vazio cartao"><p class="suave">Nenhuma mídia enviada ainda.</p></div>`}
      </section>

      <section class="cartao bloco">
        <details><summary>Editar informações do evento</summary>
          <form class="formulario" id="form-editar">${camposEvento(ev)}<div class="acoes"><button class="btn btn-principal" type="submit">Salvar alterações</button></div></form>
        </details>
      </section>

      <section class="cartao bloco zona-perigo">
        <h2>Excluir evento</h2>
        <p class="suave">Remove o evento, os álbuns e todos os arquivos de forma definitiva. Não é possível desfazer.</p>
        <button class="btn btn-perigo" data-acao="excluir">Excluir evento</button>
      </section>
    </main>${rodape()}`;

    $("#form-editar").onsubmit = async (e) => {
      e.preventDefault();
      const { error } = await supabase.from("eventos").update(lerCampos(e.target)).eq("id", id);
      if (error) return toast(traduzirErro(error), "erro");
      toast("Alterações salvas.", "ok");
      desenhar();
    };

    app().onclick = async (e) => {
      const alvo = e.target.closest("[data-acao]");
      if (!alvo) return;
      const { acao, id: alvoId } = alvo.dataset;
      try {
        if (acao === "sair") return sair();
        if (acao === "atualizar") return desenhar();
        if (acao === "copiar") return toast((await copiarTexto(link)) ? "Link copiado." : "Não foi possível copiar.", "ok");
        if (acao === "qr") return mostrarQr(link, ev.nome);
        if (acao === "alternar") {
          const { error } = await supabase.from("eventos").update({ recebimento_aberto: !ev.recebimento_aberto }).eq("id", id);
          if (error) throw error;
          toast(ev.recebimento_aberto ? "Envios encerrados." : "Envios reabertos.", "ok");
          return desenhar();
        }
        if (acao === "abrir") {
          const m = porId[alvoId];
          const { data, error } = await supabase.storage.from("originais").createSignedUrl(m.caminho_original, 600);
          if (error) throw error;
          return window.open(data.signedUrl, "_blank", "noopener");
        }
        if (acao === "remover") {
          if (!(await confirmar({ titulo: "Remover esta mídia?", texto: "Ela some das galerias e o arquivo é apagado definitivamente.", rotulo: "Remover", perigo: true }))) return;
          const { error } = await supabase.from("midias").update({ status: "removida", removida_em: new Date().toISOString() }).eq("id", alvoId);
          if (error) throw error;
          await funcao("admin_purgar", { midia_id: alvoId }, { admin: true });
          toast("Mídia removida.", "ok");
          return desenhar();
        }
        if (acao === "dispensar") {
          const { error } = await supabase.from("denuncias").update({ status: "resolvida" }).eq("id", alvoId);
          if (error) throw error;
          return desenhar();
        }
        if (acao === "excluir") return excluirEvento(ev);
      } catch (erro) {
        toast(traduzirErro(erro), "erro");
      }
    };
  }
  await desenhar();
}

async function mostrarQr(link, nome) {
  const png = await QRCode.toDataURL(link, { width: 640, margin: 2, color: { dark: "#2a2521", light: "#ffffff" } });
  abrirModal(`<h2>QR Code do evento</h2><p class="suave">${esc(nome)}</p>
    <div class="qr"><img src="${png}" alt="QR Code com o link do evento"></div>
    <div class="acoes"><button class="btn" data-fechar>Fechar</button><a class="btn btn-principal" href="${png}" download="qrcode-evento.png">${icone("baixar", 18)} Baixar imagem</a></div>`, { classe: "centro-texto" });
}

function excluirEvento(ev) {
  const m = abrirModal(`<h2>Excluir "${esc(ev.nome)}"?</h2>
    <p class="suave">Todas as fotos, vídeos e álbuns serão apagados definitivamente. Para confirmar, digite o nome do evento:</p>
    <form class="formulario" id="form-excluir"><input name="conf" autocomplete="off" aria-label="Nome do evento para confirmar" placeholder="${esc(ev.nome)}">
    <div class="acoes"><button type="button" class="btn" data-fechar>Cancelar</button><button class="btn btn-perigo" type="submit" disabled>Excluir definitivamente</button></div></form>`);
  const botao = $("button[type=submit]", m.el);
  $("input", m.el).oninput = (e) => (botao.disabled = e.target.value.trim() !== ev.nome.trim());
  $("#form-excluir", m.el).onsubmit = async (e) => {
    e.preventDefault();
    botao.disabled = true;
    botao.textContent = "Excluindo…";
    try {
      await funcao("admin_excluir_evento", { evento_id: ev.id }, { admin: true });
      m.fechar();
      toast("Evento excluído.", "ok");
      location.hash = "#/admin";
    } catch (erro) {
      toast(traduzirErro(erro), "erro");
      botao.disabled = false;
      botao.textContent = "Excluir definitivamente";
    }
  };
}
