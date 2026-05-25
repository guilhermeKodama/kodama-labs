const items = [
  {
    q: "Quanto custa?",
    a: "Gratuito durante o beta. Cobramos só quando o produto provar valor (ainda estamos validando).",
  },
  {
    q: "Para onde funciona?",
    a: "Só Orlando (MCO) por enquanto, com partidas de GRU, CNF e VCP — voos diretos.",
  },
  {
    q: "Quais programas vocês monitoram?",
    a: "Azul Fidelidade, LATAM Pass e Smiles. Outros programas ficam para depois da validação.",
  },
  {
    q: "Quantos alertas por dia eu recebo?",
    a: "Bem poucos. A diferença para grupos genéricos é exatamente essa: você só é avisado quando há assentos no número da sua família, no seu trajeto, na sua janela.",
  },
  {
    q: "Funciona para 1 ou 2 pessoas?",
    a: "Não. Foco em famílias de 3 a 6 — o problema único que estamos resolvendo é o de grupos.",
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
