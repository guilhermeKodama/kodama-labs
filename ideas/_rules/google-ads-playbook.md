# Google Ads — Arquitetura & Playbook de Validação (Kodama Labs)

> Guia de como organizar a conta Google Ads e rodar campanhas de validação para cada nova ideia/app.
> Modelo "fábrica de apps": estrutura clonável, faturamento isolado por produto, dados limpos por canal.
> Documento irmão do `meta-ads-playbook.md` — mesmos princípios, adaptados às regras do Google.

---

## 🏛️ ARQUITETURA DE CONTAS

Diferente do Meta (ativos paralelos), o Google Ads **é aninhado**: a Manager Account (MCC) é o guarda-chuva e cada app vive numa **sub-conta** dentro dela.

```
Manager Account / MCC (Kodama Labs · 101-781-4442)
├── Sub-conta: MilhasGrupo   (156-295-9715)
├── Sub-conta: App #2
├── Sub-conta: App #3
└── ...
```

- A **MCC não roda campanha** — ela só administra, consolida billing e dá visão única de todas as contas.
- Cada **sub-conta** é onde campanhas, palavras-chave, conversões e cobrança daquele app acontecem.
- Trocar de conta sempre pelo **dropdown no topo** antes de criar qualquer coisa (erro clássico: criar campanha na MCC em vez da sub-conta).

### Regra por nível

| Nível | Quantidade | Por quê |
|-------|-----------|---------|
| **MCC (Kodama Labs)** | 1, permanente | Guarda-chuva. País/fuso/moeda (Brasil · GMT-03 · BRL) são definidos uma vez e **não mudam mais**. |
| **Sub-conta** | 1 por app | Campanhas, conversões, billing e relatórios isolados por produto. |
| **Google tag (gtag.js)** | 1 por app | Instalada na landing. Mede PageView + conversão de Lead. |
| **Conversion Action** | 1 "principal" por app | `Lead - {App}`, value fixo, Count = One. As que o Google cria sozinho viram Secondary. |
| **Perfil de pagamento** | Organização (CNPJ Kodama) | Compartilhado entre as sub-contas via MCC. PF/PJ é **permanente** — sempre Organização. |

> ⚠️ Conta nova individual avulsa (fora da MCC) **não usar** — sempre criar a sub-conta de dentro da MCC (`Accounts → + → Create new account`). Mantém tudo sob o mesmo guarda-chuva.

---

## 💳 CARTÕES CORPORATIVOS VIRTUAIS (1 por ideia × canal)

Princípio central da operação: **cada combinação ideia + canal de mídia tem seu próprio cartão virtual corporativo**, emitido pela conta PJ da Kodama Labs (CNPJ 41.737.993/0001-66).

### Por que 1 cartão por ideia/canal

| Benefício | Como funciona |
|-----------|---------------|
| **Teto de gasto = trava automática** | O limite do cartão É o orçamento de validação. Se a ideia não performa, o cartão simplesmente para de aprovar — disciplina de kill embutida no nível financeiro, não só no painel. |
| **Reconciliação limpa** | Fatura do cartão deve bater com o gasto do painel daquele canal. Divergência = alerta de erro de config ou cobrança indevida. |
| **Kill instantâneo** | Matou a ideia? Congela/cancela o cartão na hora. Zero risco de cobrança residual. |
| **Isolamento de fraude/erro** | Um problema num cartão não derruba os outros apps nem o canal vizinho. |
| **Visão de CAC por canal** | Gasto Meta vs Google de cada app fica separado na origem, sem depender de planilha manual. |

### Estrutura e nomenclatura

Um cartão por célula da matriz **ideia × canal**:

| Cartão (nome sugerido) | Vinculado a | Limite mensal |
|------------------------|-------------|---------------|
| `MILHASGRUPO-META` | Conta de Ads Meta do app | orçamento de validação Meta + margem |
| `MILHASGRUPO-GOOGLE` | Sub-conta Google Ads do app | orçamento de validação Google + margem |
| `APP2-META` | ... | ... |
| `APP2-GOOGLE` | ... | ... |

**Como dimensionar o limite:** `(orçamento diário do canal) × (janela de teste em dias) × ~1,3 de margem`.
Ex.: Google a R$30/dia, teste de 30 dias → ~R$900 + margem ≈ **limite R$1.200/mês**. O teto evita que um bug de config (ex.: bid muito alto) gaste mais do que o planejado.

### Fluxo de emissão por ideia nova

1. Conta PJ Kodama → emitir **2 cartões virtuais** novos: `{APP}-META` e `{APP}-GOOGLE`.
2. Definir limite de cada um = orçamento de validação do canal.
3. Cadastrar o cartão Google na **sub-conta** correspondente (perfil de pagamento Organização).
4. Cadastrar o cartão Meta na conta de Ads do app.
5. Registrar no controle interno: `app | canal | cartão (4 últimos dígitos) | limite | data`.
6. Ao matar a ideia: congelar os dois cartões e pausar as campanhas.

> ℹ️ A maioria das contas PJ digitais no Brasil emite cartões virtuais com limite individual ajustável e congelamento na hora. Confirme no emissor que você usa: limite por cartão, quantidade de cartões virtuais disponíveis e se dá pra renomear/etiquetar cada um. As regras e tarifas variam por banco — isto é orientação operacional, não recomendação financeira; valide os termos com o emissor.

> ⚠️ **Nunca** digitar número de cartão em formulário aberto por link de terceiro não verificado. O cadastro do cartão é sempre feito por você diretamente dentro do painel oficial (Google Ads / Meta), nunca colado em chat ou doc compartilhado.

---

## 🔁 FLUXO PARA CADA NOVA IDEIA

1. Criar **sub-conta** dentro da MCC (`Accounts → + → Create new account`).
2. Emitir os **2 cartões virtuais** (`{APP}-META`, `{APP}-GOOGLE`) e definir limites.
3. Instalar a **Google tag** na landing do app (gtag.js).
4. Criar a **Conversion Action** (`Lead - {App}`) → pegar o **conversion label**.
5. Colar o label nas envs da landing (`NEXT_PUBLIC_GOOGLE_ADS_LEAD_LABEL` + `NEXT_PUBLIC_GOOGLE_ADS_ID`) → **redeploy**.
6. Criar a campanha **Search** (não PMax — ver abaixo), trocando:
   - Palavras-chave (foco em dor do nicho)
   - Localizações / idioma
   - URL de destino + sitelinks
   - Headlines / descriptions
7. Cadastrar o cartão `{APP}-GOOGLE` no perfil de pagamento (Organização).
8. **Revisar anti-patterns** (o wizard empurra PMax, orçamento alto, Display).
9. Renomear com versão (`{App}_Search_Lead_v1`).
10. Publicar → revisão Google.
11. **Validar disparo** da conversão (Tag Assistant) antes de confiar no painel.
12. Ler dados só **+72h** depois.

### Por que duplicar/clonar
Tendo a primeira campanha validada (MilhasGrupo), as próximas saem por cópia: você reusa a estrutura cuidadosa (Search puro, sem Display/Partners, bid de cliques no início) e só troca palavras-chave, copy e URL. Clonar dentro da mesma MCC é nativo.

---

## ⚙️ CONFIGURAÇÃO DA CAMPANHA (modelo de validação)

### Tipo: SEARCH (nunca Performance Max no início)
PMax é caixa-preta: sem controle de palavra-chave nem leitura clara de intenção. Para validação você quer **intenção pura de busca**. No wizard, "view other campaign types → Search".

### Objetivo
- **Leads / Submit lead form**
- Conversão: escolher configurar via código (a Google tag + label cuidam disso)

### Palavras-chave (foco em dor, não genéricas)
Cola direto a lista, uma por linha. Termos que descrevem o problema do usuário, não a categoria ampla.
Ex. MilhasGrupo: `emitir passagem com milhas familia`, `nao consigo emitir 4 passagens milhas`, `assento junto milhas familia`, `monitorar disponibilidade milhas`, `alerta passagem milhas`...

### Localizações
- **Custom** — cidades-alvo (ex.: São Paulo, Campinas, Belo Horizonte).
- Setar **"Presence: People in or regularly in"** (NÃO "Presence or interest") — evita gente de fora só "interessada".

### Idioma
- **Português** (remover inglês).

### Redes (anti-pattern do Google)
- **Search Partners: DESMARCADO**
- **Display Network: DESMARCADO**
- Resultado: "No networks targeted" além da busca pura. (Display/Partners aqui = equivalente ao Audience Network no Meta.)

### Públicos
- Search usa **intenção da palavra-chave** como targeting. Não precisa segmento de audiência.
- Deixar em modo **Observation** (padrão), não Targeting.

### Anúncio (Responsive Search Ad)
- Até **15 headlines** (≤30 caracteres cada) — usar ~12 boas, foco em dor.
- Até **4 descriptions** (≤90 caracteres cada).
- **Display path:** `app/categoria` (ex.: `milhas/familia`).
- **Sitelinks** (4): Como funciona · Beta gratuito · Cobertura · Público-alvo → todos pra landing.
- Ad strength "Average" já roda — não sacrificar clareza por "Excellent".

### Estratégia de lance
- **Início (conta nova, sem dados de conversão): Maximize clicks ("Clicks").**
- Depois de acumular conversões (~15–30), migrar para **Maximize conversions / tCPA**.

### Orçamento
- **Custom** (ex.: R$30/dia). **Ignorar** o valor recomendado pelo Google (vem inflado, ex.: R$233/dia) e o aviso de "orçamento muito baixo" — é o Google empurrando gasto.

### Faturamento (billing)
- Perfil de pagamento: **Organização** (CNPJ Kodama), nunca Individual (CPF).
- A escolha PF/PJ é **permanente** — não dá pra converter um perfil PF em PJ depois. Se aparecer só perfil PF, criar o de Organização pelo próprio dropdown do billing do Google Ads (`Criar perfil de pagamentos → Organização`).
- Cartão: o `{APP}-GOOGLE` virtual.
- Aceitar a **autorização temporária de R$50** (validação do cartão, estorna em ~1 semana).
- Se der erro tipo `OR_BBFPPCPSD_*` com dropdown vazio: geralmente instabilidade — recarregar a página resolve.

---

## 🎯 CONVERSÕES & TRACKING

### Passos
1. **Goals → Conversions → Summary → + New conversion action → Website**.
2. Categoria: **Submit lead form**.
3. **Manually with code** (a landing já carrega o gtag, só precisamos do label).
4. Preencher:
   - Nome: `Lead - {App}`
   - Value: **Use the same value for each conversion** → valor fixo (ex.: 200 BRL — teto de CAC de validação)
   - Count: **One** (mesma pessoa 2× = 1 lead)
   - Janelas: padrão (90d click / Data-driven attribution)
5. **See event snippet** → copiar o que vem **depois da `/`** no `send_to`:
   ```
   'send_to': 'AW-XXXXXXXXX/LABEL_AQUI'
   ```
6. Colar nas envs da landing (Vercel) e **redeploy**:
   - `NEXT_PUBLIC_GOOGLE_ADS_ID = AW-XXXXXXXXX`
   - `NEXT_PUBLIC_GOOGLE_ADS_LEAD_LABEL = LABEL_AQUI`

> Esses valores **não são sensíveis** — ficam públicos no front (prefixo `NEXT_PUBLIC_`). São identificadores, não credenciais. O que nunca vai pro front: developer token, OAuth client secret, refresh token da API.

### Validação do disparo (fazer SEMPRE antes de confiar no painel)
1. Abrir a landing em produção + extensão **Google Tag Assistant**.
2. "Google tags found" deve listar a tag `AW-...` do app → confirma que o gtag carregou.
3. **Submeter o formulário de teste.**
4. Em "Hits sent" deve aparecer o evento **`Lead - {App}`** → confirma que a conversão dispara no submit. (Só a tag carregar **não** prova isso.)

> O painel mostra a conversão como **"Inactive / Unverified"** por algumas horas até ~24h após o primeiro disparo real. Inactive logo após o deploy é normal; o Tag Assistant é a prova imediata.

### Limpeza de conversões duplicadas
O Google cria conversões automáticas ao instalar a tag (ex.: `Lead form - Submit`, `Submit lead form`). Deixar **só `Lead - {App}` como Primary** e mudar as outras para **Secondary** (ou pausar), pra não inflar a contagem de leads.

---

## 🚨 ANTI-PATTERNS — NUNCA ACEITAR

O Google empurra automações e gasto da mesma forma que o Meta. Ignorar:

| Sugestão / Botão | Por quê |
|------------------|---------|
| **Performance Max (default do wizard)** | Caixa-preta, sem controle de keyword/intenção. Trocar por Search. |
| **Orçamento recomendado** (ex.: R$233/dia) | Inflado. Usar custom no valor de validação. |
| **Aviso "orçamento muito baixo"** | Pressão pra gastar mais. Ignorar. |
| **Search Partners** marcado | Tráfego de baixa qualidade fora da busca Google. Desmarcar. |
| **Display Network** marcado | Equivalente ao Audience Network do Meta. Desmarcar. |
| **"Personalized guidance" do estrategista** | Não. Responder No. |
| **Auto-apply recommendations** | Deixa o Google mexer sozinho na conta (broad match, budget, bids). Manter OFF. |
| **Broad match por padrão** | Espalha gasto em buscas irrelevantes no início. Preferir phrase/exact até ter dados. |
| **Optimization score baixo** | Ignorar como métrica de pressão — cai porque você recusou as automações de propósito. |

---

## ⚠️ LIMITES & PARTICULARIDADES DE CONTA NOVA

- Conta nova passa por **revisão** antes de servir anúncios (pode levar horas).
- Sem histórico de conversão → **começar com Maximize clicks**, não conversões.
- Autorização temporária de R$50 no cartão na ativação do billing.
- Conversão fica "Unverified/Inactive" até o primeiro disparo real ser registrado.
- Fuso/moeda da MCC são **permanentes** — conferir no setup (Brasil · GMT-03 · BRL).

---

## 📊 LEITURA & KILL CRITERIA

### Quando ler
- **+72h após publicação**, não antes (learning phase).
- Matar palavra-chave / anúncio com CTR < 1% após ~R$50 gastos sem 1 lead.

### Targets saudáveis
- CTR (Search) > 3% (busca converte melhor que feed)
- CPC dentro do estimado (~R$0,40–1,00 no caso atual)
- Landing → Lead > 5%
- Lead → Ativo > 60%

### Death criteria (mata o projeto, não a keyword)
- CAC > limite aceitável **em ambos os canais** após 2 semanas
- Volume de busca insuficiente (impressões pingando mesmo com keywords certas)
- < 3 conversões-core reais em 8 semanas

### Economics (template)
- LTV projetado definido por app
- CAC máximo = LTV/4 a LTV/5 (e é o limite do cartão virtual)

---

## 🧰 REAPROVEITAMENTO ENTRE IDEIAS

| Método | Quando usar |
|--------|-------------|
| **Duplicar campanha** (dentro da MCC) | Padrão. Troca keywords/copy/URL. |
| **Copiar/colar entre sub-contas** | Editor do Google permite mover estrutura entre contas da mesma MCC. |
| **Google Ads Editor (app desktop)** | Edição em massa offline, bulk de keywords/anúncios, copiar entre contas. |

> Telas e fluxos do Google Ads mudam com frequência. Confirmar o passo atual na interface no momento de executar.

---

## ✅ CHECKLIST RÁPIDO POR IDEIA NOVA

- [ ] Sub-conta criada dentro da MCC (não na MCC, não avulsa)
- [ ] Cartões virtuais `{APP}-META` e `{APP}-GOOGLE` emitidos + limites definidos
- [ ] Google tag instalada na landing
- [ ] Conversion Action `Lead - {App}` criada (value fixo, Count One)
- [ ] Label colado no Vercel (`NEXT_PUBLIC_GOOGLE_ADS_LEAD_LABEL` + `_ID`) + redeploy
- [ ] Campanha **Search** (não PMax)
- [ ] Keywords de dor coladas (phrase/exact no início)
- [ ] Localização "Presence" + idioma Português
- [ ] Search Partners OFF · Display Network OFF
- [ ] RSA: ~12 headlines (≤30) + 4 descriptions (≤90) + 4 sitelinks
- [ ] Bid: Maximize clicks (conta nova)
- [ ] Orçamento custom (ignorar recomendado e aviso de "baixo")
- [ ] Billing: perfil Organização (CNPJ) + cartão `{APP}-GOOGLE`
- [ ] Auto-apply recommendations OFF
- [ ] Conversões duplicadas → só `Lead - {App}` como Primary
- [ ] Validado disparo no Tag Assistant (form de teste → hit `Lead - {App}`)
- [ ] Renomeado com versão
- [ ] Publicar → aguardar revisão
- [ ] Ler dados só +72h depois
