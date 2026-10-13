import { CONFIG } from "./config.js";
import { app, cabecalho, rodape, esc, icone, mensagemTela } from "./ui.js";

export function landing() {
  const nome = esc(CONFIG.MARCA.nome);
  app().innerHTML = `
  ${cabecalho(`<a class="btn btn-pequeno" href="#/admin">Entrar</a>`)}
  <main>
    <section class="heroi contido">
      <p class="sobretitulo">${nome}</p>
      <h1>Todas as memórias de um evento, em um só lugar.</h1>
      <p class="lead">Seus convidados compartilham fotos e vídeos com facilidade, direto do celular, sem precisar criar uma conta.</p>
      <div class="acoes"><a class="btn btn-principal btn-grande" href="#/admin">Criar meu evento</a></div>
    </section>

    <section class="contido" aria-label="Prévia de uma galeria coletiva">
      <div class="mosaico" role="img" aria-label="Ilustração de uma galeria coletiva com várias fotos e um vídeo">
        <span class="m1"></span><span class="m2"></span><span class="m3"><i>${icone("play", 22)}</i></span>
        <span class="m4"></span><span class="m5"></span><span class="m6"></span><span class="m7"></span><span class="m8"></span>
      </div>
      <p class="legenda-mosaico">Ilustração. Aqui aparecem as fotos e vídeos reais enviados pelos seus convidados.</p>
    </section>

    <section class="contido secao" id="como-funciona">
      <h2>Como funciona</h2>
      <ol class="passos">
        <li><span class="numero">1</span><h3>Crie um evento</h3><p>Dê um nome, escolha o tipo e pronto. Leva menos de um minuto.</p></li>
        <li><span class="numero">2</span><h3>Compartilhe o link ou QR Code</h3><p>Envie para os convidados ou deixe o QR Code à vista na festa.</p></li>
        <li><span class="numero">3</span><h3>Reúna as memórias</h3><p>Cada pessoa tem seu álbum, e tudo aparece também na galeria coletiva.</p></li>
      </ol>
    </section>

    <section class="contido secao">
      <h2>Feito para guardar bem</h2>
      <div class="beneficios">
        <article><h3>Simplicidade</h3><p>O convidado informa só o nome e escolhe as fotos. Sem cadastro, sem e-mail, sem telefone.</p></article>
        <article><h3>Qualidade original</h3><p>Os arquivos são guardados como foram enviados, sem recompressão. As miniaturas servem apenas para a galeria carregar rápido.</p></article>
        <article><h3>Álbuns individuais</h3><p>Cada participante tem o seu álbum, com o nome de quem enviou em cada memória.</p></article>
      </div>
    </section>
  </main>
  ${rodape()}`;
}

export function naoConfigurado() {
  mensagemTela(
    "Falta configurar o site",
    "Abra o arquivo js/config.js e preencha a URL do projeto Supabase e a chave pública. O passo a passo está no arquivo LEIA-ME.md.",
    `<a class="btn" href="#/">Voltar ao início</a>`
  );
}

export function naoEncontrada() {
  mensagemTela("Página não encontrada", "O endereço que você abriu não existe.", `<a class="btn btn-principal" href="#/">Ir para o início</a>`);
}

const TEXTOS = {
  privacidade: {
    titulo: "Política de privacidade",
    corpo: `
      <p><strong>Modelo inicial.</strong> Este texto é um ponto de partida e deve ser revisado por um profissional antes da publicação oficial.</p>
      <h2>O que coletamos</h2>
      <p>De convidados: apenas o nome público informado ao participar e as fotos e vídeos que a própria pessoa decidir enviar. Não pedimos e-mail nem telefone.</p>
      <p>Do administrador: e-mail e senha de acesso, usados somente para autenticação.</p>
      <h2>Como os arquivos são usados</h2>
      <p>As mídias ficam disponíveis a quem tiver o link do evento. O link pode ser encaminhado a terceiros, e quem o receber poderá ver as memórias do evento.</p>
      <h2>Vínculo no navegador</h2>
      <p>Guardamos no navegador do convidado um código que prova que aquela participação é dele. Esse código permite excluir as próprias mídias. Guarde o código de recuperação mostrado ao entrar.</p>
      <h2>Exclusão</h2>
      <p>Cada participante pode excluir as próprias mídias. O administrador pode remover qualquer mídia e excluir o evento. Os arquivos removidos são apagados definitivamente conforme o prazo de retenção do serviço.</p>`,
  },
  termos: {
    titulo: "Termos de uso",
    corpo: `
      <p><strong>Modelo inicial.</strong> Revise com um profissional antes da publicação oficial.</p>
      <h2>Uso permitido</h2>
      <p>Envie apenas conteúdo que você tem direito de compartilhar e que respeite as pessoas retratadas. Conteúdo ilegal, ofensivo ou que viole direitos de terceiros pode ser removido pelo administrador.</p>
      <h2>Limites técnicos</h2>
      <p>Cada arquivo tem tamanho máximo, e vídeos têm no máximo 30 segundos. O serviço pode bloquear novos envios quando a capacidade de armazenamento for atingida.</p>
      <h2>Disponibilidade</h2>
      <p>O evento permanece disponível enquanto não for excluído pelo administrador, sujeito à disponibilidade e às condições do serviço de armazenamento.</p>
      <h2>Denúncias</h2>
      <p>Qualquer convidado pode denunciar uma mídia. O administrador do evento analisa e decide sobre a remoção.</p>`,
  },
  contato: {
    titulo: "Contato",
    corpo: `<p>Para dúvidas, pedidos de remoção ou sugestões, escreva para <a href="mailto:${esc(CONFIG.MARCA.emailContato)}">${esc(CONFIG.MARCA.emailContato)}</a>.</p>`,
  },
};

export function paginaLegal(_ctx, qual) {
  const t = TEXTOS[qual];
  app().innerHTML = `${cabecalho()}<main class="contido estreito texto-longo"><h1>${esc(t.titulo)}</h1>${t.corpo}</main>${rodape()}`;
}
