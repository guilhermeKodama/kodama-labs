import { IntakeForm } from "@/components/intake-form";

export default function ComecarPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-8 px-6 py-12">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold">Comece aqui</h1>
        <p className="text-muted-foreground">
          {/* TODO: explain the form and how long it takes */}
          Menos de 1 minuto. Você só preenche o essencial.
        </p>
      </header>
      <IntakeForm />
    </main>
  );
}
