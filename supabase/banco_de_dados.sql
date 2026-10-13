/*
  MEMORA: base do banco de dados (Supabase / PostgreSQL)

  Como usar:
  1. Crie um projeto no Supabase.
  2. Abra o SQL Editor, cole este arquivo inteiro e execute.
  3. Crie o usuário administrador em Authentication > Users.
  4. Cadastre o administrador (ver bloco final, "Primeiro administrador").

  Ideia central de segurança:
  - O convidado NUNCA acessa as tabelas diretamente. As tabelas só aceitam
    o administrador autenticado (políticas de segurança por linha).
  - O convidado só conversa com o banco por funções específicas
    (security definer), que validam evento, participante e código secreto.
  - O código secreto do participante é guardado apenas como hash (sha256).
  - Os arquivos ficam em buckets privados. Links de leitura e envio são
    assinados e curtos, gerados por uma Edge Function com a chave de serviço
    (a chave de serviço nunca vai para o navegador).

  Este script não foi executado aqui: teste em um projeto novo antes de usar.
*/

create extension if not exists pgcrypto with schema extensions;

/* ============================================================
   1. TABELAS
   ============================================================ */

create table if not exists public.administradores (
  user_id uuid primary key references auth.users (id) on delete cascade,
  criado_em timestamptz not null default now()
);

create table if not exists public.configuracoes (
  id boolean primary key default true check (id),
  limite_bytes_por_arquivo bigint not null default 52428800,   /* 200 MB */
  limite_total_bytes bigint not null default 53687091200,       /* 50 GB */
  duracao_maxima_video_segundos numeric not null default 30,
  bloquear_novos_uploads boolean not null default false,
  alerta_consumo_percentual int not null default 80,
  dias_retencao_removidas int not null default 30
);
insert into public.configuracoes default values on conflict do nothing;

create table if not exists public.eventos (
  id uuid primary key default gen_random_uuid(),
  nome text not null check (char_length(btrim(nome)) between 1 and 120),
  descricao text check (char_length(descricao) <= 1000),
  tipo text not null default 'outro' check (tipo in (
    'casamento', 'aniversario', 'formatura', 'viagem', 'confraternizacao', 'outro'
  )),
  data_evento date,
  slug_publico text not null unique
    default encode(extensions.gen_random_bytes(12), 'hex'),
  recebimento_aberto boolean not null default true,
  criado_em timestamptz not null default now(),
  administrador_id uuid not null default auth.uid() references auth.users (id)
);

create table if not exists public.participantes (
  id uuid primary key default gen_random_uuid(),
  evento_id uuid not null references public.eventos (id) on delete cascade,
  nome_publico text not null check (char_length(btrim(nome_publico)) between 1 and 60),
  entrou_em timestamptz not null default now(),
  token_hash text not null,
  /* Permite a chave estrangeira composta em midias */
  unique (id, evento_id)
);
create index if not exists participantes_evento_idx on public.participantes (evento_id);

create table if not exists public.midias (
  id uuid primary key default gen_random_uuid(),
  evento_id uuid not null,
  participante_id uuid not null,
  tipo text not null check (tipo in ('foto', 'video')),
  caminho_original text not null,
  caminho_miniatura text,
  nome_original text not null,
  tamanho_bytes bigint not null check (tamanho_bytes > 0),
  mime_validado text not null,
  duracao_segundos numeric,
  status text not null default 'pendente' check (status in (
    'pendente', 'processando', 'publicada', 'erro', 'removida'
  )),
  erro_processamento text,
  chave_idempotencia text not null,
  enviado_em timestamptz not null default now(),
  removida_em timestamptz,

  /* Impede associar uma mídia a um participante de outro evento */
  foreign key (participante_id, evento_id)
    references public.participantes (id, evento_id) on delete cascade,
  foreign key (evento_id) references public.eventos (id) on delete cascade,

  /* Impede o mesmo envio duas vezes por repetição da requisição */
  unique (participante_id, chave_idempotencia),

  /* Vídeo exige duração entre 0 e 30 segundos; foto não tem duração */
  check (
    (tipo = 'video' and duracao_segundos is not null
      and duracao_segundos > 0 and duracao_segundos <= 30)
    or (tipo = 'foto' and duracao_segundos is null)
  )
);
create index if not exists midias_galeria_idx
  on public.midias (evento_id, status, enviado_em desc);
create index if not exists midias_album_idx
  on public.midias (participante_id, status, enviado_em desc);

create table if not exists public.denuncias (
  id uuid primary key default gen_random_uuid(),
  evento_id uuid not null references public.eventos (id) on delete cascade,
  midia_id uuid not null references public.midias (id) on delete cascade,
  motivo text not null check (char_length(motivo) between 1 and 500),
  status text not null default 'aberta' check (status in ('aberta', 'resolvida')),
  criada_em timestamptz not null default now()
);

create table if not exists public.registros_admin (
  id bigint generated always as identity primary key,
  admin_id uuid,
  acao text not null,
  tabela text not null,
  registro_id uuid,
  detalhes jsonb,
  criado_em timestamptz not null default now()
);

/* ============================================================
   2. FUNÇÕES AUXILIARES (internas)
   ============================================================ */

create or replace function public.eh_admin()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (select 1 from public.administradores a where a.user_id = auth.uid());
$$;

create or replace function public.hash_codigo(p_codigo text)
returns text
language sql immutable
set search_path = public, extensions
as $$
  select encode(extensions.digest(coalesce(p_codigo, ''), 'sha256'), 'hex');
$$;

/* Registro de operações administrativas (só quando há administrador logado) */
create or replace function public.registrar_operacao_admin()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_linha jsonb;
  v_id uuid;
begin
  if auth.uid() is null then
    return coalesce(new, old);
  end if;

  if tg_op = 'DELETE' then
    v_linha := to_jsonb(old);
    v_id := old.id;
  else
    v_linha := to_jsonb(new);
    v_id := new.id;
  end if;

  /* Nunca registra caminhos internos de armazenamento */
  v_linha := v_linha - 'caminho_original' - 'caminho_miniatura';

  insert into public.registros_admin (admin_id, acao, tabela, registro_id, detalhes)
  values (auth.uid(), tg_op, tg_table_name, v_id, v_linha);

  return coalesce(new, old);
end;
$$;

drop trigger if exists eventos_auditoria on public.eventos;
create trigger eventos_auditoria
  after insert or update or delete on public.eventos
  for each row execute function public.registrar_operacao_admin();

drop trigger if exists midias_auditoria on public.midias;
create trigger midias_auditoria
  after update or delete on public.midias
  for each row execute function public.registrar_operacao_admin();

/* ============================================================
   3. POLÍTICAS DE SEGURANÇA POR LINHA (administrador)
   ============================================================ */

alter table public.administradores enable row level security;
alter table public.configuracoes   enable row level security;
alter table public.eventos         enable row level security;
alter table public.participantes   enable row level security;
alter table public.midias          enable row level security;
alter table public.denuncias       enable row level security;
alter table public.registros_admin enable row level security;

/* administradores: sem políticas = ninguém lê direto (use eh_admin()) */

create policy configuracoes_leitura_admin on public.configuracoes
  for select to authenticated using (public.eh_admin());

create policy eventos_admin on public.eventos
  for all to authenticated
  using (public.eh_admin() and administrador_id = auth.uid())
  with check (public.eh_admin() and administrador_id = auth.uid());

create policy participantes_leitura_admin on public.participantes
  for select to authenticated
  using (exists (
    select 1 from public.eventos e
    where e.id = participantes.evento_id and e.administrador_id = auth.uid()
  ) and public.eh_admin());

create policy midias_leitura_admin on public.midias
  for select to authenticated
  using (exists (
    select 1 from public.eventos e
    where e.id = midias.evento_id and e.administrador_id = auth.uid()
  ) and public.eh_admin());

/* Moderação: o administrador pode alterar o status (ex.: marcar como removida) */
create policy midias_moderacao_admin on public.midias
  for update to authenticated
  using (exists (
    select 1 from public.eventos e
    where e.id = midias.evento_id and e.administrador_id = auth.uid()
  ) and public.eh_admin())
  with check (exists (
    select 1 from public.eventos e
    where e.id = midias.evento_id and e.administrador_id = auth.uid()
  ) and public.eh_admin());

create policy denuncias_admin on public.denuncias
  for all to authenticated
  using (exists (
    select 1 from public.eventos e
    where e.id = denuncias.evento_id and e.administrador_id = auth.uid()
  ) and public.eh_admin())
  with check (exists (
    select 1 from public.eventos e
    where e.id = denuncias.evento_id and e.administrador_id = auth.uid()
  ) and public.eh_admin());

create policy registros_leitura_admin on public.registros_admin
  for select to authenticated using (public.eh_admin() and admin_id = auth.uid());

/* Convidados (anon) não têm nenhum acesso direto às tabelas */
revoke all on all tables in schema public from anon;
revoke all on all tables in schema public from authenticated;
grant select, insert, update, delete on public.eventos to authenticated;
grant select on public.participantes, public.configuracoes, public.registros_admin to authenticated;
grant select, update on public.midias to authenticated;
grant select, update, delete on public.denuncias to authenticated;

/* ============================================================
   4. INDICADORES DO PAINEL (respeita as políticas do administrador)
   ============================================================ */

create or replace view public.estatisticas_evento
with (security_invoker = true) as
select
  e.id as evento_id,
  count(m.id) filter (where m.status = 'publicada' and m.tipo = 'foto')  as total_fotos,
  count(m.id) filter (where m.status = 'publicada' and m.tipo = 'video') as total_videos,
  (select count(*) from public.participantes p where p.evento_id = e.id) as total_participantes,
  coalesce(sum(m.tamanho_bytes) filter (where m.status <> 'removida'), 0) as bytes_utilizados
from public.eventos e
left join public.midias m on m.evento_id = e.id
group by e.id;

grant select on public.estatisticas_evento to authenticated;

/* ============================================================
   5. FUNÇÕES PÚBLICAS PARA CONVIDADOS (security definer)
   ============================================================ */

/* 5.1 Dados públicos do evento */
create or replace function public.obter_evento_publico(p_slug text)
returns table (
  nome text,
  descricao text,
  tipo text,
  data_evento date,
  recebimento_aberto boolean
)
language sql stable security definer
set search_path = public
as $$
  select e.nome, e.descricao, e.tipo, e.data_evento, e.recebimento_aberto
  from public.eventos e
  where e.slug_publico = p_slug;
$$;

/* 5.2 Entrar no evento: cria participação e devolve o código secreto UMA vez.
   O mesmo código serve como vínculo no navegador e como código de recuperação. */
create or replace function public.entrar_no_evento(p_slug text, p_nome text)
returns table (novo_participante_id uuid, codigo_acesso text)
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_evento_id uuid;
  v_nome text := btrim(coalesce(p_nome, ''));
  v_codigo text := encode(extensions.gen_random_bytes(16), 'hex');
  v_id uuid;
begin
  if char_length(v_nome) < 1 or char_length(v_nome) > 60 then
    raise exception 'nome_invalido';
  end if;

  select e.id into v_evento_id from public.eventos e where e.slug_publico = p_slug;
  if v_evento_id is null then
    raise exception 'evento_nao_encontrado';
  end if;

  insert into public.participantes (evento_id, nome_publico, token_hash)
  values (v_evento_id, v_nome, public.hash_codigo(v_codigo))
  returning id into v_id;

  return query select v_id, v_codigo;
end;
$$;

/* 5.3 Recuperar participação perdida: valida o código e devolve o nome */
create or replace function public.recuperar_participacao(
  p_slug text, p_participante_id uuid, p_codigo text
)
returns text
language sql stable security definer
set search_path = public
as $$
  select p.nome_publico
  from public.participantes p
  join public.eventos e on e.id = p.evento_id
  where e.slug_publico = p_slug
    and p.id = p_participante_id
    and p.token_hash = public.hash_codigo(p_codigo);
$$;

/* 5.4 Lista de participantes com quantidade de mídias publicadas */
create or replace function public.listar_participantes(p_slug text)
returns table (participante_id uuid, nome_publico text, total_midias bigint)
language sql stable security definer
set search_path = public
as $$
  select p.id, p.nome_publico,
         count(m.id) filter (where m.status = 'publicada')
  from public.participantes p
  join public.eventos e on e.id = p.evento_id
  left join public.midias m on m.participante_id = p.id
  where e.slug_publico = p_slug
  group by p.id, p.nome_publico, p.entrou_em
  order by p.entrou_em;
$$;

/* 5.5 Galeria coletiva (paginação por data, carregamento progressivo).
   Não devolve caminhos: links assinados vêm da Edge Function. */
create or replace function public.listar_galeria(
  p_slug text, p_limite int default 40, p_antes timestamptz default null
)
returns table (
  midia_id uuid, tipo text, participante_id uuid, nome_publico text,
  duracao_segundos numeric, enviado_em timestamptz
)
language sql stable security definer
set search_path = public
as $$
  select m.id, m.tipo, m.participante_id, p.nome_publico, m.duracao_segundos, m.enviado_em
  from public.midias m
  join public.eventos e on e.id = m.evento_id
  join public.participantes p on p.id = m.participante_id
  where e.slug_publico = p_slug
    and m.status = 'publicada'
    and (p_antes is null or m.enviado_em < p_antes)
  order by m.enviado_em desc
  limit least(greatest(coalesce(p_limite, 40), 1), 100);
$$;

/* 5.6 Álbum individual */
create or replace function public.listar_album(
  p_slug text, p_participante_id uuid, p_limite int default 40, p_antes timestamptz default null
)
returns table (
  midia_id uuid, tipo text, participante_id uuid, nome_publico text,
  duracao_segundos numeric, enviado_em timestamptz
)
language sql stable security definer
set search_path = public
as $$
  select m.id, m.tipo, m.participante_id, p.nome_publico, m.duracao_segundos, m.enviado_em
  from public.midias m
  join public.eventos e on e.id = m.evento_id
  join public.participantes p on p.id = m.participante_id
  where e.slug_publico = p_slug
    and m.participante_id = p_participante_id
    and m.status = 'publicada'
    and (p_antes is null or m.enviado_em < p_antes)
  order by m.enviado_em desc
  limit least(greatest(coalesce(p_limite, 40), 1), 100);
$$;

/* 5.7 Registrar o início de um envio (antes do upload do arquivo).
   Valida participante, evento aberto, tipo, tamanho, duração e capacidade.
   É idempotente: repetir a mesma chave devolve o registro já existente. */
create or replace function public.registrar_midia(
  p_slug text,
  p_participante_id uuid,
  p_codigo text,
  p_nome_original text,
  p_mime text,
  p_tamanho bigint,
  p_duracao numeric,
  p_chave text
)
returns table (midia_id uuid, caminho_destino text, ja_existia boolean)
language plpgsql security definer
set search_path = public
as $$
declare
  v_evento public.eventos;
  v_cfg public.configuracoes;
  v_existente public.midias;
  v_tipo text;
  v_ext text;
  v_id uuid := gen_random_uuid();
  v_caminho text;
  v_usado bigint;
begin
  select * into v_evento from public.eventos e where e.slug_publico = p_slug;
  if not found then
    raise exception 'evento_nao_encontrado';
  end if;

  perform 1 from public.participantes p
   where p.id = p_participante_id
     and p.evento_id = v_evento.id
     and p.token_hash = public.hash_codigo(p_codigo);
  if not found then
    raise exception 'participante_invalido';
  end if;

  if p_chave is null or char_length(p_chave) not between 8 and 100 then
    raise exception 'chave_invalida';
  end if;

  select * into v_existente from public.midias m
   where m.participante_id = p_participante_id and m.chave_idempotencia = p_chave;
  if found then
    return query select v_existente.id, v_existente.caminho_original, true;
    return;
  end if;

  if not v_evento.recebimento_aberto then
    raise exception 'evento_encerrado';
  end if;

  select * into v_cfg from public.configuracoes where id;

  if v_cfg.bloquear_novos_uploads then
    raise exception 'capacidade_esgotada';
  end if;

  select coalesce(sum(m.tamanho_bytes), 0) into v_usado
    from public.midias m where m.status <> 'removida';
  if v_usado + p_tamanho > v_cfg.limite_total_bytes then
    raise exception 'capacidade_esgotada';
  end if;

  select t, x into v_tipo, v_ext from (values
    ('image/jpeg', 'foto', 'jpg'),
    ('image/png', 'foto', 'png'),
    ('image/webp', 'foto', 'webp'),
    ('image/heic', 'foto', 'heic'),
    ('image/heif', 'foto', 'heif'),
    ('video/mp4', 'video', 'mp4'),
    ('video/quicktime', 'video', 'mov'),
    ('video/webm', 'video', 'webm')
  ) as tabela(mime, t, x) where tabela.mime = lower(p_mime);
  if v_tipo is null then
    raise exception 'tipo_nao_permitido';
  end if;

  if p_tamanho is null or p_tamanho <= 0 or p_tamanho > v_cfg.limite_bytes_por_arquivo then
    raise exception 'arquivo_muito_grande';
  end if;

  if v_tipo = 'video' then
    if p_duracao is null or p_duracao <= 0
       or p_duracao > v_cfg.duracao_maxima_video_segundos then
      raise exception 'video_muito_longo';
    end if;
  else
    p_duracao := null;
  end if;

  v_caminho := v_evento.id::text || '/' || p_participante_id::text || '/' || v_id::text || '.' || v_ext;

  insert into public.midias (
    id, evento_id, participante_id, tipo, caminho_original, nome_original,
    tamanho_bytes, mime_validado, duracao_segundos, status, chave_idempotencia
  ) values (
    v_id, v_evento.id, p_participante_id, v_tipo, v_caminho,
    left(btrim(coalesce(p_nome_original, 'arquivo')), 255),
    p_tamanho, lower(p_mime), p_duracao, 'pendente', p_chave
  );

  return query select v_id, v_caminho, false;
end;
$$;

/* 5.8 Excluir a própria mídia (exige o código secreto, nunca só o nome).
   A exclusão é lógica; a remoção definitiva do arquivo segue a retenção. */
create or replace function public.excluir_propria_midia(
  p_participante_id uuid, p_codigo text, p_midia_id uuid
)
returns boolean
language plpgsql security definer
set search_path = public
as $$
begin
  perform 1 from public.participantes p
   where p.id = p_participante_id and p.token_hash = public.hash_codigo(p_codigo);
  if not found then
    return false;
  end if;

  update public.midias m
     set status = 'removida', removida_em = now()
   where m.id = p_midia_id
     and m.participante_id = p_participante_id
     and m.status <> 'removida';

  return found;
end;
$$;

/* 5.9 Denunciar uma mídia publicada */
create or replace function public.denunciar_midia(p_slug text, p_midia_id uuid, p_motivo text)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_evento_id uuid;
begin
  select m.evento_id into v_evento_id
    from public.midias m
    join public.eventos e on e.id = m.evento_id
   where m.id = p_midia_id and e.slug_publico = p_slug and m.status = 'publicada';
  if v_evento_id is null then
    raise exception 'midia_nao_encontrada';
  end if;

  insert into public.denuncias (evento_id, midia_id, motivo)
  values (v_evento_id, p_midia_id, left(btrim(coalesce(p_motivo, '')), 500));
end;
$$;

/* 5.10 Uso EXCLUSIVO da Edge Function (chave de serviço):
   depois de validar o conteúdo real (assinatura do arquivo) e gerar a miniatura,
   publica a mídia ou marca erro. Nunca fica publicada sem validação. */
create or replace function public.finalizar_midia(
  p_midia_id uuid, p_ok boolean, p_caminho_miniatura text, p_erro text
)
returns void
language sql security definer
set search_path = public
as $$
  update public.midias m
     set status = case when p_ok then 'publicada' else 'erro' end,
         caminho_miniatura = case when p_ok then p_caminho_miniatura else null end,
         erro_processamento = case when p_ok then null else left(p_erro, 500) end
   where m.id = p_midia_id and m.status in ('pendente', 'processando');
$$;

/* Permissões de execução: tudo fechado, depois abre o necessário */
revoke all on function public.obter_evento_publico(text)                       from public;
revoke all on function public.entrar_no_evento(text, text)                     from public;
revoke all on function public.recuperar_participacao(text, uuid, text)         from public;
revoke all on function public.listar_participantes(text)                       from public;
revoke all on function public.listar_galeria(text, int, timestamptz)           from public;
revoke all on function public.listar_album(text, uuid, int, timestamptz)       from public;
revoke all on function public.registrar_midia(text, uuid, text, text, text, bigint, numeric, text) from public;
revoke all on function public.excluir_propria_midia(uuid, text, uuid)          from public;
revoke all on function public.denunciar_midia(text, uuid, text)                from public;
revoke all on function public.finalizar_midia(uuid, boolean, text, text)       from public;
revoke all on function public.hash_codigo(text)                                from public;

grant execute on function public.obter_evento_publico(text)                    to anon, authenticated;
grant execute on function public.entrar_no_evento(text, text)                  to anon, authenticated;
grant execute on function public.recuperar_participacao(text, uuid, text)      to anon, authenticated;
grant execute on function public.listar_participantes(text)                    to anon, authenticated;
grant execute on function public.listar_galeria(text, int, timestamptz)        to anon, authenticated;
grant execute on function public.listar_album(text, uuid, int, timestamptz)    to anon, authenticated;
grant execute on function public.excluir_propria_midia(uuid, text, uuid)       to anon, authenticated;
grant execute on function public.denunciar_midia(text, uuid, text)             to anon, authenticated;

/* registrar_midia e finalizar_midia: só a Edge Function (service_role).
   Assim o envio passa por limite de requisições e validação no servidor. */
grant execute on function public.registrar_midia(text, uuid, text, text, text, bigint, numeric, text) to service_role;
grant execute on function public.finalizar_midia(uuid, boolean, text, text)    to service_role;
grant execute on function public.hash_codigo(text)                             to service_role;

/* ============================================================
   6. ARMAZENAMENTO DE OBJETOS (buckets privados)
   ============================================================ */

/* Ajuste file_size_limit conforme o limite do seu plano do Supabase */
insert into storage.buckets (id, name, public, file_size_limit)
values
  ('originais', 'originais', false, 52428800),
  ('miniaturas', 'miniaturas', false, 5242880)
on conflict (id) do nothing;

/* Sem políticas para anon: convidados só usam links assinados.
   O administrador pode ler os arquivos dos próprios eventos. */
create policy storage_leitura_admin on storage.objects
  for select to authenticated
  using (
    bucket_id in ('originais', 'miniaturas')
    and public.eh_admin()
    and exists (
      select 1 from public.eventos e
      where e.administrador_id = auth.uid()
        and e.id::text = (storage.foldername(name))[1]
    )
  );

/* ============================================================
   7. PRIMEIRO ADMINISTRADOR
   ============================================================ */

/* Depois de criar o usuário em Authentication > Users, execute:

   insert into public.administradores (user_id)
   select id from auth.users where email = 'SEU_EMAIL_AQUI';
*/
