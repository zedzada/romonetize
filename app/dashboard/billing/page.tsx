"use client";

import { useState, useEffect, Suspense } from "react";
import {
  CreditCard,
  Check,
  Zap,
  Building2,
  Crown,
  Gamepad2,
  CalendarDays,
  ExternalLink,
  Loader2,
  AlertCircle,
  Sparkles,
  Plus,
  RefreshCw,
  TrendingUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PRICING_PLANS, formatPrice, type PricingPlan, CREDIT_PACKAGES } from "@/lib/products";
import { createCheckoutSession, createPortalSession, getSubscriptionStatus } from "@/lib/actions/stripe";
import { useSearchParams } from "next/navigation";
import { useCredits, useCreditPackages } from "@/hooks/use-credits";

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
  const [syncing, setSyncing] = useState(false);
  const [billingPeriod, setBillingPeriod] = useState<"monthly" | "yearly">("monthly");
  const [processingPlan, setProcessingPlan] = useState<string | null>(null);
  const [showCreditsModal, setShowCreditsModal] = useState(false);
  const [purchasingPackage, setPurchasingPackage] = useState<string | null>(null);
  const [lastSyncMessage, setLastSyncMessage] = useState<string | null>(null);
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
  
  // AI Credits
  const { monthlyCredits, extraCredits, totalCredits, refresh: refreshCredits, isLoading: creditsLoading } = useCredits();
  const { purchaseCredits } = useCreditPackages();
  
  const searchParams = useSearchParams();
  const success = searchParams.get("success") === "true";
  const canceled = searchParams.get("canceled") === "true";
  const sessionId = searchParams.get("session_id");
  const creditsSuccess = searchParams.get("credits_success") === "true";
  const creditsPurchased = searchParams.get("credits");
  const creditsCanceled = searchParams.get("credits_canceled") === "true";
  const debugMode = searchParams.get("debug") === "true";
  
  // Debug state
  const [debugInfo, setDebugInfo] = useState<Record<string, unknown> | null>(null);
  const [creditSyncState, setCreditSyncState] = useState<{
    syncing: boolean;
    synced: boolean;
    error: string | null;
    creditsGranted: number | null;
  }>({ syncing: false, synced: false, error: null, creditsGranted: null });
  
  // Subscription sync state - tracks whether plan was actually updated
  const [subscriptionSyncState, setSubscriptionSyncState] = useState<{
    syncing: boolean;
    synced: boolean;
    error: string | null;
    syncedPlan: string | null;
  }>({ syncing: false, synced: false, error: null, syncedPlan: null });

  // Refresh credits on successful purchase
  useEffect(() => {
    if (creditsSuccess) {
      refreshCredits();
    }
  }, [creditsSuccess, refreshCredits]);

  // Auto-sync on success/session_id return from Stripe (for subscriptions)
  useEffect(() => {
    if (success || sessionId) {
      syncBillingFromStripe();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [success, sessionId]);

  // Auto-sync AI credits purchase when returning from checkout
  useEffect(() => {
    if (creditsSuccess && sessionId) {
      syncAiCredits(sessionId);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [creditsSuccess, sessionId]);

  const syncAiCredits = async (checkoutSessionId: string) => {
    setCreditSyncState({ syncing: true, synced: false, error: null, creditsGranted: null });
    try {
      const res = await fetch(`/api/billing/sync?session_id=${checkoutSessionId}`, { method: "POST" });
      const data = await res.json();
      
      if (debugMode) {
        setDebugInfo(prev => ({ ...prev, creditSync: data }));
      }

      if (data.type === "ai_credits" && data.synced) {
        // Credits synced successfully - refresh and dispatch event
        await refreshCredits();
        window.dispatchEvent(new CustomEvent("credits-updated"));
        
        const granted = data.creditSync?.granted || data.credits;
        setCreditSyncState({ 
          syncing: false, 
          synced: true, 
          error: null, 
          creditsGranted: granted 
        });
      } else if (data.creditSync?.alreadyProcessed) {
        // Already processed - just refresh
        await refreshCredits();
        window.dispatchEvent(new CustomEvent("credits-updated"));
        setCreditSyncState({ 
          syncing: false, 
          synced: true, 
          error: null, 
          creditsGranted: null 
        });
      } else if (data.error) {
        setCreditSyncState({ 
          syncing: false, 
          synced: false, 
          error: data.error, 
          creditsGranted: null 
        });
      }
    } catch (err) {
      setCreditSyncState({ 
        syncing: false, 
        synced: false, 
        error: "Failed to sync credits", 
        creditsGranted: null 
      });
    }
  };

  const syncBillingFromStripe = async () => {
    setSyncing(true);
    setSubscriptionSyncState({ syncing: true, synced: false, error: null, syncedPlan: null });
    setLastSyncMessage("Syncing your plan...");
    try {
      // Build sync URL with session_id if available
      const params = new URLSearchParams();
      if (sessionId) params.set("session_id", sessionId);
      if (debugMode) params.set("debug", "true");
      const syncUrl = `/api/billing/sync${params.toString() ? `?${params.toString()}` : ""}`;
      
      const res = await fetch(syncUrl, { method: "POST" });
      const data = await res.json();
      
      // Always set debug info (for any mode when there's useful data)
      setDebugInfo(data);
      
      // Check for success using the new response format
      if (data.success && data.plan && data.plan !== "free") {
        // Plan was successfully synced to pro/studio
        await loadSubscription();
        await refreshCredits();
        window.dispatchEvent(new CustomEvent("credits-updated"));
        setSubscriptionSyncState({ 
          syncing: false, 
          synced: true, 
          error: null, 
          syncedPlan: data.plan 
        });
        setLastSyncMessage(`Plan synced: ${data.planName || data.plan} (${data.subscriptionStatus})${data.credits?.granted ? ` - ${data.credits.granted} credits granted` : ""}`);
      } else if (data.error) {
        // Show error with step info
        const stepInfo = data.step ? ` [step: ${data.step}]` : "";
        setSubscriptionSyncState({ 
          syncing: false, 
          synced: false, 
          error: `${data.error}${stepInfo}`, 
          syncedPlan: null 
        });
        setLastSyncMessage(`Sync error: ${data.error}${stepInfo}`);
      } else {
        // Sync completed but plan is still free or no active subscription
        await loadSubscription();
        setSubscriptionSyncState({ 
          syncing: false, 
          synced: false, 
          error: data.message || "No active subscription found", 
          syncedPlan: null 
        });
        setLastSyncMessage(data.message || "No active subscription found in Stripe");
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Failed to sync with Stripe";
      setSubscriptionSyncState({ 
        syncing: false, 
        synced: false, 
        error: errorMsg, 
        syncedPlan: null 
      });
      setLastSyncMessage(`Network error: ${errorMsg}`);
    }
    setSyncing(false);
  };

  const loadSubscription = async () => {
    const result = await getSubscriptionStatus();
    if (!("error" in result)) {
      setSubscription(result);
    }
    setLoading(false);
  };

  useEffect(() => {
    loadSubscription();
  }, []);

  const handleSync = async () => {
    setSyncing(true);
    setLastSyncMessage(null);
    await syncBillingFromStripe();
    await loadSubscription();
    await refreshCredits();
    setLastSyncMessage(`Last synced at ${new Date().toLocaleTimeString()}`);
    setSyncing(false);
  };

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
    } else if (result.error) {
      alert(result.error === "No billing account found" ? "No Stripe customer found yet." : result.error);
    }
    setProcessingPlan(null);
  };

  const handlePurchaseCredits = async (packageId: string) => {
    setPurchasingPackage(packageId);
    await purchaseCredits(packageId);
    setPurchasingPackage(null);
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

  // Get plan button text and action
  const getPlanButton = (plan: PricingPlan, currentPlan: PricingPlan) => {
    const isCurrentPlan = currentPlan.id === plan.id;
    const currentPlanIndex = PRICING_PLANS.findIndex(p => p.id === currentPlan.id);
    const targetPlanIndex = PRICING_PLANS.findIndex(p => p.id === plan.id);
    const isUpgrade = targetPlanIndex > currentPlanIndex;
    const isDowngrade = targetPlanIndex < currentPlanIndex;
    const hasPaidPlan = currentPlan.id !== "free";

    if (isCurrentPlan) {
      return { text: "Current Plan", disabled: true, action: () => {}, variant: "secondary" as const };
    }

    // For free plan target
    if (plan.id === "free") {
      if (hasPaidPlan) {
        return { text: "Manage Billing", disabled: false, action: handleManageBilling, variant: "outline" as const };
      }
      return { text: "Free", disabled: true, action: () => {}, variant: "outline" as const };
    }

    // For paid plan targets
    if (hasPaidPlan) {
      // Already on a paid plan - use Manage Billing for any change
      return { text: "Manage Billing", disabled: false, action: handleManageBilling, variant: "outline" as const };
    }

    // Free user upgrading to a paid plan
    return { 
      text: isUpgrade ? `Upgrade to ${plan.name}` : `Get ${plan.name}`, 
      disabled: false, 
      action: () => handleSubscribe(plan.id), 
      variant: plan.popular ? "default" as const : "outline" as const 
    };
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const currentPlan = subscription?.plan || PRICING_PLANS[0];

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Billing</h1>
          <p className="text-muted-foreground">Manage your subscription and usage</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleSync} disabled={syncing}>
            {syncing ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4 mr-2" />
            )}
            Sync
          </Button>
          {currentPlan.id !== "free" && (
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
      </div>

      {/* Sync message */}
      {lastSyncMessage && (
        <p className="text-xs text-muted-foreground">{lastSyncMessage}</p>
      )}

      {/* Success/Cancel alerts */}
      {(success || sessionId) && !creditsSuccess && (
        <Alert className={subscriptionSyncState.error && !subscriptionSyncState.syncing ? "bg-amber-500/10 border-amber-500/50" : "bg-green-500/10 border-green-500/50"}>
          {subscriptionSyncState.syncing ? (
            <>
              <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />
              <AlertDescription className="text-blue-500">
                Payment received. Syncing your subscription...
              </AlertDescription>
            </>
          ) : subscriptionSyncState.synced && subscriptionSyncState.syncedPlan ? (
            <>
              <Check className="w-4 h-4 text-green-500" />
              <AlertDescription className="text-green-500">
                Your subscription has been activated! You are now on the {subscriptionSyncState.syncedPlan === "pro" ? "Pro" : subscriptionSyncState.syncedPlan === "studio" ? "Studio" : subscriptionSyncState.syncedPlan} plan.
              </AlertDescription>
            </>
          ) : subscriptionSyncState.error ? (
            <>
              <AlertCircle className="w-4 h-4 text-amber-500" />
              <AlertDescription className="text-amber-500">
                Payment received, but subscription sync failed. Click Sync to retry.
                {debugMode && <span className="block text-xs mt-1">Error: {subscriptionSyncState.error}</span>}
              </AlertDescription>
            </>
          ) : (
            <>
              <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />
              <AlertDescription className="text-blue-500">
                Payment received. Verifying subscription...
              </AlertDescription>
            </>
          )}
        </Alert>
      )}
      {creditsSuccess && (
        <Alert className={creditSyncState.error ? "bg-amber-500/10 border-amber-500/50" : "bg-green-500/10 border-green-500/50"}>
          {creditSyncState.syncing ? (
            <>
              <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />
              <AlertDescription className="text-blue-500">
                Payment successful. Syncing credits...
              </AlertDescription>
            </>
          ) : creditSyncState.synced && creditSyncState.creditsGranted ? (
            <>
              <Sparkles className="w-4 h-4 text-green-500" />
              <AlertDescription className="text-green-500">
                Successfully purchased {creditSyncState.creditsGranted} AI credits! Your balance has been updated.
              </AlertDescription>
            </>
          ) : creditSyncState.synced ? (
            <>
              <Check className="w-4 h-4 text-green-500" />
              <AlertDescription className="text-green-500">
                Credits synced. Your balance is up to date.
              </AlertDescription>
            </>
          ) : creditSyncState.error ? (
            <>
              <AlertCircle className="w-4 h-4 text-amber-500" />
              <AlertDescription className="text-amber-500">
                Payment received, credits are syncing. Click Sync if they do not appear in a few seconds.
                {debugMode && <span className="block text-xs mt-1">Error: {creditSyncState.error}</span>}
              </AlertDescription>
            </>
          ) : (
            <>
              <Sparkles className="w-4 h-4 text-blue-500" />
              <AlertDescription className="text-blue-500">
                Payment received. Verifying credits...
              </AlertDescription>
            </>
          )}
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
      {creditsCanceled && (
        <Alert className="bg-amber-500/10 border-amber-500/50">
          <AlertCircle className="w-4 h-4 text-amber-500" />
          <AlertDescription className="text-amber-500">
            Credit purchase was canceled. No charges were made.
          </AlertDescription>
        </Alert>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {/* Current Plan */}
        <Card className="border-border bg-card">
          <CardHeader className="pb-2">
            <CardDescription>Current Plan</CardDescription>
            <CardTitle className="flex items-center gap-2">
              {getPlanIcon(currentPlan.id)}
              {currentPlan.name}
              {(subscription?.status === "active" || currentPlan.id === "free") && (
                <Badge variant="secondary" className="ml-2 bg-green-500/10 text-green-500 border-green-500/30">
                  Active
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

        {/* Tracked Actions - Now Unlimited */}
        <Card className="border-border bg-card">
          <CardHeader className="pb-2">
            <CardDescription>Tracked Actions This Month</CardDescription>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-blue-500" />
              Unlimited
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">
              Tracked actions are unlimited on all plans. Track as many player joins, clicks, and purchases as you need.
            </p>
          </CardContent>
        </Card>

        {/* Connected Games */}
        <Card className="border-border bg-card">
          <CardHeader className="pb-2">
            <CardDescription>Connected Games</CardDescription>
            <CardTitle className="flex items-center gap-2">
              <Gamepad2 className="w-5 h-5 text-green-500" />
              {subscription?.usage.games || 0} / {currentPlan.limits.games}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">
              {currentPlan.limits.games - (subscription?.usage.games || 0)} slot{currentPlan.limits.games - (subscription?.usage.games || 0) !== 1 ? "s" : ""} available
            </p>
          </CardContent>
        </Card>

        {/* AI Credits */}
        <Card className="border-border bg-card">
          <CardHeader className="pb-2">
            <CardDescription>AI Assistant Credits</CardDescription>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-purple-500" />
              {creditsLoading ? "..." : totalCredits} credits
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">
                Monthly: {creditsLoading ? "..." : monthlyCredits} | Extra: {creditsLoading ? "..." : extraCredits}
              </p>
              <Button
                variant="outline"
                size="sm"
                className="w-full gap-1"
                onClick={() => setShowCreditsModal(true)}
              >
                <Plus className="w-3 h-3" />
                Buy Credits
              </Button>
            </div>
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
          const button = getPlanButton(plan, currentPlan);
          
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
                <Button 
                  className="w-full" 
                  variant={button.variant}
                  onClick={button.action}
                  disabled={button.disabled || processingPlan !== null}
                >
                  {processingPlan === plan.id && (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  )}
                  {!button.disabled && processingPlan !== plan.id && plan.priceInCents > 0 && (
                    <CreditCard className="w-4 h-4 mr-2" />
                  )}
                  {button.text}
                </Button>
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
            <h4 className="font-medium">Are tracked actions limited?</h4>
            <p className="text-sm text-muted-foreground">
              No. Tracked actions are unlimited on all plans.
            </p>
          </div>
          <div>
            <h4 className="font-medium">Can I cancel anytime?</h4>
            <p className="text-sm text-muted-foreground">
              Yes. You can cancel from Manage Billing. You will keep access until the end of the billing period.
            </p>
          </div>
          <div>
            <h4 className="font-medium">What payment methods do you accept?</h4>
            <p className="text-sm text-muted-foreground">
              Stripe supports major cards and supported payment methods.
            </p>
          </div>
          <div>
            <h4 className="font-medium">How do AI credits work?</h4>
            <p className="text-sm text-muted-foreground">
              Text prompts cost 1 credit. Image analysis costs 3 credits. 
              Pro includes 100 credits/month and Studio includes 500 credits/month. 
              Extra purchased credits never expire.
            </p>
          </div>
          <div>
            <h4 className="font-medium">Can free users access the AI Assistant?</h4>
            <p className="text-sm text-muted-foreground">
              Yes. Free users can use AI Assistant with purchased credits.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Buy Credits Modal */}
      <Dialog open={showCreditsModal} onOpenChange={setShowCreditsModal}>
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
            {CREDIT_PACKAGES.map((pkg) => {
              const badge = pkg.credits === 250 
                ? { text: "Best Value • Save 10%", color: "text-green-600 bg-green-500/10" }
                : pkg.credits === 500
                  ? { text: "Save 25%", color: "text-blue-600 bg-blue-500/10" }
                  : null;
              
              return (
                <button
                  key={pkg.id}
                  onClick={() => handlePurchaseCredits(pkg.id)}
                  disabled={purchasingPackage !== null}
                  className={`w-full p-4 rounded-lg border transition-colors flex items-center justify-between disabled:opacity-50 disabled:cursor-not-allowed ${
                    pkg.credits === 250
                      ? "border-green-500/30 bg-green-500/5 hover:bg-green-500/10"
                      : "border-border bg-card hover:bg-secondary/50"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                      pkg.credits === 250 ? "bg-green-500/10" : "bg-purple-500/10"
                    }`}>
                      <Sparkles className={`w-5 h-5 ${pkg.credits === 250 ? "text-green-500" : "text-purple-500"}`} />
                    </div>
                    <div className="text-left">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold">{pkg.credits} Credits</span>
                        {badge && (
                          <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${badge.color}`}>
                            {badge.text}
                          </span>
                        )}
                      </div>
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
              );
            })}
          </div>
          <div className="text-xs text-muted-foreground text-center">
            Secure payment via Stripe. Credits are added instantly after purchase.
          </div>
        </DialogContent>
      </Dialog>

      {/* Debug Panel */}
      {debugMode && (
        <Card className="border-amber-500/50 bg-amber-500/5 mt-6">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-amber-400">Billing Debug</CardTitle>
            <CardDescription className="text-xs text-amber-400/70">
              Add ?debug=true to URL to see this panel. Sync API also returns extended debug info.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Failure Reason - prominent if present */}
            {debugInfo?.failureReason && (
              <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-md">
                <div className="text-xs font-semibold text-red-400 mb-1">Failure Reason:</div>
                <div className="text-sm text-red-300 font-mono">{String(debugInfo.failureReason)}</div>
              </div>
            )}

            {/* Current UI State */}
            <div>
              <div className="text-xs font-semibold text-amber-400 mb-1">Current UI State</div>
              <pre className="text-xs text-muted-foreground whitespace-pre-wrap overflow-x-auto bg-background/50 p-2 rounded">
{JSON.stringify({
  currentPlan: currentPlan.id,
  subscriptionStatus: subscription?.status,
  subscriptionSyncState,
  creditSyncState,
  urlParams: { success, canceled, sessionId, creditsSuccess, creditsPurchased },
}, null, 2)}
              </pre>
            </div>

            {/* Credits */}
            <div>
              <div className="text-xs font-semibold text-amber-400 mb-1">Credits</div>
              <pre className="text-xs text-muted-foreground whitespace-pre-wrap overflow-x-auto bg-background/50 p-2 rounded">
{JSON.stringify({ monthlyCredits, extraCredits, totalCredits, creditsLoading }, null, 2)}
              </pre>
            </div>

            {/* Sync API Response */}
            {debugInfo && (
              <>
                {/* DB Before */}
                {debugInfo.debug?.dbBefore && (
                  <div>
                    <div className="text-xs font-semibold text-amber-400 mb-1">DB Before Sync</div>
                    <pre className="text-xs text-muted-foreground whitespace-pre-wrap overflow-x-auto bg-background/50 p-2 rounded">
{JSON.stringify(debugInfo.debug.dbBefore, null, 2)}
                    </pre>
                  </div>
                )}

                {/* Stripe Lookup */}
                {debugInfo.debug?.stripeLookup && (
                  <div>
                    <div className="text-xs font-semibold text-amber-400 mb-1">Stripe Lookup</div>
                    <pre className="text-xs text-muted-foreground whitespace-pre-wrap overflow-x-auto bg-background/50 p-2 rounded max-h-60 overflow-y-auto">
{JSON.stringify(debugInfo.debug.stripeLookup, null, 2)}
                    </pre>
                  </div>
                )}

                {/* Price Mapping */}
                {debugInfo.debug?.priceMapping && (
                  <div>
                    <div className="text-xs font-semibold text-amber-400 mb-1">Price Mapping</div>
                    <pre className="text-xs text-muted-foreground whitespace-pre-wrap overflow-x-auto bg-background/50 p-2 rounded">
{JSON.stringify(debugInfo.debug.priceMapping, null, 2)}
                    </pre>
                  </div>
                )}

                {/* DB After */}
                {debugInfo.debug?.dbAfter && (
                  <div>
                    <div className="text-xs font-semibold text-amber-400 mb-1">DB After Sync</div>
                    <pre className="text-xs text-muted-foreground whitespace-pre-wrap overflow-x-auto bg-background/50 p-2 rounded">
{JSON.stringify(debugInfo.debug.dbAfter, null, 2)}
                    </pre>
                  </div>
                )}

                {/* Full Sync Response (collapsed) */}
                <div>
                  <div className="text-xs font-semibold text-amber-400 mb-1">Full Sync API Response</div>
                  <pre className="text-xs text-muted-foreground whitespace-pre-wrap overflow-x-auto bg-background/50 p-2 rounded max-h-40 overflow-y-auto">
{JSON.stringify(debugInfo, null, 2)}
                  </pre>
                </div>
              </>
            )}

            {/* Last Sync Message */}
            {lastSyncMessage && (
              <div className="text-xs text-muted-foreground">
                <span className="font-semibold">Last sync:</span> {lastSyncMessage}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
