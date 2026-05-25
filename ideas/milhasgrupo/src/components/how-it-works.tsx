const steps = [
  {
    n: 1,
    title: "Você cadastra a viagem",
    body: "Origem, janela de datas, tamanho do grupo e em quais programas você tem milhas. 1 minuto.",
  },
  {
    n: 2,
    title: "A gente monitora 24/7",
    body: "Cruzamos disponibilidade em Azul Fidelidade, LATAM Pass e Smiles para o trecho exato da sua família.",
  },
  {
    n: 3,
    title: "Alerta no Telegram",
    body: "Quando aparecem N assentos no mesmo voo, você recebe o link de emissão e um passo a passo. Você emite.",
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
