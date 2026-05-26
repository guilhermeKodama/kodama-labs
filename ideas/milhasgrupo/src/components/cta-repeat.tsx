import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

export function CtaRepeat() {
  return (
    <section className="flex flex-col items-start gap-6 rounded-lg border border-border bg-secondary/40 px-6 py-10 sm:px-10 sm:py-12">
      <h2 className="text-balance font-serif text-3xl font-normal leading-tight tracking-tight sm:text-4xl">
        Sua próxima viagem com a família começa por aqui.
      </h2>
      <p className="max-w-xl text-balance text-base text-muted-foreground">
        Em 1 minuto, a gente assume a busca. Você só recebe o alerta quando
        valer a pena emitir.
      </p>
      <div className="flex flex-col gap-2">
        <Button asChild size="lg">
          <Link href="/start">
            Cadastrar viagem grátis
            <ArrowRight />
          </Link>
        </Button>
        <p className="text-xs text-muted-foreground">
          <span className="text-accent">●</span> 20 vagas no beta · gratuito
        </p>
      </div>
    </section>
  );
}
