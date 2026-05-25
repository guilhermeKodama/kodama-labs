import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FlightPathArt } from "@/components/flight-path-art";

export function Hero() {
  return (
    <section className="relative isolate flex flex-col items-start gap-8 py-24 sm:py-32">
      <FlightPathArt className="pointer-events-none absolute inset-0 -z-10 m-auto hidden h-full w-full max-w-3xl text-accent opacity-[0.18] sm:block" />

      <span className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
        <span aria-hidden className="text-accent">●</span>
        Família
        <span aria-hidden className="text-accent/70">·</span>
        Orlando
        <span aria-hidden className="text-accent/70">·</span>
        3 a 6 passageiros
      </span>

      <h1 className="text-balance font-serif text-6xl font-normal leading-[1.05] tracking-tight sm:text-7xl lg:text-[5.5rem]">
        Disney <span className="italic">em família</span>, com suas milhas.
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
