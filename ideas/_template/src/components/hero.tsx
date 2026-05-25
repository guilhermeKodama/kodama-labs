import Link from "next/link";

export function Hero() {
  return (
    <section className="flex flex-col gap-6">
      <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
        {/* TODO: niche / category */}
        Validação em curso
      </p>
      <h1 className="text-balance text-4xl font-semibold leading-tight sm:text-5xl">
        {/* TODO: headline — the promise in <12 words */}
        {"{{IDEA_NAME}}"} — uma frase que resolve a dor em até 12 palavras.
      </h1>
      <p className="max-w-prose text-balance text-base text-muted-foreground sm:text-lg">
        {/* TODO: subheadline — restate the problem and hint at the solution */}
        Para [persona] que vive [problema concreto]. Cadastre-se para o beta gratuito.
      </p>
      <div>
        <Link
          href="/start"
          className="inline-flex items-center justify-center rounded-md bg-primary px-6 py-3 text-sm font-medium text-primary-foreground transition hover:opacity-90"
        >
          {/* TODO: CTA copy — verb + outcome */}
          Quero participar
        </Link>
      </div>
    </section>
  );
}
