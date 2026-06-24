import { prisma } from "@sentinel/server/lib/prisma";
import { runJob } from "@sentinel/server/lib/job-runner";
import { buildAlertI18n, renderPtBr } from "@sentinel/server/lib/alert-i18n";

/**
 * Derives a politician's legal history from OFFICIAL sources already in the DB:
 * sanctions (TCU/CEIS/CNEP) whose CPF matches a politician are projected into
 * LegalProceeding + a LEGAL_HISTORY alert. Public record, never a verdict —
 * the UI frames it as "to verify". Richer judicial data (STF/STJ, convictions,
 * prison) uses the same model and lands via the STF/CURATED sources later.
 */
export async function analyzeLegal() {
  return runJob("analyze-legal", "analysis", async () => {
    // Person-CPF sanctions only (11 digits); companies (CNPJ) are out of scope.
    const personCpfs = await prisma.$queryRaw<{ cnpjCpf: string }[]>`
      SELECT DISTINCT "cnpjCpf" FROM sanctions WHERE length("cnpjCpf") = 11
    `;
    if (personCpfs.length === 0) return { recordsIn: 0, recordsOut: 0 };

    const politicians = await prisma.politician.findMany({
      select: { id: true, cpf: true, name: true, party: true, state: true },
    });
    const polByCpf = new Map(politicians.map((p) => [p.cpf, p]));

    const matchedCpfs = personCpfs
      .map((r) => r.cnpjCpf)
      .filter((cpf) => polByCpf.has(cpf));
    if (matchedCpfs.length === 0) return { recordsIn: personCpfs.length, recordsOut: 0 };

    const sanctions = await prisma.sanction.findMany({
      where: { cnpjCpf: { in: matchedCpfs } },
    });

    let recordsOut = 0;
    for (const s of sanctions) {
      const pol = polByCpf.get(s.cnpjCpf);
      if (!pol) continue;

      const kind = s.source === "TCU" ? "INELIGIBILITY" : "REJECTED_ACCOUNTS";
      const title = s.reason || s.type || "Sanção pública registrada";
      const makesIneligible = s.source === "TCU";

      const existing = await prisma.legalProceeding.findFirst({
        where: { politicianId: pol.id, source: s.source, title },
        select: { id: true },
      });
      if (existing) continue;

      await prisma.legalProceeding.create({
        data: {
          politicianId: pol.id,
          kind,
          status: "ARCHIVED",
          court: s.sanctioningOrg ?? null,
          caseNumber: s.processNumber ?? null,
          title,
          description: s.type ?? null,
          decisionDate: s.publicationDate ?? s.startDate ?? null,
          isFinal: Boolean(s.transitDate),
          makesIneligible,
          source: s.source,
          verifiedBy: "official",
        },
      });

      const params = {
        politicianName: pol.name,
        party: pol.party ?? "-",
        state: pol.state ?? "-",
        source: s.source,
        reason: title,
      };
      const i18n = buildAlertI18n(
        "alerts.templates.legalHistory.title",
        "alerts.templates.legalHistory.description",
        params,
      );

      await prisma.alert.create({
        data: {
          type: "LEGAL_HISTORY",
          severity: makesIneligible ? "CRITICAL" : "HIGH",
          title: renderPtBr("alerts.templates.legalHistory.title", params),
          description: renderPtBr(
            "alerts.templates.legalHistory.description",
            params,
          ),
          data: {
            politicianCpf: pol.cpf,
            politicianName: pol.name,
            source: s.source,
            makesIneligible,
            i18n,
          },
        },
      });

      recordsOut++;
    }

    return { recordsIn: sanctions.length, recordsOut };
  });
}
