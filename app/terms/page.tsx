import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms of Service - RoMonetize",
  description: "Terms of Service for RoMonetize analytics platform for Roblox developers.",
};

export default function TermsPage() {
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
        <h1 className="text-3xl font-bold text-foreground mb-2">Terms of Service</h1>
        <p className="text-muted-foreground mb-8">Last updated: January 2026</p>

        <div className="prose prose-neutral dark:prose-invert max-w-none space-y-8">
          <section>
            <h2 className="text-xl font-semibold text-foreground mb-4">1. Acceptance of Terms</h2>
            <p className="text-muted-foreground leading-relaxed">
              By accessing or using RoMonetize (&quot;Service&quot;), you agree to be bound by these Terms of Service (&quot;Terms&quot;). 
              If you do not agree to these Terms, you may not use the Service. We reserve the right to update these Terms 
              at any time, and your continued use of the Service constitutes acceptance of any changes.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-4">2. Account Usage</h2>
            <p className="text-muted-foreground leading-relaxed">
              You must be at least 13 years old to use RoMonetize. You are responsible for maintaining the security of 
              your account and all activities that occur under your account. You agree to provide accurate and complete 
              information when creating your account and to keep this information up to date.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-4">3. Roblox OAuth Connection</h2>
            <p className="text-muted-foreground leading-relaxed">
              RoMonetize uses Roblox OAuth to authenticate your identity and access your Roblox account information. 
              By connecting your Roblox account, you authorize us to access your public profile information, including 
              your username, user ID, and games you own or have permission to manage. We do not store your Roblox 
              password and you can disconnect your Roblox account at any time from your account settings.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-4">4. Analytics and Tracking Usage</h2>
            <p className="text-muted-foreground leading-relaxed">
              RoMonetize provides analytics and tracking services for your Roblox games. You are responsible for 
              implementing our tracking code in your games and ensuring compliance with Roblox&apos;s Terms of Service. 
              The analytics data collected belongs to you, and we process it solely to provide you with insights 
              about your game&apos;s monetization performance.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-4">5. AI Credits and Billing</h2>
            <p className="text-muted-foreground leading-relaxed">
              RoMonetize offers AI-powered features that consume AI credits. Credits are included with paid plans 
              and can be purchased separately. Credits are non-refundable and expire according to your plan terms. 
              We reserve the right to modify pricing and credit allocations with reasonable notice.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-4">6. Subscriptions and Cancellations</h2>
            <p className="text-muted-foreground leading-relaxed">
              Paid subscriptions are billed in advance on a monthly or annual basis. You may cancel your subscription 
              at any time, and you will continue to have access until the end of your current billing period. 
              No refunds are provided for partial billing periods. We may change subscription pricing with 30 days 
              notice before your next billing cycle.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-4">7. Acceptable Use</h2>
            <p className="text-muted-foreground leading-relaxed mb-4">
              You agree not to use RoMonetize to:
            </p>
            <ul className="list-disc list-inside text-muted-foreground space-y-2 ml-4">
              <li>Violate any applicable laws or regulations</li>
              <li>Violate Roblox&apos;s Terms of Service or Community Guidelines</li>
              <li>Attempt to gain unauthorized access to our systems</li>
              <li>Interfere with or disrupt the Service</li>
              <li>Use the Service for any fraudulent or deceptive purposes</li>
              <li>Share your account credentials with others</li>
              <li>Reverse engineer or attempt to extract source code from the Service</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-4">8. Limitation of Liability</h2>
            <p className="text-muted-foreground leading-relaxed">
              RoMonetize is provided &quot;as is&quot; without warranties of any kind. We are not liable for any indirect, 
              incidental, special, consequential, or punitive damages arising from your use of the Service. Our total 
              liability shall not exceed the amount you paid us in the twelve months preceding the claim. We do not 
              guarantee the accuracy of analytics data or any revenue projections derived from it.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-4">9. Termination</h2>
            <p className="text-muted-foreground leading-relaxed">
              We may suspend or terminate your access to the Service at any time for violation of these Terms or 
              for any other reason at our sole discretion. Upon termination, your right to use the Service will 
              immediately cease, and we may delete your data in accordance with our Privacy Policy.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-4">10. Contact</h2>
            <p className="text-muted-foreground leading-relaxed">
              If you have any questions about these Terms, please contact us at{" "}
              <a href="mailto:support@romonetize.com" className="text-primary hover:underline">
                support@romonetize.com
              </a>
            </p>
          </section>
        </div>

        {/* Footer links */}
        <div className="mt-12 pt-8 border-t border-border flex items-center gap-6">
          <Link href="/privacy" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
            Privacy Policy
          </Link>
          <Link href="/" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
            Back to Home
          </Link>
        </div>
      </main>
    </div>
  );
}
