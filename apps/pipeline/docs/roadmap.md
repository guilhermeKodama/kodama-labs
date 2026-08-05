# Pipeline — Visão & Roadmap

> Fonte da verdade da direção do produto. A página `/roadmap` no app renderiza
> isto. Mantenha os dois em sincronia ao evoluir.

## Visão

**Da ideia ao cliente pago, em um lugar só.**
Hoje é uma ferramenta **interna** pra validar as ideias do repositório kodama-labs.
Amanhã é um **produto** que qualquer pessoa com um infoproduto / curso / app /
SaaS usa pra **validar e escalar com tráfego pago — sem precisar ser técnica.**

---

## V1 — Interno · "medir o funil" *(atual)*

**Objetivo:** gerenciar e validar automaticamente as ideias do repositório.
**Público:** Guilherme + agentes. **Single-tenant.**

Escopo (feito):
- `idea.yaml` por ideia + sync automático (GitHub Action no push pra main).
- Ingestão automática de ads/analytics: **Meta** (Marketing API v25), **Google Ads**
  (lib Opteo), **GA4** (Data API) — via crons; com fallback de entrada manual.
- **Leads = fonte da verdade:** webhook HMAC *never-reject* + import de CSV
  (padrão documentado em `docs/lead-import.md`).
- **Health engine:** thresholds por ideia, learning phase de 72h, bandas de CAC
  pela regra LTV/4, diagnóstico por métrica.
- **UI:** funil-pipeline, charts, decisão go/kill, gestão de leads, operações.

Estado: em uso interno. O funil do MilhasGrupo já roda com dado real (Meta + leads).

---

## V2 — Produto externo · "fazer a ideia dar certo, ponta a ponta" *(futuro)*

**Objetivo:** atender quem tem uma oferta (infoproduto, curso, app, SaaS) e quer
usar tráfego pago pra **validar e escalar** — público **menos técnico**, tudo
integrado num lugar só.

**A virada:** deixa de ser "eu meço o funil das *minhas* ideias" e vira
"*qualquer um* cria, lança, mede e decide — com IA fazendo o trabalho pesado".

Pilares:
1. **Multi-tenant** — contas isoladas, autenticação, billing.
2. **Setup self-serve** — conectar as próprias contas Meta/Google por OAuth (sem
   editar arquivo); criar a "ideia"/funil pela UI.
3. **IA cria as campanhas** — a partir da oferta, a IA gera estrutura de campanha,
   segmentação, copy e sugestão de criativo pra Meta e Google, e publica via API.
4. **Landing page** — criar do zero dentro do sistema (builder) **ou** conectar
   uma existente. Já nasce plugada nos canais + pixel/UTM/webhook/tracking.
   *(decisão em aberto — ver abaixo.)*
5. **Tracking automático desde o clique** — o mesmo funil de hoje, montado sozinho
   (o usuário não configura pixel/UTM/conversão na mão).
6. **Funil até o pagamento** — integrar confirmação de cliente/pagamento (ex.:
   Stripe / Hotmart / Kiwify) pra fechar PCR e CAC reais ponta a ponta.
7. **IA de diagnóstico & recomendação** — além de mostrar o gargalo (como hoje),
   recomendar a ação (otimizar criativo, ajustar público, mexer no preço…).

### Decisão em aberto: LP builder vs. conectar existente
Construir a LP **dentro do sistema** garante que o tracking/wiring é automático —
que é o maior valor pro público não-técnico. **Leaning:** builder próprio como
caminho principal, com "conectar LP existente" como opção avançada.

---

## Quebra em milestones (caminho de V1 → V2)

A ordem é por dependência — **M1 destrava o resto.**

| # | Milestone | Escopo |
|---|---|---|
| **M1** | Multi-tenancy | Auth + contas + isolamento de dados. Base de tudo. O modo single (kodama-labs) precisa continuar funcionando. |
| **M2** | Setup self-serve | OAuth Meta/Google na UI; criar ideia/funil sem `idea.yaml`; gestão de credenciais por conta. |
| **M3** | IA de campanhas | Gerar estrutura/segmentação/copy/criativo a partir da oferta; publicar via Marketing API + Google Ads API. |
| **M4** | Landing pages | Builder no sistema (auto-wired com tracking) + conectar existente; templates por tipo de oferta. |
| **M5** | Fechar o funil | Integração de pagamento (confirmação de cliente) → PCR/CAC reais ponta a ponta. |
| **M6** | IA de diagnóstico | Do "qual é o gargalo" pro "faça X" — recomendações acionáveis. |

---

## Princípios que seguem valendo (V1 e V2)
- Contagens cruas no banco; derivadas **sempre** calculadas.
- Config declarativa por entidade (idea.yaml hoje → UI amanhã).
- Nunca perder lead (*never-reject*).
- Diagnóstico antes de número solto.

## Para o próximo agente
- V1 está em uso interno — ao introduzir multi-tenancy (M1), **não quebrar** o
  fluxo single-tenant; o modo kodama-labs deve continuar rodando.
- Os contratos atuais são `idea.yaml` (config da ideia) e `docs/lead-import.md`
  (import de leads). V2 generaliza esses contratos pra dentro da UI.
- O funil, o health engine e a ingestão já são genéricos por ideia — a maior
  obra de V2 é multi-tenancy + as camadas de criação (campanha/LP) com IA.
