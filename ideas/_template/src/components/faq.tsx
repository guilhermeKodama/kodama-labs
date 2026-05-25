import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

const items = [
  {
    q: "Quanto custa?",
    a: "Gratuito durante o beta. Cobramos só depois que o produto provar valor.",
  },
  {
    q: "Quando começa?",
    a: "Em poucas semanas. Cadastrados recebem prioridade.",
  },
  {
    q: "Como funciona, na prática?",
    a: "Substitua por uma resposta curta — até 30 palavras — sobre a mecânica do produto.",
  },
];

export function Faq() {
  return (
    <section className="flex flex-col gap-8">
      <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
        Perguntas frequentes
      </h2>
      <Accordion type="single" collapsible className="w-full">
        {items.map((item, i) => (
          <AccordionItem key={item.q} value={`item-${i}`}>
            <AccordionTrigger className="text-base font-medium">
              {item.q}
            </AccordionTrigger>
            <AccordionContent className="text-base">{item.a}</AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </section>
  );
}
