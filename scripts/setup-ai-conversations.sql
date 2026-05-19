-- AI Conversations and Messages tables for persistent chat history
-- Run this in your Supabase SQL editor or via migration

-- Create ai_conversations table
CREATE TABLE IF NOT EXISTS public.ai_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  game_id UUID NULL REFERENCES public.games(id) ON DELETE SET NULL,
  title TEXT NOT NULL DEFAULT 'New Chat',
  folder TEXT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create ai_messages table
CREATE TABLE IF NOT EXISTS public.ai_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES public.ai_conversations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'error')),
  content TEXT NOT NULL,
  has_image BOOLEAN DEFAULT FALSE,
  image_url TEXT NULL,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.ai_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_messages ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist (for re-running)
DROP POLICY IF EXISTS "Users can select own conversations" ON public.ai_conversations;
DROP POLICY IF EXISTS "Users can insert own conversations" ON public.ai_conversations;
DROP POLICY IF EXISTS "Users can update own conversations" ON public.ai_conversations;
DROP POLICY IF EXISTS "Users can delete own conversations" ON public.ai_conversations;

DROP POLICY IF EXISTS "Users can select own messages" ON public.ai_messages;
DROP POLICY IF EXISTS "Users can insert own messages" ON public.ai_messages;
DROP POLICY IF EXISTS "Users can update own messages" ON public.ai_messages;
DROP POLICY IF EXISTS "Users can delete own messages" ON public.ai_messages;

-- RLS policies for ai_conversations
CREATE POLICY "Users can select own conversations" 
  ON public.ai_conversations 
  FOR SELECT 
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own conversations" 
  ON public.ai_conversations 
  FOR INSERT 
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own conversations" 
  ON public.ai_conversations 
  FOR UPDATE 
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own conversations" 
  ON public.ai_conversations 
  FOR DELETE 
  USING (auth.uid() = user_id);

-- RLS policies for ai_messages
CREATE POLICY "Users can select own messages" 
  ON public.ai_messages 
  FOR SELECT 
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own messages" 
  ON public.ai_messages 
  FOR INSERT 
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own messages" 
  ON public.ai_messages 
  FOR UPDATE 
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own messages" 
  ON public.ai_messages 
  FOR DELETE 
  USING (auth.uid() = user_id);

-- Service role policies for server-side operations
DROP POLICY IF EXISTS "Service role can manage all conversations" ON public.ai_conversations;
DROP POLICY IF EXISTS "Service role can manage all messages" ON public.ai_messages;

CREATE POLICY "Service role can manage all conversations"
  ON public.ai_conversations
  FOR ALL
  USING (auth.jwt()->>'role' = 'service_role');

CREATE POLICY "Service role can manage all messages"
  ON public.ai_messages
  FOR ALL
  USING (auth.jwt()->>'role' = 'service_role');

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_ai_conversations_user_id ON public.ai_conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_ai_conversations_updated_at ON public.ai_conversations(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_messages_conversation_id ON public.ai_messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_ai_messages_user_id ON public.ai_messages(user_id);
CREATE INDEX IF NOT EXISTS idx_ai_messages_created_at ON public.ai_messages(created_at);

-- Function to auto-update updated_at
CREATE OR REPLACE FUNCTION update_ai_conversation_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update updated_at on conversation changes
DROP TRIGGER IF EXISTS trigger_update_ai_conversation_updated_at ON public.ai_conversations;
CREATE TRIGGER trigger_update_ai_conversation_updated_at
  BEFORE UPDATE ON public.ai_conversations
  FOR EACH ROW
  EXECUTE FUNCTION update_ai_conversation_updated_at();

-- Comment
COMMENT ON TABLE public.ai_conversations IS 'Stores AI Assistant conversation sessions';
COMMENT ON TABLE public.ai_messages IS 'Stores individual messages within AI conversations';
