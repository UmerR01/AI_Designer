import { createHash, randomBytes } from "crypto";

export function hashResetToken(rawToken: string): string {
  return createHash("sha256").update(rawToken, "utf8").digest("hex");
}

export function generateResetToken(): string {
  return randomBytes(32).toString("base64url");
}

export function getAppOrigin(req?: Request): string {
  // 1. Explicit environment variables take precedence
  const fromEnv = (process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL)?.replace(/\/$/, "");
  if (fromEnv) return fromEnv;

  // 2. Vercel deployment support
  if (process.env.VERCEL_URL) {
    const url = process.env.VERCEL_URL;
    return url.startsWith("http") ? url : `https://${url}`;
  }

  // 3. Fallback for development mode only
  if (process.env.NODE_ENV === "development") {
    if (req) {
      try {
        const host = req.headers.get("host");
        if (host) {
          return `http://${host}`;
        }
        return new URL(req.url).origin;
      } catch {}
    }
    return "http://localhost:3000";
  }

  // 4. In production, do not guess or fall back to localhost. Require the ENV variable.
  throw new Error("Missing NEXT_PUBLIC_APP_URL or APP_URL environment variable in production.");
}
