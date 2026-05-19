import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

// Admin client for bypassing RLS
function getSupabaseAdmin() {
  const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_CUSTOM_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Missing Supabase configuration");
  }
  
  return createAdminClient(supabaseUrl, serviceRoleKey);
}

/**
 * GET /api/ai/conversations - List user's conversations
 * POST /api/ai/conversations - Create a new conversation
 */

export async function GET(request: NextRequest) {
  let step = "start";
  
  try {
    step = "get_user";
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError) {
      return NextResponse.json({ 
        success: false, 
        step, 
        error: `Auth error: ${authError.message}` 
      }, { status: 401 });
    }

    if (!user) {
      return NextResponse.json({ 
        success: false, 
        step, 
        error: "Not authenticated" 
      }, { status: 401 });
    }

    step = "init_admin";
    const supabaseAdmin = getSupabaseAdmin();
    
    step = "parse_params";
    const url = new URL(request.url);
    const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") || "20", 10), 1), 100);
    const offset = Math.max(parseInt(url.searchParams.get("offset") || "0", 10), 0);
    const gameId = url.searchParams.get("gameId") || undefined;

    step = "query_conversations";
    let query = supabaseAdmin
      .from("ai_conversations")
      .select("id, title, folder, game_id, created_at, updated_at")
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (gameId) {
      query = query.eq("game_id", gameId);
    }

    const { data: conversations, error: queryError } = await query;

    if (queryError) {
      // Check if table is missing
      if (queryError.message.includes("ai_conversations") && 
          (queryError.message.includes("does not exist") || 
           queryError.message.includes("schema cache") ||
           queryError.code === "42P01")) {
        return NextResponse.json({ 
          success: false, 
          step, 
          error: "ai_conversations table missing. Run migration: supabase/migrations/20240601000001_ai_conversations.sql" 
        }, { status: 500 });
      }
      return NextResponse.json({ 
        success: false, 
        step, 
        error: queryError.message 
      }, { status: 500 });
    }

    step = "return_success";
    return NextResponse.json({
      success: true,
      conversations: conversations || [],
    });
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        step,
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  let step = "start";
  
  try {
    step = "get_user";
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError) {
      return NextResponse.json({ 
        success: false, 
        step, 
        error: `Auth error: ${authError.message}` 
      }, { status: 401 });
    }

    if (!user) {
      return NextResponse.json({ 
        success: false, 
        step, 
        error: "Not authenticated" 
      }, { status: 401 });
    }

    step = "init_admin";
    const supabaseAdmin = getSupabaseAdmin();

    step = "parse_body";
    const body = await request.json();
    const { title, gameId, folder } = body as {
      title?: string;
      gameId?: string;
      folder?: string;
    };

    step = "insert_conversation";
    const { data: conversation, error: insertError } = await supabaseAdmin
      .from("ai_conversations")
      .insert({
        user_id: user.id,
        title: title ? title.substring(0, 100) : "New Chat",
        game_id: gameId || null,
        folder: folder || null,
      })
      .select("id, title, folder, game_id, created_at, updated_at")
      .single();

    if (insertError) {
      // Check if table is missing
      if (insertError.message.includes("ai_conversations") && 
          (insertError.message.includes("does not exist") || 
           insertError.message.includes("schema cache") ||
           insertError.code === "42P01")) {
        return NextResponse.json({ 
          success: false, 
          step, 
          error: "ai_conversations table missing. Run migration: supabase/migrations/20240601000001_ai_conversations.sql" 
        }, { status: 500 });
      }
      return NextResponse.json({ 
        success: false, 
        step, 
        error: insertError.message 
      }, { status: 500 });
    }

    step = "return_success";
    return NextResponse.json({
      success: true,
      conversation,
    });
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        step,
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}
