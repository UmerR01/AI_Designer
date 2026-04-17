import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE_NAME, verifySession } from "@/lib/auth/session";
import { sql } from "@/lib/db";

export async function GET() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return NextResponse.json({ user: null }, { status: 200 });
  const user = await verifySession(token);
  if (!user) return NextResponse.json({ user: null }, { status: 200 });

  // If DB was reset/replaced, a stale cookie may reference a user that no longer exists.
  // Treat it as signed-out to avoid downstream FK errors (e.g., project creation).
  const existing = await sql()<{ id: string }[]>`
    select id from users where id = ${user.id} limit 1
  `;
  if (!existing[0]?.id) {
    cookieStore.set(SESSION_COOKIE_NAME, "", { path: "/", maxAge: 0, httpOnly: true, sameSite: "lax" });
    return NextResponse.json({ user: null }, { status: 200 });
  }

  return NextResponse.json(
    {
      user: {
        id: user.id,
        email: user.email,
        first_name: user.firstName,
        last_name: user.lastName,
        is_support_agent: user.isSupportAgent,
      },
    },
    { status: 200 }
  );
}

