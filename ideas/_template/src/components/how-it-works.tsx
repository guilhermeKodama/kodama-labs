const steps = [
  {
    n: 1,
    title: "Você se cadastra",
    body: "Substitua: o que o usuário fornece em <1 min.",
  },
  {
    n: 2,
    title: "A gente trabalha",
    body: "Substitua: como o produto entrega valor (mesmo que manual no MVP).",
  },
  {
    n: 3,
    title: "Você age",
    body: "Substitua: a ação que o usuário toma quando o valor chega.",
  },
];

export function HowItWorks() {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-xl font-semibold">Como funciona</h2>
      <ol className="grid gap-4 sm:grid-cols-3">
        {steps.map((step) => (
          <li
            key={step.n}
            className="flex flex-col gap-2 rounded-md border border-border p-4"
          >
            <span className="text-2xl font-semibold text-muted-foreground">
              {step.n}
            </span>
            <h3 className="text-sm font-semibold">{step.title}</h3>
            <p className="text-sm text-muted-foreground">{step.body}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
