import { NextResponse } from "next/server";
import { z } from "zod";
import { sql } from "@/lib/db";
import { requireSupportAgent } from "@/lib/support/auth";

export const dynamic = "force-dynamic";

const QuerySchema = z.object({
  view: z.enum(["all", "unread"]).optional(),
});

export async function GET(req: Request) {
  const agent = await requireSupportAgent().catch(() => null);
  if (!agent) return NextResponse.json({ detail: "Forbidden." }, { status: 403 });

  const url = new URL(req.url);
  const parsed = QuerySchema.safeParse({
    view: url.searchParams.get("view") ?? "all",
  });
  if (!parsed.success) return NextResponse.json({ detail: "Invalid query." }, { status: 400 });

  const { view } = parsed.data;

  const rows = await sql()<{
    id: string;
    user_id: string | null;
    status: "open" | "pending" | "closed";
    priority: "low" | "normal" | "high" | "urgent";
    assigned_agent_id: string | null;
    last_message_at: string;
    updated_at: string;
    created_at: string;
    user_email: string | null;
    user_first_name: string | null;
    user_last_name: string | null;
    last_message_body: string | null;
    last_message_sender_type: "user" | "agent" | null;
  }>`
    select
      c.id, c.user_id, c.status, c.priority, c.assigned_agent_id,
      c.last_message_at, c.updated_at, c.created_at,
      u.email as user_email, u.first_name as user_first_name, u.last_name as user_last_name,
      m.body as last_message_body,
      m.sender_type as last_message_sender_type
    from support_conversations c
    left join users u on u.id = c.user_id
    left join lateral (
      select body, sender_type from support_messages
      where conversation_id = c.id
      order by created_at desc
      limit 1
    ) m on true
    where
      c.user_id != ${agent.id}
      and (
        ${view} = 'all'
        or (${view} = 'unread' and m.sender_type = 'user')
      )
    order by
      c.last_message_at desc
    limit 200
  `;

  return NextResponse.json({ conversations: rows }, { status: 200 });
}

