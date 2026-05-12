import { prisma } from "@sentinel/server/lib/prisma";
import { Prisma } from "@/generated/prisma";
import { runJob, markProcessed, markErrors } from "@sentinel/server/lib/job-runner";
import { getCpfToPoliticianId } from "@sentinel/server/lib/politician-cache";

const BATCH_SIZE = 500;

export async function processServidores() {
  return runJob("process-servidores", "processing", async () => {
    const rawRecords = await prisma.rawRecord.findMany({
      where: {
        source: "TRANSPARENCIA",
        recordType: "servant",
        processedAt: null,
        processingError: null,
      },
      select: { id: true, externalId: true, data: true },
      take: BATCH_SIZE,
      orderBy: { fetchedAt: "asc" },
    });

    if (!rawRecords.length) return { recordsIn: 0, recordsOut: 0 };

    const cpfToPoliticianId = await getCpfToPoliticianId();

    const successIds: string[] = [];
    const errs: { id: string; error: string }[] = [];
    const toCreate: {
      politicianId: string;
      cpf: string;
      cargo: string | null;
      funcao: string | null;
      orgao: string | null;
      orgaoCode: string | null;
      situacao: string | null;
      remuneracao: Prisma.Decimal | null;
      dataAdmissao: Date | null;
      rawRecordId: string;
    }[] = [];

    for (const raw of rawRecords) {
      const cpf = raw.externalId;
      const politicianId = cpfToPoliticianId.get(cpf);

      if (!politicianId) {
        errs.push({ id: raw.id, error: `No politician found for CPF ${cpf}` });
        continue;
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = raw.data as any;

      if (data._empty || !Array.isArray(data) || data.length === 0) {
        successIds.push(raw.id);
        continue;
      }

      for (const servant of data) {
        const cargo = servant.cargo?.descricao ?? servant.descricaoCargo ?? null;
        const funcao = servant.funcao?.descricao ?? servant.descricaoFuncao ?? null;
        const orgao = servant.orgaoServidorExercicio?.nome ??
          servant.orgaoServidorLotacao?.nome ??
          servant.nomeOrgao ?? null;
        const orgaoCode = servant.orgaoServidorExercicio?.codigo ??
          servant.orgaoServidorLotacao?.codigo ?? null;
        const situacao = servant.situacaoServidor?.descricao ?? servant.descricaoSituacao ?? null;

        const remuneracaoStr = servant.remuneracaoBasicaBruta ?? servant.remuneracaoAposDeducoes ?? null;
        const remuneracao = remuneracaoStr != null ? new Prisma.Decimal(remuneracaoStr) : null;

        let dataAdmissao: Date | null = null;
        const admStr = servant.dataIngressoServPublico ?? servant.dataIngressoOrgao ?? null;
        if (admStr) {
          const parts = admStr.split("/");
          if (parts.length === 3) {
            const d = new Date(`${parts[2]}-${parts[1]}-${parts[0]}`);
            if (!isNaN(d.getTime())) dataAdmissao = d;
          }
        }

        toCreate.push({
          politicianId,
          cpf,
          cargo,
          funcao,
          orgao,
          orgaoCode,
          situacao,
          remuneracao,
          dataAdmissao,
          rawRecordId: raw.id,
        });
      }

      successIds.push(raw.id);
    }

    if (toCreate.length > 0) {
      const CHUNK = 500;
      for (let i = 0; i < toCreate.length; i += CHUNK) {
        try {
          await prisma.publicServant.createMany({
            data: toCreate.slice(i, i + CHUNK),
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : "createMany error";
          console.error("[process-servidores] createMany failed:", msg);
          const failedChunk = toCreate.slice(i, i + CHUNK);
          const failedRawIds = new Set(failedChunk.map((r) => r.rawRecordId));
          for (const rid of failedRawIds) {
            const idx = successIds.indexOf(rid);
            if (idx !== -1) successIds.splice(idx, 1);
            errs.push({ id: rid, error: msg });
          }
        }
      }
    }

    await markProcessed(successIds);
    await markErrors(errs);

    return { recordsIn: rawRecords.length, recordsOut: successIds.length };
  });
}
