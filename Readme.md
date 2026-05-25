# AI Designer

## How to Run (3 terminals)

### Terminal 1 — Backend (Python AI service)
```bash
cd backend
.\venv\Scripts\activate        # Windows  (source venv/bin/activate on Linux)
pip install -r requirements.txt
python main.py                 # runs on http://localhost:8001
```

### Terminal 2 — Database Migration (one-time, or when schema changes)
```bash
cd database
.venv\Scripts\activate         # Windows  (source .venv/bin/activate on Linux)
pip install -r requirements.txt
python manage.py migrate       # applies all pending migrations
```

### Terminal 3 — Frontend (Next.js)
```bash
cd Frontend
npm install
npm run dev                    # runs on http://localhost:3000
```

---

## Database Commands (Django-style)

| Command | What it does |
|---------|-------------|
| `python manage.py makemigrations -m "add xyz"` | Auto-detect model changes and generate migration |
| `python manage.py migrate` | Apply all pending migrations |
| `python manage.py status` | Show current migration revision |
| `python manage.py history` | List all migrations |

### When you change the schema:
1. Edit `database/models.py` (add/remove/change columns)
2. `python manage.py makemigrations -m "describe the change"`
3. `python manage.py migrate`

## Environment Variables (`Frontend/.env.local`)

All config lives in one file — `Frontend/.env.local`:

```
DB_NAME=graphicdesigner
DB_USER=postgres
DB_PASSWORD=admin1234
DB_HOST=localhost
DB_PORT=5432

AUTH_SECRET=<your-secret>
NEXT_PUBLIC_UIDESIGNER_BACKEND_URL=http://localhost:8001
NEXT_PUBLIC_TURNSTILE_SITE_KEY=<your-cloudflare-site-key>
TURNSTILE_SECRET_KEY=<your-cloudflare-secret-key>
```

Both the Frontend and `database/manage.py` migrations read from this file.
