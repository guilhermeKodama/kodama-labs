import { prisma } from "@sentinel/server/lib/prisma";
import { Prisma } from "@/generated/prisma";
import { runJob } from "@sentinel/server/lib/job-runner";

const BATCH_SIZE = 500;

export async function processServidores() {
  return runJob("process-servidores", "processing", async () => {
    const rawRecords = await prisma.rawRecord.findMany({
      where: {
        source: "TRANSPARENCIA",
        recordType: "servant",
        processedAt: null,
      },
      take: BATCH_SIZE * 50,
      orderBy: { fetchedAt: "asc" },
    });

    const allPoliticians = await prisma.politician.findMany({
      select: { id: true, cpf: true },
    });
    const cpfToPoliticianId = new Map(allPoliticians.map((p) => [p.cpf, p.id]));

    let recordsOut = 0;

    for (const raw of rawRecords) {
      try {
        const cpf = raw.externalId;
        const politicianId = cpfToPoliticianId.get(cpf);

        if (!politicianId) {
          await prisma.rawRecord.update({
            where: { id: raw.id },
            data: { processingError: `No politician found for CPF ${cpf}` },
          });
          continue;
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const data = raw.data as any;

        if (data._empty || !Array.isArray(data) || data.length === 0) {
          await prisma.rawRecord.update({
            where: { id: raw.id },
            data: { processedAt: new Date() },
          });
          recordsOut++;
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

          await prisma.publicServant.create({
            data: {
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
            },
          });
        }

        await prisma.rawRecord.update({
          where: { id: raw.id },
          data: { processedAt: new Date() },
        });
        recordsOut++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        console.error(`[process-servidores] Error processing ${raw.id}:`, msg);
        await prisma.rawRecord.update({
          where: { id: raw.id },
          data: { processingError: msg },
        });
      }
    }

    return { recordsIn: rawRecords.length, recordsOut };
  });
}
