#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const path = join(root, "package.json");

try {
  const raw = readFileSync(path, "utf8");
  if (raw.charCodeAt(0) === 0xfeff) {
    throw new Error("package.json must not include a UTF-8 BOM. Re-save as UTF-8 without BOM.");
  }
  if (raw.includes("\u0000")) {
    throw new Error("package.json contains null bytes (likely UTF-16). Re-save as UTF-8.");
  }
  JSON.parse(raw);
} catch (err) {
  console.error(`[validate-package-json] Invalid ${path}`);
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
