/**
 * Shared range/bucket configuration used by CCU History, Monetization charts,
 * and any other time-series display. One helper, one source of truth.
 */

export type RangeKey = "1h" | "6h" | "24h" | "72h" | "7d" | "28d" | "90d";

export type BucketSize = "1m" | "5m" | "15m" | "1h" | "1d";

export interface RangeWindow {
  /** UTC ISO string for range start */
  rangeStartUtc: string;
  /** UTC ISO string for range end (now) */
  rangeEndUtc: string;
  /** Range duration in milliseconds */
  rangeMs: number;
  /** Bucket duration in milliseconds */
  bucketMs: number;
  /** Human-readable bucket size */
  bucketSize: BucketSize;
  /** Bucket type for grouping logic */
  bucketType: "minute" | "hour" | "day";
  /** Label format for chart axis */
  bucketLabelFormat: "HH:mm" | "HH:00" | "MMM dd";
}

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * Returns range start/end, bucket size, and label format for a given range key.
 * All timestamps are UTC ISO strings.
 *
 * Rules:
 *   1H  = 1 minute buckets
 *   6H  = 5 minute buckets
 *   24H = 1 hour buckets
 *   72H = 1 hour buckets
 *   7D  = 1 day buckets
 *   28D = 1 day buckets
 *   90D = 1 day buckets
 */
export function getRangeWindow(selectedRange: RangeKey, now?: Date): RangeWindow {
  const end = now ?? new Date();

  const config: Record<RangeKey, { rangeMs: number; bucketMs: number; bucketSize: BucketSize; bucketType: "minute" | "hour" | "day"; bucketLabelFormat: "HH:mm" | "HH:00" | "MMM dd" }> = {
    "1h":  { rangeMs: 1 * HOUR,  bucketMs: 1 * MINUTE, bucketSize: "1m",  bucketType: "minute", bucketLabelFormat: "HH:mm" },
    "6h":  { rangeMs: 6 * HOUR,  bucketMs: 5 * MINUTE, bucketSize: "5m",  bucketType: "minute", bucketLabelFormat: "HH:mm" },
    "24h": { rangeMs: 24 * HOUR, bucketMs: 1 * HOUR,   bucketSize: "1h",  bucketType: "hour",   bucketLabelFormat: "HH:00" },
    "72h": { rangeMs: 72 * HOUR, bucketMs: 1 * HOUR,   bucketSize: "1h",  bucketType: "hour",   bucketLabelFormat: "HH:00" },
    "7d":  { rangeMs: 7 * DAY,   bucketMs: 1 * DAY,    bucketSize: "1d",  bucketType: "day",    bucketLabelFormat: "MMM dd" },
    "28d": { rangeMs: 28 * DAY,  bucketMs: 1 * DAY,    bucketSize: "1d",  bucketType: "day",    bucketLabelFormat: "MMM dd" },
    "90d": { rangeMs: 90 * DAY,  bucketMs: 1 * DAY,    bucketSize: "1d",  bucketType: "day",    bucketLabelFormat: "MMM dd" },
  };

  const c = config[selectedRange] ?? config["24h"];
  const rangeStartUtc = new Date(end.getTime() - c.rangeMs).toISOString();
  const rangeEndUtc = end.toISOString();

  return {
    rangeStartUtc,
    rangeEndUtc,
    rangeMs: c.rangeMs,
    bucketMs: c.bucketMs,
    bucketSize: c.bucketSize,
    bucketType: c.bucketType,
    bucketLabelFormat: c.bucketLabelFormat,
  };
}

/**
 * Generate an ISO-keyed bucket start for a given timestamp + bucket config.
 * Returns the bucket start as an ISO string truncated to the correct precision.
 */
export function getBucketKey(timestamp: string | Date, bucketType: "minute" | "hour" | "day", bucketMs?: number): string {
  const d = typeof timestamp === "string" ? new Date(timestamp) : new Date(timestamp.getTime());
  
  if (bucketType === "day") {
    return d.toISOString().slice(0, 10) + "T00:00:00.000Z";
  }
  if (bucketType === "hour") {
    return d.toISOString().slice(0, 13) + ":00:00.000Z";
  }
  // minute: floor to nearest bucketMs (default 1 minute)
  const ms = bucketMs ?? 60000;
  const floored = new Date(Math.floor(d.getTime() / ms) * ms);
  return floored.toISOString();
}

/**
 * Generate all empty bucket keys between rangeStart and rangeEnd.
 * Useful for pre-filling charts so there are no gaps.
 */
export function generateBucketKeys(rangeStartUtc: string, rangeEndUtc: string, bucketMs: number, bucketType: "minute" | "hour" | "day"): string[] {
  const start = new Date(rangeStartUtc);
  const end = new Date(rangeEndUtc);
  const keys: string[] = [];

  // Floor start to bucket boundary
  const firstKey = getBucketKey(start, bucketType, bucketMs);
  let cursor = new Date(firstKey);

  while (cursor <= end) {
    keys.push(getBucketKey(cursor, bucketType, bucketMs));
    cursor = new Date(cursor.getTime() + bucketMs);
  }

  return keys;
}

/**
 * Normalize a snapshot/event timestamp to a consistent field.
 * Prefers captured_at, falls back to created_at.
 */
export function normalizeSnapshotTime(snapshot: { captured_at?: string | null; created_at?: string | null; time?: string }): string {
  return snapshot.captured_at || snapshot.created_at || snapshot.time || new Date(0).toISOString();
}
