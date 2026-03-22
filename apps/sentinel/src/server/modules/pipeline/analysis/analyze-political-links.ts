import { prisma } from "@sentinel/server/lib/prisma";
import { Prisma } from "@/generated/prisma";
import { runJob } from "@sentinel/server/lib/job-runner";
import { computeSurnameMatchScore, normalizeName } from "@/lib/utils/surname";

export async function analyzePoliticalLinks() {
  return runJob("analyze-political-links", "analysis", async () => {
    let recordsOut = 0;

    const shareholderLinks = await detectShareholderIsPolitician();
    recordsOut += shareholderLinks;

    const supplierDonorLinks = await detectSupplierDonatedToPolitician();
    recordsOut += supplierDonorLinks;

    const donorContractLinks = await detectDonorGotContract();
    recordsOut += donorContractLinks;

    const purgedLinks = await purgeOldFamilyLinks();

    const familySupplierLinks = await detectFamilyInSupplier();
    recordsOut += familySupplierLinks;

    const familyDonatedLinks = await detectFamilyDonated();
    recordsOut += familyDonatedLinks;

    const servantLinks = await detectPoliticianIsServant();
    recordsOut += servantLinks;

    const wealthLinks = await detectWealthAnomaly();
    recordsOut += wealthLinks;

    const politicians = await prisma.politician.count();
    const donations = await prisma.campaignDonation.count();

    return {
      recordsIn: politicians + donations,
      recordsOut,
      metadata: {
        shareholderLinks,
        supplierDonorLinks,
        donorContractLinks,
        purgedLinks,
        familySupplierLinks,
        familyDonatedLinks,
        servantLinks,
        wealthLinks,
      },
    };
  });
}

async function purgeOldFamilyLinks(): Promise<{ links: number; alerts: number }> {
  const FAMILY_TYPES = ["FAMILY_IN_SUPPLIER", "FAMILY_DONATED"];

  const { count: linksDeleted } = await prisma.politicalLink.deleteMany({
    where: { linkType: { in: FAMILY_TYPES } },
  });

  const { count: alertsDeleted } = await prisma.alert.deleteMany({
    where: {
      type: "POLITICAL_LINK",
      OR: FAMILY_TYPES.map((t) => ({
        data: { path: ["linkType"], equals: t },
      })),
    },
  });

  console.log(`[analyze-political-links] Purged ${linksDeleted} old family links, ${alertsDeleted} old family alerts`);
  return { links: linksDeleted, alerts: alertsDeleted };
}

async function detectShareholderIsPolitician(): Promise<number> {
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
            select: {
              id: true,
              orgName: true,
              value: true,
              unitState: true,
              unitCity: true,
            },
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
      where: {
        politicianId: politician.id,
        entityId: sh.entity.id,
        linkType: "SHAREHOLDER_IS_POLITICIAN",
      },
    });
    if (existingLink) continue;

    const sameJurisdiction =
      politician.state === sh.entity.state ||
      sh.entity.contracts.some(
        (c) => c.unitState === politician.state,
      );

    const hasGovContracts = sh.entity.contracts.length > 0;
    const totalContractValue = sh.entity.contracts.reduce(
      (sum, c) => sum + Number(c.value),
      0,
    );

    let severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" = "MEDIUM";
    let strength = 0.5;

    if (sameJurisdiction && hasGovContracts) {
      severity = "CRITICAL";
      strength = 0.9;
    } else if (hasGovContracts) {
      severity = "HIGH";
      strength = 0.7;
    } else if (sameJurisdiction) {
      severity = "HIGH";
      strength = 0.6;
    }

    await prisma.politicalLink.create({
      data: {
        politicianId: politician.id,
        entityId: sh.entity.id,
        shareholderId: sh.id,
        linkType: "SHAREHOLDER_IS_POLITICIAN",
        description: `${politician.name} (${politician.party}/${politician.state} - ${politician.position}) é sócio da empresa ${sh.entity.name} (${sh.entity.cnpj}) com função "${sh.role}"`,
        strength,
        data: {
          politicianName: politician.name,
          party: politician.party,
          position: politician.position,
          entityCnpj: sh.entity.cnpj,
          entityName: sh.entity.name,
          shareholderRole: sh.role,
          sameJurisdiction,
          hasGovContracts,
          totalContractValue,
        } as unknown as Prisma.InputJsonValue,
      },
    });

    if (hasGovContracts) {
      const existingAlert = await prisma.alert.findFirst({
        where: {
          type: "POLITICAL_LINK",
          entityId: sh.entity.id,
          data: {
            path: ["politicianCpf"],
            equals: politician.cpf,
          },
        },
      });

      if (!existingAlert) {
        await prisma.alert.create({
          data: {
            type: "POLITICAL_LINK",
            severity,
            title: `Político é sócio de fornecedor do governo`,
            description: `${politician.name} (${politician.party}/${politician.state} - ${politician.position}) é sócio da empresa ${sh.entity.name} (CNPJ: ${sh.entity.cnpj}) que possui ${sh.entity.contracts.length} contratos governamentais totalizando R$ ${totalContractValue.toLocaleString("pt-BR")}`,
            entityId: sh.entity.id,
            data: {
              linkType: "SHAREHOLDER_IS_POLITICIAN",
              politicianCpf: politician.cpf,
              politicianName: politician.name,
              party: politician.party,
              position: politician.position,
              entityCnpj: sh.entity.cnpj,
              entityName: sh.entity.name,
              sameJurisdiction,
              contractCount: sh.entity.contracts.length,
              totalContractValue,
            } as unknown as Prisma.InputJsonValue,
          },
        });
      }
    }

    linksCreated++;
  }

  console.log(`[analyze-political-links] SHAREHOLDER_IS_POLITICIAN: ${linksCreated} links`);
  return linksCreated;
}

async function detectSupplierDonatedToPolitician(): Promise<number> {
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
      politician: {
        select: { id: true, cpf: true, name: true, party: true, position: true, state: true },
      },
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
      where: {
        politicianId: donation.politician.id,
        entityId: entity.id,
        linkType: "SUPPLIER_DONATED",
      },
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

    if (donationToContractRatio > 0.1) {
      severity = "CRITICAL";
      strength = 0.95;
    } else if (sameState && totalDonated > 10000) {
      severity = "HIGH";
      strength = 0.8;
    } else if (sameState || totalDonated > 50000) {
      severity = "HIGH";
      strength = 0.7;
    }

    await prisma.politicalLink.create({
      data: {
        politicianId: donation.politician.id,
        entityId: entity.id,
        contractId: contracts[0]?.id,
        linkType: "SUPPLIER_DONATED",
        description: `Empresa ${entity.name} (${entity.cnpj}) doou R$ ${totalDonated.toLocaleString("pt-BR")} para campanha de ${donation.politician.name} (${donation.politician.party}/${donation.politician.state}) e possui contratos governamentais no valor de R$ ${totalContractValue.toLocaleString("pt-BR")}`,
        strength,
        data: {
          politicianName: donation.politician.name,
          party: donation.politician.party,
          position: donation.politician.position,
          entityCnpj: entity.cnpj,
          entityName: entity.name,
          totalDonated,
          totalContractValue,
          donationToContractRatio,
          sameState,
          electionYear: donation.electionYear,
        } as unknown as Prisma.InputJsonValue,
      },
    });

    const existingAlert = await prisma.alert.findFirst({
      where: {
        type: "POLITICAL_LINK",
        entityId: entity.id,
        data: {
          path: ["linkType"],
          equals: "SUPPLIER_DONATED",
        },
      },
    });

    if (!existingAlert) {
      await prisma.alert.create({
        data: {
          type: "POLITICAL_LINK",
          severity,
          title: `Fornecedor do governo doou para campanha política`,
          description: `${entity.name} (${entity.cnpj}) doou R$ ${totalDonated.toLocaleString("pt-BR")} para ${donation.politician.name} (${donation.politician.party}) e tem R$ ${totalContractValue.toLocaleString("pt-BR")} em contratos governamentais`,
          entityId: entity.id,
          contractId: contracts[0]?.id,
          procurementId: contracts[0]?.procurementId,
          data: {
            linkType: "SUPPLIER_DONATED",
            politicianCpf: donation.politician.cpf,
            politicianName: donation.politician.name,
            party: donation.politician.party,
            entityCnpj: entity.cnpj,
            entityName: entity.name,
            totalDonated,
            totalContractValue,
            donationToContractRatio,
          } as unknown as Prisma.InputJsonValue,
        },
      });
    }

    linksCreated++;
  }

  console.log(`[analyze-political-links] SUPPLIER_DONATED: ${linksCreated} links`);
  return linksCreated;
}

async function detectDonorGotContract(): Promise<number> {
  const donations = await prisma.campaignDonation.findMany({
    where: { donorType: "PJ" },
    include: {
      politician: {
        select: { id: true, cpf: true, name: true, party: true, position: true, state: true, city: true },
      },
    },
  });

  if (donations.length === 0) return 0;

  const politicianDonors = new Map<string, { donorCnpjs: Set<string>; politician: typeof donations[0]["politician"] }>();

  for (const d of donations) {
    const existing = politicianDonors.get(d.politicianId);
    if (existing) {
      existing.donorCnpjs.add(d.donorCpfCnpj);
    } else {
      politicianDonors.set(d.politicianId, {
        donorCnpjs: new Set([d.donorCpfCnpj]),
        politician: d.politician,
      });
    }
  }

  let linksCreated = 0;

  for (const [politicianId, { donorCnpjs, politician }] of politicianDonors) {
    const contracts = await prisma.contract.findMany({
      where: {
        supplierCnpj: { in: [...donorCnpjs] },
        OR: [
          { unitState: politician.state },
          ...(politician.city ? [{ unitCity: politician.city }] : []),
        ],
      },
      select: {
        id: true,
        supplierCnpj: true,
        supplierName: true,
        value: true,
        orgName: true,
        unitState: true,
        unitCity: true,
        procurementId: true,
      },
      take: 20,
    });

    if (contracts.length === 0) continue;

    const supplierCnpjs = [...new Set(contracts.map((c) => c.supplierCnpj))];

    for (const cnpj of supplierCnpjs) {
      const existingLink = await prisma.politicalLink.findFirst({
        where: {
          politicianId,
          linkType: "DONOR_GOT_CONTRACT",
          data: {
            path: ["donorCnpj"],
            equals: cnpj,
          },
        },
      });
      if (existingLink) continue;

      const entity = await prisma.entity.findUnique({
        where: { cnpj },
        select: { id: true, name: true },
      });
      if (!entity) continue;

      const relevantContracts = contracts.filter((c) => c.supplierCnpj === cnpj);
      const totalContractValue = relevantContracts.reduce((sum, c) => sum + Number(c.value), 0);
      const donorDonations = donations.filter(
        (d) => d.donorCpfCnpj === cnpj && d.politicianId === politicianId,
      );
      const totalDonated = donorDonations.reduce((sum, d) => sum + Number(d.amount), 0);

      let severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" = "HIGH";
      let strength = 0.7;

      if (totalContractValue > 100000 && totalDonated > 10000) {
        severity = "CRITICAL";
        strength = 0.9;
      }

      await prisma.politicalLink.create({
        data: {
          politicianId,
          entityId: entity.id,
          contractId: relevantContracts[0]?.id,
          linkType: "DONOR_GOT_CONTRACT",
          description: `Doador de campanha de ${politician.name} (${politician.party}/${politician.state}) recebeu contratos governamentais na mesma jurisdição. ${entity.name} doou R$ ${totalDonated.toLocaleString("pt-BR")} e recebeu R$ ${totalContractValue.toLocaleString("pt-BR")} em contratos`,
          strength,
          data: {
            politicianName: politician.name,
            party: politician.party,
            position: politician.position,
            donorCnpj: cnpj,
            donorName: entity.name,
            totalDonated,
            totalContractValue,
            contractCount: relevantContracts.length,
            sameJurisdiction: true,
          } as unknown as Prisma.InputJsonValue,
        },
      });

      const existingAlert = await prisma.alert.findFirst({
        where: {
          type: "POLITICAL_LINK",
          entityId: entity.id,
          data: {
            path: ["linkType"],
            equals: "DONOR_GOT_CONTRACT",
          },
        },
      });

      if (!existingAlert) {
        await prisma.alert.create({
          data: {
            type: "POLITICAL_LINK",
            severity,
            title: `Doador de campanha recebeu contratos na jurisdição do político`,
            description: `${entity.name} doou R$ ${totalDonated.toLocaleString("pt-BR")} para ${politician.name} (${politician.party}/${politician.state}) e recebeu R$ ${totalContractValue.toLocaleString("pt-BR")} em contratos governamentais na mesma região`,
            entityId: entity.id,
            contractId: relevantContracts[0]?.id,
            procurementId: relevantContracts[0]?.procurementId,
            data: {
              linkType: "DONOR_GOT_CONTRACT",
              politicianCpf: politician.cpf,
              politicianName: politician.name,
              party: politician.party,
              donorCnpj: cnpj,
              donorName: entity.name,
              totalDonated,
              totalContractValue,
            } as unknown as Prisma.InputJsonValue,
          },
        });
      }

      linksCreated++;
    }
  }

  console.log(`[analyze-political-links] DONOR_GOT_CONTRACT: ${linksCreated} links`);
  return linksCreated;
}

async function detectFamilyInSupplier(): Promise<number> {
  const politicians = await prisma.politician.findMany({
    select: { id: true, cpf: true, name: true, party: true, position: true, state: true, city: true, birthState: true, birthCity: true },
  });

  if (politicians.length === 0) return 0;

  const shareholders = await prisma.shareholder.findMany({
    where: { cpfCnpj: { not: null } },
    include: {
      entity: {
        select: {
          id: true,
          cnpj: true,
          name: true,
          state: true,
          city: true,
          contracts: { select: { id: true }, take: 1 },
        },
      },
    },
  });

  let linksCreated = 0;

  for (const sh of shareholders) {
    if (!sh.name || sh.entity.contracts.length === 0) continue;

    for (const politician of politicians) {
      if (sh.cpfCnpj === politician.cpf) continue;

      const match = computeSurnameMatchScore(politician.name, sh.name);
      if (!match || match.score < 0.25) continue;

      const sameCity = politician.city && sh.entity.city &&
        normalizeName(politician.city) === normalizeName(sh.entity.city);
      const sameState = politician.state && sh.entity.state &&
        politician.state === sh.entity.state;

      let geoBase = 0.3;
      if (sameCity) {
        geoBase = 0.7;
      } else if (sameState) {
        geoBase = 0.5;
      }

      const strength = Math.min(0.95, geoBase * match.score);
      if (strength < 0.15) continue;

      let severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" = "LOW";
      if (strength >= 0.5) severity = "HIGH";
      else if (strength >= 0.3) severity = "MEDIUM";

      const existing = await prisma.politicalLink.findFirst({
        where: {
          politicianId: politician.id,
          entityId: sh.entity.id,
          shareholderId: sh.id,
          linkType: "FAMILY_IN_SUPPLIER",
        },
      });
      if (existing) continue;

      await prisma.politicalLink.create({
        data: {
          politicianId: politician.id,
          entityId: sh.entity.id,
          shareholderId: sh.id,
          linkType: "FAMILY_IN_SUPPLIER",
          description: `Sócio "${sh.name}" da empresa ${sh.entity.name} (${sh.entity.cnpj}) compartilha sobrenome com político ${politician.name} (${politician.party}/${politician.state})`,
          strength,
          data: {
            politicianName: politician.name,
            shareholderName: sh.name,
            sharedSurnames: match.matchedSurnames,
            rarestSurname: match.rarestSurname,
            surnameScore: match.score,
            isLastSurnameMatch: match.isLastSurnameMatch,
            entityCnpj: sh.entity.cnpj,
            entityName: sh.entity.name,
            sameState: !!sameState,
            sameCity: !!sameCity,
          } as unknown as Prisma.InputJsonValue,
        },
      });

      if (severity !== "LOW") {
        await prisma.alert.create({
          data: {
            type: "POLITICAL_LINK",
            severity,
            title: `Possível familiar de político é sócio de fornecedor`,
            description: `${sh.name} (sócio de ${sh.entity.name}) compartilha sobrenome "${match.matchedSurnames.join(", ")}" com ${politician.name} (${politician.party}/${politician.state})`,
            entityId: sh.entity.id,
            data: {
              linkType: "FAMILY_IN_SUPPLIER",
              politicianCpf: politician.cpf,
              politicianName: politician.name,
              shareholderName: sh.name,
              sharedSurnames: match.matchedSurnames,
              rarestSurname: match.rarestSurname,
              surnameScore: match.score,
              entityCnpj: sh.entity.cnpj,
            } as unknown as Prisma.InputJsonValue,
          },
        });
      }

      linksCreated++;
    }
  }

  console.log(`[analyze-political-links] FAMILY_IN_SUPPLIER: ${linksCreated} links`);
  return linksCreated;
}

async function detectFamilyDonated(): Promise<number> {
  const politicians = await prisma.politician.findMany({
    select: { id: true, cpf: true, name: true, party: true, position: true, state: true },
  });

  if (politicians.length === 0) return 0;

  const pfDonations = await prisma.campaignDonation.findMany({
    where: { donorType: "PF" },
    select: {
      id: true,
      donorName: true,
      donorCpfCnpj: true,
      amount: true,
      electionYear: true,
      politicianId: true,
    },
  });

  const donationsByPolitician = new Map<string, typeof pfDonations>();
  for (const d of pfDonations) {
    const list = donationsByPolitician.get(d.politicianId) ?? [];
    list.push(d);
    donationsByPolitician.set(d.politicianId, list);
  }

  let linksCreated = 0;

  for (const politician of politicians) {
    const donations = donationsByPolitician.get(politician.id) ?? [];

    for (const d of donations) {
      if (d.donorCpfCnpj === politician.cpf) continue;

      const match = computeSurnameMatchScore(politician.name, d.donorName);
      if (!match || match.score < 0.25) continue;

      const existing = await prisma.politicalLink.findFirst({
        where: {
          politicianId: politician.id,
          linkType: "FAMILY_DONATED",
          data: { path: ["donorCpfCnpj"], equals: d.donorCpfCnpj },
        },
      });
      if (existing) continue;

      const amount = Number(d.amount);

      let amountBase = 0.3;
      if (amount > 10000) {
        amountBase = 0.7;
      } else if (amount > 1000) {
        amountBase = 0.5;
      }

      const strength = Math.min(0.95, amountBase * match.score);
      if (strength < 0.15) continue;

      let severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" = "LOW";
      if (strength >= 0.5) severity = "HIGH";
      else if (strength >= 0.3) severity = "MEDIUM";

      await prisma.politicalLink.create({
        data: {
          politicianId: politician.id,
          linkType: "FAMILY_DONATED",
          description: `Doador PF "${d.donorName}" compartilha sobrenome com ${politician.name} (${politician.party}/${politician.state}) e doou R$ ${amount.toLocaleString("pt-BR")}`,
          strength,
          data: {
            politicianName: politician.name,
            donorName: d.donorName,
            donorCpfCnpj: d.donorCpfCnpj,
            sharedSurnames: match.matchedSurnames,
            rarestSurname: match.rarestSurname,
            surnameScore: match.score,
            isLastSurnameMatch: match.isLastSurnameMatch,
            amount,
            electionYear: d.electionYear,
          } as unknown as Prisma.InputJsonValue,
        },
      });

      if (severity !== "LOW") {
        await prisma.alert.create({
          data: {
            type: "POLITICAL_LINK",
            severity,
            title: `Possível familiar doou para campanha`,
            description: `${d.donorName} (CPF: ${d.donorCpfCnpj}) compartilha sobrenome "${match.matchedSurnames.join(", ")}" com ${politician.name} e doou R$ ${amount.toLocaleString("pt-BR")}`,
            data: {
              linkType: "FAMILY_DONATED",
              politicianCpf: politician.cpf,
              politicianName: politician.name,
              donorName: d.donorName,
              donorCpfCnpj: d.donorCpfCnpj,
              sharedSurnames: match.matchedSurnames,
              rarestSurname: match.rarestSurname,
              surnameScore: match.score,
              amount,
            } as unknown as Prisma.InputJsonValue,
          },
        });
      }

      linksCreated++;
    }
  }

  console.log(`[analyze-political-links] FAMILY_DONATED: ${linksCreated} links`);
  return linksCreated;
}

async function detectPoliticianIsServant(): Promise<number> {
  const servants = await prisma.publicServant.findMany({
    include: {
      politician: {
        select: { id: true, cpf: true, name: true, party: true, position: true, state: true },
      },
    },
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
    const existing = await prisma.politicalLink.findFirst({
      where: { politicianId, linkType: "POLITICIAN_IS_SERVANT" },
    });
    if (existing) continue;

    const politician = servantRecords[0]!.politician;
    const primary = servantRecords[0]!;

    await prisma.politicalLink.create({
      data: {
        politicianId,
        linkType: "POLITICIAN_IS_SERVANT",
        description: `${politician.name} (${politician.party}/${politician.state} - ${politician.position}) é/foi servidor público federal: ${primary.cargo ?? "cargo não informado"} no ${primary.orgao ?? "órgão não informado"}`,
        strength: 0.8,
        data: {
          politicianName: politician.name,
          party: politician.party,
          position: politician.position,
          cargo: primary.cargo,
          funcao: primary.funcao,
          orgao: primary.orgao,
          situacao: primary.situacao,
          remuneracao: primary.remuneracao ? Number(primary.remuneracao) : null,
          recordCount: servantRecords.length,
        } as unknown as Prisma.InputJsonValue,
      },
    });

    await prisma.alert.create({
      data: {
        type: "POLITICAL_LINK",
        severity: "MEDIUM",
        title: `Político é/foi servidor público federal`,
        description: `${politician.name} (${politician.party}/${politician.state} - ${politician.position}) possui vínculo como servidor: ${primary.cargo ?? "N/I"} no ${primary.orgao ?? "N/I"}`,
        data: {
          linkType: "POLITICIAN_IS_SERVANT",
          politicianCpf: politician.cpf,
          politicianName: politician.name,
          cargo: primary.cargo,
          orgao: primary.orgao,
          situacao: primary.situacao,
        } as unknown as Prisma.InputJsonValue,
      },
    });

    linksCreated++;
  }

  console.log(`[analyze-political-links] POLITICIAN_IS_SERVANT: ${linksCreated} links`);
  return linksCreated;
}

async function detectWealthAnomaly(): Promise<number> {
  const politicians = await prisma.politician.findMany({
    include: {
      assets: {
        select: { value: true, electionYear: true },
        orderBy: { electionYear: "asc" },
      },
    },
    where: {
      assets: { some: {} },
    },
  });

  let linksCreated = 0;

  for (const politician of politicians) {
    const existing = await prisma.politicalLink.findFirst({
      where: { politicianId: politician.id, linkType: "WEALTH_ANOMALY" },
    });
    if (existing) continue;

    const byYear = new Map<number, number>();
    for (const a of politician.assets) {
      const current = byYear.get(a.electionYear) ?? 0;
      byYear.set(a.electionYear, current + Number(a.value));
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

      if (growthPct > 300) {
        await prisma.politicalLink.create({
          data: {
            politicianId: politician.id,
            linkType: "WEALTH_ANOMALY",
            description: `Patrimônio declarado de ${politician.name} cresceu ${growthPct.toFixed(0)}% entre ${prevYear} e ${currYear} (R$ ${prevTotal.toLocaleString("pt-BR")} → R$ ${currTotal.toLocaleString("pt-BR")})`,
            strength: Math.min(0.95, growthPct / 1000 + 0.5),
            data: {
              politicianName: politician.name,
              party: politician.party,
              position: politician.position,
              previousYear: prevYear,
              currentYear: currYear,
              previousTotal: prevTotal,
              currentTotal: currTotal,
              growthPercentage: growthPct,
            } as unknown as Prisma.InputJsonValue,
          },
        });

        let severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" = "HIGH";
        if (growthPct > 1000) severity = "CRITICAL";

        await prisma.alert.create({
          data: {
            type: "POLITICAL_LINK",
            severity,
            title: `Crescimento patrimonial anômalo de político`,
            description: `${politician.name} (${politician.party}/${politician.state}) declarou patrimônio de R$ ${prevTotal.toLocaleString("pt-BR")} em ${prevYear} e R$ ${currTotal.toLocaleString("pt-BR")} em ${currYear} (crescimento de ${growthPct.toFixed(0)}%)`,
            data: {
              linkType: "WEALTH_ANOMALY",
              politicianCpf: politician.cpf,
              politicianName: politician.name,
              previousYear: prevYear,
              currentYear: currYear,
              previousTotal: prevTotal,
              currentTotal: currTotal,
              growthPercentage: growthPct,
            } as unknown as Prisma.InputJsonValue,
          },
        });

        linksCreated++;
        break;
      }
    }
  }

  console.log(`[analyze-political-links] WEALTH_ANOMALY: ${linksCreated} links`);
  return linksCreated;
}
