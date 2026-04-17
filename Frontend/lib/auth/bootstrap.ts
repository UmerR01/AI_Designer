import { sql } from "@/lib/db";
 
let authSchemaReady = false;
 
/**
 * Production safety net:
 * If migrations were skipped on a new Postgres deployment, ensure the core auth table exists.
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
      created_at timestamptz not null default now()
    )
  `;
  await sql()`
    create index if not exists idx_users_is_support_agent
    on users(is_support_agent)
    where is_support_agent = true
  `;
  authSchemaReady = true;
}