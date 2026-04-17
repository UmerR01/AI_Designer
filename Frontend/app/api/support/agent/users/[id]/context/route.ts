import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { requireSupportAgent } from "@/lib/support/auth";

export const dynamic = "force-dynamic";

export async function GET(_: Request, ctx: { params: Promise<{ id: string }> }) {
  const agent = await requireSupportAgent().catch(() => null);
  if (!agent) return NextResponse.json({ detail: "Forbidden." }, { status: 403 });

  const { id } = await ctx.params;

  const userRows = await sql()<{
    id: string;
    email: string;
    first_name: string;
    last_name: string;
    created_at: string;
  }>`
    select id, email, first_name, last_name, created_at
    from users
    where id = ${id}
    limit 1
  `;
  const u = userRows[0];
  if (!u) return NextResponse.json({ detail: "Not found." }, { status: 404 });

  const projects = await sql()<{
    id: string;
    name: string;
    updated_at: string;
  }>`
    select id, name, updated_at
    from projects
    where owner_id = ${id}
    order by updated_at desc
    limit 8
  `;

  const recentConvos = await sql()<{
    id: string;
    status: string;
    last_message_at: string;
  }>`
    select id, status, last_message_at
    from support_conversations
    where user_id = ${id}
    order by last_message_at desc
    limit 10
  `;

  return NextResponse.json(
    {
      user: {
        id: u.id,
        email: u.email,
        first_name: u.first_name,
        last_name: u.last_name,
        created_at: u.created_at,
      },
      projects,
      recentConversations: recentConvos,
    },
    { status: 200 }
  );
}

