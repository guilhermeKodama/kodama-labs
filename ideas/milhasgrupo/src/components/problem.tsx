import { X } from "lucide-react";

const pains = [
  "5 grupos genéricos. 30 alertas por dia. Quase nada no seu voo.",
  "3 programas para cruzar manualmente, todo dia, por meses.",
  "Milhas vencendo. R$ 30 a 50 mil em dinheiro como única alternativa.",
];

export function Problem() {
  return (
    <section className="flex flex-col gap-10">
      <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
        Hoje, é assim:
      </h2>
      <ul className="flex flex-col gap-5">
        {pains.map((pain) => (
          <li key={pain} className="flex items-start gap-4">
            <X
              className="mt-1 size-5 shrink-0 text-muted-foreground/60"
              strokeWidth={1.75}
              aria-hidden
            />
            <p className="text-balance text-lg text-foreground/85">{pain}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
