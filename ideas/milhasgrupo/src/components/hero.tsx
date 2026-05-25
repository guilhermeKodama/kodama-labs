import Link from "next/link";

export function Hero() {
  return (
    <section className="flex flex-col gap-6">
      <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
        Disney/Orlando em família · 3 a 6 passageiros
      </p>
      <h1 className="text-balance text-4xl font-semibold leading-tight sm:text-5xl">
        3 a 6 passagens no mesmo voo para Orlando — com suas milhas.
      </h1>
      <p className="max-w-prose text-balance text-base text-muted-foreground sm:text-lg">
        Sabemos: a companhia libera 2 a 6 assentos por voo, divididos entre programas
        do mundo todo. Você cadastra a viagem uma vez. A gente monitora Azul Fidelidade,
        LATAM Pass e Smiles 24/7 e avisa no Telegram quando aparecem assentos suficientes
        para a família inteira.
      </p>
      <div>
        <Link
          href="/start"
          className="inline-flex items-center justify-center rounded-md bg-primary px-6 py-3 text-sm font-medium text-primary-foreground transition hover:opacity-90"
        >
          Cadastrar minha viagem
        </Link>
      </div>
    </section>
  );
}
