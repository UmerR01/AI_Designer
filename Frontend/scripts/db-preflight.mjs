#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import dotenv from "dotenv";

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// Base defaults, then .env.local wins (including over inherited shell DATABASE_URL).
dotenv.config({ path: path.join(frontendRoot, ".env") });
dotenv.config({ path: path.join(frontendRoot, ".env.local"), override: true });

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("Missing DATABASE_URL. Configure Postgres connection first.");
  process.exit(1);
}

const requiredTables = [
  "users",
  "projects",
  "project_members",
  "password_reset_tokens",
  "project_asset_batches",
  "project_assets",
];

const sql = postgres(databaseUrl, { prepare: false });

try {
  await sql`select 1`;
  const rows = await sql`
    select table_name
    from information_schema.tables
    where table_schema = 'public'
  `;
  const tableSet = new Set(rows.map((r) => r.table_name));
  const missing = requiredTables.filter((name) => !tableSet.has(name));
  if (missing.length) {
    console.error(`DB connected, but missing required tables: ${missing.join(", ")}`);
    process.exit(2);
  }
  console.log("Postgres preflight passed. Required tables are present.");
} finally {
  await sql.end({ timeout: 5 });
}

