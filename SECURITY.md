# Segurança do Quioco

## Como relatar um problema
Envie para alex@somainfo.com.br. Não abra issue pública com detalhes de uma falha.

## O que protege o sistema

**Apps (iPad/iPhone e Android)**
- Configurações exigem um PIN do atendente: sem PIN padrão, de 6 a 12 números, sem sequências.
  Fica guardado só o hash (PBKDF2), no Keychain do iOS ou no armazenamento privado do Android, sem backup.
- 5 PINs errados bloqueiam as Configurações por 1 minuto, dobrando a cada novo erro (até 1 hora).
- O token do Mercado Pago fica no Keychain (iOS) ou cifrado com chave do Android Keystore.
- Cada aparelho tem um segredo próprio, que o painel liga ao código da loja na primeira conexão.
- O código de vinculação (derivado desse segredo) só aparece nas Configurações e é exigido para ligar o quiosque a uma conta.
- Códigos de ativação são assinados (ECDSA P-256); a chave privada nunca entra no app nem no repositório.

**Painel (Vercel)**
- Senhas com scrypt (N=2^15), mínimo de 10 caracteres.
- Sessões no banco (só o hash do token), cookie `__Host-` HttpOnly/Secure/SameSite=Lax;
  master expira em 12 h, lojas em 14 dias; sair ou bloquear a conta encerra a sessão na hora.
- Limite de tentativas: login (20/15 min por IP, 8/15 min por e-mail), cadastro, vínculo de quiosque,
  assinatura, API dos quiosques e webhook.
- Registro de auditoria (Master › Auditoria): entradas, senhas erradas, vínculos e ações do master.
- CSP com nonce por página, HSTS, X-Frame-Options DENY, nosniff, Referrer-Policy, Permissions-Policy, COOP/CORP.
- Webhook do Mercado Pago: cada evento é relido na API do Mercado Pago com o nosso token, e um mês só é
  liberado se o valor aprovado cobre o plano. A conferência da assinatura `x-signature` está desligada;
  para religar, crie `MERCADOPAGO_WEBHOOK_VERIFY=1` (com `MERCADOPAGO_WEBHOOK_SECRET` correto) e publique.
- Prévias (preview) da Vercel exigem login na Vercel.

**Banco (Neon)**
- O painel conecta com o usuário `printkiosk_app`, que só lê e grava dados (não cria nem apaga tabelas).
  Mudanças de estrutura usam o `neondb_owner` pelo console da Neon.
- Conexão sempre com TLS (`sslmode=require`, `channel_binding=require`).

## Segredos
Ficam só nas variáveis de ambiente da Vercel (tipo Sensitive) e nunca no repositório:
`DATABASE_URL`, `LICENSE_PRIVATE_KEY`, `MERCADOPAGO_ACCESS_TOKEN`, `MERCADOPAGO_WEBHOOK_SECRET`, `MASTER_SETUP_CODE`.
O arquivo `.gitignore` bloqueia `*.pem` e `.env*`.

## Entrar com Google

- OpenID Connect com PKCE, `state` e `nonce`; só aceita e-mail verificado pelo Google.
- O Google substitui a senha, não a verificação em duas etapas: o código do aplicativo continua obrigatório.
- Conta com o mesmo e-mail é vinculada pelo `sub` do Google. O e-mail master não é criado pelo Google.
- Precisa de `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET` (Sensitive) na Vercel; sem eles o botão não aparece.

## Backups

- **Neon:** snapshots automáticos do banco todo dia (guardados 14 dias) e toda semana (35 dias).
- **Fora do Neon:** todo dia às 3h (Brasília) o Vercel Cron chama `/api/cron/backup` (protegido por `CRON_SECRET`),
  que exporta todas as tabelas, criptografa (AES-256-GCM com chave embrulhada por RSA-4096) e grava no
  armazenamento privado `quioco-backups` do Vercel Blob. Guarda 35 dias, nunca menos que os 7 últimos.
- O servidor só tem a chave **pública** (`web/lib/backup-public-key.ts`). A chave **privada** fica fora da internet,
  com o dono do Quioco; sem ela nenhum backup abre. Nunca coloque a chave privada no repositório.
- Master › Backups mostra os arquivos, faz backup na hora e baixa cópias para guardar offline (ex.: pendrive, uma vez por mês).
- Restaurar: `node tools/restaurar-backup.mjs arquivo.qbk chave-privada.pem --sql` (na pasta `web`) gera um `.json`
  e um `.sql`; crie um banco vazio com `db/schema.sql` e rode o `.sql` nele.
- Teste a restauração a cada poucos meses: um backup que nunca foi aberto não é garantia.

## Rotina recomendada
- Aceitar os pull requests do Dependabot com correções de segurança.
- Olhar Master › Auditoria de vez em quando, procurando senhas erradas em sequência ou vínculos recusados.
- Trocar o token do Mercado Pago se alguém que teve acesso a ele sair da equipe.
- Guardar uma cópia da chave privada das licenças fora do computador (pendrive ou cofre de senhas).
