import { NextResponse } from "next/server";
import JSZip from "jszip";
import { requireUser } from "@/lib/auth/server";
import { canRead, getUserRoleForProject } from "@/lib/projects/authz";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(_: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await requireUser().catch(() => null);
  if (!user) return NextResponse.json({ detail: "Unauthorized." }, { status: 401 });

  const { id: projectId } = await ctx.params;
  const role = await getUserRoleForProject(user.id, projectId);
  if (!role || !canRead(role)) return NextResponse.json({ detail: "Not found." }, { status: 404 });

  const projectRows = await sql()<{
    id: string;
    name: string;
    kind: string;
    data: unknown;
  }>`
    select id, name, kind, data
    from projects
    where id = ${projectId}
    limit 1
  `;
  const project = projectRows[0];
  if (!project) return NextResponse.json({ detail: "Not found." }, { status: 404 });

  const assets = await sql()<{
    id: string;
    page_name: string | null;
    filename: string;
    url: string;
    created_at: string;
  }>`
    select id, page_name, filename, url, created_at
    from project_assets
    where project_id = ${projectId}
    order by created_at asc
  `;

  const zip = new JSZip();
  zip.file(
    "project.json",
    JSON.stringify(
      {
        id: project.id,
        name: project.name,
        kind: project.kind,
        data: project.data ?? {},
        exportedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );

  const assetsFolder = zip.folder("assets");
  if (assetsFolder) {
    for (const asset of assets) {
      try {
        const res = await fetch(asset.url);
        if (!res.ok) continue;
        const bytes = await res.arrayBuffer();
        const safeName = (asset.filename || `${asset.id}.png`).replace(/[\\/:*?"<>|]/g, "_");
        assetsFolder.file(safeName, bytes);
      } catch {
        // Skip unreachable asset URLs; manifest still exports metadata.
      }
    }
  }

  zip.file(
    "assets-manifest.json",
    JSON.stringify(
      assets.map((a) => ({
        id: a.id,
        page_name: a.page_name ?? undefined,
        filename: a.filename,
        url: a.url,
        created_at: a.created_at,
      })),
      null,
      2,
    ),
  );

  const archive = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 6 } });
  const filename = `${project.name || "project"}-${project.id}.zip`.replace(/[\\/:*?"<>|]/g, "_");
  return new NextResponse(archive, {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

