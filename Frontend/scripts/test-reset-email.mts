/**
 * One-off: sends a sample forgot-password email using lib/email.ts.
 * Usage: npx tsx scripts/test-reset-email.mts
 * Optional: TEST_EMAIL_TO=you@x.com (defaults to EMAIL_HOST_USER)
 */
import { config } from "dotenv";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
config({ path: resolve(root, ".env.local") });

const { sendPasswordResetEmail } = await import("../lib/email");

const to = process.env.TEST_EMAIL_TO?.trim() || process.env.EMAIL_HOST_USER;
if (!to) {
  console.error("Need EMAIL_HOST_USER or TEST_EMAIL_TO in .env.local");
  process.exit(1);
}

const origin = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") || "http://localhost:3000";
const resetUrl = `${origin}/reset-password?token=__test_only__`;

await sendPasswordResetEmail({ toEmail: to, resetUrl });
console.log("OK: password reset sample sent to:", to);
