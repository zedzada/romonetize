"use client";

import { 
  DollarSign, 
  TrendingUp, 
  ShoppingCart, 
  Eye, 
  Gamepad2,
  Sparkles,
  RefreshCw,
} from "lucide-react";
import { formatNumber } from "@/lib/utils";

// Mock data matching real dashboard structure
const mockStats = {
  totalGames: 3,
  totalActions: 847293,
  totalRevenue: 2847500,
  totalPurchases: 45234,
  totalProducts: 12,
};

const mockRecentEvents = [
  { id: "1", event_type: "purchase_success", product_name: "VIP Pass", robux: 499, game_name: "Tower Defense", created_at: "2 min ago" },
  { id: "2", event_type: "player_join", product_name: null, robux: 0, game_name: "Tower Defense", created_at: "3 min ago" },
  { id: "3", event_type: "shop_open", product_name: "2x Cash", robux: 0, game_name: "Pet Simulator", created_at: "5 min ago" },
  { id: "4", event_type: "purchase_success", product_name: "Starter Pack", robux: 199, game_name: "Tower Defense", created_at: "8 min ago" },
  { id: "5", event_type: "session_start", product_name: null, robux: 0, game_name: "Pet Simulator", created_at: "12 min ago" },
];

const mockTopProducts = [
  { id: "1", name: "VIP Pass", product_type: "gamepass", total_revenue: 840500, total_purchases: 1682 },
  { id: "2", name: "2x Cash Boost", product_type: "gamepass", total_revenue: 620200, total_purchases: 3101 },
  { id: "3", name: "Lucky Crate", product_type: "devproduct", total_revenue: 510800, total_purchases: 8526 },
  { id: "4", name: "Speed Boost", product_type: "gamepass", total_revenue: 420100, total_purchases: 2101 },
];

const formatEventType = (type: string) => {
  return type.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase());
};

export function DashboardPreview() {
  return (
    <section id="dashboard" className="py-32 relative">
      {/* Background gradient */}
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-primary/3 to-transparent" />
      
      {/* Square grid overlay */}
      <div className="absolute inset-0 bg-square-grid opacity-50" />
      
      <div className="relative z-10 max-w-6xl mx-auto px-6">
        <div className="text-center mb-16">
          <p className="text-primary font-semibold text-sm uppercase tracking-wider mb-4">
            The Dashboard
          </p>
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-foreground mb-6 text-balance">
            Your revenue command center
          </h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Everything you need to track, analyze, and optimize your Roblox monetization in one place.
          </p>
        </div>

        {/* Dashboard mockup */}
        <div className="relative rounded-xl border border-border bg-card/30 backdrop-blur-sm p-1 shadow-2xl shadow-primary/5">
          {/* Browser chrome */}
          <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
            <div className="flex gap-1.5">
              <div className="w-3 h-3 rounded-full bg-red-500/80" />
              <div className="w-3 h-3 rounded-full bg-yellow-500/80" />
              <div className="w-3 h-3 rounded-full bg-green-500/80" />
            </div>
            <div className="flex-1 flex justify-center">
              <div className="px-4 py-1 rounded-md bg-secondary text-xs text-muted-foreground">
                dashboard.romonetize.com
              </div>
            </div>
          </div>

          {/* Dashboard content - matching real app */}
          <div className="p-6 space-y-6">
            {/* Page header - matching real dashboard */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <h1 className="text-2xl font-bold text-foreground">Overview</h1>
                <p className="text-muted-foreground text-sm">
                  Track your Roblox game monetization performance
                  <span className="text-xs ml-2 text-muted-foreground/60">
                    Last updated: 2:34:12 PM
                  </span>
                </p>
              </div>
              <div className="flex gap-2">
                <button className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-md border border-border bg-card hover:bg-secondary/50 transition-colors">
                  <RefreshCw className="w-4 h-4" />
                  Refresh Data
                </button>
              </div>
            </div>

            {/* Stats cards - matching real dashboard 5-column layout */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              {/* Connected Games */}
              <div className="rounded-lg border border-border bg-card p-4">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                    <Gamepad2 className="w-4 h-4 text-primary" />
                  </div>
                </div>
                <div className="text-2xl font-bold text-foreground">{mockStats.totalGames}</div>
                <div className="text-xs text-muted-foreground">Connected Games</div>
              </div>

              {/* Tracked Actions */}
              <div className="rounded-lg border border-border bg-card p-4">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center">
                    <TrendingUp className="w-4 h-4 text-blue-500" />
                  </div>
                </div>
                <div className="text-2xl font-bold text-foreground">{formatNumber(mockStats.totalActions)}</div>
                <div className="text-xs text-muted-foreground">Tracked Actions</div>
              </div>

              {/* Total Revenue */}
              <div className="rounded-lg border border-border bg-card p-4">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-8 h-8 rounded-lg bg-green-500/10 flex items-center justify-center">
                    <DollarSign className="w-4 h-4 text-green-500" />
                  </div>
                </div>
                <div className="text-2xl font-bold text-foreground flex items-center gap-1">
                  <span className="text-primary">R$</span>
{formatNumber(mockStats.totalRevenue)}
                </div>
                <div className="text-xs text-muted-foreground">Total Revenue</div>
              </div>

              {/* Total Purchases */}
              <div className="rounded-lg border border-border bg-card p-4">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-8 h-8 rounded-lg bg-pink-500/10 flex items-center justify-center">
                    <ShoppingCart className="w-4 h-4 text-pink-500" />
                  </div>
                </div>
                <div className="text-2xl font-bold text-foreground">{formatNumber(mockStats.totalPurchases)}</div>
                <div className="text-xs text-muted-foreground">Total Purchases</div>
              </div>

              {/* Tracked Products */}
              <div className="rounded-lg border border-border bg-card p-4">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-8 h-8 rounded-lg bg-amber-500/10 flex items-center justify-center">
                    <Eye className="w-4 h-4 text-amber-500" />
                  </div>
                </div>
                <div className="text-2xl font-bold text-foreground">{mockStats.totalProducts}</div>
                <div className="text-xs text-muted-foreground">Tracked Products</div>
              </div>
            </div>

            {/* Recent Activity & Top Products - matching real dashboard */}
            <div className="grid md:grid-cols-2 gap-4">
              {/* Recent Activity */}
              <div className="rounded-lg border border-border bg-card">
                <div className="p-4 pb-3">
                  <h3 className="text-base font-semibold text-foreground">Recent Activity</h3>
                  <p className="text-sm text-muted-foreground">Latest player actions from your games</p>
                </div>
                <div className="px-4 pb-4">
                  <div className="space-y-2 max-h-64 overflow-y-auto pr-2">
                    {mockRecentEvents.map((event) => (
                      <div key={event.id} className="flex items-center justify-between p-3 rounded-lg bg-secondary/30">
                        <div>
                          <div className="text-sm font-medium text-foreground">
                            {formatEventType(event.event_type)}
                            {event.product_name && (
                              <span className="text-muted-foreground font-normal"> - {event.product_name}</span>
                            )}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {event.game_name} • {event.created_at}
                          </div>
                        </div>
                        {event.robux > 0 && (
                          <div className="text-sm font-medium text-green-500 flex items-center gap-1">
                            <span className="text-primary text-xs">R$</span>
                            +{event.robux}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Top Products */}
              <div className="rounded-lg border border-border bg-card">
                <div className="p-4 pb-3">
                  <h3 className="text-base font-semibold text-foreground">Top Products</h3>
                  <p className="text-sm text-muted-foreground">Best performing monetization products</p>
                </div>
                <div className="px-4 pb-4">
                  <div className="space-y-2 max-h-64 overflow-y-auto pr-2">
                    {mockTopProducts.map((product) => (
                      <div key={product.id} className="flex items-center justify-between p-3 rounded-lg bg-secondary/30">
                        <div>
                          <div className="text-sm font-medium text-foreground">{product.name}</div>
                          <div className="text-xs text-muted-foreground">
                            {product.product_type} • {formatNumber(product.total_purchases)} sales
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-sm font-medium text-foreground flex items-center gap-1">
                            <span className="text-primary text-xs">R$</span>
                            {formatNumber(product.total_revenue)}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* AI Assistant - matching real dashboard */}
            <div className="rounded-lg border border-border bg-card border-primary/20">
              <div className="p-4 pb-3">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-primary to-blue-400 flex items-center justify-center">
                    <Sparkles className="w-3 h-3 text-primary-foreground" />
                  </div>
                  <h3 className="text-base font-semibold text-foreground">AI Assistant</h3>
                </div>
                <p className="text-sm text-muted-foreground mt-1">Ask questions about your monetization data</p>
              </div>
              <div className="px-4 pb-4 space-y-4">
                {/* Example questions */}
                <div className="flex flex-wrap gap-2">
                  {[
                    "Why are players not buying?",
                    "Which product should I improve?",
                    "Where am I losing Robux?",
                  ].map((question) => (
                    <button
                      key={question}
                      className="px-3 py-1.5 text-xs font-medium rounded-md border border-border bg-card hover:bg-secondary/50 transition-colors"
                    >
                      {question}
                    </button>
                  ))}
                </div>

                {/* AI Response */}
                <div className="p-4 rounded-lg bg-gradient-to-br from-primary/5 to-blue-400/5 border border-primary/20">
                  <div className="flex items-start gap-3">
                    <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-primary to-blue-400 flex items-center justify-center shrink-0 mt-0.5">
                      <Sparkles className="w-3 h-3 text-primary-foreground" />
                    </div>
                    <p className="text-sm text-foreground">
                      I&apos;m analyzing {formatNumber(mockStats.totalActions)} player actions across {mockStats.totalGames} games. Your total revenue is {formatNumber(mockStats.totalRevenue)} Robux with {mockStats.totalProducts} tracked products. Ask me anything!
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
