import { SignJWT, jwtVerify } from "jose";

type SharePayload = {
  slug: string;
  role: "viewer" | "editor";
};

function getSecretKey(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("Missing AUTH_SECRET.");
  return new TextEncoder().encode(secret);
}

export function shareUnlockCookieName(slug: string) {
  return `designer_share_${slug}`;
}

export async function signShareUnlock(slug: string, role: "viewer" | "editor", maxAgeSeconds: number) {
  const now = Math.floor(Date.now() / 1000);
  const payload: SharePayload = { slug, role };
  return await new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuedAt(now)
    .setExpirationTime(now + maxAgeSeconds)
    .sign(getSecretKey());
}

export async function verifyShareUnlock(token: string): Promise<SharePayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecretKey());
    const slug = typeof payload.slug === "string" ? payload.slug : null;
    const role = payload.role === "viewer" || payload.role === "editor" ? payload.role : null;
    if (!slug || !role) return null;
    return { slug, role };
  } catch {
    return null;
  }
}

