import { prisma } from "@sentinel/server/lib/prisma";
import { Prisma } from "@/generated/prisma";
import { runJob } from "@sentinel/server/lib/job-runner";
import { buildAlertI18n, renderCodePtBr, renderPtBr } from "@sentinel/server/lib/alert-i18n";

// ---------------------------------------------------------------------------
// Strategy registry — guardrails to prevent runaway link creation
// ---------------------------------------------------------------------------

interface StrategyConfig {
  name: string;
  fn: (maxLinks: number) => Promise<number>;
  maxLinks: number;
  minStrength: number;
  enabled: boolean;
}

const strategies: StrategyConfig[] = [
  { name: "SHAREHOLDER_IS_POLITICIAN", fn: detectShareholderIsPolitician, maxLinks: 500,  minStrength: 0.5,  enabled: true },
  { name: "SUPPLIER_DONATED",         fn: detectSupplierDonatedToPolitician, maxLinks: 500, minStrength: 0.5, enabled: true },
  { name: "DONOR_GOT_CONTRACT",       fn: detectDonorGotContract,       maxLinks: 1000, minStrength: 0.5,  enabled: true },
  { name: "FAMILY_IN_SUPPLIER",       fn: detectFamilyInSupplier,       maxLinks: 200,  minStrength: 0.5,  enabled: true },
  { name: "FAMILY_DONATED",           fn: detectFamilyDonated,          maxLinks: 200,  minStrength: 0.5,  enabled: true },
  { name: "POLITICIAN_IS_SERVANT",    fn: detectPoliticianIsServant,    maxLinks: 500,  minStrength: 0.5,  enabled: true },
  { name: "WEALTH_ANOMALY",           fn: detectWealthAnomaly,          maxLinks: 500,  minStrength: 0.5,  enabled: true },
  { name: "DONOR_IS_SHAREHOLDER",     fn: detectDonorIsShareholder,     maxLinks: 1000, minStrength: 0.7,  enabled: true },
  { name: "DONATION_TIMING",          fn: detectDonationTiming,         maxLinks: 1000, minStrength: 0.7,  enabled: true },
  { name: "DONOR_CONCENTRATION",      fn: detectDonorConcentration,     maxLinks: 2000, minStrength: 0.7,  enabled: true },
];

type StrategyOutcome = {
  name: string;
  linksCreated: number;
  capped: boolean;
  error?: string;
  durationMs: number;
};

async function runStrategy(config: StrategyConfig): Promise<StrategyOutcome> {
  const start = Date.now();
  try {
    const linksCreated = await config.fn(config.maxLinks);
    const capped = linksCreated >= config.maxLinks;
    if (capped) {
      console.warn(
        `[guardrail] ⚠ ${config.name}: hit cap of ${config.maxLinks} links — stopped creating. Review if cap needs adjustment.`
      );
    }
    return { name: config.name, linksCreated, capped, durationMs: Date.now() - start };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error(`[guardrail] ✗ ${config.name} FAILED: ${msg}`);
    return { name: config.name, linksCreated: 0, capped: false, error: msg, durationMs: Date.now() - start };
  }
}

export async function analyzePoliticalLinks() {
  return runJob("analyze-political-links", "analysis", async () => {
    const outcomes: StrategyOutcome[] = [];

    for (const config of strategies) {
      if (!config.enabled) {
        console.log(`[guardrail] ⊘ ${config.name}: disabled, skipping`);
        outcomes.push({ name: config.name, linksCreated: 0, capped: false, durationMs: 0 });
        continue;
      }
      const outcome = await runStrategy(config);
      outcomes.push(outcome);
    }

    // Summary log
    console.log(`\n[analyze-political-links] ═══ RUN SUMMARY ═══`);
    let totalOut = 0;
    for (const o of outcomes) {
      const status = o.error ? "FAIL" : o.capped ? "CAPPED" : "OK";
      const icon = o.error ? "✗" : o.capped ? "⚠" : "✓";
      console.log(`  ${icon} ${o.name.padEnd(28)} ${String(o.linksCreated).padStart(5)} links  [${status}]  ${o.durationMs}ms`);
      totalOut += o.linksCreated;
    }
    const failed = outcomes.filter((o) => o.error).length;
    const capped = outcomes.filter((o) => o.capped).length;
    console.log(`  ─────────────────────────────────────────`);
    console.log(`  Total: ${totalOut} links | Failed: ${failed} | Capped: ${capped}`);
    console.log(`[analyze-political-links] ═══════════════════\n`);

    const politicians = await prisma.politician.count();
    const donations = await prisma.campaignDonation.count();

    const metadata: Record<string, unknown> = {};
    for (const o of outcomes) {
      metadata[o.name] = { links: o.linksCreated, capped: o.capped, error: o.error, ms: o.durationMs };
    }

    return { recordsIn: politicians + donations, recordsOut: totalOut, metadata };
  });
}

// ---------------------------------------------------------------------------
// Existing strategies
// ---------------------------------------------------------------------------

async function detectShareholderIsPolitician(maxLinks: number): Promise<number> {
  const politicians = await prisma.politician.findMany({
    select: { id: true, cpf: true, name: true, party: true, position: true, state: true, city: true },
  });

  if (politicians.length === 0) return 0;

  const politicianByCpf = new Map(politicians.map((p) => [p.cpf, p]));
  const cpfs = politicians.map((p) => p.cpf);

  const shareholders = await prisma.shareholder.findMany({
    where: { cpfCnpj: { in: cpfs } },
    include: {
      entity: {
        select: {
          id: true,
          cnpj: true,
          name: true,
          state: true,
          city: true,
          contracts: {
            select: { id: true, orgName: true, value: true, unitState: true, unitCity: true },
            take: 10,
          },
        },
      },
    },
  });

  let linksCreated = 0;

  for (const sh of shareholders) {
    if (!sh.cpfCnpj) continue;
    const politician = politicianByCpf.get(sh.cpfCnpj);
    if (!politician) continue;

    const existingLink = await prisma.politicalLink.findFirst({
      where: { politicianId: politician.id, entityId: sh.entity.id, linkType: "SHAREHOLDER_IS_POLITICIAN" },
    });
    if (existingLink) continue;

    const sameJurisdiction =
      politician.state === sh.entity.state ||
      sh.entity.contracts.some((c) => c.unitState === politician.state);

    const hasGovContracts = sh.entity.contracts.length > 0;
    const totalContractValue = sh.entity.contracts.reduce((sum, c) => sum + Number(c.value), 0);

    let severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" = "MEDIUM";
    let strength = 0.5;

    if (sameJurisdiction && hasGovContracts) { severity = "CRITICAL"; strength = 0.9; }
    else if (hasGovContracts) { severity = "HIGH"; strength = 0.7; }
    else if (sameJurisdiction) { severity = "HIGH"; strength = 0.6; }

    await prisma.politicalLink.create({
      data: {
        politicianId: politician.id,
        entityId: sh.entity.id,
        shareholderId: sh.id,
        linkType: "SHAREHOLDER_IS_POLITICIAN",
        description: `${politician.name} (${politician.party}/${politician.state} - ${politician.position}) é sócio da empresa ${sh.entity.name} (${sh.entity.cnpj}) com função "${sh.role}"`,
        strength,
        data: {
          politicianName: politician.name, party: politician.party, position: politician.position,
          entityCnpj: sh.entity.cnpj, entityName: sh.entity.name, shareholderRole: sh.role,
          sameJurisdiction, hasGovContracts, totalContractValue,
        } as unknown as Prisma.InputJsonValue,
      },
    });

    if (hasGovContracts) {
      const existingAlert = await prisma.alert.findFirst({
        where: { type: "POLITICAL_LINK", entityId: sh.entity.id, data: { path: ["politicianCpf"], equals: politician.cpf } },
      });
      if (!existingAlert) {
        const i18nParams = {
          politicianName: politician.name,
          party: politician.party,
          state: politician.state,
          position: politician.position,
          entityName: sh.entity.name,
          entityCnpj: sh.entity.cnpj,
          contractCount: sh.entity.contracts.length,
          totalContractValue: `R$ ${totalContractValue.toLocaleString("pt-BR")}`,
        };
        const i18n = buildAlertI18n(
          "alerts.templates.politicianShareholder.title",
          "alerts.templates.politicianShareholder.description",
          i18nParams,
        );
        await prisma.alert.create({
          data: {
            type: "POLITICAL_LINK", severity,
            title: renderPtBr("alerts.templates.politicianShareholder.title", i18nParams),
            description: renderPtBr("alerts.templates.politicianShareholder.description", i18nParams),
            entityId: sh.entity.id,
            data: {
              linkType: "SHAREHOLDER_IS_POLITICIAN", politicianCpf: politician.cpf, politicianName: politician.name,
              party: politician.party, position: politician.position, entityCnpj: sh.entity.cnpj,
              entityName: sh.entity.name, sameJurisdiction, contractCount: sh.entity.contracts.length, totalContractValue,
              i18n,
            } as unknown as Prisma.InputJsonValue,
          },
        });
      }
    }

    linksCreated++;
    if (linksCreated >= maxLinks) break;
  }

  console.log(`[analyze-political-links] SHAREHOLDER_IS_POLITICIAN: ${linksCreated} links`);
  return linksCreated;
}

async function detectSupplierDonatedToPolitician(maxLinks: number): Promise<number> {
  const entityCnpjs = await prisma.entity.findMany({
    where: { contracts: { some: {} } },
    select: { id: true, cnpj: true, name: true, state: true },
  });

  if (entityCnpjs.length === 0) return 0;

  const cnpjSet = new Set(entityCnpjs.map((e) => e.cnpj));
  const cnpjToEntity = new Map(entityCnpjs.map((e) => [e.cnpj, e]));

  const donations = await prisma.campaignDonation.findMany({
    where: { donorCpfCnpj: { in: [...cnpjSet] } },
    include: {
      politician: { select: { id: true, cpf: true, name: true, party: true, position: true, state: true } },
    },
  });

  let linksCreated = 0;
  const seen = new Set<string>();

  for (const donation of donations) {
    const entity = cnpjToEntity.get(donation.donorCpfCnpj);
    if (!entity) continue;

    const key = `${donation.politician.id}-${entity.id}-SUPPLIER_DONATED`;
    if (seen.has(key)) continue;
    seen.add(key);

    const existingLink = await prisma.politicalLink.findFirst({
      where: { politicianId: donation.politician.id, entityId: entity.id, linkType: "SUPPLIER_DONATED" },
    });
    if (existingLink) continue;

    const totalDonated = donations
      .filter((d) => d.donorCpfCnpj === donation.donorCpfCnpj && d.politicianId === donation.politicianId)
      .reduce((sum, d) => sum + Number(d.amount), 0);

    const contracts = await prisma.contract.findMany({
      where: { supplierCnpj: entity.cnpj },
      select: { id: true, value: true, orgName: true, procurementId: true },
      take: 5,
    });

    const totalContractValue = contracts.reduce((sum, c) => sum + Number(c.value), 0);
    const donationToContractRatio = totalContractValue > 0 ? totalDonated / totalContractValue : 0;
    const sameState = donation.politician.state === entity.state;

    let severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" = "MEDIUM";
    let strength = 0.5;

    if (donationToContractRatio > 0.1) { severity = "CRITICAL"; strength = 0.95; }
    else if (sameState && totalDonated > 10000) { severity = "HIGH"; strength = 0.8; }
    else if (sameState || totalDonated > 50000) { severity = "HIGH"; strength = 0.7; }

    await prisma.politicalLink.create({
      data: {
        politicianId: donation.politician.id, entityId: entity.id, contractId: contracts[0]?.id,
        linkType: "SUPPLIER_DONATED",
        description: `Empresa ${entity.name} (${entity.cnpj}) doou R$ ${totalDonated.toLocaleString("pt-BR")} para campanha de ${donation.politician.name} (${donation.politician.party}/${donation.politician.state}) e possui contratos governamentais no valor de R$ ${totalContractValue.toLocaleString("pt-BR")}`,
        strength,
        data: {
          politicianName: donation.politician.name, party: donation.politician.party, position: donation.politician.position,
          entityCnpj: entity.cnpj, entityName: entity.name, totalDonated, totalContractValue,
          donationToContractRatio, sameState, electionYear: donation.electionYear,
        } as unknown as Prisma.InputJsonValue,
      },
    });

    const existingAlert = await prisma.alert.findFirst({
      where: { type: "POLITICAL_LINK", entityId: entity.id, data: { path: ["linkType"], equals: "SUPPLIER_DONATED" } },
    });
    if (!existingAlert) {
      const i18nParams = {
        entityName: entity.name,
        entityCnpj: entity.cnpj,
        totalDonated: `R$ ${totalDonated.toLocaleString("pt-BR")}`,
        politicianName: donation.politician.name,
        party: donation.politician.party,
        totalContractValue: `R$ ${totalContractValue.toLocaleString("pt-BR")}`,
      };
      const i18n = buildAlertI18n(
        "alerts.templates.supplierDonated.title",
        "alerts.templates.supplierDonated.description",
        i18nParams,
      );
      await prisma.alert.create({
        data: {
          type: "POLITICAL_LINK", severity,
          title: renderPtBr("alerts.templates.supplierDonated.title", i18nParams),
          description: renderPtBr("alerts.templates.supplierDonated.description", i18nParams),
          entityId: entity.id, contractId: contracts[0]?.id, procurementId: contracts[0]?.procurementId,
          data: {
            linkType: "SUPPLIER_DONATED", politicianCpf: donation.politician.cpf, politicianName: donation.politician.name,
            party: donation.politician.party, entityCnpj: entity.cnpj, entityName: entity.name,
            totalDonated, totalContractValue, donationToContractRatio,
            i18n,
          } as unknown as Prisma.InputJsonValue,
        },
      });
    }

    linksCreated++;
    if (linksCreated >= maxLinks) break;
  }

  console.log(`[analyze-political-links] SUPPLIER_DONATED: ${linksCreated} links`);
  return linksCreated;
}

async function detectDonorGotContract(maxLinks: number): Promise<number> {
  const donations = await prisma.campaignDonation.findMany({
    where: { donorType: "PJ" },
    include: {
      politician: { select: { id: true, cpf: true, name: true, party: true, position: true, state: true, city: true } },
    },
  });

  if (donations.length === 0) return 0;

  const politicianDonors = new Map<string, { donorCnpjs: Set<string>; politician: (typeof donations)[0]["politician"] }>();
  for (const d of donations) {
    const existing = politicianDonors.get(d.politicianId);
    if (existing) { existing.donorCnpjs.add(d.donorCpfCnpj); }
    else { politicianDonors.set(d.politicianId, { donorCnpjs: new Set([d.donorCpfCnpj]), politician: d.politician }); }
  }

  let linksCreated = 0;

  for (const [politicianId, { donorCnpjs, politician }] of politicianDonors) {
    const contracts = await prisma.contract.findMany({
      where: {
        supplierCnpj: { in: [...donorCnpjs] },
        OR: [{ unitState: politician.state }, ...(politician.city ? [{ unitCity: politician.city }] : [])],
      },
      select: { id: true, supplierCnpj: true, supplierName: true, value: true, orgName: true, unitState: true, unitCity: true, procurementId: true },
      take: 20,
    });

    if (contracts.length === 0) continue;

    const supplierCnpjs = [...new Set(contracts.map((c) => c.supplierCnpj))];

    for (const cnpj of supplierCnpjs) {
      const existingLink = await prisma.politicalLink.findFirst({
        where: { politicianId, linkType: "DONOR_GOT_CONTRACT", data: { path: ["donorCnpj"], equals: cnpj } },
      });
      if (existingLink) continue;

      const entity = await prisma.entity.findUnique({ where: { cnpj }, select: { id: true, name: true } });
      if (!entity) continue;

      const relevantContracts = contracts.filter((c) => c.supplierCnpj === cnpj);
      const totalContractValue = relevantContracts.reduce((sum, c) => sum + Number(c.value), 0);
      const donorDonations = donations.filter((d) => d.donorCpfCnpj === cnpj && d.politicianId === politicianId);
      const totalDonated = donorDonations.reduce((sum, d) => sum + Number(d.amount), 0);

      let severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" = "HIGH";
      let strength = 0.7;
      if (totalContractValue > 100000 && totalDonated > 10000) { severity = "CRITICAL"; strength = 0.9; }

      await prisma.politicalLink.create({
        data: {
          politicianId, entityId: entity.id, contractId: relevantContracts[0]?.id,
          linkType: "DONOR_GOT_CONTRACT",
          description: `Doador de campanha de ${politician.name} (${politician.party}/${politician.state}) recebeu contratos governamentais na mesma jurisdição. ${entity.name} doou R$ ${totalDonated.toLocaleString("pt-BR")} e recebeu R$ ${totalContractValue.toLocaleString("pt-BR")} em contratos`,
          strength,
          data: {
            politicianName: politician.name, party: politician.party, position: politician.position,
            donorCnpj: cnpj, donorName: entity.name, totalDonated, totalContractValue,
            contractCount: relevantContracts.length, sameJurisdiction: true,
          } as unknown as Prisma.InputJsonValue,
        },
      });

      const existingAlert = await prisma.alert.findFirst({
        where: { type: "POLITICAL_LINK", entityId: entity.id, data: { path: ["linkType"], equals: "DONOR_GOT_CONTRACT" } },
      });
      if (!existingAlert) {
        const i18nParams = {
          donorName: entity.name,
          totalDonated: `R$ ${totalDonated.toLocaleString("pt-BR")}`,
          politicianName: politician.name,
          party: politician.party,
          state: politician.state,
          totalContractValue: `R$ ${totalContractValue.toLocaleString("pt-BR")}`,
        };
        const i18n = buildAlertI18n(
          "alerts.templates.donorGotContract.title",
          "alerts.templates.donorGotContract.description",
          i18nParams,
        );
        await prisma.alert.create({
          data: {
            type: "POLITICAL_LINK", severity,
            title: renderPtBr("alerts.templates.donorGotContract.title", i18nParams),
            description: renderPtBr("alerts.templates.donorGotContract.description", i18nParams),
            entityId: entity.id, contractId: relevantContracts[0]?.id, procurementId: relevantContracts[0]?.procurementId,
            data: {
              linkType: "DONOR_GOT_CONTRACT", politicianCpf: politician.cpf, politicianName: politician.name,
              party: politician.party, donorCnpj: cnpj, donorName: entity.name, totalDonated, totalContractValue,
              i18n,
            } as unknown as Prisma.InputJsonValue,
          },
        });
      }

      linksCreated++;
      if (linksCreated >= maxLinks) break;
    }
    if (linksCreated >= maxLinks) break;
  }

  console.log(`[analyze-political-links] DONOR_GOT_CONTRACT: ${linksCreated} links`);
  return linksCreated;
}

// ---------------------------------------------------------------------------
// Family detection — CPF-confirmed only (Tier 3 surname heuristics removed)
// ---------------------------------------------------------------------------

async function detectFamilyInSupplier(maxLinks: number): Promise<number> {
  const politicians = await prisma.politician.findMany({
    select: { id: true, cpf: true, name: true, party: true, position: true, state: true, city: true, familyFetchedAt: true },
  });

  if (politicians.length === 0) return 0;

  const shareholders = await prisma.shareholder.findMany({
    where: { cpfCnpj: { not: null } },
    include: {
      entity: {
        select: { id: true, cnpj: true, name: true, state: true, city: true, contracts: { select: { id: true }, take: 1 } },
      },
    },
  });

  const allRelatives = await prisma.politicianRelative.findMany({
    select: { politicianId: true, relativeCpf: true, relationship: true, relativeName: true },
  });
  const relativesByPolitician = new Map<string, Map<string, { relationship: string; relativeName: string }>>();
  for (const rel of allRelatives) {
    let cpfMap = relativesByPolitician.get(rel.politicianId);
    if (!cpfMap) { cpfMap = new Map(); relativesByPolitician.set(rel.politicianId, cpfMap); }
    cpfMap.set(rel.relativeCpf, { relationship: rel.relationship, relativeName: rel.relativeName });
  }

  let linksCreated = 0;

  for (const sh of shareholders) {
    if (!sh.name || sh.entity.contracts.length === 0 || !sh.cpfCnpj) continue;
    const shCpf = sh.cpfCnpj.replace(/\D/g, "");

    for (const politician of politicians) {
      if (shCpf === politician.cpf) continue;

      const relativesMap = relativesByPolitician.get(politician.id);
      const confirmedRelative = relativesMap?.get(shCpf);

      if (!confirmedRelative) continue;

      const existing = await prisma.politicalLink.findFirst({
        where: { politicianId: politician.id, entityId: sh.entity.id, shareholderId: sh.id, linkType: "FAMILY_IN_SUPPLIER" },
      });
      if (existing) continue;

      const relLabel = renderCodePtBr("relationship", confirmedRelative.relationship);

      await prisma.politicalLink.create({
        data: {
          politicianId: politician.id, entityId: sh.entity.id, shareholderId: sh.id,
          linkType: "FAMILY_IN_SUPPLIER",
          description: `Sócio "${sh.name}" da empresa ${sh.entity.name} (${sh.entity.cnpj}) consta como ${relLabel} do político ${politician.name} (${politician.party}/${politician.state}) — vínculo confirmado por CPF, recomendado revisar`,
          strength: 0.85,
          data: {
            politicianName: politician.name, shareholderName: sh.name,
            relationship: confirmedRelative.relationship,
            confirmed: true, entityCnpj: sh.entity.cnpj, entityName: sh.entity.name,
          } as unknown as Prisma.InputJsonValue,
        },
      });

      const i18nParams = {
        shareholderName: sh.name,
        relationshipLabel: confirmedRelative.relationship,
        politicianName: politician.name,
        party: politician.party,
        state: politician.state,
        entityName: sh.entity.name,
        entityCnpj: sh.entity.cnpj,
      };
      const fallbackParams = { ...i18nParams, relationshipLabel: relLabel };
      const i18n = buildAlertI18n(
        "alerts.templates.familyInSupplier.title",
        "alerts.templates.familyInSupplier.description",
        i18nParams,
      );

      await prisma.alert.create({
        data: {
          type: "POLITICAL_LINK", severity: "HIGH",
          title: renderPtBr("alerts.templates.familyInSupplier.title", fallbackParams),
          description: renderPtBr("alerts.templates.familyInSupplier.description", fallbackParams),
          entityId: sh.entity.id,
          data: {
            linkType: "FAMILY_IN_SUPPLIER", politicianCpf: politician.cpf, politicianName: politician.name,
            shareholderName: sh.name, relationship: confirmedRelative.relationship, confirmed: true, entityCnpj: sh.entity.cnpj,
            i18n,
          } as unknown as Prisma.InputJsonValue,
        },
      });

      linksCreated++;
      if (linksCreated >= maxLinks) break;
    }
    if (linksCreated >= maxLinks) break;
  }

  console.log(`[analyze-political-links] FAMILY_IN_SUPPLIER: ${linksCreated} links`);
  return linksCreated;
}

async function detectFamilyDonated(maxLinks: number): Promise<number> {
  const politicians = await prisma.politician.findMany({
    select: { id: true, cpf: true, name: true, party: true, position: true, state: true, familyFetchedAt: true },
  });

  if (politicians.length === 0) return 0;

  const pfDonations = await prisma.campaignDonation.findMany({
    where: { donorType: "PF" },
    select: { id: true, donorName: true, donorCpfCnpj: true, amount: true, electionYear: true, politicianId: true },
  });

  const donationsByPolitician = new Map<string, typeof pfDonations>();
  for (const d of pfDonations) {
    const list = donationsByPolitician.get(d.politicianId) ?? [];
    list.push(d);
    donationsByPolitician.set(d.politicianId, list);
  }

  const allRelatives = await prisma.politicianRelative.findMany({
    select: { politicianId: true, relativeCpf: true, relationship: true, relativeName: true },
  });
  const relativesByPolitician = new Map<string, Map<string, { relationship: string; relativeName: string }>>();
  for (const rel of allRelatives) {
    let cpfMap = relativesByPolitician.get(rel.politicianId);
    if (!cpfMap) { cpfMap = new Map(); relativesByPolitician.set(rel.politicianId, cpfMap); }
    cpfMap.set(rel.relativeCpf, { relationship: rel.relationship, relativeName: rel.relativeName });
  }

  let linksCreated = 0;

  for (const politician of politicians) {
    const donations = donationsByPolitician.get(politician.id) ?? [];
    const relativesMap = relativesByPolitician.get(politician.id);

    for (const d of donations) {
      if (d.donorCpfCnpj === politician.cpf) continue;

      const donorCpf = d.donorCpfCnpj.replace(/\D/g, "");
      const confirmedRelative = relativesMap?.get(donorCpf);

      if (!confirmedRelative) continue;

      const existing = await prisma.politicalLink.findFirst({
        where: { politicianId: politician.id, linkType: "FAMILY_DONATED", data: { path: ["donorCpfCnpj"], equals: d.donorCpfCnpj } },
      });
      if (existing) continue;

      const amount = Number(d.amount);
      const relLabel = renderCodePtBr("relationship", confirmedRelative.relationship);

      await prisma.politicalLink.create({
        data: {
          politicianId: politician.id, linkType: "FAMILY_DONATED",
          description: `Doador PF "${d.donorName}" consta como ${relLabel} de ${politician.name} (${politician.party}/${politician.state}) e doou R$ ${amount.toLocaleString("pt-BR")} — vínculo confirmado por CPF, recomendado revisar`,
          strength: 0.85,
          data: {
            politicianName: politician.name, donorName: d.donorName, donorCpfCnpj: d.donorCpfCnpj,
            relationship: confirmedRelative.relationship,
            confirmed: true, amount, electionYear: d.electionYear,
          } as unknown as Prisma.InputJsonValue,
        },
      });

      const i18nParams = {
        donorName: d.donorName,
        relationshipLabel: confirmedRelative.relationship,
        politicianName: politician.name,
        party: politician.party,
        state: politician.state,
        amount: `R$ ${amount.toLocaleString("pt-BR")}`,
      };
      const fallbackParams = { ...i18nParams, relationshipLabel: relLabel };
      const i18n = buildAlertI18n(
        "alerts.templates.familyDonated.title",
        "alerts.templates.familyDonated.description",
        i18nParams,
      );

      await prisma.alert.create({
        data: {
          type: "POLITICAL_LINK", severity: "HIGH",
          title: renderPtBr("alerts.templates.familyDonated.title", fallbackParams),
          description: renderPtBr("alerts.templates.familyDonated.description", fallbackParams),
          data: {
            linkType: "FAMILY_DONATED", politicianCpf: politician.cpf, politicianName: politician.name,
            donorName: d.donorName, donorCpfCnpj: d.donorCpfCnpj, relationship: confirmedRelative.relationship,
            confirmed: true, amount,
            i18n,
          } as unknown as Prisma.InputJsonValue,
        },
      });

      linksCreated++;
      if (linksCreated >= maxLinks) break;
    }
    if (linksCreated >= maxLinks) break;
  }

  console.log(`[analyze-political-links] FAMILY_DONATED: ${linksCreated} links`);
  return linksCreated;
}

// ---------------------------------------------------------------------------
// Servant and wealth anomaly
// ---------------------------------------------------------------------------

async function detectPoliticianIsServant(maxLinks: number): Promise<number> {
  const servants = await prisma.publicServant.findMany({
    include: { politician: { select: { id: true, cpf: true, name: true, party: true, position: true, state: true } } },
  });

  if (servants.length === 0) return 0;

  const grouped = new Map<string, typeof servants>();
  for (const s of servants) {
    const list = grouped.get(s.politicianId) ?? [];
    list.push(s);
    grouped.set(s.politicianId, list);
  }

  let linksCreated = 0;

  for (const [politicianId, servantRecords] of grouped) {
    const existing = await prisma.politicalLink.findFirst({ where: { politicianId, linkType: "POLITICIAN_IS_SERVANT" } });
    if (existing) continue;

    const politician = servantRecords[0]!.politician;
    const primary = servantRecords[0]!;

    await prisma.politicalLink.create({
      data: {
        politicianId, linkType: "POLITICIAN_IS_SERVANT",
        description: `${politician.name} (${politician.party}/${politician.state} - ${politician.position}) é/foi servidor público federal: ${primary.cargo ?? "cargo não informado"} no ${primary.orgao ?? "órgão não informado"}`,
        strength: 0.8,
        data: {
          politicianName: politician.name, party: politician.party, position: politician.position,
          cargo: primary.cargo, funcao: primary.funcao, orgao: primary.orgao, situacao: primary.situacao,
          remuneracao: primary.remuneracao ? Number(primary.remuneracao) : null, recordCount: servantRecords.length,
        } as unknown as Prisma.InputJsonValue,
      },
    });

    const i18nParams = {
      politicianName: politician.name,
      party: politician.party,
      state: politician.state,
      position: politician.position,
      cargo: primary.cargo ?? "N/I",
      orgao: primary.orgao ?? "N/I",
    };
    const i18n = buildAlertI18n(
      "alerts.templates.politicianServant.title",
      "alerts.templates.politicianServant.description",
      i18nParams,
    );
    await prisma.alert.create({
      data: {
        type: "POLITICAL_LINK", severity: "MEDIUM",
        title: renderPtBr("alerts.templates.politicianServant.title", i18nParams),
        description: renderPtBr("alerts.templates.politicianServant.description", i18nParams),
        data: {
          linkType: "POLITICIAN_IS_SERVANT", politicianCpf: politician.cpf, politicianName: politician.name,
          cargo: primary.cargo, orgao: primary.orgao, situacao: primary.situacao,
          i18n,
        } as unknown as Prisma.InputJsonValue,
      },
    });

    linksCreated++;
    if (linksCreated >= maxLinks) break;
  }

  console.log(`[analyze-political-links] POLITICIAN_IS_SERVANT: ${linksCreated} links`);
  return linksCreated;
}

async function detectWealthAnomaly(maxLinks: number): Promise<number> {
  const politicians = await prisma.politician.findMany({
    include: { assets: { select: { value: true, electionYear: true }, orderBy: { electionYear: "asc" } } },
    where: { assets: { some: {} } },
  });

  let linksCreated = 0;

  for (const politician of politicians) {
    const existing = await prisma.politicalLink.findFirst({ where: { politicianId: politician.id, linkType: "WEALTH_ANOMALY" } });
    if (existing) continue;

    const byYear = new Map<number, number>();
    for (const a of politician.assets) {
      byYear.set(a.electionYear, (byYear.get(a.electionYear) ?? 0) + Number(a.value));
    }

    const years = [...byYear.keys()].sort();
    if (years.length < 2) continue;

    for (let i = 1; i < years.length; i++) {
      const prevYear = years[i - 1]!;
      const currYear = years[i]!;
      const prevTotal = byYear.get(prevYear)!;
      const currTotal = byYear.get(currYear)!;
      if (prevTotal <= 0) continue;

      const growthPct = ((currTotal - prevTotal) / prevTotal) * 100;
      if (growthPct <= 300) continue;

      await prisma.politicalLink.create({
        data: {
          politicianId: politician.id, linkType: "WEALTH_ANOMALY",
          description: `Patrimônio declarado de ${politician.name} cresceu ${growthPct.toFixed(0)}% entre ${prevYear} e ${currYear} (R$ ${prevTotal.toLocaleString("pt-BR")} → R$ ${currTotal.toLocaleString("pt-BR")})`,
          strength: Math.min(0.95, growthPct / 1000 + 0.5),
          data: {
            politicianName: politician.name, party: politician.party, position: politician.position,
            previousYear: prevYear, currentYear: currYear, previousTotal: prevTotal, currentTotal: currTotal, growthPercentage: growthPct,
          } as unknown as Prisma.InputJsonValue,
        },
      });

      let severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" = "HIGH";
      if (growthPct > 1000) severity = "CRITICAL";

      const existingWealthAlert = await prisma.alert.findFirst({
        where: { type: "POLITICAL_LINK", data: { path: ["linkType"], equals: "WEALTH_ANOMALY" }, AND: { data: { path: ["politicianCpf"], equals: politician.cpf } } },
      });
      if (!existingWealthAlert) {
        const i18nParams = {
          politicianName: politician.name,
          party: politician.party,
          state: politician.state,
          previousTotal: `R$ ${prevTotal.toLocaleString("pt-BR")}`,
          previousYear: prevYear,
          currentTotal: `R$ ${currTotal.toLocaleString("pt-BR")}`,
          currentYear: currYear,
          growthPercentage: growthPct.toFixed(0),
        };
        const i18n = buildAlertI18n(
          "alerts.templates.wealthAnomaly.title",
          "alerts.templates.wealthAnomaly.description",
          i18nParams,
        );
        await prisma.alert.create({
          data: {
            type: "POLITICAL_LINK", severity,
            title: renderPtBr("alerts.templates.wealthAnomaly.title", i18nParams),
            description: renderPtBr("alerts.templates.wealthAnomaly.description", i18nParams),
            data: {
              linkType: "WEALTH_ANOMALY", politicianCpf: politician.cpf, politicianName: politician.name,
              previousYear: prevYear, currentYear: currYear, previousTotal: prevTotal, currentTotal: currTotal, growthPercentage: growthPct,
              i18n,
            } as unknown as Prisma.InputJsonValue,
          },
        });
      }

      linksCreated++;
      if (linksCreated >= maxLinks) break;
      break;
    }
    if (linksCreated >= maxLinks) break;
  }

  console.log(`[analyze-political-links] WEALTH_ANOMALY: ${linksCreated} links`);
  return linksCreated;
}

// ---------------------------------------------------------------------------
// NEW: Donation graph strategies
// ---------------------------------------------------------------------------

async function detectDonorIsShareholder(maxLinks: number): Promise<number> {
  const pfDonations = await prisma.campaignDonation.findMany({
    where: { donorType: "PF", donorCpfCnpj: { not: "" } },
    select: { donorCpfCnpj: true, donorName: true, amount: true, electionYear: true, politicianId: true },
  });

  if (pfDonations.length === 0) return 0;

  const donorCpfs = [...new Set(pfDonations.map((d) => d.donorCpfCnpj))];

  const shareholders = await prisma.shareholder.findMany({
    where: { cpfCnpj: { in: donorCpfs } },
    include: {
      entity: {
        select: {
          id: true, cnpj: true, name: true, state: true,
          contracts: { select: { id: true, value: true }, take: 5 },
        },
      },
    },
  });

  if (shareholders.length === 0) return 0;

  const cpfToShareholders = new Map<string, typeof shareholders>();
  for (const sh of shareholders) {
    if (!sh.cpfCnpj || sh.entity.contracts.length === 0) continue;
    const list = cpfToShareholders.get(sh.cpfCnpj) ?? [];
    list.push(sh);
    cpfToShareholders.set(sh.cpfCnpj, list);
  }

  const donationsByKey = new Map<string, { totalDonated: number; donorName: string; electionYear: number }>();
  for (const d of pfDonations) {
    if (!cpfToShareholders.has(d.donorCpfCnpj)) continue;
    const key = `${d.politicianId}-${d.donorCpfCnpj}`;
    const existing = donationsByKey.get(key);
    if (existing) {
      existing.totalDonated += Number(d.amount);
    } else {
      donationsByKey.set(key, { totalDonated: Number(d.amount), donorName: d.donorName, electionYear: d.electionYear });
    }
  }

  const politicians = await prisma.politician.findMany({
    where: { id: { in: [...new Set(pfDonations.map((d) => d.politicianId))] } },
    select: { id: true, cpf: true, name: true, party: true, position: true, state: true },
  });
  const politicianMap = new Map(politicians.map((p) => [p.id, p]));

  let linksCreated = 0;

  for (const [key, { totalDonated, donorName, electionYear }] of donationsByKey) {
    const [politicianId, donorCpf] = key.split("-");
    const politician = politicianMap.get(politicianId!);
    if (!politician) continue;

    const shList = cpfToShareholders.get(donorCpf!) ?? [];

    for (const sh of shList) {
      const existing = await prisma.politicalLink.findFirst({
        where: { politicianId: politician.id, entityId: sh.entity.id, linkType: "DONOR_IS_SHAREHOLDER" },
      });
      if (existing) continue;

      const totalContractValue = sh.entity.contracts.reduce((sum, c) => sum + Number(c.value), 0);
      const sameState = politician.state === sh.entity.state;

      let strength = 0.7;
      let severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" = "HIGH";
      if (sameState && totalDonated > 10000) { strength = 0.95; severity = "CRITICAL"; }
      else if (sameState) { strength = 0.9; severity = "CRITICAL"; }
      else if (totalDonated > 10000) { strength = 0.85; severity = "HIGH"; }

      await prisma.politicalLink.create({
        data: {
          politicianId: politician.id, entityId: sh.entity.id, shareholderId: sh.id,
          linkType: "DONOR_IS_SHAREHOLDER",
          description: `Doador PF "${donorName}" (CPF: ${donorCpf}) doou R$ ${totalDonated.toLocaleString("pt-BR")} para ${politician.name} (${politician.party}/${politician.state}) e é sócio de ${sh.entity.name} (${sh.entity.cnpj}) que tem R$ ${totalContractValue.toLocaleString("pt-BR")} em contratos`,
          strength,
          data: {
            politicianName: politician.name, party: politician.party, position: politician.position,
            donorName, donorCpf, totalDonated, entityCnpj: sh.entity.cnpj, entityName: sh.entity.name,
            totalContractValue, sameState, electionYear, shareholderRole: sh.role,
          } as unknown as Prisma.InputJsonValue,
        },
      });

      const i18nParams = {
        donorName,
        totalDonated: `R$ ${totalDonated.toLocaleString("pt-BR")}`,
        politicianName: politician.name,
        party: politician.party,
        state: politician.state,
        entityName: sh.entity.name,
        entityCnpj: sh.entity.cnpj,
        totalContractValue: `R$ ${totalContractValue.toLocaleString("pt-BR")}`,
      };
      const i18n = buildAlertI18n(
        "alerts.templates.donorIsShareholder.title",
        "alerts.templates.donorIsShareholder.description",
        i18nParams,
      );
      await prisma.alert.create({
        data: {
          type: "POLITICAL_LINK", severity,
          title: renderPtBr("alerts.templates.donorIsShareholder.title", i18nParams),
          description: renderPtBr("alerts.templates.donorIsShareholder.description", i18nParams),
          entityId: sh.entity.id,
          data: {
            linkType: "DONOR_IS_SHAREHOLDER", politicianCpf: politician.cpf, politicianName: politician.name,
            donorName, donorCpf, totalDonated, entityCnpj: sh.entity.cnpj, entityName: sh.entity.name,
            totalContractValue, sameState,
            i18n,
          } as unknown as Prisma.InputJsonValue,
        },
      });

      linksCreated++;
      if (linksCreated >= maxLinks) break;
    }
    if (linksCreated >= maxLinks) break;
  }

  console.log(`[analyze-political-links] DONOR_IS_SHAREHOLDER: ${linksCreated} links`);
  return linksCreated;
}

async function detectDonationTiming(maxLinks: number): Promise<number> {
  const pjDonations = await prisma.campaignDonation.findMany({
    where: { donorType: "PJ", donationDate: { not: null } },
    select: { donorCpfCnpj: true, donorName: true, donationDate: true, amount: true, politicianId: true, electionYear: true },
  });

  if (pjDonations.length === 0) return 0;

  const politicians = await prisma.politician.findMany({
    where: { id: { in: [...new Set(pjDonations.map((d) => d.politicianId))] } },
    select: { id: true, cpf: true, name: true, party: true, position: true, state: true, city: true },
  });
  const politicianMap = new Map(politicians.map((p) => [p.id, p]));

  const donorCnpjs = [...new Set(pjDonations.map((d) => d.donorCpfCnpj))];
  const entities = await prisma.entity.findMany({
    where: { cnpj: { in: donorCnpjs }, contracts: { some: {} } },
    select: { id: true, cnpj: true, name: true },
  });
  const cnpjToEntity = new Map(entities.map((e) => [e.cnpj, e]));

  let linksCreated = 0;
  const seen = new Set<string>();

  for (const donation of pjDonations) {
    const entity = cnpjToEntity.get(donation.donorCpfCnpj);
    if (!entity) continue;
    const politician = politicianMap.get(donation.politicianId);
    if (!politician) continue;

    const dedupeKey = `${politician.id}-${entity.id}-DONATION_TIMING`;
    if (seen.has(dedupeKey)) continue;

    const donDate = donation.donationDate!;
    const twelveMonthsBefore = new Date(donDate);
    twelveMonthsBefore.setMonth(twelveMonthsBefore.getMonth() - 12);
    const twelveMonthsAfter = new Date(donDate);
    twelveMonthsAfter.setMonth(twelveMonthsAfter.getMonth() + 12);

    const nearbyContracts = await prisma.contract.findMany({
      where: {
        supplierCnpj: entity.cnpj,
        startDate: { gte: twelveMonthsBefore, lte: twelveMonthsAfter },
        OR: [{ unitState: politician.state }, ...(politician.city ? [{ unitCity: politician.city }] : [])],
      },
      select: { id: true, startDate: true, value: true, orgName: true, procurementId: true },
      take: 10,
    });

    if (nearbyContracts.length === 0) continue;
    seen.add(dedupeKey);

    const existing = await prisma.politicalLink.findFirst({
      where: { politicianId: politician.id, entityId: entity.id, linkType: "DONATION_TIMING" },
    });
    if (existing) continue;

    const closest = nearbyContracts.reduce((best, c) => {
      const gap = Math.abs(c.startDate.getTime() - donDate.getTime());
      return gap < best.gap ? { contract: c, gap } : best;
    }, { contract: nearbyContracts[0]!, gap: Math.abs(nearbyContracts[0]!.startDate.getTime() - donDate.getTime()) });

    const gapMonths = closest.gap / (1000 * 60 * 60 * 24 * 30);
    let strength: number;
    let severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
    if (gapMonths <= 3) { strength = 0.95; severity = "CRITICAL"; }
    else if (gapMonths <= 6) { strength = 0.85; severity = "HIGH"; }
    else { strength = 0.7; severity = "HIGH"; }

    const totalContractValue = nearbyContracts.reduce((sum, c) => sum + Number(c.value), 0);
    const donatedAmount = Number(donation.amount);

    await prisma.politicalLink.create({
      data: {
        politicianId: politician.id, entityId: entity.id, contractId: closest.contract.id,
        linkType: "DONATION_TIMING",
        description: `${entity.name} doou R$ ${donatedAmount.toLocaleString("pt-BR")} para ${politician.name} (${politician.party}/${politician.state}) e recebeu contrato de R$ ${Number(closest.contract.value).toLocaleString("pt-BR")} apenas ${gapMonths.toFixed(0)} meses ${closest.contract.startDate > donDate ? "depois" : "antes"}`,
        strength,
        data: {
          politicianName: politician.name, party: politician.party, entityCnpj: entity.cnpj, entityName: entity.name,
          donationDate: donDate.toISOString(), contractDate: closest.contract.startDate.toISOString(),
          gapMonths: Math.round(gapMonths), donatedAmount, totalContractValue, contractCount: nearbyContracts.length,
        } as unknown as Prisma.InputJsonValue,
      },
    });

    const direction = closest.contract.startDate > donDate ? "depois" : "antes";
    const i18nParams = {
      entityName: entity.name,
      politicianName: politician.name,
      gapMonths: gapMonths.toFixed(0),
      direction,
      totalContractValue: `R$ ${totalContractValue.toLocaleString("pt-BR")}`,
    };
    const i18n = buildAlertI18n(
      "alerts.templates.donationTiming.title",
      "alerts.templates.donationTiming.description",
      i18nParams,
    );
    await prisma.alert.create({
      data: {
        type: "POLITICAL_LINK", severity,
        title: renderPtBr("alerts.templates.donationTiming.title", i18nParams),
        description: renderPtBr("alerts.templates.donationTiming.description", i18nParams),
        entityId: entity.id, contractId: closest.contract.id, procurementId: closest.contract.procurementId,
        data: {
          linkType: "DONATION_TIMING", politicianCpf: politician.cpf, politicianName: politician.name,
          entityCnpj: entity.cnpj, entityName: entity.name, gapMonths: Math.round(gapMonths),
          donatedAmount, totalContractValue,
          i18n,
        } as unknown as Prisma.InputJsonValue,
      },
    });

    linksCreated++;
    if (linksCreated >= maxLinks) break;
  }

  console.log(`[analyze-political-links] DONATION_TIMING: ${linksCreated} links`);
  return linksCreated;
}

async function detectDonorConcentration(maxLinks: number): Promise<number> {
  const pjDonations = await prisma.campaignDonation.findMany({
    where: { donorType: "PJ" },
    select: { donorCpfCnpj: true, donorName: true, amount: true, politicianId: true },
  });

  if (pjDonations.length === 0) return 0;

  const donorToPoliticians = new Map<string, { politicianIds: Set<string>; totalDonated: number; donorName: string }>();
  for (const d of pjDonations) {
    const existing = donorToPoliticians.get(d.donorCpfCnpj);
    if (existing) {
      existing.politicianIds.add(d.politicianId);
      existing.totalDonated += Number(d.amount);
    } else {
      donorToPoliticians.set(d.donorCpfCnpj, {
        politicianIds: new Set([d.politicianId]),
        totalDonated: Number(d.amount),
        donorName: d.donorName,
      });
    }
  }

  const concentratedDonors = [...donorToPoliticians.entries()]
    .filter(([, v]) => v.politicianIds.size >= 3);

  if (concentratedDonors.length === 0) return 0;

  const cnpjs = concentratedDonors.map(([cnpj]) => cnpj);
  const entities = await prisma.entity.findMany({
    where: { cnpj: { in: cnpjs }, contracts: { some: {} } },
    select: { id: true, cnpj: true, name: true, _count: { select: { contracts: true } } },
  });
  const cnpjToEntity = new Map(entities.map((e) => [e.cnpj, e]));

  const allPoliticianIds = new Set<string>();
  for (const [, v] of concentratedDonors) {
    for (const pid of v.politicianIds) allPoliticianIds.add(pid);
  }
  const politicians = await prisma.politician.findMany({
    where: { id: { in: [...allPoliticianIds] } },
    select: { id: true, cpf: true, name: true, party: true, position: true, state: true },
  });
  const politicianMap = new Map(politicians.map((p) => [p.id, p]));

  let linksCreated = 0;

  for (const [cnpj, { politicianIds, totalDonated, donorName }] of concentratedDonors) {
    const entity = cnpjToEntity.get(cnpj);
    if (!entity) continue;

    const politicianCount = politicianIds.size;
    let strength = 0.7;
    let severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" = "HIGH";
    if (politicianCount >= 5) { strength = 0.95; severity = "CRITICAL"; }
    else if (politicianCount >= 4) { strength = 0.85; severity = "CRITICAL"; }

    for (const politicianId of politicianIds) {
      const politician = politicianMap.get(politicianId);
      if (!politician) continue;

      const existing = await prisma.politicalLink.findFirst({
        where: { politicianId, entityId: entity.id, linkType: "DONOR_CONCENTRATION" },
      });
      if (existing) continue;

      const donatedToThis = pjDonations
        .filter((d) => d.donorCpfCnpj === cnpj && d.politicianId === politicianId)
        .reduce((sum, d) => sum + Number(d.amount), 0);

      await prisma.politicalLink.create({
        data: {
          politicianId, entityId: entity.id,
          linkType: "DONOR_CONCENTRATION",
          description: `${entity.name} (${cnpj}) doou para ${politicianCount} políticos diferentes (R$ ${totalDonated.toLocaleString("pt-BR")} total) e possui ${entity._count.contracts} contratos governamentais. Doou R$ ${donatedToThis.toLocaleString("pt-BR")} para ${politician.name}`,
          strength,
          data: {
            politicianName: politician.name, party: politician.party, entityCnpj: cnpj, entityName: entity.name,
            politicianCount, totalDonated, donatedToThis, contractCount: entity._count.contracts,
          } as unknown as Prisma.InputJsonValue,
        },
      });

      linksCreated++;
      if (linksCreated >= maxLinks) break;
    }

    if (linksCreated >= maxLinks) break;

    const existingAlert = await prisma.alert.findFirst({
      where: { type: "POLITICAL_LINK", entityId: entity.id, data: { path: ["linkType"], equals: "DONOR_CONCENTRATION" } },
    });
    if (!existingAlert) {
      const politicianNames = [...politicianIds]
        .map((id) => politicianMap.get(id))
        .filter(Boolean)
        .map((p) => `${p!.name} (${p!.party})`)
        .slice(0, 5);

      const politicianNamesText = politicianNames.join(", ") + (politicianCount > 5 ? ` e mais ${politicianCount - 5}` : "");
      const i18nParams = {
        politicianCount,
        entityName: entity.name,
        entityCnpj: cnpj,
        totalDonated: `R$ ${totalDonated.toLocaleString("pt-BR")}`,
        politicianNames: politicianNamesText,
        contractCount: entity._count.contracts,
      };
      const i18n = buildAlertI18n(
        "alerts.templates.donorConcentration.title",
        "alerts.templates.donorConcentration.description",
        i18nParams,
      );
      await prisma.alert.create({
        data: {
          type: "POLITICAL_LINK", severity,
          title: renderPtBr("alerts.templates.donorConcentration.title", i18nParams),
          description: renderPtBr("alerts.templates.donorConcentration.description", i18nParams),
          entityId: entity.id,
          data: {
            linkType: "DONOR_CONCENTRATION", entityCnpj: cnpj, entityName: donorName,
            politicianCount, totalDonated, contractCount: entity._count.contracts,
            i18n,
          } as unknown as Prisma.InputJsonValue,
        },
      });
    }
  }

  console.log(`[analyze-political-links] DONOR_CONCENTRATION: ${linksCreated} links`);
  return linksCreated;
}
