"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTheme } from "next-themes";
import {
  Settings,
  User,
  Bell,
  Shield,
  CreditCard,
  Mail,
  Save,
  Check,
  LogOut,
  Sun,
  Moon,
  Gamepad2,
  Link,
  Unlink,
  Loader2,
  AlertCircle,
  CheckCircle,
} from "lucide-react";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { User as SupabaseUser } from "@supabase/supabase-js";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface RobloxProfile {
  roblox_user_id: string | null;
  roblox_username: string | null;
}

function SettingsPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [saved, setSaved] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [user, setUser] = useState<SupabaseUser | null>(null);
  const [username, setUsername] = useState("");
  const [robloxProfile, setRobloxProfile] = useState<RobloxProfile | null>(null);
  const [connectingRoblox, setConnectingRoblox] = useState(false);
  const [robloxError, setRobloxError] = useState<string | null>(null);
  const [robloxSuccess, setRobloxSuccess] = useState(false);
  const [profile, setProfile] = useState({
    name: "",
    email: "",
    robloxUsername: "",
    discordUsername: "",
  });

  const [notifications, setNotifications] = useState({
    emailAlerts: true,
    revenueDrops: true,
    weeklyReports: true,
    newFeatures: false,
  });

  useEffect(() => {
    setMounted(true);
    
    // Check for Roblox OAuth callback parameters
    const robloxStatus = searchParams.get("roblox");
    const error = searchParams.get("error");
    
    if (robloxStatus === "connected") {
      setRobloxSuccess(true);
      // Clear the URL params
      router.replace("/dashboard/settings", { scroll: false });
      setTimeout(() => setRobloxSuccess(false), 5000);
    }
    
    if (error) {
      setRobloxError(decodeURIComponent(error));
      // Clear the URL params
      router.replace("/dashboard/settings", { scroll: false });
      setTimeout(() => setRobloxError(null), 10000);
    }
    
    // Load saved username from localStorage
    const savedUsername = localStorage.getItem("romonetize_username") || "";
    setUsername(savedUsername);

    // Load saved profile data from localStorage
    const savedProfile = localStorage.getItem("romonetize_profile");
    if (savedProfile) {
      try {
        setProfile(JSON.parse(savedProfile));
      } catch {
        // Ignore parse errors
      }
    }

    // Get user from Supabase and fetch Roblox profile
    if (isSupabaseConfigured) {
      const supabase = createClient();
      supabase.auth.getUser().then(({ data: { user } }) => {
        setUser(user);
        if (user) {
          setProfile((prev) => ({
            ...prev,
            name: prev.name || user.user_metadata?.full_name || user.user_metadata?.name || "",
            email: prev.email || user.email || "",
          }));
          
          // Fetch Roblox connection status from profiles table
          supabase
            .from("profiles")
            .select("roblox_user_id, roblox_username")
            .eq("id", user.id)
            .single()
            .then(({ data, error }) => {
              if (!error && data) {
                setRobloxProfile(data);
                if (data.roblox_username) {
                  setProfile((prev) => ({
                    ...prev,
                    robloxUsername: data.roblox_username || prev.robloxUsername,
                  }));
                }
              }
            });
        }
      }).catch((error) => {
        console.error('[v0] Error getting user:', error);
      });
    }
  }, [searchParams, router]);

  const handleSave = () => {
    // Save username to localStorage
    localStorage.setItem("romonetize_username", username);
    // Save profile to localStorage
    localStorage.setItem("romonetize_profile", JSON.stringify(profile));
    
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    
    // Trigger storage event for other components to update
    window.dispatchEvent(new Event("storage"));
  };

  const handleConnectRoblox = () => {
    setConnectingRoblox(true);
    setRobloxError(null);
    // Redirect to Roblox OAuth
    window.location.href = "/api/auth/roblox";
  };

  const handleDisconnectRoblox = async () => {
    if (!user) return;
    
    setConnectingRoblox(true);
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from("profiles")
        .update({
          roblox_user_id: null,
          roblox_username: null,
          roblox_access_token: null,
          roblox_refresh_token: null,
          roblox_token_expires_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", user.id);

      if (error) {
        setRobloxError("Failed to disconnect Roblox account");
      } else {
        setRobloxProfile(null);
        setProfile((prev) => ({ ...prev, robloxUsername: "" }));
        setRobloxSuccess(true);
        setTimeout(() => setRobloxSuccess(false), 3000);
      }
    } catch {
      setRobloxError("An error occurred while disconnecting");
    } finally {
      setConnectingRoblox(false);
    }
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

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground">Settings</h1>
        <p className="text-muted-foreground">Manage your account and preferences</p>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Main settings */}
        <div className="lg:col-span-2 space-y-6">
          {/* Account */}
          <Card className="border-border bg-card">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <User className="w-5 h-5 text-primary" />
                Account
              </CardTitle>
              <CardDescription>Manage your display name and connected accounts</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Display Username</label>
                <Input
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Enter your display name"
                  className="bg-secondary/30"
                />
                <p className="text-xs text-muted-foreground">This name will be shown in the sidebar and dropdown</p>
              </div>
              <div className="grid sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">Roblox Username</label>
                  <Input
                    value={profile.robloxUsername}
                    onChange={(e) => setProfile({ ...profile, robloxUsername: e.target.value })}
                    placeholder="Your Roblox username"
                    className="bg-secondary/30"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-foreground">Discord Username</label>
                  <Input
                    value={profile.discordUsername}
                    onChange={(e) => setProfile({ ...profile, discordUsername: e.target.value })}
                    placeholder="Your Discord username"
                    className="bg-secondary/30"
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Roblox Account */}
          <Card className="border-border bg-card">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Gamepad2 className="w-5 h-5 text-primary" />
                Roblox Account
              </CardTitle>
              <CardDescription>Connect your Roblox account for full platform access</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {robloxError && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>{robloxError}</AlertDescription>
                </Alert>
              )}
              
              {robloxSuccess && (
                <Alert className="border-green-500/50 bg-green-500/10">
                  <CheckCircle className="h-4 w-4 text-green-500" />
                  <AlertDescription className="text-green-700 dark:text-green-400">
                    {robloxProfile?.roblox_user_id 
                      ? "Roblox account connected successfully!" 
                      : "Roblox account disconnected successfully"}
                  </AlertDescription>
                </Alert>
              )}

              <div className="flex items-center justify-between p-3 rounded-lg bg-secondary/30">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                    <Gamepad2 className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <div className="font-medium text-foreground flex items-center gap-2">
                      Roblox
                      {robloxProfile?.roblox_user_id && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-500/10 text-green-600 dark:text-green-400 border border-green-500/20">
                          <Check className="w-3 h-3" />
                          Connected
                        </span>
                      )}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {robloxProfile?.roblox_username 
                        ? `@${robloxProfile.roblox_username}` 
                        : "Connect to sync your games and analytics"}
                    </div>
                  </div>
                </div>
                {robloxProfile?.roblox_user_id ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleDisconnectRoblox}
                    disabled={connectingRoblox}
                    className="gap-2"
                  >
                    {connectingRoblox ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Disconnecting...
                      </>
                    ) : (
                      <>
                        <Unlink className="w-4 h-4" />
                        Disconnect
                      </>
                    )}
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    onClick={handleConnectRoblox}
                    disabled={connectingRoblox}
                    className="gap-2"
                  >
                    {connectingRoblox ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Connecting...
                      </>
                    ) : (
                      <>
                        <Link className="w-4 h-4" />
                        Connect Roblox Account
                      </>
                    )}
                  </Button>
                )}
              </div>
              
              <p className="text-xs text-muted-foreground">
                We&apos;ll request access to your profile and game data to enable analytics and monetization features.
              </p>
            </CardContent>
          </Card>

          {/* Appearance */}
          <Card className="border-border bg-card">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Sun className="w-5 h-5 text-primary" />
                Appearance
              </CardTitle>
              <CardDescription>Customize how RoMonetize looks</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-3">
                <label className="text-sm font-medium text-foreground">Theme</label>
                {mounted && (
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      onClick={() => setTheme("light")}
                      className={`flex flex-col items-center gap-2 p-4 rounded-lg border-2 transition-colors ${
                        theme === "light" 
                          ? "border-primary bg-primary/10" 
                          : "border-border bg-secondary/30 hover:border-primary/50"
                      }`}
                    >
                      <Sun className={`w-6 h-6 ${theme === "light" ? "text-primary" : "text-muted-foreground"}`} />
                      <span className={`text-sm font-medium ${theme === "light" ? "text-primary" : "text-foreground"}`}>Light</span>
                    </button>
                    <button
                      onClick={() => setTheme("dark")}
                      className={`flex flex-col items-center gap-2 p-4 rounded-lg border-2 transition-colors ${
                        theme === "dark" || theme === "system"
                          ? "border-primary bg-primary/10" 
                          : "border-border bg-secondary/30 hover:border-primary/50"
                      }`}
                    >
                      <Moon className={`w-6 h-6 ${theme === "dark" || theme === "system" ? "text-primary" : "text-muted-foreground"}`} />
                      <span className={`text-sm font-medium ${theme === "dark" || theme === "system" ? "text-primary" : "text-foreground"}`}>Dark</span>
                    </button>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Notifications */}
          <Card className="border-border bg-card">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Bell className="w-5 h-5 text-primary" />
                Notifications
              </CardTitle>
              <CardDescription>Configure how you receive alerts</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {[
                { key: "emailAlerts", label: "Email Alerts", description: "Receive alerts via email" },
                { key: "revenueDrops", label: "Revenue Drop Alerts", description: "Get notified when revenue drops significantly" },
                { key: "weeklyReports", label: "Weekly Reports", description: "Receive weekly monetization summaries" },
                { key: "newFeatures", label: "New Features", description: "Be the first to know about new features" },
              ].map((item) => (
                <div key={item.key} className="flex items-center justify-between p-3 rounded-lg bg-secondary/30">
                  <div>
                    <div className="font-medium text-foreground">{item.label}</div>
                    <div className="text-sm text-muted-foreground">{item.description}</div>
                  </div>
                  <button
                    onClick={() => setNotifications({ ...notifications, [item.key]: !notifications[item.key as keyof typeof notifications] })}
                    className={`relative w-11 h-6 rounded-full transition-colors ${
                      notifications[item.key as keyof typeof notifications] ? "bg-primary" : "bg-secondary"
                    }`}
                  >
                    <span
                      className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${
                        notifications[item.key as keyof typeof notifications] ? "left-6" : "left-1"
                      }`}
                    />
                  </button>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Security */}
          <Card className="border-border bg-card">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Shield className="w-5 h-5 text-primary" />
                Security
              </CardTitle>
              <CardDescription>Manage your account security</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between p-3 rounded-lg bg-secondary/30">
                <div>
                  <div className="font-medium text-foreground">Password</div>
                  <div className="text-sm text-muted-foreground">Last changed 30 days ago</div>
                </div>
                <Button variant="outline" size="sm">Change Password</Button>
              </div>
              <div className="flex items-center justify-between p-3 rounded-lg bg-secondary/30">
                <div>
                  <div className="font-medium text-foreground">Two-Factor Authentication</div>
                  <div className="text-sm text-muted-foreground">Add an extra layer of security</div>
                </div>
                <Button variant="outline" size="sm">Enable</Button>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Plan */}
          <Card className="border-border bg-card border-primary/30">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <CreditCard className="w-5 h-5 text-primary" />
                Current Plan
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="p-4 rounded-lg bg-gradient-to-br from-primary/10 to-blue-400/10 border border-primary/20">
                <div className="text-lg font-bold text-foreground">Pro Plan</div>
                <div className="text-sm text-muted-foreground">$19/month</div>
              </div>
              <ul className="space-y-2 text-sm">
                <li className="flex items-center gap-2 text-muted-foreground">
                  <Check className="w-4 h-4 text-green-500" />
                  5 games
                </li>
                <li className="flex items-center gap-2 text-muted-foreground">
                  <Check className="w-4 h-4 text-green-500" />
                  100,000 events/month
                </li>
                <li className="flex items-center gap-2 text-muted-foreground">
                  <Check className="w-4 h-4 text-green-500" />
                  AI Assistant
                </li>
                <li className="flex items-center gap-2 text-muted-foreground">
                  <Check className="w-4 h-4 text-green-500" />
                  Priority support
                </li>
              </ul>
              <Button variant="outline" className="w-full">Upgrade to Studio</Button>
            </CardContent>
          </Card>

          {/* Support */}
          <Card className="border-border bg-card">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Mail className="w-5 h-5 text-primary" />
                Need Help?
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Contact our support team for any questions or issues.
              </p>
              <Button variant="outline" className="w-full">Contact Support</Button>
            </CardContent>
          </Card>

          {/* Logout */}
          <Card className="border-border bg-card border-destructive/30">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <LogOut className="w-5 h-5 text-destructive" />
                Sign Out
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-3">
                Sign out of your account on this device.
              </p>
              <Button 
                variant="destructive" 
                className="w-full"
                onClick={handleLogout}
                disabled={loggingOut}
              >
                {loggingOut ? "Signing out..." : "Sign Out"}
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Save button */}
      <div className="flex justify-end">
        <Button onClick={handleSave} className="gap-2">
          {saved ? (
            <>
              <Check className="w-4 h-4" />
              Saved!
            </>
          ) : (
            <>
              <Save className="w-4 h-4" />
              Save Changes
            </>
          )}
        </Button>
      </div>
    </div>
  );
}

// Loading fallback for Suspense
function SettingsPageLoading() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Settings</h1>
        <p className="text-muted-foreground">Manage your account and preferences</p>
      </div>
      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <div className="h-64 rounded-lg bg-card border border-border animate-pulse" />
          <div className="h-48 rounded-lg bg-card border border-border animate-pulse" />
        </div>
        <div className="space-y-6">
          <div className="h-48 rounded-lg bg-card border border-border animate-pulse" />
          <div className="h-64 rounded-lg bg-card border border-border animate-pulse" />
        </div>
      </div>
    </div>
  );
}

// Main export wrapped in Suspense to handle useSearchParams during prerender
export default function SettingsPage() {
  return (
    <Suspense fallback={<SettingsPageLoading />}>
      <SettingsPageContent />
    </Suspense>
  );
}
