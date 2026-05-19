import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { Pool } from "pg";

export const dynamic = "force-dynamic";

// Direct PostgreSQL connection to bypass PostgREST schema cache issues
function getPool() {
  const connectionString = process.env.POSTGRES_URL;
  if (!connectionString) {
    throw new Error("Missing POSTGRES_URL");
  }
  return new Pool({ 
    connectionString,
    ssl: { rejectUnauthorized: false },
    max: 1,
  });
}

/**
 * GET /api/ai/conversations/[id] - Get a conversation with its messages
 * PATCH /api/ai/conversations/[id] - Update conversation (title, folder)
 * DELETE /api/ai/conversations/[id] - Delete a conversation
 */

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let pool: Pool | null = null;
  
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 });
    }

    pool = getPool();
    const { id } = await params;

    // Get conversation
    const convResult = await pool.query(`
      SELECT id, title, folder, game_id, created_at, updated_at
      FROM public.ai_conversations
      WHERE id = $1 AND user_id = $2
    `, [id, user.id]);

    if (convResult.rows.length === 0) {
      return NextResponse.json({ success: false, error: "Conversation not found" }, { status: 404 });
    }

    // Get messages
    const msgResult = await pool.query(`
      SELECT id, role, content, has_image, image_url, metadata, created_at
      FROM public.ai_messages
      WHERE conversation_id = $1 AND user_id = $2
      ORDER BY created_at ASC
    `, [id, user.id]);

    return NextResponse.json({
      success: true,
      conversation: convResult.rows[0],
      messages: msgResult.rows || [],
    });
  } catch (error) {
    console.error("[api/ai/conversations/[id]] Unexpected error:", error);
    return NextResponse.json({ 
      success: false, 
      error: error instanceof Error ? error.message : "Failed to fetch conversation" 
    }, { status: 500 });
  } finally {
    if (pool) await pool.end();
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let pool: Pool | null = null;
  
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 });
    }

    pool = getPool();
    const { id } = await params;

    const body = await request.json();
    const { title, folder } = body as {
      title?: string;
      folder?: string | null;
    };

    const updates: string[] = [];
    const values: (string | null)[] = [];
    let paramIdx = 1;

    if (title !== undefined) {
      updates.push(`title = $${paramIdx++}`);
      values.push(title);
    }
    if (folder !== undefined) {
      updates.push(`folder = $${paramIdx++}`);
      values.push(folder);
    }

    if (updates.length === 0) {
      return NextResponse.json({ success: false, error: "No updates provided" }, { status: 400 });
    }

    updates.push(`updated_at = NOW()`);
    values.push(id, user.id);

    const result = await pool.query(`
      UPDATE public.ai_conversations
      SET ${updates.join(", ")}
      WHERE id = $${paramIdx++} AND user_id = $${paramIdx}
      RETURNING id, title, folder, game_id, created_at, updated_at
    `, values);

    if (result.rows.length === 0) {
      return NextResponse.json({ success: false, error: "Conversation not found" }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      conversation: result.rows[0],
    });
  } catch (error) {
    console.error("[api/ai/conversations/[id]] Unexpected error:", error);
    return NextResponse.json({ 
      success: false, 
      error: error instanceof Error ? error.message : "Failed to update conversation" 
    }, { status: 500 });
  } finally {
    if (pool) await pool.end();
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let pool: Pool | null = null;
  
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ success: false, error: "Not authenticated" }, { status: 401 });
    }

    pool = getPool();
    const { id } = await params;

    await pool.query(`
      DELETE FROM public.ai_conversations
      WHERE id = $1 AND user_id = $2
    `, [id, user.id]);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[api/ai/conversations/[id]] Unexpected error:", error);
    return NextResponse.json({ 
      success: false, 
      error: error instanceof Error ? error.message : "Failed to delete conversation" 
    }, { status: 500 });
  } finally {
    if (pool) await pool.end();
  }
}
