import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/server";
import { canRead, getUserRoleForProject } from "@/lib/projects/authz";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

function safeFilename(name: string) {
  let n = (name || "design").replace(/[\\/:*?"<>|]/g, "_").replace(/\.[^.]+$/i, "");
  return `${n || "design"}.png`;
}

/** Download a single project asset as PNG (optional ?assetId=). */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await requireUser().catch(() => null);
  if (!user) return NextResponse.json({ detail: "Unauthorized." }, { status: 401 });

  const { id: projectId } = await ctx.params;
  const role = await getUserRoleForProject(user.id, projectId);
  if (!role || !canRead(role)) return NextResponse.json({ detail: "Not found." }, { status: 404 });

  const { searchParams } = new URL(req.url);
  const assetId = searchParams.get("assetId");

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
    order by created_at desc
  `;

  if (!assets.length) {
    return NextResponse.json({ detail: "No images to download." }, { status: 404 });
  }

  const asset = assetId ? assets.find((a: any) => a.id === assetId) : assets[0];
  if (!asset) return NextResponse.json({ detail: "Asset not found." }, { status: 404 });

  try {
    const res = await fetch(asset.url);
    if (!res.ok) {
      return NextResponse.json({ detail: "Could not fetch image." }, { status: 502 });
    }
    const bytes = await res.arrayBuffer();
    const contentType = res.headers.get("content-type") || "image/png";
    const filename = safeFilename(asset.filename || `${asset.id}.png`);

    return new NextResponse(bytes, {
      status: 200,
      headers: {
        "Content-Type": contentType.startsWith("image/") ? contentType : "image/png",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return NextResponse.json({ detail: "Download failed." }, { status: 500 });
  }
}
