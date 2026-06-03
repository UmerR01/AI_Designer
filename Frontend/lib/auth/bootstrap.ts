import { sql } from "@/lib/db";
import { ensureAppSchema } from "@/lib/db/ensure-app-schema";

let authSchemaReady = false;

/**
 * Production safety net when Alembic was not run: users + full app schema.
 */
export async function ensureAuthSchema() {
  if (authSchemaReady) return;

  await sql()`
    create extension if not exists pgcrypto
  `;
  await sql()`
    create table if not exists users (
      id uuid primary key default gen_random_uuid(),
      email text not null unique,
      first_name text not null,
      last_name text not null,
      is_support_agent boolean not null default false,
      password_hash text not null,
      email_verified boolean not null default false,
      created_at timestamptz not null default now()
    )
  `;
  await sql()`
    alter table users add column if not exists email_verified boolean not null default false;
  `;
  await sql()`
    create index if not exists idx_users_is_support_agent
    on users(is_support_agent)
    where is_support_agent = true
  `;

  await ensureAppSchema();
  authSchemaReady = true;
}
