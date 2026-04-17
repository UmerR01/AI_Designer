import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { requireUser } from "@/lib/auth/server";
import { sql } from "@/lib/db";
import { getUserRoleForProject } from "@/lib/projects/authz";
import { sendInviteEmail } from "@/lib/email";

export const dynamic = "force-dynamic";

export async function GET(_: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await requireUser().catch(() => null);
  if (!user) return NextResponse.json({ detail: "Unauthorized." }, { status: 401 });

  const { id } = await ctx.params;
  const role = await getUserRoleForProject(user.id, id);
  if (role !== "owner") return NextResponse.json({ detail: "Forbidden." }, { status: 403 });

  const members = await sql()<{
    user_id: string;
    email: string;
    first_name: string;
    last_name: string;
    role: string;
  }>`
    select m.user_id, u.email, u.first_name, u.last_name, m.role
    from project_members m
    join users u on u.id = m.user_id
    where m.project_id = ${id}
    order by u.email asc
  `;

  const links = await sql()<{
    id: string;
    slug: string;
    role: "viewer" | "editor";
    visibility: "public" | "password";
    revoked_at: string | null;
    created_at: string;
  }>`
    select id, slug, role, visibility, revoked_at, created_at
    from project_share_links
    where project_id = ${id}
    order by created_at desc
  `;

  // Note: invites are not listed here yet; UI can create and copy the accept link.
  return NextResponse.json({ members, links }, { status: 200 });
}

const CreateInviteSchema = z.object({
  email: z.string().email().max(255),
  role: z.enum(["viewer", "editor"]),
});

function makeToken() {
  return crypto.randomUUID().replace(/-/g, "");
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await requireUser().catch(() => null);
  if (!user) return NextResponse.json({ detail: "Unauthorized." }, { status: 401 });

  const { id } = await ctx.params;
  const role = await getUserRoleForProject(user.id, id);
  if (role !== "owner") return NextResponse.json({ detail: "Forbidden." }, { status: 403 });

  const json = await req.json().catch(() => null);
  const parsed = CreateInviteSchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ detail: "Invalid input." }, { status: 400 });

  const projectRows = await sql()<{ name: string }>`
    select name from projects where id = ${id} limit 1
  `;
  const projectName = projectRows[0]?.name ?? "Untitled";

  const token = makeToken();
  const invite = await sql()<{
    id: string;
    token: string;
    email: string;
    role: "viewer" | "editor";
  }>`
    insert into project_invites (project_id, email, role, token, created_by)
    values (${id}, ${parsed.data.email.toLowerCase()}, ${parsed.data.role}, ${token}, ${user.id})
    returning id, token, email, role
  `;

  const envUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL ?? process.env.VERCEL_URL;
  const requestOrigin = (() => {
    try {
      return new URL(req.url).origin;
    } catch {
      return "http://localhost:3000";
    }
  })();
  const origin = envUrl
    ? (envUrl.startsWith("http") ? envUrl : `https://${envUrl}`)
    : requestOrigin;
  const inviteUrl = `${origin}/invite/${invite[0].token}`;

  try {
    await sendInviteEmail({
      toEmail: invite[0].email,
      inviterEmail: user.email,
      projectName,
      inviteUrl,
      access: invite[0].role,
    });
  } catch (e: any) {
    // Invite exists even if mail fails; return success but include a hint for debugging.
    return NextResponse.json(
      { invite: invite[0], emailSent: false, emailError: String(e?.message ?? e) },
      { status: 201 }
    );
  }

  return NextResponse.json({ invite: invite[0], emailSent: true }, { status: 201 });
}

const UpsertLinkSchema = z.object({
  role: z.enum(["viewer", "editor"]),
  visibility: z.enum(["public", "password"]),
  password: z.string().min(4).max(128).optional(),
});

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await requireUser().catch(() => null);
  if (!user) return NextResponse.json({ detail: "Unauthorized." }, { status: 401 });

  const { id } = await ctx.params;
  const role = await getUserRoleForProject(user.id, id);
  if (role !== "owner") return NextResponse.json({ detail: "Forbidden." }, { status: 403 });

  const json = await req.json().catch(() => null);
  const parsed = UpsertLinkSchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ detail: "Invalid input." }, { status: 400 });

  const { role: linkRole, visibility, password } = parsed.data;
  const slug = crypto.randomUUID().replace(/-/g, "");
  const passwordHash =
    visibility === "password" ? await bcrypt.hash(String(password ?? ""), 12) : null;

  // For simplicity: one active link per project+visibility; revoke old and create new on change/regenerate.
  await sql()`
    update project_share_links
    set revoked_at = now()
    where project_id = ${id} and visibility = ${visibility} and revoked_at is null
  `;

  const created = await sql()<{
    id: string;
    slug: string;
    role: "viewer" | "editor";
    visibility: "public" | "password";
  }>`
    insert into project_share_links (project_id, slug, role, visibility, password_hash)
    values (${id}, ${slug}, ${linkRole}, ${visibility}, ${passwordHash})
    returning id, slug, role, visibility
  `;

  return NextResponse.json({ link: created[0] }, { status: 201 });
}

const RevokeSchema = z.object({
  visibility: z.enum(["public", "password"]),
});

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await requireUser().catch(() => null);
  if (!user) return NextResponse.json({ detail: "Unauthorized." }, { status: 401 });

  const { id } = await ctx.params;
  const role = await getUserRoleForProject(user.id, id);
  if (role !== "owner") return NextResponse.json({ detail: "Forbidden." }, { status: 403 });

  const json = await req.json().catch(() => null);
  const parsed = RevokeSchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ detail: "Invalid input." }, { status: 400 });

  await sql()`
    update project_share_links
    set revoked_at = now()
    where project_id = ${id} and visibility = ${parsed.data.visibility} and revoked_at is null
  `;

  return NextResponse.json({ ok: true }, { status: 200 });
}

