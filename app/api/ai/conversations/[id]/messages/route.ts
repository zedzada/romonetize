import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * POST /api/ai/conversations/[id]/messages - Add a message to a conversation
 */

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 });
  }

  const { id: conversationId } = await params;

  try {
    const body = await request.json();
    const { role, content, hasImage, imageUrl, metadata } = body as {
      role: "user" | "assistant" | "error";
      content: string;
      hasImage?: boolean;
      imageUrl?: string;
      metadata?: Record<string, unknown>;
    };

    if (!role || !content) {
      return NextResponse.json({ success: false, error: "Role and content are required" }, { status: 400 });
    }

    // Verify conversation belongs to user
    const { data: conversation, error: convError } = await supabase
      .from("ai_conversations")
      .select("id")
      .eq("id", conversationId)
      .eq("user_id", user.id)
      .single();

    if (convError || !conversation) {
      return NextResponse.json({ success: false, error: "Conversation not found" }, { status: 404 });
    }

    // Insert message
    const { data: message, error: msgError } = await supabase
      .from("ai_messages")
      .insert({
        conversation_id: conversationId,
        user_id: user.id,
        role,
        content,
        has_image: hasImage || false,
        image_url: imageUrl || null,
        metadata: metadata || {},
      })
      .select("id, role, content, has_image, image_url, metadata, created_at")
      .single();

    if (msgError) {
      console.error("[api/ai/conversations/[id]/messages] Error inserting message:", msgError);
      return NextResponse.json({ success: false, error: msgError.message }, { status: 500 });
    }

    // Update conversation's updated_at timestamp
    await supabase
      .from("ai_conversations")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", conversationId);

    return NextResponse.json({
      success: true,
      message,
    });
  } catch (error) {
    console.error("[api/ai/conversations/[id]/messages] Unexpected error:", error);
    return NextResponse.json({ success: false, error: "Failed to add message" }, { status: 500 });
  }
}
