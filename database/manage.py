#!/usr/bin/env python3
"""
Django-style database CLI for AI Designer (Alembic under the hood).

  python manage.py makemigrations -m "msg"  # auto-detect model changes (like Django)
  python manage.py migrate                  # apply migrations
  python manage.py status                   # current revision
  python manage.py history                  # list migrations
  python manage.py revision -m "msg"        # create empty migration (manual SQL)

DB config — set EITHER individual vars (Django-style):
  DB_NAME=graphicdesigner
  DB_USER=designer_user
  DB_PASSWORD=StrongPassword123!
  DB_HOST=localhost
  DB_PORT=5411

OR one URL:
  DATABASE_URL=postgres://designer_user:StrongPassword123!@localhost:5411/graphicdesigner

Put them in Frontend/.env.local or export in shell.
"""
from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path
from urllib.parse import quote_plus

ROOT = Path(__file__).resolve().parent
FRONTEND_ROOT = ROOT.parent / "Frontend"


def load_env_files() -> None:
    """Load env from Frontend/.env.local (single source of truth)."""
    try:
        from dotenv import load_dotenv
    except ImportError:
        return
    load_dotenv(FRONTEND_ROOT / ".env.local", override=True)


def build_database_url() -> str | None:
    """Build DATABASE_URL from individual DB_* vars if DATABASE_URL is not set."""
    url = os.environ.get("DATABASE_URL")
    if url:
        return url

    db_name = os.environ.get("DB_NAME")
    db_user = os.environ.get("DB_USER")
    db_password = os.environ.get("DB_PASSWORD", "")
    db_host = os.environ.get("DB_HOST", "localhost")
    db_port = os.environ.get("DB_PORT", "5432")

    if not db_name or not db_user:
        return None

    pw = quote_plus(db_password) if db_password else ""
    creds = f"{quote_plus(db_user)}:{pw}" if pw else quote_plus(db_user)
    return f"postgres://{creds}@{db_host}:{db_port}/{db_name}"


def run_alembic(args: list[str]) -> int:
    load_env_files()
    url = build_database_url()
    if not url:
        print(
            "DB not configured. Set these in Frontend/.env.local:\n"
            "  DB_NAME=graphicdesigner\n"
            "  DB_USER=designer_user\n"
            "  DB_PASSWORD=YourPassword\n"
            "  DB_HOST=localhost\n"
            "  DB_PORT=5432\n"
            "\nOr set DATABASE_URL directly.",
            file=sys.stderr,
        )
        return 1
    env = {**os.environ, "DATABASE_URL": url}
    return subprocess.call(
        [sys.executable, "-m", "alembic", *args],
        cwd=ROOT,
        env=env,
    )


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__)
        return 0

    cmd = sys.argv[1]
    rest = sys.argv[2:]

    if cmd == "migrate":
        return run_alembic(["upgrade", "head"])
    if cmd in ("status", "showmigrations"):
        return run_alembic(["current", "-v"])
    if cmd == "history":
        return run_alembic(["history", "-v"])
    if cmd == "makemigrations":
        msg = "auto"
        if "-m" in rest:
            i = rest.index("-m")
            if i + 1 < len(rest):
                msg = rest[i + 1]
        return run_alembic(["revision", "--autogenerate", "-m", msg])
    if cmd == "revision":
        msg = "change"
        if "-m" in rest:
            i = rest.index("-m")
            if i + 1 < len(rest):
                msg = rest[i + 1]
        return run_alembic(["revision", "-m", msg])
    if cmd == "help":
        print(__doc__)
        return 0

    print(f"Unknown command: {cmd}\n", file=sys.stderr)
    print(__doc__)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
