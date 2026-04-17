-- Support platform schema (premium Support Panel)
-- Run this in the same Postgres database as DATABASE_URL.

create extension if not exists pgcrypto;

-- Support agents: minimal role flag (v1)
alter table users
  add column if not exists is_support_agent boolean not null default false;

create index if not exists idx_users_is_support_agent on users(is_support_agent) where is_support_agent = true;

-- Conversations
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

-- Messages
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

-- Read receipts (optional but helpful)
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

-- Events/audit trail (optional but very useful)
create table if not exists support_events (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references support_conversations(id) on delete cascade,
  type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_support_events_conversation_id_created_at on support_events(conversation_id, created_at desc);

