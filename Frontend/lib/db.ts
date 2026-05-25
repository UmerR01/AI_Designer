import postgres from "postgres";

function buildDbUrl(): string {
  const explicit = process.env.DATABASE_URL;
  if (explicit) return explicit;

  const name = process.env.DB_NAME;
  const user = process.env.DB_USER;
  const password = process.env.DB_PASSWORD ?? "";
  const host = process.env.DB_HOST ?? "localhost";
  const port = process.env.DB_PORT ?? "5432";

  if (!name || !user) {
    throw new Error(
      "Database not configured. Set DB_NAME, DB_USER, DB_PASSWORD, DB_HOST, DB_PORT in .env.local",
    );
  }

  const creds = password ? `${user}:${encodeURIComponent(password)}` : user;
  return `postgres://${creds}@${host}:${port}/${name}`;
}

let _sql: ReturnType<typeof postgres> | null = null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function sql(): any {
  if (_sql) return _sql;
  _sql = postgres(buildDbUrl(), { prepare: false });
  return _sql;
}

