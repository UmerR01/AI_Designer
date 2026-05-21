#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import dotenv from "dotenv";

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// Load environment variables
dotenv.config({ path: path.join(frontendRoot, ".env") });
dotenv.config({ path: path.join(frontendRoot, ".env.local"), override: true });

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("Missing DATABASE_URL. Configure Postgres connection first.");
  process.exit(1);
}

const query = process.argv[2];
if (!query) {
  console.log("Usage: node scripts/query.mjs \"YOUR SQL QUERY\"");
  console.log("Example: node scripts/query.mjs \"SELECT id, email, first_name, email_verified FROM users\"");
  process.exit(0);
}

const sql = postgres(databaseUrl, { prepare: false });

try {
  const result = await sql.unsafe(query);
  console.log(JSON.stringify(result, null, 2));
} catch (err) {
  console.error("Error executing query:", err.message);
} finally {
  await sql.end({ timeout: 5 });
}
