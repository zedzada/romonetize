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
  };
  popular?: boolean;
}

export const PRICING_PLANS: PricingPlan[] = [
  {
    id: "free",
    name: "Free",
    description: "Get started with basic analytics",
    priceInCents: 0,
    yearlyPriceInCents: 0,
    features: [
      "1 connected game",
      "Basic live analytics",
      "24-hour data history",
      "Basic monetization overview",
    ],
    limits: {
      games: 1,
      eventsPerMonth: 1000,
      teamMembers: 1,
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
      "30-day analytics history",
      "Revenue analytics",
      "Product performance analytics",
      "Live events feed",
      "AI insights",
    ],
    limits: {
      games: 5,
      eventsPerMonth: 100000,
      teamMembers: 3,
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
      "Unlimited analytics history",
      "Advanced monetization analytics",
      "Multi-game dashboard",
      "Priority support",
      "Data export",
    ],
    limits: {
      games: 25,
      eventsPerMonth: 1000000,
      teamMembers: 10,
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
