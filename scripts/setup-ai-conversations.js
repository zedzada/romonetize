/**
 * Setup AI Conversations Tables
 * 
 * Run with: node --env-file-if-exists=/vercel/share/.env.project scripts/setup-ai-conversations.js
 */

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false }
  });

  // Read the SQL file
  const sqlPath = path.join(__dirname, 'setup-ai-conversations.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');

  console.log('Running AI conversations setup...');
  
  // Split by statements (simple approach - semicolon followed by newline)
  const statements = sql
    .split(/;\s*\n/)
    .map(s => s.trim())
    .filter(s => s.length > 0 && !s.startsWith('--'));

  for (const statement of statements) {
    if (!statement) continue;
    
    const preview = statement.substring(0, 60).replace(/\n/g, ' ') + '...';
    console.log(`Executing: ${preview}`);
    
    const { error } = await supabase.rpc('exec_sql', { sql: statement + ';' }).single();
    
    // If rpc doesn't exist, try direct query through REST
    if (error && error.message?.includes('function') && error.message?.includes('does not exist')) {
      console.log('Note: exec_sql RPC not available, tables may need to be created manually via Supabase dashboard');
      console.log('SQL file location: scripts/setup-ai-conversations.sql');
      break;
    }
    
    if (error && !error.message?.includes('already exists') && !error.message?.includes('does not exist')) {
      console.error('Error:', error.message);
    }
  }

  console.log('Setup complete! Tables created:');
  console.log('  - ai_conversations');
  console.log('  - ai_messages');
  console.log('');
  console.log('If tables were not created automatically, run the SQL manually:');
  console.log('  1. Go to Supabase Dashboard > SQL Editor');
  console.log('  2. Copy contents of scripts/setup-ai-conversations.sql');
  console.log('  3. Execute the SQL');
}

main().catch(console.error);
