# Classificando o que uma linha do extrato realmente é

Toda linha `new` (ou `changed`/`fuzzy_match` que você decidiu incluir) precisa de uma classificação antes de entrar no plano. `reconcile_statement` já sugere candidatos via `classifyTransactions` - use-os como ponto de partida, mas você decide qual vale.

## Os quatro tipos

- **`regular_transaction`** - o caso comum: vira `Transaction` com `type: income|expense`. É sempre o fallback quando nada mais se aplica.
- **`entity_transfer`** - o dinheiro está indo para (ou vindo de) outra entidade do próprio usuário (outra empresa, ou a conta pessoal). Vira `Transfer`, nunca `Transaction`.
- **`investment_transfer`** - aporte ou resgate de uma conta de investimento. Vira `Transfer` com `direction: investment_deposit|investment_withdrawal`.
- **`credit_card_payment`** - pagamento de fatura de cartão. Pode disparar a criação de um `CreditCard` se ainda não existir um cadastrado para esse banco/final.

## Como reconhecer cada um

**Transferência entre entidades**: o texto do Pix/TED menciona um nome que bate com uma das empresas do usuário (`get_context_snapshot` lista os nomes). Sobre a direção, ver a seção abaixo - ela tem duas partes que você não pode misturar.

**Aporte/resgate de investimento**: memos como "Aplicação RDB", "Resgate RDB" e variantes. Se houver só uma conta de investimento cadastrada, associe direto; se houver mais de uma, pergunte qual.

**Pagamento de fatura**: memos como "Pagamento de fatura". Tente extrair banco e dia de fechamento/vencimento do padrão do extrato; se não houver um `CreditCard` correspondente ainda, proponha criar um como parte do plano.

**Transação regular**: tudo que não bateu em nenhum padrão acima. Sempre o fallback seguro.

## `flow` e `direction` são coisas diferentes

Toda transferência do plano tem os dois campos, e eles respondem perguntas distintas:

- **`flow`** (`outflow` | `inflow`) - **para que lado o dinheiro andou na conta do extrato que você está importando**. `outflow` = saiu dessa conta, `inflow` = entrou. Isso não é interpretação: é o sinal da linha. Linha `expense` ⇒ `outflow`, linha `income` ⇒ `inflow`, sempre, sem exceção. `reconcile_statement` já devolve isso pronto em `transferDetails.suggestedFlow`.
- **`direction`** (`profit_distribution` | `capital_injection` | `reimbursement`) - **por que** o dinheiro andou. É só o rótulo.

O erro que essa separação existe para impedir: o mesmo `direction` fica em lados opostos dependendo de qual extrato é. Uma distribuição de lucro é `outflow` no extrato da empresa e `inflow` no extrato da conta pessoal - o rótulo é o mesmo nos dois casos. Quem decide quem pagou quem é o `flow`, nunca o `direction`.

Então: leia `flow` da linha e só depois escolha o rótulo que combina com ele.

| extrato importado | contraparte | `flow` | `direction` possível |
|---|---|---|---|
| conta pessoal | empresa | `outflow` | `capital_injection` |
| conta pessoal | empresa | `inflow` | `profit_distribution`, `reimbursement` |
| empresa | conta pessoal | `outflow` | `profit_distribution`, `reimbursement` |
| empresa | conta pessoal | `inflow` | `capital_injection` |
| empresa | outra empresa | qualquer | qualquer (o rótulo não codifica papéis aqui) |

`propose_import_plan` recusa o plano inteiro se `flow` não bater com o sinal da linha, ou se o `direction` contradisser quem pagou. Se você tomar um erro desses, a correção é no rótulo ou na contraparte - **nunca** no `flow`, que é o dado do extrato.

Aportes e resgates (`investmentTransfers`) não têm `flow`: `investment_deposit` é sempre saída da entidade e `investment_withdrawal` sempre entrada. Mesmo assim são conferidos contra o sinal da linha.

Continua valendo o resto: rótulo é suposição razoável, não certeza - se o valor for grande ou a contraparte não bater com clareza, pergunte.

## Ambiguidade

Quando mais de um candidato não-regular se aplica à mesma linha (raro, mas acontece), isso é sinal de `needsResolution: true` - trate como algo para perguntar, não para decidir arbitrariamente por ordem de prioridade.
