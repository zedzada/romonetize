"use client";

import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

/**
 * Theme-aware chart colors for Recharts.
 * Returns appropriate colors for light/dark mode.
 */
export interface ChartTheme {
  // Axis and grid
  axis: string;
  grid: string;
  gridOpacity: number;
  
  // Labels
  label: string;
  mutedLabel: string;
  
  // Tooltip
  tooltipBg: string;
  tooltipText: string;
  tooltipBorder: string;
  
  // Dark mode flag
  isDark: boolean;
}

export function useChartTheme(): ChartTheme {
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  
  useEffect(() => {
    setMounted(true);
  }, []);
  
  // Default to dark mode colors during SSR/hydration to prevent flash
  const isDark = !mounted || resolvedTheme === "dark";
  
  if (isDark) {
    return {
      axis: "#9CA3AF",         // Gray-400 - visible on dark
      grid: "#374151",         // Gray-700
      gridOpacity: 0.6,
      label: "#F9FAFB",        // Gray-50 - bright labels
      mutedLabel: "#9CA3AF",   // Gray-400
      tooltipBg: "#171717",    // Near black
      tooltipText: "#F9FAFB",  // Gray-50
      tooltipBorder: "#404040", // Zinc-700
      isDark: true,
    };
  }
  
  return {
    axis: "#374151",           // Gray-700 - dark on light
    grid: "#D1D5DB",           // Gray-300
    gridOpacity: 0.8,
    label: "#111827",          // Gray-900 - near black
    mutedLabel: "#4B5563",     // Gray-600
    tooltipBg: "#FFFFFF",      // White
    tooltipText: "#111827",    // Gray-900
    tooltipBorder: "#D1D5DB",  // Gray-300
    isDark: false,
  };
}

/**
 * Recharts-compatible axis style props
 */
export function getChartAxisProps(theme: ChartTheme) {
  return {
    axisLine: false,
    tickLine: false,
    tickMargin: 10,
    tick: { fill: theme.axis, fontSize: 11 },
  };
}

/**
 * Recharts-compatible grid style props
 */
export function getChartGridProps(theme: ChartTheme) {
  return {
    strokeDasharray: "3 3",
    stroke: theme.grid,
    strokeOpacity: theme.gridOpacity,
    vertical: false,
  };
}

/**
 * Recharts-compatible tooltip content style
 */
export function getChartTooltipStyle(theme: ChartTheme) {
  return {
    contentStyle: {
      backgroundColor: theme.tooltipBg,
      border: `1px solid ${theme.tooltipBorder}`,
      borderRadius: "8px",
      boxShadow: theme.isDark 
        ? "0 8px 24px rgba(0, 0, 0, 0.4)" 
        : "0 4px 12px rgba(0, 0, 0, 0.1)",
      padding: "12px",
    },
    labelStyle: { 
      color: theme.tooltipText, 
      fontWeight: 600, 
      marginBottom: "4px" 
    },
    itemStyle: { 
      color: theme.isDark ? "#E5E5E5" : "#374151" 
    },
  };
}
