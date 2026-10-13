/*
  CONFIGURAÇÃO CENTRAL DO SITE

  1. Cole abaixo a URL do seu projeto Supabase e a chave pública (anon).
     A chave pública pode ficar no navegador. NUNCA cole aqui a chave de serviço.
  2. Para mudar o nome ou a cor da marca, altere só o bloco MARCA.
*/
export const CONFIG = {
  SUPABASE_URL: "https://viuzanlbfskdttnufscv.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_8c-Q5viYN4bBd_CD6yHjhA_u9pyUdZr",

  MARCA: {
    nome: "Memora",
    corDestaque: "#b4694e",
    emailContato: "contato@exemplo.com",
  },

  /* Devem ser iguais (ou menores) aos limites do banco (tabela configuracoes) */
  LIMITE_VIDEO_SEGUNDOS: 30,
  LIMITE_ARQUIVO_MB: 50,

  /* Opcional: endereço público do site, usado nos links e no QR Code.
     Deixe vazio para usar o endereço atual do navegador. */
  URL_BASE: "",
};

export const configurado = () =>
  Boolean(CONFIG.SUPABASE_URL && CONFIG.SUPABASE_ANON_KEY);
