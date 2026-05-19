"use client";

import { useState, useRef, useEffect, Component, type ReactNode, useCallback } from "react";
import Image from "next/image";
import { useSearchParams } from "next/navigation";
import {
  Sparkles,
  Send,
  RefreshCw,
  Lightbulb,
  TrendingUp,
  DollarSign,
  BarChart3,
  ImageIcon,
  X,
  Trash2,
  AlertCircle,
  Plus,
  MessageSquare,
  ChevronLeft,
  ChevronRight,
  MoreVertical,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { useCredits } from "@/hooks/use-credits";
import { AI_CREDIT_COSTS } from "@/lib/products";
import ReactMarkdown from "react-markdown";
import { BuyCreditsModal } from "@/components/billing/BuyCreditsModal";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

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
    console.error("[AI Page Error]:", error.message);
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
];

interface Message {
  id: string;
  role: "user" | "assistant" | "error";
  content: string;
  has_image?: boolean;
}

interface Conversation {
  id: string;
  title: string;
  folder: string | null;
  game_id: string | null;
  created_at: string;
  updated_at: string;
}

function AIAssistantContent() {
  const searchParams = useSearchParams();
  const debug = searchParams.get("debug") === "true";
  
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showBuyCreditsModal, setShowBuyCreditsModal] = useState(false);
  const [selectedImage, setSelectedImage] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // Conversation state
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [loadingConversations, setLoadingConversations] = useState(true);
  
  // Debug state
  const [debugInfo, setDebugInfo] = useState<Record<string, unknown>>({});
  
  // Credits
  const { totalCredits, isLoading: creditsLoading, refresh: refreshCredits } = useCredits();
  
  // Credit cost based on image
  const creditCost = selectedImage ? AI_CREDIT_COSTS.image : AI_CREDIT_COSTS.text;

  // Fetch conversations on mount
  useEffect(() => {
    fetchConversations();
  }, []);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const fetchConversations = async () => {
    setLoadingConversations(true);
    try {
      const res = await fetch("/api/ai/conversations?limit=50");
      const data = await res.json();
      if (data.success) {
        setConversations(data.conversations || []);
      }
    } catch (error) {
      console.error("Failed to fetch conversations:", error);
    } finally {
      setLoadingConversations(false);
    }
  };

  const loadConversation = async (conversationId: string) => {
    try {
      const res = await fetch(`/api/ai/conversations/${conversationId}`);
      const data = await res.json();
      if (data.success) {
        setActiveConversationId(conversationId);
        setMessages(data.messages.map((m: { id: string; role: string; content: string; has_image?: boolean }) => ({
          id: m.id,
          role: m.role as "user" | "assistant" | "error",
          content: m.content,
          has_image: m.has_image,
        })));
      }
    } catch (error) {
      console.error("Failed to load conversation:", error);
    }
  };

  const createNewConversation = async (title?: string): Promise<string | null> => {
    try {
      const res = await fetch("/api/ai/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title || "New Chat" }),
      });
      const data = await res.json();
      if (data.success && data.conversation) {
        setConversations(prev => [data.conversation, ...prev]);
        return data.conversation.id;
      }
    } catch (error) {
      console.error("Failed to create conversation:", error);
    }
    return null;
  };

  const deleteConversation = async (conversationId: string) => {
    try {
      const res = await fetch(`/api/ai/conversations/${conversationId}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setConversations(prev => prev.filter(c => c.id !== conversationId));
        if (activeConversationId === conversationId) {
          handleNewChat();
        }
      }
    } catch (error) {
      console.error("Failed to delete conversation:", error);
    }
  };

  const updateConversationTitle = async (conversationId: string, title: string) => {
    try {
      await fetch(`/api/ai/conversations/${conversationId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });
      setConversations(prev => prev.map(c => 
        c.id === conversationId ? { ...c, title } : c
      ));
    } catch (error) {
      console.error("Failed to update conversation title:", error);
    }
  };

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

  // SINGLE SEND FUNCTION - used by all send methods
  const handleSend = useCallback(async (messageOverride?: string) => {
    const text = messageOverride ?? input.trim();
    
    // Validate input
    if (!text && !imagePreview) {
      return;
    }
    
    // Prevent duplicate sends
    if (isLoading) {
      return;
    }

    // Build user message content for display
    let userContent = text;
    const hasImage = Boolean(imagePreview);
    if (imagePreview && !text) {
      userContent = "[Image attached]\n\nPlease analyze this screenshot.";
    } else if (imagePreview && text) {
      userContent = `[Image attached]\n\n${text}`;
    }

    // Add user message to UI
    const userMessageId = `user-${Date.now()}`;
    const userMessage: Message = {
      id: userMessageId,
      role: "user",
      content: userContent,
      has_image: hasImage,
    };
    setMessages(prev => [...prev, userMessage]);

    // Clear input and capture image before clearing
    setInput("");
    const currentImageDataUrl = imagePreview;
    const currentImageFile = selectedImage;
    handleRemoveImage();

    // Set loading
    setIsLoading(true);

    // Ensure we have a conversation
    let conversationId = activeConversationId;
    if (!conversationId) {
      // Auto-generate title from first message
      const autoTitle = text.length > 40 ? text.substring(0, 40) + "..." : (text || "Image Analysis");
      conversationId = await createNewConversation(autoTitle);
      if (conversationId) {
        setActiveConversationId(conversationId);
      }
    }

    try {
      // Build request body
      const requestBody: {
        message: string;
        imageDataUrl?: string;
        imageName?: string;
        imageMimeType?: string;
        conversationId?: string;
      } = {
        message: text || "Please analyze this screenshot.",
        conversationId: conversationId || undefined,
      };
      
      // Include image data if present
      if (currentImageDataUrl && currentImageFile) {
        requestBody.imageDataUrl = currentImageDataUrl;
        requestBody.imageName = currentImageFile.name;
        requestBody.imageMimeType = currentImageFile.type || "image/png";
      }

      // Update debug info
      if (debug) {
        setDebugInfo(prev => ({
          ...prev,
          lastRequest: {
            hasImage: Boolean(currentImageDataUrl),
            conversationId,
            messageLength: text.length,
          },
        }));
      }

      // Call API
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });

      const data = await res.json();

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
        
        // Refresh conversations list to update timestamps
        fetchConversations();
      }
    } catch (error) {
      console.error("API call failed:", error);
      setMessages(prev => [...prev, {
        id: `error-${Date.now()}`,
        role: "error",
        content: "Failed to connect to AI. Please try again.",
      }]);
    } finally {
      setIsLoading(false);
    }
  }, [input, imagePreview, isLoading, activeConversationId, selectedImage, debug, refreshCredits]);

  // New chat
  const handleNewChat = () => {
    setMessages([]);
    setActiveConversationId(null);
    setInput("");
    handleRemoveImage();
  };

  // Handle Enter key
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Format date for sidebar
  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    
    if (diffDays === 0) return "Today";
    if (diffDays === 1) return "Yesterday";
    if (diffDays < 7) return `${diffDays} days ago`;
    return date.toLocaleDateString();
  };

  return (
    <div className="flex h-[calc(100vh-120px)] gap-4">
      {/* Sidebar */}
      <div className={`${sidebarOpen ? "w-64" : "w-0"} transition-all duration-300 overflow-hidden flex-shrink-0`}>
        <Card className="h-full border-border bg-card flex flex-col">
          {/* Sidebar header */}
          <div className="p-3 border-b border-border flex items-center justify-between">
            <h3 className="font-semibold text-sm text-foreground">Conversations</h3>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={handleNewChat}
              title="New Chat"
            >
              <Plus className="w-4 h-4" />
            </Button>
          </div>
          
          {/* Conversations list */}
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {loadingConversations ? (
              <div className="flex items-center justify-center py-8">
                <RefreshCw className="w-4 h-4 animate-spin text-muted-foreground" />
              </div>
            ) : conversations.length === 0 ? (
              <div className="text-center py-8 px-4">
                <MessageSquare className="w-8 h-8 mx-auto mb-2 text-muted-foreground/50" />
                <p className="text-xs text-muted-foreground">No conversations yet</p>
              </div>
            ) : (
              conversations.map((conv) => (
                <div
                  key={conv.id}
                  className={`group flex items-center gap-2 p-2 rounded-lg cursor-pointer transition-colors ${
                    activeConversationId === conv.id
                      ? "bg-primary/10 text-primary"
                      : "hover:bg-secondary/50 text-foreground"
                  }`}
                  onClick={() => loadConversation(conv.id)}
                >
                  <MessageSquare className="w-4 h-4 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{conv.title}</p>
                    <p className="text-xs text-muted-foreground">{formatDate(conv.updated_at)}</p>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <MoreVertical className="w-3 h-3" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        className="text-destructive"
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteConversation(conv.id);
                        }}
                      >
                        <Trash2 className="w-4 h-4 mr-2" />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              ))
            )}
          </div>
        </Card>
      </div>

      {/* Toggle sidebar button */}
      <Button
        variant="ghost"
        size="icon"
        className="absolute left-4 top-1/2 -translate-y-1/2 h-8 w-8 z-10 md:hidden"
        onClick={() => setSidebarOpen(!sidebarOpen)}
      >
        {sidebarOpen ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
      </Button>

      {/* Main chat area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Page header */}
        <div className="mb-4">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 lg:hidden"
              onClick={() => setSidebarOpen(!sidebarOpen)}
            >
              {sidebarOpen ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            </Button>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary to-blue-400 flex items-center justify-center">
                <Sparkles className="w-4 h-4 text-primary-foreground" />
              </div>
              AI Assistant
            </h1>
          </div>
          <p className="text-muted-foreground mt-1">
            Upload images or ask questions about Roblox monetization
          </p>
        </div>

        {/* Quick prompts - only show when no messages */}
        {messages.length === 0 && (
          <div className="flex flex-wrap gap-2 mb-4">
            {quickPrompts.map((prompt) => (
              <button
                key={prompt.text}
                onClick={() => handleSend(prompt.text)}
                disabled={isLoading}
                className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium border transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${prompt.color}`}
              >
                <prompt.icon className="w-4 h-4" />
                {prompt.text}
              </button>
            ))}
          </div>
        )}

        {/* Chat card */}
        <Card className="border-border bg-card flex flex-col flex-1 min-h-0">
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

        {/* Debug panel */}
        {debug && (
          <Card className="mt-4 p-4 border-border bg-card">
            <h3 className="font-semibold text-sm mb-2">Debug Info</h3>
            <pre className="text-xs overflow-auto max-h-40 bg-secondary/30 p-2 rounded">
              {JSON.stringify({
                activeConversationId,
                conversationCount: conversations.length,
                messageCount: messages.length,
                ...debugInfo,
              }, null, 2)}
            </pre>
          </Card>
        )}
      </div>

      {/* Buy Credits Modal */}
      <BuyCreditsModal open={showBuyCreditsModal} onOpenChange={setShowBuyCreditsModal} />
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
