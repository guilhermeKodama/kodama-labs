# Roteiro: fatura de cartão de crédito (CSV ou OFX)

Uma fatura chega tanto em CSV quanto em OFX (alguns bancos, Nubank incluso, exportam fatura como OFX em vez de CSV) - o arquivo é lido do mesmo jeito (`list_statement_files`/`get_parsed_rows`) e vira o mesmo formato de linha independente do original; você não precisa se importar com qual dos dois é.

Cada linha da fatura vira uma despesa **na conta do cartão**, contada na data de fechamento da fatura. O pagamento da fatura é outra coisa: uma transferência da conta corrente para o cartão (`card_payment`), que não conta como despesa. Nunca lance o pagamento como despesa comum - isso contaria o mesmo dinheiro duas vezes.

1. `list_statement_files` para o resumo do arquivo parseado - linhas, se há coluna de parcela detectada.
2. `get_parsed_rows` para ler as linhas normalizadas (`date`, `description`, `amount`, `installmentNumber`/`totalInstallments` quando existem, `isPayment`) - isso é só para você entender o conteúdo e montar o preview do plano; as linhas finais são recalculadas no commit a partir do arquivo real.
3. Linhas com `isPayment: true` são o pagamento da própria fatura feito no extrato do banco emissor, não uma despesa do cartão - exclua-as da contagem/total da fatura.
4. Verifique com `get_context_snapshot`/`list_credit_card_bills` se já existe um cartão cadastrado para esse banco/final. Se já existe, use o `closingDay`/`dueDay` desse cartão - não invente um novo. Se não existe, o plano cria um junto (branch `bills[].newCreditCard`): nem CSV nem OFX trazem o dia de vencimento (`dueDay`) de forma confiável - o arquivo só mostra o período da própria fatura, não a regra recorrente do cartão - então **pergunte o `dueDay` ao usuário antes de propor** em vez de adivinhar. `closingDay` pode ser aproximado a partir da data de fechamento desta fatura (`closingDate`, que você já vai montar no passo 7) quando o arquivo deixa isso claro, mas ainda assim é uma inferência de uma única ocorrência - se não tiver certeza, pergunte também. Cartão e fatura são campos independentes (`closingDay/dueDay` do cartão é só o padrão para próximas faturas; `closingDate/dueDate` da fatura é o valor real desta) - corrigir um não corrige o outro.
5. Confira com `list_credit_card_bills`/`search_bill_transactions` se já existe fatura para esse cartão nesse mês - se sim, subir de novo **não duplica**: só entram as linhas que ainda não estão na fatura. Avise o usuário quando isso acontecer.
6. Categorize as linhas que você conseguir inferir seguindo `25-categorization.md` (regras aprendidas → histórico → busca na web → só então sem categoria) - isso ajuda o preview do card; no commit, as regras de categorização do usuário são aplicadas de novo às linhas do arquivo.
7. Monte o branch `bills` do payload de `propose_import_plan`: `fileId` (o arquivo já anexado à conversa), `creditCardId` ou `newCreditCard`, `closingDate`, `dueDate`, e `previewTotalAmount`/`previewTransactionCount` (soma e contagem das linhas que não são pagamento - uma estimativa para o card, não precisa ser centavo a centavo).

## Registrando o pagamento da fatura

Use `link_bill_to_transaction`:

- **Conciliando um extrato bancário** e encontra uma linha "pagamento de fatura X"? Procure a fatura correspondente (`list_credit_card_bills`, pelo cartão e mês/valor) e use `action: "link_existing"` apontando para o lançamento que o extrato bancário criou - ele vira a transferência `card_payment` e deixa de contar como despesa. Esse é o caso mais comum.
- Se o usuário pedir para registrar o pagamento sem um lançamento de extrato correspondente (ex.: pagou por outro banco que não foi importado), use `action: "create_expense"` - cria o pagamento pelo total da fatura saindo da conta principal da entidade, já como `card_payment`.

## Corrigindo categoria depois de importado

`update_bill_transactions` corrige a categoria de compras do cartão já gravadas (até 100 por chamada) e aprende uma regra para a descrição - é a ferramenta certa quando o usuário disser "recategoriza essa fatura" ou "muda a categoria de X na fatura", em vez de tentar encaixar no branch `bills` do plano (que só importa linhas novas, não edita as existentes).

## Corrigindo fechamento/vencimento depois de importado

Se o usuário disser que a data de fechamento ou vencimento de uma fatura específica está errada, use `update_bill` (`billId` + `closingDate`/`dueDate`) - isso corrige só aquela fatura (e move as compras dela junto, já que contam na data de fechamento), sem tocar no cartão. Se em vez disso o usuário disser que o dia de fechamento/vencimento do **cartão** está errado (o padrão usado para as próximas faturas), use `manage_credit_card` com `action: "update"` - isso não altera faturas já criadas, propositalmente. Nunca assuma que corrigir um corrige o outro; se não estiver claro qual dos dois o usuário quer dizer, pergunte.
