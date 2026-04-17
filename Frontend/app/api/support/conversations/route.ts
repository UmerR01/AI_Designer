import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth/server";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

// Create (or resume) an open conversation for the current user.
const CreateSchema = z.object({
  // optional initial message
  message: z.string().trim().min(1).max(4000).optional(),
});

export async function POST(req: Request) {
  const user = await requireUser().catch(() => null);
  if (!user) return NextResponse.json({ detail: "Unauthorized." }, { status: 401 });

  const json = await req.json().catch(() => null);
  const parsed = CreateSchema.safeParse(json ?? {});
  if (!parsed.success) return NextResponse.json({ detail: "Invalid input." }, { status: 400 });

  // Try to find an existing open conversation.
  const existing = await sql()<{
    id: string;
    status: "open" | "pending" | "closed";
    priority: "low" | "normal" | "high" | "urgent";
    assigned_agent_id: string | null;
    last_message_at: string;
    updated_at: string;
    created_at: string;
  }>`
    select id, status, priority, assigned_agent_id, last_message_at, updated_at, created_at
    from support_conversations
    where user_id = ${user.id} and status in ('open','pending')
    order by last_message_at desc
    limit 1
  `;

  let convoId = existing[0]?.id ?? null;
  if (!convoId) {
    const created = await sql()<{
      id: string;
      status: "open" | "pending" | "closed";
      priority: "low" | "normal" | "high" | "urgent";
      assigned_agent_id: string | null;
      last_message_at: string;
      updated_at: string;
      created_at: string;
    }>`
      insert into support_conversations (user_id)
      values (${user.id})
      returning id, status, priority, assigned_agent_id, last_message_at, updated_at, created_at
    `;
    convoId = created[0].id;
  }

  if (parsed.data.message) {
    await sql()`
      insert into support_messages (conversation_id, sender_type, sender_user_id, body)
      values (${convoId}, 'user', ${user.id}, ${parsed.data.message})
    `;
    await sql()`
      update support_conversations
      set last_message_at = now(), updated_at = now()
      where id = ${convoId}
    `;
  }

  return NextResponse.json({ conversationId: convoId }, { status: 201 });
}

