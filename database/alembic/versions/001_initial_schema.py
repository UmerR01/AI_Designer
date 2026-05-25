"""Initial schema — full AI Designer tables.

Revision ID: 001_initial
Revises:
Create Date: 2026-05-22

"""
from pathlib import Path

from alembic import op

revision = "001_initial"
down_revision = None
branch_labels = None
depends_on = None

_SCRIPTS_DIR = Path(__file__).resolve().parents[2].parent / "Frontend" / "scripts"


def upgrade() -> None:
    sql = (_SCRIPTS_DIR / "schema.sql").read_text(encoding="utf-8")
    op.execute(sql)

    op.execute("""
        ALTER TABLE users
          ADD COLUMN IF NOT EXISTS email_verified boolean NOT NULL DEFAULT false;
        ALTER TABLE projects
          ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
        CREATE INDEX IF NOT EXISTS idx_projects_deleted_at
          ON projects(deleted_at) WHERE deleted_at IS NOT NULL;
    """)


def downgrade() -> None:
    # Dev-only rollback: drops app tables in dependency order
    op.execute(
        """
        drop table if exists support_events cascade;
        drop table if exists support_read_receipts cascade;
        drop table if exists support_messages cascade;
        drop table if exists support_conversations cascade;
        drop table if exists project_assets cascade;
        drop table if exists project_asset_batches cascade;
        drop table if exists project_share_links cascade;
        drop table if exists project_invites cascade;
        drop table if exists project_members cascade;
        drop table if exists projects cascade;
        drop table if exists password_reset_tokens cascade;
        drop table if exists users cascade;
        """
    )
