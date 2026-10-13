/*
  FUNÇÃO DE SERVIDOR "midia" (Supabase Edge Function, Deno)

  Responsabilidades (tudo que exige a chave de serviço fica aqui, nunca no navegador):
  1. criar_envio: registra a mídia e devolve links assinados de envio.
  2. finalizar_envio: confere o conteúdo REAL do arquivo (assinatura binária e tamanho)
     e só então publica a mídia.
  3. urls: devolve links assinados de leitura/baixa, sem expor caminhos internos.
  4. admin_purgar / admin_excluir_evento: apagam arquivos do armazenamento.
  5. purgar_agendado: limpeza periódica (retenção e envios abandonados).

  Publicar com:  supabase functions deploy midia --no-verify-jwt
*/
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

const CORS = {
  "Access-Control-Allow-Origin": Deno.env.get("ORIGEM_PERMITIDA") ?? "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

class Falha extends Error {
  constructor(public codigo: string, public status = 400) {
    super(codigo);
  }
}

const responder = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { ...CORS, "Content-Type": "application/json" } });

/* ---------- Limite de requisições (por instância; reforço básico contra abuso) ---------- */
const janelas = new Map<string, { n: number; ate: number }>();
function limitar(chave: string, max: number, janelaMs = 60_000) {
  const agora = Date.now();
  const j = janelas.get(chave);
  if (!j || j.ate < agora) {
    janelas.set(chave, { n: 1, ate: agora + janelaMs });
  } else if (++j.n > max) {
    throw new Falha("muitas_requisicoes", 429);
  }
  if (janelas.size > 5000) for (const [k, v] of janelas) if (v.ate < agora) janelas.delete(k);
}

const CODIGOS = [
  "evento_nao_encontrado", "participante_invalido", "evento_encerrado", "capacidade_esgotada",
  "tipo_nao_permitido", "arquivo_muito_grande", "video_muito_longo", "chave_invalida", "nome_invalido",
];
const extrairCodigo = (msg = "") => CODIGOS.find((c) => msg.includes(c)) ?? "erro_interno";

const caminhoMiniatura = (caminhoOriginal: string) => caminhoOriginal.replace(/\.[^.]+$/, ".jpg");

/* ---------- Conferência do conteúdo real do arquivo ---------- */
function conferirAssinatura(b: Uint8Array, mime: string): boolean {
  const texto = (i: number, n: number) => String.fromCharCode(...b.slice(i, i + n));
  switch (mime) {
    case "image/jpeg": return b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
    case "image/png": return b[0] === 0x89 && texto(1, 3) === "PNG";
    case "image/webp": return texto(0, 4) === "RIFF" && texto(8, 4) === "WEBP";
    case "image/heic":
    case "image/heif":
      return texto(4, 4) === "ftyp" &&
        ["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1", "heif"].includes(texto(8, 4));
    case "video/mp4":
    case "video/quicktime":
      return ["ftyp", "moov", "mdat", "wide", "free", "skip"].includes(texto(4, 4));
    case "video/webm": return b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3;
  }
  return false;
}

/* Lê só o começo do arquivo e o tamanho total, sem baixar tudo */
async function lerInicio(bucket: string, caminho: string) {
  const { data } = await admin.storage.from(bucket).createSignedUrl(caminho, 60);
  if (!data) return null;
  const r = await fetch(data.signedUrl, { headers: { Range: "bytes=0-31" } });
  if (!r.ok) return null;
  const total = Number((r.headers.get("content-range") ?? "").split("/")[1]) || Number(r.headers.get("content-length"));
  const leitor = r.body?.getReader();
  if (!leitor) return null;
  const partes: number[] = [];
  while (partes.length < 32) {
    const { done, value } = await leitor.read();
    if (done) break;
    partes.push(...value);
  }
  await leitor.cancel().catch(() => {});
  return { bytes: new Uint8Array(partes.slice(0, 32)), total };
}

async function apagarArquivos(linhas: { caminho_original: string; caminho_miniatura?: string | null }[]) {
  const originais = linhas.map((l) => l.caminho_original);
  const miniaturas = linhas.flatMap((l) => [caminhoMiniatura(l.caminho_original), l.caminho_miniatura]).filter(Boolean) as string[];
  for (let i = 0; i < originais.length; i += 100) await admin.storage.from("originais").remove(originais.slice(i, i + 100));
  for (let i = 0; i < miniaturas.length; i += 100) await admin.storage.from("miniaturas").remove(miniaturas.slice(i, i + 100));
}

async function exigirAdmin(req: Request) {
  const jwt = (req.headers.get("authorization") ?? "").replace(/^Bearer /i, "");
  const { data, error } = await admin.auth.getUser(jwt);
  if (error || !data.user) throw new Falha("nao_autorizado", 401);
  const { data: linha } = await admin.from("administradores").select("user_id").eq("user_id", data.user.id).maybeSingle();
  if (!linha) throw new Falha("nao_autorizado", 403);
  return data.user;
}

/* ============================================================
   Ações
   ============================================================ */
async function criarEnvio(c: any) {
  const { data, error } = await admin.rpc("registrar_midia", {
    p_slug: c.slug, p_participante_id: c.participante_id, p_codigo: c.codigo, p_nome_original: c.nome_original,
    p_mime: c.mime, p_tamanho: c.tamanho, p_duracao: c.duracao ?? null, p_chave: c.chave,
  });
  if (error) throw new Falha(extrairCodigo(error.message));
  const r = data[0];

  const { data: m } = await admin.from("midias").select("status").eq("id", r.midia_id).single();
  if (r.ja_existia && m?.status === "publicada") return { midia_id: r.midia_id, ja_publicada: true };

  const miniatura = caminhoMiniatura(r.caminho_destino);
  if (r.ja_existia) {
    // nova tentativa do mesmo envio: limpa restos e volta o status para pendente
    await admin.storage.from("originais").remove([r.caminho_destino]);
    await admin.storage.from("miniaturas").remove([miniatura]);
    await admin.from("midias").update({ status: "pendente", erro_processamento: null }).eq("id", r.midia_id);
  }

  const original = await admin.storage.from("originais").createSignedUploadUrl(r.caminho_destino);
  const mini = await admin.storage.from("miniaturas").createSignedUploadUrl(miniatura);
  if (original.error || !original.data) throw new Falha("erro_interno", 500);
  return {
    midia_id: r.midia_id,
    upload_original: { signedUrl: original.data.signedUrl },
    upload_miniatura: mini.data ? { signedUrl: mini.data.signedUrl } : null,
  };
}

async function finalizarEnvio(c: any) {
  const { data: nome } = await admin.rpc("recuperar_participacao", {
    p_slug: c.slug, p_participante_id: c.participante_id, p_codigo: c.codigo,
  });
  if (!nome) throw new Falha("participante_invalido", 403);

  const { data: m } = await admin
    .from("midias")
    .select("id,caminho_original,tamanho_bytes,mime_validado,status")
    .eq("id", c.midia_id)
    .eq("participante_id", c.participante_id)
    .single();
  if (!m) throw new Falha("midia_nao_encontrada", 404);
  if (!["pendente", "processando"].includes(m.status)) return { ok: m.status === "publicada" };

  const inicio = await lerInicio("originais", m.caminho_original);
  const valido = !!inicio && inicio.total === Number(m.tamanho_bytes) && conferirAssinatura(inicio.bytes, m.mime_validado);

  let miniatura: string | null = null;
  if (valido && c.tem_miniatura) {
    const caminho = caminhoMiniatura(m.caminho_original);
    const mini = await lerInicio("miniaturas", caminho);
    if (mini && mini.total > 0 && mini.total <= 5 * 1024 * 1024 && conferirAssinatura(mini.bytes, "image/jpeg")) miniatura = caminho;
    else await admin.storage.from("miniaturas").remove([caminho]);
  }

  await admin.rpc("finalizar_midia", {
    p_midia_id: m.id, p_ok: valido, p_caminho_miniatura: miniatura, p_erro: valido ? null : "conteudo_invalido",
  });
  if (!valido) {
    await apagarArquivos([{ caminho_original: m.caminho_original }]);
    return { ok: false, erro: "arquivo_invalido" };
  }
  return { ok: true };
}

async function urls(c: any) {
  const ids: string[] = (c.ids ?? []).slice(0, 60);
  if (!ids.length) return { urls: {} };
  const { data } = await admin
    .from("midias")
    .select("id,tipo,caminho_original,caminho_miniatura,nome_original,eventos!inner(slug_publico)")
    .in("id", ids)
    .eq("status", "publicada")
    .eq("eventos.slug_publico", c.slug);

  const resultado: Record<string, string> = {};
  await Promise.all(
    (data ?? []).map(async (m: any) => {
      let bucket = "originais";
      let caminho = m.caminho_original;
      if (c.variante === "miniatura") {
        if (m.caminho_miniatura) {
          bucket = "miniaturas";
          caminho = m.caminho_miniatura;
        } else if (m.tipo === "video") return; // sem miniatura de vídeo: a tela mostra um ícone
      }
      const opcoes = c.baixar ? { download: m.nome_original } : undefined;
      const { data: link } = await admin.storage.from(bucket).createSignedUrl(caminho, 3600, opcoes);
      if (link?.signedUrl) resultado[m.id] = link.signedUrl;
    })
  );
  return { urls: resultado };
}

async function adminPurgar(req: Request, c: any) {
  const usuario = await exigirAdmin(req);
  const { data } = await admin
    .from("midias")
    .select("id,caminho_original,caminho_miniatura,eventos!inner(administrador_id)")
    .eq("id", c.midia_id)
    .eq("status", "removida")
    .eq("eventos.administrador_id", usuario.id);
  if (!data?.length) return { apagadas: 0 };
  await apagarArquivos(data);
  await admin.from("midias").delete().in("id", data.map((m: any) => m.id));
  return { apagadas: data.length };
}

async function adminExcluirEvento(req: Request, c: any) {
  const usuario = await exigirAdmin(req);
  const { data: evento } = await admin.from("eventos").select("id").eq("id", c.evento_id).eq("administrador_id", usuario.id).maybeSingle();
  if (!evento) throw new Falha("evento_nao_encontrado", 404);

  for (;;) {
    const { data: lote } = await admin.from("midias").select("id,caminho_original,caminho_miniatura").eq("evento_id", evento.id).limit(500);
    if (!lote?.length) break;
    await apagarArquivos(lote);
    await admin.from("midias").delete().in("id", lote.map((m) => m.id));
  }
  const { error } = await admin.from("eventos").delete().eq("id", evento.id);
  if (error) throw new Falha("erro_interno", 500);
  return { ok: true };
}

async function purgarAgendado(req: Request) {
  const segredo = Deno.env.get("CRON_SECRET");
  if (!segredo || req.headers.get("x-cron-secret") !== segredo) throw new Falha("nao_autorizado", 401);
  const { data: cfg } = await admin.from("configuracoes").select("dias_retencao_removidas").eq("id", true).single();
  const corte = new Date(Date.now() - (cfg?.dias_retencao_removidas ?? 30) * 86_400_000).toISOString();

  const { data: removidas } = await admin
    .from("midias").select("id,caminho_original,caminho_miniatura").eq("status", "removida").lt("removida_em", corte).limit(500);
  if (removidas?.length) {
    await apagarArquivos(removidas);
    await admin.from("midias").delete().in("id", removidas.map((m) => m.id));
  }

  // envios abandonados há mais de 24 horas viram erro e perdem os arquivos parciais
  const ontem = new Date(Date.now() - 86_400_000).toISOString();
  const { data: abandonadas } = await admin
    .from("midias").select("id,caminho_original").eq("status", "pendente").lt("enviado_em", ontem).limit(500);
  if (abandonadas?.length) {
    await apagarArquivos(abandonadas);
    await admin.from("midias").update({ status: "erro", erro_processamento: "envio_abandonado" }).in("id", abandonadas.map((m) => m.id));
  }
  return { removidas: removidas?.length ?? 0, abandonadas: abandonadas?.length ?? 0 };
}

/* ============================================================
   Entrada
   ============================================================ */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    if (req.method !== "POST") throw new Falha("metodo_invalido", 405);
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "desconhecido";
    limitar(`geral:${ip}`, 240);
    const c = await req.json();

    switch (c.acao) {
      case "criar_envio": limitar(`envio:${ip}`, 60); return responder(await criarEnvio(c));
      case "finalizar_envio": limitar(`final:${ip}`, 90); return responder(await finalizarEnvio(c));
      case "urls": return responder(await urls(c));
      case "admin_purgar": return responder(await adminPurgar(req, c));
      case "admin_excluir_evento": return responder(await adminExcluirEvento(req, c));
      case "purgar_agendado": return responder(await purgarAgendado(req));
      default: throw new Falha("acao_invalida");
    }
  } catch (e) {
    if (e instanceof Falha) return responder({ erro: e.codigo }, e.status);
    console.error(e);
    return responder({ erro: "erro_interno" }, 500);
  }
});
