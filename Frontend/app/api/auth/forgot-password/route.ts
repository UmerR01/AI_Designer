import { NextResponse } from "next/server";
import { z } from "zod";
import { sql } from "@/lib/db";
import { sendPasswordResetEmail } from "@/lib/email";
import { generateResetToken, getAppOrigin, hashResetToken } from "@/lib/auth/password-reset";

export const dynamic = "force-dynamic";

const BodySchema = z.object({
  email: z.string().email().max(255),
});

export async function POST(req: Request) {
  const json = await req.json().catch(() => null);
  const parsed = BodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ detail: "Invalid email." }, { status: 400 });
  }

  const email = parsed.data.email.toLowerCase();

  const rows = await sql()<{ id: string }>`
    select id from users where email = ${email} limit 1
  `;
  const user = rows[0];

  const isDev = process.env.NODE_ENV === "development";

  /** Same shape in prod; in dev includes why mail might be missing (localhost only). */
  const okResponse = (dev?: { userFound: boolean; emailSent?: boolean; dbOrMailError?: string }) => {
    const body: Record<string, unknown> = { ok: true };
    if (isDev && dev) body._dev = dev;
    return NextResponse.json(body, { status: 200 });
  };

  if (!user) {
    if (isDev) {
      console.info("[forgot-password] no user for this email — no mail sent (expected if typo / not signed up)");
    }
    return okResponse({ userFound: false });
  }

  const rawToken = generateResetToken();
  const tokenHash = hashResetToken(rawToken);
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

  try {
    await sql()`delete from password_reset_tokens where user_id = ${user.id}`;

    await sql()`
      insert into password_reset_tokens (user_id, token_hash, expires_at)
      values (${user.id}, ${tokenHash}, ${expiresAt.toISOString()})
    `;

    const resetUrl = `${getAppOrigin()}/reset-password?token=${encodeURIComponent(rawToken)}`;

    try {
      await sendPasswordResetEmail({ toEmail: email, resetUrl });
      if (isDev) {
        console.info("[forgot-password] reset email sent OK");
      }
      return okResponse({ userFound: true, emailSent: true });
    } catch (mailErr) {
      console.error(
        "[forgot-password] email send failed (check EMAIL_* on this host; user sees generic success):",
        mailErr
      );
      await sql()`delete from password_reset_tokens where user_id = ${user.id} and token_hash = ${tokenHash}`;
      const msg = mailErr instanceof Error ? mailErr.message : String(mailErr);
      return okResponse({ userFound: true, emailSent: false, dbOrMailError: msg });
    }
  } catch (e) {
    console.error("[forgot-password]", e);
    const msg = e instanceof Error ? e.message : String(e);
    if (isDev) {
      return okResponse({ userFound: true, emailSent: false, dbOrMailError: msg });
    }
  }

  return okResponse();
}
