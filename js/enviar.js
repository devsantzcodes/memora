import { CONFIG } from "./config.js";
import { eventoPublico, lerSessao, funcao, traduzirErro } from "./api.js";
import { app, $, esc, icone, cabecalho, rodape, carregando, mensagemTela, toast, formatarBytes } from "./ui.js";

const TIPO_POR_MIME = {
  "image/jpeg": "foto", "image/png": "foto", "image/webp": "foto", "image/heic": "foto", "image/heif": "foto",
  "video/mp4": "video", "video/quicktime": "video", "video/webm": "video",
};
const MIME_POR_EXTENSAO = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", heic: "image/heic", heif: "image/heif",
  mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm",
};
const SIMULTANEOS = 2;

function detectarMime(arquivo) {
  let t = (arquivo.type || "").toLowerCase();
  if (t === "image/jpg") t = "image/jpeg";
  if (TIPO_POR_MIME[t]) return t;
  const ext = arquivo.name.split(".").pop().toLowerCase();
  return MIME_POR_EXTENSAO[ext] || t;
}

/* ---------- Leitura local: duração e miniatura (o original nunca é alterado) ---------- */
function lerDuracao(arquivo) {
  return new Promise((ok, falha) => {
    const v = document.createElement("video");
    const url = URL.createObjectURL(arquivo);
    const fim = (fn, valor) => {
      clearTimeout(t);
      URL.revokeObjectURL(url);
      fn(valor);
    };
    const t = setTimeout(() => fim(falha, new Error("tempo")), 10000);
    v.preload = "metadata";
    v.muted = true;
    v.onloadedmetadata = () => (Number.isFinite(v.duration) ? fim(ok, v.duration) : fim(falha, new Error("duracao")));
    v.onerror = () => fim(falha, new Error("leitura"));
    v.src = url;
  });
}

function desenhar(fonte, largura, altura) {
  const fator = Math.min(1, 480 / Math.max(largura, altura));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(largura * fator));
  c.height = Math.max(1, Math.round(altura * fator));
  c.getContext("2d").drawImage(fonte, 0, 0, c.width, c.height);
  return c;
}
const paraJpeg = (canvas) => new Promise((r) => canvas.toBlob((b) => r(b), "image/jpeg", 0.8));

async function miniaturaFoto(arquivo) {
  const bmp = await createImageBitmap(arquivo, { imageOrientation: "from-image" });
  const blob = await paraJpeg(desenhar(bmp, bmp.width, bmp.height));
  bmp.close?.();
  return blob;
}

function miniaturaVideo(arquivo) {
  return new Promise((ok, falha) => {
    const v = document.createElement("video");
    const url = URL.createObjectURL(arquivo);
    const fim = () => {
      clearTimeout(t);
      URL.revokeObjectURL(url);
    };
    const t = setTimeout(() => {
      fim();
      falha(new Error("tempo"));
    }, 10000);
    v.muted = true;
    v.playsInline = true;
    v.preload = "auto";
    v.onloadeddata = () => (v.currentTime = Math.min(0.5, (v.duration || 1) / 2));
    v.onseeked = async () => {
      try {
        ok(await paraJpeg(desenhar(v, v.videoWidth, v.videoHeight)));
      } catch (e) {
        falha(e);
      } finally {
        fim();
      }
    };
    v.onerror = () => {
      fim();
      falha(new Error("leitura"));
    };
    v.src = url;
  });
}

/* ---------- Envio com progresso (arquivo original, sem recompressão) ---------- */
function enviarComProgresso(url, blob, aoProgresso = () => {}) {
  return new Promise((ok, falha) => {
    const x = new XMLHttpRequest();
    x.open("PUT", url);
    x.setRequestHeader("apikey", CONFIG.SUPABASE_ANON_KEY);
    x.setRequestHeader("Authorization", `Bearer ${CONFIG.SUPABASE_ANON_KEY}`);
    x.upload.onprogress = (e) => e.lengthComputable && aoProgresso(e.loaded / e.total);
    x.onload = () => (x.status >= 200 && x.status < 300 ? ok() : falha(new Error(`http_${x.status}`)));
    x.onerror = () => falha(new Error("network"));
    x.ontimeout = () => falha(new Error("network"));
    const form = new FormData();
    form.append("cacheControl", "3600");
    form.append("", blob);
    x.send(form);
  });
}

/* ============================================================
   Tela
   ============================================================ */
export async function enviar(_ctx, slug) {
  carregando();
  const ev = await eventoPublico(slug).catch(() => null);
  if (!ev) return mensagemTela("Evento não encontrado", "Confira se o link está completo.");
  const sessao = lerSessao(slug);
  if (!sessao) {
    location.hash = `#/e/${slug}`;
    return;
  }
  if (!ev.recebimento_aberto) {
    return mensagemTela("Envios encerrados", "Este evento não aceita novos envios, mas você pode ver as memórias.", `<a class="btn btn-principal" href="#/e/${slug}/galeria">Ver memórias</a>`);
  }

  const itens = [];
  let ativos = 0;
  let contador = 0;

  app().innerHTML = `${cabecalho(`<a class="btn btn-pequeno" href="#/e/${slug}">${icone("seta", 16)} ${esc(ev.nome)}</a>`)}
  <main class="contido estreito">
    <h1>Compartilhar suas fotos</h1>
    <p class="suave">Enviando como <strong>${esc(sessao.nome)}</strong>. Os arquivos originais são guardados sem perder qualidade.</p>

    <div class="escolhas">
      <label class="escolha principal">${icone("imagem", 26)}<span>Escolher fotos e vídeos</span>
        <input type="file" id="in-galeria" accept="image/*,video/*,.heic,.heif" multiple hidden></label>
      <label class="escolha">${icone("camera", 26)}<span>Tirar foto</span>
        <input type="file" id="in-foto" accept="image/*" capture="environment" hidden></label>
      <label class="escolha">${icone("video", 26)}<span>Gravar vídeo</span>
        <input type="file" id="in-video" accept="video/*" capture="environment" hidden></label>
    </div>
    <p class="pequeno suave">Vídeos de até ${CONFIG.LIMITE_VIDEO_SEGUNDOS} segundos. Cada arquivo pode ter até ${CONFIG.LIMITE_ARQUIVO_MB} MB. A câmera só abre quando você toca em um dos botões.</p>

    <ul class="fila" id="fila" aria-live="polite"></ul>
    <div class="acoes" id="rodape-fila" hidden>
      <a class="btn" href="#/e/${slug}/galeria">Ver todas as memórias</a>
      <a class="btn btn-principal" href="#/e/${slug}/album/${sessao.id}">Ver meu álbum</a>
    </div>
  </main>${rodape()}`;

  const fila = $("#fila");

  function desenharItem(item) {
    let li = document.getElementById(`item-${item.id}`);
    if (!li) {
      li = document.createElement("li");
      li.id = `item-${item.id}`;
      fila.prepend(li);
    }
    const rotulos = { validando: "Verificando…", fila: "Na fila", enviando: `Enviando ${item.progresso}%`, concluido: "Enviado", erro: item.erro };
    li.className = `item ${item.estado}`;
    li.innerHTML = `<div class="item-previa">${
      item.tipo === "video"
        ? `<video src="${item.previa}" muted playsinline preload="metadata"></video>`
        : `<img src="${item.previa}" alt="" onerror="this.replaceWith(document.createTextNode('📷'))">`
    }</div>
      <div class="item-corpo"><strong class="item-nome">${esc(item.arquivo.name)}</strong>
        <span class="pequeno ${item.estado === "erro" ? "erro-texto" : "suave"}">${formatarBytes(item.arquivo.size)} · ${esc(rotulos[item.estado])}</span>
        ${item.estado === "enviando" || item.estado === "fila" ? `<div class="barra"><span style="width:${item.progresso}%"></span></div>` : ""}</div>
      <div class="item-acoes">
        ${item.estado === "concluido" ? `<span class="ok-icone">${icone("check", 22)}</span>` : ""}
        ${item.estado === "erro" && item.podeRepetir ? `<button class="btn btn-pequeno" data-retentar="${item.id}">Tentar de novo</button>` : ""}
        ${item.estado === "erro" || item.estado === "fila" ? `<button class="btn-icone" data-remover="${item.id}" aria-label="Remover da lista">${icone("x", 18)}</button>` : ""}
      </div>`;
    $("#rodape-fila").hidden = !itens.some((i) => i.estado === "concluido");
  }

  async function preparar(arquivo) {
    const item = {
      id: ++contador, arquivo, estado: "validando", progresso: 0, erro: "", podeRepetir: false,
      mime: detectarMime(arquivo), chave: crypto.randomUUID(), duracao: null, miniatura: null,
      previa: URL.createObjectURL(arquivo),
    };
    item.tipo = TIPO_POR_MIME[item.mime] || "foto";
    itens.push(item);
    desenharItem(item);

    const recusar = (msg) => {
      item.estado = "erro";
      item.erro = msg;
      desenharItem(item);
    };

    if (!TIPO_POR_MIME[item.mime]) return recusar("Tipo de arquivo não permitido. Use fotos (JPG, PNG, WebP, HEIC) ou vídeos (MP4, MOV, WebM).");
    if (arquivo.size <= 0) return recusar("O arquivo está vazio.");
    if (arquivo.size > CONFIG.LIMITE_ARQUIVO_MB * 1024 * 1024) return recusar(`O arquivo passa do limite de ${CONFIG.LIMITE_ARQUIVO_MB} MB.`);

    if (item.tipo === "video") {
      try {
        item.duracao = await lerDuracao(arquivo);
      } catch {
        return recusar("Não foi possível verificar a duração do vídeo neste aparelho.");
      }
      if (item.duracao > CONFIG.LIMITE_VIDEO_SEGUNDOS) return recusar(`O vídeo tem ${Math.round(item.duracao)} segundos. O máximo é ${CONFIG.LIMITE_VIDEO_SEGUNDOS}.`);
    }

    try {
      item.miniatura = item.tipo === "video" ? await miniaturaVideo(arquivo) : await miniaturaFoto(arquivo);
    } catch {
      item.miniatura = null; // a galeria usa o arquivo original quando não há miniatura
    }

    item.estado = "fila";
    desenharItem(item);
    bombear();
  }

  async function processar(item) {
    item.estado = "enviando";
    item.progresso = 0;
    desenharItem(item);
    try {
      const base = { slug, participante_id: sessao.id, codigo: sessao.codigo };
      const r = await funcao("criar_envio", {
        ...base, nome_original: item.arquivo.name, mime: item.mime, tamanho: item.arquivo.size, duracao: item.duracao, chave: item.chave,
      });
      if (r.ja_publicada) {
        item.estado = "concluido";
        return;
      }
      await enviarComProgresso(r.upload_original.signedUrl, item.arquivo.slice(0, item.arquivo.size, item.mime), (p) => {
        item.progresso = Math.min(95, Math.round(p * 95));
        desenharItem(item);
      });
      let temMiniatura = false;
      if (item.miniatura && r.upload_miniatura) {
        try {
          await enviarComProgresso(r.upload_miniatura.signedUrl, item.miniatura);
          temMiniatura = true;
        } catch {}
      }
      const f = await funcao("finalizar_envio", { ...base, midia_id: r.midia_id, tem_miniatura: temMiniatura });
      if (!f.ok) throw Object.assign(new Error(f.erro || "arquivo_invalido"), { erro: f.erro || "arquivo_invalido", definitivo: true });
      item.progresso = 100;
      item.estado = "concluido";
    } catch (e) {
      item.estado = "erro";
      item.erro = traduzirErro(e);
      item.podeRepetir = !e.definitivo && !["evento_encerrado", "capacidade_esgotada", "tipo_nao_permitido", "arquivo_muito_grande", "video_muito_longo"].includes(e.erro);
    }
    desenharItem(item);
  }

  function bombear() {
    while (ativos < SIMULTANEOS) {
      const proximo = itens.find((i) => i.estado === "fila");
      if (!proximo) break;
      ativos++;
      processar(proximo).finally(() => {
        ativos--;
        bombear();
      });
    }
  }

  const receber = (lista) => {
    const arquivos = [...lista];
    if (!arquivos.length) return;
    arquivos.forEach(preparar);
  };
  ["in-galeria", "in-foto", "in-video"].forEach((idCampo) => {
    $(`#${idCampo}`).onchange = (e) => {
      receber(e.target.files);
      e.target.value = "";
    };
  });

  app().onclick = (e) => {
    const r = e.target.closest("[data-retentar]");
    const x = e.target.closest("[data-remover]");
    if (r) {
      const item = itens.find((i) => i.id === Number(r.dataset.retentar));
      item.estado = "fila";
      item.erro = "";
      desenharItem(item);
      bombear();
    }
    if (x) {
      const idx = itens.findIndex((i) => i.id === Number(x.dataset.remover));
      const [item] = itens.splice(idx, 1);
      URL.revokeObjectURL(item.previa);
      document.getElementById(`item-${item.id}`)?.remove();
    }
  };

  const avisarSaida = (e) => {
    if (ativos > 0 || itens.some((i) => i.estado === "fila" || i.estado === "validando")) {
      e.preventDefault();
      e.returnValue = "";
    }
  };
  window.addEventListener("beforeunload", avisarSaida);
  return () => {
    window.removeEventListener("beforeunload", avisarSaida);
    itens.forEach((i) => URL.revokeObjectURL(i.previa));
  };
}
