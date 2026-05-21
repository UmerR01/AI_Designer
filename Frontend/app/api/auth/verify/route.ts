import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { verifyEmailVerificationToken } from "@/lib/auth/session";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const token = searchParams.get("token");

  if (!token) {
    return NextResponse.redirect(new URL("/login?error=MissingToken", req.url));
  }

  const email = await verifyEmailVerificationToken(token);
  if (!email) {
    return NextResponse.redirect(new URL("/login?error=InvalidOrExpiredToken", req.url));
  }

  try {
    await sql()`
      update users
      set email_verified = true
      where email = ${email}
    `;
    return NextResponse.redirect(new URL("/login?verified=true", req.url));
  } catch (err) {
    console.error("Verification error:", err);
    return NextResponse.redirect(new URL("/login?error=VerificationFailed", req.url));
  }
}
