import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth/server";
import { sql } from "@/lib/db";
import { dbConnectionErrorResponse } from "@/lib/db-connection-error";
import { ensureAppSchema, resetAppSchemaCache } from "@/lib/db/ensure-app-schema";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const status = url.searchParams.get("status") || "active";

  const user = await requireUser().catch(() => null);
  if (!user) return NextResponse.json({ detail: "Unauthorized." }, { status: 401 });

  try {
    await ensureAppSchema();
  } catch (err: unknown) {
    const r = dbConnectionErrorResponse(err);
    if (r) return r;
    throw err;
  }

  // Lazy cleanup of projects deleted more than 30 days ago
  await sql()`
    delete from projects 
    where deleted_at < now() - interval '30 days'
  `.catch(() => {});

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
      where (p.owner_id = ${user.id} or m.user_id is not null)
        and ((${status === "deleted"}::boolean and p.deleted_at is not null) or (${status !== "deleted"}::boolean and p.deleted_at is null))
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
        and ((${status === "deleted"}::boolean and p.deleted_at is not null) or (${status !== "deleted"}::boolean and p.deleted_at is null))
      order by p.updated_at desc
    `;
  }

  return NextResponse.json({ projects: rows }, { status: 200 });
}

const CreateSchema = z.object({
  name: z.string().min(1).max(200),
  kind: z.string().min(1).max(50).optional(),
});

async function insertProject(
  userId: string,
  name: string,
  kind: string | undefined,
) {
  return sql()<{
    id: string;
    name: string;
    kind: string;
    created_at: string;
    updated_at: string;
  }>`
    insert into projects (owner_id, name, kind, data)
    values (${userId}, ${name}, ${kind ?? "ui/ux design"}, ${JSON.stringify({})}::jsonb)
    returning id, name, kind, created_at, updated_at
  `;
}

export async function POST(req: Request) {
  const user = await requireUser().catch(() => null);
  if (!user) return NextResponse.json({ detail: "Unauthorized." }, { status: 401 });

  const json = await req.json().catch(() => null);
  const parsed = CreateSchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ detail: "Invalid input." }, { status: 400 });

  const { name, kind } = parsed.data;

  try {
    await ensureAppSchema();
  } catch (err: unknown) {
    const r = dbConnectionErrorResponse(err);
    if (r) return r;
    throw err;
  }

  let created: {
    id: string;
    name: string;
    kind: string;
    created_at: string;
    updated_at: string;
  }[] = [];

  try {
    created = await insertProject(user.id, name, kind);
  } catch (e: unknown) {
    const err = e as { code?: string; message?: string };
    if (err?.code === "42P01") {
      try {
        resetAppSchemaCache();
        await ensureAppSchema();
        created = await insertProject(user.id, name, kind);
      } catch (retryErr: unknown) {
        const r = dbConnectionErrorResponse(retryErr);
        if (r) return r;
        throw retryErr;
      }
    } else if (err?.code === "23503") {
      return NextResponse.json(
        { detail: "Session is stale after DB reset. Please log in again." },
        { status: 401 },
      );
    } else {
      const r = dbConnectionErrorResponse(e);
      if (r) return r;
      console.error("[POST /api/projects]", e);
      return NextResponse.json(
        { detail: err?.message || "Could not create project." },
        { status: 500 },
      );
    }
  }

  if (!created[0]) {
    return NextResponse.json({ detail: "Could not create project." }, { status: 500 });
  }

  return NextResponse.json({ project: created[0] }, { status: 201 });
}

