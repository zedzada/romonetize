"use client";

import { Button } from "@/components/ui/button";
import { Menu, X } from "lucide-react";
import { useState, useEffect } from "react";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { User } from "@supabase/supabase-js";
import Link from "next/link";

const navLinks = [
  { label: "Features", href: "#features" },
  { label: "Dashboard", href: "#dashboard" },
  { label: "Pricing", href: "#pricing" },
];

interface HeaderProps {
  onOpenBetaModal: () => void;
}

export function Header({ onOpenBetaModal }: HeaderProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // If Supabase is not configured, just show logged out state
    if (!isSupabaseConfigured) {
      setLoading(false);
      return;
    }

    try {
      const supabase = createClient();
      
      // Get initial user
      supabase.auth.getUser().then(({ data: { user } }) => {
        setUser(user);
        setLoading(false);
      }).catch((error) => {
        console.error('[v0] Error getting user:', error);
        setLoading(false);
      });

      // Listen for auth changes
      const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
        setUser(session?.user ?? null);
      });

      return () => subscription.unsubscribe();
    } catch (error) {
      console.error('[v0] Error initializing Supabase:', error);
      setLoading(false);
    }
  }, []);

  const handleNavClick = (e: React.MouseEvent<HTMLAnchorElement>, href: string) => {
    e.preventDefault();
    const element = document.querySelector(href);
    if (element) {
      element.scrollIntoView({ behavior: "smooth" });
    }
    setMobileMenuOpen(false);
  };

  const handleJoinBeta = () => {
    // If user is logged in, go to dashboard; otherwise open beta modal
    if (user) {
      window.location.href = "/dashboard";
    } else {
      onOpenBetaModal();
    }
    setMobileMenuOpen(false);
  };

  return (
    <header className="fixed top-0 left-0 right-0 z-50 bg-background/80 backdrop-blur-xl border-b border-border/50">
      <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
        {/* Logo */}
        <a href="/" className="flex items-center gap-2 cursor-pointer">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary to-blue-400 flex items-center justify-center">
            <span className="text-sm font-bold text-white">R</span>
          </div>
          <span className="font-semibold text-foreground">RoMonetize</span>
        </a>

        {/* Desktop nav */}
        <nav className="hidden md:flex items-center gap-8">
          {navLinks.map((link) => (
            <a 
              key={link.href} 
              href={link.href}
              onClick={(e) => handleNavClick(e, link.href)}
              className="text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
            >
              {link.label}
            </a>
          ))}
        </nav>

        {/* Desktop CTA */}
        <div className="hidden md:flex items-center gap-4">
          {!loading && user ? (
            <Button 
              asChild
              size="sm" 
              className="bg-primary hover:bg-primary/90 text-primary-foreground cursor-pointer transition-all duration-200 hover:scale-[1.03] hover:shadow-lg hover:shadow-primary/25 active:scale-[0.98]"
            >
              <Link href="/dashboard">Dashboard</Link>
            </Button>
          ) : (
            <Button 
              size="sm" 
              onClick={handleJoinBeta}
              className="bg-primary hover:bg-primary/90 text-primary-foreground cursor-pointer transition-all duration-200 hover:scale-[1.03] hover:shadow-lg hover:shadow-primary/25 active:scale-[0.98]"
            >
              Join Beta
            </Button>
          )}
        </div>

        {/* Mobile menu button */}
        <button 
          className="md:hidden p-2 text-foreground cursor-pointer"
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
        >
          {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      </div>

      {/* Mobile menu */}
      {mobileMenuOpen && (
        <div className="md:hidden bg-background border-b border-border">
          <nav className="flex flex-col px-6 py-4 gap-4">
            {navLinks.map((link) => (
              <a 
                key={link.href} 
                href={link.href}
                onClick={(e) => handleNavClick(e, link.href)}
                className="text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
              >
                {link.label}
              </a>
            ))}
            <div className="flex flex-col gap-2 pt-4 border-t border-border">
              {!loading && user ? (
                <Button 
                  asChild
                  size="sm" 
                  className="bg-primary hover:bg-primary/90 text-primary-foreground cursor-pointer transition-all duration-200 hover:scale-[1.02] hover:shadow-lg hover:shadow-primary/25 active:scale-[0.98]"
                >
                  <Link href="/dashboard" onClick={() => setMobileMenuOpen(false)}>Dashboard</Link>
                </Button>
              ) : (
                <Button 
                  size="sm" 
                  onClick={handleJoinBeta}
                  className="bg-primary hover:bg-primary/90 text-primary-foreground cursor-pointer transition-all duration-200 hover:scale-[1.02] hover:shadow-lg hover:shadow-primary/25 active:scale-[0.98]"
                >
                  Join Beta
                </Button>
              )}
            </div>
          </nav>
        </div>
      )}
    </header>
  );
}
