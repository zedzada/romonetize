"use client";

import { useState, useRef, useEffect, Component, type ReactNode } from "react";
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
  ImageIcon,
  X,
  Trash2,
  AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useCredits, useCreditPackages } from "@/hooks/use-credits";
import { AI_CREDIT_COSTS, CREDIT_PACKAGES } from "@/lib/products";
import ReactMarkdown from "react-markdown";

// Error boundary for the AI page
class AIErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean; error?: Error }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: { componentStack: string }) {
    console.error("[v0] AI Page Error Message:", error.message);
    console.error("[v0] AI Page Error Stack:", error.stack);
    console.error("[v0] AI Page Component Stack:", errorInfo.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="space-y-6">
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary to-blue-400 flex items-center justify-center">
                <Sparkles className="w-4 h-4 text-primary-foreground" />
              </div>
              AI Assistant
            </h1>
            <p className="text-muted-foreground mt-1">
              Upload images or ask questions about Roblox monetization
            </p>
          </div>
          <Card className="border-border bg-card p-8">
            <div className="flex flex-col items-center justify-center text-center">
              <AlertCircle className="w-12 h-12 text-destructive mb-4" />
              <h2 className="text-lg font-semibold text-foreground mb-2">Something went wrong</h2>
              <p className="text-muted-foreground mb-4 max-w-md">
                The AI Assistant encountered an error. Please try refreshing the page.
              </p>
              <Button onClick={() => window.location.reload()}>
                Refresh Page
              </Button>
            </div>
          </Card>
        </div>
      );
    }

    return this.props.children;
  }
}

// Quick prompt suggestions with category colors
const quickPrompts = [
  { text: "Show me my stats overview", icon: BarChart3, color: "text-blue-500 border-blue-500/30 bg-blue-500/5 hover:bg-blue-500/10" },
  { text: "What should I improve first?", icon: Lightbulb, color: "text-yellow-500 border-yellow-500/30 bg-yellow-500/5 hover:bg-yellow-500/10" },
  { text: "Which product needs improvement?", icon: TrendingUp, color: "text-green-500 border-green-500/30 bg-green-500/5 hover:bg-green-500/10" },
  { text: "How can I increase conversion?", icon: DollarSign, color: "text-emerald-500 border-emerald-500/30 bg-emerald-500/5 hover:bg-emerald-500/10" },
  { text: "Why is my revenue low?", icon: DollarSign, color: "text-emerald-500 border-emerald-500/30 bg-emerald-500/5 hover:bg-emerald-500/10" },
  { text: "Analyze my monetization", icon: BarChart3, color: "text-blue-500 border-blue-500/30 bg-blue-500/5 hover:bg-blue-500/10" },
  { text: "Give me 3 monetization ideas", icon: Lightbulb, color: "text-yellow-500 border-yellow-500/30 bg-yellow-500/5 hover:bg-yellow-500/10" },
  { text: "How can I improve retention?", icon: TrendingUp, color: "text-green-500 border-green-500/30 bg-green-500/5 hover:bg-green-500/10" },
];

interface Message {
  id: string;
  role: "user" | "assistant" | "error";
  content: string;
}

function AIAssistantContent() {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showBuyCreditsModal, setShowBuyCreditsModal] = useState(false);
  const [selectedImage, setSelectedImage] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [purchasingPackage, setPurchasingPackage] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // Credits
  const { totalCredits, isLoading: creditsLoading, refresh: refreshCredits } = useCredits();
  const { purchaseCredits } = useCreditPackages();
  
  // Credit cost based on image
  const creditCost = selectedImage ? AI_CREDIT_COSTS.image : AI_CREDIT_COSTS.text;

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Image handling
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

  // Purchase credits
  const handlePurchase = async (packageId: string) => {
    setPurchasingPackage(packageId);
    await purchaseCredits(packageId);
    setPurchasingPackage(null);
  };

  // SINGLE SEND FUNCTION - used by all send methods
  const handleSend = async (messageOverride?: string) => {
    const text = messageOverride ?? input.trim();
    
    // Debug log
    if (process.env.NODE_ENV === "development") {
      console.log("[v0] handleSend called", { text, hasImage: !!imagePreview });
    }

    // Validate input
    if (!text && !imagePreview) {
      console.log("[v0] No text or image, returning");
      return;
    }
    
    // Prevent duplicate sends
    if (isLoading) {
      console.log("[v0] Already loading, returning");
      return;
    }

    // Do NOT block on credits client-side - let server handle it

    // Build user message content
    let userContent = text;
    if (imagePreview && !text) {
      userContent = "Please analyze this screenshot.";
    } else if (imagePreview && text) {
      userContent = `[Image attached]\n\n${text}`;
    }

    // Add user message
    const userMessageId = `user-${Date.now()}`;
    const userMessage: Message = {
      id: userMessageId,
      role: "user",
      content: userContent,
    };
    setMessages(prev => [...prev, userMessage]);

    // Clear input and image
    setInput("");
    const currentImage = imagePreview;
    handleRemoveImage();

    // Set loading
    setIsLoading(true);

    try {
      // Build request body
      const requestBody = {
        message: text || "Please analyze this screenshot.",
        image: currentImage || null,
      };

      if (process.env.NODE_ENV === "development") {
        console.log("[v0] API request body keys:", Object.keys(requestBody));
      }

      // Call API
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });

      const data = await res.json();

      if (process.env.NODE_ENV === "development") {
        console.log("[v0] API response", { success: data.success, hasError: !!data.error });
      }

      if (!res.ok || !data.success) {
        // Handle error
        const errorMessage = data.error || "Something went wrong";
        
        // Check if insufficient credits
        if (res.status === 402 || errorMessage.toLowerCase().includes("insufficient")) {
          setShowBuyCreditsModal(true);
        }

        // Add error message
        setMessages(prev => [...prev, {
          id: `error-${Date.now()}`,
          role: "error",
          content: errorMessage,
        }]);
      } else {
        // Add assistant message
        setMessages(prev => [...prev, {
          id: `assistant-${Date.now()}`,
          role: "assistant",
          content: data.message,
        }]);

        // Update credits
        refreshCredits();
        window.dispatchEvent(new CustomEvent("credits-updated"));
      }
    } catch (error) {
      console.error("[v0] API call failed:", error);
      setMessages(prev => [...prev, {
        id: `error-${Date.now()}`,
        role: "error",
        content: "Failed to connect to AI. Please try again.",
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  // Clear chat
  const handleClearChat = () => {
    setMessages([]);
  };

  // Handle Enter key
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary to-blue-400 flex items-center justify-center">
            <Sparkles className="w-4 h-4 text-primary-foreground" />
          </div>
          AI Assistant
        </h1>
        <p className="text-muted-foreground mt-1">
          Upload images or ask questions about Roblox monetization
        </p>
      </div>

      {/* Quick prompts */}
      <div className="flex flex-wrap gap-2">
        {quickPrompts.map((prompt) => (
          <button
            key={prompt.text}
            onClick={() => {
              handleSend(prompt.text);
            }}
            disabled={isLoading}
            className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium border transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${prompt.color}`}
          >
            <prompt.icon className="w-4 h-4" />
            {prompt.text}
          </button>
        ))}
      </div>

      {/* Chat card */}
      <Card className="border-border bg-card flex flex-col min-h-[500px]">
        {/* Chat header */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <div>
            <div className="text-sm font-medium text-foreground">Chat</div>
            <div className="text-xs text-muted-foreground">
              Upload images for analysis or ask general Roblox monetization questions
            </div>
          </div>
          {messages.length > 0 && (
            <Button variant="ghost" size="sm" onClick={handleClearChat} className="gap-2 text-muted-foreground hover:text-foreground">
              <Trash2 className="w-4 h-4" />
              Clear chat
            </Button>
          )}
        </div>

        {/* Messages area */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.length === 0 ? (
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
                  {message.role !== "user" && (
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-1 ${
                      message.role === "error" 
                        ? "bg-destructive/10" 
                        : "bg-gradient-to-br from-primary to-blue-400"
                    }`}>
                      {message.role === "error" ? (
                        <AlertCircle className="w-4 h-4 text-destructive" />
                      ) : (
                        <Sparkles className="w-4 h-4 text-primary-foreground" />
                      )}
                    </div>
                  )}
                  <div
                    className={`rounded-lg p-4 ${
                      message.role === "user"
                        ? "bg-primary text-primary-foreground max-w-[70%]"
                        : message.role === "error"
                          ? "bg-destructive/10 text-destructive max-w-[80%]"
                          : "bg-secondary/50 text-foreground max-w-[80%]"
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
          <form 
            onSubmit={(e) => {
              e.preventDefault();
              handleSend();
            }}
            className="flex gap-2"
          >
            <input
              type="file"
              ref={fileInputRef}
              accept="image/*"
              onChange={handleImageSelect}
              className="hidden"
            />
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={() => fileInputRef.current?.click()}
              disabled={isLoading}
              title="Upload image for analysis"
            >
              <ImageIcon className="w-4 h-4" />
            </Button>
            <Textarea
              placeholder="Ask about monetization, products, conversion..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={isLoading}
              className="bg-secondary/30 min-h-[44px] max-h-[120px] resize-none"
              rows={1}
            />
            <Button 
              type="submit"
              disabled={isLoading || (!input.trim() && !imagePreview)} 
              className="gap-2"
            >
              <Send className="w-4 h-4" />
              Ask AI
            </Button>
          </form>
          <p className="text-xs text-muted-foreground mt-2 text-center">
            {imagePreview ? "Costs 3 credits with image" : "Costs 1 credit"}
            {!creditsLoading && totalCredits < creditCost && (
              <span className="text-destructive ml-2">
                (Not enough credits - <button type="button" onClick={() => setShowBuyCreditsModal(true)} className="underline">buy more</button>)
              </span>
            )}
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

// Export wrapped with error boundary
export default function AIAssistantPage() {
  return (
    <AIErrorBoundary>
      <AIAssistantContent />
    </AIErrorBoundary>
  );
}
