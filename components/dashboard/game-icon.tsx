"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
import { Gamepad2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface GameIconProps {
  name: string;
  thumbnailUrl?: string | null;
  robloxGameId?: string | null; // Universe ID - used to fetch thumbnail if thumbnailUrl is missing
  size?: "sm" | "md" | "lg";
  className?: string;
}

const sizeClasses = {
  sm: "w-8 h-8 text-xs",
  md: "w-10 h-10 text-sm",
  lg: "w-12 h-12 text-base",
};

const iconSizes = {
  sm: 14,
  md: 18,
  lg: 22,
};

// In-memory cache for fetched thumbnails to avoid redundant API calls
const thumbnailCache = new Map<string, string | null>();

/**
 * GameIcon displays a game's icon with a fallback chain:
 * 1. Provided thumbnailUrl (from database icon_url)
 * 2. Fetched from Roblox API using robloxGameId (Universe ID)
 * 3. First letter of game name in a styled container
 * 4. Gamepad2 icon as final fallback (if no name provided)
 */
export function GameIcon({ name, thumbnailUrl, robloxGameId, size = "md", className }: GameIconProps) {
  const [imageError, setImageError] = useState(false);
  const [dynamicThumbnail, setDynamicThumbnail] = useState<string | null>(null);
  const [fetchAttempted, setFetchAttempted] = useState(false);
  
  const sizeClass = sizeClasses[size];
  const iconSize = iconSizes[size];
  
  // Get first letter for fallback, uppercase
  const firstLetter = name?.trim()?.[0]?.toUpperCase() || "";
  
  // Effective thumbnail: provided > fetched
  const effectiveThumbnail = thumbnailUrl || dynamicThumbnail;
  
  // Fetch thumbnail from Roblox API if not provided and robloxGameId is available
  useEffect(() => {
    // Skip if we already have a thumbnail or already attempted fetch
    if (thumbnailUrl || fetchAttempted || !robloxGameId) return;
    
    // Check cache first
    const cached = thumbnailCache.get(robloxGameId);
    if (cached !== undefined) {
      setDynamicThumbnail(cached);
      setFetchAttempted(true);
      return;
    }
    
    // Fetch from Roblox API
    const fetchThumbnail = async () => {
      try {
        const response = await fetch(
          `https://thumbnails.roblox.com/v1/games/icons?universeIds=${robloxGameId}&size=150x150&format=Png&isCircular=false`
        );
        
        if (response.ok) {
          const data = await response.json();
          const thumbnail = data.data?.[0];
          if (thumbnail?.state === "Completed" && thumbnail?.imageUrl) {
            thumbnailCache.set(robloxGameId, thumbnail.imageUrl);
            setDynamicThumbnail(thumbnail.imageUrl);
          } else {
            thumbnailCache.set(robloxGameId, null);
          }
        }
      } catch {
        // Silent fail - use fallback
        thumbnailCache.set(robloxGameId, null);
      }
      setFetchAttempted(true);
    };
    
    fetchThumbnail();
  }, [thumbnailUrl, robloxGameId, fetchAttempted]);
  
  // If we have a valid thumbnail URL and no error, show the image
  if (effectiveThumbnail && !imageError) {
    return (
      <div className={cn("relative rounded-lg overflow-hidden bg-secondary/50 shrink-0", sizeClass, className)}>
        <Image
          src={effectiveThumbnail}
          alt={`${name} icon`}
          fill
          className="object-cover"
          onError={() => setImageError(true)}
          unoptimized // Roblox CDN images don't need Next.js optimization
        />
      </div>
    );
  }
  
  // Fallback: first letter of game name or Gamepad2 icon
  return (
    <div
      className={cn(
        "rounded-lg bg-primary/10 flex items-center justify-center shrink-0",
        sizeClass,
        className
      )}
    >
      {firstLetter ? (
        <span className="font-bold text-primary">{firstLetter}</span>
      ) : (
        <Gamepad2 className="text-primary" style={{ width: iconSize, height: iconSize }} />
      )}
    </div>
  );
}
