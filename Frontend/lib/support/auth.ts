import { requireUser } from "@/lib/auth/server";
import { sql } from "@/lib/db";

export type SupportAgent = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
};

export async function requireSupportAgent(): Promise<SupportAgent> {
  const user = await requireUser();

  // Prefer DB truth (role can change after login).
  const rows = await sql()<{ is_support_agent: boolean }>`
    select is_support_agent from users where id = ${user.id} limit 1
  `;
  const ok = Boolean(rows[0]?.is_support_agent ?? user.isSupportAgent);
  if (!ok) throw new Error("FORBIDDEN");

  return { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName };
}

