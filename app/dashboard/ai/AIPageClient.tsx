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
      // Use range=7d to match dashboard default (28d for monetization would be better but keep consistent)
      const res = await fetch("/api/dashboard/analytics?range=7d", { cache: "no-store" });
      const data = await res.json();
      
      if (debug) {
        setDebugInfo(prev => ({
          ...prev,
          analyticsHttpStatus: res.status,
          analyticsResponseKeys: Object.keys(data),
          analyticsRawData: data,
        }));
      }
      
      // The API returns { success: true, data: { ... } }
      const root = data?.data;
      const success = data.success !== false && root;
      
      if (success) {
        // Build aiContext EXACTLY from the dashboard analytics response shape
        // These are the EXACT same fields displayed in Game Performance and Monetization pages
        const context = {
          // Game identity
          selectedGame: root.selectedGameName || root.game?.name || null,
          gameId: root.selectedGameId || root.game?.id || null,
          range: root.range || "7d",
          
          // Roblox Stats - from robloxStats object (same as Roblox Stats section)
          robloxStats: {
            visits: root.robloxStats?.totalVisits || root.robloxStats?.visits || 0,
            ccu: root.robloxStats?.currentPlayers || root.robloxStats?.ccu || 0,
            favorites: root.robloxStats?.favorites || 0,
            likes: root.robloxStats?.likes || 0,
            dislikes: root.robloxStats?.dislikes || 0,
          },
          
          // Tracker Stats - from trackerStats object (same as Game Performance cards)
          trackerStats: {
            trackedActions: root.trackerStats?.totalEvents || 0,
            uniquePlayers: root.trackerStats?.uniquePlayers || 0,
            totalSessions: root.trackerStats?.totalSessions || 0,
            avgSessionSeconds: root.trackerStats?.avgSessionDuration || 0,
            newPlayers: root.trackerStats?.newPlayers || 0,
            purchases: root.trackerStats?.totalPurchases || 0,
          },
          
          // Monetization Stats - from revenueStats object (same as Monetization cards)
          monetizationStats: {
            purchases: root.revenueStats?.totalPurchases || root.trackerStats?.totalPurchases || 0,
            grossRevenue: root.revenueStats?.grossRevenue || root.revenueStats?.totalRevenue || 0,
            estimatedRevenue: root.revenueStats?.estimatedRevenue || 0,
            payingUsers: root.revenueStats?.payingUsers || root.revenueStats?.trackerPayingUsers || 0,
            activeUsers: root.revenueStats?.trackerActiveUsers || root.trackerStats?.uniquePlayers || 0,
            pcr: root.revenueStats?.trackerPcr || root.revenueStats?.conversionRate || 0,
            arppu: root.revenueStats?.estimatedArppu || root.revenueStats?.arppu || 0,
            arpdau: root.revenueStats?.estimatedArpdau || root.revenueStats?.arpdau || 0,
          },
          
          // Product Stats - from productStats or productAnalytics
          productStats: {
            totalProducts: root.productAnalytics?.productsCount || root.productStats?.products?.length || 0,
            topProducts: root.productAnalytics?.topProducts || root.productStats?.products?.slice(0, 5) || [],
          },
          
          // Data health for verification
          dataHealth: root.dataHealth || null,
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
            selectedRange: context.range,
            aiContextBuilt: true,
            // Show exact mapped values for verification
            dashboardStatsPreview: {
              // These should match Game Performance cards exactly
              trackedActions: context.trackerStats.trackedActions,
              uniquePlayers: context.trackerStats.uniquePlayers,
              totalSessions: context.trackerStats.totalSessions,
              avgSessionSeconds: context.trackerStats.avgSessionSeconds,
              newPlayers: context.trackerStats.newPlayers,
              purchases: context.trackerStats.purchases,
              // These should match Monetization cards exactly
              estimatedRevenue: context.monetizationStats.estimatedRevenue,
              payingUsers: context.monetizationStats.payingUsers,
              pcr: context.monetizationStats.pcr,
              arppu: context.monetizationStats.arppu,
              arpdau: context.monetizationStats.arpdau,
              // These should match Roblox Stats exactly
              visits: context.robloxStats.visits,
              ccu: context.robloxStats.ccu,
              favorites: context.robloxStats.favorites,
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
        const res = await fetch("/api/dashboard/analytics?range=7d", { cache: "no-store" });
        const data = await res.json();
        const root = data?.data;
        
        if (root) {
          contextToSend = {
            selectedGame: root.selectedGameName || root.game?.name || null,
            gameId: root.selectedGameId || root.game?.id || null,
            range: root.range || "7d",
            robloxStats: {
              visits: root.robloxStats?.totalVisits || root.robloxStats?.visits || 0,
              ccu: root.robloxStats?.currentPlayers || root.robloxStats?.ccu || 0,
              favorites: root.robloxStats?.favorites || 0,
              likes: root.robloxStats?.likes || 0,
              dislikes: root.robloxStats?.dislikes || 0,
            },
            trackerStats: {
              trackedActions: root.trackerStats?.totalEvents || 0,
              uniquePlayers: root.trackerStats?.uniquePlayers || 0,
              totalSessions: root.trackerStats?.totalSessions || 0,
              avgSessionSeconds: root.trackerStats?.avgSessionDuration || 0,
              newPlayers: root.trackerStats?.newPlayers || 0,
              purchases: root.trackerStats?.totalPurchases || 0,
            },
            monetizationStats: {
              purchases: root.revenueStats?.totalPurchases || root.trackerStats?.totalPurchases || 0,
              grossRevenue: root.revenueStats?.grossRevenue || root.revenueStats?.totalRevenue || 0,
              estimatedRevenue: root.revenueStats?.estimatedRevenue || 0,
              payingUsers: root.revenueStats?.payingUsers || root.revenueStats?.trackerPayingUsers || 0,
              activeUsers: root.revenueStats?.trackerActiveUsers || root.trackerStats?.uniquePlayers || 0,
              pcr: root.revenueStats?.trackerPcr || root.revenueStats?.conversionRate || 0,
              arppu: root.revenueStats?.estimatedArppu || root.revenueStats?.arppu || 0,
              arpdau: root.revenueStats?.estimatedArpdau || root.revenueStats?.arpdau || 0,
            },
            productStats: {
              totalProducts: root.productAnalytics?.productsCount || root.productStats?.products?.length || 0,
              topProducts: root.productAnalytics?.topProducts || root.productStats?.products?.slice(0, 5) || [],
            },
            dataHealth: root.dataHealth || null,
          };
          setAiContext(contextToSend);
          setAnalyticsLoaded(true);
        }
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
                <div><strong>range:</strong> {(aiContext?.range as string) || "N/A"}</div>
              </div>
              {/* Dashboard Stats Preview - MUST MATCH DASHBOARD CARDS */}
              {debugInfo.dashboardStatsPreview && (
                <div className="mt-2 p-2 bg-yellow-500/10 border border-yellow-500/30 rounded">
                  <strong className="text-xs text-yellow-600">Dashboard Stats Preview (should match dashboard cards):</strong>
                  <div className="grid grid-cols-3 gap-1 text-xs mt-1">
                    <div>Tracked: {(debugInfo.dashboardStatsPreview as Record<string, number>).trackedActions?.toLocaleString()}</div>
                    <div>Players: {(debugInfo.dashboardStatsPreview as Record<string, number>).uniquePlayers?.toLocaleString()}</div>
                    <div>Sessions: {(debugInfo.dashboardStatsPreview as Record<string, number>).totalSessions?.toLocaleString()}</div>
                    <div>Purchases: {(debugInfo.dashboardStatsPreview as Record<string, number>).purchases?.toLocaleString()}</div>
                    <div>Est Rev: R${(debugInfo.dashboardStatsPreview as Record<string, number>).estimatedRevenue?.toLocaleString()}</div>
                    <div>Paying: {(debugInfo.dashboardStatsPreview as Record<string, number>).payingUsers?.toLocaleString()}</div>
                    <div>PCR: {((debugInfo.dashboardStatsPreview as Record<string, number>).pcr || 0).toFixed(1)}%</div>
                    <div>ARPPU: R${(debugInfo.dashboardStatsPreview as Record<string, number>).arppu?.toLocaleString()}</div>
                    <div>CCU: {(debugInfo.dashboardStatsPreview as Record<string, number>).ccu?.toLocaleString()}</div>
                    <div>Visits: {(debugInfo.dashboardStatsPreview as Record<string, number>).visits?.toLocaleString()}</div>
                  </div>
                </div>
              )}
              {aiContext && (
                <div className="mt-2">
                  <strong className="text-xs">Full aiContext:</strong>
                  <pre className="bg-secondary/30 p-2 rounded mt-1 overflow-auto text-xs max-h-60">
{JSON.stringify({
  selectedGame: aiContext.selectedGame,
  gameId: aiContext.gameId,
  range: aiContext.range,
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
