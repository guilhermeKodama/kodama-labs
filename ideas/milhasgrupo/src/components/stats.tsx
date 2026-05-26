const stats = [
  { value: "~500K", caption: "famílias acumulam milhas no Brasil" },
  { value: "~50K", caption: "têm Disney como meta de 2 anos" },
  { value: "3", caption: "programas monitorados — Azul, LATAM, Smiles" },
  { value: "24/7", caption: "vigilância sobre disponibilidade" },
];

export function Stats() {
  return (
    <section className="grid grid-cols-2 gap-x-6 gap-y-10 border-y border-border py-10 sm:grid-cols-4 sm:py-12">
      {stats.map((s) => (
        <div key={s.caption} className="flex flex-col gap-2">
          <span className="font-serif text-4xl font-normal leading-none tracking-tight text-primary sm:text-5xl">
            {s.value}
          </span>
          <span className="text-sm text-muted-foreground">{s.caption}</span>
        </div>
      ))}
    </section>
  );
}
