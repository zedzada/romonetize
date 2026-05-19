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
 * - source: "ai_conversations" | "ai_messages_fallback" | "empty"
 * - tableCheck: { aiConversationsReadable, aiMessagesReadable, error }
 */

export async function GET(request: NextRequest) {
  let step = "start";
  let authenticated = false;
  let userId: string | null = null;
  let source: "ai_conversations" | "ai_messages_fallback" | "empty" = "empty";
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
        source,
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

    // Try to get conversations from ai_conversations table first
    step = "query_conversations";
    let conversations: Array<{
      id: string;
      title: string;
      folder: string | null;
      game_id: string | null;
      created_at: string;
      updated_at: string;
      message_count?: number;
    }> = [];

    if (tableCheck.aiConversationsReadable) {
      let query = supabase
        .from("ai_conversations")
        .select("id, title, folder, game_id, created_at, updated_at")
        .eq("user_id", user.id)
        .order("updated_at", { ascending: false })
        .range(offset, offset + limit - 1);

      if (gameId) {
        query = query.eq("game_id", gameId);
      }

      const { data: convData, error: queryError } = await query;

      if (!queryError && convData && convData.length > 0) {
        source = "ai_conversations";
        conversations = convData;
      }
    }

    // If no conversations found, fallback to grouping ai_messages by conversation_id
    if (conversations.length === 0 && tableCheck.aiMessagesReadable) {
      step = "fallback_to_messages";
      
      // Get distinct conversation_ids with their first user message as title
      const { data: messagesData, error: messagesError } = await supabase
        .from("ai_messages")
        .select("conversation_id, role, content, created_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: true });

      if (!messagesError && messagesData && messagesData.length > 0) {
        // Group messages by conversation_id
        const conversationMap = new Map<string, {
          id: string;
          firstUserMessage: string | null;
          latestCreatedAt: string;
          messageCount: number;
        }>();

        for (const msg of messagesData) {
          if (!msg.conversation_id) continue;
          
          const existing = conversationMap.get(msg.conversation_id);
          if (existing) {
            existing.messageCount++;
            if (msg.created_at > existing.latestCreatedAt) {
              existing.latestCreatedAt = msg.created_at;
            }
            // Only set first user message if not already set
            if (!existing.firstUserMessage && msg.role === "user") {
              existing.firstUserMessage = msg.content;
            }
          } else {
            conversationMap.set(msg.conversation_id, {
              id: msg.conversation_id,
              firstUserMessage: msg.role === "user" ? msg.content : null,
              latestCreatedAt: msg.created_at,
              messageCount: 1,
            });
          }
        }

        // Convert to conversation format
        const fallbackConversations = Array.from(conversationMap.values())
          .map(conv => ({
            id: conv.id,
            title: conv.firstUserMessage 
              ? (conv.firstUserMessage.length > 50 
                  ? conv.firstUserMessage.substring(0, 50) + "..." 
                  : conv.firstUserMessage)
              : "New conversation",
            folder: null,
            game_id: null,
            created_at: conv.latestCreatedAt,
            updated_at: conv.latestCreatedAt,
            message_count: conv.messageCount,
          }))
          .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
          .slice(offset, offset + limit);

        if (fallbackConversations.length > 0) {
          source = "ai_messages_fallback";
          conversations = fallbackConversations;
        }
      }
    }

    // Return result
    step = "return_success";
    return NextResponse.json({
      success: true,
      authenticated,
      userId,
      source,
      tableCheck,
      conversations,
      messagesFallbackCount: source === "ai_messages_fallback" ? conversations.length : 0,
      step,
    });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error("[ai/conversations] Unexpected error:", errMsg);
    return NextResponse.json({
      success: false,
      authenticated,
      userId,
      source,
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
