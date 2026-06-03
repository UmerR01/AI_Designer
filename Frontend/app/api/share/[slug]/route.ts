import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { sql } from "@/lib/db";
import { getOptionalUser } from "@/lib/auth/server";
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

type ShareLinkRow = {
  id: string;
  project_id: string;
  role: "viewer" | "editor";
  visibility: "public" | "password";
  revoked_at: string | null;
};

function linkMeta(slug: string, link: ShareLinkRow) {
  return { slug, role: link.role, visibility: link.visibility };
}

async function loadProjectSummary(projectId: string, includeData: boolean) {
  const proj = await sql()<{
    id: string;
    name: string;
    kind: string;
    data: unknown;
  }>`
    select id, name, kind, data from projects where id = ${projectId} limit 1
  `;
  const project = proj[0];
  if (!project) return null;
  if (!includeData) {
    return { id: project.id, name: project.name, kind: project.kind };
  }
  return project;
}

export async function GET(_: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const user = await getOptionalUser();

  const links = await sql()<ShareLinkRow>`
    select id, project_id, role, visibility, revoked_at
    from project_share_links
    where slug = ${slug}
    limit 1
  `;

  const link = links[0];
  if (!link || link.revoked_at) {
    return NextResponse.json({ detail: "Not found." }, { status: 404 });
  }

  const meta = linkMeta(slug, link);

  // Edit access always requires a signed-in user (never expose project payload anonymously).
  if (link.role === "editor" && !user) {
    if (link.visibility === "password") {
      const token = (await cookies()).get(shareUnlockCookieName(slug))?.value;
      const payload = token ? await verifyShareUnlock(token) : null;
      if (!payload || payload.slug !== slug) {
        return NextResponse.json(
          { locked: true, link: meta, requiresLogin: true },
          { status: 200 },
        );
      }
    }
    return NextResponse.json({ link: meta, requiresLogin: true }, { status: 200 });
  }

  if (link.visibility === "password") {
    const token = (await cookies()).get(shareUnlockCookieName(slug))?.value;
    if (!token) {
      return NextResponse.json(
        {
          locked: true,
          link: meta,
          requiresLogin: link.role === "editor",
        },
        { status: 200 },
      );
    }

    const payload = await verifyShareUnlock(token);
    if (!payload || payload.slug !== slug) {
      return NextResponse.json(
        {
          locked: true,
          link: meta,
          requiresLogin: link.role === "editor",
        },
        { status: 200 },
      );
    }

    const includeData = link.role === "viewer";
    const project = await loadProjectSummary(link.project_id, includeData);
    if (!project) return NextResponse.json({ detail: "Not found." }, { status: 404 });

    const assets =
      link.role === "viewer" ? await loadProjectAssets(link.project_id) : [];

    return NextResponse.json(
      {
        locked: false,
        link: { ...meta, role: payload.role },
        project,
        assets,
      },
      { status: 200 },
    );
  }

  // Public link
  const includeData = link.role === "viewer";
  const project = await loadProjectSummary(link.project_id, includeData);
  if (!project) return NextResponse.json({ detail: "Not found." }, { status: 404 });

  const assets = link.role === "viewer" ? await loadProjectAssets(link.project_id) : [];

  return NextResponse.json(
    { link: meta, project, assets },
    { status: 200 },
  );
}
