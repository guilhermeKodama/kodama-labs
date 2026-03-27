import { env } from "@/env";

const BASE_URL = "https://api.portaldatransparencia.gov.br/api-de-dados";

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function getHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "User-Agent": "Sentinel/1.0 (gov-procurement-auditor)",
  };
  if (env.TRANSPARENCIA_API_KEY) {
    headers["chave-api-dados"] = env.TRANSPARENCIA_API_KEY;
  }
  return headers;
}

async function fetchTransparencia<T>(
  endpoint: string,
  params: Record<string, string>
): Promise<T[]> {
  const url = new URL(`${BASE_URL}${endpoint}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

  const maxRetries = 2;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    try {
      const response = await fetch(url.toString(), {
        headers: getHeaders(),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(
          `Portal Transparencia API error: ${response.status} ${response.statusText} for ${endpoint}`
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

export interface TransparenciaLicitacao {
  id: number;
  dataAbertura: string;
  dataReferencia: string;
  modalidadeCompra: { descricao: string };
  orgaoEntidade: { cnpj: string; razaoSocial: string };
  objeto: string;
  situacaoCompra: { descricao: string };
  valorLicitacao: number;
  uf?: string;
  municipio?: string | {
    nomeIBGE?: string;
    codigoIBGE?: string;
    uf?: { nome?: string; sigla?: string };
    pais?: string;
    nomeRegiao?: string;
    codigoRegiao?: string;
  };
}

export interface TransparenciaContrato {
  id: number;
  dataInicioVigencia: string;
  dataFimVigencia: string;
  fornecedor: { cnpjFormatado: string; nome: string };
  objeto: string;
  valorInicial: number;
  orgaoEntidade: { cnpj: string; razaoSocial: string };
}

export interface TransparenciaSanction {
  id: number;
  cpfCnpj: string;
  nomeSancionado: string;
  categoriaSancao: string;
  descricaoFundamentacao: string;
  dataInicioSancao: string;
  dataFinalSancao: string | null;
  orgaoSancionador: { nome: string };
}

export async function fetchLicitacoes(
  startDate: string,
  endDate: string,
  page: number = 1,
  pageSize: number = 100,
  codigoOrgao?: string
): Promise<TransparenciaLicitacao[]> {
  const params: Record<string, string> = {
    dataInicial: startDate,
    dataFinal: endDate,
    pagina: page.toString(),
    quantidade: pageSize.toString(),
  };
  if (codigoOrgao) params.codigoOrgao = codigoOrgao;
  return fetchTransparencia<TransparenciaLicitacao>("/licitacoes", params);
}

export async function fetchContratos(
  startDate: string,
  endDate: string,
  page: number = 1,
  pageSize: number = 100,
  codigoOrgao?: string
): Promise<TransparenciaContrato[]> {
  const params: Record<string, string> = {
    dataInicial: startDate,
    dataFinal: endDate,
    pagina: page.toString(),
    quantidade: pageSize.toString(),
  };
  if (codigoOrgao) params.codigoOrgao = codigoOrgao;
  return fetchTransparencia<TransparenciaContrato>("/contratos", params);
}

export async function fetchCeis(
  page: number = 1,
  pageSize: number = 100
): Promise<TransparenciaSanction[]> {
  return fetchTransparencia<TransparenciaSanction>("/ceis", {
    pagina: page.toString(),
    quantidade: pageSize.toString(),
  });
}

export async function fetchCnep(
  page: number = 1,
  pageSize: number = 100
): Promise<TransparenciaSanction[]> {
  return fetchTransparencia<TransparenciaSanction>("/cnep", {
    pagina: page.toString(),
    quantidade: pageSize.toString(),
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function fetchServidorByCpf(cpf: string): Promise<any[] | null> {
  const cleanCpf = cpf.replace(/\D/g, "");
  const url = new URL(`${BASE_URL}/servidores/por-cpf`);
  url.searchParams.set("cpf", cleanCpf);

  const maxRetries = 2;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    try {
      const response = await fetch(url.toString(), {
        headers: getHeaders(),
        signal: controller.signal,
      });

      if (response.status === 404) return null;
      if (response.status === 429) {
        clearTimeout(timeout);
        if (attempt === maxRetries) return null;
        await sleep(attempt * 5000);
        continue;
      }

      if (!response.ok) {
        throw new Error(
          `Portal Transparencia servidores error: ${response.status} for CPF ${cleanCpf}`
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

  return null;
}
