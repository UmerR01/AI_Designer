import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { sql } from "@/lib/db";
import { hashResetToken } from "@/lib/auth/password-reset";
import { RESET_TOKEN_MIN_LENGTH } from "@/lib/auth/reset-token-constants";

export const dynamic = "force-dynamic";

const BodySchema = z.object({
  token: z.string().min(RESET_TOKEN_MIN_LENGTH).max(500),
  password: z.string().min(8).max(200),
});

export async function POST(req: Request) {
  const json = await req.json().catch(() => null);
  const parsed = BodySchema.safeParse(json);
  if (!parsed.success) {
    const fieldErrors = parsed.error.flatten().fieldErrors;
    if (fieldErrors.token?.length) {
      return NextResponse.json(
        { detail: "This reset link is incomplete or invalid. Open the link from your email again or request a new one." },
        { status: 400 }
      );
    }
    if (fieldErrors.password?.length) {
      return NextResponse.json({ detail: "Password must be between 8 and 200 characters." }, { status: 400 });
    }
    return NextResponse.json({ detail: "Invalid input." }, { status: 400 });
  }

  const { token, password } = parsed.data;
  const tokenHash = hashResetToken(token);

  const rows = await sql()<{ user_id: string }>`
    select user_id from password_reset_tokens
    where token_hash = ${tokenHash}
      and expires_at > now()
      and used_at is null
    limit 1
  `;

  const row = rows[0];
  if (!row) {
    return NextResponse.json({ detail: "This reset link is invalid or has expired. Request a new one." }, { status: 400 });
  }

  const passwordHash = await bcrypt.hash(password, 12);

  try {
    await sql()`update users set password_hash = ${passwordHash} where id = ${row.user_id}`;

    await sql()`delete from password_reset_tokens where user_id = ${row.user_id}`;
  } catch (e) {
    console.error("[reset-password]", e);
    return NextResponse.json({ detail: "Could not update password." }, { status: 500 });
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}
