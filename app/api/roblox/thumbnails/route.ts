import { NextRequest, NextResponse } from "next/server";

interface ThumbnailData {
  targetId: number;
  state: string;
  imageUrl: string | null;
}

interface ThumbnailResponse {
  data: ThumbnailData[];
}

/**
 * GET /api/roblox/thumbnails?universeIds=123,456,789
 * 
 * Server-side proxy to fetch game thumbnails from Roblox API.
 * Avoids CORS issues by making the request server-side.
 * 
 * Query params:
 * - universeIds: Comma-separated list of Universe IDs
 * 
 * Returns:
 * {
 *   success: true,
 *   thumbnails: { [universeId: string]: string }  // URL mapping
 * }
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const universeIdsParam = searchParams.get("universeIds");

    if (!universeIdsParam) {
      return NextResponse.json(
        { success: false, error: "universeIds parameter is required" },
        { status: 400 }
      );
    }

    // Parse and validate IDs
    const validIds = universeIdsParam
      .split(",")
      .map(id => id.trim())
      .filter(id => id && /^\d+$/.test(id));

    if (validIds.length === 0) {
      return NextResponse.json(
        { success: false, error: "No valid universe IDs provided" },
        { status: 400 }
      );
    }

    // Limit to 100 IDs per request (Roblox API limit)
    const idsToFetch = validIds.slice(0, 100);
    const thumbnails: Record<string, string> = {};

    try {
      const response = await fetch(
        `https://thumbnails.roblox.com/v1/games/icons?universeIds=${idsToFetch.join(",")}&size=150x150&format=Png&isCircular=false`,
        {
          headers: { "Accept": "application/json" },
          next: { revalidate: 3600 }, // Cache for 1 hour
        }
      );

      if (response.ok) {
        const data: ThumbnailResponse = await response.json();
        
        for (const item of data.data || []) {
          if (item.state === "Completed" && item.imageUrl) {
            thumbnails[String(item.targetId)] = item.imageUrl;
          }
        }
      } else {
        // Log error but don't fail - return empty thumbnails
        console.error(`[thumbnails] Roblox API error: ${response.status}`);
      }
    } catch (error) {
      // Log error but don't fail - return empty thumbnails
      console.error("[thumbnails] Roblox API fetch error:", error);
    }

    return NextResponse.json({
      success: true,
      thumbnails,
      requested: idsToFetch.length,
      returned: Object.keys(thumbnails).length,
    });
  } catch (error) {
    console.error("[API] /api/roblox/thumbnails error:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}
