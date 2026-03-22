import { prisma } from "@sentinel/server/lib/prisma";
import { runJob } from "@sentinel/server/lib/job-runner";

interface CeisCnepRaw {
  id: number;
  dataInicioSancao: string;
  dataFimSancao: string | null;
  dataPublicacaoSancao: string | null;
  dataTransitadoJulgado: string | null;
  dataOrigemInformacao: string | null;
  tipoSancao?: { descricaoResumida: string };
  fonteSancao?: { nomeExibicao: string };
  fundamentacao?: Array<{ descricao: string }>;
  orgaoSancionador?: {
    nome: string;
    siglaUf: string | null;
    poder: string | null;
    esfera: string | null;
  };
  sancionado?: { nome: string; codigoFormatado: string };
  pessoa?: { tipo: string; cpfFormatado: string; cnpjFormatado: string; nome: string };
  numeroProcesso?: string;
}

interface TcuRaw {
  cpfCnpj: string;
  nome: string;
  processo: string;
  deliberacao: string;
  dataTransitoJulgado: string;
  dataFinal: string | null;
  dataAcordao: string;
  uf: string;
  municipio: string;
}

function parseBrDate(dateStr: string | null | undefined): Date | null {
  if (!dateStr || dateStr === "Sem informação" || dateStr === "Sem Informação") return null;
  if (dateStr.includes("/")) {
    const [d, m, y] = dateStr.split("/");
    if (y && m && d) return new Date(`${y}-${m}-${d}`);
  }
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? null : d;
}

export async function linkData() {
  return runJob("link-data", "processing", async () => {
    let recordsOut = 0;

    const sanctionRaws = await prisma.rawRecord.findMany({
      where: {
        recordType: "sanction",
        processedAt: null,
        processingError: null,
      },
      take: 200,
    });

    for (const raw of sanctionRaws) {
      try {
        if (raw.source === "CEIS" || raw.source === "CNEP") {
          const ok = await processCeisCnep(raw);
          if (ok) recordsOut++;
        } else if (raw.source === "TCU") {
          const ok = await processTcu(raw);
          if (ok) recordsOut++;
        }

        await prisma.rawRecord.update({
          where: { id: raw.id },
          data: { processedAt: new Date() },
        });
      } catch (error) {
        console.error(
          `[link-data] Error processing sanction ${raw.externalId}:`,
          error
        );
        await prisma.rawRecord.update({
          where: { id: raw.id },
          data: {
            processingError:
              error instanceof Error ? error.message : "Unknown error",
          },
        });
      }
    }

    return { recordsIn: sanctionRaws.length, recordsOut };
  });
}

async function processCeisCnep(
  raw: { id: string; externalId: string; source: string; data: unknown }
): Promise<boolean> {
  const data = raw.data as CeisCnepRaw;

  const cnpjCpf = (data.sancionado?.codigoFormatado ?? "").replace(/\D/g, "");
  if (!cnpjCpf) return false;

  const personName = data.sancionado?.nome ?? data.pessoa?.nome ?? null;
  const personType = data.pessoa?.tipo ?? null;

  const entity = await prisma.entity.findUnique({
    where: { cnpj: cnpjCpf },
    select: { id: true },
  });

  const startDate = parseBrDate(data.dataInicioSancao);
  const endDate = parseBrDate(data.dataFimSancao);
  const publicationDate = parseBrDate(data.dataPublicacaoSancao);
  const transitDate = parseBrDate(data.dataTransitadoJulgado);
  const originDate = parseBrDate(data.dataOrigemInformacao);

  const sanctionType = data.tipoSancao?.descricaoResumida ?? "";
  const legalBasis = data.fundamentacao?.[0]?.descricao ?? "";
  const sanctioningOrg = data.orgaoSancionador?.nome ?? "";

  await prisma.sanction.upsert({
    where: { externalId: raw.externalId },
    create: {
      externalId: raw.externalId,
      cnpjCpf,
      personName,
      personType,
      entityId: entity?.id ?? null,
      source: raw.source as "CEIS" | "CNEP",
      type: sanctionType,
      reason: legalBasis.slice(0, 5000),
      startDate: startDate ?? new Date(),
      endDate,
      sanctionType,
      legalBasis: legalBasis.slice(0, 5000),
      sanctioningOrg,
      sanctioningOrgState: data.orgaoSancionador?.siglaUf ?? null,
      sanctioningOrgPower: data.orgaoSancionador?.poder ?? null,
      sanctioningOrgSphere: data.orgaoSancionador?.esfera ?? null,
      processNumber: data.numeroProcesso ?? null,
      publicationDate,
      transitDate,
      originDate,
      rawRecordId: raw.id,
    },
    update: {
      entityId: entity?.id ?? null,
      personName,
      type: sanctionType,
      reason: legalBasis.slice(0, 5000),
      endDate,
      sanctioningOrg,
      sanctioningOrgState: data.orgaoSancionador?.siglaUf ?? null,
    },
  });

  return true;
}

async function processTcu(
  raw: { id: string; externalId: string; data: unknown }
): Promise<boolean> {
  const data = raw.data as TcuRaw;

  const cnpjCpf = (data.cpfCnpj ?? "").replace(/\D/g, "");
  if (!cnpjCpf) return false;

  const entity = await prisma.entity.findUnique({
    where: { cnpj: cnpjCpf },
    select: { id: true },
  });

  const startDate = parseBrDate(data.dataTransitoJulgado);
  const endDate = parseBrDate(data.dataFinal);

  await prisma.sanction.upsert({
    where: { externalId: raw.externalId },
    create: {
      externalId: raw.externalId,
      cnpjCpf,
      personName: data.nome ?? null,
      entityId: entity?.id ?? null,
      source: "TCU",
      type: "licitante_inidoneo",
      reason: data.deliberacao ?? "",
      startDate: startDate ?? new Date(),
      endDate,
      sanctionType: "Licitante Inidôneo",
      legalBasis: data.deliberacao ?? null,
      sanctioningOrg: "Tribunal de Contas da União",
      sanctioningOrgState: data.uf ?? null,
      sanctioningOrgPower: "Legislativo",
      sanctioningOrgSphere: "FEDERAL",
      processNumber: data.processo ?? null,
      transitDate: startDate,
      rawRecordId: raw.id,
    },
    update: {
      entityId: entity?.id ?? null,
      personName: data.nome ?? null,
      endDate,
    },
  });

  return true;
}
