import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { sql } from "@/lib/db";
import { SESSION_COOKIE_NAME, signSession } from "@/lib/auth/session";

const SignupSchema = z.object({
  first_name: z.string().min(1).max(80),
  last_name: z.string().min(1).max(80),
  email: z.string().email().max(255),
  password: z.string().min(8).max(200),
});

export async function POST(req: Request) {
  const json = await req.json().catch(() => null);
  const parsed = SignupSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ detail: "Invalid input." }, { status: 400 });
  }

  const { first_name, last_name, email, password } = parsed.data;
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
    const maxAgeSeconds = 60 * 60 * 24 * 30;
    const token = await signSession(
      { id: user.id, email: user.email, firstName: user.first_name, lastName: user.last_name, isSupportAgent: false },
      maxAgeSeconds
    );

    const res = NextResponse.json({ ok: true, user: { id: user.id, email: user.email } });
    res.cookies.set(SESSION_COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: maxAgeSeconds,
    });
    return res;
  } catch (e: any) {
    const msg = String(e?.message ?? "");
    if (msg.toLowerCase().includes("duplicate") || msg.toLowerCase().includes("unique")) {
      return NextResponse.json({ detail: "An account with that email already exists." }, { status: 409 });
    }
    return NextResponse.json({ detail: "Sign up failed." }, { status: 500 });
  }
}

