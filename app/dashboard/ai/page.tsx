"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Image from "next/image";
import {
  Sparkles,
  Send,
  RefreshCw,
  Lightbulb,
  TrendingUp,
  DollarSign,
  BarChart3,
  CreditCard,
  Plus,
  ImageIcon,
  X,
  Trash2,
  Camera,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { RobuxValue } from "@/components/ui/robux-icon";
import { useCredits, useCreditPackages } from "@/hooks/use-credits";
import { AI_CREDIT_COSTS, CREDIT_PACKAGES } from "@/lib/products";
import { useChat } from "@ai-sdk/react";
import ReactMarkdown from "react-markdown";

// Quick prompt suggestions
const quickPrompts = [
  { text: "Show me my stats overview", icon: BarChart3 },
  { text: "What should I improve first?", icon: Lightbulb },
  { text: "Which product needs improvement?", icon: TrendingUp },
  { text: "How can I increase conversion?", icon: DollarSign },
  { text: "Why is my revenue low?", icon: DollarSign },
  { text: "Analyze my monetization", icon: BarChart3 },
  { text: "Give me 3 monetization ideas", icon: Lightbulb },
  { text: "How can I improve retention?", icon: TrendingUp },
  { text: "Analyze my shop screenshot", icon: Camera },
];

// Analytics stats interface
interface AnalyticsStats {
  revenue: number;
  purchases: number;
  purchaseRate: number | null;
  uniquePlayers: number;
  hasData: boolean;
}

export default function AIAssistantPage() {
  const [inputMessage, setInputMessage] = useState("");
  const [analyticsStats, setAnalyticsStats] = useState<AnalyticsStats | null>(null);
  const [loadingStats, setLoadingStats] = useState(true);
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
      const remaining = response.headers.get("X-Credits-Remaining");
      if (remaining) {
        refreshCredits();
      }
    },
    onError: (error) => {
      console.error("[v0] AI chat error:", error);
      refreshCredits();
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
          const uniquePlayers = data.trackerStats?.uniquePlayers || 0;
          const purchases = data.revenueStats?.totalPurchases || 0;
          const purchaseRate = uniquePlayers > 0 ? (purchases / uniquePlayers) * 100 : null;
          
          setAnalyticsStats({
            revenue: data.revenueStats?.totalRevenue || 0,
            purchases,
            purchaseRate,
            uniquePlayers,
            hasData: (data.trackerStats?.totalEvents || 0) > 0,
          });
        } else {
          setAnalyticsStats({
            revenue: 0,
            purchases: 0,
            purchaseRate: null,
            uniquePlayers: 0,
            hasData: false,
          });
        }
      }
    } catch (error) {
      console.error("[v0] Failed to fetch analytics:", error);
      setAnalyticsStats({
        revenue: 0,
        purchases: 0,
        purchaseRate: null,
        uniquePlayers: 0,
        hasData: false,
      });
    }
    setLoadingStats(false);
  }, []);

  // Load analytics on mount
  useEffect(() => {
    fetchAnalytics();
  }, [fetchAnalytics]);

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

  const handleSendMessage = async (promptText?: string) => {
    const messageText = promptText || inputMessage.trim();
    if (!messageText && !selectedImage) return;

    // Check if user has enough credits
    if (totalCredits < creditCost) {
      setShowBuyCreditsModal(true);
      return;
    }

    // Clear input
    setInputMessage("");
    
    // Build message content
    let content = messageText || "";
    if (imagePreview) {
      content = `[Image attached for analysis]\n\n${content || "Please analyze this screenshot."}`;
    }

    // Clear image after building content
    handleRemoveImage();

    // Send message using AI SDK
    await append({
      role: "user",
      content,
    });
  };

  const handleClearChat = () => {
    setMessages([]);
  };

  const handleRefreshData = async () => {
    setLoadingStats(true);
    await fetchAnalytics();
    refreshCredits();
  };

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
            Ask about your Roblox monetization data or upload shop/game screenshots for analysis.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button 
            onClick={() => setShowBuyCreditsModal(true)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-purple-500/10 border border-purple-500/20 hover:bg-purple-500/20 transition-colors"
          >
            <Sparkles className="w-4 h-4 text-purple-500" />
            <span className="text-sm font-medium">{creditsLoading ? "..." : totalCredits} credits</span>
          </button>
          <Button variant="outline" size="sm" onClick={handleRefreshData} disabled={loadingStats} className="gap-2">
            <RefreshCw className={`w-4 h-4 ${loadingStats ? "animate-spin" : ""}`} />
            Refresh Data
          </Button>
        </div>
      </div>

      {/* 3 Compact stat cards */}
      <div className="grid grid-cols-3 gap-4">
        <Card className="border-border bg-card p-4">
          <div className="flex items-center gap-2 text-muted-foreground text-sm">
            <DollarSign className="w-4 h-4" />
            Revenue
          </div>
          <div className="text-2xl font-bold mt-1">
            {loadingStats ? (
              <span className="text-muted-foreground">...</span>
            ) : analyticsStats?.hasData ? (
              <RobuxValue amount={analyticsStats.revenue} />
            ) : (
              <span className="text-muted-foreground text-base">No data yet</span>
            )}
          </div>
        </Card>
        <Card className="border-border bg-card p-4">
          <div className="flex items-center gap-2 text-muted-foreground text-sm">
            <TrendingUp className="w-4 h-4" />
            Purchases
          </div>
          <div className="text-2xl font-bold mt-1">
            {loadingStats ? (
              <span className="text-muted-foreground">...</span>
            ) : analyticsStats?.hasData ? (
              analyticsStats.purchases.toLocaleString()
            ) : (
              <span className="text-muted-foreground text-base">No data yet</span>
            )}
          </div>
        </Card>
        <Card className="border-border bg-card p-4">
          <div className="flex items-center gap-2 text-muted-foreground text-sm">
            <BarChart3 className="w-4 h-4" />
            Purchase Rate
          </div>
          <div className="text-2xl font-bold mt-1">
            {loadingStats ? (
              <span className="text-muted-foreground">...</span>
            ) : analyticsStats?.purchaseRate !== null ? (
              `${analyticsStats.purchaseRate.toFixed(1)}%`
            ) : (
              <span className="text-muted-foreground text-base">Needs player data</span>
            )}
          </div>
        </Card>
      </div>

      {/* Quick prompt buttons */}
      <div className="flex flex-wrap gap-2">
        {quickPrompts.map((prompt) => (
          <Button
            key={prompt.text}
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={() => handleSendMessage(prompt.text)}
            disabled={isLoading}
          >
            <prompt.icon className="w-4 h-4" />
            {prompt.text}
          </Button>
        ))}
      </div>

      {/* Chat area */}
      <Card className="border-border bg-card flex flex-col" style={{ minHeight: "500px" }}>
        {/* Chat header */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <div className="text-sm font-medium text-foreground">Chat</div>
          {messages.length > 0 && (
            <Button variant="ghost" size="sm" onClick={handleClearChat} className="gap-2 text-muted-foreground hover:text-foreground">
              <Trash2 className="w-4 h-4" />
              Clear Chat
            </Button>
          )}
        </div>

        {/* Messages area */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.length === 0 ? (
            // Empty state welcome
            <div className="flex flex-col items-center justify-center h-full text-center py-12">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-primary to-blue-400 flex items-center justify-center mb-4">
                <Sparkles className="w-8 h-8 text-primary-foreground" />
              </div>
              <h2 className="text-xl font-semibold text-foreground mb-2">Welcome to RoMonetize AI</h2>
              <p className="text-muted-foreground max-w-md">
                Ask about your Roblox revenue, products, conversion, retention, or upload a shop screenshot for analysis.
              </p>
            </div>
          ) : (
            <>
              {messages.map((message) => (
                <div
                  key={message.id}
                  className={`flex gap-3 ${message.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  {message.role === "assistant" && (
                    <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary to-blue-400 flex items-center justify-center shrink-0 mt-1">
                      <Sparkles className="w-4 h-4 text-primary-foreground" />
                    </div>
                  )}
                  <div
                    className={`rounded-lg p-4 ${
                      message.role === "user"
                        ? "bg-primary text-primary-foreground max-w-[70%]"
                        : "bg-secondary/50 text-foreground max-w-[75%]"
                    }`}
                  >
                    {message.role === "assistant" ? (
                      <div className="prose prose-sm dark:prose-invert max-w-none prose-p:my-2 prose-headings:my-3 prose-ul:my-2 prose-li:my-0.5">
                        <ReactMarkdown>{message.content}</ReactMarkdown>
                      </div>
                    ) : (
                      <div className="text-sm whitespace-pre-wrap">{message.content}</div>
                    )}
                  </div>
                  {message.role === "user" && (
                    <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center shrink-0 mt-1">
                      <span className="text-xs font-bold text-primary">You</span>
                    </div>
                  )}
                </div>
              ))}
              {isLoading && (
                <div className="flex gap-3">
                  <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary to-blue-400 flex items-center justify-center shrink-0 mt-1">
                    <Sparkles className="w-4 h-4 text-primary-foreground" />
                  </div>
                  <div className="bg-secondary/50 rounded-lg p-4">
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span className="text-sm">Thinking...</span>
                    </div>
                  </div>
                </div>
              )}
            </>
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

        {/* Input area */}
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
              disabled={isLoading}
              title="Upload image for analysis"
            >
              <ImageIcon className="w-4 h-4" />
            </Button>
            <Textarea
              placeholder="Ask about your monetization data..."
              value={inputMessage}
              onChange={(e) => setInputMessage(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !isLoading) {
                  e.preventDefault();
                  handleSendMessage();
                }
              }}
              disabled={isLoading}
              className="bg-secondary/30 min-h-[44px] max-h-[120px] resize-none"
              rows={1}
            />
            <Button 
              onClick={() => handleSendMessage()} 
              disabled={isLoading || (!inputMessage.trim() && !selectedImage)} 
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
            {" "}| You have {totalCredits} credits available
          </p>
        </div>
      </Card>

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
                ? { text: "Best Value - Save 10%", color: "text-green-600 bg-green-500/10" }
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
