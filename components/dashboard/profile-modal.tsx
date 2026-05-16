"use client";

import { useState, useEffect } from "react";
import { User, Mail, AtSign, X, CreditCard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { User as SupabaseUser } from "@supabase/supabase-js";

interface ProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface ProfileData {
  plan: string;
  email: string | null;
  display_username: string | null;
}

export function ProfileModal({ isOpen, onClose }: ProfileModalProps) {
  const [user, setUser] = useState<SupabaseUser | null>(null);
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isOpen) return;

    setLoading(true);

    // Get user from Supabase and fetch profile
    if (isSupabaseConfigured) {
      const supabase = createClient();
      supabase.auth.getUser().then(async ({ data: { user } }) => {
        setUser(user);
        if (user) {
          // Fetch profile from Supabase (single source of truth)
          const { data: profileData } = await supabase
            .from("profiles")
            .select("plan, email, display_username")
            .eq("id", user.id)
            .single();

          if (profileData) {
            setProfile(profileData);
            setEmail(profileData.email || user.email || "");
            // Use custom display_username if set, otherwise fallback to OAuth metadata
            setDisplayName(profileData.display_username || user.user_metadata?.full_name || user.user_metadata?.name || "");
          } else {
            // Profile doesn't exist - create one
            const newProfile = {
              id: user.id,
              email: user.email,
              plan: "free",
            };
            await supabase.from("profiles").insert(newProfile);
            setProfile({ plan: "free", email: user.email || null, display_username: null });
            setEmail(user.email || "");
            // Use user metadata for display name
            setDisplayName(user.user_metadata?.full_name || user.user_metadata?.name || "");
          }
        }
        setLoading(false);
      }).catch((error) => {
        console.error('[v0] Error getting user:', error);
        setLoading(false);
      });
    } else {
      setLoading(false);
    }
  }, [isOpen]);

  // Get display name following the priority order
  const getDisplayName = () => {
    if (displayName) return displayName;
    if (user?.user_metadata?.name) return user.user_metadata.name;
    if (user?.user_metadata?.full_name) return user.user_metadata.full_name;
    if (email) return email.split("@")[0];
    return "User";
  };

  // Get plan display
  const getPlanDisplay = () => {
    const plan = profile?.plan || "free";
    switch (plan) {
      case "pro": return "Pro Plan";
      case "studio": return "Studio Plan";
      default: return "Free Plan";
    }
  };

  const handleSave = () => {
    // Note: We don't save anything in this modal since profile is managed via auth
    // and plan is managed via billing. This is just a display modal.
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
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
          {loading ? (
            <div className="py-8 flex items-center justify-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
          ) : (
            <>
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground flex items-center gap-2">
                  <User className="w-4 h-4 text-primary" />
                  Display Name
                </label>
                <div className="px-3 py-2 rounded-lg bg-secondary/30 border border-border text-foreground">
                  {getDisplayName()}
                </div>
                <p className="text-xs text-muted-foreground">Name from your authentication provider</p>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground flex items-center gap-2">
                  <Mail className="w-4 h-4 text-primary" />
                  Email Address
                </label>
                <div className="px-3 py-2 rounded-lg bg-secondary/30 border border-border text-foreground">
                  {email || "Not provided"}
                </div>
                <p className="text-xs text-muted-foreground">Email is managed by your authentication provider</p>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground flex items-center gap-2">
                  <CreditCard className="w-4 h-4 text-primary" />
                  Current Plan
                </label>
                <div className="px-3 py-2 rounded-lg bg-secondary/30 border border-border text-foreground flex items-center justify-between">
                  <span>{getPlanDisplay()}</span>
                  {profile?.plan === "free" && (
                    <a href="/dashboard/billing" className="text-xs text-primary hover:underline">
                      Upgrade
                    </a>
                  )}
                </div>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 p-6 border-t border-border bg-secondary/20">
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}
