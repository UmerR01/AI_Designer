import { createHash, randomBytes } from "crypto";

export function hashResetToken(rawToken: string): string {
  return createHash("sha256").update(rawToken, "utf8").digest("hex");
}

export function generateResetToken(): string {
  return randomBytes(32).toString("base64url");
}

export function getAppOrigin(req?: Request): string {
  const fromEnv = (process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL)?.replace(/\/$/, "");
  if (fromEnv) return fromEnv;
  if (process.env.VERCEL_URL) {
    const url = process.env.VERCEL_URL;
    return url.startsWith("http") ? url : `https://${url}`;
  }
  if (req) {
    try {
      return new URL(req.url).origin;
    } catch {}
  }
  return "http://localhost:3000";
}
