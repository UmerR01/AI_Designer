import { NextResponse } from "next/server";

function pgCode(err: unknown): string | undefined {
  if (typeof err !== "object" || err === null || !("code" in err)) return undefined;
  const c = (err as { code?: unknown }).code;
  return typeof c === "string" ? c : undefined;
}

/**
 * Maps common Postgres / connection failures to a safe JSON response for auth routes.
 */
export function dbConnectionErrorResponse(err: unknown): NextResponse | null {
  const code = pgCode(err);
  if (code === "28P01") {
    return NextResponse.json(
      {
        detail:
          "Database login failed: the password in DATABASE_URL does not match your Postgres user. Update .env.local or align your server password. See Frontend/scripts/LOCAL_POSTGRES_SETUP.md for the Docker example.",
      },
      { status: 503 },
    );
  }
  if (code === "3D000") {
    return NextResponse.json(
      {
        detail:
          "Database does not exist. Create the database from DATABASE_URL or run the setup in Frontend/scripts/LOCAL_POSTGRES_SETUP.md.",
      },
      { status: 503 },
    );
  }
  const msg = String((err as { message?: unknown })?.message ?? err ?? "");
  if (/ECONNREFUSED/i.test(msg) || code === "ECONNREFUSED") {
    return NextResponse.json(
      {
        detail:
          "Cannot reach Postgres (connection refused). Start Postgres or Docker and check DATABASE_URL host/port.",
      },
      { status: 503 },
    );
  }
  return null;
}
