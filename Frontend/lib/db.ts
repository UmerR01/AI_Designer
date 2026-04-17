import postgres from "postgres";

/**
 * Lazily create the SQL client so builds don't fail when `DATABASE_URL`
 * isn't present in the local environment.
 */
let _sql: ReturnType<typeof postgres> | null = null;

/**
 * Returns a Postgres tagged-template client. Route handlers use `sql()<Row>()\`...\``;
 * the `<Row>` cast is for typings only.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function sql(): any {
  if (_sql) return _sql;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("Missing DATABASE_URL. Set it in your environment variables.");
  _sql = postgres(url, {
    // Works reliably across local/prod Postgres without prepared statement cache pitfalls.
    prepare: false,
  });
  return _sql;
}

