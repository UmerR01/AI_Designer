-- Run this once in Neon (same database as DATABASE_URL) if forgot-password fails with:
--   relation "password_reset_tokens" does not exist

create table if not exists password_reset_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  token_hash text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_password_reset_tokens_hash on password_reset_tokens(token_hash);
create index if not exists idx_password_reset_tokens_user_id on password_reset_tokens(user_id);
