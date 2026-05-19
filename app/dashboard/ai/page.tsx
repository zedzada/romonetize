import { Suspense } from "react";
import { Sparkles } from "lucide-react";
import AIPageClient from "./AIPageClient";

export default function AIPage() {
  return (
    <Suspense
      fallback={
        <div className="p-6">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary to-blue-400 flex items-center justify-center">
              <Sparkles className="w-4 h-4 text-primary-foreground" />
            </div>
            <h1 className="text-2xl font-bold text-foreground">AI Assistant</h1>
          </div>
          <p className="text-sm text-muted-foreground">Loading AI Assistant...</p>
        </div>
      }
    >
      <AIPageClient />
    </Suspense>
  );
}
