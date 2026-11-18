-- PrintKiosk – banco de dados do painel (Neon Postgres)

create table if not exists users (
  id            bigserial primary key,
  email         text not null unique,
  name          text not null,
  password_hash text not null,
  role          text not null default 'owner' check (role in ('owner', 'master')),
  phone         text,
  blocked       boolean not null default false,
  created_at    timestamptz not null default now()
);

-- One row per kiosk install (iPad, iPhone or Android tablet).
create table if not exists kiosks (
  id             bigserial primary key,
  store_code     text not null unique,              -- "ABCD-EFGH", shown in the app
  secret_hash    text,                              -- set on the kiosk's first contact
  owner_id       bigint references users(id) on delete set null,
  name           text not null default 'Quiosque',
  plan           text not null default 'basic' check (plan in ('basic', 'pro', 'enterprise')),
  paid_until     date,                              -- last valid day of the subscription
  platform       text,
  app_version    text,
  license_state  text,
  demo_remaining int,
  last_seen_at   timestamptz,
  created_at     timestamptz not null default now()
);
create index if not exists kiosks_owner_idx on kiosks(owner_id);

-- Mercado Pago recurring subscription (preapproval) for one kiosk.
create table if not exists subscriptions (
  id                bigserial primary key,
  kiosk_id          bigint not null references kiosks(id) on delete cascade,
  owner_id          bigint not null references users(id) on delete cascade,
  plan              text not null check (plan in ('basic', 'pro', 'enterprise')),
  amount_cents      int not null,
  status            text not null default 'pending',   -- pending | authorized | paused | cancelled
  mp_preapproval_id text unique,
  init_point        text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists subscriptions_kiosk_idx on subscriptions(kiosk_id);

-- Monthly charges received for subscriptions (or marked as paid by the master).
create table if not exists payments (
  id              bigserial primary key,
  subscription_id bigint references subscriptions(id) on delete set null,
  kiosk_id        bigint references kiosks(id) on delete set null,
  owner_id        bigint references users(id) on delete set null,
  amount_cents    int not null,
  status          text not null,                        -- approved | rejected | manual
  mp_payment_id   text unique,
  paid_at         timestamptz not null default now(),
  note            text
);

create table if not exists activation_codes (
  id          bigserial primary key,
  kiosk_id    bigint not null references kiosks(id) on delete cascade,
  code        text not null,
  valid_until date not null,
  source      text not null default 'manual',           -- manual | payment | auto
  created_by  bigint references users(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists activation_codes_kiosk_idx on activation_codes(kiosk_id, valid_until desc);

-- Each print job the kiosk reports (sent in batches, retried when offline).
create table if not exists print_jobs (
  id            bigserial primary key,
  kiosk_id      bigint not null references kiosks(id) on delete cascade,
  client_id     text not null,                          -- id made by the app, to ignore duplicates
  printed_at    timestamptz not null,
  items         int not null,
  pages         int not null,                           -- pages of one copy
  copies        int not null,
  total_pages   int not null,
  amount_cents  int not null default 0,                 -- Pix received for this job
  paid_with_pix boolean not null default false,
  pix_payment_id text,
  success       boolean not null default true,
  demo          boolean not null default false,
  unique (kiosk_id, client_id)
);
create index if not exists print_jobs_kiosk_time_idx on print_jobs(kiosk_id, printed_at desc);

-- ---------------------------------------------------------------- security (2026-11)

-- Login sessions. The cookie holds a random token; only its SHA-256 is stored, so a
-- database leak can't be replayed, and logout / blocking a user ends the session for real.
create table if not exists sessions (
  id_hash      text primary key,
  user_id      bigint not null references users(id) on delete cascade,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null,
  ip           text,
  user_agent   text
);
create index if not exists sessions_user_idx on sessions(user_id);
create index if not exists sessions_expires_idx on sessions(expires_at);

-- Fixed-window counters for login, sign-up, kiosk sync, pairing and webhook calls.
create table if not exists rate_limits (
  key          text primary key,
  window_start timestamptz not null,
  hits         int not null
);

-- Who did what: logins, master actions, kiosk pairing.
create table if not exists audit_log (
  id         bigserial primary key,
  user_id    bigint references users(id) on delete set null,
  action     text not null,
  target     text,
  detail     text,
  ip         text,
  created_at timestamptz not null default now()
);
create index if not exists audit_log_created_idx on audit_log(created_at desc);

-- ---------------------------------------------------------------- two-factor authentication (2026-11)

-- TOTP (authenticator app), required for every account. Secrets are AES-GCM sealed with a key
-- derived from SESSION_SECRET; recovery codes are stored as SHA-256 hashes, used once each.
alter table users
  add column if not exists totp_secret    text,
  add column if not exists totp_pending   text,             -- set up but not yet confirmed
  add column if not exists totp_enabled   boolean not null default false,
  add column if not exists totp_last_step bigint,           -- last accepted 30 s step: a code works once
  add column if not exists recovery_codes text[] not null default '{}';

-- Password accepted, second factor still owed. The cookie holds a random token; only its hash is here.
create table if not exists login_challenges (
  id_hash    text primary key,
  user_id    bigint not null references users(id) on delete cascade,
  expires_at timestamptz not null,
  attempts   int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists login_challenges_user_idx on login_challenges(user_id);

-- Entrar com Google: o "sub" da conta Google vinculada (o e-mail pode mudar, o sub não).
alter table users add column if not exists google_sub text unique;

-- Configurações do app definidas no painel (lib/kiosk-config.ts). config_version sobe a cada mudança;
-- o quiosque aplica quando a versão é maior que a última que ele já aplicou (applied_config_version).
-- reported_config é o que o app está usando agora, enviado a cada sincronização.
alter table kiosks add column if not exists config jsonb;
alter table kiosks add column if not exists config_version int not null default 0;
alter table kiosks add column if not exists reported_config jsonb;
alter table kiosks add column if not exists applied_config_version int;

-- Forma de pagamento de cada impressão: 'pix', 'card' (maquininha Point: cartão, aproximação,
-- Apple Pay, Google Pay) ou null (grátis/demonstração). pix_payment_id guarda o id de qualquer um.
alter table print_jobs add column if not exists payment_method text check (payment_method in ('pix','card'));
update print_jobs set payment_method = 'pix' where paid_with_pix and payment_method is null;

-- Vouchers de crédito: a loja cria códigos com saldo em reais; o cliente digita o código no
-- quiosque e o valor da impressão é descontado. Valem em qualquer quiosque da mesma loja (dono).
create table if not exists vouchers (
  id             bigserial primary key,
  owner_id       bigint not null references users(id) on delete cascade,
  code           text not null unique,                 -- "ABCDE-23456", sem letras ambíguas
  value_cents    int not null check (value_cents between 1 and 100000),
  balance_cents  int not null check (balance_cents >= 0),
  note           text,
  batch          text not null,                        -- vouchers criados juntos (para imprimir)
  expires_on     date,
  disabled       boolean not null default false,
  created_at     timestamptz not null default now(),
  last_used_at   timestamptz
);
create index if not exists vouchers_owner_idx on vouchers(owner_id, created_at desc);

-- Cada uso, com a referência do quiosque: repetir o mesmo pedido não desconta duas vezes.
create table if not exists voucher_uses (
  id             bigserial primary key,
  voucher_id     bigint not null references vouchers(id) on delete cascade,
  kiosk_id       bigint not null references kiosks(id) on delete cascade,
  ref            text not null,
  amount_cents   int not null,
  balance_after  int not null,
  refunded       boolean not null default false,
  created_at     timestamptz not null default now(),
  unique (kiosk_id, ref)
);
create index if not exists voucher_uses_voucher_idx on voucher_uses(voucher_id, created_at desc);
alter table print_jobs drop constraint if exists print_jobs_payment_method_check;
alter table print_jobs add constraint print_jobs_payment_method_check check (payment_method in ('pix','card','voucher'));
grant select, insert, update, delete on vouchers, voucher_uses to printkiosk_app;
grant usage, select on sequence vouchers_id_seq, voucher_uses_id_seq to printkiosk_app;

-- Segundo fator por e-mail (Resend), alternativa ao aplicativo autenticador. Uma conta usa um dos dois.
alter table users add column if not exists email_mfa_enabled boolean not null default false;

-- Códigos de 6 números enviados por e-mail: só o HMAC (chave SESSION_SECRET) fica aqui; um por conta e finalidade.
create table if not exists email_codes (
  user_id    bigint not null references users(id) on delete cascade,
  purpose    text not null check (purpose in ('login','setup')),
  code_hash  text not null,
  expires_at timestamptz not null,
  attempts   int not null default 0,
  sent_at    timestamptz not null default now(),
  primary key (user_id, purpose)
);

-- Envio de arquivos pela internet (Wi-Fi ou 4G/5G): o quiosque abre uma sessão, o celular do cliente
-- envia para o Vercel Blob (privado, em relay/<código>/) e o quiosque baixa e apaga. Sessões valem 30 minutos.
create table if not exists relay_sessions (
  code        text primary key,
  secret_hash text not null,
  kiosk_name  text not null default '',
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  closed_at   timestamptz
);
create index if not exists relay_sessions_expires_idx on relay_sessions(expires_at);
grant select, insert, update, delete on relay_sessions to printkiosk_app;

-- ---------------------------------------------------------------- loja online (plano Enterprise)
-- One online store per owner: a public page where customers sign up, upload files, choose options
-- and pay with Pix online into the store's own Mercado Pago account.
create table if not exists stores (
  id            bigserial primary key,
  owner_id      bigint not null unique references users(id) on delete cascade,
  slug          text not null unique,
  name          text not null,
  published     boolean not null default false,
  pickup_info   text not null default '',          -- where/when to pick up, shown to customers
  config        jsonb not null default '{}'::jsonb, -- sizes, prices and extras
  mp_token_enc  text,                               -- Mercado Pago Access Token, AES-256-GCM
  mp_token_tail text,                               -- last 4 characters, to show in the dashboard
  notify_email  text,                               -- new paid orders go here (default: owner's e-mail)
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Customers of one store (name, e-mail, password). Separate from the dashboard users.
create table if not exists store_customers (
  id            bigserial primary key,
  store_id      bigint not null references stores(id) on delete cascade,
  name          text not null,
  email         text not null,
  password_hash text not null,
  created_at    timestamptz not null default now(),
  unique (store_id, email)
);

create table if not exists customer_sessions (
  id_hash     text primary key,
  customer_id bigint not null references store_customers(id) on delete cascade,
  expires_at  timestamptz not null,
  created_at  timestamptz not null default now()
);

create table if not exists store_orders (
  id            bigserial primary key,
  store_id      bigint not null references stores(id) on delete cascade,
  customer_id   bigint references store_customers(id) on delete set null,
  code          text not null unique,               -- short public code, e.g. "K7P4QX"
  status        text not null default 'awaiting_payment'
                check (status in ('awaiting_payment', 'paid', 'printing', 'ready', 'delivered', 'cancelled', 'expired')),
  total_cents   int not null,
  note          text not null default '',
  mp_payment_id text,
  pix_qr        text,                                -- Pix copia e cola
  pix_qr_base64 text,
  pay_expires_at timestamptz,
  paid_at       timestamptz,
  ready_at      timestamptz,
  delivered_at  timestamptz,
  files_deleted_at timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists store_orders_store_idx on store_orders(store_id, created_at desc);
create index if not exists store_orders_customer_idx on store_orders(customer_id, created_at desc);

create table if not exists store_order_items (
  id          bigserial primary key,
  order_id    bigint not null references store_orders(id) on delete cascade,
  pathname    text not null,                         -- private Vercel Blob path
  file_name   text not null,
  kind        text not null check (kind in ('pdf', 'image')),
  size_bytes  bigint not null,
  pages       int not null,
  paper       text not null,                         -- size id from the store config (a4, a3…)
  color       boolean not null,
  copies      int not null,
  extras      jsonb not null default '[]'::jsonb,    -- ids of the chosen extras
  total_cents int not null
);
create index if not exists store_order_items_order_idx on store_order_items(order_id);

grant select, insert, update, delete on stores, store_customers, customer_sessions, store_orders, store_order_items to printkiosk_app;
grant usage, select on sequence stores_id_seq, store_customers_id_seq, store_orders_id_seq, store_order_items_id_seq to printkiosk_app;
