import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy - RoMonetize",
  description: "Privacy Policy for RoMonetize analytics platform for Roblox developers.",
};

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card/30">
        <div className="max-w-4xl mx-auto px-6 py-6">
          <Link href="/" className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary to-blue-400 flex items-center justify-center">
              <span className="text-sm font-bold text-white">R</span>
            </div>
            <span className="font-semibold text-foreground">RoMonetize</span>
          </Link>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-4xl mx-auto px-6 py-12">
        <h1 className="text-3xl font-bold text-foreground mb-2">Privacy Policy</h1>
        <p className="text-muted-foreground mb-8">Last updated: January 2026</p>

        <div className="prose prose-neutral dark:prose-invert max-w-none space-y-8">
          <section>
            <h2 className="text-xl font-semibold text-foreground mb-4">1. Information We Collect</h2>
            <p className="text-muted-foreground leading-relaxed mb-4">
              RoMonetize collects information to provide and improve our analytics services. We collect:
            </p>
            <ul className="list-disc list-inside text-muted-foreground space-y-2 ml-4">
              <li>Account information (email address, name)</li>
              <li>Roblox account data (username, user ID, games you manage)</li>
              <li>Game analytics and event data from your Roblox games</li>
              <li>Payment information (processed by Stripe)</li>
              <li>Usage data and interaction with our Service</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-4">2. Roblox Account Data</h2>
            <p className="text-muted-foreground leading-relaxed">
              When you connect your Roblox account via OAuth, we access your public profile information, including 
              your Roblox username, user ID, profile picture, and the games you own or have permission to manage. 
              We store your Roblox user ID to associate your games with your RoMonetize account. We do not access 
              or store your Roblox password. OAuth tokens are securely stored and used only to fetch game data on 
              your behalf.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-4">3. Game Analytics and Tracked Activity</h2>
            <p className="text-muted-foreground leading-relaxed">
              When you integrate RoMonetize tracking into your Roblox games, we collect analytics activity including 
              player sessions, purchases, and other monetization-related data. This data is 
              associated with your game ID and used to generate analytics dashboards and insights. Player data is 
              anonymized and aggregated for analytics purposes.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-4">4. Payment Data</h2>
            <p className="text-muted-foreground leading-relaxed">
              Payment processing is handled by Stripe. We do not store your full credit card number or payment 
              credentials. Stripe may share with us limited information such as the last four digits of your card, 
              card type, and billing address for receipt purposes. Please review Stripe&apos;s Privacy Policy for 
              information on how they handle your payment data.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-4">5. AI Assistant Data</h2>
            <p className="text-muted-foreground leading-relaxed">
              When you use our AI Assistant feature, we process your messages and game analytics data to provide 
              personalized insights and recommendations. Conversations may be logged for quality improvement 
              purposes. We do not share your AI conversations with third parties except as necessary to provide 
              the AI service.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-4">6. Cookies and Session Data</h2>
            <p className="text-muted-foreground leading-relaxed">
              We use cookies and similar technologies to maintain your session, remember your preferences, and 
              improve our Service. Essential cookies are required for the Service to function. You can control 
              cookie settings through your browser, but disabling essential cookies may affect functionality.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-4">7. How We Use Your Information</h2>
            <p className="text-muted-foreground leading-relaxed mb-4">
              We use your information to:
            </p>
            <ul className="list-disc list-inside text-muted-foreground space-y-2 ml-4">
              <li>Provide and maintain the RoMonetize Service</li>
              <li>Process your subscriptions and payments</li>
              <li>Generate analytics dashboards and insights for your games</li>
              <li>Provide AI-powered recommendations</li>
              <li>Send important service updates and notifications</li>
              <li>Improve and develop new features</li>
              <li>Prevent fraud and ensure security</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-4">8. Disconnecting Your Roblox Account</h2>
            <p className="text-muted-foreground leading-relaxed">
              You can disconnect your Roblox account at any time from your RoMonetize account settings. Upon 
              disconnection, we will revoke our OAuth access to your Roblox account. Your historical analytics 
              data will be retained unless you request deletion. You can also revoke access directly from your 
              Roblox account settings under &quot;Authorized Apps&quot;.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-4">9. Data Retention and Deletion</h2>
            <p className="text-muted-foreground leading-relaxed">
              We retain your data for as long as your account is active or as needed to provide services. You may 
              request deletion of your account and associated data by contacting us. Upon deletion request, we will 
              remove your personal data within 30 days, except where retention is required by law or for legitimate 
              business purposes such as fraud prevention.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-4">10. Data Security</h2>
            <p className="text-muted-foreground leading-relaxed">
              We implement industry-standard security measures to protect your data, including encryption in transit 
              and at rest, secure authentication, and regular security audits. However, no method of transmission 
              over the Internet is 100% secure, and we cannot guarantee absolute security.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-4">11. Third-Party Services</h2>
            <p className="text-muted-foreground leading-relaxed">
              We use third-party services to operate RoMonetize, including Stripe for payments, Supabase for data 
              storage, and Vercel for hosting. These providers have their own privacy policies governing their 
              use of your data.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-4">12. Children&apos;s Privacy</h2>
            <p className="text-muted-foreground leading-relaxed">
              RoMonetize is not intended for children under 13. We do not knowingly collect personal information 
              from children under 13. If you believe we have collected information from a child under 13, please 
              contact us immediately.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-4">13. Contact Us</h2>
            <p className="text-muted-foreground leading-relaxed">
              If you have questions about this Privacy Policy, want to request data deletion, or have other 
              privacy-related concerns, please contact us at{" "}
              <a href="mailto:privacy@romonetize.com" className="text-primary hover:underline">
                privacy@romonetize.com
              </a>
            </p>
          </section>
        </div>

        {/* Footer links */}
        <div className="mt-12 pt-8 border-t border-border flex items-center gap-6">
          <Link href="/terms" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
            Terms of Service
          </Link>
          <Link href="/" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
            Back to Home
          </Link>
        </div>
      </main>
    </div>
  );
}
