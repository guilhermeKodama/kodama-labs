# Roteiro: fatura de cartão de crédito (CSV ou OFX)

Uma fatura chega tanto em CSV quanto em OFX (alguns bancos, Nubank incluso, exportam fatura como OFX em vez de CSV) - o arquivo é lido do mesmo jeito (`list_statement_files`/`get_parsed_rows`) e vira o mesmo formato de linha independente do original; você não precisa se importar com qual dos dois é.

Uma fatura **nunca** vira uma `Transaction` linha a linha. Cada linha é um `BillTransaction` dentro de um `CreditCardBill` - o ledger só recebe UMA despesa (o total da fatura), e só quando alguém pedir isso explicitamente (ver "Ligando a fatura ao ledger" abaixo). Tratar cada linha como despesa comum conta o mesmo dinheiro duas vezes assim que o pagamento da fatura aparecer num extrato bancário.

1. `list_statement_files` para o resumo do arquivo parseado - linhas, se há coluna de parcela detectada.
2. `get_parsed_rows` para ler as linhas normalizadas (`date`, `description`, `amount`, `installmentNumber`/`totalInstallments` quando existem, `isPayment`) - isso é só para você entender o conteúdo e montar o preview do plano; os números finais são recalculados no commit a partir do arquivo real.
3. Linhas com `isPayment: true` são o pagamento da própria fatura feito no extrato do banco emissor, não uma despesa do cartão - exclua-as da contagem/total da fatura.
4. Verifique com `get_context_snapshot`/`list_credit_card_bills` se já existe um `CreditCard` cadastrado para esse banco/final. Se já existe, use o `closingDay`/`dueDay` desse cartão - não invente um novo. Se não existe, o plano cria um junto (branch `bills[].newCreditCard`): nem CSV nem OFX trazem o dia de vencimento (`dueDay`) de forma confiável - o arquivo só mostra o período da própria fatura, não a regra recorrente do cartão - então **pergunte o `dueDay` ao usuário antes de propor** em vez de adivinhar. `closingDay` pode ser aproximado a partir da data de fechamento desta fatura (`closingDate`, que você já vai montar no passo 7) quando o arquivo deixa isso claro, mas ainda assim é uma inferência de uma única ocorrência, não a regra recorrente confirmada - se não tiver certeza, pergunte também. Card e fatura já são campos independentes no banco (`CreditCard.closingDay/dueDay` é só o padrão pra próximas faturas; `CreditCardBill.closingDate/dueDate` é o valor real desta fatura) - corrigir um não corrige o outro automaticamente.
5. Confira com `list_credit_card_bills`/`search_bill_transactions` se já existe fatura para esse cartão nesse período - se sim, subir de novo vai **substituir** a fatura existente (preservando categorizações manuais e o vínculo com o ledger), não duplicar. Isso é esperado, mas avise o usuário antes de propor.
6. Categorize as linhas que você conseguir inferir seguindo `25-categorization.md` (memória de mapeamentos → histórico → busca na web → só então `Uncategorized`) - isso ajuda o preview do card a já mostrar categorias plausíveis, mesmo que a categorização real na fatura seja recalculada no commit a partir dos mesmos mapeamentos.
7. Monte o branch `bills` do payload de `propose_import_plan`: `fileId` (o arquivo já anexado à conversa), `creditCardId` ou `newCreditCard`, `closingDate`, `dueDate`, e `previewTotalAmount`/`previewTransactionCount` (soma e contagem das linhas que não são pagamento - uma estimativa para o card, não precisa ser centavo a centavo).

## Ligando a fatura ao ledger

Depois que a fatura existe, ela só vira uma despesa no ledger se algo pedir isso - use `link_bill_to_transaction`:

- **Conciliando um extrato bancário** e encontra uma linha "pagamento de fatura X"? Procure a fatura correspondente (`list_credit_card_bills`, pelo cartão e período/valor) e use `action: "link_existing"` apontando para a `Transaction` que o extrato bancário vai criar - não crie uma segunda despesa "Credit Card" solta. Esse é o caso mais comum: o pagamento já vem do extrato do banco, a fatura só precisa ser amarrada a ele.
- Se o usuário pedir para lançar a fatura como despesa sem ter um pagamento de extrato correspondente (ex.: fatura ainda não paga, mas ele quer que já apareça no fluxo de caixa), use `action: "create_expense"`.

## Corrigindo categoria depois de importado

`update_bill_transactions` corrige a categoria de linhas já gravadas (até 100 por chamada) - é a ferramenta certa quando o usuário disser "recategoriza essa fatura" ou "muda a categoria de X na fatura", em vez de tentar encaixar no branch `bills` do plano (que só cria fatura nova, não edita uma existente).

## Corrigindo fechamento/vencimento depois de importado

Se o usuário disser que a data de fechamento ou vencimento de uma fatura específica está errada, use `update_bill` (`billId` + `closingDate`/`dueDate`) - isso corrige só aquela fatura, sem tocar no cartão. Se em vez disso o usuário disser que o dia de fechamento/vencimento do **cartão** está errado (o padrão usado para as próximas faturas), use `manage_credit_card` com `action: "update"` - isso não altera faturas já criadas, propositalmente, já que cada uma guarda sua própria data. Nunca assuma que corrigir um corrige o outro; se não estiver claro qual dos dois o usuário quer dizer, pergunte.
