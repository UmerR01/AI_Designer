import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth/server";
import { sql } from "@/lib/db";
import { mergeProjectGeneratedImages } from "@/lib/generated-ui-images";
import { coercePersistedProjectData } from "@/lib/persisted-project-data";
import { ensureFlowRelations, mergeFlowGraphs } from "@/lib/ui-flow-graph";
import { getUserRoleForProject, canRead, canWrite } from "@/lib/projects/authz";

async function loadProjectAssetCanonical(projectId: string) {
  return sql()<{
    id: string;
    source_image_id: string | null;
    page_name: string | null;
    filename: string;
    url: string;
    created_at: string;
  }>`
    select id, source_image_id, page_name, filename, url, created_at
    from project_assets
    where project_id = ${projectId}
    order by created_at asc
    limit 200
  `;
}

function mergePersistedWithDb(
  previous: ReturnType<typeof coercePersistedProjectData>,
  incoming: ReturnType<typeof coercePersistedProjectData>,
  canonical: Awaited<ReturnType<typeof loadProjectAssetCanonical>>,
) {
  const generatedUiImages = mergeProjectGeneratedImages({
    existing: previous.generatedUiImages,
    incoming: incoming.generatedUiImages,
    canonical: canonical.map((r) => ({
      id: r.id,
      source_image_id: r.source_image_id,
      page_name: r.page_name,
      filename: r.filename,
      url: r.url,
      created_at: r.created_at,
    })),
  });
  const uiFlowGraph = ensureFlowRelations(
    mergeFlowGraphs(previous.uiFlowGraph, incoming.uiFlowGraph),
  );
  return { generatedUiImages, uiFlowGraph };
}

export const dynamic = "force-dynamic";

const PutBodySchema = z.object({
  data: z.unknown(),
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

  const previous = coercePersistedProjectData(rows[0]?.data);
  const canonical = await loadProjectAssetCanonical(id);
  const generatedUiImages = mergeProjectGeneratedImages({
    existing: previous.generatedUiImages,
    incoming: [],
    canonical: canonical.map((r) => ({
      id: r.id,
      source_image_id: r.source_image_id,
      page_name: r.page_name,
      filename: r.filename,
      url: r.url,
      created_at: r.created_at,
    })),
  });
  return NextResponse.json(
    {
      data: {
        ...previous,
        generatedUiImages,
        uiFlowGraph: ensureFlowRelations(previous.uiFlowGraph),
      },
    },
    { status: 200 },
  );
}

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await requireUser().catch(() => null);
  if (!user) return NextResponse.json({ detail: "Unauthorized." }, { status: 401 });

  const { id } = await ctx.params;
  const role = await getUserRoleForProject(user.id, id);
  if (!role) return NextResponse.json({ detail: "Not found." }, { status: 404 });
  if (!canWrite(role)) return NextResponse.json({ detail: "Forbidden." }, { status: 403 });

  const json = await req.json().catch(() => null);
  const parsed = PutBodySchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ detail: "Invalid input." }, { status: 400 });

  const incoming = coercePersistedProjectData(parsed.data.data);
  const rows = await sql()<{ data: unknown }>`
    select data from projects where id = ${id} limit 1
  `;
  const previous = coercePersistedProjectData(rows[0]?.data);
  const canonical = await loadProjectAssetCanonical(id);
  const { generatedUiImages, uiFlowGraph } = mergePersistedWithDb(
    previous,
    incoming,
    canonical,
  );
  const withMeta = {
    ...incoming,
    generatedUiImages,
    uiFlowGraph,
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
