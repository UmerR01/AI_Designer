import { cookies } from "next/headers";
import { SESSION_COOKIE_NAME, verifySession, type SessionUser } from "@/lib/auth/session";

export async function getOptionalUser(): Promise<SessionUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;
  return await verifySession(token);
}

export async function requireUser(): Promise<SessionUser> {
  const user = await getOptionalUser();
  if (!user) throw new Error("UNAUTHORIZED");
  return user;
}

