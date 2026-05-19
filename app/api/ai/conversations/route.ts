import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

// Admin client for bypassing RLS
function getSupabaseAdmin() {
  const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_CUSTOM_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL;
  return createAdminClient(supabaseUrl!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

/**
 * GET /api/ai/conversations - List user's conversations
 * POST /api/ai/conversations - Create a new conversation
 */

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 });
  }

  const supabaseAdmin = getSupabaseAdmin();
  const url = new URL(request.url);
  const limit = parseInt(url.searchParams.get("limit") || "20", 10);
  const offset = parseInt(url.searchParams.get("offset") || "0", 10);
  const gameId = url.searchParams.get("gameId") || undefined;

  try {
    let query = supabaseAdmin
      .from("ai_conversations")
      .select("id, title, folder, game_id, created_at, updated_at")
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (gameId) {
      query = query.eq("game_id", gameId);
    }

    const { data: conversations, error } = await query;

    if (error) {
      console.error("[api/ai/conversations] Error fetching conversations:", error);
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      conversations: conversations || [],
    });
  } catch (error) {
    console.error("[api/ai/conversations] Unexpected error:", error);
    return NextResponse.json({ success: false, error: "Failed to fetch conversations" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 });
  }

  const supabaseAdmin = getSupabaseAdmin();

  try {
    const body = await request.json();
    const { title, gameId, folder } = body as {
      title?: string;
      gameId?: string;
      folder?: string;
    };

    const { data: conversation, error } = await supabaseAdmin
      .from("ai_conversations")
      .insert({
        user_id: user.id,
        title: title || "New Chat",
        game_id: gameId || null,
        folder: folder || null,
      })
      .select("id, title, folder, game_id, created_at, updated_at")
      .single();

    if (error) {
      console.error("[api/ai/conversations] Error creating conversation:", error);
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      conversation,
    });
  } catch (error) {
    console.error("[api/ai/conversations] Unexpected error:", error);
    return NextResponse.json({ success: false, error: "Failed to create conversation" }, { status: 500 });
  }
}
