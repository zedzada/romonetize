"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import Image from "next/image";
import {
  Sparkles,
  Send,
  RefreshCw,
  Lightbulb,
  TrendingUp,
  DollarSign,
  Database,
  BarChart3,
  CreditCard,
  Plus,
  ImageIcon,
  X,
  Upload,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { getAIContext } from "@/lib/actions/ai";
import { generateBusinessInsights, type AIContext } from "@/lib/utils/ai-responses";
import { RobuxValue } from "@/components/ui/robux-icon";
import { useStatsRefresh } from "@/hooks/use-stats-refresh";
import { useCredits, useCreditPackages } from "@/hooks/use-credits";
import { AI_CREDIT_COSTS, CREDIT_PACKAGES } from "@/lib/products";
import { useChat } from "@ai-sdk/react";

interface LocalMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
}

const suggestedQuestions = [
  { text: "Show me my stats overview", icon: BarChart3 },
  { text: "What should I improve first?", icon: Lightbulb },
  { text: "Which product needs improvement?", icon: TrendingUp },
  { text: "How can I increase conversion?", icon: DollarSign },
  { text: "Why is my revenue low?", icon: DollarSign },
  { text: "Analyze my monetization", icon: BarChart3 },
  { text: "Give me 3 monetization ideas", icon: Lightbulb },
  { text: "How can I improve retention?", icon: TrendingUp },
];

// Analytics stats interface
interface AnalyticsStats {
  trackedActions: number;
  revenue: number;
  purchases: number;
  conversionRate: number | null;
  uniquePlayers: number;
  payingUsers: number;
  gameName: string | null;
  hasData: boolean;
}

export default function AIAssistantPage() {
  const [inputMessage, setInputMessage] = useState("");
  const [context, setContext] = useState<AIContext | null>(null);
  const [analyticsStats, setAnalyticsStats] = useState<AnalyticsStats | null>(null);
  const [loadingStats, setLoadingStats] = useState(true);
  const [loadingContext, setLoadingContext] = useState(true);
  const [insufficientCredits, setInsufficientCredits] = useState(false);
  const [showBuyCreditsModal, setShowBuyCreditsModal] = useState(false);
  const [selectedImage, setSelectedImage] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [purchasingPackage, setPurchasingPackage] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // AI Credits
  const { totalCredits, isLoading: creditsLoading, refresh: refreshCredits } = useCredits();
  const { purchaseCredits } = useCreditPackages();
  
  // Determine credit cost based on image
  const creditCost = selectedImage ? AI_CREDIT_COSTS.image : AI_CREDIT_COSTS.text;

  // Use AI SDK chat hook
  const { messages, append, isLoading, setMessages } = useChat({
    api: "/api/ai/chat",
    body: {
      hasImage: !!selectedImage,
    },
    onResponse: (response) => {
      // Refresh credits after successful response
      const remaining = response.headers.get("X-Credits-Remaining");
      if (remaining) {
        refreshCredits();
      }
    },
    onError: (error) => {
      console.error("[v0] AI chat error:", error);
      refreshCredits(); // Refresh to show refunded credits
    },
  });

  // Fetch real analytics from centralized API
  const fetchAnalytics = useCallback(async () => {
    setLoadingStats(true);
    try {
      const res = await fetch("/api/dashboard/analytics?range=30d", { cache: "no-store" });
      if (res.ok) {
        const { data } = await res.json();
        if (data && data.trackerStats) {
          setAnalyticsStats({
            trackedActions: data.trackerStats.totalEvents || 0,
            revenue: data.revenueStats?.totalRevenue || 0,
            purchases: data.revenueStats?.totalPurchases || 0,
            conversionRate: data.revenueStats?.conversionRate || null,
            uniquePlayers: data.trackerStats?.uniquePlayers || 0,
            payingUsers: data.revenueStats?.payingUsers || 0,
            gameName: data.game?.name || null,
            hasData: (data.trackerStats?.totalEvents || 0) > 0,
          });
        } else {
          setAnalyticsStats({
            trackedActions: 0,
            revenue: 0,
            purchases: 0,
            conversionRate: null,
            uniquePlayers: 0,
            payingUsers: 0,
            gameName: data?.game?.name || null,
            hasData: false,
          });
        }
      }
    } catch (error) {
      console.error("[v0] Failed to fetch analytics:", error);
    }
    setLoadingStats(false);
  }, []);

  // Load AI context
  const loadContext = useCallback(async () => {
    setLoadingContext(true);
    const { context: ctx, error } = await getAIContext();
    
    if (!error && ctx) {
      setContext(ctx);
      
      // Set initial message with business insights if data exists
      let initialContent: string;
      
      if (ctx.hasData) {
        const insights = generateBusinessInsights(ctx);
        initialContent = `**${ctx.gameName || "Your Game"} Analysis**\n\n`;
        
        if (insights.length > 0) {
          initialContent += `**Key Insights:**\n`;
          insights.slice(0, 4).forEach(insight => {
            initialContent += `\n- ${insight}`;
          });
          initialContent += `\n\nAsk me about revenue, conversion, products, or trends for more details!`;
        } else {
          initialContent += `I see **${ctx.totalEvents.toLocaleString()} tracked actions** and **${ctx.totalRevenue.toLocaleString()} Robux** revenue.\n\nI need more data to provide specific insights. Keep tracking player actions and check back soon!`;
        }
      } else {
        initialContent = "I need tracking data to provide insights.\n\n**To get started:**\n1. Go to the **My Game** page\n2. Copy the Lua tracking script\n3. Install it in your Roblox game\n4. Track player actions like joins, purchases, clicks, etc.\n\nOnce player actions flow in, I'll analyze your monetization and give you specific recommendations.";
      }
      
      const initialMessage: LocalMessage = {
        id: "1",
        role: "assistant",
        content: initialContent,
      };
      setMessages([initialMessage]);
    }
    setLoadingContext(false);
  }, [setMessages]);

  // Load AI context and analytics on mount
  useEffect(() => {
    loadContext();
    fetchAnalytics();
  }, [loadContext, fetchAnalytics]);

  // Listen for global stats refresh
  useStatsRefresh(loadContext);

  // Auto-refresh context every 30 seconds (silent refresh, doesn't reset messages)
  useEffect(() => {
    const interval = setInterval(async () => {
      const { context: ctx } = await getAIContext();
      if (ctx) setContext(ctx);
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedImage(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setImagePreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleRemoveImage = () => {
    setSelectedImage(null);
    setImagePreview(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handlePurchase = async (packageId: string) => {
    setPurchasingPackage(packageId);
    await purchaseCredits(packageId);
    setPurchasingPackage(null);
  };

  const handleSendMessage = async (question?: string) => {
    const messageText = question || inputMessage.trim();
    if (!messageText || !context) return;

    // Check if user has enough credits
    if (totalCredits < creditCost) {
      setInsufficientCredits(true);
      setShowBuyCreditsModal(true);
      return;
    }
    setInsufficientCredits(false);

    // Clear input and image
    setInputMessage("");
    handleRemoveImage();

    // If there's an image, include it in the message (for display purposes)
    let content = messageText;
    if (imagePreview) {
      // Note: For actual image analysis, the API would need to handle multipart/form-data
      // For now, we'll append a note that an image was included
      content = `[Image attached for analysis]\n\n${messageText}`;
    }

    // Send message using AI SDK
    await append({
      role: "user",
      content,
    });
  };

  const refreshContext = async () => {
    setLoadingContext(true);
    const { context: ctx } = await getAIContext();
    if (ctx) {
      setContext(ctx);
      
      let refreshContent: string;
      if (ctx.hasData) {
        const insights = generateBusinessInsights(ctx);
        refreshContent = `**Data Refreshed!**\n\nNow tracking **${ctx.totalEvents.toLocaleString()} player actions** with **${ctx.totalRevenue.toLocaleString()} Robux** revenue.`;
        if (insights.length > 0) {
          refreshContent += `\n\n**Latest Insight:** ${insights[0]}`;
        }
        refreshContent += `\n\nWhat would you like to know?`;
      } else {
        refreshContent = "I still don't see any tracking data. Make sure the RoMonetize tracker is installed and sending player actions from your game.";
      }
      
      await append({
        role: "assistant",
        content: refreshContent,
      });
    }
    setLoadingContext(false);
  };

  if (loadingContext) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary to-blue-400 flex items-center justify-center">
              <Sparkles className="w-4 h-4 text-primary-foreground" />
            </div>
            AI Assistant
          </h1>
          <p className="text-muted-foreground mt-1">Loading your game data...</p>
        </div>
        <Card className="border-border bg-card min-h-[400px] flex items-center justify-center">
          <RefreshCw className="w-8 h-8 animate-spin text-muted-foreground" />
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary to-blue-400 flex items-center justify-center">
              <Sparkles className="w-4 h-4 text-primary-foreground" />
            </div>
            AI Assistant
          </h1>
          <p className="text-muted-foreground mt-1">
            {loadingStats 
              ? "Loading analytics data..."
              : analyticsStats?.hasData 
                ? `Analyzing ${analyticsStats.gameName || "your game"} with ${analyticsStats.trackedActions.toLocaleString()} tracked actions`
                : "Get AI-powered insights once you have tracking data"
            }
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button 
            onClick={() => setShowBuyCreditsModal(true)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-purple-500/10 border border-purple-500/20 hover:bg-purple-500/20 transition-colors"
          >
            <Sparkles className="w-4 h-4 text-purple-500" />
            <span className="text-sm font-medium">{creditsLoading ? "..." : totalCredits} credits</span>
            <Plus className="w-3 h-3 text-purple-500" />
          </button>
          <Button variant="outline" size="sm" onClick={refreshContext} disabled={loadingContext} className="gap-2">
            <RefreshCw className={`w-4 h-4 ${loadingContext ? "animate-spin" : ""}`} />
            Refresh Data
          </Button>
        </div>
      </div>

      {/* Insufficient credits warning */}
      {insufficientCredits && (
        <Alert className="border-amber-500/30 bg-amber-500/5">
          <CreditCard className="h-4 w-4 text-amber-500" />
          <AlertDescription className="flex items-center justify-between">
            <span className="text-amber-700 dark:text-amber-300">
              You need at least {creditCost} credit{creditCost > 1 ? "s" : ""} to send a message. {selectedImage ? "Image analysis costs 3 credits." : "Text prompts cost 1 credit."}
            </span>
            <Button variant="outline" size="sm" className="ml-4 gap-2" onClick={() => setShowBuyCreditsModal(true)}>
              <Plus className="w-3 h-3" />
              Buy Credits
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {/* Stats summary (if data exists) */}
      {loadingStats ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <Card key={i} className="border-border bg-card p-4 animate-pulse">
              <div className="h-4 bg-secondary rounded w-24 mb-2" />
              <div className="h-8 bg-secondary rounded w-16" />
            </Card>
          ))}
        </div>
      ) : analyticsStats?.hasData ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card className="border-border bg-card p-4">
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <Database className="w-4 h-4" />
              Tracked Actions
            </div>
            <div className="text-2xl font-bold mt-1">{analyticsStats.trackedActions.toLocaleString()}</div>
          </Card>
          <Card className="border-border bg-card p-4">
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <DollarSign className="w-4 h-4" />
              Revenue
            </div>
            <div className="text-2xl font-bold mt-1">
              <RobuxValue amount={analyticsStats.revenue} />
            </div>
          </Card>
          <Card className="border-border bg-card p-4">
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <TrendingUp className="w-4 h-4" />
              Purchases
            </div>
            <div className="text-2xl font-bold mt-1">{analyticsStats.purchases.toLocaleString()}</div>
          </Card>
          <Card className="border-border bg-card p-4">
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <BarChart3 className="w-4 h-4" />
              Conversion
            </div>
            <div className="text-2xl font-bold mt-1">
              {analyticsStats.conversionRate !== null 
                ? `${analyticsStats.conversionRate.toFixed(1)}%`
                : "Not enough data"}
            </div>
          </Card>
        </div>
      ) : analyticsStats && !analyticsStats.hasData ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card className="border-border bg-card p-4">
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <Database className="w-4 h-4" />
              Tracked Actions
            </div>
            <div className="text-2xl font-bold mt-1 text-muted-foreground">No data yet</div>
          </Card>
          <Card className="border-border bg-card p-4">
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <DollarSign className="w-4 h-4" />
              Revenue
            </div>
            <div className="text-2xl font-bold mt-1 text-muted-foreground">No data yet</div>
          </Card>
          <Card className="border-border bg-card p-4">
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <TrendingUp className="w-4 h-4" />
              Purchases
            </div>
            <div className="text-2xl font-bold mt-1 text-muted-foreground">No data yet</div>
          </Card>
          <Card className="border-border bg-card p-4">
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <BarChart3 className="w-4 h-4" />
              Conversion
            </div>
            <div className="text-2xl font-bold mt-1 text-muted-foreground">No data yet</div>
          </Card>
        </div>
      ) : null}

      {/* Suggested questions */}
      <div className="flex flex-wrap gap-2">
        {suggestedQuestions.map((question) => (
          <Button
            key={question.text}
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={() => handleSendMessage(question.text)}
            disabled={isLoading || !context}
          >
            <question.icon className="w-4 h-4" />
            {question.text}
          </Button>
        ))}
      </div>

      {/* Chat area */}
      <Card className="border-border bg-card min-h-[400px] flex flex-col">
        <CardHeader className="border-b border-border pb-4">
          <CardTitle className="text-base">Chat</CardTitle>
          <CardDescription>
            {context?.hasData 
              ? "Ask questions about your real monetization data"
              : "Install tracker to enable AI insights"
            }
          </CardDescription>
        </CardHeader>
        <CardContent className="flex-1 flex flex-col p-0">
          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4 max-h-[400px]">
            {messages.map((message) => (
              <div
                key={message.id}
                className={`flex gap-3 ${message.role === "user" ? "justify-end" : "justify-start"}`}
              >
                {message.role === "assistant" && (
                  <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary to-blue-400 flex items-center justify-center shrink-0">
                    <Sparkles className="w-4 h-4 text-primary-foreground" />
                  </div>
                )}
                <div
                  className={`max-w-[80%] rounded-lg p-4 ${
                    message.role === "user"
                      ? "bg-primary text-primary-foreground"
                      : "bg-secondary/50 text-foreground"
                  }`}
                >
                  <div className="text-sm whitespace-pre-wrap prose prose-sm dark:prose-invert max-w-none">
                    {message.content.split("**").map((part, i) => 
                      i % 2 === 1 ? <strong key={i}>{part}</strong> : part
                    )}
                  </div>
                </div>
                {message.role === "user" && (
                  <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
                    <span className="text-xs font-bold text-primary">You</span>
                  </div>
                )}
              </div>
            ))}
            {isLoading && (
              <div className="flex gap-3">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary to-blue-400 flex items-center justify-center shrink-0">
                  <Sparkles className="w-4 h-4 text-primary-foreground" />
                </div>
                <div className="bg-secondary/50 rounded-lg p-4">
                  <RefreshCw className="w-4 h-4 animate-spin text-muted-foreground" />
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Image preview */}
          {imagePreview && (
            <div className="px-4 pb-2">
              <div className="relative inline-block">
                <Image
                  src={imagePreview}
                  alt="Upload preview"
                  width={128}
                  height={128}
                  className="h-24 w-auto rounded-lg border border-border object-cover"
                />
                <button
                  onClick={handleRemoveImage}
                  className="absolute -top-2 -right-2 p-1 rounded-full bg-destructive text-destructive-foreground"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            </div>
          )}

          {/* Input */}
          <div className="p-4 border-t border-border">
            <div className="flex gap-2">
              <input
                type="file"
                ref={fileInputRef}
                accept="image/*"
                onChange={handleImageSelect}
                className="hidden"
              />
              <Button
                variant="outline"
                size="icon"
                onClick={() => fileInputRef.current?.click()}
                disabled={isLoading || !context?.hasData}
                title="Upload image for analysis"
              >
                <ImageIcon className="w-4 h-4" />
              </Button>
              <Textarea
                placeholder={
                  !context?.hasData 
                    ? "Connect a game to enable AI insights..." 
                    : totalCredits < creditCost 
                      ? "Buy credits to ask questions..." 
                      : selectedImage
                        ? "Describe what you want me to analyze in this image..."
                        : "Ask about your monetization data..."
                }
                value={inputMessage}
                onChange={(e) => setInputMessage(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey && !isLoading) {
                    e.preventDefault();
                    handleSendMessage();
                  }
                }}
                disabled={isLoading || !context?.hasData || totalCredits < creditCost}
                className="bg-secondary/30 min-h-[44px] max-h-[120px] resize-none"
                rows={1}
              />
              <Button 
                onClick={() => handleSendMessage()} 
                disabled={isLoading || !inputMessage.trim() || !context?.hasData || totalCredits < creditCost} 
                className="gap-2"
              >
                <Send className="w-4 h-4" />
                Ask AI
              </Button>
            </div>
            <p className="text-xs text-muted-foreground mt-2 text-center">
              {selectedImage ? (
                <span className="text-purple-500 font-medium">Costs 3 credits with image</span>
              ) : (
                <span>Costs 1 credit</span>
              )}
              {" "} | You have {totalCredits} credits available
            </p>
          </div>
        </CardContent>
      </Card>

      {/* No data warning */}
      {context && !context.hasData && (
        <Card className="border-yellow-500/30 bg-yellow-500/5 p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-yellow-500 shrink-0 mt-0.5" />
            <div>
              <h3 className="font-medium text-foreground">No tracking data yet</h3>
              <p className="text-sm text-muted-foreground mt-1">
                The AI assistant needs real event data to provide insights. Go to the My Game page to get the tracking script and install it in your Roblox game.
              </p>
            </div>
          </div>
        </Card>
      )}

      {/* Buy Credits Modal */}
      <Dialog open={showBuyCreditsModal} onOpenChange={setShowBuyCreditsModal}>
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
                  onClick={() => handlePurchase(pkg.id)}
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
                      <RefreshCw className="w-4 h-4 animate-spin" />
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
    </div>
  );
}
