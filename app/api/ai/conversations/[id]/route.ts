import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * GET /api/ai/conversations/[id] - Get a conversation with its messages
 * PATCH /api/ai/conversations/[id] - Update conversation (title, folder)
 * DELETE /api/ai/conversations/[id] - Delete a conversation
 */

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 });
    }

    const { id } = await params;

    // Get conversation
    const { data: conversation, error: convError } = await supabase
      .from("ai_conversations")
      .select("id, title, folder, game_id, created_at, updated_at")
      .eq("id", id)
      .eq("user_id", user.id)
      .single();

    if (convError || !conversation) {
      return NextResponse.json({ success: false, error: "Conversation not found" }, { status: 404 });
    }

    // Get messages
    const { data: messages, error: msgError } = await supabase
      .from("ai_messages")
      .select("id, role, content, has_image, image_url, metadata, created_at")
      .eq("conversation_id", id)
      .eq("user_id", user.id)
      .order("created_at", { ascending: true });

    if (msgError) {
      return NextResponse.json({ success: false, error: msgError.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      conversation,
      messages: messages || [],
    });
  } catch (error) {
    console.error("[api/ai/conversations/[id]] Unexpected error:", error);
    return NextResponse.json({ 
      success: false, 
      error: error instanceof Error ? error.message : "Failed to fetch conversation" 
    }, { status: 500 });
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
      return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 });
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
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    if (!conversation) {
      return NextResponse.json({ success: false, error: "Conversation not found" }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      conversation,
    });
  } catch (error) {
    console.error("[api/ai/conversations/[id]] Unexpected error:", error);
    return NextResponse.json({ 
      success: false, 
      error: error instanceof Error ? error.message : "Failed to update conversation" 
    }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 });
    }

    const { id } = await params;

    const { error } = await supabase
      .from("ai_conversations")
      .delete()
      .eq("id", id)
      .eq("user_id", user.id);

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[api/ai/conversations/[id]] Unexpected error:", error);
    return NextResponse.json({ 
      success: false, 
      error: error instanceof Error ? error.message : "Failed to delete conversation" 
    }, { status: 500 });
  }
}
