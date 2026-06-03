import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { sql } from "@/lib/db";

let appSchemaReady = false;

export function resetAppSchemaCache() {
  appSchemaReady = false;
}

function resolveSchemaSqlPath(): string | null {
  const candidates = [
    join(process.cwd(), "scripts", "schema.sql"),
    join(process.cwd(), "Frontend", "scripts", "schema.sql"),
  ];
  return candidates.find((p) => existsSync(p)) ?? null;
}

/** Minimal DDL if schema.sql is not on disk (e.g. standalone build without scripts/). */
async function ensureCoreTablesInline() {
  const db = sql();
  await db.unsafe(`create extension if not exists pgcrypto`);
  await db.unsafe(`
    create table if not exists projects (
      id uuid primary key default gen_random_uuid(),
      owner_id uuid not null references users(id) on delete cascade,
      name text not null,
      kind text not null default 'ui/ux design',
      data jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    create index if not exists idx_projects_owner_id on projects(owner_id);
    alter table projects add column if not exists deleted_at timestamptz;
  `);
  await db.unsafe(`
    create table if not exists project_members (
      project_id uuid not null references projects(id) on delete cascade,
      user_id uuid not null references users(id) on delete cascade,
      role text not null,
      created_at timestamptz not null default now(),
      primary key (project_id, user_id),
      constraint chk_project_members_role check (role in ('owner','editor','viewer'))
    );
    create table if not exists project_share_links (
      id uuid primary key default gen_random_uuid(),
      project_id uuid not null references projects(id) on delete cascade,
      slug text not null unique,
      role text not null,
      visibility text not null,
      password_hash text,
      created_at timestamptz not null default now(),
      revoked_at timestamptz
    );
    create table if not exists project_assets (
      id uuid primary key default gen_random_uuid(),
      project_id uuid not null references projects(id) on delete cascade,
      filename text not null,
      url text not null,
      page_name text,
      variant integer not null default 1,
      created_at timestamptz not null default now()
    );
  `);
}

/** Run idempotent DDL from scripts/schema.sql (safe if tables already exist). */
async function runSchemaSqlFile() {
  const path = resolveSchemaSqlPath();
  if (!path) {
    await ensureCoreTablesInline();
    return;
  }

  const raw = readFileSync(path, "utf8");
  const statements = raw
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const db = sql();
  for (const statement of statements) {
    await db.unsafe(statement);
  }

  await db.unsafe(`
    alter table projects
      add column if not exists deleted_at timestamptz;
    create index if not exists idx_projects_deleted_at
      on projects(deleted_at)
      where deleted_at is not null;
  `);
}

/**
 * Ensures all app tables exist (projects, members, sharing, assets, support).
 * Login previously only created \`users\`, which breaks project creation on fresh servers.
 */
export async function ensureAppSchema() {
  if (appSchemaReady) return;
  await runSchemaSqlFile();
  appSchemaReady = true;
}
