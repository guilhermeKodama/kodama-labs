import { Hero } from "@/components/hero";
import { HowItWorks } from "@/components/how-it-works";
import { Faq } from "@/components/faq";
import { Footer } from "@/components/footer";

export default function Page() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-16 px-6 py-16">
      <Hero />
      <HowItWorks />
      <Faq />
      <Footer />
    </main>
  );
}
