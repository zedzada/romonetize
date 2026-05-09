"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAnalytics } from "@/hooks/use-analytics";

export default function PerformancePage() {
  const {
    isLoading,
    error,
    dataHealth,
    robloxStats,
  } = useAnalytics({ enabled: true });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Game Performance</h1>
        <p className="text-muted-foreground">Minimal safe shell - proving route loads</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>useAnalytics Debug Output</CardTitle>
        </CardHeader>
        <CardContent>
          <pre className="p-4 bg-muted rounded-lg text-xs font-mono overflow-auto">
            {JSON.stringify(
              {
                isLoading,
                hasError: !!error,
                errorMessage: error?.message ?? null,
                hasDataHealth: !!dataHealth,
                dataHealthMissing: dataHealth?.missing ?? null,
                hasRobloxStats: !!robloxStats,
                robloxStatsCcu: robloxStats?.ccu ?? null,
                robloxStatsVisits: robloxStats?.visits ?? null,
              },
              null,
              2
            )}
          </pre>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Route Status</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-green-600 font-semibold">
            /dashboard/performance loaded successfully
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
