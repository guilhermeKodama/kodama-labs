import { Hero } from "@/components/hero";
import { Problem } from "@/components/problem";
import { HowItWorks } from "@/components/how-it-works";
import { Faq } from "@/components/faq";
import { Footer } from "@/components/footer";

export default function Page() {
  return (
    <main className="mx-auto max-w-3xl px-6">
      <Hero />
      <div className="space-y-24 pb-24 sm:space-y-32 sm:pb-32">
        <Problem />
        <HowItWorks />
        <Faq />
        <Footer />
      </div>
    </main>
  );
}
