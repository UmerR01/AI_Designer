#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import postgres from "postgres";

function arg(name, fallback = "") {
  const raw = process.argv.find((a) => a.startsWith(`${name}=`));
  if (!raw) return fallback;
  return raw.slice(name.length + 1);
}

const projectId = arg("--project-id");
const sourceDir = arg("--source-dir", path.join(process.cwd(), "ui-designer-project", "backend", "ui_designs"));
const dryRun = process.argv.includes("--dry-run");

if (!projectId) {
  console.error("Missing --project-id=<uuid>");
  process.exit(1);
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("Missing DATABASE_URL environment variable.");
  process.exit(1);
}

function listManifestFiles(rootDir) {
  const results = [];
  if (!fs.existsSync(rootDir)) return results;
  const entries = fs.readdirSync(rootDir, { withFileTypes: true });
  for (const entry of entries) {
    const p = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      const candidate = path.join(p, "images.json");
      if (fs.existsSync(candidate)) results.push(candidate);
    }
  }
  return results.sort();
}

const manifests = listManifestFiles(sourceDir);
if (manifests.length === 0) {
  console.log(`No images.json files found in ${sourceDir}`);
  process.exit(0);
}

const sql = postgres(databaseUrl, { prepare: false });

try {
  const batches = [];
  let totalAssets = 0;
  for (const manifestPath of manifests) {
    const folder = path.basename(path.dirname(manifestPath));
    const raw = fs.readFileSync(manifestPath, "utf8");
    const images = JSON.parse(raw);
    if (!Array.isArray(images) || images.length === 0) continue;
    batches.push({ folder, images });
  }

  console.log(`Found ${batches.length} batches to import.`);
  if (dryRun) {
    for (const b of batches) totalAssets += b.images.length;
    console.log(`[dry-run] Would import ${totalAssets} assets into project ${projectId}.`);
    process.exit(0);
  }

  for (const batch of batches) {
    const batchRow = await sql`
      insert into project_asset_batches (project_id, source, prompt)
      values (${projectId}, 'ui-designs-backfill', ${`Backfilled from ${batch.folder}`})
      returning id
    `;
    const batchId = batchRow[0].id;

    for (const image of batch.images) {
      const sourceImageId = typeof image?.id === "string" ? image.id : null;
      const filename = typeof image?.filename === "string" ? image.filename : "image.png";
      const url = typeof image?.url === "string" ? image.url : "";
      if (!url) continue;
      await sql`
        insert into project_assets (
          project_id, batch_id, source_image_id, page_name, filename, url, prompt, mime_type, created_at
        )
        values (
          ${projectId},
          ${batchId},
          ${sourceImageId},
          ${typeof image?.page_name === "string" ? image.page_name : null},
          ${filename},
          ${url},
          ${typeof image?.prompt === "string" ? image.prompt : null},
          'image/png',
          ${typeof image?.created_at === "string" ? image.created_at : new Date().toISOString()}
        )
        on conflict (project_id, source_image_id) where source_image_id is not null
        do update set
          page_name = excluded.page_name,
          filename = excluded.filename,
          url = excluded.url,
          prompt = excluded.prompt,
          created_at = excluded.created_at
      `;
      totalAssets += 1;
    }
  }

  console.log(`Imported ${totalAssets} assets into project ${projectId}.`);
} finally {
  await sql.end({ timeout: 5 });
}

