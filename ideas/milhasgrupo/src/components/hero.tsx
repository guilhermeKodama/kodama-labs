import Link from "next/link";
import Image from "next/image";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

export function Hero() {
  return (
    <section className="relative isolate overflow-hidden">
      {/* Full-bleed background photo */}
      <Image
        src="/images/hero-family.webp"
        alt="Família sorrindo numa praia tropical ao pôr do sol"
        fill
        priority
        sizes="100vw"
        className="-z-20 object-cover"
      />

      {/* Gradient scrim — darker on the left where the text lives, fades right */}
      <div
        aria-hidden
        className="absolute inset-0 -z-10 bg-gradient-to-r from-black/75 via-black/40 to-black/10"
      />

      {/* Inner container with text overlay */}
      <div className="relative mx-auto flex min-h-[640px] max-w-5xl flex-col items-start justify-center gap-7 px-6 py-24 text-background sm:min-h-[680px] sm:py-32 lg:min-h-[720px]">
        <span className="flex flex-wrap items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-background/80">
          <span aria-hidden className="text-accent">●</span>
          Família
          <span aria-hidden className="text-background/40">·</span>
          Orlando
          <span aria-hidden className="text-background/40">·</span>
          3 a 6 passageiros
        </span>

        <h1 className="max-w-3xl text-balance font-serif text-5xl font-normal leading-[1.05] tracking-tight drop-shadow-md sm:text-6xl lg:text-[4.5rem]">
          Disney <span className="italic">em família</span>, com suas milhas.
        </h1>

        <p className="max-w-xl text-balance text-lg text-background/90 drop-shadow sm:text-xl">
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
            <Button
              asChild
              size="lg"
              variant="ghost"
              className="text-background hover:bg-background/10 hover:text-background"
            >
              <a href="#how">Como funciona</a>
            </Button>
          </div>
          <p className="text-sm text-background/85">
            <span className="text-accent">●</span> 20 vagas no beta —
            cadastrados recebem prioridade.
          </p>
          <p className="text-xs text-background/70">
            Sem custos
            <span aria-hidden className="px-2 text-background/40">·</span>
            Não pedimos sua senha
            <span aria-hidden className="px-2 text-background/40">·</span>
            Sem app pra instalar
          </p>
        </div>
      </div>
    </section>
  );
}
