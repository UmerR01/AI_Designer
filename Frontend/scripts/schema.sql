-- Create the users table for email/password auth.
-- Run this once in your Postgres database.

create extension if not exists pgcrypto;

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  first_name text not null,
  last_name text not null,
  is_support_agent boolean not null default false,
  password_hash text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_users_is_support_agent on users(is_support_agent) where is_support_agent = true;

-- Projects (server-backed)
create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references users(id) on delete cascade,
  name text not null,
  kind text not null default 'ui/ux design',
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_projects_owner_id on projects(owner_id);

-- Members (invited users)
create table if not exists project_members (
  project_id uuid not null references projects(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  role text not null,
  created_at timestamptz not null default now(),
  primary key (project_id, user_id),
  constraint chk_project_members_role check (role in ('owner','editor','viewer'))
);

create index if not exists idx_project_members_user_id on project_members(user_id);

-- Email invites (no email sending required; accept via token)
create table if not exists project_invites (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  email text not null,
  role text not null,
  token text not null unique,
  created_by uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  accepted_at timestamptz,
  constraint chk_project_invites_role check (role in ('editor','viewer'))
);

create index if not exists idx_project_invites_project_id on project_invites(project_id);
create index if not exists idx_project_invites_email on project_invites(email);

-- Share links (public or password-protected)
create table if not exists project_share_links (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  slug text not null unique,
  role text not null,
  visibility text not null,
  password_hash text,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  constraint chk_project_share_links_role check (role in ('editor','viewer')),
  constraint chk_project_share_links_visibility check (visibility in ('public','password'))
);

create index if not exists idx_project_share_links_project_id on project_share_links(project_id);

-- Password reset (forgot password flow)
create table if not exists password_reset_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  token_hash text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_password_reset_tokens_hash on password_reset_tokens(token_hash);
create index if not exists idx_password_reset_tokens_user_id on password_reset_tokens(user_id);

-- Support platform (Support Panel + in-app chat)
create table if not exists support_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete set null,
  status text not null default 'open',
  priority text not null default 'normal',
  assigned_agent_id uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  constraint chk_support_conversations_status check (status in ('open','pending','closed')),
  constraint chk_support_conversations_priority check (priority in ('low','normal','high','urgent'))
);

create index if not exists idx_support_conversations_user_id on support_conversations(user_id);
create index if not exists idx_support_conversations_status on support_conversations(status);
create index if not exists idx_support_conversations_assigned_agent_id on support_conversations(assigned_agent_id);
create index if not exists idx_support_conversations_last_message_at on support_conversations(last_message_at desc);

create table if not exists support_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references support_conversations(id) on delete cascade,
  sender_type text not null,
  sender_user_id uuid references users(id) on delete set null,
  body text not null,
  created_at timestamptz not null default now(),
  constraint chk_support_messages_sender_type check (sender_type in ('user','agent','system'))
);

create index if not exists idx_support_messages_conversation_id_created_at on support_messages(conversation_id, created_at asc);

create table if not exists support_read_receipts (
  conversation_id uuid not null references support_conversations(id) on delete cascade,
  reader_type text not null,
  reader_id uuid references users(id) on delete cascade,
  last_read_message_id uuid references support_messages(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (conversation_id, reader_type, reader_id),
  constraint chk_support_read_receipts_reader_type check (reader_type in ('user','agent'))
);

create index if not exists idx_support_read_receipts_reader_id on support_read_receipts(reader_id);

create table if not exists support_events (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references support_conversations(id) on delete cascade,
  type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_support_events_conversation_id_created_at on support_events(conversation_id, created_at desc);

-- Durable generated asset tracking (AI image generations)
create table if not exists project_asset_batches (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  session_id text,
  source text not null default 'ui-designer',
  prompt text,
  model text,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_project_asset_batches_project_id_created_at
  on project_asset_batches(project_id, created_at desc);

create table if not exists project_assets (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  batch_id uuid references project_asset_batches(id) on delete set null,
  source_image_id text,
  page_name text,
  variant integer not null default 1,
  filename text not null,
  url text not null,
  storage_path text,
  width integer,
  height integer,
  bytes integer,
  checksum text,
  mime_type text default 'image/png',
  prompt text,
  created_at timestamptz not null default now(),
  constraint chk_project_assets_variant check (variant > 0)
);

create index if not exists idx_project_assets_project_id_created_at
  on project_assets(project_id, created_at desc);
create index if not exists idx_project_assets_batch_id on project_assets(batch_id);
create index if not exists idx_project_assets_page_name on project_assets(project_id, page_name);
create unique index if not exists uq_project_assets_source_image_id
  on project_assets(project_id, source_image_id)
  where source_image_id is not null;

