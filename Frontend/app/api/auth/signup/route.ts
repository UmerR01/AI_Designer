import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { sql } from "@/lib/db";
import { dbConnectionErrorResponse } from "@/lib/db-connection-error";
import { ensureAuthSchema } from "@/lib/auth/bootstrap";
import { SESSION_COOKIE_NAME, signSession } from "@/lib/auth/session";
 
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
      insert into users (email, first_name, last_name, password_hash)
      values (${email.toLowerCase()}, ${first_name}, ${last_name}, ${passwordHash})
      returning id, email, first_name, last_name
    `;
 
    const user = created[0];
    
    // Generate verification token
    const { signEmailVerificationToken } = await import("@/lib/auth/session");
    const token = await signEmailVerificationToken(user.email);
    
    // Send email via nodemailer
    try {
      const nodemailer = await import("nodemailer");
      const transporter = nodemailer.createTransport({
        host: process.env.EMAIL_HOST || "smtp.gmail.com",
        port: Number(process.env.EMAIL_PORT) || 587,
        secure: false, // STARTTLS
        auth: {
          user: process.env.EMAIL_HOST_USER,
          pass: process.env.EMAIL_HOST_PASSWORD,
        },
      });

      const verifyUrl = `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/auth/verify?token=${token}`;
      
      await transporter.sendMail({
        from: `"Designer" <${process.env.EMAIL_HOST_USER}>`,
        to: user.email,
        subject: "Verify your email address",
        html: `
          <h2>Welcome to Designer!</h2>
          <p>Please click the link below to verify your email address and activate your account:</p>
          <a href="${verifyUrl}" style="display: inline-block; padding: 10px 20px; background-color: #eca8d6; color: #000; text-decoration: none; border-radius: 5px; font-weight: bold; margin-top: 10px;">Verify Email</a>
        `,
      });
    } catch (emailErr: any) {
      // If email fails, delete the user so they can try again, and return the exact error
      console.error("Nodemailer failed:", emailErr);
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