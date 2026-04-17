/**
 * Check why "forgot password" might not deliver mail:
 * 1) Is this email registered in the DB?
 * 2) Can we send SMTP to that address (same as production path)?
 *
 * Usage: npx tsx scripts/diagnose-forgot-email.mts you@example.com
 */
import { config } from "dotenv";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
config({ path: resolve(root, ".env.local") });

const emailArg = process.argv[2]?.trim().toLowerCase();
if (!emailArg || !emailArg.includes("@")) {
  console.error("Usage: npx tsx scripts/diagnose-forgot-email.mts you@example.com");
  process.exit(1);
}

async function main() {
  const { sql } = await import("../lib/db");
  const { sendPasswordResetEmail } = await import("../lib/email");
  const { getAppOrigin } = await import("../lib/auth/password-reset");

  if (!process.env.DATABASE_URL) {
    console.error("Missing DATABASE_URL (same as your Next app).");
    process.exit(1);
  }

  const rows = await sql()<{ id: string }>`
    select id from users where email = ${emailArg} limit 1
  `;
  const user = rows[0];

  if (!user) {
    console.log("");
    console.log("RESULT: No user row for this email.");
    console.log("  The forgot-password API will NOT send mail (by design).");
    console.log("  Sign up first, or use the exact email you registered with.");
    console.log("");
    process.exit(0);
  }

  console.log("RESULT: User exists in DB — forgot-password would try to send mail.");
  console.log("");

  try {
    const resetUrl = `${getAppOrigin()}/reset-password?token=diagnose-only-not-valid`;
    await sendPasswordResetEmail({ toEmail: emailArg, resetUrl });
    console.log("RESULT: SMTP send to that inbox succeeded.");
    console.log("  Check Inbox + Spam for “Reset your Designer password”.");
    console.log("  (The link token above is fake — use a real reset from the app.)");
  } catch (e: unknown) {
    console.error("RESULT: SMTP send FAILED (this is why you get no mail):");
    console.error(e);
    process.exit(1);
  }
}

main();
