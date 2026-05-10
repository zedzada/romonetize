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
 * POST /api/roblox/game-icons
 * 
 * Batch fetch game icons from Roblox thumbnails API.
 * 
 * Body:
 * {
 *   universeIds: string[]  // Array of Universe IDs (NOT place IDs)
 * }
 * 
 * Returns:
 * {
 *   success: true,
 *   icons: { [universeId: string]: string }  // URL mapping
 * }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { universeIds } = body;

    if (!universeIds || !Array.isArray(universeIds) || universeIds.length === 0) {
      return NextResponse.json(
        { success: false, error: "universeIds array is required" },
        { status: 400 }
      );
    }

    // Filter out invalid IDs and dedupe
    const validIds = [...new Set(
      universeIds
        .map(id => String(id).trim())
        .filter(id => id && /^\d+$/.test(id))
    )];

    if (validIds.length === 0) {
      return NextResponse.json(
        { success: false, error: "No valid universe IDs provided" },
        { status: 400 }
      );
    }

    const icons: Record<string, string> = {};
    const errors: string[] = [];

    // Batch in groups of 100 (Roblox API limit)
    const batchSize = 100;
    for (let i = 0; i < validIds.length; i += batchSize) {
      const batch = validIds.slice(i, i + batchSize);
      const idsParam = batch.join(",");

      try {
        const response = await fetch(
          `https://thumbnails.roblox.com/v1/games/icons?universeIds=${idsParam}&size=150x150&format=Png&isCircular=false`,
          {
            headers: { "Accept": "application/json" },
            next: { revalidate: 3600 }, // Cache for 1 hour
          }
        );

        if (response.ok) {
          const data: ThumbnailResponse = await response.json();
          
          for (const item of data.data || []) {
            if (item.state === "Completed" && item.imageUrl) {
              icons[String(item.targetId)] = item.imageUrl;
            }
          }
        } else {
          errors.push(`Batch ${i / batchSize + 1}: HTTP ${response.status}`);
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        errors.push(`Batch ${i / batchSize + 1}: ${errorMessage}`);
      }
    }

    // Log in development
    if (process.env.NODE_ENV === "development") {
      console.log("[Roblox API] Game icons batch fetch:", {
        universeIdsRequested: validIds.length,
        iconsReturned: Object.keys(icons).length,
        errors: errors.length > 0 ? errors : undefined,
      });
    }

    return NextResponse.json({
      success: true,
      icons,
      requested: validIds.length,
      returned: Object.keys(icons).length,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    console.error("[API] /api/roblox/game-icons error:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}
