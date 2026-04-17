import { NextResponse } from "next/server";
import { z } from "zod";
import { sql } from "@/lib/db";
import { requireSupportAgent } from "@/lib/support/auth";

export const dynamic = "force-dynamic";

const BodySchema = z.object({
  priority: z.enum(["low", "normal", "high", "urgent"]),
});

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const agent = await requireSupportAgent().catch(() => null);
  if (!agent) return NextResponse.json({ detail: "Forbidden." }, { status: 403 });

  const { id } = await ctx.params;
  const json = await req.json().catch(() => null);
  const parsed = BodySchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ detail: "Invalid input." }, { status: 400 });

  const updated = await sql()<{
    id: string;
    priority: "low" | "normal" | "high" | "urgent";
  }>`
    update support_conversations
    set priority = ${parsed.data.priority}, updated_at = now()
    where id = ${id}
    returning id, priority
  `;
  if (!updated[0]) return NextResponse.json({ detail: "Not found." }, { status: 404 });

  await sql()`
    insert into support_events (conversation_id, type, payload)
    values (${id}, 'priority_changed', ${JSON.stringify({ priority: parsed.data.priority, agentId: agent.id })}::jsonb)
  `;

  return NextResponse.json({ ok: true, conversation: updated[0] }, { status: 200 });
}
