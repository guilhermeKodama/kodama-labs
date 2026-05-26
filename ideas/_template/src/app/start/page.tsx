import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { IntakeForm } from "@/components/intake-form";

export default function StartPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col gap-10 px-6 py-16">
      <header className="flex flex-col gap-3">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          voltar
        </Link>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          Comece aqui
        </h1>
        <p className="text-base text-muted-foreground">
          {/* TODO: 1 sentence on what they're about to fill out */}
          Menos de 1 minuto. Você só preenche o essencial.
        </p>
      </header>
      <IntakeForm />
    </main>
  );
}
