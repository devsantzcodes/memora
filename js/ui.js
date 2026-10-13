import { CONFIG } from "./config.js";

export const app = () => document.getElementById("app");
export const $ = (sel, raiz = document) => raiz.querySelector(sel);
export const $$ = (sel, raiz = document) => [...raiz.querySelectorAll(sel)];

export const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export const TIPOS_EVENTO = {
  casamento: "Casamento",
  aniversario: "Aniversário",
  formatura: "Formatura",
  viagem: "Viagem",
  confraternizacao: "Confraternização",
  outro: "Outro",
};

const ICONES = {
  camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  imagem: '<rect x="3.5" y="4.5" width="17" height="15" rx="3"/><circle cx="9" cy="10" r="1.6"/><path d="m4 17 5-4.5 4 3.5 3-2.5 4 3.5"/>',
  video: '<rect x="3" y="6" width="13" height="12" rx="3"/><path d="m16 11 5-3v8l-5-3z"/>',
  play: '<path d="M8 5.5v13l11-6.5z" fill="currentColor"/>',
  baixar: '<path d="M12 4v11m0 0-4-4m4 4 4-4M5 19h14"/>',
  lixeira: '<path d="M5 7h14M10 7V5h4v2m-8 0 1 12h10l1-12M10 11v5m4-5v5"/>',
  copiar: '<rect x="8" y="8" width="11" height="11" rx="2.5"/><path d="M16 8V6.5A2.5 2.5 0 0 0 13.5 4h-7A2.5 2.5 0 0 0 4 6.5v7A2.5 2.5 0 0 0 6.5 16H8"/>',
  qr: '<rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><path d="M14 14h2v2h-2zm4 0h2v2h-2zm-4 4h2v2h-2zm4 2v-2h2"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  mais: '<path d="M12 5v14M5 12h14"/>',
  bandeira: '<path d="M6 21V4m0 1h11l-2 4 2 4H6"/>',
  usuarios: '<circle cx="9" cy="9" r="3.2"/><path d="M3.5 19c.6-3 2.8-4.5 5.5-4.5s4.9 1.5 5.5 4.5"/><path d="M16 6.3a3 3 0 0 1 0 5.4M17.5 14.7c1.7.5 2.8 2 3.2 4.3"/>',
  seta: '<path d="M15 5l-7 7 7 7"/>',
  cadeado: '<rect x="5" y="11" width="14" height="9" rx="2.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  atualizar: '<path d="M20 11a8 8 0 0 0-14.5-3.5M4 4v4h4M4 13a8 8 0 0 0 14.5 3.5M20 20v-4h-4"/>',
  olho: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>',
};

export const icone = (nome, tamanho = 20) =>
  `<svg class="ico" width="${tamanho}" height="${tamanho}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONES[nome] || ""}</svg>`;

export function formatarBytes(n) {
  let v = Number(n) || 0;
  const u = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(i ? 1 : 0).replace(".", ",")} ${u[i]}`;
}

export function formatarData(iso) {
  if (!iso) return "";
  const d = iso.length === 10 ? new Date(`${iso}T12:00:00`) : new Date(iso);
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });
}

export const segundos = (s) => {
  const n = Math.round(Number(s) || 0);
  return `0:${String(n).padStart(2, "0")}`;
};

export function toast(mensagem, tipo = "info") {
  let c = $("#toasts");
  if (!c) {
    c = document.createElement("div");
    c.id = "toasts";
    document.body.append(c);
  }
  const t = document.createElement("div");
  t.className = `toast ${tipo}`;
  t.setAttribute("role", tipo === "erro" ? "alert" : "status");
  t.textContent = mensagem;
  c.append(t);
  setTimeout(() => {
    t.classList.add("sai");
    setTimeout(() => t.remove(), 300);
  }, 3800);
}

export async function copiarTexto(texto) {
  try {
    await navigator.clipboard.writeText(texto);
    return true;
  } catch {
    const a = document.createElement("textarea");
    a.value = texto;
    a.style.cssText = "position:fixed;opacity:0";
    document.body.append(a);
    a.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {}
    a.remove();
    return ok;
  }
}

export function abrirModal(html, { classe = "", aoFechar } = {}) {
  const fundo = document.createElement("div");
  fundo.className = "modal-fundo";
  fundo.innerHTML = `<div class="modal ${classe}" role="dialog" aria-modal="true">${html}</div>`;
  document.body.append(fundo);
  document.body.classList.add("sem-rolagem");
  const tecla = (e) => {
    if (e.key === "Escape") fechar();
  };
  const fechar = () => {
    if (!fundo.isConnected) return;
    fundo.remove();
    if (!$(".modal-fundo") && !$(".lightbox")) document.body.classList.remove("sem-rolagem");
    document.removeEventListener("keydown", tecla);
    aoFechar?.();
  };
  document.addEventListener("keydown", tecla);
  fundo.addEventListener("mousedown", (e) => {
    if (e.target === fundo) fechar();
  });
  $$("[data-fechar]", fundo).forEach((b) => b.addEventListener("click", fechar));
  $("input, textarea, select", fundo)?.focus();
  return { el: fundo.firstElementChild, fundo, fechar };
}

export function confirmar({ titulo, texto, rotulo = "Confirmar", perigo = false }) {
  return new Promise((resolve) => {
    let decidido = false;
    const m = abrirModal(
      `<h2>${esc(titulo)}</h2><p class="suave">${esc(texto)}</p>
       <div class="acoes"><button class="btn" data-fechar>Cancelar</button>
       <button class="btn ${perigo ? "btn-perigo" : "btn-principal"}" id="confirmar-ok">${esc(rotulo)}</button></div>`,
      { aoFechar: () => !decidido && resolve(false) }
    );
    $("#confirmar-ok", m.el).onclick = () => {
      decidido = true;
      m.fechar();
      resolve(true);
    };
  });
}

const LOGO_SVG = `<svg class="logo-marca" viewBox="0 0 32 32" aria-hidden="true"><rect x="3" y="9" width="18" height="18" rx="5.5" fill="var(--destaque-claro)" stroke="var(--destaque)" stroke-width="1.6"/><rect x="11" y="4" width="18" height="18" rx="5.5" fill="var(--destaque)"/></svg>`;

export const logo = () => `<a class="logo" href="#/">${LOGO_SVG}<span>${esc(CONFIG.MARCA.nome)}</span></a>`;

export const cabecalho = (direita = "") =>
  `<header class="topo"><div class="contido">${logo()}<nav class="topo-acoes">${direita}</nav></div></header>`;

export const rodape = () => `
  <footer class="rodape"><div class="contido">
    <div>${logo()}<p class="suave pequeno">Guarde as memórias de cada evento em um só lugar.</p></div>
    <nav class="rodape-links" aria-label="Links do rodapé">
      <a href="#/privacidade">Privacidade</a><a href="#/termos">Termos de uso</a><a href="#/contato">Contato</a>
    </nav>
  </div></footer>`;

export function carregando(texto = "Carregando…") {
  app().innerHTML = `<div class="centro"><div class="spinner"></div><p class="suave">${esc(texto)}</p></div>`;
}

export function mensagemTela(titulo, texto, acao = "") {
  app().innerHTML = `${cabecalho()}<main class="contido estreito centro-texto vazio-tela">
    <h1>${esc(titulo)}</h1><p class="suave">${esc(texto)}</p><div class="acoes centro-acoes">${acao}</div></main>`;
}
