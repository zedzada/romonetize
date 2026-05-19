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
      return NextResponse.json({ 
        success: false, 
        step, 
        error: queryError.message,
        details: queryError.details || null
      }, { status: 500 });
    }

    step = "return_success";
    return NextResponse.json({
      success: true,
      conversations: conversations || [],
    });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      {
        success: false,
        step,
        error: errMsg,
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
      return NextResponse.json({ 
        success: false, 
        step, 
        error: insertError.message,
        details: insertError.details || null
      }, { status: 500 });
    }

    step = "return_success";
    return NextResponse.json({
      success: true,
      conversation,
    });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      {
        success: false,
        step,
        error: errMsg,
      },
      { status: 500 }
    );
  }
}
