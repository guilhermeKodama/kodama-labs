import { prisma } from "../lib/prisma";
import { slugify } from "./text-normalize";
import type { Company } from "../../generated/prisma";

/**
 * Resolves a raw company-name string to a Company row: slug match, then
 * alias match, then create. The same company appears under different
 * spellings across sources ("Customer.io" vs "Customer IO", "TigerData" vs
 * "Timescale") — CompanyAlias is where those get reconciled once a human
 * notices, without ever merging two Company rows automatically.
 */
export async function resolveCompany(rawName: string): Promise<Company> {
  const name = rawName.trim() || "Empresa desconhecida";
  const slug = slugify(name);

  const bySlug = await prisma.company.findUnique({ where: { slug } });
  if (bySlug) return bySlug;

  const byAlias = await prisma.companyAlias.findUnique({
    where: { alias: slug },
    include: { company: true },
  });
  if (byAlias) return byAlias.company;

  return prisma.company.create({
    data: { name, slug },
  });
}
