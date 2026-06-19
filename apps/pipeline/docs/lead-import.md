# Padrão de import de leads — CSV v1

Formato canônico para subir leads de qualquer ideia no dashboard (Operações →
"Import leads"). É o **contrato interno**: qualquer pessoa que produza um CSV
nesse formato consegue importar. Headers em inglês são o canônico; aliases
PT/EN são aceitos (ver tabela). Uma linha = um lead.

## Colunas

| Coluna (canônica) | Obrigatória | Formato | Descrição |
|---|---|---|---|
| `email` | **sim** | texto | Chave de deduplicação (idea + email). |
| `status` | recomendada | enum (ver abaixo) | Estágio do lead. Default `new`. |
| `created_at` | recomendada | data | Quando o lead entrou. Conta o lead no funil nesse dia. |
| `name` | não | texto | Nome. |
| `contact` | não | texto | WhatsApp/Telegram/telefone. |
| `activated_at` | não | data | Quando virou Ativo (usou o produto). Se vazio e status ≥ active, é estimado de `created_at`. |
| `converted_at` | não | data | Quando virou Cliente (pagou/emitiu). |
| `customer_value` | não | dinheiro BRL | Receita real do cliente (alimenta LTV/payback). |
| `utm_source` | não | texto | Fonte (`meta`, `google`, …). Define o canal. |
| `utm_medium` `utm_campaign` `utm_content` `utm_term` `referrer` | não | texto | Atribuição. |
| *(qualquer outra coluna)* | não | texto | Vira "dado do lead" (ex.: `group_size`, `travel_window`, `alerts_sent`, `issuances`). |

### `status` (aceita PT e EN)

| Canônico | Significa | Aliases aceitos |
|---|---|---|
| `new` | lead novo, sem contato | `novo`, `lead`, `inscrito`, `cadastro`, *(vazio)* |
| `onboarding` | msg inicial enviada | `contatado` |
| `qualified` | qualificado | `qualificado` |
| `active` | usou o produto/serviço | `ativo`, `engajado` |
| `customer` | pagou / converteu | `cliente`, `issued`, `emitido`, `pagante`, `paid`, `convertido` |
| `cold` | sem resposta (reativável) | `frio` |
| `lost` | fora do escopo / desistiu | `perdido`, `descartado` |

### Datas
Aceita `YYYY-MM-DD`, ISO completo, e **`DD/MM/AAAA`** (export padrão de
planilha BR). Hora opcional.

### Dinheiro (`customer_value`)
BRL. Aceita `1500`, `1500.00`, `1.500,00`, `R$ 1.500,00`.

### Aliases de cabeçalho (auto-mapeados)
`e-mail`→email · `nome`→name · `contato`/`telefone`/`whatsapp`/`telegram`→contact ·
`data`/`criado_em`/`recebido_em`→created_at · `ativado_em`→activated_at ·
`convertido_em`/`emitido_em`→converted_at · `valor`/`receita`/`ltv`→customer_value ·
`observacoes`/`notas`→notes · `fonte`/`origem`→utm_source · `campanha`→utm_campaign.
Cabeçalhos são case-insensitive e espaços viram `_`.

## Comportamento

- **Dedup + re-import:** chave `(ideia, email)`. Subir de novo **atualiza** o
  lead — nunca duplica. O status só **avança** (nunca regride); timestamps já
  preenchidos não são apagados. Seguro rodar quantas vezes quiser.
- **Canal:** derivado de `utm_source`/`utm_medium`. Se a linha não tiver
  `utm_source`, usa o "Atribuir ao canal" escolhido no upload (ex.: Meta).
- **Funil:** Leads conta por `created_at`; Ativos por `activated_at`; Clientes
  por `converted_at` (contabilidade por período, no fuso da ideia).

## Como subir

1. **UI:** Operações → "Import leads (CSV)" → escolha a ideia + canal → **Choose CSV**.
   (O botão "Download template" baixa um CSV de exemplo com as colunas.)
2. **CLI (headless/automação):**
   ```bash
   node scripts/import-sheets-leads.mjs --idea <slug> caminho/para/leads.csv
   ```

## Exemplo mínimo

```csv
email,status,created_at,utm_source
camila@ex.com,customer,05/06/2026,meta
rafael@ex.com,active,06/06/2026,meta
joana@ex.com,new,10/06/2026,meta
```
