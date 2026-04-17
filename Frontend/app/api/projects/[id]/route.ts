import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth/server";
import { sql } from "@/lib/db";
import { getUserRoleForProject, canRead } from "@/lib/projects/authz";

export const dynamic = "force-dynamic";

export async function GET(_: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await requireUser().catch(() => null);
  if (!user) return NextResponse.json({ detail: "Unauthorized." }, { status: 401 });

  const { id } = await ctx.params;
  const role = await getUserRoleForProject(user.id, id);
  if (!role || !canRead(role)) return NextResponse.json({ detail: "Not found." }, { status: 404 });

  const rows = await sql()<{
    id: string;
    owner_id: string;
    name: string;
    kind: string;
    data: unknown;
    created_at: string;
    updated_at: string;
  }>`
    select id, owner_id, name, kind, data, created_at, updated_at
    from projects
    where id = ${id}
    limit 1
  `;
  const project = rows[0];
  if (!project) return NextResponse.json({ detail: "Not found." }, { status: 404 });

  return NextResponse.json({ project, role }, { status: 200 });
}

const PatchSchema = z.object({
  name: z.string().min(1).max(200).optional(),
});

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await requireUser().catch(() => null);
  if (!user) return NextResponse.json({ detail: "Unauthorized." }, { status: 401 });

  const { id } = await ctx.params;
  const role = await getUserRoleForProject(user.id, id);
  if (role !== "owner") return NextResponse.json({ detail: "Forbidden." }, { status: 403 });

  const json = await req.json().catch(() => null);
  const parsed = PatchSchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ detail: "Invalid input." }, { status: 400 });

  const name = parsed.data.name?.trim();
  if (!name) return NextResponse.json({ detail: "Nothing to update." }, { status: 400 });

  const updated = await sql()<{
    id: string;
    name: string;
    kind: string;
    updated_at: string;
  }>`
    update projects
    set name = ${name}, updated_at = now()
    where id = ${id}
    returning id, name, kind, updated_at
  `;

  return NextResponse.json({ project: updated[0] }, { status: 200 });
}

export async function DELETE(_: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await requireUser().catch(() => null);
  if (!user) return NextResponse.json({ detail: "Unauthorized." }, { status: 401 });

  const { id } = await ctx.params;
  const role = await getUserRoleForProject(user.id, id);
  if (role !== "owner") return NextResponse.json({ detail: "Forbidden." }, { status: 403 });

  await sql()`
    delete from projects where id = ${id}
  `;

  return NextResponse.json({ ok: true }, { status: 200 });
}

