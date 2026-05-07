export interface PricingPlan {
  id: string;
  name: string;
  description: string;
  priceInCents: number; // monthly price
  yearlyPriceInCents: number; // yearly price (20% discount)
  features: string[];
  limits: {
    games: number;
    eventsPerMonth: number;
    teamMembers: number;
    aiCreditsPerMonth: number;
  };
  popular?: boolean;
}

// AI Credit packages for purchase
export interface CreditPackage {
  id: string;
  credits: number;
  priceInCents: number;
  stripePriceEnvVar: string;
}

export const CREDIT_PACKAGES: CreditPackage[] = [
  {
    id: "credits_100",
    credits: 100,
    priceInCents: 1999, // $19.99
    stripePriceEnvVar: "STRIPE_CREDITS_100_PRICE_ID",
  },
  {
    id: "credits_250",
    credits: 250,
    priceInCents: 4499, // $44.99
    stripePriceEnvVar: "STRIPE_CREDITS_250_PRICE_ID",
  },
  {
    id: "credits_500",
    credits: 500,
    priceInCents: 7499, // $74.99
    stripePriceEnvVar: "STRIPE_CREDITS_500_PRICE_ID",
  },
];

// AI credit costs
export const AI_CREDIT_COSTS = {
  text: 1,      // Text prompt costs 1 credit
  image: 3,     // Image analysis costs 3 credits
  textImage: 3, // Text + image costs 3 credits total (not 4)
};

export const PRICING_PLANS: PricingPlan[] = [
  {
    id: "free",
    name: "Free",
    description: "Get started with basic analytics",
    priceInCents: 0,
    yearlyPriceInCents: 0,
    features: [
      "1 connected game",
      "Unlimited tracked events",
      "Basic live analytics",
      "24-hour data history",
      "AI Assistant (with purchased credits)",
      "0 AI credits/month",
    ],
    limits: {
      games: 1,
      eventsPerMonth: -1, // Unlimited
      teamMembers: 1,
      aiCreditsPerMonth: 0,
    },
  },
  {
    id: "pro",
    name: "Pro",
    description: "For indie developers with growing games",
    priceInCents: 1900, // $19/month
    yearlyPriceInCents: 18240, // $15.20/month billed yearly (20% off)
    features: [
      "Up to 5 connected games",
      "Unlimited tracked events",
      "30-day analytics history",
      "Monetization analytics",
      "Products analytics",
      "AI Assistant included",
      "100 AI credits/month",
    ],
    limits: {
      games: 5,
      eventsPerMonth: -1, // Unlimited
      teamMembers: 3,
      aiCreditsPerMonth: 100,
    },
    popular: true,
  },
  {
    id: "studio",
    name: "Studio",
    description: "For studios managing multiple games",
    priceInCents: 4900, // $49/month
    yearlyPriceInCents: 47040, // $39.20/month billed yearly (20% off)
    features: [
      "Up to 25 connected games",
      "Unlimited tracked events",
      "Unlimited analytics history",
      "Advanced monetization analytics",
      "Products analytics",
      "Priority support",
      "Data export",
      "AI Assistant included",
      "500 AI credits/month",
    ],
    limits: {
      games: 25,
      eventsPerMonth: -1, // Unlimited
      teamMembers: 10,
      aiCreditsPerMonth: 500,
    },
  },
];

export function getPlanById(planId: string): PricingPlan | undefined {
  return PRICING_PLANS.find((plan) => plan.id === planId);
}

export function getPlanLimits(planId: string) {
  const plan = getPlanById(planId);
  return plan?.limits || PRICING_PLANS[0].limits; // Default to free tier
}

export function formatPrice(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

export function getCreditPackageById(packageId: string): CreditPackage | undefined {
  return CREDIT_PACKAGES.find((pkg) => pkg.id === packageId);
}

export function getAiCreditsForPlan(planId: string): number {
  const plan = getPlanById(planId);
  return plan?.limits.aiCreditsPerMonth || 0;
}

// Centralized plan game limits - use this everywhere
export const PLAN_GAME_LIMITS: Record<string, number> = {
  free: 1,
  pro: 5,
  studio: 25,
};

export function getPlanGameLimit(planId: string): number {
  return PLAN_GAME_LIMITS[planId] || 1;
}
