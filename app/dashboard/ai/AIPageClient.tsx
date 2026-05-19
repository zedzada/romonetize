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
  const [conversationsError, setConversationsError] = useState<string | null>(null);
  
  // Debug state
  const [debugInfo, setDebugInfo] = useState<Record<string, unknown>>({});
  
  // AI Context from dashboard analytics
  const [aiContext, setAiContext] = useState<Record<string, unknown> | null>(null);
  const [aiContextLoading, setAiContextLoading] = useState(true); // Start as true - loading on mount
  const [aiContextError, setAiContextError] = useState<string | null>(null);
  const [analyticsLoaded, setAnalyticsLoaded] = useState(false);
  
  // Check if context is ready (has any non-zero stats)
  const aiContextReady = Boolean(aiContext && (
    (aiContext.trackerStats as Record<string, number>)?.trackedActions > 0 ||
    (aiContext.trackerStats as Record<string, number>)?.uniquePlayers > 0 ||
    (aiContext.trackerStats as Record<string, number>)?.totalSessions > 0 ||
    (aiContext.monetizationStats as Record<string, number>)?.purchases > 0 ||
    (aiContext.monetizationStats as Record<string, number>)?.estimatedRevenue > 0 ||
    (aiContext.robloxStats as Record<string, number>)?.visits > 0 ||
    (aiContext.robloxStats as Record<string, number>)?.ccu > 0 ||
    aiContext.selectedGame
  ));
  
  // Credits
  const { totalCredits, isLoading: creditsLoading, refresh: refreshCredits } = useCredits();
  
  // Credit cost based on image
  const creditCost = selectedImage ? AI_CREDIT_COSTS.image : AI_CREDIT_COSTS.text;

  // Fetch conversations on mount
  useEffect(() => {
    fetchConversations();
    fetchAiContext();
  }, []);

  // Fetch AI context from dashboard analytics
  const fetchAiContext = async () => {
    setAiContextLoading(true);
    setAiContextError(null);
    try {
      const res = await fetch("/api/dashboard/analytics?hours=168", { cache: "no-store" });
      const data = await res.json();
      
      if (debug) {
        setDebugInfo(prev => ({
          ...prev,
          analyticsHttpStatus: res.status,
          analyticsResponseKeys: Object.keys(data),
        }));
      }
      
      // Handle multiple possible response shapes
      const root = data?.data || data;
      const success = data.success !== false;
      
      if (success) {
        // Build aiContext from dashboard analytics response - handle multiple shapes
        const context = {
          selectedGame: root?.game?.name || root?.selectedGame || null,
          gameId: root?.game?.id || root?.gameId || null,
          robloxStats: root?.robloxStats || {
            visits: root?.game?.total_visits || 0,
            ccu: root?.game?.current_players || 0,
            favorites: root?.game?.favorites || 0,
            likes: root?.game?.likes || 0,
            dislikes: root?.game?.dislikes || 0,
          },
          trackerStats: root?.trackerStats || {
            trackedActions: root?.metrics?.trackedActions || root?.overview?.trackedActions || 0,
            uniquePlayers: root?.metrics?.uniquePlayers || root?.overview?.uniquePlayers || 0,
            totalSessions: root?.metrics?.totalSessions || root?.overview?.totalSessions || 0,
            newPlayers: root?.metrics?.newPlayers || root?.overview?.newPlayers || 0,
            avgSessionSeconds: root?.metrics?.avgSessionSeconds || root?.overview?.avgSessionSeconds || 0,
          },
          monetizationStats: root?.monetizationStats || {
            purchases: root?.metrics?.purchases || root?.overview?.purchases || 0,
            grossRevenue: root?.metrics?.grossRevenue || root?.overview?.grossRevenue || 0,
            estimatedRevenue: root?.metrics?.estimatedRevenue || root?.overview?.estimatedRevenue || 0,
            payingUsers: root?.metrics?.payingUsers || root?.overview?.payingUsers || 0,
            activeUsers: root?.metrics?.activeUsers || root?.overview?.activeUsers || 0,
            pcr: root?.metrics?.pcr || root?.overview?.pcr || 0,
            arppu: root?.metrics?.arppu || root?.overview?.arppu || 0,
            arpdau: root?.metrics?.arpdau || root?.overview?.arpdau || 0,
          },
          productStats: root?.productStats || {
            totalProducts: root?.products?.length || 0,
            topProducts: root?.products?.slice(0, 5) || [],
          },
          overview: root?.overview || null,
          dataHealth: root?.dataHealth || null,
        };
        setAiContext(context);
        setAnalyticsLoaded(true);
        
        if (debug) {
          setDebugInfo(prev => ({
            ...prev,
            analyticsFetchStatus: "success",
            analyticsLoaded: true,
            aiContextReady: true,
            selectedGameNameFromAnalytics: context.selectedGame,
            selectedGameIdFromAnalytics: context.gameId,
            aiContextBuilt: true,
            aiContextPreview: {
              selectedGame: context.selectedGame,
              trackedActions: (context.trackerStats as Record<string, number>).trackedActions,
              uniquePlayers: (context.trackerStats as Record<string, number>).uniquePlayers,
              totalSessions: (context.trackerStats as Record<string, number>).totalSessions,
              newPlayers: (context.trackerStats as Record<string, number>).newPlayers,
              purchases: (context.monetizationStats as Record<string, number>).purchases,
              estimatedRevenue: (context.monetizationStats as Record<string, number>).estimatedRevenue,
              grossRevenue: (context.monetizationStats as Record<string, number>).grossRevenue,
              payingUsers: (context.monetizationStats as Record<string, number>).payingUsers,
              visits: (context.robloxStats as Record<string, number>).visits,
              ccu: (context.robloxStats as Record<string, number>).ccu,
              favorites: (context.robloxStats as Record<string, number>).favorites,
              totalProducts: (context.productStats as Record<string, number>).totalProducts,
            },
            emptyStateReason: null,
          }));
        }
      } else {
        setAiContextError(data.error || "Failed to fetch analytics");
        setAnalyticsLoaded(true); // Still mark as loaded so user can chat
        if (debug) {
          setDebugInfo(prev => ({
            ...prev,
            analyticsFetchStatus: "error",
            analyticsLoaded: true,
            aiContextReady: false,
            aiContextBuilt: false,
            aiContextError: data.error,
            emptyStateReason: "analytics_fetch_failed",
          }));
        }
      }
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : "Network error";
      setAiContextError(errMsg);
      setAnalyticsLoaded(true); // Still mark as loaded so user can chat
      if (debug) {
        setDebugInfo(prev => ({
          ...prev,
          analyticsFetchStatus: "error",
          analyticsLoaded: true,
          aiContextReady: false,
          aiContextBuilt: false,
          aiContextError: errMsg,
          emptyStateReason: "network_error",
        }));
      }
    } finally {
      setAiContextLoading(false);
    }
  };

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const fetchConversations = async () => {
    setLoadingConversations(true);
    setConversationsError(null);
    try {
      const res = await fetch("/api/ai/conversations?limit=50");
      const data = await res.json();
      
      if (debug) {
        setDebugInfo(prev => ({
          ...prev,
          conversationsHttpStatus: res.status,
          conversationsSuccess: data.success,
          conversationsAuthenticated: data.authenticated,
          conversationsSource: data.source,
          conversationsTableCheck: data.tableCheck,
          conversationsCount: data.conversations?.length || 0,
          messagesFallbackCount: data.messagesFallbackCount || 0,
        }));
      }
      
      if (data.success) {
        // Success - set conversations (may be empty array)
        setConversations(data.conversations || []);
        setConversationsError(null);
      } else {
        // API returned success:false - show error but don't block chat
        setConversations([]);
        // Only show error if both tables failed
        if (data.tableCheck?.aiConversationsReadable === false && data.tableCheck?.aiMessagesReadable === false) {
          setConversationsError("Conversation history unavailable");
        } else {
          setConversationsError(data.error || "Failed to load conversations");
        }
      }
    } catch (error) {
      // Network error - conversations failing shouldn't break chat
      console.error("Failed to fetch conversations:", error);
      setConversations([]);
      setConversationsError("Network error");
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

    // PART 2: Ensure aiContext is ready before first message
    // If not ready, refetch immediately before sending
    let contextToSend = aiContext;
    if (!contextToSend || !analyticsLoaded) {
      try {
        const res = await fetch("/api/dashboard/analytics?hours=168", { cache: "no-store" });
        const data = await res.json();
        const root = data?.data || data;
        
        contextToSend = {
          selectedGame: root?.game?.name || root?.selectedGame || null,
          gameId: root?.game?.id || root?.gameId || null,
          robloxStats: root?.robloxStats || {
            visits: root?.game?.total_visits || 0,
            ccu: root?.game?.current_players || 0,
            favorites: root?.game?.favorites || 0,
            likes: root?.game?.likes || 0,
            dislikes: root?.game?.dislikes || 0,
          },
          trackerStats: root?.trackerStats || {
            trackedActions: root?.metrics?.trackedActions || root?.overview?.trackedActions || 0,
            uniquePlayers: root?.metrics?.uniquePlayers || root?.overview?.uniquePlayers || 0,
            totalSessions: root?.metrics?.totalSessions || root?.overview?.totalSessions || 0,
            newPlayers: root?.metrics?.newPlayers || root?.overview?.newPlayers || 0,
            avgSessionSeconds: root?.metrics?.avgSessionSeconds || root?.overview?.avgSessionSeconds || 0,
          },
          monetizationStats: root?.monetizationStats || {
            purchases: root?.metrics?.purchases || root?.overview?.purchases || 0,
            grossRevenue: root?.metrics?.grossRevenue || root?.overview?.grossRevenue || 0,
            estimatedRevenue: root?.metrics?.estimatedRevenue || root?.overview?.estimatedRevenue || 0,
            payingUsers: root?.metrics?.payingUsers || root?.overview?.payingUsers || 0,
            activeUsers: root?.metrics?.activeUsers || root?.overview?.activeUsers || 0,
            pcr: root?.metrics?.pcr || root?.overview?.pcr || 0,
            arppu: root?.metrics?.arppu || root?.overview?.arppu || 0,
            arpdau: root?.metrics?.arpdau || root?.overview?.arpdau || 0,
          },
          productStats: root?.productStats || {
            totalProducts: root?.products?.length || 0,
            topProducts: root?.products?.slice(0, 5) || [],
          },
          overview: root?.overview || null,
          dataHealth: root?.dataHealth || null,
        };
        setAiContext(contextToSend);
        setAnalyticsLoaded(true);
      } catch {
        // Continue without context - backend will try to fetch
      }
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

    // PART 6: Fix duplicate conversations - only create if no activeConversationId
    let conversationId = activeConversationId;
    if (!conversationId) {
      // Auto-generate title from first message
      const autoTitle = text.length > 40 ? text.substring(0, 40) + "..." : (text || "Image Analysis");
      conversationId = await createNewConversation(autoTitle);
      if (conversationId) {
        setActiveConversationId(conversationId);
      }
      // If conversation creation fails, continue anyway - chat will work without persistence
    }

    try {
      // Build request body with aiContext from dashboard analytics
      const requestBody: {
        message: string;
        imageDataUrl?: string;
        imageName?: string;
        imageMimeType?: string;
        conversationId?: string;
        debug?: boolean;
        aiContext?: Record<string, unknown>;
      } = {
        message: text || "Please analyze this screenshot.",
        conversationId: conversationId || undefined,
        debug: debug || undefined,
        aiContext: contextToSend || undefined,
      };
      
      // Include image data if present
      if (currentImageDataUrl && currentImageFile) {
        requestBody.imageDataUrl = currentImageDataUrl;
        requestBody.imageName = currentImageFile.name;
        requestBody.imageMimeType = currentImageFile.type || "image/png";
      }

      // PART 7: Update debug info with sentPayloadPreview
      if (debug) {
        setDebugInfo(prev => ({
          ...prev,
          sentPayloadPreview: {
            hasAiContext: Boolean(contextToSend),
            selectedGameName: (contextToSend as Record<string, unknown>)?.selectedGame || null,
            trackedActions: ((contextToSend as Record<string, Record<string, number>>)?.trackerStats)?.trackedActions || 0,
            uniquePlayers: ((contextToSend as Record<string, Record<string, number>>)?.trackerStats)?.uniquePlayers || 0,
            purchases: ((contextToSend as Record<string, Record<string, number>>)?.monetizationStats)?.purchases || 0,
            estimatedRevenue: ((contextToSend as Record<string, Record<string, number>>)?.monetizationStats)?.estimatedRevenue || 0,
            visits: ((contextToSend as Record<string, Record<string, number>>)?.robloxStats)?.visits || 0,
          },
          lastRequest: {
            hasImage: Boolean(currentImageDataUrl),
            conversationId,
            messageLength: text.length,
            aiContextSent: Boolean(contextToSend),
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

        // Update conversation ID if the API created a new one
        if (data.conversationId && data.conversationId !== activeConversationId) {
          setActiveConversationId(data.conversationId);
        }

        // Capture debug context from response
        if (debug && data.debugContext) {
          setDebugInfo(prev => ({
            ...prev,
            apiDebugContext: data.debugContext,
          }));
        }
        
        // Capture OpenAI debug info from response (always present, not just in debug mode)
        if (data.openai) {
          setDebugInfo(prev => ({
            ...prev,
            openaiDebug: data.openai,
            fallbackUsed: data.fallbackUsed,
            fallbackReason: data.fallbackReason,
          }));
        }

        // Update credits
        refreshCredits();
        window.dispatchEvent(new CustomEvent("credits-updated"));
        
        // Refresh conversations list to show new/updated conversation
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
  }, [input, imagePreview, isLoading, activeConversationId, selectedImage, debug, refreshCredits, aiContext, analyticsLoaded]);

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
            ) : conversationsError ? (
              <div className="text-center py-4 px-2">
                <p className="text-xs text-muted-foreground">
                  {conversationsError === "Not authenticated" 
                    ? "Sign in to save conversations" 
                    : conversationsError}
                </p>
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
            {/* PART 1: Show loading state while analytics loads */}
            {aiContextLoading && (
              <span className="text-xs text-muted-foreground animate-pulse">Loading game context...</span>
            )}
            {quickPrompts.map((prompt) => (
              <button
                key={prompt.text}
                onClick={() => handleSend(prompt.text)}
                disabled={isLoading || aiContextLoading}
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
                    className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
                  >
                    <div
                      className={`max-w-[80%] rounded-2xl px-4 py-3 ${
                        message.role === "user"
                          ? "bg-primary text-primary-foreground"
                          : message.role === "error"
                          ? "bg-destructive/10 text-destructive border border-destructive/20"
                          : "bg-secondary/50 text-foreground"
                      }`}
                    >
                      {message.role === "error" ? (
                        <div className="flex items-start gap-2">
                          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                          <span>{message.content}</span>
                        </div>
                      ) : message.role === "assistant" ? (
                        <div className="prose prose-sm dark:prose-invert max-w-none">
                          <ReactMarkdown>{message.content}</ReactMarkdown>
                        </div>
                      ) : (
                        <div className="whitespace-pre-wrap">{message.content}</div>
                      )}
                    </div>
                  </div>
                ))}
                {isLoading && (
                  <div className="flex justify-start">
                    <div className="bg-secondary/50 rounded-2xl px-4 py-3">
                      <div className="flex items-center gap-2">
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        <span className="text-muted-foreground">Thinking...</span>
                      </div>
                    </div>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </>
            )}
          </div>

          {/* Input area */}
          <div className="border-t border-border p-4">
            {/* Image preview */}
            {imagePreview && (
              <div className="mb-3 relative inline-block">
                <Image
                  src={imagePreview}
                  alt="Selected"
                  width={120}
                  height={120}
                  className="rounded-lg object-cover border border-border"
                />
                <button
                  onClick={handleRemoveImage}
                  className="absolute -top-2 -right-2 bg-destructive text-destructive-foreground rounded-full p-1 hover:bg-destructive/90 transition-colors"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            )}
            
            <div className="flex gap-2 items-end">
              {/* Image upload button */}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleImageSelect}
                className="hidden"
              />
              <Button
                variant="outline"
                size="icon"
                className="flex-shrink-0"
                onClick={() => fileInputRef.current?.click()}
                disabled={isLoading}
              >
                <ImageIcon className="w-4 h-4" />
              </Button>

              {/* Text input */}
              <Textarea
                placeholder={aiContextLoading ? "Loading game context..." : "Ask about your Roblox game..."}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                className="min-h-[44px] max-h-[200px] resize-none"
                disabled={isLoading || aiContextLoading}
              />

              {/* Send button */}
              <Button
                onClick={() => handleSend()}
                disabled={isLoading || aiContextLoading || (!input.trim() && !imagePreview)}
                className="flex-shrink-0"
              >
                <Send className="w-4 h-4" />
              </Button>
            </div>
            
            {/* Credits info */}
            <p className="text-xs text-muted-foreground mt-2">
              Cost: {creditCost} credit{creditCost !== 1 ? "s" : ""} per message
              {!creditsLoading && ` • ${totalCredits} credits available`}
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
          <Card className="mt-4 p-4 border-yellow-500/30 bg-yellow-500/5">
            <h3 className="font-semibold text-sm mb-2 text-yellow-600">Debug Panel (AI Context)</h3>
            
            {/* PART 7: Key status indicators */}
            <div className="mb-4 p-3 bg-yellow-500/10 rounded-lg border border-yellow-500/30">
              <h4 className="text-xs font-semibold text-yellow-600 mb-2">Status</h4>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div><strong>analyticsLoaded:</strong> {String(analyticsLoaded)}</div>
                <div><strong>analyticsFetchStatus:</strong> {aiContextLoading ? "loading" : aiContextError ? "error" : aiContext ? "success" : "pending"}</div>
                <div><strong>aiContextReady:</strong> {String(aiContextReady)}</div>
                <div><strong>activeConversationId:</strong> {activeConversationId || "none"}</div>
              </div>
            </div>
            
            {/* PART 7: sentPayloadPreview */}
            {debugInfo.sentPayloadPreview && (
              <div className="mb-4 p-3 bg-orange-500/10 rounded-lg border border-orange-500/30">
                <h4 className="text-xs font-semibold text-orange-600 mb-2">Last Sent Payload Preview</h4>
                <pre className="bg-secondary/30 p-2 rounded overflow-auto text-xs">
{JSON.stringify(debugInfo.sentPayloadPreview, null, 2)}
                </pre>
              </div>
            )}
            
            {/* Frontend AI Context (from /api/dashboard/analytics) */}
            <div className="mb-4 p-3 bg-blue-500/10 rounded-lg border border-blue-500/30">
              <h4 className="text-xs font-semibold text-blue-600 mb-2">Frontend aiContext (from /api/dashboard/analytics)</h4>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div><strong>selectedGameName:</strong> {(aiContext?.selectedGame as string) || "N/A"}</div>
                <div><strong>gameId:</strong> {(aiContext?.gameId as string) || "N/A"}</div>
              </div>
              {aiContext && (
                <div className="mt-2">
                  <strong className="text-xs">aiContextPreview:</strong>
                  <pre className="bg-secondary/30 p-2 rounded mt-1 overflow-auto text-xs max-h-60">
{JSON.stringify({
  selectedGame: aiContext.selectedGame,
  gameId: aiContext.gameId,
  trackerStats: aiContext.trackerStats,
  monetizationStats: aiContext.monetizationStats,
  robloxStats: aiContext.robloxStats,
  productStats: {
    totalProducts: (aiContext.productStats as Record<string, unknown>)?.totalProducts,
  },
}, null, 2)}
                  </pre>
                </div>
              )}
            </div>
            
            {/* Conversations Debug */}
            <div className="mb-4 p-3 bg-purple-500/10 rounded-lg border border-purple-500/30">
              <h4 className="text-xs font-semibold text-purple-600 mb-2">Conversations</h4>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div><strong>conversationsCount:</strong> {conversations.length}</div>
                <div><strong>source:</strong> {(debugInfo.conversationsSource as string) || "N/A"}</div>
              </div>
              {conversationsError && <div className="mt-2 text-xs text-red-500"><strong>error:</strong> {conversationsError}</div>}
            </div>
            
            {/* OpenAI Debug - CRITICAL for verifying AI is actually being called */}
            <div className="mb-4 p-3 bg-red-500/10 rounded-lg border border-red-500/30">
              <h4 className="text-xs font-semibold text-red-600 mb-2">OpenAI Debug (from /api/ai/chat response)</h4>
              {debugInfo.openaiDebug ? (
                <>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div><strong>apiKeyPresent:</strong> {String((debugInfo.openaiDebug as Record<string, unknown>).apiKeyPresent)}</div>
                    <div><strong>apiKeyPrefix:</strong> {(debugInfo.openaiDebug as Record<string, unknown>).apiKeyPrefix as string || "N/A"}</div>
                    <div><strong>model:</strong> {(debugInfo.openaiDebug as Record<string, unknown>).model as string || "N/A"}</div>
                    <div><strong>openaiCalled:</strong> <span className={(debugInfo.openaiDebug as Record<string, unknown>).openaiCalled ? "text-green-600 font-bold" : "text-red-600 font-bold"}>{String((debugInfo.openaiDebug as Record<string, unknown>).openaiCalled)}</span></div>
                    <div><strong>responseId:</strong> {(debugInfo.openaiDebug as Record<string, unknown>).responseId as string || "N/A"}</div>
                  </div>
                  <div className="mt-2 text-xs">
                    <strong>usage:</strong>
                    <pre className="bg-secondary/30 p-2 rounded mt-1 overflow-auto">
{JSON.stringify((debugInfo.openaiDebug as Record<string, unknown>).usage, null, 2)}
                    </pre>
                  </div>
                  {debugInfo.fallbackUsed && (
                    <div className="mt-2 text-xs text-red-500">
                      <strong>fallbackUsed:</strong> {String(debugInfo.fallbackUsed)}<br/>
                      <strong>fallbackReason:</strong> {debugInfo.fallbackReason as string || "unknown"}
                    </div>
                  )}
                </>
              ) : (
                <p className="text-xs text-muted-foreground">Send a message to see OpenAI debug info.</p>
              )}
            </div>
            
            {/* API Response Context */}
            {debugInfo.apiDebugContext ? (
              <div className="mb-4 p-3 bg-green-500/10 rounded-lg border border-green-500/30">
                <h4 className="text-xs font-semibold text-green-600 mb-2">lastResponseMetadata (from /api/ai/chat)</h4>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div><strong>Game:</strong> {(debugInfo.apiDebugContext as Record<string, unknown>).selectedGameName as string || "N/A"}</div>
                  <div><strong>Has Data:</strong> {String((debugInfo.apiDebugContext as Record<string, unknown>).hasData)}</div>
                  <div><strong>Source:</strong> {(debugInfo.apiDebugContext as Record<string, unknown>).sourceUsed as string || "N/A"}</div>
                </div>
                <div className="mt-2 text-xs">
                  <strong>promptContextPreview:</strong>
                  <pre className="bg-secondary/30 p-2 rounded mt-1 overflow-auto whitespace-pre-wrap max-h-40">
                    {(debugInfo.apiDebugContext as Record<string, unknown>).promptContextPreview as string || "N/A"}
                  </pre>
                </div>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground p-3 bg-secondary/10 rounded-lg">Send a message to see API response context.</p>
            )}
            <details className="mt-3">
              <summary className="text-xs cursor-pointer text-muted-foreground">Raw Debug Info</summary>
              <pre className="text-xs overflow-auto max-h-40 bg-secondary/30 p-2 rounded mt-1">
                {JSON.stringify({
                  analyticsLoaded,
                  aiContextReady,
                  activeConversationId,
                  conversationCount: conversations.length,
                  messageCount: messages.length,
                  ...debugInfo,
                }, null, 2)}
              </pre>
            </details>
          </Card>
        )}
      </div>

      {/* Buy Credits Modal */}
      <BuyCreditsModal open={showBuyCreditsModal} onOpenChange={setShowBuyCreditsModal} />
    </div>
  );
}

// Export wrapped with error boundary
export default function AIPageClient() {
  return (
    <AIErrorBoundary>
      <AIAssistantContent />
    </AIErrorBoundary>
  );
}
