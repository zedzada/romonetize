import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

/**
 * API endpoint to add missing profile columns.
 * This runs once when needed and is idempotent.
 * 
 * POST /api/admin/migrate-profile-columns
 */
export async function POST() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    return NextResponse.json(
      { error: "Missing Supabase configuration" },
      { status: 500 }
    );
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    // Try to add the columns using raw SQL via Supabase's postgres connection
    // This uses the service role key which has admin privileges
    
    // First, check if columns exist by trying to select them
    const { error: checkError } = await supabase
      .from("profiles")
      .select("display_username, discord_username")
      .limit(1);

    if (checkError && checkError.message.includes("does not exist")) {
      // Columns don't exist - they need to be added via SQL
      // Since we can't run raw DDL via the client, return instructions
      return NextResponse.json({
        success: false,
        message: "Columns need to be added via SQL",
        sql: `
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS display_username text,
ADD COLUMN IF NOT EXISTS discord_username text;
        `.trim(),
      });
    }

    // Columns exist
    return NextResponse.json({
      success: true,
      message: "Profile columns already exist",
    });
  } catch (error) {
    console.error("[migrate-profile-columns] Error:", error);
    return NextResponse.json(
      { error: "Failed to check/migrate columns" },
      { status: 500 }
    );
  }
}
