"use client";

import { useState, useEffect, Suspense } from "react";
import {
  CreditCard,
  Check,
  Zap,
  Building2,
  Crown,
  TrendingUp,
  Gamepad2,
  CalendarDays,
  ExternalLink,
  Loader2,
  AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { PRICING_PLANS, formatPrice, type PricingPlan } from "@/lib/products";
import { createCheckoutSession, createPortalSession, getSubscriptionStatus } from "@/lib/actions/stripe";
import { useSearchParams } from "next/navigation";

export default function BillingPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    }>
      <BillingContent />
    </Suspense>
  );
}

function BillingContent() {
  const [loading, setLoading] = useState(true);
  const [billingPeriod, setBillingPeriod] = useState<"monthly" | "yearly">("monthly");
  const [processingPlan, setProcessingPlan] = useState<string | null>(null);
  const [subscription, setSubscription] = useState<{
    plan: PricingPlan;
    status: string;
    currentPeriodEnd?: string;
    usage: {
      events: number;
      eventsLimit: number;
      games: number;
      gamesLimit: number;
    };
  } | null>(null);
  
  const searchParams = useSearchParams();
  const success = searchParams.get("success");
  const canceled = searchParams.get("canceled");

  useEffect(() => {
    async function loadSubscription() {
      const result = await getSubscriptionStatus();
      if (!("error" in result)) {
        setSubscription(result);
      }
      setLoading(false);
    }
    loadSubscription();
  }, []);

  const handleSubscribe = async (planId: string) => {
    setProcessingPlan(planId);
    const result = await createCheckoutSession(planId, billingPeriod);
    if (result.url) {
      window.location.href = result.url;
    }
    setProcessingPlan(null);
  };

  const handleManageBilling = async () => {
    setProcessingPlan("manage");
    const result = await createPortalSession();
    if (result.url) {
      window.location.href = result.url;
    }
    setProcessingPlan(null);
  };

  const getPlanIcon = (planId: string) => {
    switch (planId) {
      case "free":
        return <Zap className="w-5 h-5" />;
      case "pro":
        return <Crown className="w-5 h-5" />;
      case "studio":
        return <Building2 className="w-5 h-5" />;
      default:
        return <Zap className="w-5 h-5" />;
    }
  };

  const getDisplayPrice = (plan: PricingPlan) => {
    if (plan.priceInCents === 0) return "Free";
    const price = billingPeriod === "yearly" ? plan.yearlyPriceInCents / 12 : plan.priceInCents;
    return formatPrice(price);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const currentPlan = subscription?.plan || PRICING_PLANS[0];
  const eventsUsagePercent = subscription ? (subscription.usage.events / subscription.usage.eventsLimit) * 100 : 0;
  const gamesUsagePercent = subscription && subscription.usage.gamesLimit > 0 
    ? (subscription.usage.games / subscription.usage.gamesLimit) * 100 
    : 0;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Billing</h1>
          <p className="text-muted-foreground">Manage your subscription and usage</p>
        </div>
        {subscription?.status === "active" && currentPlan.id !== "free" && (
          <Button variant="outline" onClick={handleManageBilling} disabled={processingPlan === "manage"}>
            {processingPlan === "manage" ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <ExternalLink className="w-4 h-4 mr-2" />
            )}
            Manage Billing
          </Button>
        )}
      </div>

      {/* Success/Cancel alerts */}
      {success && (
        <Alert className="bg-green-500/10 border-green-500/50">
          <Check className="w-4 h-4 text-green-500" />
          <AlertDescription className="text-green-500">
            Your subscription has been activated! Thank you for subscribing.
          </AlertDescription>
        </Alert>
      )}
      {canceled && (
        <Alert className="bg-amber-500/10 border-amber-500/50">
          <AlertCircle className="w-4 h-4 text-amber-500" />
          <AlertDescription className="text-amber-500">
            Checkout was canceled. No charges were made.
          </AlertDescription>
        </Alert>
      )}

      {/* Current Plan & Usage */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="border-border bg-card">
          <CardHeader className="pb-2">
            <CardDescription>Current Plan</CardDescription>
            <CardTitle className="flex items-center gap-2">
              {getPlanIcon(currentPlan.id)}
              {currentPlan.name}
              {currentPlan.id !== "free" && (
                <Badge variant="secondary" className="ml-2">
                  {subscription?.status === "active" ? "Active" : subscription?.status || "Inactive"}
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {subscription?.currentPeriodEnd && currentPlan.id !== "free" && (
              <p className="text-sm text-muted-foreground flex items-center gap-1">
                <CalendarDays className="w-4 h-4" />
                Renews {new Date(subscription.currentPeriodEnd).toLocaleDateString()}
              </p>
            )}
          </CardContent>
        </Card>

        <Card className="border-border bg-card">
          <CardHeader className="pb-2">
            <CardDescription>Events This Month</CardDescription>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-blue-500" />
              {subscription?.usage.events.toLocaleString()} / {subscription?.usage.eventsLimit.toLocaleString()}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Progress value={Math.min(eventsUsagePercent, 100)} className="h-2" />
            <p className="text-xs text-muted-foreground mt-1">
              {eventsUsagePercent >= 80 ? (
                <span className="text-amber-500">
                  {eventsUsagePercent >= 100 ? "Limit reached" : "Approaching limit"}
                </span>
              ) : (
                `${(100 - eventsUsagePercent).toFixed(0)}% remaining`
              )}
            </p>
          </CardContent>
        </Card>

        <Card className="border-border bg-card">
          <CardHeader className="pb-2">
            <CardDescription>Connected Games</CardDescription>
            <CardTitle className="flex items-center gap-2">
              <Gamepad2 className="w-5 h-5 text-green-500" />
              {subscription?.usage.games} / {subscription?.usage.gamesLimit === -1 ? "Unlimited" : subscription?.usage.gamesLimit}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {subscription?.usage.gamesLimit !== -1 && (
              <>
                <Progress value={Math.min(gamesUsagePercent, 100)} className="h-2" />
                <p className="text-xs text-muted-foreground mt-1">
                  {gamesUsagePercent >= 100 ? (
                    <span className="text-amber-500">Limit reached</span>
                  ) : (
                    `${subscription?.usage.gamesLimit - subscription?.usage.games} slot${(subscription?.usage.gamesLimit - subscription?.usage.games) !== 1 ? "s" : ""} available`
                  )}
                </p>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Billing Period Toggle */}
      <div className="flex justify-center">
        <Tabs value={billingPeriod} onValueChange={(v) => setBillingPeriod(v as "monthly" | "yearly")}>
          <TabsList>
            <TabsTrigger value="monthly">Monthly</TabsTrigger>
            <TabsTrigger value="yearly" className="relative">
              Yearly
              <Badge className="absolute -top-2 -right-3 text-[10px] px-1 py-0 bg-green-500 text-white">
                -20%
              </Badge>
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* Pricing Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {PRICING_PLANS.map((plan) => {
          const isCurrentPlan = currentPlan.id === plan.id;
          const isDowngrade = PRICING_PLANS.findIndex(p => p.id === plan.id) < PRICING_PLANS.findIndex(p => p.id === currentPlan.id);
          
          return (
            <Card 
              key={plan.id}
              className={`relative border-border bg-card ${plan.popular ? "ring-2 ring-primary" : ""}`}
            >
              {plan.popular && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <Badge className="bg-primary text-primary-foreground">Most Popular</Badge>
                </div>
              )}
              <CardHeader>
                <div className="flex items-center gap-2 text-muted-foreground">
                  {getPlanIcon(plan.id)}
                  <span className="uppercase text-xs font-medium tracking-wide">{plan.name}</span>
                </div>
                <CardTitle className="text-3xl font-bold">
                  {getDisplayPrice(plan)}
                  {plan.priceInCents > 0 && (
                    <span className="text-sm font-normal text-muted-foreground">/month</span>
                  )}
                </CardTitle>
                <CardDescription>{plan.description}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <ul className="space-y-2">
                  {plan.features.map((feature, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm">
                      <Check className="w-4 h-4 text-green-500 shrink-0 mt-0.5" />
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
              <CardFooter>
                {isCurrentPlan ? (
                  <Button className="w-full" variant="secondary" disabled>
                    Current Plan
                  </Button>
                ) : plan.id === "free" ? (
                  <Button className="w-full" variant="outline" disabled={isDowngrade || processingPlan !== null}>
                    {isDowngrade ? "Contact Support" : "Free"}
                  </Button>
                ) : (
                  <Button 
                    className="w-full" 
                    variant={plan.popular ? "default" : "outline"}
                    onClick={() => handleSubscribe(plan.id)}
                    disabled={processingPlan !== null}
                  >
                    {processingPlan === plan.id ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <CreditCard className="w-4 h-4 mr-2" />
                    )}
                    {isDowngrade ? "Downgrade" : "Upgrade"}
                  </Button>
                )}
              </CardFooter>
            </Card>
          );
        })}
      </div>

      {/* FAQ */}
      <Card className="border-border bg-card">
        <CardHeader>
          <CardTitle>Frequently Asked Questions</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <h4 className="font-medium">What happens when I reach my event limit?</h4>
            <p className="text-sm text-muted-foreground">
              New events will be rejected until the next billing cycle or you upgrade your plan. 
              Your existing data remains intact.
            </p>
          </div>
          <div>
            <h4 className="font-medium">Can I cancel anytime?</h4>
            <p className="text-sm text-muted-foreground">
              Yes! You can cancel your subscription at any time. You&apos;ll continue to have access 
              until the end of your current billing period.
            </p>
          </div>
          <div>
            <h4 className="font-medium">What payment methods do you accept?</h4>
            <p className="text-sm text-muted-foreground">
              We accept all major credit cards through Stripe, including Visa, Mastercard, 
              American Express, and more.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
