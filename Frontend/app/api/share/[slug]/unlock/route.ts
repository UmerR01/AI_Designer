import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { sql } from "@/lib/db";
import { shareUnlockCookieName, signShareUnlock } from "@/lib/auth/share";

export const dynamic = "force-dynamic";

const UnlockSchema = z.object({
  password: z.string().min(1).max(128),
});

export async function POST(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;

  const json = await req.json().catch(() => null);
  const parsed = UnlockSchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ detail: "Invalid password." }, { status: 400 });

  const rows = await sql()<{
    role: "viewer" | "editor";
    visibility: "public" | "password";
    password_hash: string | null;
    revoked_at: string | null;
  }>`
    select role, visibility, password_hash, revoked_at
    from project_share_links
    where slug = ${slug}
    limit 1
  `;
  const link = rows[0];
  if (!link || link.revoked_at) return NextResponse.json({ detail: "Not found." }, { status: 404 });
  if (link.visibility !== "password") return NextResponse.json({ ok: true }, { status: 200 });
  if (!link.password_hash) return NextResponse.json({ detail: "Link misconfigured." }, { status: 500 });

  const ok = await bcrypt.compare(parsed.data.password, link.password_hash);
  if (!ok) return NextResponse.json({ detail: "Wrong password." }, { status: 401 });

  const maxAgeSeconds = 60 * 60 * 24; // 24h unlock
  const token = await signShareUnlock(slug, link.role, maxAgeSeconds);
  const res = NextResponse.json({ ok: true }, { status: 200 });
  res.cookies.set(shareUnlockCookieName(slug), token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: maxAgeSeconds,
  });
  return res;
}

