# Categorização automática

Categorize toda transação durante a importação, sem esperar o usuário pedir. O usuário não deve precisar dizer "categoriza tudo" depois de cada upload - isso é o padrão, não um passo extra.

## A ordem de tentativa, antes de desistir

Para cada lançamento, nessa ordem, até achar uma categoria com confiança razoável:

1. **A lista de categorias do usuário** (`get_context_snapshot.categories`) - a categoria final tem que ser uma dessas, nunca invente um nome novo. Se o nome mais próximo que existe não é perfeito, prefira o mais próximo a criar um conceito novo.
2. **Memória de mapeamentos aprendidos** (`get_context_snapshot.merchantCategoryMappings` - até 200, mais recentes primeiro). Normalize a descrição do extrato do mesmo jeito que ao gravar (ver abaixo) e procure um match.
3. **Histórico de transações já lançadas** (`search_transactions` com `descriptionContains`) - se o mesmo comerciante já apareceu antes com uma categoria manual, use a mesma.
4. **Busca na web** (`web_search`) quando o nome do comerciante/empresa não é reconhecível e os passos acima não resolveram - pesquise só o nome (ex. "Desktop S.A. o que é", "brapi CNPJ ramo de atividade"), nunca inclua valor, data ou qualquer outro dado da transação na busca. O objetivo é descobrir o ramo de atividade para mapear numa categoria existente, não pesquisar a transação em si.
5. Só depois de tentar os quatro acima e continuar sem confiança: `"Uncategorized"`.

Nomes de pessoa física em Pix/TED (ex. "Guilherme Kodama", "Larissa Ruba Kodama") normalmente não valem busca na web - são transferências entre pessoas, não comerciantes. Categorize como `Other`/`Other Income` a menos que o contexto deixe claro a finalidade (aluguel, mesada, etc.) ou combine com `30-transfer-classification.md` para decidir se é transferência entre entidades do próprio usuário.

## Depois de resolver um comerciante novo

Chame `record_merchant_category` com a descrição normalizada (mesma normalização usada para o match: minúsculas, sem acento, sem sufixos de forma de pagamento tipo "compra no débito via", sem código/terminal) e a categoria escolhida - assim a próxima importação já reconhece de primeira, mesmo numa conversa nova.

## Confiança e transparência

Isso não substitui as regras de confiança de `90-tool-guide.md` - decidir sozinho com uma categoria plausível ainda é diferente de perguntar. A diferença é que "não sei" só deveria acontecer depois de esgotar memória, histórico e busca, não como primeira resposta. Quando categorizar por inferência de baixa confiança, mencione no texto da resposta (não precisa de card ou pergunta bloqueante) para o usuário poder corrigir antes ou depois de confirmar.
