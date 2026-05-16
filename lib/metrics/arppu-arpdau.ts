/**
 * Shared ARPPU/ARPDAU calculation helpers
 * 
 * ARPPU = Average Revenue Per Paying User
 * - Period total: totalRevenue / distinctPayingUsersInPeriod
 * - Daily: revenueForDay / distinctPayingUsersForDay (can be null if no payers)
 * 
 * ARPDAU = Average Revenue Per Daily Active User
 * - Period total: totalRevenue / averageDailyActiveUsersInPeriod
 * - Daily: revenueForDay / dailyActiveUsersForDay (can be null if no DAU)
 * 
 * Note: Period ARPPU and daily average ARPPU may differ because:
 * - Period ARPPU = total revenue / distinct payers across entire period
 * - Daily average ARPPU = average of (daily revenue / daily payers)
 * 
 * The card shows PERIOD totals. Charts show DAILY values.
 */

export interface DailyMetric {
  date: string;
  value: number | null;
}

export interface PeriodMetrics {
  // Period totals
  periodArppu: number;
  periodArpdau: number;
  
  // Intermediate values for debugging/display
  totalRevenue: number;
  distinctPayingUsers: number;
  averageDau: number;
  daysWithData: number;
}

export interface DailyArppuArpdau {
  date: string;
  arppu: number | null;  // null if no paying users that day
  arpdau: number | null; // null if no active users that day
  revenue: number;
  payingUsers: number;
  activeUsers: number;
}

export interface EventWithMetrics {
  player_id: string | null;
  created_at: string;
  event_type: string;
  robux?: number | null;
}

/**
 * Calculate period-total ARPPU and ARPDAU from events
 * This is what cards should display
 */
export function calculatePeriodMetrics(
  allEvents: EventWithMetrics[],
  purchaseEvents: EventWithMetrics[]
): PeriodMetrics {
  // Total revenue from purchases
  const totalRevenue = purchaseEvents.reduce((sum, e) => sum + (e.robux || 0), 0);
  
  // Distinct paying users in period
  const payingPlayerIds = new Set(
    purchaseEvents.filter(e => e.player_id).map(e => e.player_id)
  );
  const distinctPayingUsers = payingPlayerIds.size;
  
  // ARPPU = Revenue / Distinct Paying Users
  const periodArppu = distinctPayingUsers > 0 ? totalRevenue / distinctPayingUsers : 0;
  
  // Calculate Average DAU
  // Group all events by day and count distinct players per day
  const dailyActivePlayers = new Map<string, Set<string>>();
  allEvents.forEach((e) => {
    if (!e.player_id || !e.created_at) return;
    const day = e.created_at.slice(0, 10); // YYYY-MM-DD
    if (!dailyActivePlayers.has(day)) {
      dailyActivePlayers.set(day, new Set());
    }
    dailyActivePlayers.get(day)!.add(e.player_id);
  });
  
  // Calculate average daily active users
  const daysWithData = dailyActivePlayers.size;
  let averageDau = 0;
  if (daysWithData > 0) {
    const totalDailyPlayers = Array.from(dailyActivePlayers.values())
      .reduce((sum, players) => sum + players.size, 0);
    averageDau = totalDailyPlayers / daysWithData;
  }
  
  // ARPDAU = Revenue / Average DAU
  const periodArpdau = averageDau > 0 ? totalRevenue / averageDau : 0;
  
  return {
    periodArppu,
    periodArpdau,
    totalRevenue,
    distinctPayingUsers,
    averageDau,
    daysWithData,
  };
}

/**
 * Calculate daily ARPPU and ARPDAU values for charts
 * Returns null for days with no paying users (ARPPU) or no active users (ARPDAU)
 */
export function calculateDailyMetrics(
  allEvents: EventWithMetrics[],
  purchaseEvents: EventWithMetrics[],
  days: number = 28
): DailyArppuArpdau[] {
  const now = new Date();
  const results: DailyArppuArpdau[] = [];
  
  for (let i = days - 1; i >= 0; i--) {
    const dayStart = new Date(now);
    dayStart.setDate(dayStart.getDate() - i);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);
    const dateStr = dayStart.toISOString().slice(0, 10);
    
    // Filter events for this day
    const dayAllEvents = allEvents.filter((e) => {
      if (!e.created_at) return false;
      const eventTime = new Date(e.created_at);
      return eventTime >= dayStart && eventTime < dayEnd;
    });
    
    const dayPurchases = purchaseEvents.filter((e) => {
      if (!e.created_at) return false;
      const eventTime = new Date(e.created_at);
      return eventTime >= dayStart && eventTime < dayEnd;
    });
    
    // Daily metrics
    const dayPayingUsers = new Set(
      dayPurchases.filter(e => e.player_id).map(e => e.player_id)
    ).size;
    const dayActiveUsers = new Set(
      dayAllEvents.filter(e => e.player_id).map(e => e.player_id)
    ).size;
    const dayRevenue = dayPurchases.reduce((sum, e) => sum + (e.robux || 0), 0);
    
    // Daily ARPPU = null if no paying users, otherwise revenue / paying users
    const arppu = dayPayingUsers > 0 ? dayRevenue / dayPayingUsers : null;
    
    // Daily ARPDAU = null if no active users, otherwise revenue / active users
    const arpdau = dayActiveUsers > 0 ? dayRevenue / dayActiveUsers : null;
    
    results.push({
      date: dateStr,
      arppu,
      arpdau,
      revenue: dayRevenue,
      payingUsers: dayPayingUsers,
      activeUsers: dayActiveUsers,
    });
  }
  
  return results;
}

/**
 * Calculate the average of non-null daily values
 * Use this to show "average daily ARPPU" in chart badges
 */
export function calculateDailyAverage(dailyMetrics: DailyArppuArpdau[], metric: 'arppu' | 'arpdau'): number | null {
  const nonNullValues = dailyMetrics
    .map(d => d[metric])
    .filter((v): v is number => v !== null);
  
  if (nonNullValues.length === 0) return null;
  
  return nonNullValues.reduce((sum, v) => sum + v, 0) / nonNullValues.length;
}

/**
 * Apply revenue mode multiplier (gross = 1, estimated = 0.7)
 */
export function applyRevenueMode(value: number, mode: 'gross' | 'estimated'): number {
  return mode === 'gross' ? value : Math.round(value * 0.7);
}

/**
 * Format ARPPU/ARPDAU for display
 */
export function formatArppuArpdau(value: number | null): string {
  if (value === null) return '—';
  return `R$${value.toFixed(2)}`;
}
