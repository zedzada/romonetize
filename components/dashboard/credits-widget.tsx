"use client";

import { useState } from "react";
import { Sparkles, Plus, CreditCard, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useCredits, useCreditPackages } from "@/hooks/use-credits";
import { CREDIT_PACKAGES } from "@/lib/products";

export function CreditsWidget() {
  const { totalCredits, monthlyCredits, extraCredits, isLoading } = useCredits();
  const { purchaseCredits } = useCreditPackages();
  const [showModal, setShowModal] = useState(false);
  const [purchasingPackage, setPurchasingPackage] = useState<string | null>(null);

  const handlePurchase = async (packageId: string) => {
    setPurchasingPackage(packageId);
    await purchaseCredits(packageId);
    setPurchasingPackage(null);
  };

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

      {/* Buy Credits Modal */}
      <Dialog open={showModal} onOpenChange={setShowModal}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-purple-500" />
              Buy Extra AI Credits
            </DialogTitle>
            <DialogDescription>
              Purchase additional credits for AI Assistant features. Extra credits never expire.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-4">
            {CREDIT_PACKAGES.map((pkg) => (
              <button
                key={pkg.id}
                onClick={() => handlePurchase(pkg.id)}
                disabled={purchasingPackage !== null}
                className="w-full p-4 rounded-lg border border-border bg-card hover:bg-secondary/50 transition-colors flex items-center justify-between disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-purple-500/10 flex items-center justify-center">
                    <Sparkles className="w-5 h-5 text-purple-500" />
                  </div>
                  <div className="text-left">
                    <div className="font-semibold">{pkg.credits} Credits</div>
                    <div className="text-sm text-muted-foreground">
                      ${(pkg.priceInCents / pkg.credits).toFixed(2)} per credit
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-bold text-lg">${(pkg.priceInCents / 100).toFixed(2)}</span>
                  {purchasingPackage === pkg.id ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <CreditCard className="w-4 h-4 text-muted-foreground" />
                  )}
                </div>
              </button>
            ))}
          </div>
          <div className="text-xs text-muted-foreground text-center">
            Secure payment via Stripe. Credits are added instantly after purchase.
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
