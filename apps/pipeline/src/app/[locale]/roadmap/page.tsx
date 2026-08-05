import { setRequestLocale } from "next-intl/server";
import {
  Check,
  Circle,
  Sparkles,
  Users,
  Wand2,
  LayoutTemplate,
  Activity,
  CreditCard,
  Brain,
  Lock,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

export const dynamic = "force-static";

interface PageProps {
  params: Promise<{ locale: string }>;
}

const V1_SCOPE = [
  "idea.yaml por ideia + sync automático (GitHub Action no push)",
  "Ingestão automática: Meta Ads (v25), Google Ads, GA4 — via crons + fallback manual",
  "Leads como fonte da verdade: webhook HMAC never-reject + import de CSV",
  "Health engine: thresholds por ideia, learning phase 72h, bandas de CAC (LTV/4), diagnóstico",
  "UI: funil-pipeline, charts, decisão go/kill, gestão de leads, operações",
];

const V2_PILLARS: Array<{ icon: LucideIcon; title: string; desc: string }> = [
  { icon: Users, title: "Multi-tenant", desc: "Contas isoladas, autenticação e billing." },
  {
    icon: Lock,
    title: "Setup self-serve",
    desc: "Conectar as próprias contas Meta/Google por OAuth e criar a ideia pela UI — sem editar arquivo.",
  },
  {
    icon: Wand2,
    title: "IA cria as campanhas",
    desc: "A partir da oferta, a IA gera estrutura, segmentação, copy e criativo pra Meta e Google — e publica.",
  },
  {
    icon: LayoutTemplate,
    title: "Landing page",
    desc: "Criar do zero no sistema (builder) ou conectar existente — já plugada nos canais + tracking.",
  },
  {
    icon: Activity,
    title: "Tracking automático",
    desc: "O mesmo funil de hoje, montado sozinho desde o clique (sem configurar pixel/UTM na mão).",
  },
  {
    icon: CreditCard,
    title: "Funil até o pagamento",
    desc: "Integrar confirmação de cliente/pagamento (Stripe/Hotmart/Kiwify) → PCR e CAC reais.",
  },
  {
    icon: Brain,
    title: "IA de diagnóstico",
    desc: "Além de mostrar o gargalo, recomendar a ação: otimizar criativo, ajustar público, mexer no preço.",
  },
];

const MILESTONES: Array<{ id: string; title: string; scope: string }> = [
  { id: "M1", title: "Multi-tenancy", scope: "Auth + contas + isolamento de dados. Base de tudo; o modo single (kodama-labs) segue funcionando." },
  { id: "M2", title: "Setup self-serve", scope: "OAuth Meta/Google na UI; criar ideia/funil sem idea.yaml; credenciais por conta." },
  { id: "M3", title: "IA de campanhas", scope: "Gerar estrutura/segmentação/copy/criativo da oferta e publicar via API." },
  { id: "M4", title: "Landing pages", scope: "Builder no sistema (auto-wired) + conectar existente; templates por tipo de oferta." },
  { id: "M5", title: "Fechar o funil", scope: "Integração de pagamento → PCR/CAC reais ponta a ponta." },
  { id: "M6", title: "IA de diagnóstico", scope: "Do 'qual é o gargalo' pro 'faça X' — recomendações acionáveis." },
];

export default async function RoadmapPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Visão & Roadmap</h1>
        <p className="text-sm text-muted-foreground mt-1.5 max-w-2xl">
          Da ideia ao cliente pago, em um lugar só. Hoje, ferramenta interna pra
          validar as ideias do repositório. Amanhã, um produto pra qualquer
          pessoa validar e escalar uma oferta com tráfego pago — sem ser técnica.
        </p>
      </div>

      {/* Phase cards */}
      <div className="grid gap-4 md:grid-cols-2">
        {/* V1 */}
        <div className="rounded-xl border bg-card p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                V1 · Interno
              </span>
            </div>
            <span className="inline-flex items-center gap-1 rounded-md bg-success/10 px-2 py-0.5 text-[11px] font-semibold text-success border border-success/20">
              <Check className="h-3 w-3" /> em uso
            </span>
          </div>
          <h2 className="text-lg font-semibold mt-2">Medir o funil</h2>
          <p className="text-xs text-muted-foreground mt-1">
            Gerenciar e validar automaticamente as ideias do repositório. Single-tenant.
          </p>
          <ul className="mt-4 space-y-2">
            {V1_SCOPE.map((item) => (
              <li key={item} className="flex items-start gap-2 text-xs">
                <Check className="h-3.5 w-3.5 text-success shrink-0 mt-0.5" />
                <span className="text-foreground/85">{item}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* V2 */}
        <div className="rounded-xl border bg-card p-5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              V2 · Produto externo
            </span>
            <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground border border-border">
              <Sparkles className="h-3 w-3" /> visão
            </span>
          </div>
          <h2 className="text-lg font-semibold mt-2">Fazer a ideia dar certo, ponta a ponta</h2>
          <p className="text-xs text-muted-foreground mt-1">
            Qualquer um cria, lança, mede e decide — com IA fazendo o trabalho
            pesado. Público menos técnico, tudo num lugar só.
          </p>
          <ul className="mt-4 space-y-2.5">
            {V2_PILLARS.map((p) => (
              <li key={p.title} className="flex items-start gap-2.5">
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">
                  <p.icon className="h-3.5 w-3.5" />
                </span>
                <div className="min-w-0">
                  <p className="text-xs font-medium leading-tight">{p.title}</p>
                  <p className="text-[11px] text-muted-foreground leading-snug mt-0.5">
                    {p.desc}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Decision callout */}
      <div className="rounded-xl border bg-card p-4">
        <p className="text-xs">
          <span className="font-semibold">Decisão em aberto — LP builder vs. conectar existente.</span>{" "}
          <span className="text-muted-foreground">
            Construir a LP dentro do sistema garante tracking automático (maior
            valor pro público não-técnico). Leaning: builder próprio como caminho
            principal, conectar existente como opção avançada.
          </span>
        </p>
      </div>

      {/* Milestones */}
      <div className="space-y-3">
        <h2 className="text-sm font-semibold">Quebra em milestones (V1 → V2)</h2>
        <p className="text-xs text-muted-foreground -mt-1">
          Ordem por dependência — M1 destrava o resto.
        </p>
        <ol className="relative border-l border-border ml-2 space-y-4 pt-1">
          {MILESTONES.map((m) => (
            <li key={m.id} className="ml-5">
              <span className="absolute -left-[7px] grid h-3.5 w-3.5 place-items-center rounded-full border bg-background">
                <Circle className="h-1.5 w-1.5 fill-muted-foreground/50 text-muted-foreground/50" />
              </span>
              <div className="flex items-baseline gap-2">
                <span className="text-xs font-bold tabular-nums text-muted-foreground">
                  {m.id}
                </span>
                <span className="text-sm font-medium">{m.title}</span>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">{m.scope}</p>
            </li>
          ))}
        </ol>
      </div>

      <p className="text-[11px] text-muted-foreground border-t pt-3">
        Detalhe técnico e notas pros próximos agentes em{" "}
        <code className="font-mono">apps/pipeline/docs/roadmap.md</code>.
      </p>
    </div>
  );
}
