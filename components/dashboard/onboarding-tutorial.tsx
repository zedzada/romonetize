"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  X,
  ArrowRight,
  Sparkles,
  Gamepad2,
  Code,
  MousePointerClick,
  TrendingDown,
  Package,
  Rocket,
} from "lucide-react";
import { Button } from "@/components/ui/button";

interface OnboardingTutorialProps {
  onComplete: () => void;
}

const tutorialSteps = [
  {
    title: "Welcome to RoMonetize",
    description: "Track your Roblox game's revenue, purchases, players, products, and monetization metrics in one dashboard.",
    icon: Sparkles,
    highlight: null,
  },
  {
    title: "Connect your Roblox game",
    description: "Choose one of your Roblox experiences or add your Universe ID. This lets RoMonetize know which game to track.",
    icon: Gamepad2,
    highlight: "/dashboard/game",
  },
  {
    title: "Install the tracker script",
    description: "Paste the RoMonetize script inside ServerScriptService in Roblox Studio. This sends gameplay events, sessions, and purchases to your dashboard.",
    icon: Code,
    highlight: "/dashboard/game",
  },
  {
    title: "Track purchases automatically",
    description: "RoMonetize detects Developer Product and Game Pass purchases so you can see revenue, buyers, ARPPU, ARPDAU, and product performance.",
    icon: MousePointerClick,
    highlight: "/dashboard/monetization",
  },
  {
    title: "Understand your monetization",
    description: "Use PCR, ARPPU, and ARPDAU to see how well your game turns active players into paying users.",
    icon: TrendingDown,
    highlight: "/dashboard/monetization",
  },
  {
    title: "Find your best products",
    description: "Compare purchases, buyers, revenue, and revenue per buyer for each product to see what sells best.",
    icon: Package,
    highlight: "/dashboard/products",
  },
  {
    title: "Optimize your game",
    description: "Refresh your data, watch your metrics, and improve the products that generate the most revenue.",
    icon: Rocket,
    highlight: "/dashboard/performance",
  },
];

export function OnboardingTutorial({ onComplete }: OnboardingTutorialProps) {
  const router = useRouter();
  const [currentStep, setCurrentStep] = useState(0);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    // Animate in after mount
    const timer = setTimeout(() => setIsVisible(true), 100);
    return () => clearTimeout(timer);
  }, []);

  const handleNext = () => {
    if (currentStep < tutorialSteps.length - 1) {
      setCurrentStep(currentStep + 1);
      // Navigate to the highlighted page if exists
      const nextStep = tutorialSteps[currentStep + 1];
      if (nextStep.highlight) {
        router.push(nextStep.highlight);
      }
    }
  };

  const handlePrevious = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
      const prevStep = tutorialSteps[currentStep - 1];
      if (prevStep.highlight) {
        router.push(prevStep.highlight);
      }
    }
  };

  const handleClose = () => {
    setIsVisible(false);
    setTimeout(onComplete, 300);
  };

  const step = tutorialSteps[currentStep];
  const isLastStep = currentStep === tutorialSteps.length - 1;
  const StepIcon = step.icon;

  return (
    <>
      {/* Backdrop */}
      <div 
        className={`fixed inset-0 bg-black/60 backdrop-blur-sm z-50 transition-opacity duration-300 ${
          isVisible ? "opacity-100" : "opacity-0"
        }`}
        onClick={handleClose}
      />

      {/* Modal */}
      <div 
        className={`fixed z-50 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-md transition-all duration-300 ${
          isVisible ? "opacity-100 scale-100" : "opacity-0 scale-95"
        }`}
      >
        <div className="bg-card border border-border rounded-2xl shadow-2xl shadow-black/50 overflow-hidden">
          {/* Header */}
          <div className="relative bg-gradient-to-br from-primary/10 to-blue-400/10 p-6 border-b border-border">
            <button
              onClick={handleClose}
              className="absolute top-4 right-4 p-1.5 rounded-lg hover:bg-secondary/50 transition-colors"
            >
              <X className="w-4 h-4 text-muted-foreground" />
            </button>

            {/* Progress indicator */}
            <div className="flex items-center gap-2 mb-4">
              <span className="text-xs font-medium text-primary">
                Step {currentStep + 1} of {tutorialSteps.length}
              </span>
              <div className="flex-1 h-1 bg-secondary rounded-full overflow-hidden">
                <div 
                  className="h-full bg-gradient-to-r from-primary to-blue-400 transition-all duration-500"
                  style={{ width: `${((currentStep + 1) / tutorialSteps.length) * 100}%` }}
                />
              </div>
            </div>

            {/* Icon */}
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-primary to-blue-400 flex items-center justify-center mb-4 shadow-lg shadow-primary/30">
              <StepIcon className="w-7 h-7 text-primary-foreground" />
            </div>

            {/* Title */}
            <h2 className="text-xl font-bold text-foreground">{step.title}</h2>
          </div>

          {/* Content */}
          <div className="p-6">
            <p className="text-muted-foreground leading-relaxed">{step.description}</p>
          </div>

          {/* Footer */}
          <div className="p-6 pt-0 flex items-center justify-between gap-3">
            <Button
              variant="ghost"
              onClick={handleClose}
              className="text-muted-foreground"
            >
              Skip tutorial
            </Button>

            <div className="flex gap-2">
              {currentStep > 0 && (
                <Button variant="outline" onClick={handlePrevious}>
                  Back
                </Button>
              )}
              
              {isLastStep ? (
                <Button onClick={handleClose} className="gap-2">
                  Finish
                </Button>
              ) : (
                <Button onClick={handleNext} className="gap-2">
                  Continue
                  <ArrowRight className="w-4 h-4" />
                </Button>
              )}
            </div>
          </div>

          {/* Step dots */}
          <div className="pb-6 flex justify-center gap-1.5">
            {tutorialSteps.map((_, index) => (
              <button
                key={index}
                onClick={() => setCurrentStep(index)}
                className={`w-2 h-2 rounded-full transition-all ${
                  index === currentStep
                    ? "bg-primary w-6"
                    : index < currentStep
                    ? "bg-primary/50"
                    : "bg-secondary"
                }`}
              />
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
