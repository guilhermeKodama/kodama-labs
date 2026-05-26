import Image from "next/image";
import { Card, CardContent } from "@/components/ui/card";

const stops = [
  {
    eyebrow: "01 · Sai daqui",
    title: "São Paulo, Belo Horizonte ou Campinas",
    body: "Voo direto, sem conexão.",
    src: "/images/dest-gru.webp",
    alt: "Vista aérea de São Paulo com avião ao pôr do sol",
  },
  {
    eyebrow: "02 · Voo direto",
    title: "Azul, LATAM ou Smiles",
    body: "Cruzamos os três programas pra encontrar o seu assento.",
    src: "/images/dest-flight.webp",
    alt: "Vista da janela do avião com nuvens ao amanhecer",
  },
  {
    eyebrow: "03 · Chega em Orlando",
    title: "Disney, Universal, parques aquáticos",
    body: "Você e a família, no mesmo voo. Pronto.",
    src: "/images/dest-orlando.webp",
    alt: "Praia ensolarada na Flórida com palmeiras",
  },
];

export function Destinations() {
  return (
    <section className="flex flex-col gap-10">
      <header className="flex flex-col gap-3">
        <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          A viagem inteira, do GRU à Flórida.
        </h2>
        <p className="max-w-xl text-base text-muted-foreground">
          Três passos. Um único cadastro.
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-3">
        {stops.map((stop) => (
          <Card key={stop.title} className="gap-0 overflow-hidden py-0">
            <div className="relative aspect-[4/3] w-full overflow-hidden">
              <Image
                src={stop.src}
                alt={stop.alt}
                fill
                sizes="(min-width: 1024px) 280px, (min-width: 640px) 33vw, 100vw"
                className="object-cover transition-transform duration-500 hover:scale-105"
              />
            </div>
            <CardContent className="flex flex-col gap-2 p-5">
              <span className="text-xs font-medium uppercase tracking-widest text-accent">
                {stop.eyebrow}
              </span>
              <h3 className="text-base font-semibold leading-snug">
                {stop.title}
              </h3>
              <p className="text-sm text-muted-foreground">{stop.body}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}
