# Database migrations (Django-style workflow)

T
## One-time setup (local or server)

```bash
cd database
python -m venv .venv

# Windows
.venv\Scripts\activate
# Linux
source .venv/bin/activate

pip install -r requirements.txt
```



## Daily commands (what you’ll actually run)

### Apply all pending migrations (like `migrate`)

```bash
python manage.py migrate
```

### See current DB version

```bash
python manage.py status
```

### New schema change (safe workflow)

1. Create an empty migration file:

   ```bash
   python manage.py revision -m "add foo column to projects"
   ```

2. Edit the new file under `alembic/versions/` — only `upgrade()` and `downgrade()`.

3. Apply it:

   ```bash
   python manage.py migrate
   ```

4. On the server: pull code → `python manage.py migrate` → `sudo systemctl restart ui-frontend.service`.

### Brand-new empty database

```bash
python manage.py migrate
```

That runs migration `001_initial` (full schema from `init-fresh-database.sql`).

## Safety rules

1. **Never edit an old migration** that already ran on production — add a **new** revision instead.
2. **Backup production** before `migrate` on prod (or test on a copy first).
3. **Same `DATABASE_URL`** for Next.js and `manage.py` (one database, one truth).
4. Old one-off scripts (`scripts/migrate.mjs` with hardcoded URL) are **deprecated** — use this folder only.

## What we’re not doing (on purpose)

- **Not** moving the app to Django — too big, no benefit.
- **Not** using Prisma/Drizzle in Node yet — you asked for Python-style workflow; Alembic is enough.
- **Not** auto-generating migrations from models until we add SQLAlchemy models (optional later).

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `DATABASE_URL` missing | Export it or set in `Frontend/.env.local` |
| `relation already exists` on fresh DB | DB isn’t empty; use a new database or drop `public` schema (dev only) |
| `column does not exist` on prod | Run `python manage.py migrate` on production |
| Next app still errors after migrate | Restart `ui-frontend.service` |

## Folder layout

```
database/
  manage.py              ← CLI you run
  requirements.txt       ← alembic + driver
  alembic.ini
  alembic/
    env.py
    versions/
      001_initial_schema.py
```
