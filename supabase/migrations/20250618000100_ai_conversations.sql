-- AI Conversations Migration
-- This migration creates the ai_conversations and ai_messages tables
-- Tables should already exist if you're seeing this - this file is for documentation

-- Create conversations table
CREATE TABLE IF NOT EXISTS public.ai_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  game_id uuid NULL,
  title text NOT NULL,
  folder text NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create messages table
CREATE TABLE IF NOT EXISTS public.ai_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.ai_conversations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  role text NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content text NOT NULL,
  has_image boolean DEFAULT false,
  image_url text NULL,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.ai_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_messages ENABLE ROW LEVEL SECURITY;

-- Conversations policies
DROP POLICY IF EXISTS "Users can select own conversations" ON public.ai_conversations;
CREATE POLICY "Users can select own conversations"
ON public.ai_conversations FOR SELECT
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own conversations" ON public.ai_conversations;
CREATE POLICY "Users can insert own conversations"
ON public.ai_conversations FOR INSERT
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own conversations" ON public.ai_conversations;
CREATE POLICY "Users can update own conversations"
ON public.ai_conversations FOR UPDATE
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own conversations" ON public.ai_conversations;
CREATE POLICY "Users can delete own conversations"
ON public.ai_conversations FOR DELETE
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Service role can manage all conversations" ON public.ai_conversations;
CREATE POLICY "Service role can manage all conversations"
ON public.ai_conversations FOR ALL
USING (auth.role() = 'service_role');

-- Messages policies
DROP POLICY IF EXISTS "Users can select own messages" ON public.ai_messages;
CREATE POLICY "Users can select own messages"
ON public.ai_messages FOR SELECT
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own messages" ON public.ai_messages;
CREATE POLICY "Users can insert own messages"
ON public.ai_messages FOR INSERT
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own messages" ON public.ai_messages;
CREATE POLICY "Users can update own messages"
ON public.ai_messages FOR UPDATE
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own messages" ON public.ai_messages;
CREATE POLICY "Users can delete own messages"
ON public.ai_messages FOR DELETE
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Service role can manage all messages" ON public.ai_messages;
CREATE POLICY "Service role can manage all messages"
ON public.ai_messages FOR ALL
USING (auth.role() = 'service_role');

-- Indexes
CREATE INDEX IF NOT EXISTS ai_conversations_user_updated_idx
ON public.ai_conversations(user_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS ai_messages_conversation_created_idx
ON public.ai_messages(conversation_id, created_at ASC);
