import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

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

    if (authError || !user) {
      // Return empty conversations for unauthenticated users instead of error
      return NextResponse.json({ 
        success: false, 
        conversations: [],
        error: "Not authenticated" 
      }, { status: 200 });
    }

    step = "parse_params";
    const url = new URL(request.url);
    const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") || "20", 10), 1), 100);
    const offset = Math.max(parseInt(url.searchParams.get("offset") || "0", 10), 0);
    const gameId = url.searchParams.get("gameId") || null;

    step = "query_conversations";
    let query = supabase
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
      // Return empty conversations on query error - do not crash
      console.error("[ai/conversations] Query error:", queryError.message);
      return NextResponse.json({ 
        success: false, 
        conversations: [],
        error: "Conversations unavailable"
      }, { status: 200 });
    }

    step = "return_success";
    return NextResponse.json({
      success: true,
      conversations: conversations || [],
    });
  } catch (err) {
    // Return empty conversations on any error - do not crash
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error("[ai/conversations] Unexpected error:", errMsg);
    return NextResponse.json({
      success: false,
      conversations: [],
      error: "Conversations unavailable",
    }, { status: 200 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ 
        success: false, 
        conversation: null,
        error: "Not authenticated" 
      }, { status: 200 });
    }

    const body = await request.json();
    const { title, gameId, folder } = body as {
      title?: string;
      gameId?: string;
      folder?: string;
    };

    const { data: conversation, error: insertError } = await supabase
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
      console.error("[ai/conversations] Insert error:", insertError.message);
      return NextResponse.json({ 
        success: false, 
        conversation: null,
        error: "Failed to create conversation"
      }, { status: 200 });
    }

    return NextResponse.json({
      success: true,
      conversation,
    });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error("[ai/conversations] POST error:", errMsg);
    return NextResponse.json({
      success: false,
      conversation: null,
      error: "Failed to create conversation",
    }, { status: 200 });
  }
}
