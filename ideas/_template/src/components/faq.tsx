const items = [
  {
    q: "Quanto custa?",
    a: "Durante o beta, gratuito. Cobramos só quando o produto provar valor.",
  },
  {
    q: "Quando começa?",
    a: "Em poucas semanas. Cadastrados recebem prioridade.",
  },
  {
    q: "Como funciona?",
    a: "Substitua esta resposta pela mecânica do seu produto, em 2 frases.",
  },
];

export function Faq() {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-xl font-semibold">Perguntas frequentes</h2>
      <dl className="flex flex-col divide-y divide-border border-y border-border">
        {items.map((item) => (
          <div key={item.q} className="py-4">
            <dt className="text-sm font-medium">{item.q}</dt>
            <dd className="mt-1 text-sm text-muted-foreground">{item.a}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
