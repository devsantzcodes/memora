import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { CONFIG, configurado } from "./config.js";

export const supabase = configurado()
  ? createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true },
    })
  : null;

/* ---------- Mensagens de erro em português ---------- */
const MENSAGENS = {
  nome_invalido: "Digite um nome com até 60 caracteres.",
  evento_nao_encontrado: "Este evento não foi encontrado. Confira o link.",
  participante_invalido: "Sua participação não foi reconhecida. Recupere-a com o código de acesso.",
  evento_encerrado: "Este evento foi encerrado e não aceita novos envios.",
  capacidade_esgotada: "O limite de armazenamento foi atingido. Novos envios estão bloqueados.",
  tipo_nao_permitido: "Tipo de arquivo não permitido. Use JPG, PNG, WebP, HEIC, MP4, MOV ou WebM.",
  arquivo_muito_grande: "O arquivo é maior que o tamanho máximo permitido.",
  video_muito_longo: "O vídeo deve ter no máximo 30 segundos.",
  chave_invalida: "Não foi possível identificar este envio. Tente de novo.",
  arquivo_invalido: "O conteúdo do arquivo não corresponde ao tipo informado.",
  muitas_requisicoes: "Muitas tentativas seguidas. Aguarde um minuto e tente de novo.",
  nao_autorizado: "Acesso não autorizado.",
  midia_nao_encontrada: "Esta mídia não está mais disponível.",
};

export function traduzirErro(e) {
  const texto = typeof e === "string" ? e : e?.erro || e?.message || "";
  for (const [codigo, msg] of Object.entries(MENSAGENS)) if (texto.includes(codigo)) return msg;
  if (/failed to fetch|networkerror|network request/i.test(texto)) return "Sem conexão. Verifique a internet e tente de novo.";
  return "Algo deu errado. Tente novamente.";
}

/* ---------- Função de servidor (validação, links assinados) ---------- */
export async function funcao(acao, corpo = {}, { admin = false } = {}) {
  let token = CONFIG.SUPABASE_ANON_KEY;
  if (admin) {
    const { data } = await supabase.auth.getSession();
    token = data.session?.access_token || token;
  }
  const resp = await fetch(`${CONFIG.SUPABASE_URL}/functions/v1/midia`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: CONFIG.SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
    body: JSON.stringify({ acao, ...corpo }),
  });
  let dados = {};
  try {
    dados = await resp.json();
  } catch {}
  if (!resp.ok) {
    const erro = new Error(dados.erro || "erro");
    erro.erro = dados.erro;
    throw erro;
  }
  return dados;
}

/* ---------- Funções públicas do banco (convidados) ---------- */
async function rpc(nome, args = {}) {
  const { data, error } = await supabase.rpc(nome, args);
  if (error) throw error;
  return data;
}

export const eventoPublico = async (slug) => (await rpc("obter_evento_publico", { p_slug: slug }))?.[0] ?? null;
export const entrarNoEvento = async (slug, nome) => (await rpc("entrar_no_evento", { p_slug: slug, p_nome: nome }))[0];
export const recuperarParticipacao = (slug, pid, codigo) =>
  rpc("recuperar_participacao", { p_slug: slug, p_participante_id: pid, p_codigo: codigo });
export const listarParticipantes = (slug) => rpc("listar_participantes", { p_slug: slug });
export const listarGaleria = (slug, limite, antes) => rpc("listar_galeria", { p_slug: slug, p_limite: limite, p_antes: antes });
export const listarAlbum = (slug, pid, limite, antes) =>
  rpc("listar_album", { p_slug: slug, p_participante_id: pid, p_limite: limite, p_antes: antes });
export const excluirPropriaMidia = (pid, codigo, midiaId) =>
  rpc("excluir_propria_midia", { p_participante_id: pid, p_codigo: codigo, p_midia_id: midiaId });
export const denunciarMidia = (slug, midiaId, motivo) =>
  rpc("denunciar_midia", { p_slug: slug, p_midia_id: midiaId, p_motivo: motivo });

/* ---------- Sessão do participante (vínculo persistente no navegador) ---------- */
const chaveSessao = (slug) => `memora:participante:${slug}`;
export function lerSessao(slug) {
  try {
    const s = JSON.parse(localStorage.getItem(chaveSessao(slug)));
    return s?.id && s?.codigo ? s : null;
  } catch {
    return null;
  }
}
export function salvarSessao(slug, sessao) {
  localStorage.setItem(chaveSessao(slug), JSON.stringify(sessao));
  navigator.storage?.persist?.().catch(() => {});
}
export const removerSessao = (slug) => localStorage.removeItem(chaveSessao(slug));

/* ---------- Links assinados de leitura (em lote, com cache curto) ---------- */
const cache = new Map();
export async function urlsMidias(slug, ids, variante = "miniatura", baixar = false) {
  const agora = Date.now();
  const resultado = {};
  const faltam = [];
  for (const id of ids) {
    const c = cache.get(`${id}|${variante}|${baixar}`);
    if (c && c.ate > agora) resultado[id] = c.url;
    else faltam.push(id);
  }
  for (let i = 0; i < faltam.length; i += 60) {
    const r = await funcao("urls", { slug, ids: faltam.slice(i, i + 60), variante, baixar });
    for (const [id, url] of Object.entries(r.urls || {})) {
      resultado[id] = url;
      cache.set(`${id}|${variante}|${baixar}`, { url, ate: agora + 50 * 60 * 1000 });
    }
  }
  return resultado;
}

/* ---------- Endereços públicos ---------- */
export function urlPublica(slug) {
  const base = CONFIG.URL_BASE || `${location.origin}${location.pathname}`;
  return `${base.replace(/#.*$/, "")}#/e/${slug}`;
}
