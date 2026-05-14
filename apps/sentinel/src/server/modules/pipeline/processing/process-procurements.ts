import { prisma } from "@sentinel/server/lib/prisma";
import { runJob, markProcessed, markErrors, withDeadlockRetry } from "@sentinel/server/lib/job-runner";
import type { PncpProcurement } from "@/lib/gov-apis/pncp";
import type { TransparenciaLicitacao } from "@/lib/gov-apis/transparencia";
import { randomUUID } from "crypto";

const BATCH_SIZE = 1000;

export async function processProcurements() {
  return runJob("process-procurements", "processing", async () => {
    const unprocessed = await prisma.rawRecord.findMany({
      where: {
        recordType: { in: ["procurement", "licitacao"] },
        processedAt: null,
        processingError: null,
      },
      select: { id: true, externalId: true, source: true, recordType: true, data: true },
      take: BATCH_SIZE,
      orderBy: { fetchedAt: "asc" },
    });

    if (!unprocessed.length) return { recordsIn: 0, recordsOut: 0 };

    const successIds: string[] = [];
    const errors: { id: string; error: string }[] = [];

    const pncpRows: { raw: typeof unprocessed[0]; data: PncpProcurement }[] = [];
    const transpRows: { raw: typeof unprocessed[0]; data: TransparenciaLicitacao }[] = [];

    for (const raw of unprocessed) {
      try {
        if (raw.recordType === "licitacao") {
          transpRows.push({ raw, data: raw.data as unknown as TransparenciaLicitacao });
        } else {
          pncpRows.push({ raw, data: raw.data as unknown as PncpProcurement });
        }
      } catch (err) {
        errors.push({ id: raw.id, error: err instanceof Error ? err.message : "Parse error" });
      }
    }

    if (pncpRows.length > 0) {
      const CHUNK = 250;
      for (let i = 0; i < pncpRows.length; i += CHUNK) {
        const chunk = pncpRows.slice(i, i + CHUNK);
        const params: unknown[] = [];
        const placeholders: string[] = [];

        for (const { raw, data } of chunk) {
          const base = params.length;
          const p = (n: number) => `$${base + n}`;

          params.push(
            randomUUID(),
            raw.externalId,
            raw.source,
            data.orgaoEntidade.cnpj,
            data.orgaoEntidade.razaoSocial,
            data.orgaoEntidade.poderId ?? null,
            data.orgaoEntidade.esferaId ?? null,
            data.unidadeOrgao?.nomeUnidade ?? null,
            data.unidadeOrgao?.codigoUnidade ?? null,
            data.unidadeOrgao?.codigoIbge ?? null,
            data.anoCompra,
            data.numeroCompra ?? data.sequencialCompra?.toString() ?? "",
            data.sequencialCompra ?? null,
            data.modalidadeNome,
            data.modalidadeId ?? null,
            data.objetoCompra,
            data.dataPublicacaoPncp ? new Date(data.dataPublicacaoPncp) : new Date(),
            data.situacaoCompraNome,
            data.situacaoCompraId ?? null,
            data.valorTotalEstimado ?? null,
            data.valorTotalHomologado ?? null,
            data.valorTotalHomologado ?? data.valorTotalEstimado ?? null,
            data.processo ?? null,
            data.amparoLegal?.nome ?? null,
            data.amparoLegal?.descricao ?? null,
            data.modoDisputaNome ?? null,
            data.modoDisputaId ?? null,
            data.srp ?? null,
            data.tipoInstrumentoConvocatorioNome ?? null,
            data.tipoInstrumentoConvocatorioCodigo ?? null,
            data.dataAberturaProposta ? new Date(data.dataAberturaProposta) : null,
            data.dataEncerramentoProposta ? new Date(data.dataEncerramentoProposta) : null,
            data.linkSistemaOrigem ?? null,
            data.linkProcessoEletronico ?? null,
            data.unidadeOrgao?.ufSigla ?? null,
            data.unidadeOrgao?.municipioNome ?? null,
            raw.id
          );

          placeholders.push(`(
            ${p(1)}, ${p(2)}, ${p(3)}::"DataSource", ${p(4)}, ${p(5)}, ${p(6)}, ${p(7)},
            ${p(8)}, ${p(9)}, ${p(10)}, ${p(11)}, ${p(12)}, ${p(13)},
            ${p(14)}, ${p(15)}, ${p(16)}, ${p(17)}::timestamp(3), ${p(18)}, ${p(19)},
            ${p(20)}, ${p(21)}, ${p(22)}, ${p(23)},
            ${p(24)}, ${p(25)}, ${p(26)}, ${p(27)},
            ${p(28)}, ${p(29)}, ${p(30)},
            ${p(31)}::timestamp(3), ${p(32)}::timestamp(3),
            ${p(33)}, ${p(34)}, ${p(35)}, ${p(36)}, ${p(37)}
          )`);
        }

        const sql = `
          INSERT INTO procurements (
            "id", "externalId", "source", "orgCnpj", "orgName", "orgPower", "orgSphere",
            "unitName", "unitCode", "ibgeCode", "year", "number", "sequencial",
            "modality", "modalityId", "description", "publishedAt", "status", "statusId",
            "estimatedValue", "approvedValue", "totalValue", "processo",
            "legalBasis", "legalBasisDescription", "disputeMode", "disputeModeId",
            "isSrp", "instrumentType", "instrumentTypeId",
            "proposalOpenDate", "proposalCloseDate",
            "linkOrigem", "linkProcesso", "state", "city", "rawRecordId"
          )
          VALUES ${placeholders.join(", ")}
          ON CONFLICT ("externalId") DO UPDATE SET
            "orgName" = EXCLUDED."orgName",
            "status" = EXCLUDED."status",
            "statusId" = EXCLUDED."statusId",
            "estimatedValue" = COALESCE(EXCLUDED."estimatedValue", procurements."estimatedValue"),
            "approvedValue" = COALESCE(EXCLUDED."approvedValue", procurements."approvedValue"),
            "totalValue" = COALESCE(EXCLUDED."totalValue", procurements."totalValue"),
            "state" = COALESCE(EXCLUDED."state", procurements."state"),
            "city" = COALESCE(EXCLUDED."city", procurements."city"),
            "legalBasis" = COALESCE(EXCLUDED."legalBasis", procurements."legalBasis"),
            "legalBasisDescription" = COALESCE(EXCLUDED."legalBasisDescription", procurements."legalBasisDescription")
        `;

        try {
          await withDeadlockRetry(
            () => prisma.$executeRawUnsafe(sql, ...params),
            3,
            "process-procurements",
          );
          for (const { raw } of chunk) successIds.push(raw.id);
        } catch (err) {
          console.error("[process-procurements] Bulk insert error:", err instanceof Error ? err.message : err);
          for (const { raw } of chunk) {
            errors.push({ id: raw.id, error: err instanceof Error ? err.message : "Bulk insert error" });
          }
        }
      }
    }

    for (const { raw, data } of transpRows) {
      try {
        const orgCnpj = (data.orgaoEntidade?.cnpj ?? "").replace(/\D/g, "");
        const publishedAt = data.dataAbertura ? new Date(data.dataAbertura) : new Date(data.dataReferencia);
        const year = publishedAt.getFullYear();

        let city: string | null = null;
        let state: string | null = data.uf ?? null;
        if (typeof data.municipio === "string") {
          city = data.municipio;
        } else if (data.municipio && typeof data.municipio === "object") {
          city = data.municipio.nomeIBGE ?? null;
          if (!state && data.municipio.uf) {
            state = data.municipio.uf.nome ?? data.municipio.uf.sigla ?? null;
          }
        }

        await prisma.procurement.upsert({
          where: { externalId: raw.externalId },
          create: {
            externalId: raw.externalId,
            source: "TRANSPARENCIA",
            orgCnpj: orgCnpj || "00000000000000",
            orgName: data.orgaoEntidade?.razaoSocial ?? "Desconhecido",
            year,
            number: String(data.id),
            modality: data.modalidadeCompra?.descricao ?? "Não informado",
            description: data.objeto ?? "Sem descrição",
            publishedAt,
            status: data.situacaoCompra?.descricao ?? "Não informado",
            estimatedValue: data.valorLicitacao ?? undefined,
            totalValue: data.valorLicitacao ?? undefined,
            state,
            city,
            rawRecordId: raw.id,
          },
          update: {
            orgName: data.orgaoEntidade?.razaoSocial ?? undefined,
            status: data.situacaoCompra?.descricao ?? undefined,
            estimatedValue: data.valorLicitacao ?? undefined,
            state: state ?? undefined,
            city: city ?? undefined,
          },
        });
        successIds.push(raw.id);
      } catch (err) {
        errors.push({ id: raw.id, error: err instanceof Error ? err.message : "Unknown error" });
      }
    }

    await markProcessed(successIds);
    await markErrors(errors);

    return { recordsIn: unprocessed.length, recordsOut: successIds.length };
  });
}
