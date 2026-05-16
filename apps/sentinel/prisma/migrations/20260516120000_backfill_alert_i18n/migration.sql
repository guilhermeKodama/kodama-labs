-- Backfill historical alerts: rewrite title/description with neutral pt-BR wording
-- and add the data.i18n template-key block so the UI can render in the active locale.
--
-- Runs once via `prisma migrate deploy` (already in the build script). Each UPDATE
-- filters out rows that already have data.i18n.titleKey set, so re-runs are safe.
--
-- Also cleans aiAnalysis.response rows still carrying the old accusatory Claude output.

-- ---------------------------------------------------------------------------
-- Helper: pt-BR currency formatting (R$ 12.345,67)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION pg_temp._fmt_brl(v numeric) RETURNS text AS $$
DECLARE
  s text;
BEGIN
  IF v IS NULL THEN RETURN '';
  END IF;
  s := to_char(v, 'FM999999999990.00');
  s := regexp_replace(s, '\.', '@', 'g');
  s := regexp_replace(s, '(\d)(?=(\d{3})+@)', '\1.', 'g');
  s := regexp_replace(s, '@', ',', 'g');
  RETURN 'R$ ' || s;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ---------------------------------------------------------------------------
-- SHELL_COMPANY
-- ---------------------------------------------------------------------------

UPDATE alerts a SET
  title = 'Empresa com indicadores incomuns: ' || e.name,
  description = 'Entidade ' || e.name || ' (' || e.cnpj || ') apresenta ' ||
                jsonb_array_length(a.data->'flags') || ' indicador(es) que recomendam revisão: ' ||
                COALESCE((
                  SELECT string_agg(
                    CASE flag
                      WHEN 'recently_created'   THEN 'Aberta pouco antes do primeiro contrato'
                      WHEN 'low_capital'        THEN 'Capital social baixo frente ao valor do contrato'
                      WHEN 'single_shareholder' THEN 'Apenas um sócio cadastrado'
                      ELSE flag
                    END, ', '
                  )
                  FROM jsonb_array_elements_text(a.data->'flags') AS flag
                ), '') || '.',
  data = a.data || jsonb_build_object(
    'i18n', jsonb_build_object(
      'titleKey', 'alerts.templates.shellCompany.title',
      'descriptionKey', 'alerts.templates.shellCompany.description',
      'params', jsonb_build_object(
        'entityName', e.name,
        'cnpj', e.cnpj,
        'flagCount', jsonb_array_length(a.data->'flags'),
        'flags', COALESCE((
          SELECT string_agg(flag, ',')
          FROM jsonb_array_elements_text(a.data->'flags') AS flag
        ), '')
      )
    )
  )
FROM entities e
WHERE a."entityId" = e.id
  AND a.type = 'SHELL_COMPANY'
  AND (a.data->'i18n'->>'titleKey') IS NULL;

-- ---------------------------------------------------------------------------
-- SANCTIONED_ENTITY
-- ---------------------------------------------------------------------------

UPDATE alerts a SET
  title = 'Fornecedor com sanção pública registrada e contrato ativo: ' || c."supplierName",
  description = 'A empresa ' || c."supplierName" || ' (' || c."supplierCnpj" || ') possui sanção(ões) registrada(s) em ' ||
                COALESCE((
                  SELECT string_agg(elem->>'source', ', ')
                  FROM jsonb_array_elements(a.data->'sanctions') AS elem
                ), 'fonte desconhecida') ||
                ' e consta com ' || COALESCE((a.data->>'contractCount')::int, 1) || ' contrato(s) governamental(is).',
  data = a.data || jsonb_build_object(
    'i18n', jsonb_build_object(
      'titleKey', 'alerts.templates.sanctionedEntity.title',
      'descriptionKey', 'alerts.templates.sanctionedEntity.description',
      'params', jsonb_build_object(
        'supplierName', c."supplierName",
        'cnpj', c."supplierCnpj",
        'sources', COALESCE((
          SELECT string_agg(elem->>'source', ', ')
          FROM jsonb_array_elements(a.data->'sanctions') AS elem
        ), 'fonte desconhecida'),
        'contractCount', COALESCE((a.data->>'contractCount')::int, 1)
      )
    )
  )
FROM contracts c
WHERE a."contractId" = c.id
  AND a.type = 'SANCTIONED_ENTITY'
  AND (a.data->'i18n'->>'titleKey') IS NULL;

-- ---------------------------------------------------------------------------
-- SUSPICIOUS_NETWORK
-- ---------------------------------------------------------------------------

UPDATE alerts a SET
  title = 'Sócio em comum entre fornecedores na mesma licitação',
  description = 'As empresas ' ||
                COALESCE((
                  SELECT string_agg(elem->>'name', ' e ')
                  FROM jsonb_array_elements(a.data->'entities') AS elem
                ), '') ||
                ' compartilham o mesmo sócio (CPF: ' || COALESCE(a.data->>'shareholderCpf', '') || ')' ||
                ' e participaram da mesma licitação "' || COALESCE(a.data->>'procurementDescription', p.description) || '"' ||
                ' do órgão ' || p."orgName" ||
                ' — padrão recomendado para verificação.',
  data = a.data || jsonb_build_object(
    'i18n', jsonb_build_object(
      'titleKey', 'alerts.templates.suspiciousNetwork.title',
      'descriptionKey', 'alerts.templates.suspiciousNetwork.description',
      'params', jsonb_build_object(
        'entities', COALESCE((
          SELECT string_agg(elem->>'name', ' e ')
          FROM jsonb_array_elements(a.data->'entities') AS elem
        ), ''),
        'shareholderCpf', COALESCE(a.data->>'shareholderCpf', ''),
        'procurementDescription', COALESCE(a.data->>'procurementDescription', p.description),
        'orgName', p."orgName"
      )
    )
  )
FROM procurements p
WHERE a."procurementId" = p.id
  AND a.type = 'SUSPICIOUS_NETWORK'
  AND (a.data->'i18n'->>'titleKey') IS NULL;

-- ---------------------------------------------------------------------------
-- OVERPRICING — market_price
-- ---------------------------------------------------------------------------

UPDATE alerts a SET
  title = 'Preço acima da mediana de referência: ' ||
          to_char(COALESCE((a.data->>'deviation')::numeric, 0), 'FM999990') || '% acima',
  description = 'Item "' || COALESCE(SUBSTRING(pi.description FROM 1 FOR 100), '') || '"' ||
                CASE WHEN COALESCE(a.data->>'context', '') = '' THEN ''
                     ELSE ' (contexto: ' || (a.data->>'context') || ')' END ||
                ' com preço R$' || to_char(COALESCE((a.data->>'unitPrice')::numeric, 0), 'FM999999990.00') ||
                ' está ' || to_char(COALESCE((a.data->>'deviation')::numeric, 0), 'FM999990') || '% acima da mediana R$' ||
                to_char(COALESCE((a.data->>'medianReference')::numeric, 0), 'FM999999990.00') ||
                ' de Atas de Registro de Preço do PNCP (' || COALESCE((a.data->>'referenceCount')::int, 0) || ' referência(s), confiança: ' ||
                CASE COALESCE(a.data->>'confidence', 'low')
                  WHEN 'high'   THEN 'Alta'
                  WHEN 'medium' THEN 'Média'
                  WHEN 'low'    THEN 'Baixa'
                  ELSE COALESCE(a.data->>'confidence', 'low')
                END || ').',
  data = a.data || jsonb_build_object(
    'i18n', jsonb_build_object(
      'titleKey', 'alerts.templates.overpricingMarket.title',
      'descriptionKey', 'alerts.templates.overpricingMarket.description',
      'params', jsonb_build_object(
        'deviationPct', to_char(COALESCE((a.data->>'deviation')::numeric, 0), 'FM999990'),
        'itemDescription', COALESCE(SUBSTRING(pi.description FROM 1 FOR 100), ''),
        'contextLabel', CASE WHEN COALESCE(a.data->>'context', '') = '' THEN ''
                             ELSE ' (contexto: ' || (a.data->>'context') || ')' END,
        'unitPrice', 'R$' || to_char(COALESCE((a.data->>'unitPrice')::numeric, 0), 'FM999999990.00'),
        'median', 'R$' || to_char(COALESCE((a.data->>'medianReference')::numeric, 0), 'FM999999990.00'),
        'sampleSize', COALESCE((a.data->>'referenceCount')::int, 0),
        'confidence', COALESCE(a.data->>'confidence', 'low')
      )
    )
  )
FROM procurement_items pi
WHERE (a.data->>'itemId') = pi.id
  AND a.type = 'OVERPRICING'
  AND a.data->>'method' = 'market_price'
  AND (a.data->'i18n'->>'titleKey') IS NULL;

-- ---------------------------------------------------------------------------
-- OVERPRICING — catmat_iqr / description_iqr
-- ---------------------------------------------------------------------------

UPDATE alerts a SET
  title = 'Preço acima da mediana de referência: ' ||
          to_char(COALESCE((a.data->>'deviation')::numeric, 0), 'FM999990') || '% acima',
  description = 'Item "' || COALESCE(SUBSTRING(pi.description FROM 1 FOR 100), '') || '"' ||
                CASE WHEN COALESCE(a.data->>'context', '') = '' THEN ''
                     ELSE ' (contexto: ' || (a.data->>'context') || ')' END ||
                ' com preço R$' || to_char(COALESCE((a.data->>'unitPrice')::numeric, 0), 'FM999999990.00') ||
                ' está ' || to_char(COALESCE((a.data->>'deviation')::numeric, 0), 'FM999990') || '% acima da mediana R$' ||
                to_char(COALESCE((a.data->>'median')::numeric, 0), 'FM999999990.00') ||
                ' (amostra: ' || COALESCE((a.data->>'sampleSize')::int, 0) ||
                ', confiança: ' || CASE COALESCE(a.data->>'confidence', 'low')
                                    WHEN 'high'   THEN 'Alta'
                                    WHEN 'medium' THEN 'Média'
                                    WHEN 'low'    THEN 'Baixa'
                                    ELSE COALESCE(a.data->>'confidence', 'low')
                                  END ||
                ', método: ' || CASE a.data->>'method'
                                  WHEN 'market_price'      THEN 'Comparação com Atas PNCP'
                                  WHEN 'catmat_iqr'        THEN 'CATMAT (IQR)'
                                  WHEN 'description_iqr'   THEN 'Descrição similar (IQR)'
                                  WHEN 'bid_spread'        THEN 'Spread entre lances'
                                  ELSE COALESCE(a.data->>'method', '')
                                END || ').',
  data = a.data || jsonb_build_object(
    'i18n', jsonb_build_object(
      'titleKey', 'alerts.templates.overpricingIqr.title',
      'descriptionKey', 'alerts.templates.overpricingIqr.description',
      'params', jsonb_build_object(
        'deviationPct', to_char(COALESCE((a.data->>'deviation')::numeric, 0), 'FM999990'),
        'itemDescription', COALESCE(SUBSTRING(pi.description FROM 1 FOR 100), ''),
        'contextLabel', CASE WHEN COALESCE(a.data->>'context', '') = '' THEN ''
                             ELSE ' (contexto: ' || (a.data->>'context') || ')' END,
        'unitPrice', 'R$' || to_char(COALESCE((a.data->>'unitPrice')::numeric, 0), 'FM999999990.00'),
        'median', 'R$' || to_char(COALESCE((a.data->>'median')::numeric, 0), 'FM999999990.00'),
        'sampleSize', COALESCE((a.data->>'sampleSize')::int, 0),
        'confidence', COALESCE(a.data->>'confidence', 'low'),
        'method', COALESCE(a.data->>'method', '')
      )
    )
  )
FROM procurement_items pi
WHERE (a.data->>'itemId') = pi.id
  AND a.type = 'OVERPRICING'
  AND a.data->>'method' IN ('catmat_iqr', 'description_iqr')
  AND (a.data->'i18n'->>'titleKey') IS NULL;

-- ---------------------------------------------------------------------------
-- OVERPRICING — bid_spread (estimate-deviation branch, deviation > 30)
-- ---------------------------------------------------------------------------

UPDATE alerts a SET
  title = 'Lance vencedor acima do valor estimado',
  description = 'Preço vencedor R$' || to_char(COALESCE((a.data->>'winningBid')::numeric, 0), 'FM999999990.00') ||
                ' é ' || to_char(COALESCE((a.data->>'estimateDeviation')::numeric, 0), 'FM999990') || '% acima do estimado R$' ||
                to_char(COALESCE((a.data->>'estimatedPrice')::numeric, 0), 'FM999999990.00') ||
                '. Item "' || COALESCE(SUBSTRING(pi.description FROM 1 FOR 120), '') || '"' ||
                ' na licitação de ' || p."orgName" || '. 0 lance(s) registrado(s).',
  data = a.data || jsonb_build_object(
    'i18n', jsonb_build_object(
      'titleKey', 'alerts.templates.overpricingBidEstimate.title',
      'descriptionKey', 'alerts.templates.overpricingBidEstimate.description',
      'params', jsonb_build_object(
        'winningBid', 'R$' || to_char(COALESCE((a.data->>'winningBid')::numeric, 0), 'FM999999990.00'),
        'estimatedPrice', 'R$' || to_char(COALESCE((a.data->>'estimatedPrice')::numeric, 0), 'FM999999990.00'),
        'deviationPct', to_char(COALESCE((a.data->>'estimateDeviation')::numeric, 0), 'FM999990'),
        'itemDescription', COALESCE(SUBSTRING(pi.description FROM 1 FOR 120), ''),
        'orgName', p."orgName",
        'bidCount', 0
      )
    )
  )
FROM procurement_items pi, procurements p
WHERE (a.data->>'itemId') = pi.id
  AND a."procurementId" = p.id
  AND a.type = 'OVERPRICING'
  AND a.data->>'method' = 'bid_spread'
  AND COALESCE((a.data->>'estimateDeviation')::numeric, 0) > 30
  AND (a.data->'i18n'->>'titleKey') IS NULL;

-- ---------------------------------------------------------------------------
-- OVERPRICING — bid_spread (spread branch, deviation <= 30)
-- ---------------------------------------------------------------------------

UPDATE alerts a SET
  title = 'Spread atípico entre lances',
  description = 'Lance máximo ' || to_char(COALESCE((a.data->>'bidSpreadRatio')::numeric, 0), 'FM999990.0') ||
                'x o lance mínimo (fora da faixa esperada). Item "' || COALESCE(SUBSTRING(pi.description FROM 1 FOR 120), '') || '"' ||
                ' na licitação de ' || p."orgName" || '. 0 lance(s) registrado(s).',
  data = a.data || jsonb_build_object(
    'i18n', jsonb_build_object(
      'titleKey', 'alerts.templates.overpricingBidSpread.title',
      'descriptionKey', 'alerts.templates.overpricingBidSpread.description',
      'params', jsonb_build_object(
        'bidSpreadRatio', to_char(COALESCE((a.data->>'bidSpreadRatio')::numeric, 0), 'FM999990.0'),
        'itemDescription', COALESCE(SUBSTRING(pi.description FROM 1 FOR 120), ''),
        'orgName', p."orgName",
        'bidCount', 0
      )
    )
  )
FROM procurement_items pi, procurements p
WHERE (a.data->>'itemId') = pi.id
  AND a."procurementId" = p.id
  AND a.type = 'OVERPRICING'
  AND a.data->>'method' = 'bid_spread'
  AND COALESCE((a.data->>'estimateDeviation')::numeric, 0) <= 30
  AND (a.data->'i18n'->>'titleKey') IS NULL;

-- ---------------------------------------------------------------------------
-- POLITICAL_LINK — SHAREHOLDER_IS_POLITICIAN
-- ---------------------------------------------------------------------------

UPDATE alerts a SET
  title = 'Político consta como sócio de fornecedor do governo — vínculo a revisar',
  description = COALESCE(a.data->>'politicianName', '') ||
                ' (' || COALESCE(a.data->>'party', '') || '/' || COALESCE(a.data->>'state', '') ||
                ' - ' || COALESCE(a.data->>'position', '') || ')' ||
                ' consta como sócio da empresa ' || COALESCE(a.data->>'entityName', '') ||
                ' (CNPJ: ' || COALESCE(a.data->>'entityCnpj', '') || '),' ||
                ' que possui ' || COALESCE((a.data->>'contractCount')::int, 0) ||
                ' contrato(s) governamental(is) totalizando ' || pg_temp._fmt_brl(COALESCE((a.data->>'totalContractValue')::numeric, 0)) || '.',
  data = a.data || jsonb_build_object(
    'i18n', jsonb_build_object(
      'titleKey', 'alerts.templates.politicianShareholder.title',
      'descriptionKey', 'alerts.templates.politicianShareholder.description',
      'params', jsonb_build_object(
        'politicianName', COALESCE(a.data->>'politicianName', ''),
        'party', COALESCE(a.data->>'party', ''),
        'state', COALESCE(a.data->>'state', ''),
        'position', COALESCE(a.data->>'position', ''),
        'entityName', COALESCE(a.data->>'entityName', ''),
        'entityCnpj', COALESCE(a.data->>'entityCnpj', ''),
        'contractCount', COALESCE((a.data->>'contractCount')::int, 0),
        'totalContractValue', pg_temp._fmt_brl(COALESCE((a.data->>'totalContractValue')::numeric, 0))
      )
    )
  )
WHERE a.type = 'POLITICAL_LINK'
  AND a.data->>'linkType' = 'SHAREHOLDER_IS_POLITICIAN'
  AND (a.data->'i18n'->>'titleKey') IS NULL;

-- ---------------------------------------------------------------------------
-- POLITICAL_LINK — SUPPLIER_DONATED
-- ---------------------------------------------------------------------------

UPDATE alerts a SET
  title = 'Fornecedor consta como doador de campanha — vínculo a revisar',
  description = COALESCE(a.data->>'entityName', '') ||
                ' (' || COALESCE(a.data->>'entityCnpj', '') || ')' ||
                ' consta com doação de ' || pg_temp._fmt_brl(COALESCE((a.data->>'totalDonated')::numeric, 0)) ||
                ' para ' || COALESCE(a.data->>'politicianName', '') ||
                ' (' || COALESCE(a.data->>'party', '') || ')' ||
                ' e possui ' || pg_temp._fmt_brl(COALESCE((a.data->>'totalContractValue')::numeric, 0)) ||
                ' em contratos governamentais.',
  data = a.data || jsonb_build_object(
    'i18n', jsonb_build_object(
      'titleKey', 'alerts.templates.supplierDonated.title',
      'descriptionKey', 'alerts.templates.supplierDonated.description',
      'params', jsonb_build_object(
        'entityName', COALESCE(a.data->>'entityName', ''),
        'entityCnpj', COALESCE(a.data->>'entityCnpj', ''),
        'totalDonated', pg_temp._fmt_brl(COALESCE((a.data->>'totalDonated')::numeric, 0)),
        'politicianName', COALESCE(a.data->>'politicianName', ''),
        'party', COALESCE(a.data->>'party', ''),
        'totalContractValue', pg_temp._fmt_brl(COALESCE((a.data->>'totalContractValue')::numeric, 0))
      )
    )
  )
WHERE a.type = 'POLITICAL_LINK'
  AND a.data->>'linkType' = 'SUPPLIER_DONATED'
  AND (a.data->'i18n'->>'titleKey') IS NULL;

-- ---------------------------------------------------------------------------
-- POLITICAL_LINK — DONOR_GOT_CONTRACT
-- ---------------------------------------------------------------------------

UPDATE alerts a SET
  title = 'Doador de campanha consta com contratos na mesma jurisdição — vínculo a revisar',
  description = COALESCE(a.data->>'donorName', '') ||
                ' consta com doação de ' || pg_temp._fmt_brl(COALESCE((a.data->>'totalDonated')::numeric, 0)) ||
                ' para ' || COALESCE(a.data->>'politicianName', '') ||
                ' (' || COALESCE(a.data->>'party', '') || '/' || COALESCE(a.data->>'state', '') || ')' ||
                ' e recebeu ' || pg_temp._fmt_brl(COALESCE((a.data->>'totalContractValue')::numeric, 0)) ||
                ' em contratos governamentais na mesma região.',
  data = a.data || jsonb_build_object(
    'i18n', jsonb_build_object(
      'titleKey', 'alerts.templates.donorGotContract.title',
      'descriptionKey', 'alerts.templates.donorGotContract.description',
      'params', jsonb_build_object(
        'donorName', COALESCE(a.data->>'donorName', ''),
        'totalDonated', pg_temp._fmt_brl(COALESCE((a.data->>'totalDonated')::numeric, 0)),
        'politicianName', COALESCE(a.data->>'politicianName', ''),
        'party', COALESCE(a.data->>'party', ''),
        'state', COALESCE(a.data->>'state', ''),
        'totalContractValue', pg_temp._fmt_brl(COALESCE((a.data->>'totalContractValue')::numeric, 0))
      )
    )
  )
WHERE a.type = 'POLITICAL_LINK'
  AND a.data->>'linkType' = 'DONOR_GOT_CONTRACT'
  AND (a.data->'i18n'->>'titleKey') IS NULL;

-- ---------------------------------------------------------------------------
-- POLITICAL_LINK — FAMILY_IN_SUPPLIER
-- ---------------------------------------------------------------------------

UPDATE alerts a SET
  title = 'Pessoa cadastrada como familiar do político consta como sócio de fornecedor — vínculo a revisar',
  description = COALESCE(a.data->>'shareholderName', '') ||
                ' (' || CASE COALESCE(a.data->>'relationship', '')
                          WHEN 'mother'      THEN 'mãe'
                          WHEN 'father'      THEN 'pai'
                          WHEN 'brother'     THEN 'irmão(ã)'
                          WHEN 'spouse'      THEN 'cônjuge'
                          WHEN 'son'         THEN 'filho(a)'
                          WHEN 'nephew'      THEN 'sobrinho(a)'
                          WHEN 'cousin'      THEN 'primo(a)'
                          WHEN 'uncle'       THEN 'tio(a)'
                          WHEN 'grandparent' THEN 'avô/avó'
                          WHEN 'grandson'    THEN 'neto(a)'
                          ELSE COALESCE(a.data->>'relationship', '')
                        END ||
                ' de ' || COALESCE(a.data->>'politicianName', '') || ',' ||
                ' ' || COALESCE(a.data->>'party', '') || '/' || COALESCE(a.data->>'state', '') || ')' ||
                ' consta como sócio de ' || COALESCE(a.data->>'entityName', '') ||
                ' (' || COALESCE(a.data->>'entityCnpj', '') || ').',
  data = a.data || jsonb_build_object(
    'i18n', jsonb_build_object(
      'titleKey', 'alerts.templates.familyInSupplier.title',
      'descriptionKey', 'alerts.templates.familyInSupplier.description',
      'params', jsonb_build_object(
        'shareholderName', COALESCE(a.data->>'shareholderName', ''),
        'relationshipLabel', COALESCE(a.data->>'relationship', ''),
        'politicianName', COALESCE(a.data->>'politicianName', ''),
        'party', COALESCE(a.data->>'party', ''),
        'state', COALESCE(a.data->>'state', ''),
        'entityName', COALESCE(a.data->>'entityName', ''),
        'entityCnpj', COALESCE(a.data->>'entityCnpj', '')
      )
    )
  )
WHERE a.type = 'POLITICAL_LINK'
  AND a.data->>'linkType' = 'FAMILY_IN_SUPPLIER'
  AND (a.data->'i18n'->>'titleKey') IS NULL;

-- ---------------------------------------------------------------------------
-- POLITICAL_LINK — FAMILY_DONATED
-- ---------------------------------------------------------------------------

UPDATE alerts a SET
  title = 'Pessoa cadastrada como familiar do político consta como doador de campanha — vínculo a revisar',
  description = COALESCE(a.data->>'donorName', '') ||
                ' (' || CASE COALESCE(a.data->>'relationship', '')
                          WHEN 'mother'      THEN 'mãe'
                          WHEN 'father'      THEN 'pai'
                          WHEN 'brother'     THEN 'irmão(ã)'
                          WHEN 'spouse'      THEN 'cônjuge'
                          WHEN 'son'         THEN 'filho(a)'
                          WHEN 'nephew'      THEN 'sobrinho(a)'
                          WHEN 'cousin'      THEN 'primo(a)'
                          WHEN 'uncle'       THEN 'tio(a)'
                          WHEN 'grandparent' THEN 'avô/avó'
                          WHEN 'grandson'    THEN 'neto(a)'
                          ELSE COALESCE(a.data->>'relationship', '')
                        END ||
                ' de ' || COALESCE(a.data->>'politicianName', '') || ',' ||
                ' ' || COALESCE(a.data->>'party', '') || '/' || COALESCE(a.data->>'state', '') || ')' ||
                ' consta com doação de ' || pg_temp._fmt_brl(COALESCE((a.data->>'amount')::numeric, 0)) || '.',
  data = a.data || jsonb_build_object(
    'i18n', jsonb_build_object(
      'titleKey', 'alerts.templates.familyDonated.title',
      'descriptionKey', 'alerts.templates.familyDonated.description',
      'params', jsonb_build_object(
        'donorName', COALESCE(a.data->>'donorName', ''),
        'relationshipLabel', COALESCE(a.data->>'relationship', ''),
        'politicianName', COALESCE(a.data->>'politicianName', ''),
        'party', COALESCE(a.data->>'party', ''),
        'state', COALESCE(a.data->>'state', ''),
        'amount', pg_temp._fmt_brl(COALESCE((a.data->>'amount')::numeric, 0))
      )
    )
  )
WHERE a.type = 'POLITICAL_LINK'
  AND a.data->>'linkType' = 'FAMILY_DONATED'
  AND (a.data->'i18n'->>'titleKey') IS NULL;

-- ---------------------------------------------------------------------------
-- POLITICAL_LINK — POLITICIAN_IS_SERVANT
-- ---------------------------------------------------------------------------

UPDATE alerts a SET
  title = 'Político consta com vínculo de servidor público federal',
  description = COALESCE(a.data->>'politicianName', '') ||
                ' (' || COALESCE(a.data->>'party', '') || '/' || COALESCE(a.data->>'state', '') ||
                ' - ' || COALESCE(a.data->>'position', '') || ')' ||
                ' possui vínculo como servidor: ' || COALESCE(NULLIF(a.data->>'cargo', ''), 'N/I') ||
                ' no ' || COALESCE(NULLIF(a.data->>'orgao', ''), 'N/I') || '.',
  data = a.data || jsonb_build_object(
    'i18n', jsonb_build_object(
      'titleKey', 'alerts.templates.politicianServant.title',
      'descriptionKey', 'alerts.templates.politicianServant.description',
      'params', jsonb_build_object(
        'politicianName', COALESCE(a.data->>'politicianName', ''),
        'party', COALESCE(a.data->>'party', ''),
        'state', COALESCE(a.data->>'state', ''),
        'position', COALESCE(a.data->>'position', ''),
        'cargo', COALESCE(NULLIF(a.data->>'cargo', ''), 'N/I'),
        'orgao', COALESCE(NULLIF(a.data->>'orgao', ''), 'N/I')
      )
    )
  )
WHERE a.type = 'POLITICAL_LINK'
  AND a.data->>'linkType' = 'POLITICIAN_IS_SERVANT'
  AND (a.data->'i18n'->>'titleKey') IS NULL;

-- ---------------------------------------------------------------------------
-- POLITICAL_LINK — WEALTH_ANOMALY
-- ---------------------------------------------------------------------------

UPDATE alerts a SET
  title = 'Variação patrimonial atípica entre declarações eleitorais — verificar',
  description = COALESCE(a.data->>'politicianName', '') ||
                ' (' || COALESCE(a.data->>'party', '') || '/' || COALESCE(a.data->>'state', '') || ')' ||
                ' declarou patrimônio de ' || pg_temp._fmt_brl(COALESCE((a.data->>'previousTotal')::numeric, 0)) ||
                ' em ' || COALESCE((a.data->>'previousYear')::int, 0) ||
                ' e ' || pg_temp._fmt_brl(COALESCE((a.data->>'currentTotal')::numeric, 0)) ||
                ' em ' || COALESCE((a.data->>'currentYear')::int, 0) ||
                ' (variação de ' || to_char(COALESCE((a.data->>'growthPercentage')::numeric, 0), 'FM999990') || '%).',
  data = a.data || jsonb_build_object(
    'i18n', jsonb_build_object(
      'titleKey', 'alerts.templates.wealthAnomaly.title',
      'descriptionKey', 'alerts.templates.wealthAnomaly.description',
      'params', jsonb_build_object(
        'politicianName', COALESCE(a.data->>'politicianName', ''),
        'party', COALESCE(a.data->>'party', ''),
        'state', COALESCE(a.data->>'state', ''),
        'previousTotal', pg_temp._fmt_brl(COALESCE((a.data->>'previousTotal')::numeric, 0)),
        'previousYear', COALESCE((a.data->>'previousYear')::int, 0),
        'currentTotal', pg_temp._fmt_brl(COALESCE((a.data->>'currentTotal')::numeric, 0)),
        'currentYear', COALESCE((a.data->>'currentYear')::int, 0),
        'growthPercentage', to_char(COALESCE((a.data->>'growthPercentage')::numeric, 0), 'FM999990')
      )
    )
  )
WHERE a.type = 'POLITICAL_LINK'
  AND a.data->>'linkType' = 'WEALTH_ANOMALY'
  AND (a.data->'i18n'->>'titleKey') IS NULL;

-- ---------------------------------------------------------------------------
-- POLITICAL_LINK — DONOR_IS_SHAREHOLDER
-- ---------------------------------------------------------------------------

UPDATE alerts a SET
  title = 'Doador de campanha também consta como sócio de fornecedor — vínculo a revisar',
  description = COALESCE(a.data->>'donorName', '') ||
                ' consta com doação de ' || pg_temp._fmt_brl(COALESCE((a.data->>'totalDonated')::numeric, 0)) ||
                ' para ' || COALESCE(a.data->>'politicianName', '') ||
                ' (' || COALESCE(a.data->>'party', '') || '/' || COALESCE(a.data->>'state', '') || ')' ||
                ' e é sócio de ' || COALESCE(a.data->>'entityName', '') ||
                ' (' || COALESCE(a.data->>'entityCnpj', '') || ')' ||
                ' com ' || pg_temp._fmt_brl(COALESCE((a.data->>'totalContractValue')::numeric, 0)) || ' em contratos.',
  data = a.data || jsonb_build_object(
    'i18n', jsonb_build_object(
      'titleKey', 'alerts.templates.donorIsShareholder.title',
      'descriptionKey', 'alerts.templates.donorIsShareholder.description',
      'params', jsonb_build_object(
        'donorName', COALESCE(a.data->>'donorName', ''),
        'totalDonated', pg_temp._fmt_brl(COALESCE((a.data->>'totalDonated')::numeric, 0)),
        'politicianName', COALESCE(a.data->>'politicianName', ''),
        'party', COALESCE(a.data->>'party', ''),
        'state', COALESCE(a.data->>'state', ''),
        'entityName', COALESCE(a.data->>'entityName', ''),
        'entityCnpj', COALESCE(a.data->>'entityCnpj', ''),
        'totalContractValue', pg_temp._fmt_brl(COALESCE((a.data->>'totalContractValue')::numeric, 0))
      )
    )
  )
WHERE a.type = 'POLITICAL_LINK'
  AND a.data->>'linkType' = 'DONOR_IS_SHAREHOLDER'
  AND (a.data->'i18n'->>'titleKey') IS NULL;

-- ---------------------------------------------------------------------------
-- POLITICAL_LINK — DONATION_TIMING
-- (Legacy data does not store the "depois"/"antes" direction; default to "depois".)
-- ---------------------------------------------------------------------------

UPDATE alerts a SET
  title = 'Doação e contrato com proximidade temporal — vínculo a revisar',
  description = COALESCE(a.data->>'entityName', '') ||
                ' consta com doação para ' || COALESCE(a.data->>'politicianName', '') ||
                ' e recebeu contrato ' || COALESCE((a.data->>'gapMonths')::int, 0) ||
                ' meses depois — ' || pg_temp._fmt_brl(COALESCE((a.data->>'totalContractValue')::numeric, 0)) ||
                ' em contratos próximos.',
  data = a.data || jsonb_build_object(
    'i18n', jsonb_build_object(
      'titleKey', 'alerts.templates.donationTiming.title',
      'descriptionKey', 'alerts.templates.donationTiming.description',
      'params', jsonb_build_object(
        'entityName', COALESCE(a.data->>'entityName', ''),
        'politicianName', COALESCE(a.data->>'politicianName', ''),
        'gapMonths', COALESCE((a.data->>'gapMonths')::int, 0),
        'direction', 'depois',
        'totalContractValue', pg_temp._fmt_brl(COALESCE((a.data->>'totalContractValue')::numeric, 0))
      )
    )
  )
WHERE a.type = 'POLITICAL_LINK'
  AND a.data->>'linkType' = 'DONATION_TIMING'
  AND (a.data->'i18n'->>'titleKey') IS NULL;

-- ---------------------------------------------------------------------------
-- POLITICAL_LINK — DONOR_CONCENTRATION
-- (Legacy data does not store the formatted politicianNames list; show count only.)
-- ---------------------------------------------------------------------------

UPDATE alerts a SET
  title = 'Empresa consta com doação para ' || COALESCE((a.data->>'politicianCount')::int, 0) ||
          ' políticos e contratos governamentais',
  description = COALESCE(a.data->>'entityName', '') ||
                ' (' || COALESCE(a.data->>'entityCnpj', '') || ')' ||
                ' consta com doação de ' || pg_temp._fmt_brl(COALESCE((a.data->>'totalDonated')::numeric, 0)) ||
                ' para ' || COALESCE((a.data->>'politicianCount')::int, 0) || ' políticos diferentes' ||
                ' — possui ' || COALESCE((a.data->>'contractCount')::int, 0) || ' contrato(s).',
  data = a.data || jsonb_build_object(
    'i18n', jsonb_build_object(
      'titleKey', 'alerts.templates.donorConcentration.title',
      'descriptionKey', 'alerts.templates.donorConcentration.description',
      'params', jsonb_build_object(
        'politicianCount', COALESCE((a.data->>'politicianCount')::int, 0),
        'entityName', COALESCE(a.data->>'entityName', ''),
        'entityCnpj', COALESCE(a.data->>'entityCnpj', ''),
        'totalDonated', pg_temp._fmt_brl(COALESCE((a.data->>'totalDonated')::numeric, 0)),
        'politicianNames', COALESCE((a.data->>'politicianCount')::int, 0) || ' políticos diferentes',
        'contractCount', COALESCE((a.data->>'contractCount')::int, 0)
      )
    )
  )
WHERE a.type = 'POLITICAL_LINK'
  AND a.data->>'linkType' = 'DONOR_CONCENTRATION'
  AND (a.data->'i18n'->>'titleKey') IS NULL;

-- ---------------------------------------------------------------------------
-- AI_FLAG
-- (Description = findings.summary if present, else a neutral placeholder.)
-- ---------------------------------------------------------------------------

UPDATE alerts a SET
  title = 'Análise IA sinaliza pontos a revisar: ' || p."orgName",
  description = COALESCE(
    NULLIF(SUBSTRING((a.data->'findings'->>'summary') FROM 1 FOR 500), ''),
    'Pontos a revisar identificados em análise anterior — recomenda-se reavaliação.'
  ),
  data = a.data || jsonb_build_object(
    'i18n', jsonb_build_object(
      'titleKey', 'alerts.templates.aiFlag.title',
      'descriptionKey', 'alerts.templates.aiFlag.description',
      'params', jsonb_build_object(
        'orgName', p."orgName",
        'summary', COALESCE(
          NULLIF(SUBSTRING((a.data->'findings'->>'summary') FROM 1 FOR 500), ''),
          'Pontos a revisar identificados em análise anterior — recomenda-se reavaliação.'
        )
      )
    )
  )
FROM procurements p
WHERE a."procurementId" = p.id
  AND a.type = 'AI_FLAG'
  AND (a.data->'i18n'->>'titleKey') IS NULL;

-- ---------------------------------------------------------------------------
-- aiAnalysis.response — overwrite raw old-prompt Claude output with findings.summary
-- (only rows whose response still contains the old accusatory vocabulary)
-- ---------------------------------------------------------------------------

UPDATE ai_analyses SET
  response = COALESCE(
    NULLIF(SUBSTRING((findings->>'summary') FROM 1 FOR 500), ''),
    'Análise pré-atualização de redação — texto original removido. Recomenda-se reanálise.'
  )
WHERE response ~* '(fraude|corrupção|conluio|empresa de fachada|suspeit|anômal|criminal|ilegal)';

-- ---------------------------------------------------------------------------
-- Cleanup helper function
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS pg_temp._fmt_brl(numeric);
