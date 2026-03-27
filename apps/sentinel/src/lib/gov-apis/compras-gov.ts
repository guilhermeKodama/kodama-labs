const BASE_URL = "https://compras.dados.gov.br";

export interface ComprasGovFornecedor {
  id_fornecedor: string;
  cnpj: string;
  nome: string;
  ativo: boolean;
  recadastrado: boolean;
  habilitado: boolean;
}

export interface ComprasGovMaterial {
  codigo: number;
  descricao: string;
  id_grupo: number;
  id_classe: number;
  status: boolean;
  sustentavel: boolean;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchComprasGov<T>(
  endpoint: string,
  params: Record<string, string> = {}
): Promise<{ _embedded: Record<string, T[]>; count: number }> {
  const url = new URL(`${BASE_URL}${endpoint}.json`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

  const maxRetries = 2;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    try {
      const response = await fetch(url.toString(), {
        headers: {
          Accept: "application/json",
          "User-Agent": "Sentinel/1.0 (gov-procurement-auditor)",
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(
          `Compras Gov API error: ${response.status} ${response.statusText} for ${endpoint}`
        );
      }

      return response.json();
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

export async function fetchFornecedores(
  offset: number = 0,
  limit: number = 500
): Promise<{ data: ComprasGovFornecedor[]; count: number }> {
  const result = await fetchComprasGov<ComprasGovFornecedor>(
    "/fornecedores/v1/fornecedores",
    { offset: offset.toString(), limit: limit.toString() }
  );
  return {
    data: result._embedded?.fornecedores ?? [],
    count: result.count,
  };
}

export interface ComprasGovIrpItem {
  numero_irp: string;
  numero_item_irp: number;
  descricao_item: string;
  codigo_item_material: number;
  descricao_item_material: string;
  quantidade_estimada: number;
  valor_unitario_estimado: number;
  valor_total_estimado: number;
  unidade_fornecimento: string;
  data_criacao: string;
  codigo_uasg: string;
}

export async function fetchIrpByMaterial(
  materialCode: number,
  offset: number = 0,
  limit: number = 100
): Promise<{ data: ComprasGovIrpItem[]; count: number }> {
  const result = await fetchComprasGov<ComprasGovIrpItem>(
    "/licitacoes/v1/irps",
    {
      item_material: materialCode.toString(),
      offset: offset.toString(),
      limit: limit.toString(),
    }
  );
  return {
    data: result._embedded?.irps ?? [],
    count: result.count,
  };
}

export async function fetchMateriais(
  grupoId?: number,
  offset: number = 0,
  limit: number = 500
): Promise<{ data: ComprasGovMaterial[]; count: number }> {
  const params: Record<string, string> = {
    offset: offset.toString(),
    limit: limit.toString(),
  };
  if (grupoId) params.id_grupo = grupoId.toString();

  const result = await fetchComprasGov<ComprasGovMaterial>(
    "/materiais/v1/materiais",
    params
  );
  return {
    data: result._embedded?.materiais ?? [],
    count: result.count,
  };
}
