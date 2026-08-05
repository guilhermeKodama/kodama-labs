# Meta Ads — Arquitetura & Playbook de Validação (Kodama Labs)

> Guia de como organizar a conta Meta e rodar campanhas de validação para cada nova ideia/app.
> Modelo "fábrica de apps": estrutura clonável, dados limpos por produto.

---

## 🏛️ ARQUITETURA DE ATIVOS

A hierarquia do Meta **não é aninhada** — Página, Conta de Ads, Pixel e Domínio são ativos *paralelos* dentro do Business. Na campanha você os associa.

```
Business Manager (Kodama Labs)
├── Páginas         → 1 por app
├── Contas de Ads   → 1 por app (ideal; opcional no início)
├── Pixels/Datasets → 1 por app
└── Domínios        → 1 por app (verificado)
```

A conta de ads não "fica dentro" da página. Ao montar o anúncio você escolhe qual Página + qual Pixel aquela campanha usa.

### Regra por ativo

| Ativo | Quantidade | Por quê |
|-------|-----------|---------|
| **Página** | 1 por app | Marca do app como anunciante. Criar é grátis e ilimitado → dedicada desde já. |
| **Pixel/Dataset** | 1 por app | Tracking limpo, sem misturar conversões entre produtos. |
| **Domínio** | 1 por app | Verificado no Business (necessário p/ otimização de eventos). |
| **Conta de Ads** | 1 por app (ideal) | Faturamento e relatórios separados por produto. Tem **limite** em Business novo → no começo pode agrupar e separar quando volume justificar. |

> ⚠️ Conta de ads tem limite (Business novo começa com poucas; sobe com histórico de gasto). Página não tem limite. Confirmar o limite atual na interface antes de planejar muitos apps em paralelo.

---

## 🔁 FLUXO PARA CADA NOVA IDEIA

1. Criar **Página** nova (marca do app).
2. Criar **Pixel/Dataset** novo e instalar na landing.
3. Verificar **Domínio** do app no Business.
4. **Duplicar** uma campanha-modelo validada (mesma conta ou outra conta do mesmo Business).
5. Na cópia, trocar:
   - Página associada
   - Pixel associado
   - Domínio/URL de destino
   - `utm_campaign` (ex: `disney_beta` → `novoapp_beta`)
   - Públicos, mídias, textos
6. **Revisar anti-patterns** (a duplicação às vezes reativa Advantage+).
7. Renomear com versão (`_v2`, `_beta2`) p/ não confundir relatórios.
8. Publicar → revisão Meta (1–24h).

### Por que duplicar a campanha é o melhor caminho
Mantém toda a estrutura cuidadosa (anti-Advantage+, posicionamentos manuais, kill criteria). Você só edita o que muda de ideia pra ideia: público, mídia, texto. Clonar dentro do **mesmo Business** é nativo e sem atrito.

### Mover entre contas / Business
- **Mesma conta:** duplicação normal traz tudo.
- **Outra conta, mesmo Business:** a duplicação deixa escolher a conta destino. Pixel, página, públicos e UTMs podem precisar ser remapeados (pertencem à conta/Business).
- **Outro Business:** não há export nativo direto. Ativos são amarrados ao Business de origem. Opções: compartilhar o ativo entre os dois Business e duplicar, ou recriar via importação por planilha (Bulk CSV) ajustando IDs.

> Por isso o modelo recomendado: **1 Business (Kodama Labs) + 1 conta de ads por app**. Evita o atrito cross-Business e mantai a dinâmica de clonar-e-adaptar fluida.

---

## 🏗️ ESTRUTURA DE CAMPANHA (modelo de validação)

### Campanha
- Objetivo: **Leads**
- Estratégia de orçamento: **por conjunto** (NÃO compartilhado/CBO)
- Teste A/B: **desativado**
- Campanha Advantage+: **desativada**

### Conjuntos: 1 conjunto = 1 criativo isolado
Cria 3 conjuntos, um para cada ângulo criativo, para comparar limpo qual ângulo emocional vence. Sem variações de texto dentro do conjunto (quebra a leitura).

| # | Conjunto | Criativo | `utm_content` |
|---|----------|----------|---------------|
| 1 | Conjunto_01 | Ângulo A | `angulo_a_v1` |
| 2 | Conjunto_02 | Ângulo B | `angulo_b_v1` |
| 3 | Conjunto_03 | Ângulo C | `angulo_c_v1` |

### Config replicada nos 3 conjuntos
- **Conversão:** Site → Pixel do app → Evento `Lead` → Maximizar leads
- **Criativo dinâmico:** desativado
- **Orçamento:** por conjunto (atenção ao limite da conta — ver abaixo)
- **Público:** localizações, idade, gênero, idioma + direcionamento detalhado por interesses
  - ⚠️ **Advantage+ Público DESATIVADO** via "Limitar mais o alcance dos anúncios"
- **Posicionamentos:** Manual, Advantage+ **desativado**. Apenas Facebook + Instagram (remover Audience Network, Messenger, Threads). "Permitir gasto limitado em posicionamentos excluídos" **desmarcado**.

### UTMs (padrão)
No campo **Parâmetros de URL** do anúncio (Rastreamento), sem `?` na frente:
```
utm_source=meta&utm_medium=paid&utm_campaign={APP}_beta&utm_content={NOME_DO_CRIATIVO}
```
A Meta **não** preenche UTM automaticamente — sempre manual, e o `utm_content` muda por criativo.
O `utm_medium=paid` é obrigatório: é o que separa tráfego pago de orgânico no GA4 e no dashboard de pipeline.

### Conta de anúncios (criação — irreversível)
Ao criar a conta de anúncios da ideia: **fuso horário America/Sao_Paulo + moeda BRL**.
Ambos são permanentes; conta com fuso errado desalinha os dias do funil no dashboard
(o job de ingestão verifica e falha alto em caso de mismatch). Copie o `act_…` para o
`idea.yaml` (`ads.meta_ad_account_id`).

---

## ✅ APRIMORAMENTOS — TODOS DESATIVADOS (replicar em cada anúncio)

### Aprimoramentos de criativo Advantage+ (0/6)
Sobreposições · Retoques visuais · Música · Mídia flexível · Melhorias no texto · Animação

### Aprimoramentos essenciais (0/5)
Comentários relevantes · Aprimorar CTA · Brilho e contraste · Revelar detalhes com o tempo · Mostrar destaques

### Outras configs do anúncio
- Complementos navegador: **Nenhum**
- Anúncios com vários anunciantes: **desmarcado**
- Anúncio em parceria: **desativado**
- Idiomas: **desativado**
- Geração de imagem IA: **nenhuma**
- Instagram: usar a Página do Facebook

---

## 🚨 ANTI-PATTERNS — NUNCA CLICAR

A Meta empurra constantemente botões pra reativar automações que quebram a estratégia. Ignorar todos:

| Botão / Card | Por quê |
|--------------|---------|
| "Aplicar agora" — +10% CTR com imagens IA | Variações em inglês quebrado, mata credibilidade |
| "Aplicar agora" — +3% / 4 aprimoramentos | Reativa Aprimoramentos Advantage+ |
| "Configurar teste" / "Testar" — Teste de criativo | Quebra estratégia 1 conjunto = 1 criativo |
| "Aplicar" — +pontos botão WhatsApp | Adiciona botão que quebra tracking de Lead no Pixel |
| "Trocar para configuração recomendada" | Reativa Advantage+ Público |
| "Aplicar" — menor custo se permitir gasto limitado | Reativa Audience Network |
| "Incluir todos os posicionamentos disponíveis" | Idem |
| "Faça um teste A/B Advantage+" | Não |
| "Adicionar opção de texto/título" (5 variações) | Quebra leitura de qual ângulo ganhou |

> **Pontuação da campanha (~57–65/100):** ignorar. Cai conforme você desativa Advantage+. É de propósito.

---

## ⚠️ LIMITES DE CONTA NOVA

- Conta nova tem teto de gasto (ex: ~R$52,50/dia / R$210/semana no caso atual).
- 3 conjuntos × R$30/dia = R$90/dia → **acima do teto**. A Meta capa. Monitorar se algum conjunto não sai do ar.
- Teto sobe com histórico de gasto saudável.
- WhatsApp Business: aguardar 24–48h após criar conta antes de mensagens em volume.

---

## 📊 LEITURA & KILL CRITERIA

### Quando ler
- **+72h após publicação**, não antes (fase de aprendizado do algoritmo).
- Matar criativo individual com CTR < 1% após ~R$50 gastos sem 1 Lead.

### Targets saudáveis
- CTR > 1,5%
- Bounce < 60%
- Landing → Lead > 5%
- Lead → Ativo > 60%
- Ativo → Emissão/conversão-core > 30%

### Death criteria (mata o projeto, não o criativo)
- CAC > limite aceitável em ambos canais após 2 semanas
- Landing → Lead < 1% após 2 iterações de copy
- < 3 conversões-core reais em 8 semanas

### Economics (template)
- Definir LTV projetado
- CAC máximo aceitável = LTV/4 a LTV/5

---

## 🧰 REAPROVEITAMENTO ENTRE IDEIAS

| Método | Quando usar |
|--------|-------------|
| **Duplicar campanha** | Padrão. Muda só público/mídia/texto. Melhor custo-benefício. |
| **Modelos (Criar modelo)** | Salvar esqueleto de público/anúncio reutilizável sem clonar a campanha toda. |
| **Bulk import (CSV/Excel)** | Testar muitas variações de copy/público em escala. Mídia ainda sobe manual. |

> Procedimentos de mover campanha entre contas/Business mudam com frequência na Meta. Confirmar o fluxo atual na interface no momento de executar.

---

## ✅ CHECKLIST RÁPIDO POR IDEIA NOVA

- [ ] Página criada
- [ ] Pixel criado + instalado na landing (PageView, Lead, CompleteRegistration)
- [ ] Domínio verificado
- [ ] Campanha duplicada de modelo validado
- [ ] Página + Pixel + Domínio trocados na cópia
- [ ] `utm_campaign` atualizado; `utm_content` por criativo
- [ ] Públicos / mídias / textos trocados
- [ ] Advantage+ Público OFF (limitar alcance)
- [ ] Posicionamento manual, só FB + IG
- [ ] Aprimoramentos 0/6 e 0/5 em cada anúncio
- [ ] Anti-patterns revisados (cópia pode reativar Advantage+)
- [ ] Renomeado com versão
- [ ] Limite de gasto da conta verificado
- [ ] Publicar → aguardar revisão (1–24h)
- [ ] Ler dados só +72h depois
