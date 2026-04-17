import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth/server";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

const AcceptSchema = z.object({
  token: z.string().min(10).max(200),
});

export async function POST(req: Request) {
  const user = await requireUser().catch(() => null);
  if (!user) return NextResponse.json({ detail: "Unauthorized." }, { status: 401 });

  const json = await req.json().catch(() => null);
  const parsed = AcceptSchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ detail: "Invalid token." }, { status: 400 });

  const token = parsed.data.token;

  const invites = await sql()<{
    id: string;
    project_id: string;
    role: "viewer" | "editor";
    email: string;
    accepted_at: string | null;
  }>`
    select id, project_id, role, email, accepted_at
    from project_invites
    where token = ${token}
    limit 1
  `;

  const invite = invites[0];
  if (!invite) return NextResponse.json({ detail: "Invite not found." }, { status: 404 });

  if (invite.accepted_at) {
    return NextResponse.json({ ok: true, projectId: invite.project_id }, { status: 200 });
  }

  // Mark accepted and add membership. (If already a member, do nothing.)
  await sql()`
    update project_invites set accepted_at = now()
    where id = ${invite.id} and accepted_at is null
  `;

  await sql()`
    insert into project_members (project_id, user_id, role)
    values (${invite.project_id}, ${user.id}, ${invite.role})
    on conflict (project_id, user_id) do update set role = excluded.role
  `;

  return NextResponse.json({ ok: true, projectId: invite.project_id }, { status: 200 });
}

