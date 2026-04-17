import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { sql } from "@/lib/db";
import { SESSION_COOKIE_NAME, signSession } from "@/lib/auth/session";

const LoginSchema = z.object({
  email: z.string().email().max(255),
  password: z.string().min(1).max(200),
  remember: z.boolean().optional().default(true),
});

export async function POST(req: Request) {
  const json = await req.json().catch(() => null);
  const parsed = LoginSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ detail: "Invalid email or password." }, { status: 400 });
  }

  const { email, password, remember } = parsed.data;

  const result = await sql()<{
    id: string;
    email: string;
    first_name: string;
    last_name: string;
    password_hash: string;
    is_support_agent: boolean;
  }>`
    select id, email, first_name, last_name, password_hash, is_support_agent
    from users
    where email = ${email.toLowerCase()}
    limit 1
  `;

  const user = result[0];
  if (!user) return NextResponse.json({ detail: "Invalid email or password." }, { status: 401 });

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

