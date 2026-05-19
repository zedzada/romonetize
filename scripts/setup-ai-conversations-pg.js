/**
 * Setup AI Conversations Tables via Postgres
 * 
 * Run with: node --env-file-if-exists=/vercel/share/.env.project scripts/setup-ai-conversations-pg.js
 */

const { Client } = require('pg');

async function main() {
  const connectionString = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
  if (!connectionString) {
    console.error('Missing POSTGRES_URL');
    process.exit(1);
  }
  
  const client = new Client({ 
    connectionString,
    ssl: { rejectUnauthorized: false }
  });
  await client.connect();
  console.log('Connected to Postgres');
  
  try {
    // Create ai_conversations table
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.ai_conversations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
        game_id UUID NULL REFERENCES public.games(id) ON DELETE SET NULL,
        title TEXT NOT NULL DEFAULT 'New Chat',
        folder TEXT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    console.log('Created ai_conversations table');
    
    // Create ai_messages table
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.ai_messages (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        conversation_id UUID NOT NULL REFERENCES public.ai_conversations(id) ON DELETE CASCADE,
        user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'error')),
        content TEXT NOT NULL,
        has_image BOOLEAN DEFAULT FALSE,
        image_url TEXT NULL,
        metadata JSONB DEFAULT '{}',
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    console.log('Created ai_messages table');
    
    // Enable RLS
    await client.query('ALTER TABLE public.ai_conversations ENABLE ROW LEVEL SECURITY;');
    await client.query('ALTER TABLE public.ai_messages ENABLE ROW LEVEL SECURITY;');
    console.log('Enabled RLS');
    
    // Drop existing policies to avoid conflicts
    const dropPolicies = [
      `DROP POLICY IF EXISTS "Users can select own conversations" ON public.ai_conversations`,
      `DROP POLICY IF EXISTS "Users can insert own conversations" ON public.ai_conversations`,
      `DROP POLICY IF EXISTS "Users can update own conversations" ON public.ai_conversations`,
      `DROP POLICY IF EXISTS "Users can delete own conversations" ON public.ai_conversations`,
      `DROP POLICY IF EXISTS "Users can select own messages" ON public.ai_messages`,
      `DROP POLICY IF EXISTS "Users can insert own messages" ON public.ai_messages`,
      `DROP POLICY IF EXISTS "Users can update own messages" ON public.ai_messages`,
      `DROP POLICY IF EXISTS "Users can delete own messages" ON public.ai_messages`,
      `DROP POLICY IF EXISTS "Service role can manage all conversations" ON public.ai_conversations`,
      `DROP POLICY IF EXISTS "Service role can manage all messages" ON public.ai_messages`,
    ];
    for (const p of dropPolicies) await client.query(p);
    
    // Create RLS policies for conversations
    await client.query(`CREATE POLICY "Users can select own conversations" ON public.ai_conversations FOR SELECT USING (auth.uid() = user_id)`);
    await client.query(`CREATE POLICY "Users can insert own conversations" ON public.ai_conversations FOR INSERT WITH CHECK (auth.uid() = user_id)`);
    await client.query(`CREATE POLICY "Users can update own conversations" ON public.ai_conversations FOR UPDATE USING (auth.uid() = user_id)`);
    await client.query(`CREATE POLICY "Users can delete own conversations" ON public.ai_conversations FOR DELETE USING (auth.uid() = user_id)`);
    
    // Create RLS policies for messages
    await client.query(`CREATE POLICY "Users can select own messages" ON public.ai_messages FOR SELECT USING (auth.uid() = user_id)`);
    await client.query(`CREATE POLICY "Users can insert own messages" ON public.ai_messages FOR INSERT WITH CHECK (auth.uid() = user_id)`);
    await client.query(`CREATE POLICY "Users can update own messages" ON public.ai_messages FOR UPDATE USING (auth.uid() = user_id)`);
    await client.query(`CREATE POLICY "Users can delete own messages" ON public.ai_messages FOR DELETE USING (auth.uid() = user_id)`);
    
    // Service role policies
    await client.query(`CREATE POLICY "Service role can manage all conversations" ON public.ai_conversations FOR ALL USING (auth.jwt()->>'role' = 'service_role')`);
    await client.query(`CREATE POLICY "Service role can manage all messages" ON public.ai_messages FOR ALL USING (auth.jwt()->>'role' = 'service_role')`);
    console.log('Created RLS policies');
    
    // Create indexes
    await client.query('CREATE INDEX IF NOT EXISTS idx_ai_conversations_user_id ON public.ai_conversations(user_id)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_ai_conversations_updated_at ON public.ai_conversations(updated_at DESC)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_ai_messages_conversation_id ON public.ai_messages(conversation_id)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_ai_messages_user_id ON public.ai_messages(user_id)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_ai_messages_created_at ON public.ai_messages(created_at)');
    console.log('Created indexes');
    
    // Create trigger for updated_at
    await client.query(`
      CREATE OR REPLACE FUNCTION update_ai_conversation_updated_at()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.updated_at = NOW();
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);
    
    await client.query(`DROP TRIGGER IF EXISTS trigger_update_ai_conversation_updated_at ON public.ai_conversations`);
    await client.query(`
      CREATE TRIGGER trigger_update_ai_conversation_updated_at
        BEFORE UPDATE ON public.ai_conversations
        FOR EACH ROW
        EXECUTE FUNCTION update_ai_conversation_updated_at();
    `);
    console.log('Created trigger for updated_at');
    
    console.log('\nDone! Tables created successfully:');
    console.log('  - ai_conversations');
    console.log('  - ai_messages');
    
  } catch (error) {
    console.error('Error:', error.message);
    throw error;
  } finally {
    await client.end();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
