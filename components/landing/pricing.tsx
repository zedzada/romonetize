"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Check, Star } from "lucide-react";
import { cn } from "@/lib/utils";

const plans = [
  {
    name: "Free",
    price: { monthly: "$0", yearly: "$0" },
    period: "/month",
    description: "Get started with basic analytics",
    features: [
      "1 connected game",
      "Basic live analytics",
      "24-hour data history",
      "Basic monetization overview",
      "AI Assistant (with purchased credits)",
      "0 AI credits/month"
    ],
    cta: "Start Free",
    variant: "free" as const
  },
  {
    name: "Pro",
    price: { monthly: "$19", yearly: "$15" },
    period: "/month",
    description: "For developers serious about revenue",
    features: [
      "Up to 5 connected games",
      "30-day analytics history",
      "Revenue analytics",
      "Product performance analytics",
      "Live events feed",
      "AI Assistant included",
      "100 AI credits/month"
    ],
    cta: "Get Pro",
    variant: "pro" as const,
    badge: "Most Popular"
  },
  {
    name: "Studio",
    price: { monthly: "$49", yearly: "$39" },
    period: "/month",
    description: "For studios managing multiple games",
    features: [
      "Up to 25 connected games",
      "Unlimited analytics history",
      "Advanced monetization analytics",
      "Multi-game dashboard",
      "Priority support",
      "Data export",
      "AI Assistant included",
      "500 AI credits/month"
    ],
    cta: "Get Studio",
    variant: "studio" as const
  }
];

export function Pricing() {
  const [isYearly, setIsYearly] = useState(false);

  return (
    <section id="pricing" className="py-32 relative overflow-hidden">
      {/* Background */}
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-primary/3 to-transparent" />
      
      <div className="relative z-10 max-w-5xl mx-auto px-6">
        <div className="text-center mb-16">
          <p className="text-primary font-semibold text-sm uppercase tracking-wider mb-4">
            Pricing
          </p>
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-foreground mb-6 text-balance">
            Invest in your game&apos;s revenue
          </h2>
          <p className="text-lg text-muted-foreground max-w-xl mx-auto mb-10">
            One insight can pay for months of Pro. Start free, upgrade when you see results.
          </p>

          {/* Billing toggle */}
          <div className="inline-flex items-center gap-1 p-1 rounded-full bg-card border border-border">
            <button
              onClick={() => setIsYearly(false)}
              className={cn(
                "px-6 py-2.5 rounded-full text-sm font-medium transition-all duration-300",
                !isYearly 
                  ? "bg-foreground text-background" 
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              Monthly
            </button>
            <button
              onClick={() => setIsYearly(true)}
              className={cn(
                "px-6 py-2.5 rounded-full text-sm font-medium transition-all duration-300 flex items-center gap-2",
                isYearly 
                  ? "bg-foreground text-background" 
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              Yearly
              <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-500 font-semibold">
                -20%
              </span>
            </button>
          </div>
        </div>

        <div className="grid lg:grid-cols-3 gap-6 items-stretch">
          {plans.map((plan) => (
            <div 
              key={plan.name}
              className={cn(
                "relative rounded-2xl transition-all duration-300",
                plan.variant === "pro" && "lg:-mt-4 lg:mb-4"
              )}
            >
              {/* Border effect */}
              <div className={cn(
                "absolute -inset-px rounded-2xl",
                plan.variant === "pro" 
                  ? "bg-gradient-to-b from-primary via-primary/50 to-primary/20"
                  : "bg-border"
              )} />
              
              {/* Card */}
              <div className={cn(
                "relative rounded-2xl p-8 h-full flex flex-col bg-card",
                plan.variant === "pro" && "bg-gradient-to-b from-primary/5 to-card"
              )}>
                {/* Badge */}
                {plan.badge && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <div className="px-4 py-1.5 rounded-full bg-primary text-primary-foreground text-xs font-semibold flex items-center gap-1.5 shadow-lg shadow-primary/30">
                      <Star className="w-3 h-3 fill-current" />
                      {plan.badge}
                    </div>
                  </div>
                )}

                {/* Header */}
                <div className={cn("mb-6", plan.badge && "mt-2")}>
                  <h3 className={cn(
                    "text-xl font-bold mb-1",
                    plan.variant === "pro" ? "text-primary" : "text-foreground"
                  )}>
                    {plan.name}
                  </h3>
                  <p className="text-sm text-muted-foreground">{plan.description}</p>
                </div>

                {/* Price */}
                <div className="flex items-baseline gap-1 mb-8">
                  <span className="text-5xl font-bold tracking-tight text-foreground">
                    {isYearly ? plan.price.yearly : plan.price.monthly}
                  </span>
                  <span className="text-muted-foreground">{plan.period}</span>
                </div>

                {/* Features */}
                <ul className="space-y-4 mb-8 flex-grow">
                  {plan.features.map((feature) => (
                    <li key={feature} className="flex items-start gap-3">
                      <div className={cn(
                        "flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center mt-0.5",
                        plan.variant === "pro" ? "bg-primary/20" : "bg-muted"
                      )}>
                        <Check className={cn(
                          "w-3 h-3",
                          plan.variant === "pro" ? "text-primary" : "text-muted-foreground"
                        )} />
                      </div>
                      <span className="text-sm text-foreground/80">{feature}</span>
                    </li>
                  ))}
                </ul>

                {/* CTA */}
                <Button 
                  asChild
                  className={cn(
                    "w-full h-12 font-semibold rounded-xl transition-all duration-300",
                    plan.variant === "pro" 
                      ? "bg-primary hover:bg-primary/90 text-primary-foreground shadow-lg shadow-primary/20" 
                      : "bg-secondary hover:bg-secondary/80 text-foreground border border-border"
                  )}
                >
                  <Link href="/dashboard">{plan.cta}</Link>
                </Button>
              </div>
            </div>
          ))}
        </div>

        {/* Trust line */}
        <p className="text-center text-sm text-muted-foreground mt-12">
          No credit card required to start. Cancel anytime.
        </p>
      </div>
    </section>
  );
}
