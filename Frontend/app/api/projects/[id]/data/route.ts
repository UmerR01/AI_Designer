import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth/server";
import { sql } from "@/lib/db";
import { getUserRoleForProject, canRead, canWrite } from "@/lib/projects/authz";

export const dynamic = "force-dynamic";

const GeneratedImageSchema = z.object({
  id: z.string().min(1),
  url: z.string().min(1),
  filename: z.string().min(1),
  page_name: z.string().optional(),
  created_at: z.string().optional(),
});

const PersistedProjectDataSchema = z.object({
  // Tree shape is complex and evolving; enforce container-level guarantees.
  tree: z.array(z.unknown()),
  activeId: z.string(),
  openFolders: z.record(z.string(), z.boolean()),
  generatedUiImages: z.array(GeneratedImageSchema).default([]),
  updatedBy: z
    .object({
      id: z.string(),
      email: z.string().email().optional(),
    })
    .optional(),
  savedAt: z.string().optional(),
});

export async function GET(_: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await requireUser().catch(() => null);
  if (!user) return NextResponse.json({ detail: "Unauthorized." }, { status: 401 });

  const { id } = await ctx.params;
  const role = await getUserRoleForProject(user.id, id);
  if (!role || !canRead(role)) return NextResponse.json({ detail: "Not found." }, { status: 404 });

  const rows = await sql()<{ data: unknown }>`
    select data from projects where id = ${id} limit 1
  `;

  const parsed = PersistedProjectDataSchema.safeParse(rows[0]?.data);
  if (!parsed.success) return NextResponse.json({ data: {} }, { status: 200 });
  return NextResponse.json({ data: parsed.data }, { status: 200 });
}

const PutSchema = z.object({
  data: PersistedProjectDataSchema,
});

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await requireUser().catch(() => null);
  if (!user) return NextResponse.json({ detail: "Unauthorized." }, { status: 401 });

  const { id } = await ctx.params;
  const role = await getUserRoleForProject(user.id, id);
  if (!role) return NextResponse.json({ detail: "Not found." }, { status: 404 });
  if (!canWrite(role)) return NextResponse.json({ detail: "Forbidden." }, { status: 403 });

  const json = await req.json().catch(() => null);
  const parsed = PutSchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ detail: "Invalid input." }, { status: 400 });

  const withMeta = {
    ...parsed.data.data,
    updatedBy: { id: user.id, email: user.email },
    savedAt: new Date().toISOString(),
  };

  await sql()`
    update projects
    set data = ${JSON.stringify(withMeta)}::jsonb, updated_at = now()
    where id = ${id}
  `;

  return NextResponse.json({ ok: true, data: withMeta }, { status: 200 });
}

