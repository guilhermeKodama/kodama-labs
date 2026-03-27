import { prisma } from "@sentinel/server/lib/prisma";
import { runJob } from "@sentinel/server/lib/job-runner";

const BATCH_SIZE = 50;

function extractSurname(fullName: string): string {
  const parts = fullName.trim().toUpperCase().split(/\s+/);
  return parts[parts.length - 1] ?? "";
}

function normalizeForComparison(name: string): string {
  return name
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function nameSharesSurname(politicianName: string, otherName: string): boolean {
  const surname = extractSurname(normalizeForComparison(politicianName));
  if (surname.length < 3) return false;
  const normalizedOther = normalizeForComparison(otherName);
  return normalizedOther.split(/\s+/).some((part) => part === surname);
}

export async function processRelatives() {
  return runJob("process-relatives", "processing", async () => {
    let recordsIn = 0;
    let recordsOut = 0;

    const politicians = await prisma.politician.findMany({
      where: { familyFetchedAt: null },
      select: { id: true, cpf: true, name: true },
      take: BATCH_SIZE,
    });

    recordsIn = politicians.length;

    for (const pol of politicians) {
      try {
        let found = 0;

        found += await linkShareholderRelatives(pol);
        found += await linkDonorRelatives(pol);

        await prisma.politician.update({
          where: { id: pol.id },
          data: { familyFetchedAt: new Date() },
        });

        recordsOut += found;
      } catch (err) {
        console.error(
          `[process-relatives] Error for politician ${pol.cpf}:`,
          err instanceof Error ? err.message : err
        );
      }
    }

    return { recordsIn, recordsOut };
  });
}

async function linkShareholderRelatives(pol: {
  id: string;
  cpf: string;
  name: string;
}): Promise<number> {
  const shareholders = await prisma.shareholder.findMany({
    where: {
      cpfCnpj: { not: null },
      entity: {
        contracts: { some: {} },
      },
    },
    select: { name: true, cpfCnpj: true, entity: { select: { cnpj: true } } },
  });

  let count = 0;

  for (const sh of shareholders) {
    if (!sh.cpfCnpj || sh.cpfCnpj === pol.cpf) continue;
    if (!nameSharesSurname(pol.name, sh.name)) continue;

    try {
      await prisma.politicianRelative.upsert({
        where: {
          politicianId_relativeCpf: {
            politicianId: pol.id,
            relativeCpf: sh.cpfCnpj,
          },
        },
        create: {
          politicianId: pol.id,
          relativeCpf: sh.cpfCnpj,
          relativeName: sh.name,
          relationship: "shareholder_surname_match",
          confidence: 0.6,
        },
        update: {
          relativeName: sh.name,
        },
      });
      count++;
    } catch {
      // unique constraint race condition, skip
    }
  }

  return count;
}

async function linkDonorRelatives(pol: {
  id: string;
  cpf: string;
  name: string;
}): Promise<number> {
  const donations = await prisma.campaignDonation.findMany({
    where: {
      politicianId: pol.id,
      donorCpfCnpj: { not: "" },
    },
    select: { donorName: true, donorCpfCnpj: true },
  });

  let count = 0;

  for (const donation of donations) {
    if (!donation.donorCpfCnpj || donation.donorCpfCnpj === pol.cpf) continue;
    if (donation.donorCpfCnpj.length > 11) continue;
    if (!nameSharesSurname(pol.name, donation.donorName)) continue;

    try {
      await prisma.politicianRelative.upsert({
        where: {
          politicianId_relativeCpf: {
            politicianId: pol.id,
            relativeCpf: donation.donorCpfCnpj,
          },
        },
        create: {
          politicianId: pol.id,
          relativeCpf: donation.donorCpfCnpj,
          relativeName: donation.donorName,
          relationship: "donor_surname_match",
          confidence: 0.5,
        },
        update: {
          relativeName: donation.donorName,
        },
      });
      count++;
    } catch {
      // unique constraint race condition, skip
    }
  }

  return count;
}
