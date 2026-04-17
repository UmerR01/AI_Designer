import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth/server";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await requireUser().catch(() => null);
  if (!user) return NextResponse.json({ detail: "Unauthorized." }, { status: 401 });

  let rows: {
    id: string;
    name: string;
    kind: string;
    created_at: string;
    updated_at: string;
  }[] = [];

  try {
    rows = await sql()<{
      id: string;
      name: string;
      kind: string;
      created_at: string;
      updated_at: string;
    }>`
      select p.id, p.name, p.kind, p.created_at, p.updated_at
      from projects p
      left join project_members m
        on m.project_id = p.id
       and m.user_id = ${user.id}
      where p.owner_id = ${user.id}
         or m.user_id is not null
      order by p.updated_at desc
    `;
  } catch (e: unknown) {
    // Backward-compat: some DBs might not have `project_members` yet.
    const msg = e instanceof Error ? e.message.toLowerCase() : "";
    if (!msg.includes("project_members")) throw e;

    rows = await sql()<{
      id: string;
      name: string;
      kind: string;
      created_at: string;
      updated_at: string;
    }>`
      select p.id, p.name, p.kind, p.created_at, p.updated_at
      from projects p
      where p.owner_id = ${user.id}
      order by p.updated_at desc
    `;
  }

  return NextResponse.json({ projects: rows }, { status: 200 });
}

const CreateSchema = z.object({
  name: z.string().min(1).max(200),
  kind: z.string().min(1).max(50).optional(),
});

export async function POST(req: Request) {
  const user = await requireUser().catch(() => null);
  if (!user) return NextResponse.json({ detail: "Unauthorized." }, { status: 401 });

  const json = await req.json().catch(() => null);
  const parsed = CreateSchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ detail: "Invalid input." }, { status: 400 });

  const { name, kind } = parsed.data;

  let created: {
    id: string;
    name: string;
    kind: string;
    created_at: string;
    updated_at: string;
  }[] = [];
  try {
    created = await sql()<{
      id: string;
      name: string;
      kind: string;
      created_at: string;
      updated_at: string;
    }>`
      insert into projects (owner_id, name, kind, data)
      values (${user.id}, ${name}, ${kind ?? "ui/ux design"}, ${JSON.stringify({})}::jsonb)
      returning id, name, kind, created_at, updated_at
    `;
  } catch (e: any) {
    if (e?.code === "23503") {
      return NextResponse.json({ detail: "Session is stale after DB reset. Please log in again." }, { status: 401 });
    }
    throw e;
  }

  return NextResponse.json({ project: created[0] }, { status: 201 });
}

