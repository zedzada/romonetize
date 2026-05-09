"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import Link from "next/link";
import { AlertTriangle, RefreshCw, Home } from "lucide-react";

export default function ProductsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[Products Page Error]", error);
  }, [error]);

  const isDev = process.env.NODE_ENV === "development";

  return (
    <div className="min-h-[60vh] flex items-center justify-center p-6">
      <Card className="max-w-2xl w-full border-destructive/50">
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-destructive/10">
              <AlertTriangle className="w-6 h-6 text-destructive" />
            </div>
            <div>
              <CardTitle className="text-destructive">Products page crashed</CardTitle>
              <CardDescription>Route: /dashboard/products</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="p-4 rounded-lg bg-destructive/5 border border-destructive/20">
            <p className="font-mono text-sm text-destructive break-all">
              {error.message || "Unknown error"}
            </p>
            {error.digest && (
              <p className="mt-2 text-xs text-muted-foreground">
                Error ID: {error.digest}
              </p>
            )}
          </div>

          {isDev && error.stack && (
            <details className="group" open>
              <summary className="cursor-pointer text-sm text-muted-foreground hover:text-foreground">
                Stack trace (dev only)
              </summary>
              <pre className="mt-2 p-4 rounded-lg bg-muted text-xs overflow-auto max-h-64 font-mono whitespace-pre-wrap">
                {error.stack}
              </pre>
            </details>
          )}

          <div className="flex gap-3">
            <Button onClick={reset} variant="outline" className="gap-2">
              <RefreshCw className="w-4 h-4" />
              Try again
            </Button>
            <Button asChild variant="default" className="gap-2">
              <Link href="/dashboard">
                <Home className="w-4 h-4" />
                Back to Dashboard
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
