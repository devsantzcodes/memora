# Memora: álbuns coletivos de eventos

Site estático (HTML, CSS e JavaScript, sem etapa de compilação) ligado ao Supabase.

IMPORTANTE: este código foi escrito sem poder ser executado contra um Supabase real. Siga o roteiro de teste do final antes de usar em um evento de verdade.

## Estrutura

```
index.html                      página única (rotas por # na URL)
css/estilos.css                 identidade visual
js/config.js                    SUA configuração e a marca (nome, cor)
js/app.js                       roteador
js/publico.js                   página inicial, termos, privacidade, contato
js/admin.js                     login, painel, gerenciamento e moderação
js/convidado.js                 página do evento, galerias, álbuns, visualizador
js/enviar.js                    envio de fotos e vídeos
js/api.js, js/ui.js             acesso a dados e componentes
supabase/banco_de_dados.sql     tabelas, regras de segurança, buckets
supabase/functions/midia/       função de servidor (validação e links assinados)
```

## Passo a passo

### 1. Criar o projeto no Supabase
Crie uma conta em supabase.com e um projeto novo. Anote a **URL do projeto** e a **chave pública (anon)** em Project Settings, API.

### 2. Criar o banco
Abra o SQL Editor, cole o conteúdo de `supabase/banco_de_dados.sql` e execute.

### 3. Criar o administrador
1. Em Authentication, Users, clique em Add user e crie seu e-mail e senha.
2. Em Authentication, Sign In / Providers, Email, **desative a criação de novas contas** (Allow new users to sign up). Assim só você tem acesso.
3. No SQL Editor, execute (troque o e-mail):

```sql
insert into public.administradores (user_id)
select id from auth.users where email = 'SEU_EMAIL_AQUI';
```

### 4. Publicar a função de servidor
Instale a CLI do Supabase e, dentro desta pasta:

```
supabase login
supabase link --project-ref SEU_ID_DO_PROJETO
supabase functions deploy midia --no-verify-jwt
```

Opcional, mas recomendado: restringir a função ao seu site e ativar a limpeza automática:

```
supabase secrets set ORIGEM_PERMITIDA=https://seu-site.com
supabase secrets set CRON_SECRET=uma_frase_longa_e_aleatoria
```

### 5. Configurar o site
Edite `js/config.js`: preencha `SUPABASE_URL` e `SUPABASE_ANON_KEY` (somente a chave pública). Ajuste nome, cor e e-mail de contato. Nunca coloque a chave de serviço aqui.

### 6. Hospedar
Envie a pasta inteira (sem a pasta `supabase`) para Netlify, Vercel, Cloudflare Pages ou GitHub Pages. Não há compilação: publique os arquivos como estão. Use HTTPS (necessário para a câmera no celular).

### 7. Limpeza automática (opcional)
Ative as extensões `pg_cron` e `pg_net` e agende:

```sql
select cron.schedule('memora_limpeza', '0 4 * * *', $$
  select net.http_post(
    url := 'https://SEU_PROJETO.supabase.co/functions/v1/midia',
    headers := '{"Content-Type":"application/json","x-cron-secret":"MESMO_SEGREDO"}'::jsonb,
    body := '{"acao":"purgar_agendado"}'::jsonb
  );
$$);
```

## Roteiro de teste (prioridade máxima)
1. Abra o site, vá em Entrar e faça login como administrador.
2. Crie um evento e copie o link público.
3. Abra o link em uma janela anônima, toque em Compartilhar suas fotos e informe um nome. Guarde o código.
4. Envie uma foto e um vídeo de até 30 segundos. Veja o progresso até "Enviado".
5. Confira a foto no álbum do participante e na galeria coletiva.
6. Tente enviar um vídeo longo e um arquivo de outro tipo: deve haver mensagens claras.
7. No painel, encerre os envios e tente enviar de novo: deve ser recusado.
8. Apague o armazenamento local do navegador anônimo e use "Recuperar minha participação" com o código.
9. Teste moderação (remover mídia), denúncia e exclusão do evento.

## Limitações conhecidas (seja transparente com seus usuários)
1. **Duração do vídeo**: é medida no navegador do convidado. O servidor limita o tamanho do arquivo, mas não relê a duração. Alguém mal intencionado poderia enviar um vídeo mais longo.
2. **Limite de requisições**: a função guarda contagens na memória de cada instância. É uma proteção básica. Para proteção forte, use as regras do provedor de hospedagem ou do Supabase.
3. **Tamanho no plano gratuito do Supabase**: o limite por arquivo do plano gratuito é 50 MB. Reduza `LIMITE_ARQUIVO_MB` no config.js, `limite_bytes_por_arquivo` na tabela `configuracoes` e o `file_size_limit` do bucket.
4. **Fotos HEIC**: o armazenamento é do arquivo original, mas nem todo navegador exibe HEIC. Nesse caso a galeria mostra um ícone no lugar da miniatura.
5. **Capa do evento**: usa a foto mais recente publicada. Não há envio de capa própria nesta versão.
6. **Moderação**: lista as 200 mídias mais recentes. Paginação completa fica para a próxima versão.
7. **Links de leitura** expiram em 1 hora e são renovados pelo site. Quem copiar um link direto de arquivo o perderá depois disso.
8. Textos de privacidade e termos são modelos iniciais e devem ser revisados antes de uso público.
9. Não implementado, conforme o pedido: pagamentos, reconhecimento facial, curtidas, comentários, inteligência artificial e aplicativos nativos.
