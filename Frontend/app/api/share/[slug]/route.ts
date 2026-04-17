import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { sql } from "@/lib/db";
import { shareUnlockCookieName, verifyShareUnlock } from "@/lib/auth/share";

export const dynamic = "force-dynamic";

async function loadProjectAssets(projectId: string) {
  const rows = await sql()<{
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
    limit 200
  `;
  return rows.map((r) => ({
    id: r.id,
    page_name: r.page_name ?? undefined,
    filename: r.filename,
    url: r.url,
    created_at: r.created_at,
  }));
}

export async function GET(_: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;

  const links = await sql()<{
    id: string;
    project_id: string;
    role: "viewer" | "editor";
    visibility: "public" | "password";
    revoked_at: string | null;
  }>`
    select id, project_id, role, visibility, revoked_at
    from project_share_links
    where slug = ${slug}
    limit 1
  `;

  const link = links[0];
  if (!link || link.revoked_at) return NextResponse.json({ detail: "Not found." }, { status: 404 });

  if (link.visibility === "public") {
    const proj = await sql()<{
      id: string;
      name: string;
      kind: string;
      data: unknown;
    }>`
      select id, name, kind, data from projects where id = ${link.project_id} limit 1
    `;
    const project = proj[0];
    if (!project) return NextResponse.json({ detail: "Not found." }, { status: 404 });
    const assets = await loadProjectAssets(link.project_id);
    return NextResponse.json({ link: { slug, role: link.role, visibility: link.visibility }, project, assets }, { status: 200 });
  }

  // Password link: require unlock cookie
  const token = (await cookies()).get(shareUnlockCookieName(slug))?.value;
  if (!token) return NextResponse.json({ locked: true, link: { slug, role: link.role, visibility: link.visibility } }, { status: 200 });

  const payload = await verifyShareUnlock(token);
  if (!payload || payload.slug !== slug) {
    return NextResponse.json({ locked: true, link: { slug, role: link.role, visibility: link.visibility } }, { status: 200 });
  }

  const proj = await sql()<{
    id: string;
    name: string;
    kind: string;
    data: unknown;
  }>`
    select id, name, kind, data from projects where id = ${link.project_id} limit 1
  `;
  const project = proj[0];
  if (!project) return NextResponse.json({ detail: "Not found." }, { status: 404 });
  const assets = await loadProjectAssets(link.project_id);

  return NextResponse.json(
    { locked: false, link: { slug, role: payload.role, visibility: link.visibility }, project, assets },
    { status: 200 }
  );
}

