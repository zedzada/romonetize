import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";
import * as path from "path";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function runMigration() {
  const migrationFile = process.argv[2];
  
  if (!migrationFile) {
    console.error("Usage: npx ts-node scripts/run-migration.ts <migration-file.sql>");
    process.exit(1);
  }

  const filePath = path.resolve(process.cwd(), "scripts", migrationFile);
  
  if (!fs.existsSync(filePath)) {
    console.error(`Migration file not found: ${filePath}`);
    process.exit(1);
  }

  const sql = fs.readFileSync(filePath, "utf-8");
  
  console.log(`Running migration: ${migrationFile}`);
  console.log("---");
  
  // Execute the SQL using Supabase's rpc for raw SQL execution
  // Note: This requires a custom function in Supabase or direct pg access
  // For now, we'll use the Supabase SQL Editor API
  
  try {
    // Use Supabase's built-in SQL execution via REST API
    const response = await fetch(`${supabaseUrl}/rest/v1/rpc/exec_sql`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": supabaseServiceKey,
        "Authorization": `Bearer ${supabaseServiceKey}`,
      },
      body: JSON.stringify({ query: sql }),
    });
    
    if (!response.ok) {
      const error = await response.text();
      console.error("Migration failed:", error);
      process.exit(1);
    }
    
    console.log("Migration completed successfully!");
  } catch (error) {
    console.error("Migration error:", error);
    process.exit(1);
  }
}

runMigration();
