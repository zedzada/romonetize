"use client";

import { useState } from "react";
import { Sparkles, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCredits } from "@/hooks/use-credits";
import { BuyCreditsModal } from "@/components/billing/BuyCreditsModal";

export function CreditsWidget() {
  const { totalCredits, monthlyCredits, extraCredits, isLoading } = useCredits();
  const [showModal, setShowModal] = useState(false);

  return (
    <>
      <div className="p-3 mx-4 mb-2 rounded-lg bg-purple-500/5 border border-purple-500/20">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-purple-500" />
            <span className="text-sm font-medium text-foreground">AI Credits</span>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-purple-500 hover:bg-purple-500/10"
            onClick={() => setShowModal(true)}
            title="Buy more credits"
          >
            <Plus className="w-3 h-3" />
          </Button>
        </div>
        <div className="flex items-baseline gap-1">
          {isLoading ? (
            <span className="text-lg font-bold text-foreground">...</span>
          ) : (
            <>
              <span className="text-lg font-bold text-foreground">{totalCredits}</span>
              <span className="text-xs text-muted-foreground">credits</span>
            </>
          )}
        </div>
        {!isLoading && (
          <div className="text-[10px] text-muted-foreground mt-0.5">
            {monthlyCredits} monthly + {extraCredits} extra
          </div>
        )}
      </div>

      <BuyCreditsModal open={showModal} onOpenChange={setShowModal} />
    </>
  );
}
