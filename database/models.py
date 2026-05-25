"""
SQLAlchemy models for AI Designer.

Change these models, then run:
    python manage.py makemigrations -m "describe change"
    python manage.py migrate
"""
from __future__ import annotations

import uuid

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Text,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


# ── Users ────────────────────────────────────────────────────────────────────

class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    email: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    first_name: Mapped[str] = mapped_column(Text, nullable=False)
    last_name: Mapped[str] = mapped_column(Text, nullable=False)
    is_support_agent: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("false"))
    password_hash: Mapped[str] = mapped_column(Text, nullable=False)
    email_verified: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("false"))
    created_at: Mapped[str] = mapped_column(DateTime(timezone=True), nullable=False, server_default=text("now()"))

    __table_args__ = (
        Index("idx_users_is_support_agent", "is_support_agent", postgresql_where=text("is_support_agent = true")),
    )


# ── Projects ─────────────────────────────────────────────────────────────────

class Project(Base):
    __tablename__ = "projects"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    owner_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    kind: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("'ui/ux design'"))
    data: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default=text("'{}'::jsonb"))
    created_at: Mapped[str] = mapped_column(DateTime(timezone=True), nullable=False, server_default=text("now()"))
    updated_at: Mapped[str] = mapped_column(DateTime(timezone=True), nullable=False, server_default=text("now()"))
    deleted_at: Mapped[str | None] = mapped_column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        Index("idx_projects_owner_id", "owner_id"),
        Index("idx_projects_deleted_at", "deleted_at", postgresql_where=text("deleted_at IS NOT NULL")),
    )


# ── Project Members ──────────────────────────────────────────────────────────

class ProjectMember(Base):
    __tablename__ = "project_members"

    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    role: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[str] = mapped_column(DateTime(timezone=True), nullable=False, server_default=text("now()"))

    __table_args__ = (
        CheckConstraint("role in ('owner','editor','viewer')", name="chk_project_members_role"),
        Index("idx_project_members_user_id", "user_id"),
    )


# ── Project Invites ──────────────────────────────────────────────────────────

class ProjectInvite(Base):
    __tablename__ = "project_invites"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    email: Mapped[str] = mapped_column(Text, nullable=False)
    role: Mapped[str] = mapped_column(Text, nullable=False)
    token: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    created_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    created_at: Mapped[str] = mapped_column(DateTime(timezone=True), nullable=False, server_default=text("now()"))
    expires_at: Mapped[str | None] = mapped_column(DateTime(timezone=True), nullable=True)
    accepted_at: Mapped[str | None] = mapped_column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        CheckConstraint("role in ('editor','viewer')", name="chk_project_invites_role"),
        Index("idx_project_invites_project_id", "project_id"),
        Index("idx_project_invites_email", "email"),
    )


# ── Project Share Links ──────────────────────────────────────────────────────

class ProjectShareLink(Base):
    __tablename__ = "project_share_links"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    slug: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    role: Mapped[str] = mapped_column(Text, nullable=False)
    visibility: Mapped[str] = mapped_column(Text, nullable=False)
    password_hash: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[str] = mapped_column(DateTime(timezone=True), nullable=False, server_default=text("now()"))
    revoked_at: Mapped[str | None] = mapped_column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        CheckConstraint("role in ('editor','viewer')", name="chk_project_share_links_role"),
        CheckConstraint("visibility in ('public','password')", name="chk_project_share_links_visibility"),
        Index("idx_project_share_links_project_id", "project_id"),
    )


# ── Password Reset Tokens ───────────────────────────────────────────────────

class PasswordResetToken(Base):
    __tablename__ = "password_reset_tokens"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    token_hash: Mapped[str] = mapped_column(Text, nullable=False)
    expires_at: Mapped[str] = mapped_column(DateTime(timezone=True), nullable=False)
    used_at: Mapped[str | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[str] = mapped_column(DateTime(timezone=True), nullable=False, server_default=text("now()"))

    __table_args__ = (
        Index("idx_password_reset_tokens_hash", "token_hash"),
        Index("idx_password_reset_tokens_user_id", "user_id"),
    )


# ── Support Conversations ────────────────────────────────────────────────────

class SupportConversation(Base):
    __tablename__ = "support_conversations"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    status: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("'open'"))
    priority: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("'normal'"))
    assigned_agent_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[str] = mapped_column(DateTime(timezone=True), nullable=False, server_default=text("now()"))
    updated_at: Mapped[str] = mapped_column(DateTime(timezone=True), nullable=False, server_default=text("now()"))
    last_message_at: Mapped[str] = mapped_column(DateTime(timezone=True), nullable=False, server_default=text("now()"))

    __table_args__ = (
        CheckConstraint("status in ('open','pending','closed')", name="chk_support_conversations_status"),
        CheckConstraint("priority in ('low','normal','high','urgent')", name="chk_support_conversations_priority"),
        Index("idx_support_conversations_user_id", "user_id"),
        Index("idx_support_conversations_status", "status"),
        Index("idx_support_conversations_assigned_agent_id", "assigned_agent_id"),
        Index("idx_support_conversations_last_message_at", text("last_message_at DESC")),
    )


# ── Support Messages ─────────────────────────────────────────────────────────

class SupportMessage(Base):
    __tablename__ = "support_messages"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    conversation_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("support_conversations.id", ondelete="CASCADE"), nullable=False)
    sender_type: Mapped[str] = mapped_column(Text, nullable=False)
    sender_user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[str] = mapped_column(DateTime(timezone=True), nullable=False, server_default=text("now()"))

    __table_args__ = (
        CheckConstraint("sender_type in ('user','agent','system')", name="chk_support_messages_sender_type"),
        Index("idx_support_messages_conversation_id_created_at", "conversation_id", "created_at"),
    )


# ── Support Read Receipts ────────────────────────────────────────────────────

class SupportReadReceipt(Base):
    __tablename__ = "support_read_receipts"

    conversation_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("support_conversations.id", ondelete="CASCADE"), primary_key=True)
    reader_type: Mapped[str] = mapped_column(Text, primary_key=True)
    reader_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    last_read_message_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("support_messages.id", ondelete="SET NULL"), nullable=True)
    updated_at: Mapped[str] = mapped_column(DateTime(timezone=True), nullable=False, server_default=text("now()"))

    __table_args__ = (
        CheckConstraint("reader_type in ('user','agent')", name="chk_support_read_receipts_reader_type"),
        Index("idx_support_read_receipts_reader_id", "reader_id"),
    )


# ── Support Events ───────────────────────────────────────────────────────────

class SupportEvent(Base):
    __tablename__ = "support_events"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    conversation_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("support_conversations.id", ondelete="CASCADE"), nullable=False)
    type: Mapped[str] = mapped_column(Text, nullable=False)
    payload: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default=text("'{}'::jsonb"))
    created_at: Mapped[str] = mapped_column(DateTime(timezone=True), nullable=False, server_default=text("now()"))

    __table_args__ = (
        Index("idx_support_events_conversation_id_created_at", "conversation_id", text("created_at DESC")),
    )


# ── Project Asset Batches ────────────────────────────────────────────────────

class ProjectAssetBatch(Base):
    __tablename__ = "project_asset_batches"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    session_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    source: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("'ui-designer'"))
    prompt: Mapped[str | None] = mapped_column(Text, nullable=True)
    model: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[str] = mapped_column(DateTime(timezone=True), nullable=False, server_default=text("now()"))

    __table_args__ = (
        Index("idx_project_asset_batches_project_id_created_at", "project_id", text("created_at DESC")),
    )


# ── Project Assets ───────────────────────────────────────────────────────────

class ProjectAsset(Base):
    __tablename__ = "project_assets"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    batch_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("project_asset_batches.id", ondelete="SET NULL"), nullable=True)
    source_image_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    page_name: Mapped[str | None] = mapped_column(Text, nullable=True)
    variant: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("1"))
    filename: Mapped[str] = mapped_column(Text, nullable=False)
    url: Mapped[str] = mapped_column(Text, nullable=False)
    storage_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    width: Mapped[int | None] = mapped_column(Integer, nullable=True)
    height: Mapped[int | None] = mapped_column(Integer, nullable=True)
    bytes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    checksum: Mapped[str | None] = mapped_column(Text, nullable=True)
    mime_type: Mapped[str | None] = mapped_column(Text, nullable=True, server_default=text("'image/png'"))
    prompt: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[str] = mapped_column(DateTime(timezone=True), nullable=False, server_default=text("now()"))

    __table_args__ = (
        CheckConstraint("variant > 0", name="chk_project_assets_variant"),
        Index("idx_project_assets_project_id_created_at", "project_id", text("created_at DESC")),
        Index("idx_project_assets_batch_id", "batch_id"),
        Index("idx_project_assets_page_name", "project_id", "page_name"),
        Index("uq_project_assets_source_image_id", "project_id", "source_image_id", unique=True, postgresql_where=text("source_image_id IS NOT NULL")),
    )
