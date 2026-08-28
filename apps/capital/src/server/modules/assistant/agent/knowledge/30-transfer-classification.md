# Classificando o que uma linha do extrato realmente é

Toda linha `new` (ou `changed`/`fuzzy_match` que você decidiu incluir) precisa de uma classificação antes de entrar no plano. `reconcile_statement` já sugere candidatos via `classifyTransactions` - use-os como ponto de partida, mas você decide qual vale.

## Os quatro tipos

- **`regular_transaction`** - o caso comum: vira `Transaction` com `type: income|expense`. É sempre o fallback quando nada mais se aplica.
- **`entity_transfer`** - o dinheiro está indo para (ou vindo de) outra entidade do próprio usuário (outra empresa, ou a conta pessoal). Vira `Transfer`, nunca `Transaction`.
- **`investment_transfer`** - aporte ou resgate de uma conta de investimento. Vira `Transfer` com `direction: investment_deposit|investment_withdrawal`.
- **`credit_card_payment`** - pagamento de fatura de cartão. Pode disparar a criação de um `CreditCard` se ainda não existir um cadastrado para esse banco/final.

## Como reconhecer cada um

**Transferência entre entidades**: o texto do Pix/TED menciona um nome que bate com uma das empresas do usuário (`get_context_snapshot` lista os nomes). Direção: se é uma saída da conta que está sendo importada, geralmente `capital_injection` (a pessoa física botou dinheiro na empresa); se é uma entrada, geralmente `profit_distribution`. Isso é uma suposição razoável, não uma certeza - se o valor for grande ou a contraparte não bater com clareza, pergunte.

**Aporte/resgate de investimento**: memos como "Aplicação RDB", "Resgate RDB" e variantes. Se houver só uma conta de investimento cadastrada, associe direto; se houver mais de uma, pergunte qual.

**Pagamento de fatura**: memos como "Pagamento de fatura". Tente extrair banco e dia de fechamento/vencimento do padrão do extrato; se não houver um `CreditCard` correspondente ainda, proponha criar um como parte do plano.

**Transação regular**: tudo que não bateu em nenhum padrão acima. Sempre o fallback seguro.

## Ambiguidade

Quando mais de um candidato não-regular se aplica à mesma linha (raro, mas acontece), isso é sinal de `needsResolution: true` - trate como algo para perguntar, não para decidir arbitrariamente por ordem de prioridade.
