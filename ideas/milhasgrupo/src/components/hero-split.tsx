import Link from "next/link";
import Image from "next/image";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

export function HeroSplit() {
  return (
    <section className="grid items-center gap-10 py-16 sm:py-20 lg:grid-cols-[1.05fr,1fr] lg:gap-16 lg:py-28">
      <div className="flex flex-col items-start gap-8 order-2 lg:order-1">
        <span className="flex flex-wrap items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
          <span aria-hidden className="text-accent">●</span>
          Família
          <span aria-hidden className="text-accent/70">·</span>
          Orlando
          <span aria-hidden className="text-accent/70">·</span>
          3 a 6 passageiros
        </span>

        <h1 className="text-balance font-serif text-5xl font-normal leading-[1.05] tracking-tight sm:text-6xl lg:text-[4.5rem]">
          Disney <span className="italic">em família</span>, com suas milhas.
        </h1>

        <p className="max-w-xl text-balance text-lg text-muted-foreground sm:text-xl">
          Avisamos quando há assentos suficientes para todos no mesmo voo —
          Azul, LATAM ou Smiles.
        </p>

        <div className="flex flex-col gap-3">
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
          <p className="text-sm text-muted-foreground">
            <span className="text-accent">●</span> 20 vagas no beta — cadastrados
            recebem prioridade.
          </p>
          <p className="text-xs text-muted-foreground">
            Sem custos
            <span aria-hidden className="px-2 text-muted-foreground/40">·</span>
            Não pedimos sua senha
            <span aria-hidden className="px-2 text-muted-foreground/40">·</span>
            Sem app pra instalar
          </p>
        </div>
      </div>

      <div className="relative aspect-[4/5] w-full overflow-hidden rounded-2xl shadow-lg shadow-foreground/10 order-1 lg:order-2">
        <Image
          src="/images/hero-family.webp"
          alt="Família feliz curtindo viagem em praia ensolarada"
          fill
          priority
          sizes="(min-width: 1024px) 480px, 100vw"
          className="object-cover"
        />
      </div>
    </section>
  );
}
