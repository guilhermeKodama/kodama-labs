import Link from "next/link";
import { CheckCircle2 } from "lucide-react";

export default function ThanksPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center gap-6 px-6 py-16 text-center">
      <CheckCircle2 className="size-12 text-primary" strokeWidth={1.5} />
      <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
        Viagem cadastrada.
      </h1>
      <p className="text-base text-muted-foreground">
        Em breve te chamamos por e-mail ou WhatsApp para combinar os detalhes
        (origem, programas onde você tem milhas). Depois disso, monitoramos sua
        viagem 24/7.
      </p>
      <Link
        href="/"
        className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
      >
        Voltar para o início
      </Link>
    </main>
  );
}
