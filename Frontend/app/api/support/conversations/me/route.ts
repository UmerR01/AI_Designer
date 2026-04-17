import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/server";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await requireUser().catch(() => null);
  if (!user) return NextResponse.json({ detail: "Unauthorized." }, { status: 401 });

  const rows = await sql()<{
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
    where user_id = ${user.id}
    order by last_message_at desc
    limit 50
  `;

  return NextResponse.json({ conversations: rows }, { status: 200 });
}

