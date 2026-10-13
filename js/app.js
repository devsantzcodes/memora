import { CONFIG, configurado } from "./config.js";
import { app, mensagemTela } from "./ui.js";
import { traduzirErro } from "./api.js";
import { landing, paginaLegal, naoConfigurado, naoEncontrada } from "./publico.js";
import { adminLogin, adminPainel, adminEvento } from "./admin.js";
import { eventoHome, galeria, album } from "./convidado.js";
import { enviar } from "./enviar.js";

/* Identidade visual centralizada */
document.documentElement.style.setProperty("--destaque", CONFIG.MARCA.corDestaque);
document.title = `${CONFIG.MARCA.nome}: memórias de eventos em um só lugar`;

const rotas = [
  [/^\/$/, landing],
  [/^\/(privacidade|termos|contato)$/, paginaLegal],
  [/^\/admin\/login$/, adminLogin],
  [/^\/admin$/, adminPainel],
  [/^\/admin\/evento\/([^/]+)$/, adminEvento],
  [/^\/e\/([^/]+)$/, eventoHome],
  [/^\/e\/([^/]+)\/galeria$/, galeria],
  [/^\/e\/([^/]+)\/album\/([^/]+)$/, album],
  [/^\/e\/([^/]+)\/enviar$/, enviar],
];

let limpeza = null;
let rodada = 0;

async function rotear() {
  const minha = ++rodada;
  if (typeof limpeza === "function") {
    try { limpeza(); } catch {}
  }
  limpeza = null;
  const alvo = app();
  alvo.onclick = null;
  window.scrollTo(0, 0);

  const caminho = (location.hash.replace(/^#/, "") || "/").split("?")[0].replace(/\/+$/, "") || "/";
  const publicaSemBanco = caminho === "/" || /^\/(privacidade|termos|contato)$/.test(caminho);
  if (!configurado() && !publicaSemBanco) return naoConfigurado();

  for (const [regex, vista] of rotas) {
    const m = caminho.match(regex);
    if (!m) continue;
    try {
      const retorno = await vista({}, ...m.slice(1).map(decodeURIComponent));
      if (minha !== rodada) {
        if (typeof retorno === "function") retorno();
      } else {
        limpeza = retorno;
      }
    } catch (e) {
      console.error(e);
      mensagemTela("Algo deu errado", traduzirErro(e), `<button class="btn" onclick="location.reload()">Recarregar</button>`);
    }
    return;
  }
  naoEncontrada();
}

window.addEventListener("hashchange", rotear);
rotear();
