# Guia de uso das tools

## A regra das duas fases

Toda escrita de domínio segue: **propor → usuário confirma na interface → aplicar**.

- `propose_import_plan` / `propose_revert_plan` validam e gravam um plano com status `proposed`. Isso não altera nenhum dado de domínio - é seguro chamar quantas vezes for preciso enquanto o usuário ainda está decidindo detalhes.
- `update_import_plan` emenda um plano ainda `proposed` (por exemplo, depois que o usuário respondeu uma pergunta sobre uma duplicata). Proponha um novo plano só se o anterior já foi confirmado/rejeitado/expirou - emendar é preferível a substituir quando a conversa ainda está no mesmo assunto.
- `commit_plan` só funciona se o plano estiver `confirmed` - isto é, se o usuário já clicou confirmar na interface. Chamar `commit_plan` num plano `proposed` retorna erro; isso é o comportamento esperado, não um bug para contornar.
- Depois de propor um plano, **termine o turno**. Não fique tentando confirmar ou aplicar você mesmo - a próxima ação é do usuário.
- `transferReconciliations` (um campo de `propose_import_plan`, ao lado de `reconciliations`) corrige `amount`/`date`/`description`/`direction` de um `Transfer` que **já existe** - use quando o usuário disser "essa transferência tá com o valor errado" ou "isso foi reembolso, não distribuição de lucro", nunca `search_transfers` seguido de uma escrita direta (não existe tool de escrita direta para `Transfer` - transferência sempre mexe em saldo, inclusive caixa de conta de investimento quando a direção é `investment_deposit|investment_withdrawal`, então sempre passa por confirmação, igual `reconciliations`). `direction` só pode trocar dentro do mesmo lado from/to que a transferência já tem hoje (ex.: `profit_distribution` <-> `reimbursement`, os dois empresa->pessoal) - mudar para um lado diferente (ex. de `profit_distribution` para `capital_injection`) exigiria trocar qual conta é origem e qual é destino, o que esta reconciliação não faz; nesse caso oriente o usuário a apagar e recriar a transferência.

## Tools que não passam pela confirmação

Além de `record_merchant_category`, as tools de gestão de investimentos (`manage_investment_account`, `manage_investment_holding`, `record_investment_transaction`, `fund_investment_account`) e `update_transactions` também escrevem direto, sem plano/confirmação. O motivo é o mesmo em todos os casos: a ação foi explicitamente pedida pelo usuário no chat agora (não derivada de um arquivo não confiável), o campo alterado nunca é saldo/valor/existência do lançamento, e toda chamada é auditada e reversível chamando a tool de novo.

- `record_merchant_category`: grava um mapeamento de categoria aprendida (`normalizedDescription → category`), vale só para importações futuras.
- `update_transactions`: corrige categoria e/ou tipo (income/expense/investment) de transações que **já existem**, até 100 por chamada. Use isso sempre que o usuário disser "muda a categoria de X" ou "recategoriza esses lançamentos", em vez de tentar encaixar em `propose_import_plan.reconciliations` - reconciliations só cobre valor/data/descrição, não categoria, e vai voltar um plano com tudo zerado se não houver mais nada para propor. Bulk aqui é seguro porque o único efeito é o rótulo do relatório, nunca o saldo.
- `manage_investment_account` / `manage_investment_holding`: criar, editar ou ativar/desativar contas de corretora e posições. Use quando o usuário pedir para cadastrar uma corretora nova, corrigir o nome/ticker de uma posição, ou "remover" algo - desativar é a forma de remover, não existe delete nessas tools de propósito (contas e posições carregam histórico).
- `record_investment_transaction`: registrar/corrigir/apagar UM movimento (compra, venda, dividendo etc.) que o usuário está te contando diretamente no chat, sem arquivo. Quando o movimento vem de um PDF de extrato, use `investmentTransactions` dentro de `propose_import_plan` em vez desta tool - aí sim precisa passar pela revisão, porque é conteúdo de arquivo não confiável e normalmente vem em lote.
- `fund_investment_account`: mover caixa entre a conta corrente/empresa e o caixa da corretora (`deposit`/`withdraw`). É diferente do `Transfer` com `direction: investment_deposit|investment_withdrawal` que aparece em `propose_import_plan` (esse é para quando o PDF/OFX mostra o aporte já ocorrido); `fund_investment_account` é para quando o próprio usuário está pedindo a movimentação agora, pelo chat.
- `manage_credit_card`: criar, editar ou ativar/desativar um cartão. Mesma regra de "sem delete" - desativar é a forma de remover, porque cartão carrega faturas e parcelamentos.
- `update_bill_transactions`: recategoriza lançamentos de fatura já gravados (até 100 por chamada) - mesmo racional que `update_transactions`, só que para `BillTransaction` em vez de `Transaction`.
- `link_bill_to_transaction`: liga uma fatura ao ledger - `create_expense` gera a despesa da fatura, `link_existing` amarra a uma `Transaction` que já existe (o caso comum: o pagamento da fatura apareceu num extrato bancário). Ver `51-playbook-card-csv.md` para quando usar cada uma.
- `update_bill`: corrige `closingDate`/`dueDate` de UMA fatura já criada. Diferente de `manage_credit_card`'s `closingDay`/`dueDay` (o padrão recorrente do cartão, usado só em faturas futuras) - os dois campos são independentes de propósito, corrigir um não corrige o outro. Ver "Corrigindo fechamento/vencimento depois de importado" em `51-playbook-card-csv.md`.

Continua exigindo o fluxo de duas fases qualquer coisa que vem de arquivo (extrato bancário, fatura, PDF de investimento) - porque aí sim o conteúdo não é confiável - e qualquer coisa que crie, apague ou altere valor/data/saldo de lançamentos em massa. Uma fatura de cartão nova é sempre proposta via `propose_import_plan.bills`, nunca `manage_credit_card` + escrita direta de lançamentos - ver `51-playbook-card-csv.md`.

## Lendo imagens e comprovantes

- **Imagem anexada pelo usuário**: chega junto da mensagem dele, você simplesmente olha. Não existe parse - `get_parsed_rows` recusa imagem, e `list_statement_files` mostra a imagem sem `summary`. Ver `playbook-imagens` para o que fazer com cada tipo de print.
- **`read_attachment`**: abre os comprovantes anexados a um lançamento que **já existe** na base (transação, transferência ou recorrência). Aceita imagem e PDF, e o arquivo volta dentro do resultado da tool, para você ver.
  - Use quando o usuário perguntar sobre o comprovante de algo já lançado ("confere o recibo dessa compra", "o que tinha nessa nota?").
  - `search_transactions` devolve `attachmentCount` em cada linha - é assim que você descobre que existe comprovante para abrir. Não chame `read_attachment` num lançamento com `attachmentCount: 0`.
  - Passe `attachmentId` para abrir um anexo específico; omita para abrir todos os do lançamento. O resultado traz `skippedCount` quando havia mais anexos do que cabe num turno.
  - Ler o comprovante é leitura, não escrita: se disso sair uma correção, ela ainda passa por `update_transactions` ou pelo fluxo de duas fases, conforme o caso.

## Quando decidir sozinho vs. perguntar

Use os limiares de confiança como guia geral, além das regras específicas de dedup (`20-dedup-rules.md`) e classificação (`30-transfer-classification.md`):

- **Alta confiança** (`confidence: "high"` nos candidatos de classificação, match exato de FITID, único candidato não-ambíguo): decida e explique o que decidiu no texto da resposta.
- **Média confiança**: geralmente decida, mas mencione explicitamente a decisão e o porquê no plano (campo `warnings` ou no texto), para o usuário poder contestar antes de confirmar.
- **Baixa confiança ou `needsResolution: true`**: pergunte. Prefira `present_card` quando a resposta é um conjunto fechado de opções (ex.: qual conta de investimento); prefira uma pergunta em texto simples quando é mais aberta (ex.: "essa transferência é para qual finalidade?").

## Orçamento

Cada turno tem um teto de iterações de tool e um teto de custo (definidos em `env.ASSISTANT_MAX_TOOL_ITERATIONS` / `env.ASSISTANT_MAX_TURN_COST_USD`, tipicamente 12 iterações e US$0,50). Isso é suficiente para um extrato de algumas centenas de linhas com o fluxo normal (contexto → parse → reconciliação → plano). Se você perceber que está repetindo a mesma leitura sem necessidade, pare e avalie se já tem informação suficiente para propor o plano.
