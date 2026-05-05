"use client";

import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";

interface CTAProps {
  onOpenAuthModal: () => void;
}

export function CTA({ onOpenAuthModal }: CTAProps) {
  const handleGetStarted = () => {
    onOpenAuthModal();
  };

  return (
    <section className="py-32 relative">
      <div className="max-w-4xl mx-auto px-6">
        <div className="relative p-16 rounded-3xl bg-gradient-to-br from-card via-card to-primary/5 border border-border overflow-hidden">
          {/* Background effects */}
          <div className="absolute top-0 right-0 w-80 h-80 bg-primary/10 rounded-full blur-[100px]" />
          <div className="absolute bottom-0 left-0 w-60 h-60 bg-primary/5 rounded-full blur-[80px]" />
          
          <div className="relative z-10 text-center">
            <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-foreground mb-6 text-balance">
              Start growing your Roblox revenue today
            </h2>
            <p className="text-lg text-muted-foreground max-w-xl mx-auto mb-10">
              Join developers who use RoMonetize to understand their players and increase Robux earnings.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <Button 
                size="lg" 
                onClick={handleGetStarted}
                className="h-14 px-10 text-base font-semibold bg-primary hover:bg-primary/90 text-primary-foreground cursor-pointer transition-all duration-200 shadow-lg shadow-primary/20 hover:shadow-xl hover:shadow-primary/30"
              >
                Get Started Free
                <ArrowRight className="w-5 h-5 ml-2" />
              </Button>
            </div>
            <p className="text-sm text-muted-foreground mt-6">
              Free forever plan available. No credit card required.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
