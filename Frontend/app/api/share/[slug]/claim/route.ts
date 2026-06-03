import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { requireUser } from "@/lib/auth/server";
import { sql } from "@/lib/db";
import { shareUnlockCookieName, verifyShareUnlock } from "@/lib/auth/share";
import { getUserRoleForProject } from "@/lib/projects/authz";

export const dynamic = "force-dynamic";

async function resolveShareLink(slug: string) {
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
  if (!link || link.revoked_at) return null;

  if (link.visibility === "password") {
    const token = (await cookies()).get(shareUnlockCookieName(slug))?.value;
    if (!token) return null;
    const payload = await verifyShareUnlock(token);
    if (!payload || payload.slug !== slug) return null;
  }

  return link;
}

/** Grant signed-in user editor access from a valid edit share link. */
export async function POST(_: Request, ctx: { params: Promise<{ slug: string }> }) {
  const user = await requireUser().catch(() => null);
  if (!user) return NextResponse.json({ detail: "Unauthorized." }, { status: 401 });

  const { slug } = await ctx.params;
  const link = await resolveShareLink(slug);
  if (!link) return NextResponse.json({ detail: "Not found." }, { status: 404 });

  if (link.role !== "editor") {
    return NextResponse.json({ detail: "This link is view-only." }, { status: 403 });
  }

  const existing = await getUserRoleForProject(user.id, link.project_id);
  if (existing === "owner") {
    return NextResponse.json({ projectId: link.project_id, role: "owner" }, { status: 200 });
  }

  if (!existing) {
    await sql()`
      insert into project_members (project_id, user_id, role)
      values (${link.project_id}, ${user.id}, 'editor')
      on conflict (project_id, user_id) do update set role = 'editor'
    `;
  }

  return NextResponse.json({ projectId: link.project_id, role: existing ?? "editor" }, { status: 200 });
}
