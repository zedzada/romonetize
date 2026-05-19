-- AI Conversations tables for persistent chat history
-- Migration: 20240601000001_ai_conversations.sql

-- Create ai_conversations table
create table if not exists public.ai_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  game_id uuid null,
  title text not null,
  folder text null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Create ai_messages table
create table if not exists public.ai_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.ai_conversations(id) on delete cascade,
  user_id uuid not null,
  role text not null check (role in ('user', 'assistant', 'system')),
  content text not null,
  has_image boolean default false,
  image_url text null,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

-- Enable RLS
alter table public.ai_conversations enable row level security;
alter table public.ai_messages enable row level security;

-- Conversation policies
drop policy if exists "Users can read own ai conversations" on public.ai_conversations;
create policy "Users can read own ai conversations"
on public.ai_conversations for select
using (auth.uid() = user_id);

drop policy if exists "Users can insert own ai conversations" on public.ai_conversations;
create policy "Users can insert own ai conversations"
on public.ai_conversations for insert
with check (auth.uid() = user_id);

drop policy if exists "Users can update own ai conversations" on public.ai_conversations;
create policy "Users can update own ai conversations"
on public.ai_conversations for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can delete own ai conversations" on public.ai_conversations;
create policy "Users can delete own ai conversations"
on public.ai_conversations for delete
using (auth.uid() = user_id);

-- Message policies
drop policy if exists "Users can read own ai messages" on public.ai_messages;
create policy "Users can read own ai messages"
on public.ai_messages for select
using (auth.uid() = user_id);

drop policy if exists "Users can insert own ai messages" on public.ai_messages;
create policy "Users can insert own ai messages"
on public.ai_messages for insert
with check (auth.uid() = user_id);

drop policy if exists "Users can delete own ai messages" on public.ai_messages;
create policy "Users can delete own ai messages"
on public.ai_messages for delete
using (auth.uid() = user_id);

-- Indexes for performance
create index if not exists ai_conversations_user_updated_idx
on public.ai_conversations(user_id, updated_at desc);

create index if not exists ai_messages_conversation_created_idx
on public.ai_messages(conversation_id, created_at asc);

-- Grant service role full access for admin client operations
grant all on public.ai_conversations to service_role;
grant all on public.ai_messages to service_role;
