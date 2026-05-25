import Link from "next/link";
import { IntakeForm } from "@/components/intake-form";

export default function ComecarPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-8 px-6 py-12">
      <header className="flex flex-col gap-2">
        <Link href="/" className="text-xs text-muted-foreground hover:underline">
          ← voltar
        </Link>
        <h1 className="text-3xl font-semibold">Cadastre sua viagem</h1>
        <p className="text-muted-foreground">
          Uma viagem por cadastro. Menos de 1 minuto. Você recebe os alertas no
          Telegram ou WhatsApp.
        </p>
      </header>
      <IntakeForm />
    </main>
  );
}
