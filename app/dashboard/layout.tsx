"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { OnboardingTutorial } from "@/components/dashboard/onboarding-tutorial";
import { ProfileModal } from "@/components/dashboard/profile-modal";
import { CreditsWidget } from "@/components/dashboard/credits-widget";
import { GameIcon } from "@/components/dashboard/game-icon";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { User as SupabaseUser } from "@supabase/supabase-js";
import {
  LayoutDashboard,
  Gamepad2,
  BarChart3,
  TrendingUp,
  Package,
  Bot,
  Settings,
  ChevronDown,
  User,
  LogOut,
  Menu,
  X,
  CreditCard,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Toaster } from "@/components/ui/toaster";
import { getUserGames, getSelectedGame, selectGame } from "@/lib/actions/games";

const sidebarItems = [
  { name: "Overview", href: "/dashboard", icon: LayoutDashboard },
  { name: "My Game", href: "/dashboard/game", icon: Gamepad2 },
  { name: "Game Performance", href: "/dashboard/performance", icon: BarChart3 },
  { name: "Monetization", href: "/dashboard/monetization", icon: TrendingUp },
  { name: "Products", href: "/dashboard/products", icon: Package },
  { name: "AI Assistant", href: "/dashboard/ai", icon: Bot },
  { name: "Billing", href: "/dashboard/billing", icon: CreditCard },
  { name: "Settings", href: "/dashboard/settings", icon: Settings },
];

type Game = {
  id: string;
  name: string;
  roblox_game_id: string;
  status: string;
  api_key: string;
  is_selected?: boolean;
  thumbnail_url?: string | null;
};

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [games, setGames] = useState<Game[]>([]);
  const [selectedGame, setSelectedGame] = useState<Game | null>(null);
  const [loadingGames, setLoadingGames] = useState(true);
  const [switchingGame, setSwitchingGame] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [showTutorial, setShowTutorial] = useState(false);
  const [user, setUser] = useState<SupabaseUser | null>(null);
  const [username, setUsername] = useState<string>("");
  const [loggingOut, setLoggingOut] = useState(false);
  const [showProfileModal, setShowProfileModal] = useState(false);

  // Fetch real games from Supabase and get selected game from DB
  useEffect(() => {
    async function fetchGames() {
      setLoadingGames(true);
      
      // Fetch all games and the selected game in parallel
      const [gamesResult, selectedResult] = await Promise.all([
        getUserGames(),
        getSelectedGame(),
      ]);
      
      if (!gamesResult.error && gamesResult.games && gamesResult.games.length > 0) {
        setGames(gamesResult.games);
      }
      
      // Use the selected game from DB (which auto-selects first if needed)
      if (!selectedResult.error && selectedResult.game) {
        setSelectedGame(selectedResult.game);
      }
      
      setLoadingGames(false);
    }
    fetchGames();
  }, []);

  // Handle game switching
  const handleSelectGame = async (game: Game) => {
    if (game.id === selectedGame?.id) return;
    
    setSwitchingGame(true);
    const { success, error } = await selectGame(game.id);
    
    if (success) {
      setSelectedGame(game);
      
      // Dispatch event for analytics hooks to refresh without full page reload
      window.dispatchEvent(new CustomEvent("selected-game-changed", {
        detail: { gameId: game.id, robloxGameId: game.roblox_game_id }
      }));
      
      // Sync Roblox data for the new selected game
      try {
        await fetch("/api/roblox/sync-selected-game", { 
          method: "POST",
          cache: "no-store",
        });
      } catch (syncError) {
        console.error("[v0] Failed to sync Roblox data:", syncError);
      }
      
      // Refresh the current page to load new data
      router.refresh();
    } else {
      console.error("[v0] Failed to select game:", error);
    }
    
    setSwitchingGame(false);
  };

  useEffect(() => {
    // Load username from localStorage
    const loadUsername = () => {
      const savedUsername = localStorage.getItem("romonetize_username");
      setUsername(savedUsername || "");
    };
    
    loadUsername();

    // Listen for storage changes (when username is updated in settings)
    const handleStorageChange = () => {
      loadUsername();
    };
    
    window.addEventListener("storage", handleStorageChange);

    // Check if this is the first visit
    const hasSeenTutorial = localStorage.getItem("romonetize_tutorial_completed");
    if (!hasSeenTutorial) {
      const timer = setTimeout(() => setShowTutorial(true), 500);
      return () => {
        clearTimeout(timer);
        window.removeEventListener("storage", handleStorageChange);
      };
    }
    
    return () => {
      window.removeEventListener("storage", handleStorageChange);
    };
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured) return;

    const supabase = createClient();
    
    supabase.auth.getUser().then(({ data: { user } }) => {
      setUser(user);
    }).catch((error) => {
      console.error('[v0] Error getting user:', error);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  const handleTutorialComplete = () => {
    setShowTutorial(false);
    localStorage.setItem("romonetize_tutorial_completed", "true");
  };

  const handleLogout = async () => {
    setLoggingOut(true);
    try {
      if (isSupabaseConfigured) {
        const supabase = createClient();
        await supabase.auth.signOut();
      }
      router.push("/");
      router.refresh();
    } catch (error) {
      console.error('[v0] Logout error:', error);
      router.push("/");
      router.refresh();
    }
  };

  // Get display name: username > user metadata name > email prefix > "User"
  const getDisplayName = () => {
    if (username) return username;
    if (user?.user_metadata?.full_name) return user.user_metadata.full_name;
    if (user?.user_metadata?.name) return user.user_metadata.name;
    if (user?.email) return user.email.split("@")[0];
    return "User";
  };

  const getInitials = () => {
    const name = getDisplayName();
    return name.slice(0, 2).toUpperCase();
  };

  const getUserEmail = () => {
    return user?.email || "user@example.com";
  };

  return (
    <div className="h-screen bg-background flex overflow-hidden">
      {/* Desktop Sidebar - Fixed, never scrolls */}
      <aside className="hidden md:flex w-64 h-screen flex-col border-r border-border bg-sidebar sticky top-0 overflow-hidden">
        {/* Logo */}
        <div className="p-6 border-b border-border shrink-0">
          <Link href="/" className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary to-blue-400 flex items-center justify-center">
              <span className="text-sm font-bold text-primary-foreground">R</span>
            </div>
            <span className="text-lg font-bold text-foreground">RoMonetize</span>
          </Link>
        </div>

        {/* Navigation - can scroll internally if needed */}
        <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
          {sidebarItems.map((item) => {
            const isActive = pathname === item.href || (item.href !== "/dashboard" && pathname.startsWith(item.href));
            return (
              <Link
                key={item.name}
                href={item.href}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"
                }`}
              >
                <item.icon className="w-5 h-5" />
                {item.name}
              </Link>
            );
          })}
        </nav>

        {/* Bottom section - always visible */}
        <div className="shrink-0">
          {/* AI Credits Widget */}
          <CreditsWidget />

          {/* User section */}
          <div className="p-4 border-t border-border">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex items-center gap-3 w-full p-2 rounded-lg hover:bg-secondary/50 transition-colors">
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary to-blue-400 flex items-center justify-center">
                  <span className="text-xs font-bold text-primary-foreground">{getInitials()}</span>
                </div>
                <div className="flex-1 text-left">
                  <div className="text-sm font-medium text-foreground truncate max-w-[140px]">{getDisplayName()}</div>
                  <div className="text-xs text-muted-foreground">Pro Plan</div>
                </div>
                <ChevronDown className="w-4 h-4 text-muted-foreground" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem 
                className="cursor-pointer"
                onClick={() => setShowProfileModal(true)}
              >
                <User className="w-4 h-4 mr-2" />
                Profile
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href="/dashboard/settings">
                  <Settings className="w-4 h-4 mr-2" />
                  Settings
                </Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem 
                className="text-destructive cursor-pointer"
                onClick={handleLogout}
                disabled={loggingOut}
              >
                <LogOut className="w-4 h-4 mr-2" />
                {loggingOut ? "Signing out..." : "Log out"}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        </div>
      </aside>

      {/* Main content area */}
      <div className="flex-1 flex flex-col h-screen overflow-hidden">
        {/* Top bar */}
        <header className="h-16 shrink-0 border-b border-border bg-background/95 backdrop-blur-sm flex items-center justify-between px-4 md:px-6">
          {/* Mobile menu button */}
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="md:hidden p-2 rounded-lg hover:bg-secondary/50"
          >
            {mobileMenuOpen ? (
              <X className="w-5 h-5 text-foreground" />
            ) : (
              <Menu className="w-5 h-5 text-foreground" />
            )}
          </button>

          {/* Logo for mobile */}
          <Link href="/" className="md:hidden flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-primary to-blue-400 flex items-center justify-center">
              <span className="text-xs font-bold text-primary-foreground">R</span>
            </div>
          </Link>

          {/* Game selector */}
          {loadingGames ? (
            <Button variant="outline" className="gap-2 hidden md:flex" disabled>
              <Gamepad2 className="w-4 h-4" />
              Loading...
            </Button>
          ) : games.length === 0 ? (
            <Button 
              variant="outline" 
              className="gap-2 hidden md:flex"
              onClick={() => router.push("/dashboard/game")}
            >
              <Gamepad2 className="w-4 h-4" />
              Connect a game
            </Button>
          ) : (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="gap-2 hidden md:flex" disabled={switchingGame}>
                  {selectedGame ? (
                    <GameIcon 
                      name={selectedGame.name} 
                      thumbnailUrl={selectedGame.thumbnail_url}
                      robloxGameId={selectedGame.roblox_game_id}
                      size="sm" 
                      className="w-5 h-5"
                    />
                  ) : (
                    <Gamepad2 className="w-4 h-4" />
                  )}
                  {switchingGame ? "Switching..." : (selectedGame?.name || "Select game")}
                  {selectedGame?.status === "active" && !switchingGame && (
                    <span className="w-2 h-2 rounded-full bg-green-500" />
                  )}
                  <ChevronDown className="w-4 h-4 ml-1" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-64">
                {games.map((game) => (
                  <DropdownMenuItem
                    key={game.id}
                    onClick={() => handleSelectGame(game)}
                    className="flex justify-between"
                  >
                    <div className="flex items-center gap-2">
                      <GameIcon 
                        name={game.name} 
                        thumbnailUrl={game.thumbnail_url}
                        robloxGameId={game.roblox_game_id}
                        size="sm" 
                        className="w-5 h-5"
                      />
                      {game.id === selectedGame?.id && (
                        <span className="w-1.5 h-1.5 rounded-full bg-primary" />
                      )}
                      <span className={game.id === selectedGame?.id ? "font-medium" : ""}>{game.name}</span>
                    </div>
                    <span className={`text-xs ${game.status === "active" ? "text-green-500" : "text-muted-foreground"}`}>
                      {game.status}
                    </span>
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => router.push("/dashboard/game")}>
                  <span className="text-primary">+ Add new game</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {/* Right side - User profile */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex items-center gap-2 p-1.5 rounded-full hover:bg-secondary/50 transition-colors">
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary to-blue-400 flex items-center justify-center">
                  <span className="text-xs font-bold text-primary-foreground">{getInitials()}</span>
                </div>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <div className="px-2 py-1.5">
                <div className="text-sm font-medium truncate">{getDisplayName()}</div>
                <div className="text-xs text-muted-foreground truncate">{getUserEmail()}</div>
              </div>
              <DropdownMenuSeparator />
              <DropdownMenuItem 
                className="cursor-pointer"
                onClick={() => setShowProfileModal(true)}
              >
                <User className="w-4 h-4 mr-2" />
                Profile
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href="/dashboard/settings">
                  <Settings className="w-4 h-4 mr-2" />
                  Settings
                </Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem 
                className="text-destructive cursor-pointer"
                onClick={handleLogout}
                disabled={loggingOut}
              >
                <LogOut className="w-4 h-4 mr-2" />
                {loggingOut ? "Signing out..." : "Log out"}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>

        {/* Mobile sidebar */}
        {mobileMenuOpen && (
          <div className="md:hidden fixed inset-0 z-50 bg-background/80 backdrop-blur-sm">
            <aside className="w-64 h-full bg-sidebar border-r border-border">
              <div className="p-6 border-b border-border flex items-center justify-between">
                <Link href="/" className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary to-blue-400 flex items-center justify-center">
                    <span className="text-sm font-bold text-primary-foreground">R</span>
                  </div>
                  <span className="text-lg font-bold text-foreground">RoMonetize</span>
                </Link>
                <button onClick={() => setMobileMenuOpen(false)}>
                  <X className="w-5 h-5 text-muted-foreground" />
                </button>
              </div>
              <nav className="p-4 space-y-1">
                {sidebarItems.map((item) => {
                  const isActive = pathname === item.href;
                  return (
                    <Link
                      key={item.name}
                      href={item.href}
                      onClick={() => setMobileMenuOpen(false)}
                      className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                        isActive
                          ? "bg-primary/10 text-primary"
                          : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"
                      }`}
                    >
                      <item.icon className="w-5 h-5" />
                      {item.name}
                    </Link>
                  );
                })}
              </nav>
            </aside>
          </div>
        )}

        {/* Page content */}
        <main className="flex-1 overflow-auto p-4 md:p-6 relative">
          {/* Subtle dashboard grid background */}
          <div className="absolute inset-0 bg-dashboard-grid pointer-events-none" />
          <div className="relative z-10">
            {children}
          </div>
        </main>
      </div>

      {/* Onboarding Tutorial */}
      {showTutorial && (
        <OnboardingTutorial onComplete={handleTutorialComplete} />
      )}

      {/* Profile Modal */}
      <ProfileModal 
        isOpen={showProfileModal} 
        onClose={() => setShowProfileModal(false)} 
      />

      {/* Toast notifications */}
      <Toaster />
    </div>
  );
}
