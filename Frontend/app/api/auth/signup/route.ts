import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { sql } from "@/lib/db";
import { dbConnectionErrorResponse } from "@/lib/db-connection-error";
import { ensureAuthSchema } from "@/lib/auth/bootstrap";
import { SESSION_COOKIE_NAME, signSession } from "@/lib/auth/session";
import { getAppOrigin } from "@/lib/auth/password-reset";
 
const SignupSchema = z.object({
  first_name: z.string().min(1).max(80),
  last_name: z.string().min(1).max(80),
  email: z.string().email().max(255),
  password: z.string().min(8).max(200),
  recaptchaToken: z.string().min(1, "CAPTCHA is required"),
});
 
export async function POST(_req_: Request) {
  try {
    await ensureAuthSchema();
  } catch (err: unknown) {
    const r = dbConnectionErrorResponse(err);
    if (r) return r;
    throw err;
  }
  const json = await _req_.json().catch(() => null);
  const parsed = SignupSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ detail: "Invalid input." }, { status: 400 });
  }
 
  const { first_name, last_name, email, password, recaptchaToken } = parsed.data;

  // Verify Turnstile
  const turnstileSecret = process.env.TURNSTILE_SECRET_KEY;
  if (!turnstileSecret) {
    return NextResponse.json({ detail: "Server configuration error: Missing Turnstile secret key." }, { status: 500 });
  }

  try {
    const verifyRes = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `secret=${turnstileSecret}&response=${recaptchaToken}`,
    });
    const verifyData = await verifyRes.json();
    if (!verifyData.success) {
      return NextResponse.json({ detail: "Security verification failed. Please try again." }, { status: 400 });
    }
  } catch (err) {
    return NextResponse.json({ detail: "Security service unreachable." }, { status: 500 });
  }

  const passwordHash = await bcrypt.hash(password, 12);
 
  try {
    const created = await sql()<{
      id: string;
      email: string;
      first_name: string;
      last_name: string;
    }>`
      insert into users (email, first_name, last_name, password_hash, email_verified)
      values (${email.toLowerCase()}, ${first_name}, ${last_name}, ${passwordHash}, false)
      returning id, email, first_name, last_name
    `;

    const user = created[0];
    
    // Generate verification token
    const { signEmailVerificationToken } = await import("@/lib/auth/session");
    const token = await signEmailVerificationToken(user.email);
    
    // Send email using shared email helper
    try {
      const { sendVerificationEmail } = await import("@/lib/email");
      const verifyUrl = `${getAppOrigin(_req_)}/api/auth/verify?token=${token}`;
      await sendVerificationEmail({ toEmail: user.email, verifyUrl });
    } catch (emailErr: any) {
      // If email fails, delete the user so they can try again, and return the exact error
      console.error("Verification email failed:", emailErr);
      await sql()`delete from users where id = ${user.id}`;
      return NextResponse.json({ detail: "Failed to send verification email. SMTP Error: " + emailErr.message }, { status: 500 });
    }
 
    return NextResponse.json({ ok: true, message: "Please check your email to verify your account." });
  } catch (err: unknown) {
    const r = dbConnectionErrorResponse(err);
    if (r) return r;
    const e = err as { code?: string; message?: string };
    if (e?.code === "23505") {
      return NextResponse.json({ detail: "An account with that email already exists." }, { status: 409 });
    }
    const msg = String(e?.message ?? "").toLowerCase();
    if (msg.includes("duplicate") || msg.includes("unique")) {
      return NextResponse.json({ detail: "An account with that email already exists." }, { status: 409 });
    }
    if (e?.code === "42P01" || msg.includes("relation") || msg.includes("users")) {
      return NextResponse.json({ detail: "Database schema is not ready. Run migrations/schema first." }, { status: 500 });
    }
    return NextResponse.json({ detail: "Sign up failed." }, { status: 500 });
  }
}