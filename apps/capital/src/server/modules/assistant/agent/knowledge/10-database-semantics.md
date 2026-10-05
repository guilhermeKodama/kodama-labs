# Como o Capital estrutura os dados

## Entidades e contas

Todo dado financeiro pertence a uma **entidade** (`Entity`):

- **Pessoal** (`kind: "personal"`) - uma por usuário. Nas ferramentas ela aparece como `personalAccountId` / `entityType: "personal"`.
- **Empresa** (`kind: "business"`) - o usuário pode ter várias, cada uma com moeda padrão e alíquota próprias. Aparece como `businessId` / `entityType: "business"`.

Cada entidade tem **contas** (`Account`): uma conta corrente principal ("Conta principal", criada junto com a entidade), cartões de crédito (`type: "credit_card"`), corretoras (`type: "brokerage"`) e eventualmente outras contas correntes ou dinheiro. Quando uma ferramenta pede só a entidade, o lançamento cai na conta principal dela.

Quando o usuário disser algo como "minha conta" sem especificar, é quase sempre a entidade pessoal. Quando ele mencionar o nome de uma empresa, resolva para a entidade correspondente via `get_context_snapshot`.

## Lançamentos (o ledger)

Tudo que movimenta dinheiro é um **lançamento** (`LedgerEntry`) numa conta: receitas, despesas, compras no cartão, movimentos de investimento e cada perna de uma transferência. As ferramentas chamam isso de "transaction":

- `amount` vem sempre positivo nas ferramentas; o tipo (`income` | `expense` | `investment`) diz o sentido.
- `category` é uma categoria cadastrada do usuário (por nome nas ferramentas; por id no banco). Lançamento sem categoria é válido - fica para a categorização automática.
- `externalId` é o FITID do OFX (ou nulo para lançamentos manuais). É único por conta: o mesmo FITID pode existir em duas contas, nunca duas vezes na mesma.
- `statementImportId` liga o lançamento à importação que o criou - é por isso que desfazer uma importação manda exatamente aqueles lançamentos para a lixeira.
- Cada lançamento guarda o valor convertido para a moeda base no momento em que foi gravado (`exchangeRate` = quanto vale 1 unidade da moeda do lançamento na moeda base; `1` para a própria moeda base).

Apagar um lançamento manda para a **lixeira** (restaurável por 30 dias); toda alteração em lote pode ser desfeita.

## Transferências

Dinheiro que se move **entre** contas do próprio usuário - nunca é `income`/`expense`. Uma transferência é um grupo de duas pernas: sai de uma conta, entra em outra, e as duas se anulam no total.

O sentido do dinheiro está nas pernas (quem pagou, quem recebeu), **não** em `direction` - o mesmo `direction` aparece nos dois sentidos dependendo de qual lado é o extrato importado. Ver `30-transfer-classification.md`.

`direction` diz a natureza:
- `capital_injection` - o usuário colocou dinheiro pessoal numa empresa.
- `profit_distribution` - a empresa distribuiu lucro para o usuário.
- `reimbursement` - reembolso entre entidades (conta como despesa da empresa).
- `investment_deposit` / `investment_withdrawal` - aporte/resgate de uma corretora.
- `card_payment` - pagamento de fatura de cartão (da conta corrente para o cartão).
- `between_accounts` - entre duas contas da mesma entidade.

`externalId` da transferência guarda o FITID de origem; a deduplicação checa se o FITID já foi usado por alguma transferência antes de tratá-lo como novo (ver `20-dedup-rules.md`, Fase 0).

## Importações

O registro de um lote de importação: quantos lançamentos entraram, saldo do extrato, categorização pendente/completa. Quando o lote vem do assistente, `source = "agent"` e `conversationId`/`importPlanId` apontam para a conversa e o plano que o geraram.

## Cartão de crédito, faturas e parcelas

Um cartão é uma conta `credit_card` com `closingDay`/`dueDay` (o padrão para as próximas faturas). Cada mês tem uma **fatura** (`CardStatement`, chamada de "bill" nas ferramentas) com sua própria `closingDate`/`dueDate`.

Cada linha da fatura **é** um lançamento de despesa na conta do cartão - é ela que conta no orçamento e nos relatórios, na data de fechamento da fatura. O pagamento da fatura, que sai da conta corrente, é uma transferência `card_payment` para o cartão, nunca uma segunda despesa. Por isso uma linha "pagamento de fatura" no extrato bancário deve ser ligada à fatura (`link_bill_to_transaction`), não lançada como despesa comum. Ver `51-playbook-card-csv.md`.

Compras parceladas ficam ligadas a um parcelamento: a parcela atual entra na fatura do mês e as próximas já ficam lançadas como compromisso nas faturas futuras; quando a fatura seguinte é importada, a parcela real substitui o compromisso.

Reenviar a mesma fatura não duplica nada: as linhas são comparadas como multiconjunto (data, valor, descrição, parcela) e só entra o que ainda não está lá.

## Categorias e moeda

O Capital mantém uma lista de categorias por usuário e **regras de categorização** aprendidas (descrição normalizada → categoria, com `source: "manual" | "ai" | "bulk"`). A categoria final tem que ser uma das que já existem em `get_context_snapshot.categories` - nunca invente uma categoria nova. Para a sequência completa de como decidir a categoria antes de deixar um lançamento sem categoria, ver `25-categorization.md` - categorizar é o padrão em toda importação, não algo que espera o usuário pedir.
