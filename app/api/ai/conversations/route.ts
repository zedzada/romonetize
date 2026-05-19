import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * GET /api/ai/conversations - List user's conversations
 * POST /api/ai/conversations - Create a new conversation
 * 
 * Returns debug fields for troubleshooting:
 * - authenticated: boolean
 * - userId: string | null
 * - tableCheck: { aiConversationsReadable, aiMessagesReadable, error }
 */

export async function GET(request: NextRequest) {
  let step = "start";
  let authenticated = false;
  let userId: string | null = null;
  const tableCheck = {
    aiConversationsReadable: false,
    aiMessagesReadable: false,
    error: null as string | null,
  };
  
  try {
    step = "get_user";
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ 
        success: false, 
        authenticated: false,
        userId: null,
        tableCheck,
        conversations: [],
        error: "Not authenticated",
        step,
      });
    }
    
    authenticated = true;
    userId = user.id;

    step = "parse_params";
    const url = new URL(request.url);
    const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") || "20", 10), 1), 100);
    const offset = Math.max(parseInt(url.searchParams.get("offset") || "0", 10), 0);
    const gameId = url.searchParams.get("gameId") || null;

    // Test table access
    step = "test_tables";
    
    // Test ai_conversations table
    const { error: convTestError } = await supabase
      .from("ai_conversations")
      .select("id")
      .limit(1);
    
    if (convTestError) {
      tableCheck.error = `ai_conversations: ${convTestError.message}`;
    } else {
      tableCheck.aiConversationsReadable = true;
    }
    
    // Test ai_messages table
    const { error: msgTestError } = await supabase
      .from("ai_messages")
      .select("id")
      .limit(1);
    
    if (msgTestError) {
      tableCheck.error = (tableCheck.error ? tableCheck.error + "; " : "") + `ai_messages: ${msgTestError.message}`;
    } else {
      tableCheck.aiMessagesReadable = true;
    }

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
      console.error("[ai/conversations] Query error:", queryError.message);
      return NextResponse.json({ 
        success: false,
        authenticated,
        userId,
        tableCheck,
        conversations: [],
        error: queryError.message,
        step,
      });
    }

    // Success - return conversations (may be empty array)
    step = "return_success";
    return NextResponse.json({
      success: true,
      authenticated,
      userId,
      tableCheck,
      conversations: conversations || [],
      step,
    });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error("[ai/conversations] Unexpected error:", errMsg);
    return NextResponse.json({
      success: false,
      authenticated,
      userId,
      tableCheck,
      conversations: [],
      error: errMsg,
      step,
    });
  }
}

export async function POST(request: NextRequest) {
  let step = "start";
  
  try {
    step = "get_user";
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ 
        success: false, 
        conversation: null,
        error: "Not authenticated",
        step,
      });
    }

    step = "parse_body";
    const body = await request.json();
    const { title, gameId, folder } = body as {
      title?: string;
      gameId?: string;
      folder?: string;
    };

    step = "insert_conversation";
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
      console.error("[ai/conversations] Insert error:", insertError.message, insertError.details, insertError.hint);
      return NextResponse.json({ 
        success: false, 
        conversation: null,
        error: insertError.message,
        details: insertError.details || null,
        hint: insertError.hint || null,
        step,
      });
    }

    return NextResponse.json({
      success: true,
      conversation,
      step,
    });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error("[ai/conversations] POST error:", errMsg);
    return NextResponse.json({
      success: false,
      conversation: null,
      error: errMsg,
      step,
    });
  }
}
