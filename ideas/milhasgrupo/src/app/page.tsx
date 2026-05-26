import { HeroSplit } from "@/components/hero-split";
import { Stats } from "@/components/stats";
import { Problem } from "@/components/problem";
import { HowItWorks } from "@/components/how-it-works";
import { Destinations } from "@/components/destinations";
import { Faq } from "@/components/faq";
import { CtaRepeat } from "@/components/cta-repeat";
import { Footer } from "@/components/footer";

export default function Page() {
  return (
    <main className="mx-auto max-w-5xl px-6">
      <HeroSplit />
      <div className="mx-auto max-w-3xl space-y-24 pb-24 sm:space-y-32 sm:pb-32">
        <Stats />
        <Problem />
        <HowItWorks />
        <Destinations />
        <Faq />
        <CtaRepeat />
        <Footer />
      </div>
    </main>
  );
}
