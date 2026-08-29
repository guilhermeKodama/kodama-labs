# Roteiro: extrato de investimentos (PDF)

PDFs não são parseados deterministicamente - o arquivo chega para você como bloco de documento na mensagem. Leia com atenção; não há um `get_parsed_rows` para investimentos.

1. `query_investment_holdings` para ver as contas e posições que já existem, antes de decidir se um ativo do PDF é uma posição nova ou uma que já existe.
2. Leia o documento e extraia, por movimentação: ativo/ticker, data, tipo (compra/venda/dividendo/rendimento/...), quantidade, preço unitário, valor total, taxas.
3. Calcule o `externalId` de cada movimentação seguindo a fórmula de `20-dedup-rules.md` - isso é o que permite reenviar o mesmo PDF sem duplicar.
4. Para cada movimentação, monte a entrada em `investmentTransactions` do payload de `propose_import_plan`: se o ativo já existe como `InvestmentHolding` (bateu por ticker + conta), referencie `holdingId`; senão, inclua `newHolding` com os dados para criá-la.
5. Se o PDF menciona um aporte ou resgate de caixa que ainda não está registrado como `Transfer`, pergunte ao usuário se ele já lançou isso pelo extrato bancário antes de incluir - duplicar aporte é um erro caro (ver `40-investments.md`).
6. Valores ambíguos (bruto vs. líquido de IR, taxa de custódia embutida ou não) são para perguntar, não assumir.
7. Se houver mais de uma `InvestmentAccount` cadastrada e o PDF não deixar claro qual corretora é, pergunte antes de montar o plano.
