const BASE_URL = "https://legis.senado.leg.br/dadosabertos";

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export interface SenadoSenador {
  codigoParlamentar: string;
  nome: string;
  nomeCompleto: string;
  sexo: string;
  partido: string;
  uf: string;
  email: string | null;
  photoUrl: string;
  pageUrl: string;
  mandatoCodigo: string;
  mandatoDescricao: string;
}

interface SenadoRawParlamentar {
  IdentificacaoParlamentar: {
    CodigoParlamentar: string;
    NomeParlamentar: string;
    NomeCompletoParlamentar: string;
    SexoParlamentar: string;
    SiglaPartidoParlamentar: string;
    UfParlamentar: string;
    EmailParlamentar: string | null;
    UrlFotoParlamentar: string;
    UrlPaginaParlamentar: string;
  };
  Mandato: {
    CodigoMandato: string;
    DescricaoParticipacao: string;
  };
}

export async function fetchSenadores(): Promise<SenadoSenador[]> {
  const maxRetries = 3;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);

    try {
      const res = await fetch(`${BASE_URL}/senador/lista/atual.json`, {
        signal: controller.signal,
        headers: {
          Accept: "application/json",
          "User-Agent": "Sentinel/1.0 (gov-procurement-auditor)",
        },
      });

      if (res.status === 429) {
        clearTimeout(timeout);
        if (attempt === maxRetries) throw new Error("Senado API rate limit exceeded");
        await sleep(attempt * 5000);
        continue;
      }

      if (!res.ok) {
        throw new Error(`Senado API error: ${res.status} ${res.statusText}`);
      }

      const json = await res.json() as {
        ListaParlamentarEmExercicio: {
          Parlamentares: {
            Parlamentar: SenadoRawParlamentar[];
          };
        };
      };

      const parlamentares = json.ListaParlamentarEmExercicio?.Parlamentares?.Parlamentar ?? [];

      return parlamentares.map((p) => {
        const id = p.IdentificacaoParlamentar;
        return {
          codigoParlamentar: id.CodigoParlamentar,
          nome: id.NomeParlamentar,
          nomeCompleto: id.NomeCompletoParlamentar,
          sexo: id.SexoParlamentar,
          partido: id.SiglaPartidoParlamentar,
          uf: id.UfParlamentar,
          email: id.EmailParlamentar || null,
          photoUrl: id.UrlFotoParlamentar,
          pageUrl: id.UrlPaginaParlamentar,
          mandatoCodigo: p.Mandato?.CodigoMandato ?? "",
          mandatoDescricao: p.Mandato?.DescricaoParticipacao ?? "",
        };
      });
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

export interface SenadoSenadorDetail {
  codigoParlamentar: string;
  nome: string;
  nomeCompleto: string;
  dataNascimento: string | null;
  naturalidade: string | null;
  ufNaturalidade: string | null;
  partido: string;
  uf: string;
  email: string | null;
  photoUrl: string;
}

export async function fetchSenadorDetail(
  codigo: string
): Promise<SenadoSenadorDetail | null> {
  const maxRetries = 2;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);

    try {
      const res = await fetch(`${BASE_URL}/senador/${codigo}.json`, {
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

      const json = await res.json() as {
        DetalheParlamentar: {
          Parlamentar: {
            IdentificacaoParlamentar: {
              CodigoParlamentar: string;
              NomeParlamentar: string;
              NomeCompletoParlamentar: string;
              SiglaPartidoParlamentar: string;
              UfParlamentar: string;
              EmailParlamentar: string | null;
              UrlFotoParlamentar: string;
            };
            DadosBasicosParlamentar?: {
              DataNascimento?: string;
              Naturalidade?: string;
              UfNaturalidade?: string;
            };
          };
        };
      };

      const p = json.DetalheParlamentar?.Parlamentar;
      if (!p) return null;

      const id = p.IdentificacaoParlamentar;
      const dados = p.DadosBasicosParlamentar;

      return {
        codigoParlamentar: id.CodigoParlamentar,
        nome: id.NomeParlamentar,
        nomeCompleto: id.NomeCompletoParlamentar,
        dataNascimento: dados?.DataNascimento || null,
        naturalidade: dados?.Naturalidade || null,
        ufNaturalidade: dados?.UfNaturalidade || null,
        partido: id.SiglaPartidoParlamentar,
        uf: id.UfParlamentar,
        email: id.EmailParlamentar || null,
        photoUrl: id.UrlFotoParlamentar,
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
