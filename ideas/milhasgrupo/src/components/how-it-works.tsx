import { ClipboardList, Radar, Send } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const steps = [
  {
    n: "01",
    icon: ClipboardList,
    title: "Cadastre a viagem",
    body: "Origem, datas, tamanho do grupo, programas onde você tem milhas. 1 minuto.",
  },
  {
    n: "02",
    icon: Radar,
    title: "Monitoramos 24/7",
    body: "Cruzamos Azul Fidelidade, LATAM Pass e Smiles para o seu trecho exato.",
  },
  {
    n: "03",
    icon: Send,
    title: "Receba o alerta",
    body: "Telegram ou WhatsApp com link de emissão e passo a passo. Você emite.",
  },
];

export function HowItWorks() {
  return (
    <section id="how" className="flex flex-col gap-10">
      <header className="flex flex-col gap-3">
        <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          Como funciona
        </h2>
        <p className="max-w-xl text-base text-muted-foreground">
          Três passos. Sem app pra instalar.
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-3">
        {steps.map(({ n, icon: Icon, title, body }) => (
          <Card key={n} className="gap-4 py-6">
            <CardHeader className="gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-md bg-secondary text-primary">
                <Icon className="size-4" />
              </div>
              <span className="text-xs font-medium text-muted-foreground">
                {n}
              </span>
              <CardTitle className="text-base">{title}</CardTitle>
            </CardHeader>
            <CardContent>
              <CardDescription>{body}</CardDescription>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}
