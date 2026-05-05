"use client";

import { cn } from "@/lib/utils";

interface RobuxIconProps {
  className?: string;
  size?: "xs" | "sm" | "md" | "lg";
}

const sizeClasses = {
  xs: "w-3 h-3",
  sm: "w-4 h-4",
  md: "w-5 h-5",
  lg: "w-6 h-6",
};

export function RobuxIcon({ className, size = "sm" }: RobuxIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={cn(sizeClasses[size], className)}
      aria-label="Robux"
    >
      {/* Official Roblox Robux icon - tilted hexagon with square hole */}
      <path 
        fillRule="evenodd" 
        clipRule="evenodd" 
        d="M12 1L22.392 6.5V17.5L12 23L1.608 17.5V6.5L12 1ZM9.5 9.5V14.5H14.5V9.5H9.5Z" 
      />
    </svg>
  );
}

// Inline Robux value display component
interface RobuxValueProps {
  value: string | number;
  className?: string;
  iconSize?: "xs" | "sm" | "md" | "lg";
  iconClassName?: string;
}

export function RobuxValue({ value, className, iconSize = "sm", iconClassName }: RobuxValueProps) {
  return (
    <span className={cn("inline-flex items-center gap-1", className)}>
      <RobuxIcon size={iconSize} className={iconClassName} />
      {value}
    </span>
  );
}
