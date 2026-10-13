import { CONFIG } from "./config.js";

import { eventoPublico, lerSessao, funcao, traduzirErro } from "./api.js";

import {
  app,
  $,
  esc,
  icone,
  cabecalho,
  rodape,
  carregando,
  mensagemTela,
  toast,
  formatarBytes,
} from "./ui.js";

const TIPO_POR_MIME = {
  "image/jpeg": "foto",
  "image/png": "foto",
  "image/webp": "foto",
  "image/heic": "foto",
  "image/heif": "foto",
  "video/mp4": "video",
  "video/quicktime": "video",
  "video/webm": "video",
};

const MIME_POR_EXTENSAO = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
  heif: "image/heif",
  mp4: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
};

const SIMULTANEOS = 2;
const TEMPO_LIMITE_UPLOAD = 120000;

/* ============================================================
   Identificação do arquivo
   ============================================================ */

function detectarMime(arquivo) {
  let tipo = (arquivo.type || "").toLowerCase();

  if (tipo === "image/jpg") {
    tipo = "image/jpeg";
  }

  if (TIPO_POR_MIME[tipo]) {
    return tipo;
  }

  const extensao = arquivo.name.split(".").pop().toLowerCase();

  return MIME_POR_EXTENSAO[extensao] || tipo;
}

/* ============================================================
   Leitura local: duração e miniatura
   O arquivo original não é alterado.
   ============================================================ */

function lerDuracao(arquivo) {
  return new Promise((ok, falha) => {
    const video = document.createElement("video");
    const url = URL.createObjectURL(arquivo);

    let finalizado = false;

    const finalizar = (funcaoFinal, valor) => {
      if (finalizado) return;

      finalizado = true;
      clearTimeout(temporizador);
      video.removeAttribute("src");
      video.load();
      URL.revokeObjectURL(url);

      funcaoFinal(valor);
    };

    const temporizador = setTimeout(() => {
      finalizar(falha, new Error("tempo"));
    }, 10000);

    video.preload = "metadata";
    video.muted = true;

    video.onloadedmetadata = () => {
      if (Number.isFinite(video.duration) && video.duration > 0) {
        finalizar(ok, video.duration);
      } else {
        finalizar(falha, new Error("duracao"));
      }
    };

    video.onerror = () => {
      finalizar(falha, new Error("leitura"));
    };

    video.src = url;
  });
}

function desenhar(fonte, largura, altura) {
  const fator = Math.min(1, 480 / Math.max(largura, altura));

  const canvas = document.createElement("canvas");

  canvas.width = Math.max(1, Math.round(largura * fator));

  canvas.height = Math.max(1, Math.round(altura * fator));

  const contexto = canvas.getContext("2d");

  if (!contexto) {
    throw new Error("canvas_indisponivel");
  }

  contexto.drawImage(fonte, 0, 0, canvas.width, canvas.height);

  return canvas;
}

const paraJpeg = (canvas) =>
  new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error("miniatura_indisponivel"));
        }
      },
      "image/jpeg",
      0.8,
    );
  });

async function miniaturaFoto(arquivo) {
  if (typeof createImageBitmap !== "function") {
    throw new Error("miniatura_indisponivel");
  }

  const bitmap = await createImageBitmap(arquivo, {
    imageOrientation: "from-image",
  });

  try {
    return await paraJpeg(desenhar(bitmap, bitmap.width, bitmap.height));
  } finally {
    bitmap.close?.();
  }
}

function miniaturaVideo(arquivo) {
  return new Promise((ok, falha) => {
    const video = document.createElement("video");
    const url = URL.createObjectURL(arquivo);

    let finalizado = false;

    const finalizar = (funcaoFinal, valor) => {
      if (finalizado) return;

      finalizado = true;

      clearTimeout(temporizador);

      video.pause();
      video.removeAttribute("src");
      video.load();

      URL.revokeObjectURL(url);

      if (funcaoFinal) {
        funcaoFinal(valor);
      }
    };

    const temporizador = setTimeout(() => {
      finalizar(falha, new Error("tempo"));
    }, 10000);

    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";

    video.onloadeddata = () => {
      try {
        video.currentTime = Math.min(0.5, (video.duration || 1) / 2);
      } catch (erro) {
        finalizar(falha, erro);
      }
    };

    video.onseeked = async () => {
      try {
        const miniatura = await paraJpeg(
          desenhar(video, video.videoWidth, video.videoHeight),
        );

        finalizar(ok, miniatura);
      } catch (erro) {
        finalizar(falha, erro);
      }
    };

    video.onerror = () => {
      finalizar(falha, new Error("leitura"));
    };

    video.src = url;
  });
}

/* ============================================================
   Envio com progresso
   Envia o Blob diretamente para a URL assinada.
   ============================================================ */

function enviarComProgresso(url, blob, aoProgresso = () => {}) {
  return new Promise((ok, falha) => {
    if (!url || typeof url !== "string") {
      falha(new Error("url_upload_invalida"));
      return;
    }

    let destino;

    try {
      destino = new URL(url, window.location.href);
    } catch {
      falha(new Error("url_upload_invalida"));
      return;
    }

    if (
      destino.protocol !== "https:" &&
      destino.hostname !== "localhost" &&
      destino.hostname !== "127.0.0.1"
    ) {
      falha(new Error("url_upload_insegura"));
      return;
    }

    const requisicao = new XMLHttpRequest();

    requisicao.open("PUT", destino.href);
    requisicao.timeout = TEMPO_LIMITE_UPLOAD;

    requisicao.setRequestHeader(
      "Content-Type",
      blob.type || "application/octet-stream",
    );

    requisicao.upload.onprogress = (evento) => {
      if (evento.lengthComputable) {
        aoProgresso(evento.loaded / evento.total);
      }
    };

    requisicao.onload = () => {
      if (requisicao.status >= 200 && requisicao.status < 300) {
        ok();
        return;
      }

      const erro = new Error(`http_${requisicao.status}`);

      erro.status = requisicao.status;

      falha(erro);
    };

    requisicao.onerror = () => {
      falha(new Error("network"));
    };

    requisicao.ontimeout = () => {
      falha(new Error("network_timeout"));
    };

    requisicao.onabort = () => {
      falha(new Error("upload_cancelado"));
    };

    requisicao.send(blob);
  });
}

/* ============================================================
   Tela de envio
   ============================================================ */

export async function enviar(_ctx, slug) {
  carregando();

  const ev = await eventoPublico(slug).catch(() => null);

  if (!ev) {
    return mensagemTela(
      "Evento não encontrado",
      "Confira se o link está completo.",
    );
  }

  const sessao = lerSessao(slug);

  if (!sessao) {
    location.hash = `#/e/${slug}`;
    return;
  }

  if (!ev.recebimento_aberto) {
    return mensagemTela(
      "Envios encerrados",
      "Este evento não aceita novos envios, mas você pode ver as memórias.",
      `<a class="btn btn-principal" href="#/e/${slug}/galeria">Ver memórias</a>`,
    );
  }

  const itens = [];

  let ativos = 0;
  let contador = 0;
  let telaAtiva = true;

  app().innerHTML = `
    ${cabecalho(
      `<a class="btn btn-pequeno" href="#/e/${slug}">${icone(
        "seta",
        16,
      )} ${esc(ev.nome)}</a>`,
    )}

    <main class="contido estreito">
      <h1>Compartilhar suas fotos</h1>

      <p class="suave">
        Enviando como <strong>${esc(sessao.nome)}</strong>.
        Os arquivos originais são guardados sem perder qualidade.
      </p>

      <div class="escolhas">
        <label class="escolha principal">
          ${icone("imagem", 26)}
          <span>Escolher fotos e vídeos</span>
          <input
            type="file"
            id="in-galeria"
            accept="image/*,video/*,.heic,.heif"
            multiple
            hidden
          >
        </label>

        <label class="escolha">
          ${icone("camera", 26)}
          <span>Tirar foto</span>
          <input
            type="file"
            id="in-foto"
            accept="image/*"
            capture="environment"
            hidden
          >
        </label>

        <label class="escolha">
          ${icone("video", 26)}
          <span>Gravar vídeo</span>
          <input
            type="file"
            id="in-video"
            accept="video/*"
            capture="environment"
            hidden
          >
        </label>
      </div>

      <p class="pequeno suave">
        Vídeos de até ${CONFIG.LIMITE_VIDEO_SEGUNDOS} segundos.
        Cada arquivo pode ter até ${CONFIG.LIMITE_ARQUIVO_MB} MB.
        A câmera só abre quando você toca em um dos botões.
      </p>

      <ul class="fila" id="fila" aria-live="polite"></ul>

      <div class="acoes" id="rodape-fila" hidden>
        <a class="btn" href="#/e/${slug}/galeria">
          Ver todas as memórias
        </a>

        <a
          class="btn btn-principal"
          href="#/e/${slug}/album/${sessao.id}"
        >
          Ver meu álbum
        </a>
      </div>
    </main>

    ${rodape()}
  `;

  const fila = $("#fila");

  function desenharItem(item) {
    if (!telaAtiva) return;

    let li = document.getElementById(`item-${item.id}`);

    if (!li) {
      li = document.createElement("li");
      li.id = `item-${item.id}`;
      fila.prepend(li);
    }

    const rotulos = {
      validando: "Verificando…",
      fila: "Na fila",
      enviando: `Enviando ${item.progresso}%`,
      concluido: "Enviado",
      erro: item.erro,
    };

    li.className = `item ${item.estado}`;

    const previa =
      item.tipo === "video"
        ? `
          <video
            src="${item.previa}"
            muted
            playsinline
            preload="metadata"
          ></video>
        `
        : `
          <img
            src="${item.previa}"
            alt=""
            onerror="this.replaceWith(document.createTextNode('📷'))"
          >
        `;

    const barra =
      item.estado === "enviando" || item.estado === "fila"
        ? `
          <div class="barra">
            <span style="width:${item.progresso}%"></span>
          </div>
        `
        : "";

    const botaoRepetir =
      item.estado === "erro" && item.podeRepetir
        ? `
          <button
            class="btn btn-pequeno"
            data-retentar="${item.id}"
          >
            Tentar de novo
          </button>
        `
        : "";

    const botaoRemover =
      item.estado === "erro" || item.estado === "fila"
        ? `
          <button
            class="btn-icone"
            data-remover="${item.id}"
            aria-label="Remover da lista"
          >
            ${icone("x", 18)}
          </button>
        `
        : "";

    const indicadorConcluido =
      item.estado === "concluido"
        ? `
          <span class="ok-icone">
            ${icone("check", 22)}
          </span>
        `
        : "";

    li.innerHTML = `
      <div class="item-previa">
        ${previa}
      </div>

      <div class="item-corpo">
        <strong class="item-nome">
          ${esc(item.arquivo.name)}
        </strong>

        <span class="pequeno ${
          item.estado === "erro" ? "erro-texto" : "suave"
        }">
          ${formatarBytes(item.arquivo.size)}
          ·
          ${esc(rotulos[item.estado] || "Processando…")}
        </span>

        ${barra}
      </div>

      <div class="item-acoes">
        ${indicadorConcluido}
        ${botaoRepetir}
        ${botaoRemover}
      </div>
    `;

    $("#rodape-fila").hidden = !itens.some((i) => i.estado === "concluido");
  }

  /* ==========================================================
     Preparação e validação
     ========================================================== */

  async function preparar(arquivo) {
    const item = {
      id: ++contador,
      arquivo,
      estado: "validando",
      progresso: 0,
      erro: "",
      podeRepetir: false,
      mime: detectarMime(arquivo),
      chave: crypto.randomUUID(),
      duracao: null,
      miniatura: null,
      previa: URL.createObjectURL(arquivo),
    };

    item.tipo = TIPO_POR_MIME[item.mime] || "foto";

    itens.push(item);
    desenharItem(item);

    const recusar = (mensagem) => {
      item.estado = "erro";
      item.erro = mensagem;
      item.podeRepetir = false;
      desenharItem(item);
    };

    if (!TIPO_POR_MIME[item.mime]) {
      recusar(
        "Tipo de arquivo não permitido. Use fotos (JPG, PNG, WebP, HEIC) ou vídeos (MP4, MOV, WebM).",
      );
      return;
    }

    if (arquivo.size <= 0) {
      recusar("O arquivo está vazio.");
      return;
    }

    if (arquivo.size > CONFIG.LIMITE_ARQUIVO_MB * 1024 * 1024) {
      recusar(`O arquivo passa do limite de ${CONFIG.LIMITE_ARQUIVO_MB} MB.`);
      return;
    }

    if (item.tipo === "video") {
      try {
        item.duracao = await lerDuracao(arquivo);
      } catch {
        recusar(
          "Não foi possível verificar a duração do vídeo neste aparelho.",
        );
        return;
      }

      if (item.duracao > CONFIG.LIMITE_VIDEO_SEGUNDOS) {
        recusar(
          `O vídeo tem ${Math.round(item.duracao)} segundos. O máximo é ${CONFIG.LIMITE_VIDEO_SEGUNDOS}.`,
        );
        return;
      }
    }

    try {
      item.miniatura =
        item.tipo === "video"
          ? await miniaturaVideo(arquivo)
          : await miniaturaFoto(arquivo);
    } catch {
      item.miniatura = null;
    }

    item.estado = "fila";
    desenharItem(item);

    bombear();
  }

  /* ==========================================================
     Envio de um arquivo
     ========================================================== */

  async function processar(item) {
    item.estado = "enviando";
    item.progresso = 0;
    item.erro = "";

    desenharItem(item);

    try {
      const base = {
        slug,
        participante_id: sessao.id,
        codigo: sessao.codigo,
      };

      const resposta = await funcao("criar_envio", {
        ...base,
        nome_original: item.arquivo.name,
        mime: item.mime,
        tamanho: item.arquivo.size,
        duracao: item.duracao,
        chave: item.chave,
      });

      if (resposta.ja_publicada) {
        item.estado = "concluido";
        item.progresso = 100;
        item.podeRepetir = false;
        desenharItem(item);
        return;
      }

      if (!resposta.upload_original || !resposta.upload_original.signedUrl) {
        throw new Error("url_upload_invalida");
      }

      const original = item.arquivo.slice(0, item.arquivo.size, item.mime);

      await enviarComProgresso(
        resposta.upload_original.signedUrl,
        original,
        (progresso) => {
          item.progresso = Math.min(95, Math.round(progresso * 95));

          desenharItem(item);
        },
      );

      let temMiniatura = false;

      if (
        item.miniatura &&
        resposta.upload_miniatura &&
        resposta.upload_miniatura.signedUrl
      ) {
        try {
          await enviarComProgresso(
            resposta.upload_miniatura.signedUrl,
            item.miniatura,
          );

          temMiniatura = true;
        } catch (erroMiniatura) {
          console.warn("Não foi possível enviar a miniatura:", erroMiniatura);
        }
      }

      const finalizacao = await funcao("finalizar_envio", {
        ...base,
        midia_id: resposta.midia_id,
        tem_miniatura: temMiniatura,
      });

      if (!finalizacao.ok) {
        const erro = new Error(finalizacao.erro || "arquivo_invalido");

        erro.erro = finalizacao.erro || "arquivo_invalido";

        erro.definitivo = true;

        throw erro;
      }

      item.progresso = 100;
      item.estado = "concluido";
      item.erro = "";
      item.podeRepetir = false;
    } catch (erro) {
      console.error("Erro ao enviar arquivo:", erro);

      item.estado = "erro";
      item.erro = traduzirErro(erro);

      const codigoErro = erro.erro || erro.message || "";

      const errosDefinitivos = [
        "evento_encerrado",
        "capacidade_esgotada",
        "tipo_nao_permitido",
        "arquivo_muito_grande",
        "video_muito_longo",
        "arquivo_invalido",
        "evento_nao_encontrado",
        "nome_invalido",
      ];

      item.podeRepetir =
        !erro.definitivo && !errosDefinitivos.includes(codigoErro);
    }

    desenharItem(item);
  }

  /* ==========================================================
     Fila com limite de envios simultâneos
     ========================================================== */

  function bombear() {
    while (ativos < SIMULTANEOS) {
      const proximo = itens.find((item) => item.estado === "fila");

      if (!proximo) break;

      ativos++;

      processar(proximo)
        .catch((erro) => {
          console.error("Erro inesperado na fila:", erro);
        })
        .finally(() => {
          ativos--;
          bombear();
        });
    }
  }

  /* ==========================================================
     Seleção dos arquivos
     ========================================================== */

  const receber = (lista) => {
    const arquivos = [...lista];

    if (!arquivos.length) return;

    arquivos.forEach((arquivo) => {
      preparar(arquivo).catch((erro) => {
        console.error("Erro ao preparar arquivo:", erro);
      });
    });
  };

  ["in-galeria", "in-foto", "in-video"].forEach((idCampo) => {
    const campo = $(`#${idCampo}`);

    if (!campo) return;

    campo.onchange = (evento) => {
      receber(evento.target.files);
      evento.target.value = "";
    };
  });

  /* ==========================================================
     Botões de tentar novamente e remover
     ========================================================== */

  app().onclick = (evento) => {
    const botaoRetentar = evento.target.closest("[data-retentar]");

    const botaoRemover = evento.target.closest("[data-remover]");

    if (botaoRetentar) {
      const item = itens.find(
        (i) => i.id === Number(botaoRetentar.dataset.retentar),
      );

      if (!item || item.estado !== "erro") {
        return;
      }

      item.estado = "fila";
      item.erro = "";
      item.podeRepetir = false;

      desenharItem(item);
      bombear();

      return;
    }

    if (botaoRemover) {
      const indice = itens.findIndex(
        (i) => i.id === Number(botaoRemover.dataset.remover),
      );

      if (indice < 0) return;

      const item = itens[indice];

      /*
       * Não permite remover um arquivo que já esteja
       * em processo de envio.
       */
      if (item.estado === "enviando" || item.estado === "validando") {
        toast("Aguarde o processamento deste arquivo.");
        return;
      }

      itens.splice(indice, 1);

      URL.revokeObjectURL(item.previa);

      document.getElementById(`item-${item.id}`)?.remove();

      $("#rodape-fila").hidden = !itens.some((i) => i.estado === "concluido");
    }
  };

  /* ==========================================================
     Aviso antes de sair da página
     ========================================================== */

  const avisarSaida = (evento) => {
    const haPendentes =
      ativos > 0 ||
      itens.some(
        (item) => item.estado === "fila" || item.estado === "validando",
      );

    if (haPendentes) {
      evento.preventDefault();
      evento.returnValue = "";
    }
  };

  window.addEventListener("beforeunload", avisarSaida);

  /* ==========================================================
     Limpeza da tela
     ========================================================== */

  return () => {
    telaAtiva = false;

    window.removeEventListener("beforeunload", avisarSaida);

    itens.forEach((item) => {
      URL.revokeObjectURL(item.previa);
    });
  };
}
