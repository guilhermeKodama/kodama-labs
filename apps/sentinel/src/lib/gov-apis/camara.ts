const BASE_URL = "https://dadosabertos.camara.leg.br/api/v2";

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export interface CamaraDeputy {
  id: number;
  name: string;
  party: string;
  state: string;
  photoUrl: string;
  email: string | null;
  legislature: number;
}

export interface CamaraDeputyDetail {
  id: number;
  cpf: string;
  name: string;
  civilName: string;
  party: string;
  state: string;
  birthDate: string | null;
  education: string | null;
  photoUrl: string;
}

export async function fetchDeputies(): Promise<CamaraDeputy[]> {
  const maxRetries = 3;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);

    try {
      const res = await fetch(
        `${BASE_URL}/deputados?ordem=ASC&ordenarPor=nome&itens=600`,
        {
          signal: controller.signal,
          headers: {
            Accept: "application/json",
            "User-Agent": "Sentinel/1.0 (gov-procurement-auditor)",
          },
        },
      );

      if (!res.ok) {
        throw new Error(`Camara API error: ${res.status} ${res.statusText}`);
      }

      const json = (await res.json()) as {
        dados: {
          id: number;
          nome: string;
          siglaPartido: string;
          siglaUf: string;
          urlFoto: string;
          email: string | null;
          idLegislatura: number;
        }[];
      };

      return json.dados.map((d) => ({
        id: d.id,
        name: d.nome,
        party: d.siglaPartido,
        state: d.siglaUf,
        photoUrl: d.urlFoto,
        email: d.email,
        legislature: d.idLegislatura,
      }));
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

export async function fetchDeputyDetail(
  id: number,
): Promise<CamaraDeputyDetail | null> {
  const maxRetries = 2;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);

    try {
      const res = await fetch(`${BASE_URL}/deputados/${id}`, {
        signal: controller.signal,
        headers: {
          Accept: "application/json",
          "User-Agent": "Sentinel/1.0 (gov-procurement-auditor)",
        },
      });

      if (res.status === 429) {
        clearTimeout(timeout);
        if (attempt === maxRetries) return null;
        await sleep(attempt * 5000);
        continue;
      }

      if (!res.ok) return null;

      const json = (await res.json()) as {
        dados: {
          id: number;
          cpf: string;
          nomeCivil: string;
          ultimoStatus: {
            nome: string;
            siglaPartido: string;
            siglaUf: string;
            urlFoto: string;
          };
          dataNascimento: string | null;
          escolaridade: string | null;
        };
      };

      const d = json.dados;
      return {
        id: d.id,
        cpf: (d.cpf ?? "").replace(/\D/g, ""),
        name: d.ultimoStatus.nome,
        civilName: d.nomeCivil,
        party: d.ultimoStatus.siglaPartido,
        state: d.ultimoStatus.siglaUf,
        birthDate: d.dataNascimento,
        education: d.escolaridade,
        photoUrl: d.ultimoStatus.urlFoto,
      };
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

export interface CamaraExpense {
  year: number;
  month: number;
  category: string; // tipoDespesa
  documentId: string | null; // codDocumento
  documentDate: string | null; // dataDocumento (YYYY-MM-DD)
  amount: number; // valorLiquido
  supplierName: string; // nomeFornecedor
  supplierDoc: string | null; // cnpjCpfFornecedor (digits)
  documentUrl: string | null; // urlDocumento
}

interface CamaraExpenseRow {
  ano: number;
  mes: number;
  tipoDespesa: string;
  codDocumento: number | null;
  dataDocumento: string | null;
  valorLiquido: number | string | null;
  nomeFornecedor: string | null;
  cnpjCpfFornecedor: string | null;
  urlDocumento: string | null;
}

/**
 * Fetches a deputy's Cota Parlamentar (CEAP) expenses for a year, following the
 * Câmara API's `pagina`/`itens` pagination. Bounded by MAX_PAGES so a single
 * deputy-year can't run away.
 */
export async function fetchDeputyExpenses(
  deputyId: number,
  year: number,
): Promise<CamaraExpense[]> {
  const ITEMS = 100;
  const MAX_PAGES = 25;
  const all: CamaraExpense[] = [];

  for (let page = 1; page <= MAX_PAGES; page++) {
    const rows = await fetchExpensePage(deputyId, year, page, ITEMS);
    if (rows === null) break; // request failed after retries — stop, keep what we have
    for (const r of rows) {
      all.push({
        year: r.ano ?? year,
        month: r.mes ?? 0,
        category: r.tipoDespesa ?? "",
        documentId: r.codDocumento != null ? String(r.codDocumento) : null,
        documentDate: r.dataDocumento ?? null,
        amount: r.valorLiquido != null ? Number(r.valorLiquido) : 0,
        supplierName: r.nomeFornecedor ?? "",
        supplierDoc: r.cnpjCpfFornecedor
          ? r.cnpjCpfFornecedor.replace(/\D/g, "") || null
          : null,
        documentUrl: r.urlDocumento ?? null,
      });
    }
    if (rows.length < ITEMS) break; // last page
    await sleep(300);
  }

  return all;
}

async function fetchExpensePage(
  deputyId: number,
  year: number,
  page: number,
  items: number,
): Promise<CamaraExpenseRow[] | null> {
  const maxRetries = 2;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);

    try {
      const res = await fetch(
        `${BASE_URL}/deputados/${deputyId}/despesas?ano=${year}&itens=${items}&pagina=${page}&ordem=ASC&ordenarPor=dataDocumento`,
        {
          signal: controller.signal,
          headers: {
            Accept: "application/json",
            "User-Agent": "Sentinel/1.0 (gov-procurement-auditor)",
          },
        },
      );

      if (res.status === 429) {
        clearTimeout(timeout);
        if (attempt === maxRetries) return null;
        await sleep(attempt * 5000);
        continue;
      }

      if (!res.ok) return null;

      const json = (await res.json()) as { dados: CamaraExpenseRow[] };
      return json.dados ?? [];
    } catch (err) {
      clearTimeout(timeout);
      if (attempt === maxRetries) {
        console.warn(
          `[camara] expenses fetch failed for deputy ${deputyId}/${year} p${page}:`,
          err instanceof Error ? err.message : err,
        );
        return null;
      }
      await sleep(attempt * 3000);
    } finally {
      clearTimeout(timeout);
    }
  }

  return null;
}

/** Generic GET against the Câmara API returning the `dados` array, or null on failure. */
async function camaraFetch<T>(
  path: string,
  timeoutMs = 20_000,
  maxRetries = 2,
): Promise<T[] | null> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${BASE_URL}${path}`, {
        signal: controller.signal,
        headers: {
          Accept: "application/json",
          "User-Agent": "Sentinel/1.0 (gov-procurement-auditor)",
        },
      });
      if (res.status === 429) {
        clearTimeout(timeout);
        if (attempt === maxRetries) return null;
        await sleep(attempt * 5000);
        continue;
      }
      if (!res.ok) return null;
      const json = (await res.json()) as { dados: T[] };
      return json.dados ?? [];
    } catch (err) {
      clearTimeout(timeout);
      if (attempt === maxRetries) {
        console.warn(
          `[camara] fetch failed ${path}:`,
          err instanceof Error ? err.message : err,
        );
        return null;
      }
      await sleep(attempt * 3000);
    } finally {
      clearTimeout(timeout);
    }
  }
  return null;
}

export interface CamaraVotacao {
  id: string;
  date: string | null;
  description: string;
  organ: string | null;
}

/** Roll-call votes in a date window (ordered most-recent first). */
export async function fetchVotacoes(
  dataInicio: string,
  dataFim: string,
  max = 200,
): Promise<CamaraVotacao[]> {
  const rows = await camaraFetch<{
    id: string;
    data: string | null;
    descricao: string | null;
    siglaOrgao: string | null;
  }>(
    `/votacoes?dataInicio=${dataInicio}&dataFim=${dataFim}&itens=${max}&ordem=DESC&ordenarPor=dataHoraRegistro`,
  );
  if (!rows) return [];
  return rows.map((r) => ({
    id: r.id,
    date: r.data ?? null,
    description: r.descricao ?? "",
    organ: r.siglaOrgao ?? null,
  }));
}

export interface CamaraVoto {
  deputyId: number;
  deputyName: string;
  party: string | null;
  state: string | null;
  vote: string; // raw tipoVoto (Sim/Não/Abstenção/Obstrução/Artigo 17)
}

/** Every deputy's vote on a given roll-call. */
export async function fetchVotacaoVotos(
  votacaoId: string,
): Promise<CamaraVoto[]> {
  const rows = await camaraFetch<{
    tipoVoto: string;
    deputado_: {
      id: number;
      nome: string;
      siglaPartido: string | null;
      siglaUf: string | null;
    };
  }>(`/votacoes/${encodeURIComponent(votacaoId)}/votos`);
  if (!rows) return [];
  return rows
    .filter((r) => r.deputado_)
    .map((r) => ({
      deputyId: r.deputado_.id,
      deputyName: r.deputado_.nome,
      party: r.deputado_.siglaPartido ?? null,
      state: r.deputado_.siglaUf ?? null,
      vote: r.tipoVoto ?? "",
    }));
}

export interface CamaraOrientacao {
  partyBloc: string;
  orientation: string;
}

/** Party/bloc voting orientations for a roll-call (includes the "GOV." line). */
export async function fetchVotacaoOrientacoes(
  votacaoId: string,
): Promise<CamaraOrientacao[]> {
  const rows = await camaraFetch<{
    siglaPartidoBloco: string | null;
    orientacaoVoto: string | null;
  }>(`/votacoes/${encodeURIComponent(votacaoId)}/orientacoes`);
  if (!rows) return [];
  return rows.map((r) => ({
    partyBloc: r.siglaPartidoBloco ?? "",
    orientation: r.orientacaoVoto ?? "",
  }));
}

export interface CamaraProposicao {
  id: number;
  type: string;
  number: number | null;
  year: number | null;
  summary: string;
}

/** Bills authored by a deputy. */
export async function fetchDeputyProposicoes(
  deputyId: number,
  max = 100,
): Promise<CamaraProposicao[]> {
  const rows = await camaraFetch<{
    id: number;
    siglaTipo: string | null;
    numero: number | null;
    ano: number | null;
    ementa: string | null;
  }>(
    `/proposicoes?idDeputadoAutor=${deputyId}&itens=${max}&ordem=DESC&ordenarPor=id`,
  );
  if (!rows) return [];
  return rows.map((r) => ({
    id: r.id,
    type: r.siglaTipo ?? "",
    number: r.numero ?? null,
    year: r.ano ?? null,
    summary: r.ementa ?? "",
  }));
}
