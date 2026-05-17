"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ArrowRight, TrendingUp, Zap, Shield } from "lucide-react";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { InteractiveDotGrid } from "./interactive-dot-grid";
import { TiltCard } from "./tilt-card";

interface HeroProps {
  onOpenAuthModal: () => void;
}

export function Hero({ onOpenAuthModal }: HeroProps) {
  const router = useRouter();
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  
  useEffect(() => {
    if (!isSupabaseConfigured) return;
    
    const supabase = createClient();
    supabase.auth.getUser().then(({ data: { user } }) => {
      setIsAuthenticated(!!user);
    });
  }, []);
  
  const handleGetStarted = () => {
    if (isAuthenticated) {
      router.push("/dashboard");
    } else {
      onOpenAuthModal();
    }
  };

  return (
    <section className="relative min-h-screen flex items-center justify-center overflow-hidden pt-16">
      {/* Base dark background */}
      <div className="absolute inset-0 bg-background" />
      
      {/* Premium gradient overlay */}
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-primary/[0.02] to-primary/5" />
      
      {/* Primary dotted grid - interactive with mouse */}
      <InteractiveDotGrid />
      
      {/* Hero glow effect behind text */}
      <div className="absolute inset-0 bg-hero-glow" />
      
      {/* Secondary cyan glow */}
      <div className="absolute inset-0 bg-hero-glow-secondary" />
      
      {/* Large blurred glow orb */}
      <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[500px] bg-sky-500/[0.08] rounded-full blur-[120px] pointer-events-none" />
      
      {/* Decorative floating elements - subtle accents */}
      <div className="absolute top-[15%] left-[8%] w-16 h-16 border border-sky-500/20 rounded-lg rotate-12 blur-[1px] opacity-60" />
      <div className="absolute top-[25%] right-[10%] w-12 h-12 border border-primary/25 rounded-md -rotate-6 blur-[0.5px] opacity-50" />
      <div className="absolute bottom-[20%] left-[12%] w-10 h-10 border border-cyan-400/15 rounded-lg rotate-45 blur-[1px] opacity-40" />

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
          Track every purchase and conversion in real-time.
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

        {/* Feature labels with 3D tilt effect */}
        <div className="flex flex-wrap justify-center gap-4">
          <TiltCard tiltAmount={8} scale={1.03}>
            <div className="flex items-center gap-3 px-5 py-3 rounded-xl bg-card border border-border/50 shadow-sm hover:border-primary/30 transition-colors">
              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                <TrendingUp className="w-5 h-5 text-primary" />
              </div>
              <div className="text-left">
                <div className="text-sm font-semibold text-foreground">Live Tracking</div>
                <div className="text-xs text-muted-foreground">Monitor activity in real-time</div>
              </div>
            </div>
          </TiltCard>
          <TiltCard tiltAmount={8} scale={1.03}>
            <div className="flex items-center gap-3 px-5 py-3 rounded-xl bg-card border border-border/50 shadow-sm hover:border-amber-500/30 transition-colors">
              <div className="w-10 h-10 rounded-lg bg-amber-500/10 flex items-center justify-center">
                <Zap className="w-5 h-5 text-amber-500" />
              </div>
              <div className="text-left">
                <div className="text-sm font-semibold text-foreground">Real-Time Data</div>
                <div className="text-xs text-muted-foreground">Instant streaming</div>
              </div>
            </div>
          </TiltCard>
          <TiltCard tiltAmount={8} scale={1.03}>
            <div className="flex items-center gap-3 px-5 py-3 rounded-xl bg-card border border-border/50 shadow-sm hover:border-emerald-500/30 transition-colors">
              <div className="w-10 h-10 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                <Shield className="w-5 h-5 text-emerald-500" />
              </div>
              <div className="text-left">
                <div className="text-sm font-semibold text-foreground">Revenue Insights</div>
                <div className="text-xs text-muted-foreground">AI-powered analysis</div>
              </div>
            </div>
          </TiltCard>
        </div>
      </div>
    </section>
  );
}
