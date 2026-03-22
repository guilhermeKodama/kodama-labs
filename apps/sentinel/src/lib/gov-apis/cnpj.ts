const BASE_URL = "https://brasilapi.com.br/api/cnpj/v1";

export interface CnpjData {
  cnpj: string;
  razao_social: string;
  nome_fantasia: string | null;
  natureza_juridica: string;
  data_inicio_atividade: string;
  capital_social: number;
  cnae_fiscal: number;
  cnae_fiscal_descricao: string;
  logradouro: string;
  numero: string;
  complemento: string;
  bairro: string;
  municipio: string;
  uf: string;
  cep: string;
  porte: string;
  situacao_cadastral: number;
  qsa: CnpjQsa[];
}

export interface CnpjQsa {
  identificador_de_socio: number;
  nome_socio: string;
  cnpj_cpf_do_socio: string;
  qualificacao_socio: string;
  data_entrada_sociedade: string;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function fetchCnpjData(cnpj: string): Promise<CnpjData> {
  const cleanCnpj = cnpj.replace(/\D/g, "");
  const url = `${BASE_URL}/${cleanCnpj}`;
  const maxRetries = 3;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    try {
      const response = await fetch(url, {
        headers: {
          Accept: "application/json",
          "User-Agent": "Sentinel/1.0 (gov-procurement-auditor)",
        },
        signal: controller.signal,
      });

      if (response.status === 429) {
        clearTimeout(timeout);
        if (attempt === maxRetries) throw new Error(`BrasilAPI rate limited for CNPJ ${cleanCnpj}`);
        await sleep(attempt * 5000);
        continue;
      }

      if (!response.ok) {
        throw new Error(
          `BrasilAPI CNPJ error: ${response.status} for CNPJ ${cleanCnpj}`
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

export async function fetchCnpjBatch(
  cnpjs: string[],
  delayMs: number = 500
): Promise<Map<string, CnpjData | null>> {
  const results = new Map<string, CnpjData | null>();

  for (const cnpj of cnpjs) {
    try {
      const data = await fetchCnpjData(cnpj);
      results.set(cnpj.replace(/\D/g, ""), data);
    } catch {
      results.set(cnpj.replace(/\D/g, ""), null);
    }

    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  return results;
}
