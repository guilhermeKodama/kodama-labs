import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

export function Hero() {
  return (
    <section className="flex flex-col items-start gap-8 py-24 sm:py-32">
      <span className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
        {/* TODO: niche · qualifier · qualifier (≤6 words, dot-separated) */}
        Categoria · público · qualificador
      </span>

      <h1 className="text-balance text-5xl font-semibold tracking-tight sm:text-6xl lg:text-7xl">
        {/* TODO: the promise — ≤8 words, active voice, concrete outcome */}
        {"{{IDEA_NAME}}"} — a promessa em até 8 palavras.
      </h1>

      <p className="max-w-xl text-balance text-lg text-muted-foreground sm:text-xl">
        {/* TODO: one sentence — who it's for + what we do. ≤18 words. */}
        Para [persona] que [contexto]. Avisamos quando [resultado concreto].
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <Button asChild size="lg">
          <Link href="/start">
            {/* TODO: CTA verb matching user intent */}
            Quero participar
            <ArrowRight />
          </Link>
        </Button>
        <Button asChild size="lg" variant="ghost">
          <a href="#how">Como funciona</a>
        </Button>
      </div>
    </section>
  );
}
