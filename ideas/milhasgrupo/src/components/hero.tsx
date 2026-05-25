import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

export function Hero() {
  return (
    <section className="flex flex-col items-start gap-8 py-24 sm:py-32">
      <span className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
        Família · Orlando · 3 a 6 passageiros
      </span>

      <h1 className="text-balance text-5xl font-semibold tracking-tight sm:text-6xl lg:text-7xl">
        Disney em família, com suas milhas.
      </h1>

      <p className="max-w-xl text-balance text-lg text-muted-foreground sm:text-xl">
        Avisamos quando há assentos suficientes para todos no mesmo voo —
        Azul, LATAM ou Smiles.
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <Button asChild size="lg">
          <Link href="/start">
            Cadastrar viagem grátis
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
