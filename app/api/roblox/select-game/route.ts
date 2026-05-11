import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import crypto from "crypto";
import { getRobloxGameThumbnail } from "@/lib/services/roblox-api";

function generateApiKey(): string {
  return `rm_${crypto.randomBytes(24).toString("hex")}`;
}

export async function POST(request: NextRequest) {
  let body: Record<string, unknown> = {};
  
  try {
    // Parse request body - accept both camelCase and snake_case
    try {
      body = await request.json();
    } catch (parseError) {
      return NextResponse.json(
        { 
          success: false,
          step: "parse_body",
          error: "Failed to parse request body",
          details: parseError instanceof Error ? parseError.message : "Unknown parse error",
        },
        { status: 400 }
      );
    }
    
    // Accept multiple ID formats for compatibility
    const roblox_game_id = body.roblox_game_id || body.robloxGameId || body.universeId || body.id;
    const name = body.name || body.gameName;
    const rootPlaceId = body.rootPlaceId || body.root_place_id;
    const source = body.source;
    const groupId = body.groupId || body.group_id;
    const groupName = body.groupName || body.group_name;
    const roleName = body.roleName || body.role_name;
    const roleRank = body.roleRank ?? body.role_rank;
    const iconUrl = body.iconUrl || body.icon_url;

    console.log("[API] /api/roblox/select-game called with:", {
      roblox_game_id,
      name,
      rootPlaceId,
      source,
      groupId,
      groupName,
      roleName,
      roleRank,
      iconUrl: iconUrl ? "provided" : "not provided",
    });

    // Validate required fields
    if (!roblox_game_id || !name) {
      return NextResponse.json(
        { 
          success: false,
          step: "validate_payload",
          error: "Missing robloxGameId or name",
          receivedBody: body,
        },
        { status: 400 }
      );
    }

    // Get authenticated user
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      console.log("[API] Auth error:", authError);
      return NextResponse.json(
        { 
          success: false,
          step: "auth",
          error: "Unauthorized - not logged in",
          details: authError?.message || "No user session",
        },
        { status: 401 }
      );
    }

    console.log("[API] Authenticated user:", user.id);

    // Check if this game already exists for this user
    const { data: existingGame, error: existingError } = await supabase
      .from("games")
      .select("*")
      .eq("user_id", user.id)
      .eq("roblox_game_id", String(roblox_game_id))
      .maybeSingle();

    if (existingError) {
      console.log("[API] Error checking existing game:", existingError);
    }

    console.log("[API] Existing game check:", existingGame ? "Found" : "Not found");

    // If game doesn't exist, check plan limits before creating
    if (!existingGame) {
      // Get user's plan
      const { data: profile } = await supabase
        .from("profiles")
        .select("plan")
        .eq("id", user.id)
        .single();

      const plan = profile?.plan || "free";
      const planLimits: Record<string, number> = {
        free: 1,
        pro: 5,
        studio: 25,
      };
      const limit = planLimits[plan] || 1;

      // Count current games
      const { count, error: countError } = await supabase
        .from("games")
        .select("*", { count: "exact", head: true })
        .eq("user_id", user.id)
        .neq("status", "deleted");

      if (countError) {
        console.log("[API] Error counting games:", countError);
      }

      const currentCount = count || 0;

      console.log("[API] Plan check:", { plan, limit, currentCount });

      if (currentCount >= limit) {
        return NextResponse.json(
          { 
            success: false,
            step: "plan_limit",
            error: "Plan limit reached",
            message: `You've reached your plan limit of ${limit} game${limit > 1 ? "s" : ""}. Upgrade your plan to connect more games.`,
            limit,
            current: currentCount,
          },
          { status: 403 }
        );
      }
    }

    // Build update object - only include columns that exist in the schema
    // Note: is_selected may not exist yet, we'll handle the error gracefully
    const updateFields: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    // Try to deselect all current games for this user
    // This may fail if is_selected column doesn't exist
    const { error: deselectError } = await supabase
      .from("games")
      .update({ is_selected: false, updated_at: new Date().toISOString() })
      .eq("user_id", user.id);

    if (deselectError) {
      console.log("[API] Warning: Could not deselect games (is_selected column may not exist):", deselectError.message);
      // Continue anyway - the column might not exist yet
    }

    if (existingGame) {
      // Game exists - select it and update metadata if provided (allows fixing missing group metadata)
      const updateData: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
        is_selected: true,
      };

      // Update group metadata if provided (allows re-connecting to fix missing metadata)
      if (source) {
        updateData.source = source === "group" ? "group" : "user";
      }
      if (groupId) {
        updateData.group_id = String(groupId);
      }
      if (groupName) {
        updateData.group_name = groupName;
      }
      if (rootPlaceId) {
        updateData.root_place_id = String(rootPlaceId);
      }
      if (roleName) {
        updateData.role_name = roleName;
      }
      if (roleRank !== undefined && roleRank !== null) {
        updateData.role_rank = Number(roleRank);
      }

      // Update icon_url if provided or fetch it if missing
      let gameIconUrl = iconUrl || existingGame.icon_url;
      if (!gameIconUrl) {
        try {
          gameIconUrl = await getRobloxGameThumbnail(String(roblox_game_id));
        } catch (e) {
          console.log("[API] Could not fetch icon:", e);
        }
      }
      if (gameIconUrl) {
        updateData.icon_url = gameIconUrl;
      }

      console.log("[API] Updating existing game with:", updateData);

      // Try to update with all fields
      const { data: updatedGame, error: updateError } = await supabase
        .from("games")
        .update(updateData)
        .eq("id", existingGame.id)
        .select("*")
        .single();

      if (updateError) {
        console.error("[API] Error selecting game:", {
          message: updateError.message,
          code: updateError.code,
          details: updateError.details,
          hint: updateError.hint,
        });
        
        // If is_selected doesn't exist, try without it
        if (updateError.message.includes("is_selected")) {
          const { data: fallbackGame, error: fallbackError } = await supabase
            .from("games")
            .update(updateData)
            .eq("id", existingGame.id)
            .select("*")
            .single();

          if (fallbackError) {
            return NextResponse.json(
              { 
                success: false,
                step: "select_game",
                error: `Failed to select game: ${fallbackError.message}`,
                supabaseError: fallbackError,
              },
              { status: 500 }
            );
          }

          return NextResponse.json({
            success: true,
            game: fallbackGame,
            message: `Selected ${name}`,
            action: "selected",
            warning: "is_selected column not found - run migration",
          });
        }

        return NextResponse.json(
          { 
            success: false,
            step: "select_game",
            error: `Failed to select game: ${updateError.message}`,
            supabaseError: updateError,
          },
          { status: 500 }
        );
      }

      return NextResponse.json({
        success: true,
        game: updatedGame,
        message: `Selected ${name}`,
        action: "selected",
      });
    }

    // Game doesn't exist - create new entry
    const apiKey = generateApiKey();

    // Fetch icon if not provided
    let gameIconUrl = iconUrl;
    if (!gameIconUrl) {
      try {
        gameIconUrl = await getRobloxGameThumbnail(String(roblox_game_id));
      } catch (e) {
        console.log("[API] Could not fetch icon for new game:", e);
      }
    }

    // Build insert object with all fields including group metadata
    const insertData: Record<string, unknown> = {
      user_id: user.id,
      roblox_game_id: String(roblox_game_id),
      name: name.trim(),
      api_key: apiKey,
      status: "active",
      is_selected: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      // Group metadata
      source: source === "group" ? "group" : "user",
      group_id: groupId ? String(groupId) : null,
      group_name: groupName || null,
      root_place_id: rootPlaceId ? String(rootPlaceId) : null,
      role_name: roleName || null,
      role_rank: roleRank !== undefined && roleRank !== null ? Number(roleRank) : null,
      // Icon
      icon_url: gameIconUrl || null,
    };

    console.log("[API] Inserting game with data:", insertData);

    // Insert the game
    const { data: newGame, error: insertError } = await supabase
      .from("games")
      .insert(insertData)
      .select("*")
      .single();

    if (insertError) {
      console.error("[API] Error creating game:", {
        message: insertError.message,
        code: insertError.code,
        details: insertError.details,
        hint: insertError.hint,
      });

      // If is_selected column doesn't exist, try without it
      if (insertError.message.includes("is_selected")) {
        console.log("[API] Retrying insert without is_selected column...");
        
        const { data: fallbackGame, error: fallbackError } = await supabase
          .from("games")
          .insert(insertData)
          .select("*")
          .single();

        if (fallbackError) {
          console.error("[API] Fallback insert also failed:", {
            message: fallbackError.message,
            code: fallbackError.code,
            details: fallbackError.details,
            hint: fallbackError.hint,
          });
          return NextResponse.json(
            { 
              success: false,
              step: "upsert_game",
              error: `Failed to create game: ${fallbackError.message}`,
              supabaseError: fallbackError,
            },
            { status: 500 }
          );
        }

        return NextResponse.json({
          success: true,
          game: fallbackGame,
          message: `Connected ${name}`,
          action: "created",
          warning: "is_selected column not found - run migration to add it",
        });
      }

      return NextResponse.json(
        { 
          success: false,
          step: "upsert_game",
          error: `Failed to create game: ${insertError.message}`,
          supabaseError: insertError,
        },
        { status: 500 }
      );
    }

    console.log("[API] Game created successfully:", newGame.id);

    return NextResponse.json({
      success: true,
      game: newGame,
      message: `Connected ${name}`,
      action: "created",
    });
  } catch (error) {
    console.error("[API] /api/roblox/select-game unexpected error:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { 
        success: false,
        step: "unknown",
        error: `Internal server error: ${errorMessage}`,
        receivedBody: body,
      },
      { status: 500 }
    );
  }
}
