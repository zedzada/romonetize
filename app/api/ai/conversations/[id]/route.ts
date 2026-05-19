import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * GET /api/ai/conversations/[id] - Get a conversation with its messages
 * PATCH /api/ai/conversations/[id] - Update conversation (title, folder)
 * DELETE /api/ai/conversations/[id] - Delete a conversation
 * 
 * Fallback: If conversation row is missing but messages exist, build conversation from first user message.
 */

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let step = "start";
  
  try {
    step = "get_user";
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ 
        success: false, 
        error: "Not authenticated",
        step,
      });
    }

    step = "get_params";
    const { id } = await params;

    if (!id) {
      return NextResponse.json({ 
        success: false, 
        error: "Missing conversation ID",
        step,
      });
    }

    // Try to get conversation from ai_conversations table
    step = "get_conversation";
    let conversation: {
      id: string;
      title: string;
      folder?: string | null;
      game_id?: string | null;
      created_at: string;
      updated_at: string;
    } | null = null;

    const { data: convData, error: convError } = await supabase
      .from("ai_conversations")
      .select("id, title, folder, game_id, created_at, updated_at")
      .eq("id", id)
      .eq("user_id", user.id)
      .single();

    if (!convError && convData) {
      conversation = convData;
    }

    // Get messages for this conversation
    step = "get_messages";
    const { data: messagesData, error: msgError } = await supabase
      .from("ai_messages")
      .select("id, role, content, has_image, image_url, metadata, created_at")
      .eq("conversation_id", id)
      .eq("user_id", user.id)
      .order("created_at", { ascending: true });

    if (msgError) {
      console.error("[api/ai/conversations/[id]] Messages error:", msgError.message);
      return NextResponse.json({ 
        success: false, 
        error: `Failed to load messages: ${msgError.message}`,
        step,
      });
    }

    const messages = messagesData || [];

    // FALLBACK: If conversation row doesn't exist but messages do, build conversation from first user message
    if (!conversation && messages.length > 0) {
      step = "build_conversation_from_messages";
      const firstUserMessage = messages.find(m => m.role === "user");
      const firstMessage = messages[0];
      const lastMessage = messages[messages.length - 1];
      
      conversation = {
        id: id,
        title: firstUserMessage?.content 
          ? (firstUserMessage.content.length > 50 
              ? firstUserMessage.content.substring(0, 50) + "..." 
              : firstUserMessage.content)
          : "Conversation",
        folder: null,
        game_id: null,
        created_at: firstMessage.created_at,
        updated_at: lastMessage.created_at,
      };
    }

    // If still no conversation and no messages, return error
    if (!conversation && messages.length === 0) {
      return NextResponse.json({ 
        success: false, 
        error: "Conversation not found",
        step: "conversation_not_found",
      });
    }

    step = "return_success";
    return NextResponse.json({
      success: true,
      conversation,
      messages: messages.map(m => ({
        id: m.id,
        role: m.role,
        content: m.content,
        has_image: m.has_image || false,
        image_url: m.image_url || null,
        metadata: m.metadata || {},
        created_at: m.created_at,
      })),
      messageCount: messages.length,
      step,
    });
  } catch (error) {
    console.error("[api/ai/conversations/[id]] Unexpected error:", error);
    return NextResponse.json({ 
      success: false, 
      error: error instanceof Error ? error.message : "Failed to fetch conversation",
      step,
    });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ success: false, error: "Not authenticated" });
    }

    const { id } = await params;

    const body = await request.json();
    const { title, folder } = body as {
      title?: string;
      folder?: string | null;
    };

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (title !== undefined) updates.title = title;
    if (folder !== undefined) updates.folder = folder;

    const { data: conversation, error } = await supabase
      .from("ai_conversations")
      .update(updates)
      .eq("id", id)
      .eq("user_id", user.id)
      .select("id, title, folder, game_id, created_at, updated_at")
      .single();

    if (error) {
      return NextResponse.json({ success: false, error: error.message });
    }

    if (!conversation) {
      return NextResponse.json({ success: false, error: "Conversation not found" });
    }

    return NextResponse.json({
      success: true,
      conversation,
    });
  } catch (error) {
    console.error("[api/ai/conversations/[id]] PATCH error:", error);
    return NextResponse.json({ 
      success: false, 
      error: error instanceof Error ? error.message : "Failed to update conversation" 
    });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let step = "start";
  
  try {
    step = "get_user";
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ success: false, error: "Not authenticated", step });
    }

    step = "get_params";
    const { id } = await params;

    // Delete messages first (they reference conversation_id)
    step = "delete_messages";
    const { error: msgDeleteError } = await supabase
      .from("ai_messages")
      .delete()
      .eq("conversation_id", id)
      .eq("user_id", user.id);

    if (msgDeleteError) {
      console.error("[api/ai/conversations/[id]] Delete messages error:", msgDeleteError.message);
      // Continue anyway - conversation might not have messages
    }

    // Delete conversation
    step = "delete_conversation";
    const { error: convDeleteError } = await supabase
      .from("ai_conversations")
      .delete()
      .eq("id", id)
      .eq("user_id", user.id);

    if (convDeleteError) {
      console.error("[api/ai/conversations/[id]] Delete conversation error:", convDeleteError.message);
      // If conversation doesn't exist but messages were deleted, still return success
    }

    step = "return_success";
    return NextResponse.json({ success: true, step });
  } catch (error) {
    console.error("[api/ai/conversations/[id]] DELETE error:", error);
    return NextResponse.json({ 
      success: false, 
      error: error instanceof Error ? error.message : "Failed to delete conversation",
      step,
    });
  }
}
