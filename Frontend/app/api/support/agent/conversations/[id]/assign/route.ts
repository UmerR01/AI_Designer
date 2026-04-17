import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { requireSupportAgent } from "@/lib/support/auth";

export const dynamic = "force-dynamic";

export async function POST(_: Request, ctx: { params: Promise<{ id: string }> }) {
  const agent = await requireSupportAgent().catch(() => null);
  if (!agent) return NextResponse.json({ detail: "Forbidden." }, { status: 403 });

  const { id } = await ctx.params;

  const updated = await sql()<{
    id: string;
    assigned_agent_id: string | null;
  }>`
    update support_conversations
    set assigned_agent_id = ${agent.id}, updated_at = now()
    where id = ${id}
    returning id, assigned_agent_id
  `;

  if (!updated[0]) return NextResponse.json({ detail: "Not found." }, { status: 404 });

  await sql()`
    insert into support_events (conversation_id, type, payload)
    values (${id}, 'assigned', ${JSON.stringify({ agentId: agent.id })}::jsonb)
  `;

  return NextResponse.json({ ok: true, conversation: updated[0] }, { status: 200 });
}

