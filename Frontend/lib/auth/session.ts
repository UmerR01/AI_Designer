import { SignJWT, jwtVerify } from "jose";

export const SESSION_COOKIE_NAME = "designer_session";

function getSecretKey(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error("Missing AUTH_SECRET. Set it in your environment variables.");
  }
  return new TextEncoder().encode(secret);
}

export type SessionUser = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  isSupportAgent: boolean;
};

type SessionPayload = {
  sub: string;
  email: string;
  firstName: string;
  lastName: string;
  isSupportAgent: boolean;
};

export async function signSession(user: SessionUser, maxAgeSeconds: number): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload: SessionPayload = {
    sub: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    isSupportAgent: user.isSupportAgent,
  };

  return await new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuedAt(now)
    .setExpirationTime(now + maxAgeSeconds)
    .sign(getSecretKey());
}

export async function verifySession(token: string): Promise<SessionUser | null> {
  try {
    const { payload } = await jwtVerify(token, getSecretKey());
    const id = typeof payload.sub === "string" ? payload.sub : null;
    const email = typeof payload.email === "string" ? payload.email : null;
    const firstName = typeof payload.firstName === "string" ? payload.firstName : "";
    const lastName = typeof payload.lastName === "string" ? payload.lastName : "";
    const isSupportAgent = typeof (payload as any).isSupportAgent === "boolean" ? ((payload as any).isSupportAgent as boolean) : false;
    if (!id || !email) return null;
    return { id, email, firstName, lastName, isSupportAgent };
  } catch {
    return null;
  }
}

