import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { verifyEmailVerificationToken } from "@/lib/auth/session";
import { getAppOrigin } from "@/lib/auth/password-reset";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const token = searchParams.get("token");

  if (!token) {
    return NextResponse.redirect(`${getAppOrigin(req)}/login?error=MissingToken`);
  }

  const email = await verifyEmailVerificationToken(token);
  if (!email) {
    return NextResponse.redirect(`${getAppOrigin(req)}/login?error=InvalidOrExpiredToken`);
  }

  try {
    await sql()`
      update users
      set email_verified = true
      where email = ${email}
    `;
    return NextResponse.redirect(`${getAppOrigin(req)}/login?verified=true`);
  } catch (err) {
    console.error("Verification error:", err);
    return NextResponse.redirect(`${getAppOrigin(req)}/login?error=VerificationFailed`);
  }
}
