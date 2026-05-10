"use client";

import { useState } from "react";
import Image from "next/image";
import { Gamepad2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface GameIconProps {
  name: string;
  thumbnailUrl?: string | null;
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

/**
 * GameIcon displays a game's icon with a fallback chain:
 * 1. Roblox thumbnail URL if available
 * 2. First letter of game name in a styled container
 * 3. Gamepad2 icon as final fallback (if no name provided)
 */
export function GameIcon({ name, thumbnailUrl, size = "md", className }: GameIconProps) {
  const [imageError, setImageError] = useState(false);
  
  const sizeClass = sizeClasses[size];
  const iconSize = iconSizes[size];
  
  // Get first letter for fallback, uppercase
  const firstLetter = name?.trim()?.[0]?.toUpperCase() || "";
  
  // If we have a valid thumbnail URL and no error, show the image
  if (thumbnailUrl && !imageError) {
    return (
      <div className={cn("relative rounded-lg overflow-hidden bg-secondary/50 shrink-0", sizeClass, className)}>
        <Image
          src={thumbnailUrl}
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
