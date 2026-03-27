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
