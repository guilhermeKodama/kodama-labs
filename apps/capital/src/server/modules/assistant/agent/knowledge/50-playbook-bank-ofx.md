# Roteiro: extrato bancário (OFX)

1. `list_statement_files` para confirmar que o arquivo foi parseado (`parseStatus: "parsed"`) e ver o resumo: banco, período, moeda, saldo do extrato.
2. Se o usuário não disse a qual conta o extrato pertence, pergunte (ou infira com confiança alta se só houver uma entidade cadastrada do tipo mencionado).
3. `get_context_snapshot` para ter entidades, categorias, cartões e contas de investimento em mãos antes de classificar.
4. `reconcile_statement(fileId, entityType, entityId)` - isso já roda dedup + classificação contra a base real.
5. Percorra o resultado: separe `duplicate` (ignorar), `changed` (avaliar magnitude, ver `20-dedup-rules.md`), `fuzzy_match` (sempre card de decisão), `new` (classificar pelo candidato sugerido).
6. Para `new` com candidato não-regular incerto, use `get_parsed_rows` se precisar reler o texto completo do memo (campo `fullDescription`) para decidir - não peça ao usuário para colar informação que já está no arquivo.
7. Categorize cada linha que vai virar `Transaction` seguindo `25-categorization.md` (memória de mapeamentos → histórico → busca na web → só então `Uncategorized`). Isso faz parte da importação normal - não deixe tudo em `Uncategorized` esperando o usuário pedir depois.
8. Se alguma linha parece movimento de investimento (aplicação, resgate, dividendo, corretora como contraparte) e a conta/posição correspondente não existe, resolva isso agora - ver `40-investments.md`, seção "Investimento identificado sem conta/posição cadastrada".
9. Monte o payload de `propose_import_plan`: `transactions` para o que vai virar `Transaction`, `transfers`/`investmentTransfers` para o que foi classificado como transferência, `reconciliations` para os `changed` que você decidiu atualizar, `duplicateDecisions` para os `fuzzy_match` já respondidos pelo usuário nesta conversa. Cada item de `transfers` leva `flow` (`outflow`/`inflow`) copiado do sinal da linha, não deduzido do `direction` - ver `30-transfer-classification.md`. `type` de `transactions`, `flow` de `transfers` e o valor de todos eles são conferidos contra as linhas do arquivo; se não baterem, a tool recusa o plano inteiro.
8. Se ainda houver `fuzzy_match` sem decisão do usuário, apresente o card `duplicate_review` **antes** de propor o plano final - o plano deve refletir decisões já tomadas, não abrir com pendências que forcem um segundo ciclo desnecessário.
9. Confira `computeBalanceDiscrepancy` (já vem no resultado de `reconcile_statement`): se o saldo não bater, avise no texto - não esconda a divergência.
