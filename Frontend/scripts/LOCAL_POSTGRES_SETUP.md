# Local Postgres Setup (SQLite Unsupported)

This project requires PostgreSQL features (`uuid`, `jsonb`, `timestamptz`, constraints/indexes), so SQLite is not supported.

## 1) Start local Postgres with Docker

```bash
docker run --name ai-graphicdesigner-pg ^
  -e POSTGRES_USER=postgres ^
  -e POSTGRES_PASSWORD=postgres ^
  -e POSTGRES_DB=graphicdesigner ^
  -p 5432:5432 ^
  -d postgres:16
```

## 2) Configure environment

Set in `.env.local`:

```env
DATABASE_URL=postgres://postgres:postgres@localhost:5432/graphicdesigner
```

## 3) Apply schema

```bash
psql "postgres://postgres:postgres@localhost:5432/graphicdesigner" -f scripts/schema.sql
```

## 4) Preflight before dev

```bash
npm run db:preflight
```

If preflight passes, start the app:

```bash
npm run dev
```

## Optional: Backfill historical UI images

If you have existing `ui-designer-project/backend/ui_designs/*/images.json`:

```bash
npm run db:backfill:ui-designs -- --project-id=<project-uuid>
```

Use `--dry-run` first to preview:

```bash
npm run db:backfill:ui-designs -- --project-id=<project-uuid> --dry-run
```

