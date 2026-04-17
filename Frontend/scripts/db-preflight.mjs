#!/usr/bin/env node
import postgres from "postgres";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
dotenv.config();

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

