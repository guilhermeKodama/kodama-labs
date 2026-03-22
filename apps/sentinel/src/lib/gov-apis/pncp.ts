const CONSULTA_URL = "https://pncp.gov.br/api/consulta";
const API_URL = "https://pncp.gov.br/pncp-api";

const DEFAULT_MODALITIES = [6, 8, 4, 1, 2, 3, 5, 7, 9, 10, 11, 12, 13];

// ============================================
// Interfaces - Bulk listing endpoints
// ============================================

export interface PncpProcurement {
  orgaoEntidade: {
    cnpj: string;
    razaoSocial: string;
    poderId: string;
    esferaId: string;
  };
  unidadeOrgao: {
    ufNome: string | null;
    ufSigla: string | null;
    municipioNome: string | null;
    nomeUnidade: string;
    codigoUnidade: string;
    codigoIbge: string;
  };
  anoCompra: number;
  sequencialCompra: number;
  numeroCompra: string;
  processo: string;
  objetoCompra: string;
  modalidadeId: number;
  modalidadeNome: string;
  dataPublicacaoPncp: string;
  dataInclusao: string;
  dataAberturaProposta: string | null;
  dataEncerramentoProposta: string | null;
  situacaoCompraId: number;
  situacaoCompraNome: string;
  valorTotalEstimado: number | null;
  valorTotalHomologado: number | null;
  numeroControlePNCP: string;
  amparoLegal?: {
    codigo: number;
    nome: string;
    descricao: string;
  };
  modoDisputaId: number;
  modoDisputaNome: string;
  srp: boolean;
  tipoInstrumentoConvocatorioCodigo: number;
  tipoInstrumentoConvocatorioNome: string;
  linkSistemaOrigem: string | null;
  linkProcessoEletronico: string | null;
  fontesOrcamentarias: unknown[];
  informacaoComplementar: string | null;
}

export interface PncpContract {
  orgaoEntidade: {
    cnpj: string;
    razaoSocial: string;
    poderId: string;
    esferaId: string;
  };
  unidadeOrgao: {
    ufNome: string | null;
    ufSigla: string | null;
    municipioNome: string | null;
    nomeUnidade: string;
    codigoUnidade?: string;
  };
  niFornecedor: string;
  nomeRazaoSocialFornecedor: string;
  tipoPessoa: string;
  codigoPaisFornecedor: string;
  anoContrato: number;
  sequencialContrato: number;
  numeroContratoEmpenho: string;
  objetoContrato: string;
  processo: string;
  dataAssinatura: string;
  dataVigenciaInicio: string;
  dataVigenciaFim: string | null;
  dataPublicacaoPncp: string;
  valorInicial: number | null;
  valorGlobal: number | null;
  valorParcela: number | null;
  valorAcumulado: number | null;
  numeroParcelas: number;
  numeroRetificacao: number;
  receita: boolean;
  numeroControlePNCP: string;
  numeroControlePncpCompra: string | null;
  categoriaProcesso?: { id: number; nome: string };
  tipoContrato?: { id: number; nome: string };
  informacaoComplementar: string | null;
  niFornecedorSubContratado: string | null;
  nomeFornecedorSubContratado: string | null;
  tipoPessoaSubContratada: string | null;
}

// ============================================
// Interfaces - Detail endpoints (pncp-api)
// ============================================

export interface PncpItem {
  numeroItem: number;
  descricao: string;
  materialOuServico: string;
  materialOuServicoNome: string;
  valorUnitarioEstimado: number;
  valorTotal: number;
  quantidade: number;
  unidadeMedida: string;
  orcamentoSigiloso: boolean;
  itemCategoriaId: number;
  itemCategoriaNome: string;
  criterioJulgamentoId: number;
  criterioJulgamentoNome: string;
  situacaoCompraItem: number;
  situacaoCompraItemNome: string;
  tipoBeneficio: number;
  tipoBeneficioNome: string;
  temResultado: boolean;
  ncmNbsCodigo: string | null;
  ncmNbsDescricao: string | null;
  catalogo: string | null;
  categoriaItemCatalogo: string | null;
  catalogoCodigoItem: string | null;
  informacaoComplementar: string | null;
  dataInclusao: string;
  dataAtualizacao: string;
}

export interface PncpBidResult {
  numeroItem: number;
  sequencialResultado: number;
  niFornecedor: string;
  nomeRazaoSocialFornecedor: string;
  tipoPessoa: string;
  codigoPais: string;
  porteFornecedorId: number;
  porteFornecedorNome: string;
  quantidadeHomologada: number;
  valorUnitarioHomologado: number;
  valorTotalHomologado: number;
  percentualDesconto: number;
  ordemClassificacaoSrp: number;
  dataResultado: string;
  situacaoCompraItemResultadoId: number;
  situacaoCompraItemResultadoNome: string;
  indicadorSubcontratacao: boolean;
  aplicacaoMargemPreferencia: boolean;
  aplicacaoBeneficioMeEpp: boolean;
  aplicacaoCriterioDesempate: boolean;
  motivoCancelamento: string | null;
  dataCancelamento: string | null;
  numeroControlePNCPCompra: string;
}

export interface PncpResponse<T> {
  data: T[];
  totalRegistros?: number;
  totalPaginas?: number;
  paginaAtual?: number;
}

// ============================================
// Fetch helpers
// ============================================

const POLITE_DELAY_MS = 1000;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchWithTimeout<T>(
  url: string,
  timeoutMs: number = 30000
): Promise<T> {
  const maxRetries = 2;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        headers: {
          Accept: "application/json",
          "User-Agent": "Sentinel/1.0 (gov-procurement-auditor)",
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new Error(`PNCP API error: ${response.status} for ${url} - ${body}`);
      }

      return response.json() as Promise<T>;
    } catch (err) {
      clearTimeout(timeout);
      if (attempt === maxRetries) throw err;
      await sleep(attempt * 3000);
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new Error("Unreachable");
}

async function fetchPncp<T>(
  endpoint: string,
  params: Record<string, string>
): Promise<PncpResponse<T>> {
  const url = new URL(`${CONSULTA_URL}${endpoint}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  return fetchWithTimeout<PncpResponse<T>>(url.toString(), 45000);
}

// ============================================
// Bulk listing endpoints (pncp-consulta)
// ============================================

export async function fetchProcurements(
  startDate: string,
  endDate: string,
  page: number = 1,
  pageSize: number = 50,
  modalities: number[] = DEFAULT_MODALITIES
): Promise<PncpResponse<PncpProcurement>> {
  const allData: PncpProcurement[] = [];

  for (const modality of modalities) {
    try {
      const response = await fetchPncp<PncpProcurement>(
        "/v1/contratacoes/publicacao",
        {
          dataInicial: startDate,
          dataFinal: endDate,
          codigoModalidadeContratacao: modality.toString(),
          pagina: page.toString(),
          tamanhoPagina: Math.max(10, pageSize).toString(),
        }
      );
      if (response.data) {
        allData.push(...response.data);
      }
    } catch {
      // Some modalities may not have data or timeout
    }
    await sleep(POLITE_DELAY_MS);
  }

  return { data: allData };
}

export async function fetchContracts(
  startDate: string,
  endDate: string,
  page: number = 1,
  pageSize: number = 50
): Promise<PncpResponse<PncpContract>> {
  return fetchPncp<PncpContract>("/v1/contratos", {
    dataInicial: startDate,
    dataFinal: endDate,
    pagina: page.toString(),
    tamanhoPagina: Math.max(10, pageSize).toString(),
  });
}

// ============================================
// Detail endpoints (pncp-api)
// ============================================

export async function fetchProcurementItems(
  orgCnpj: string,
  year: number,
  sequencial: number
): Promise<PncpItem[]> {
  const url = `${API_URL}/v1/orgaos/${orgCnpj}/compras/${year}/${sequencial}/itens`;
  return fetchWithTimeout<PncpItem[]>(url, 15000);
}

export async function fetchItemResults(
  orgCnpj: string,
  year: number,
  sequencial: number,
  itemNumber: number
): Promise<PncpBidResult[]> {
  const url = `${API_URL}/v1/orgaos/${orgCnpj}/compras/${year}/${sequencial}/itens/${itemNumber}/resultados`;
  return fetchWithTimeout<PncpBidResult[]>(url, 15000);
}
