"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ArrowRight, TrendingUp, Zap, Shield } from "lucide-react";

interface HeroProps {
  onOpenAuthModal: () => void;
}

export function Hero({ onOpenAuthModal }: HeroProps) {
  const handleGetStarted = () => {
    onOpenAuthModal();
  };

  return (
    <section className="relative min-h-screen flex items-center justify-center overflow-hidden pt-16">
      {/* Premium dark gradient background */}
      <div className="absolute inset-0 bg-gradient-to-b from-background via-background to-primary/5" />
      
      {/* Subtle glow effect */}
      <div className="absolute top-1/3 left-1/2 -translate-x-1/2 w-[600px] h-[400px] bg-primary/8 rounded-full blur-[120px]" />
      
      {/* Grid pattern */}
      <div 
        className="absolute inset-0 opacity-[0.02]"
        style={{
          backgroundImage: `linear-gradient(rgba(255,255,255,.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.1) 1px, transparent 1px)`,
          backgroundSize: '80px 80px'
        }}
      />

      <div className="relative z-10 max-w-5xl mx-auto px-6 text-center">
        {/* Trust badge */}
        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 border border-primary/20 mb-10">
          <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
          <span className="text-sm font-medium text-primary">Built for Roblox monetization teams</span>
        </div>

        {/* Main headline - business value focused */}
        <h1 className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-bold tracking-tight text-balance mb-8">
          <span className="text-foreground">Increase Roblox revenue with</span>
          <br />
          <span className="bg-gradient-to-r from-primary via-blue-400 to-primary bg-clip-text text-transparent">
            live monetization analytics
          </span>
        </h1>

        {/* Value proposition */}
        <p className="text-xl text-foreground/80 max-w-2xl mx-auto mb-4 text-pretty font-medium">
          Track every gamepass click, purchase, and conversion in real-time.
        </p>
        <p className="text-lg text-muted-foreground max-w-2xl mx-auto mb-12 text-pretty">
          See exactly where players drop off and fix revenue leaks before they cost you thousands.
        </p>

        {/* CTA buttons */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-16">
          <Button 
            size="lg" 
            onClick={handleGetStarted}
            className="h-14 px-10 text-base font-semibold bg-primary hover:bg-primary/90 text-primary-foreground cursor-pointer transition-all duration-200 hover:scale-[1.02] shadow-lg shadow-primary/20 hover:shadow-xl hover:shadow-primary/30"
          >
            Start Free
            <ArrowRight className="w-5 h-5 ml-2" />
          </Button>
          <Button 
            variant="outline" 
            size="lg" 
            asChild
            className="h-14 px-10 text-base font-semibold border-border/50 hover:bg-card hover:border-primary/30 cursor-pointer transition-all duration-200"
          >
            <Link href="#dashboard">See It In Action</Link>
          </Button>
        </div>

        {/* Feature labels */}
        <div className="flex flex-wrap justify-center gap-4">
          <div className="flex items-center gap-3 px-5 py-3 rounded-xl bg-card border border-border/50 shadow-sm">
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
              <TrendingUp className="w-5 h-5 text-primary" />
            </div>
            <div className="text-left">
              <div className="text-sm font-semibold text-foreground">Live Tracking</div>
              <div className="text-xs text-muted-foreground">Monitor events in real-time</div>
            </div>
          </div>
          <div className="flex items-center gap-3 px-5 py-3 rounded-xl bg-card border border-border/50 shadow-sm">
            <div className="w-10 h-10 rounded-lg bg-amber-500/10 flex items-center justify-center">
              <Zap className="w-5 h-5 text-amber-500" />
            </div>
            <div className="text-left">
              <div className="text-sm font-semibold text-foreground">Real-Time Events</div>
              <div className="text-xs text-muted-foreground">Instant data streaming</div>
            </div>
          </div>
          <div className="flex items-center gap-3 px-5 py-3 rounded-xl bg-card border border-border/50 shadow-sm">
            <div className="w-10 h-10 rounded-lg bg-emerald-500/10 flex items-center justify-center">
              <Shield className="w-5 h-5 text-emerald-500" />
            </div>
            <div className="text-left">
              <div className="text-sm font-semibold text-foreground">Revenue Insights</div>
              <div className="text-xs text-muted-foreground">AI-powered analysis</div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
