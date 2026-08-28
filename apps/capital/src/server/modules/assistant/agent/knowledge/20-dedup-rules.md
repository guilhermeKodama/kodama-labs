# Regras de deduplicação

A tool `reconcile_statement` já roda essas regras para você (mesmo motor que o wizard de importação manual usa) - este arquivo existe para você saber **o que cada status significa** e **quando decidir sozinho versus perguntar**.

## Transações bancárias (OFX)

Comparação é feita em fases, nesta ordem:

1. **FITID já usado por uma `Transfer` existente** → `duplicate`. O extrato pode repetir uma linha que já virou transferência manualmente; não reimporte.
2. **FITID exato bate com uma `Transaction` existente**:
   - Se valor, data e descrição são idênticos → `duplicate`. Pule silenciosamente, sem perguntar.
   - Se algum campo difere (o valor mais comum é o valor mudar) → `changed`, com a lista exata de diferenças (`FieldDiff[]`). **Isso não é uma duplicata, é uma correção** - o banco está restabelecendo um lançamento que já existe com dado diferente do que você tem. Geralmente é seguro atualizar, mas se a diferença for grande ou o tipo de lançamento mudar, pergunte.
3. **Sem FITID igual, mas mesmo valor (±R$0,001), mesmo tipo (income/expense) e data dentro de ±3 dias** de um lançamento existente sem `externalId` → `fuzzy_match`. Isso é candidato a "já registrei essa transação manualmente e agora ela chegou pelo extrato".
4. **Nada bate** → `new`.

### Quando decidir sozinho vs. perguntar

| Situação | Ação |
|---|---|
| `duplicate` | Pular, sem perguntar. |
| `changed` com diferença pequena e plausível (ex.: valor mudou de R$150 para R$165, mesma data/descrição) | Incluir no plano como reconciliação, mas **avisar** o usuário no texto - não é silencioso. |
| `changed` com diferença grande, ou tipo de lançamento mudou | Perguntar antes de incluir no plano. |
| `fuzzy_match` | **Sempre apresentar como card de decisão** (`present_card`, tipo `duplicate_review`) - nunca decida sozinho, mesmo com alta confiança. O risco de mesclar duas transações diferentes por engano é maior que o custo de perguntar. |
| `new` | Incluir no plano sem perguntar, exceto se a classificação (ver `30-transfer-classification.md`) for ambígua. |

## Transferências entre entidades

Mesma lógica da Fase 0 acima: se o FITID já apareceu numa `Transfer`, é duplicata. Como `Transfer.externalId` não é único no banco, a checagem de "já existe" é uma consulta explícita (via `search_transfers`), não uma constraint que vai simplesmente rejeitar a escrita.

## Investimentos (PDF de corretora)

`InvestmentTransaction` não tem identificador nativo de corretora na maioria dos extratos. A chave de deduplicação é um hash determinístico, calculado assim:

```
externalId = "inv:" + accountId + ":" + sha256(date + "|" + ticker + "|" + type + "|" + totalAmount + "|" + quantity)
```

Onde `date` é a data no formato `YYYY-MM-DD`, `ticker` é o código do ativo (ou string vazia se não houver), `type` é o tipo de movimentação (`buy`/`sell`/`dividend`/...), e `totalAmount`/`quantity` são os valores exatos extraídos do PDF. Essa chave é única por `holdingId` (`@@unique([holdingId, externalId])`).

Como o hash é determinístico, reenviar o mesmo PDF gera exatamente as mesmas chaves e reconcilia como duplicata - não como uma posição nova. Isso só funciona se você extrair os valores do PDF de forma consistente entre execuções (mesmo formato de data, mesmo arredondamento); ao montar `investmentTransactions` num plano, calcule o hash você mesmo antes de propor - a tool `propose_import_plan` valida mas não recalcula por você.

Se dois lançamentos legítimos e diferentes acabarem gerando o mesmo hash (raro, mas possível com um extrato malformado), isso vai aparecer como um aviso de `propose_import_plan` recusando a chave duplicada dentro do próprio plano - avise o usuário em vez de tentar contornar.
