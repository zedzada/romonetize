"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAnalytics } from "@/hooks/use-analytics";

export default function ProductsPage() {
  const {
    isLoading,
    error,
    dataHealth,
    productStats,
  } = useAnalytics({ enabled: true });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Products</h1>
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
                hasProductStats: !!productStats,
                productStatsCount: Array.isArray(productStats?.products) ? productStats.products.length : 0,
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
            /dashboard/products loaded successfully
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
