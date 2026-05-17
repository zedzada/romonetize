"use client";

import { useState } from "react";
import { Header } from "@/components/landing/header";
import { Hero } from "@/components/landing/hero";
import { Features } from "@/components/landing/features";
import { DashboardPreview } from "@/components/landing/dashboard-preview";
import { Pricing } from "@/components/landing/pricing";
import { CTA } from "@/components/landing/cta";
import { Footer } from "@/components/landing/footer";
import { BetaModal } from "@/components/landing/beta-modal";
import { AuthModal } from "@/components/landing/auth-modal";

export default function Home() {
  const [isBetaModalOpen, setIsBetaModalOpen] = useState(false);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);

  const openBetaModal = () => setIsBetaModalOpen(true);
  const closeBetaModal = () => setIsBetaModalOpen(false);
  
  const openAuthModal = () => setIsAuthModalOpen(true);
  const closeAuthModal = () => setIsAuthModalOpen(false);

  return (
    <main className="min-h-screen">
      <Header onOpenBetaModal={openBetaModal} />
      <Hero onOpenAuthModal={openAuthModal} />
      <Features />
      <DashboardPreview />
      <Pricing />
      <CTA onOpenAuthModal={openAuthModal} />
      <Footer />
      <BetaModal isOpen={isBetaModalOpen} onClose={closeBetaModal} />
      <AuthModal isOpen={isAuthModalOpen} onClose={closeAuthModal} />
    </main>
  );
}
