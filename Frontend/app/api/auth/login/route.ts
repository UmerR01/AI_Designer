import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { sql } from "@/lib/db";
import { dbConnectionErrorResponse } from "@/lib/db-connection-error";
import { ensureAuthSchema } from "@/lib/auth/bootstrap";
import { SESSION_COOKIE_NAME, signSession } from "@/lib/auth/session";
 
const LoginSchema = z.object({
  email: z.string().email().max(255),
  password: z.string().min(1).max(200),
  remember: z.boolean().optional().default(true),
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
  const parsed = LoginSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ detail: "Invalid email or password." }, { status: 400 });
  }
 
  const { email, password, remember, recaptchaToken } = parsed.data;

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
 
  let result: {
    id: string;
    email: string;
    first_name: string;
    last_name: string;
    password_hash: string;
    is_support_agent: boolean;
    email_verified: boolean;
  }[] = [];
  try {
    result = await sql()<{
      id: string;
      email: string;
      first_name: string;
      last_name: string;
      password_hash: string;
      is_support_agent: boolean;
      email_verified: boolean;
    }>`
      select id, email, first_name, last_name, password_hash, is_support_agent, email_verified
      from users
      where email = ${email.toLowerCase()}
      limit 1
    `;
  } catch (err: unknown) {
    const r = dbConnectionErrorResponse(err);
    if (r) return r;
    return NextResponse.json({ detail: "Sign in failed. Database not ready." }, { status: 500 });
  }
 
  const user = result[0];
  if (!user) return NextResponse.json({ detail: "Invalid email or password." }, { status: 401 });
  if (!user.email_verified) return NextResponse.json({ detail: "Please verify your email address first." }, { status: 403 });

 
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return NextResponse.json({ detail: "Invalid email or password." }, { status: 401 });
 
  const maxAgeSeconds = remember ? 60 * 60 * 24 * 30 : 60 * 60 * 8;
  const token = await signSession(
    {
      id: user.id,
      email: user.email,
      firstName: user.first_name,
      lastName: user.last_name,
      isSupportAgent: Boolean(user.is_support_agent),
    },
    maxAgeSeconds
  );
 
  const res = NextResponse.json({ user: { id: user.id, email: user.email } });
  res.cookies.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    ...(remember ? { maxAge: maxAgeSeconds } : {}),
  });
  return res;
}
