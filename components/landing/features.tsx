import { 
  BarChart3, 
  Zap, 
  TrendingUp, 
  Bell,
  Sparkles,
  Target
} from "lucide-react";

const features = [
  {
    icon: BarChart3,
    title: "Revenue Analytics",
    description: "Track total Robux earned, average purchase value, and revenue per player across all your games.",
    metric: "See revenue trends"
  },
  {
    icon: Zap,
    title: "Live Activity Tracking",
    description: "Watch player purchases and conversions happen in real-time on your dashboard.",
    metric: "Sub-second latency"
  },
  {
    icon: Target,
    title: "Conversion Tracking",
    description: "Measure conversion rates for every product. Identify which gamepasses drive revenue and which need optimization.",
    metric: "Per-product metrics"
  },
  {
    icon: TrendingUp,
    title: "Trend Analysis",
    description: "Compare this week vs last week. See if your changes are working with clear percentage changes.",
    metric: "7-day comparisons"
  },
  {
    icon: Bell,
    title: "Smart Alerts",
    description: "Get notified when revenue drops, conversions fall, or something breaks in your purchase flow.",
    metric: "Instant notifications"
  },
  {
    icon: Sparkles,
    title: "AI Recommendations",
    description: "Get specific insights like 'VIP Pass converts 3x better than Starter Bundle' based on your real data.",
    metric: "Actionable insights"
  }
];

export function Features() {
  return (
    <section id="features" className="py-32 relative">
      {/* Subtle background gradient */}
      <div className="absolute inset-0 bg-gradient-to-b from-primary/3 via-transparent to-transparent" />
      
      {/* Square grid overlay */}
      <div className="absolute inset-0 bg-square-grid opacity-80" />
      
      <div className="relative z-10 max-w-6xl mx-auto px-6">
        <div className="text-center mb-20">
          <p className="text-primary font-semibold text-sm uppercase tracking-wider mb-4">
            Analytics Built for Roblox
          </p>
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-foreground mb-6 text-balance">
            Everything you need to grow revenue
          </h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Purpose-built analytics for Roblox monetization. Track what matters, fix what&apos;s broken, earn more Robux.
          </p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {features.map((feature) => (
            <div 
              key={feature.title}
              className="group p-6 rounded-2xl bg-card border border-border hover:border-primary/30 transition-all duration-300"
            >
              <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mb-5 group-hover:bg-primary/15 transition-colors">
                <feature.icon className="w-6 h-6 text-primary" />
              </div>
              <h3 className="text-lg font-semibold text-foreground mb-2">
                {feature.title}
              </h3>
              <p className="text-muted-foreground text-sm leading-relaxed mb-4">
                {feature.description}
              </p>
              <div className="text-xs font-medium text-primary/80 uppercase tracking-wide">
                {feature.metric}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
