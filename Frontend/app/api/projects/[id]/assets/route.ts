import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth/server";
import { sql } from "@/lib/db";
import { canRead, canWrite, getUserRoleForProject } from "@/lib/projects/authz";

export const dynamic = "force-dynamic";

const ImageSchema = z.object({
  id: z.string().optional(),
  page_name: z.string().optional(),
  filename: z.string(),
  url: z.string(),
  created_at: z.string().optional(),
  prompt: z.string().optional(),
});

const BodySchema = z.object({
  sessionId: z.string().optional(),
  source: z.string().default("ui-designer"),
  model: z.string().optional(),
  prompt: z.string().optional(),
  images: z.array(ImageSchema).min(1),
});

export async function GET(_: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await requireUser().catch(() => null);
  if (!user) return NextResponse.json({ detail: "Unauthorized." }, { status: 401 });

  const { id: projectId } = await ctx.params;
  const role = await getUserRoleForProject(user.id, projectId);
  if (!role || !canRead(role)) return NextResponse.json({ detail: "Not found." }, { status: 404 });

  const rows = await sql()<{
    id: string;
    page_name: string | null;
    filename: string;
    url: string;
    created_at: string;
  }>`
    select id, page_name, filename, url, created_at
    from project_assets
    where project_id = ${projectId}
    order by created_at desc
    limit 200
  `;

  return NextResponse.json(
    {
      images: rows.map((r) => ({
        id: r.id,
        page_name: r.page_name ?? undefined,
        filename: r.filename,
        url: r.url,
        created_at: r.created_at,
      })),
    },
    { status: 200 },
  );
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await requireUser().catch(() => null);
  if (!user) return NextResponse.json({ detail: "Unauthorized." }, { status: 401 });

  const { id: projectId } = await ctx.params;
  const role = await getUserRoleForProject(user.id, projectId);
  if (!role) return NextResponse.json({ detail: "Not found." }, { status: 404 });
  if (!canWrite(role)) return NextResponse.json({ detail: "Forbidden." }, { status: 403 });

  const json = await req.json().catch(() => null);
  const parsed = BodySchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ detail: "Invalid input." }, { status: 400 });

  const body = parsed.data;
  const insertedBatch = await sql()<{ id: string }>`
    insert into project_asset_batches (project_id, session_id, source, prompt, model, created_by)
    values (${projectId}, ${body.sessionId ?? null}, ${body.source}, ${body.prompt ?? null}, ${body.model ?? null}, ${user.id})
    returning id
  `;
  const batchId = insertedBatch[0].id;

  for (const image of body.images) {
    await sql()`
      insert into project_assets (
        project_id, batch_id, source_image_id, page_name, filename, url, mime_type, prompt
      )
      values (
        ${projectId},
        ${batchId},
        ${image.id ?? null},
        ${image.page_name ?? null},
        ${image.filename},
        ${image.url},
        'image/png',
        ${image.prompt ?? body.prompt ?? null}
      )
      on conflict (project_id, source_image_id) where source_image_id is not null
      do update set
        page_name = excluded.page_name,
        filename = excluded.filename,
        url = excluded.url,
        prompt = excluded.prompt,
        created_at = now()
    `;
  }

  const canonical = await sql()<{
    id: string;
    page_name: string | null;
    filename: string;
    url: string;
    created_at: string;
  }>`
    select id, page_name, filename, url, created_at
    from project_assets
    where project_id = ${projectId}
    order by created_at desc
    limit 200
  `;

  const existingProject = await sql()<{ data: unknown }>`
    select data from projects where id = ${projectId} limit 1
  `;
  const existingData =
    existingProject[0]?.data && typeof existingProject[0].data === "object"
      ? (existingProject[0].data as Record<string, unknown>)
      : {};
  const nextData = {
    ...existingData,
    generatedUiImages: canonical.map((r) => ({
      id: r.id,
      page_name: r.page_name ?? undefined,
      filename: r.filename,
      url: r.url,
      created_at: r.created_at,
    })),
    updatedBy: { id: user.id, email: user.email },
    savedAt: new Date().toISOString(),
  };

  await sql()`
    update projects
    set data = ${JSON.stringify(nextData)}::jsonb, updated_at = now()
    where id = ${projectId}
  `;

  return NextResponse.json(
    { ok: true, batchId, count: body.images.length, images: nextData.generatedUiImages },
    { status: 201 },
  );
}

