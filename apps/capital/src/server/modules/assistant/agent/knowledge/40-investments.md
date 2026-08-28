# Como investimentos funcionam no Capital

## Hierarquia

`InvestmentAccount` (uma corretora/conta, ex. "NuInvest", "Interactive Brokers") → tem várias `InvestmentHolding` (uma posição por ativo, ex. "PETR4", "CDB Nubank 120% CDI") → cada holding tem várias `InvestmentTransaction` (compra, venda, dividendo, rendimento, ...).

`InvestmentAccount.cashBalance` é o caixa disponível na conta, não investido. Aportes (`investment_deposit`) aumentam esse saldo; resgates (`investment_withdrawal`) diminuem.

## InvestmentHolding

Identifica o ativo: `assetClass` (`stocks`, `fii`, `etf`, `bdr`, `fixed_income`, `crypto`, `savings`, `international_stocks`, `international_etf`), `subType` só para renda fixa (`cdb`, `rdb`, `lci`, `lca`, `cdi`, `tesouro_selic`, `tesouro_ipca`, `tesouro_prefixado`, `debenture`), `ticker` (quando existe), `name`.

`currentQuantity`, `averageCost` e `totalInvested` são recalculados a partir do histórico de `InvestmentTransaction` - não os edite diretamente ao propor um plano; eles são derivados pelo mesmo service que já cuida disso hoje (`recalculate-holding`), acionado depois que as transações são criadas.

Se o PDF menciona um ativo que ainda não existe como `InvestmentHolding`, o plano pode incluir a criação da holding junto com a primeira transação (branch `newHolding` do payload) - não crie uma holding "solta" sem transação associada.

## InvestmentTransaction

`type`: `buy`, `sell`, `dividend`, `yield_payment`, `split`, `deposit`, `withdrawal`, `adjustment`. `quantity`/`pricePerUnit` fazem sentido para ativos com unidades (ações, FIIs, cripto); para renda fixa muitas vezes só `totalAmount` é relevante.

`linkedTransactionId` liga opcionalmente a movimentação de investimento a uma `Transaction` comum (ex.: o débito na conta corrente que financiou a compra) - normalmente não é algo que o assistente precisa preencher a partir de um PDF de corretora isolado.

## Funding: Transfer ↔ InvestmentAccount

Quando dinheiro sai da conta pessoal/empresa para uma corretora (ou volta), isso é sempre um `Transfer` com `direction: investment_deposit|investment_withdrawal` e `fromInvestmentAccountId`/`toInvestmentAccountId` apontando para a conta - nunca uma `InvestmentTransaction` do tipo `deposit`/`withdrawal` sozinha sem o `Transfer` correspondente, exceto quando o PDF só mostra o lado da corretora (aporte que já foi registrado do lado da conta bancária em outro extrato) - nesse caso registre só a `InvestmentTransaction` e não duplique o `Transfer`.

## Extraindo de um PDF

PDFs de corretora não têm formato padronizado. Leia o documento anexado à mensagem com atenção a: nome do ativo/ticker, data do pregão ou da liquidação, quantidade, preço unitário, valor total, taxas. Quando um valor estiver ambíguo (ex.: não fica claro se é bruto ou líquido de IR), prefira perguntar a assumir - erro em posição de investimento é mais caro de corrigir depois que em uma transação comum.

## Gerenciando contas e posições fora de um import

`manage_investment_account`, `manage_investment_holding`, `record_investment_transaction` e `fund_investment_account` cobrem o que o usuário já consegue fazer manualmente na tela de Investimentos - criar conta, criar posição, lançar um movimento avulso, mover caixa - só que pelo chat. Ver `90-tool-guide.md` para quando usar cada uma em vez do fluxo de `propose_import_plan`.

Pontos importantes:

- **Não existe delete nessas tools, só desativar** (`isActive: false`). Conta e posição arrastam histórico de transações; apagar de verdade só pela tela manual, se o usuário realmente quiser. Se pedirem para "remover" uma conta/posição pelo chat, desative.
- `manage_investment_holding` nunca aceita `currentQuantity`/`averageCost`/`totalInvested` diretamente - esses três só se movem através de `record_investment_transaction`, que aciona o recálculo (`recalculate-holding`) depois de cada movimento. Isso vale tanto para uma transação avulta quanto para uma vinda de um plano de import.
- `fund_investment_account` cria uma `Transaction` (expense no deposit, income no withdraw) na conta/empresa dona, e ajusta `cashBalance` da conta de investimento - é o mesmo mecanismo que o botão "Aportar/Resgatar" da tela manual usa. Isso é **diferente** do `Transfer` com `direction: investment_deposit|investment_withdrawal` descrito acima: aquele é para quando o PDF/OFX já mostra o aporte como fato consumado (dá para reconciliar automaticamente); `fund_investment_account` é para quando é o próprio usuário pedindo a movimentação, sem arquivo nenhum por trás. Não confunda os dois - não crie um `Transfer` de investimento a partir de um pedido feito só em texto no chat.
- Ao criar uma conta nova (`manage_investment_account` com `action: "create"`), `businessId`/`personalAccountId` precisa ser de uma entidade que já existe e pertence ao usuário - confirme com `get_context_snapshot` antes se não tiver certeza do id.

## Investimento identificado sem conta/posição cadastrada

Se uma linha do extrato é um movimento de investimento (aplicação, resgate, dividendo, rendimento, ou uma contraparte que é claramente corretora/banco de investimento) e a `InvestmentAccount`/`InvestmentHolding` correspondente não existe, **resolva isso como parte da importação** - não registre como transação comum com uma nota pedindo para o usuário criar a conta depois. Deixar assim polui os relatórios (vira receita/despesa comum) e o trabalho volta pro usuário.

O caminho:

1. Confirme com `query_investment_holdings` o que já existe - o nome no extrato pode ser variação de uma conta cadastrada ("NuInvest" vs "Nubank Investment").
2. Se realmente falta, pergunte **só o mínimo que você não consegue inferir**: normalmente o nome da corretora já vem no extrato, então a pergunta costuma ser a moeda da conta (e a entidade dona, se o usuário tiver mais de uma). Uma pergunta objetiva, não uma lista de pendências.
3. Crie com `manage_investment_account` (e `manage_investment_holding` quando der para identificar o ativo), depois monte o plano de importação já classificando a linha corretamente como aporte/resgate.

Quando faltar informação que muda o significado do lançamento (é resgate ou é receita?), pergunte antes de propor o plano - mas pergunte **junto com a proposta de criar a conta**, não como um impedimento separado. O objetivo é que uma resposta do usuário destrave tudo.
