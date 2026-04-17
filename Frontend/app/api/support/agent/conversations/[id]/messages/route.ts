import { NextResponse } from "next/server";
import { z } from "zod";
import { sql } from "@/lib/db";
import { requireSupportAgent } from "@/lib/support/auth";
import { publishSupportEvent } from "@/lib/support/realtime";

export const dynamic = "force-dynamic";

const PostSchema = z.object({
  body: z.string().trim().min(1).max(4000),
});

export async function GET(_: Request, ctx: { params: Promise<{ id: string }> }) {
  const agent = await requireSupportAgent().catch(() => null);
  if (!agent) return NextResponse.json({ detail: "Forbidden." }, { status: 403 });

  const { id } = await ctx.params;

  const exists = await sql()<{ id: string }>`
    select id from support_conversations where id = ${id} limit 1
  `;
  if (!exists[0]) return NextResponse.json({ detail: "Not found." }, { status: 404 });

  const messages = await sql()<{
    id: string;
    sender_type: "user" | "agent" | "system";
    sender_user_id: string | null;
    body: string;
    created_at: string;
  }>`
    select id, sender_type, sender_user_id, body, created_at
    from support_messages
    where conversation_id = ${id}
    order by created_at asc
    limit 1000
  `;

  return NextResponse.json({ messages }, { status: 200 });
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const agent = await requireSupportAgent().catch(() => null);
  if (!agent) return NextResponse.json({ detail: "Forbidden." }, { status: 403 });

  const { id } = await ctx.params;
  const json = await req.json().catch(() => null);
  const parsed = PostSchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ detail: "Invalid input." }, { status: 400 });

  const conv = await sql()<{ status: string }>`
    select status from support_conversations where id = ${id} limit 1
  `;
  if (!conv[0]) return NextResponse.json({ detail: "Not found." }, { status: 404 });
  if (conv[0].status === "closed") return NextResponse.json({ detail: "Conversation is closed." }, { status: 409 });

  const rate = await sql()<{ c: number }>`
    select count(*)::int as c
    from support_messages
    where conversation_id = ${id}
      and sender_type = 'agent'
      and sender_user_id = ${agent.id}
      and created_at > now() - interval '10 seconds'
  `;
  if ((rate[0]?.c ?? 0) >= 8) {
    return NextResponse.json({ detail: "Rate limited. Slow down a bit." }, { status: 429 });
  }

  const inserted = await sql()<{
    id: string;
    created_at: string;
  }>`
    insert into support_messages (conversation_id, sender_type, sender_user_id, body)
    values (${id}, 'agent', ${agent.id}, ${parsed.data.body})
    returning id, created_at
  `;

  await sql()`
    update support_conversations
    set last_message_at = now(), updated_at = now()
    where id = ${id}
  `;

  publishSupportEvent({
    type: "message.created",
    conversationId: id,
    messageId: inserted[0].id,
    senderType: "agent",
    createdAt: inserted[0].created_at,
  });

  return NextResponse.json({ ok: true, messageId: inserted[0].id, createdAt: inserted[0].created_at }, { status: 201 });
}

