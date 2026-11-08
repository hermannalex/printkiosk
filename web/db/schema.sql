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
  plan           text not null default 'basic' check (plan in ('basic', 'pro')),
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
  plan              text not null check (plan in ('basic', 'pro')),
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
