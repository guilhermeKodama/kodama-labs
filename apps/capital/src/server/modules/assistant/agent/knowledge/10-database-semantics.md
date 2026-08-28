# Como o Capital estrutura os dados

## Entidades

Todo dado financeiro pertence a uma de duas coisas:

- **`PersonalAccount`** - uma por usuário, a conta pessoal dele.
- **`Business`** - o usuário pode ter várias, cada uma com moeda padrão e alíquota de imposto próprias.

Quase todo modelo (`Transaction`, `Transfer`, `InvestmentAccount`, `StatementImport`, ...) é **polimórfico**: tem um `businessId` opcional e um `personalAccountId` opcional, e exatamente um dos dois está preenchido. O campo `entityType` (`business` | `personal`) diz qual é.

Quando o usuário disser algo como "minha conta" sem especificar, é quase sempre a `PersonalAccount`. Quando ele mencionar o nome de uma empresa, resolva para o `Business` correspondente via `get_context_snapshot`.

## Transaction

Um lançamento único: `amount` (sempre positivo - o sinal vem de `type`), `type` (`income` | `expense` | `investment`), `category` (string livre, não FK), `date`, `description`, `currency`.

- `externalId` é o FITID do OFX (ou nulo para lançamentos manuais). É único por entidade: `@@unique([externalId, businessId])` e `@@unique([externalId, personalAccountId])` - o mesmo FITID pode aparecer em duas entidades diferentes sem conflito, mas não duas vezes na mesma.
- `statementImportId` liga a transação ao lote que a criou.

## Transfer

Dinheiro que se move **entre** entidades do próprio usuário - nunca é `income`/`expense`. Tem `fromEntityType`/`toEntityType` e os pares `from*Id`/`to*Id` correspondentes (incluindo `fromInvestmentAccountId`/`toInvestmentAccountId` para aportes e resgates).

`direction` diz a natureza:
- `capital_injection` - o usuário colocou dinheiro pessoal numa empresa.
- `profit_distribution` - a empresa distribuiu lucro para o usuário.
- `reimbursement` - reembolso entre entidades.
- `investment_deposit` / `investment_withdrawal` - aporte/resgate de uma conta de investimento.

`Transfer.externalId` existe e é indexado, **mas não é único** - isso é proposital (uma transferência pode legitimamente repetir valor/data), então a deduplicação de transferência é feita checando se o FITID já foi usado por alguma `Transfer` existente antes de tratá-lo como novo (ver `20-dedup-rules.md`, Fase 0).

## StatementImport

O registro de um lote de importação: quantas transações entraram, saldo do extrato, categorização automática pendente/completa. Quando o lote vem do assistente, `source = "agent"` e `conversationId`/`importPlanId` apontam para a conversa e o plano que o geraram - isso é o que torna a reversão possível.

## CreditCard, CreditCardBill, BillTransaction, Installment

`CreditCard` (também polimórfico business/personal) tem várias `CreditCardBill` (uma por período de fatura), cada uma com várias `BillTransaction` (uma linha do CSV da fatura). `Installment` liga uma `BillTransaction` parcelada ao seu parcelamento completo (`totalInstallments`, `paidInstallments`) e persiste entre faturas - a parcela 3/10 de janeiro e a 4/10 de fevereiro são o mesmo `Installment`, atualizado, não duas linhas.

Uma linha de fatura **não é** uma `Transaction` - só existe como `BillTransaction`. O ledger (`Transaction`) só ganha uma entrada quando a fatura é explicitamente ligada a ele (`CreditCardBill.transactionId`, via `link_bill_to_transaction`), e é sempre UMA despesa com o total da fatura, nunca uma por linha. Ver `51-playbook-card-csv.md` e `90-tool-guide.md`.

`CreditCardBill` não tem unique constraint em `(creditCardId, closingDate)` - reenviar a mesma fatura substitui a anterior (a lógica de replace mora em `processBillCsv`, preserva categorizações manuais e o vínculo com o ledger).

## Categorias e moeda

`category` em `Transaction` é uma string livre, não uma foreign key - mas o Capital mantém uma lista de categorias por usuário (`Category`) e uma memória de mapeamento aprendido (`MerchantCategoryMapping`: descrição normalizada → categoria, com `source: "manual" | "ai"`). A categoria final tem que ser uma das que já existem em `get_context_snapshot.categories` - nunca invente uma categoria nova. Para a sequência completa de como decidir qual categoria usar antes de desistir e escrever `"Uncategorized"`, ver `25-categorization.md` - categorizar é o padrão em toda importação, não algo que espera o usuário pedir.

`exchangeRate` em `Transaction`/`Transfer` é a taxa relativa à moeda base do usuário (`User.baseCurrency`). Para lançamentos na própria moeda base, é `1`.
