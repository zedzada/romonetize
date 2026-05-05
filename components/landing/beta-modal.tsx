"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { X, CheckCircle2, Loader2 } from "lucide-react";

interface BetaModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function BetaModal({ isOpen, onClose }: BetaModalProps) {
  const [email, setEmail] = useState("");
  const [robloxUsername, setRobloxUsername] = useState("");
  const [discordUsername, setDiscordUsername] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    
    // Simulate API call
    await new Promise((resolve) => setTimeout(resolve, 1500));
    
    setIsSubmitting(false);
    setIsSuccess(true);
  };

  const handleClose = () => {
    onClose();
    // Reset form after close animation
    setTimeout(() => {
      setEmail("");
      setRobloxUsername("");
      setDiscordUsername("");
      setIsSuccess(false);
    }, 300);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-background/80 backdrop-blur-sm animate-in fade-in duration-200"
        onClick={handleClose}
      />
      
      {/* Modal */}
      <div className="relative w-full max-w-md mx-4 bg-card border border-border rounded-2xl shadow-2xl shadow-primary/10 animate-in zoom-in-95 fade-in duration-200">
        {/* Close button */}
        <button
          onClick={handleClose}
          className="absolute top-4 right-4 p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="p-8">
          {!isSuccess ? (
            <>
              {/* Header */}
              <div className="text-center mb-8">
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-primary to-blue-400 flex items-center justify-center mx-auto mb-4">
                  <span className="text-lg font-bold text-white">R</span>
                </div>
                <h2 className="text-2xl font-bold text-foreground mb-2">
                  Join RoMonetize Beta
                </h2>
                <p className="text-sm text-muted-foreground">
                  Get early access to powerful Roblox analytics
                </p>
              </div>

              {/* Form */}
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label htmlFor="email" className="block text-sm font-medium text-foreground mb-2">
                    Email
                  </label>
                  <input
                    id="email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    className="w-full h-11 px-4 rounded-lg bg-secondary border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all"
                  />
                </div>

                <div>
                  <label htmlFor="roblox" className="block text-sm font-medium text-foreground mb-2">
                    Roblox Username
                  </label>
                  <input
                    id="roblox"
                    type="text"
                    required
                    value={robloxUsername}
                    onChange={(e) => setRobloxUsername(e.target.value)}
                    placeholder="Your Roblox username"
                    className="w-full h-11 px-4 rounded-lg bg-secondary border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all"
                  />
                </div>

                <div>
                  <label htmlFor="discord" className="block text-sm font-medium text-foreground mb-2">
                    Discord Username
                  </label>
                  <input
                    id="discord"
                    type="text"
                    required
                    value={discordUsername}
                    onChange={(e) => setDiscordUsername(e.target.value)}
                    placeholder="username#0000 or @username"
                    className="w-full h-11 px-4 rounded-lg bg-secondary border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all"
                  />
                </div>

                <Button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full h-12 text-base font-semibold bg-primary hover:bg-primary/90 text-primary-foreground transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-70 disabled:cursor-not-allowed disabled:hover:scale-100"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Submitting...
                    </>
                  ) : (
                    "Request Access"
                  )}
                </Button>
              </form>

              <p className="text-xs text-muted-foreground text-center mt-4">
                By signing up, you agree to receive updates about RoMonetize.
              </p>
            </>
          ) : (
            /* Success state */
            <div className="text-center py-8">
              <div className="w-16 h-16 rounded-full bg-green-500/20 flex items-center justify-center mx-auto mb-6">
                <CheckCircle2 className="w-8 h-8 text-green-500" />
              </div>
              <h2 className="text-2xl font-bold text-foreground mb-2">
                You&apos;re on the beta list!
              </h2>
              <p className="text-muted-foreground mb-6">
                We&apos;ll reach out soon with your access details.
              </p>
              <Button
                onClick={handleClose}
                variant="outline"
                className="h-11 px-6 font-semibold border-border hover:bg-secondary transition-all hover:scale-[1.02] active:scale-[0.98]"
              >
                Close
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
