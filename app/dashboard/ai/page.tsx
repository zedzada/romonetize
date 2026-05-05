"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import {
  Sparkles,
  Send,
  RefreshCw,
  Lightbulb,
  TrendingUp,
  AlertTriangle,
  DollarSign,
  Database,
  BarChart3,
  CreditCard,
  Plus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { getAIContext } from "@/lib/actions/ai";
import { generateSmartResponse, generateBusinessInsights, type AIContext } from "@/lib/utils/ai-responses";
import { RobuxValue } from "@/components/ui/robux-icon";
import { useStatsRefresh } from "@/hooks/use-stats-refresh";
import { useCredits } from "@/hooks/use-credits";
import { AI_CREDIT_COSTS } from "@/lib/products";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
}

const suggestedQuestions = [
  { text: "Show me my stats overview", icon: BarChart3 },
  { text: "What are my 7-day trends?", icon: TrendingUp },
  { text: "Which product needs improvement?", icon: Lightbulb },
  { text: "Give me recommendations", icon: DollarSign },
];

export default function AIAssistantPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputMessage, setInputMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [context, setContext] = useState<AIContext | null>(null);
  const [loadingContext, setLoadingContext] = useState(true);
  const [insufficientCredits, setInsufficientCredits] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  
  // AI Credits
  const { totalCredits, consumeCredits, refundCredits, isLoading: creditsLoading } = useCredits();
  const creditCost = AI_CREDIT_COSTS.text; // Text prompts cost 1 credit

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
      
      const initialMessage: Message = {
        id: "1",
        role: "assistant",
        content: initialContent,
      };
      setMessages([initialMessage]);
    }
    setLoadingContext(false);
  }, []);

  // Load AI context on mount
  useEffect(() => {
    loadContext();
  }, [loadContext]);

  // Listen for global stats refresh
  useStatsRefresh(loadContext);

  // Auto-refresh context every 10 seconds (silent refresh, doesn't reset messages)
  useEffect(() => {
    const interval = setInterval(async () => {
      const { context: ctx } = await getAIContext();
      if (ctx) setContext(ctx);
    }, 10000);
    return () => clearInterval(interval);
  }, []);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSendMessage = async (question?: string) => {
    const messageText = question || inputMessage.trim();
    if (!messageText || !context) return;

    // Check if user has enough credits
    if (totalCredits < creditCost) {
      setInsufficientCredits(true);
      return;
    }
    setInsufficientCredits(false);

    // Consume credits first
    const consumeResult = await consumeCredits("text");
    if (!consumeResult.success) {
      if (consumeResult.error === "Insufficient credits") {
        setInsufficientCredits(true);
      }
      return;
    }

    // Add user message
    const userMessage: Message = {
      id: Date.now().toString(),
      role: "user",
      content: messageText,
    };
    setMessages((prev) => [...prev, userMessage]);
    setInputMessage("");
    setIsLoading(true);

    try {
      // Simulate AI thinking delay
      await new Promise((resolve) => setTimeout(resolve, 800));

      // Generate smart response based on real data
      const response = generateSmartResponse(messageText, context);

      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: response,
      };
      setMessages((prev) => [...prev, assistantMessage]);
    } catch (error) {
      // Refund credits on error
      await refundCredits("text", "AI response generation failed");
      
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: "Sorry, I encountered an error processing your request. Your credits have been refunded.",
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
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
      
      const refreshMessage: Message = {
        id: Date.now().toString(),
        role: "assistant",
        content: refreshContent,
      };
      setMessages((prev) => [...prev, refreshMessage]);
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
            {context?.hasData 
              ? `Analyzing ${context.gameName || "your game"} with ${context.totalEvents.toLocaleString()} tracked actions`
              : "Get AI-powered insights once you have tracking data"
            }
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-purple-500/10 border border-purple-500/20">
            <Sparkles className="w-4 h-4 text-purple-500" />
            <span className="text-sm font-medium">{creditsLoading ? "..." : totalCredits} credits</span>
          </div>
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
              You need at least {creditCost} credit{creditCost > 1 ? "s" : ""} to send a message. Each text prompt costs {creditCost} credit.
            </span>
            <Button variant="outline" size="sm" className="ml-4 gap-2" asChild>
              <Link href="/dashboard/billing">
                <Plus className="w-3 h-3" />
                Buy Credits
              </Link>
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {/* Stats summary (if data exists) */}
      {context?.hasData && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card className="border-border bg-card p-4">
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <Database className="w-4 h-4" />
              Tracked Actions
            </div>
            <div className="text-2xl font-bold mt-1">{context.totalEvents.toLocaleString()}</div>
          </Card>
          <Card className="border-border bg-card p-4">
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <DollarSign className="w-4 h-4" />
              Revenue
            </div>
            <div className="text-2xl font-bold mt-1">
              <RobuxValue amount={context.totalRevenue} />
            </div>
          </Card>
          <Card className="border-border bg-card p-4">
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <TrendingUp className="w-4 h-4" />
              Purchases
            </div>
            <div className="text-2xl font-bold mt-1">{context.totalPurchases.toLocaleString()}</div>
          </Card>
          <Card className="border-border bg-card p-4">
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <BarChart3 className="w-4 h-4" />
              Conversion
            </div>
            <div className="text-2xl font-bold mt-1">{context.conversionRate.toFixed(1)}%</div>
          </Card>
        </div>
      )}

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
                  <div className="text-sm whitespace-pre-wrap">
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

          {/* Input */}
          <div className="p-4 border-t border-border">
            <div className="flex gap-2">
              <Input
                placeholder={
                  !context?.hasData 
                    ? "Connect a game to enable AI insights..." 
                    : totalCredits < creditCost 
                      ? "Buy credits to ask questions..." 
                      : "Ask about your monetization data..."
                }
                value={inputMessage}
                onChange={(e) => setInputMessage(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !isLoading && handleSendMessage()}
                disabled={isLoading || !context?.hasData || totalCredits < creditCost}
                className="bg-secondary/30"
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
              Each question costs {creditCost} credit. You have {totalCredits} credits available.
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
    </div>
  );
}
