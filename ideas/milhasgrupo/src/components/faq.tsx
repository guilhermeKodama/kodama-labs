import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

const items = [
  {
    q: "Vocês precisam da minha senha ou do meu login?",
    a: "Não. Você só nos diz onde tem milhas. A consulta de disponibilidade é nossa — você emite no seu próprio programa, com seu próprio login.",
  },
  {
    q: "Quanto custa?",
    a: "Gratuito durante o beta. Cobramos só depois que o produto provar valor.",
  },
  {
    q: "Para onde funciona?",
    a: "Apenas Orlando (MCO) por enquanto, saindo de GRU, CNF ou VCP — voos diretos.",
  },
  {
    q: "Quais programas vocês monitoram?",
    a: "Azul Fidelidade, LATAM Pass e Smiles. Outros vêm depois da validação.",
  },
  {
    q: "Por que só 3 a 6 passageiros?",
    a: "É o problema específico que estamos resolvendo: companhias liberam poucos assentos por voo.",
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
