import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Consistent number formatting to avoid hydration mismatches
// Uses explicit en-US locale to ensure server/client consistency
export function formatNumber(num: number): string {
  return new Intl.NumberFormat('en-US').format(num)
}
