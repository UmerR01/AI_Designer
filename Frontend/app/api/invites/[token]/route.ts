import { NextResponse } from "next/server";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Public invite metadata (for login redirect + accept UI). */
export async function GET(_: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;

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

  const projects = await sql()<{ name: string }>`
    select name from projects where id = ${invite.project_id} limit 1
  `;

  return NextResponse.json(
    {
      invite: {
        token,
        projectId: invite.project_id,
        projectName: projects[0]?.name ?? "Untitled",
        role: invite.role,
        email: invite.email,
        accepted: Boolean(invite.accepted_at),
      },
    },
    { status: 200 },
  );
}
