"use client";

import { useState, useEffect } from "react";
import { User, Mail, AtSign, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { User as SupabaseUser } from "@supabase/supabase-js";

interface ProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function ProfileModal({ isOpen, onClose }: ProfileModalProps) {
  const [user, setUser] = useState<SupabaseUser | null>(null);
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!isOpen) return;

    // Load saved data from localStorage
    const savedUsername = localStorage.getItem("romonetize_username") || "";
    setUsername(savedUsername);

    const savedProfile = localStorage.getItem("romonetize_profile");
    if (savedProfile) {
      try {
        const parsed = JSON.parse(savedProfile);
        setDisplayName(parsed.name || "");
        setEmail(parsed.email || "");
      } catch {
        // Ignore parse errors
      }
    }

    // Get user from Supabase
    if (isSupabaseConfigured) {
      const supabase = createClient();
      supabase.auth.getUser().then(({ data: { user } }) => {
        setUser(user);
        if (user) {
          if (!displayName) {
            setDisplayName(user.user_metadata?.full_name || user.user_metadata?.name || "");
          }
          if (!email) {
            setEmail(user.email || "");
          }
        }
      }).catch((error) => {
        console.error('[v0] Error getting user:', error);
      });
    }
  }, [isOpen]);

  const handleSave = () => {
    // Save to localStorage
    localStorage.setItem("romonetize_username", username);
    localStorage.setItem("romonetize_profile", JSON.stringify({
      name: displayName,
      email: email,
    }));

    setSaved(true);
    setTimeout(() => setSaved(false), 1500);

    // Trigger storage event for other components
    window.dispatchEvent(new Event("storage"));
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-background/80 backdrop-blur-sm"
        onClick={onClose}
      />
      
      {/* Modal */}
      <div className="relative bg-card border border-border rounded-xl shadow-xl w-full max-w-md mx-4 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-primary to-blue-400 flex items-center justify-center">
              <User className="w-5 h-5 text-primary-foreground" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-foreground">Your Profile</h2>
              <p className="text-sm text-muted-foreground">View and edit your profile information</p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-secondary/50 transition-colors"
          >
            <X className="w-5 h-5 text-muted-foreground" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground flex items-center gap-2">
              <AtSign className="w-4 h-4 text-primary" />
              Display Username
            </label>
            <Input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Enter your username"
              className="bg-secondary/30"
            />
            <p className="text-xs text-muted-foreground">This is shown in the sidebar and menus</p>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground flex items-center gap-2">
              <User className="w-4 h-4 text-primary" />
              Full Name
            </label>
            <Input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Your full name"
              className="bg-secondary/30"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground flex items-center gap-2">
              <Mail className="w-4 h-4 text-primary" />
              Email Address
            </label>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="your@email.com"
              className="bg-secondary/30"
              disabled={!!user?.email}
            />
            {user?.email && (
              <p className="text-xs text-muted-foreground">Email is managed by your authentication provider</p>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 p-6 border-t border-border bg-secondary/20">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSave}>
            {saved ? "Saved!" : "Save Changes"}
          </Button>
        </div>
      </div>
    </div>
  );
}
