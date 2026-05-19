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
 * GET /api/ai/conversations - List user's conversations
 * POST /api/ai/conversations - Create a new conversation
 */

export async function GET(request: NextRequest) {
  let step = "start";
  let pool: Pool | null = null;
  
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

    step = "init_pool";
    pool = getPool();
    
    step = "parse_params";
    const url = new URL(request.url);
    const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") || "20", 10), 1), 100);
    const offset = Math.max(parseInt(url.searchParams.get("offset") || "0", 10), 0);
    const gameId = url.searchParams.get("gameId") || null;

    step = "query_conversations";
    let queryText = `
      SELECT id, title, folder, game_id, created_at, updated_at
      FROM public.ai_conversations
      WHERE user_id = $1
    `;
    const params: (string | number)[] = [user.id];
    
    if (gameId) {
      queryText += ` AND game_id = $2`;
      params.push(gameId);
    }
    
    queryText += ` ORDER BY updated_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const result = await pool.query(queryText, params);

    step = "return_success";
    return NextResponse.json({
      success: true,
      conversations: result.rows || [],
    });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    
    // Check if table is missing
    if (errMsg.includes("ai_conversations") && 
        (errMsg.includes("does not exist") || errMsg.includes("relation"))) {
      return NextResponse.json({ 
        success: false, 
        step, 
        error: "ai_conversations table missing",
        fix: "Run supabase/migrations/20250618000100_ai_conversations.sql"
      }, { status: 500 });
    }
    
    return NextResponse.json(
      {
        success: false,
        step,
        error: errMsg,
      },
      { status: 500 }
    );
  } finally {
    if (pool) {
      await pool.end();
    }
  }
}

export async function POST(request: NextRequest) {
  let step = "start";
  let pool: Pool | null = null;
  
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

    step = "init_pool";
    pool = getPool();

    step = "parse_body";
    const body = await request.json();
    const { title, gameId, folder } = body as {
      title?: string;
      gameId?: string;
      folder?: string;
    };

    step = "insert_conversation";
    const result = await pool.query(`
      INSERT INTO public.ai_conversations (user_id, title, game_id, folder)
      VALUES ($1, $2, $3, $4)
      RETURNING id, title, folder, game_id, created_at, updated_at
    `, [
      user.id,
      title ? title.substring(0, 100) : "New Chat",
      gameId || null,
      folder || null,
    ]);

    step = "return_success";
    return NextResponse.json({
      success: true,
      conversation: result.rows[0],
    });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    
    // Check if table is missing
    if (errMsg.includes("ai_conversations") && 
        (errMsg.includes("does not exist") || errMsg.includes("relation"))) {
      return NextResponse.json({ 
        success: false, 
        step, 
        error: "ai_conversations table missing",
        fix: "Run supabase/migrations/20250618000100_ai_conversations.sql"
      }, { status: 500 });
    }
    
    return NextResponse.json(
      {
        success: false,
        step,
        error: errMsg,
      },
      { status: 500 }
    );
  } finally {
    if (pool) {
      await pool.end();
    }
  }
}
