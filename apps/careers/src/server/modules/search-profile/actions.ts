"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "../../lib/prisma";
import { invalidateActiveProfileCache } from "./index";

function splitLines(raw: FormDataEntryValue | null): string[] {
  return String(raw ?? "")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * SearchProfile is append-only (see prisma/schema.prisma) — saving always
 * creates version+1 and flips isActive, rather than mutating the row old
 * JobScores point back to. That's what keeps a July score explainable
 * after the profile changes in September.
 */
export async function saveSearchProfile(formData: FormData): Promise<void> {
  const current = await prisma.searchProfile.findFirstOrThrow({ where: { isActive: true }, orderBy: { version: "desc" } });

  await prisma.searchProfile.updateMany({ data: { isActive: false } });

  await prisma.searchProfile.create({
    data: {
      version: current.version + 1,
      isActive: true,
      label: String(formData.get("label") ?? "") || null,

      requireRemote: formData.get("requireRemote") === "on",
      requirePaysUsd: formData.get("requirePaysUsd") === "on",
      requireHiresBrazil: formData.get("requireHiresBrazil") === "on",
      excludePeopleMgmt: formData.get("excludePeopleMgmt") === "on",
      salaryFloorUsdAnnual: Number(formData.get("salaryFloorUsdAnnual")) || current.salaryFloorUsdAnnual,
      contractForms: current.contractForms,

      track: current.track,
      builderOrOperator: current.builderOrOperator,
      targetTitles: splitLines(formData.get("targetTitles")),
      minSeniority: current.minSeniority,
      yearsExperience: current.yearsExperience,
      currentTitle: current.currentTitle,
      acceptedFormats: current.acceptedFormats,
      coreStack: splitLines(formData.get("coreStack")),
      domains: current.domains,

      wantsEquity: formData.get("wantsEquity") === "on",
      equityWeight: current.equityWeight,
      salaryTargetUsdAnnual: Number(formData.get("salaryTargetUsdAnnual")) || current.salaryTargetUsdAnnual,
      referenceCompanies: current.referenceCompanies,
      preferredSectors: current.preferredSectors,
      prioritizeYc: current.prioritizeYc,
      bonusCoreInfra: current.bonusCoreInfra,
      desiredStack: splitLines(formData.get("desiredStack")),
      timezoneBase: current.timezoneBase,
      minOverlapHours: current.minOverlapHours,
      companySizes: current.companySizes,
      avoidStack: splitLines(formData.get("avoidStack")),

      wantToDo: splitLines(formData.get("wantToDo")),
      doNotWant: splitLines(formData.get("doNotWant")),
      desiredCulture: current.desiredCulture,

      excludedCompanies: splitLines(formData.get("excludedCompanies")),
      excludedTitleSubstrs: current.excludedTitleSubstrs,

      maxJobsPerDay: Number(formData.get("maxJobsPerDay")) || current.maxJobsPerDay,
      maxJobsPerCompanyPerRun: current.maxJobsPerCompanyPerRun,
      initialStatus: current.initialStatus,
      dedupBy: current.dedupBy,
      extras: current.extras ?? undefined,
    },
  });

  invalidateActiveProfileCache();
  revalidatePath("/perfil");
}

export async function resolveRuleProposal(proposalId: string, accept: boolean): Promise<void> {
  const proposal = await prisma.profileRuleProposal.findUniqueOrThrow({ where: { id: proposalId } });
  await prisma.profileRuleProposal.update({
    where: { id: proposalId },
    data: { status: accept ? "ACCEPTED" : "REJECTED", resolvedAt: new Date() },
  });

  if (accept) {
    const current = await prisma.searchProfile.findFirstOrThrow({ where: { isActive: true }, orderBy: { version: "desc" } });
    const field = proposal.targetField as "doNotWant" | "wantToDo" | "avoidStack" | "excludedCompanies";
    const currentList = current[field] as string[];
    await prisma.searchProfile.updateMany({ data: { isActive: false } });
    await prisma.searchProfile.create({
      data: {
        version: current.version + 1,
        isActive: true,
        label: current.label,
        requireRemote: current.requireRemote,
        requirePaysUsd: current.requirePaysUsd,
        requireHiresBrazil: current.requireHiresBrazil,
        contractForms: current.contractForms,
        excludePeopleMgmt: current.excludePeopleMgmt,
        salaryFloorUsdAnnual: current.salaryFloorUsdAnnual,
        track: current.track,
        builderOrOperator: current.builderOrOperator,
        targetTitles: current.targetTitles,
        minSeniority: current.minSeniority,
        yearsExperience: current.yearsExperience,
        currentTitle: current.currentTitle,
        acceptedFormats: current.acceptedFormats,
        coreStack: current.coreStack,
        domains: current.domains,
        wantsEquity: current.wantsEquity,
        equityWeight: current.equityWeight,
        salaryTargetUsdAnnual: current.salaryTargetUsdAnnual,
        referenceCompanies: current.referenceCompanies,
        preferredSectors: current.preferredSectors,
        prioritizeYc: current.prioritizeYc,
        bonusCoreInfra: current.bonusCoreInfra,
        desiredStack: current.desiredStack,
        timezoneBase: current.timezoneBase,
        minOverlapHours: current.minOverlapHours,
        companySizes: current.companySizes,
        avoidStack: current.avoidStack,
        wantToDo: current.wantToDo,
        doNotWant: current.doNotWant,
        desiredCulture: current.desiredCulture,
        excludedCompanies: current.excludedCompanies,
        excludedTitleSubstrs: current.excludedTitleSubstrs,
        maxJobsPerDay: current.maxJobsPerDay,
        maxJobsPerCompanyPerRun: current.maxJobsPerCompanyPerRun,
        initialStatus: current.initialStatus,
        dedupBy: current.dedupBy,
        extras: current.extras ?? undefined,
        [field]: [...currentList, proposal.proposedRule],
      },
    });
    invalidateActiveProfileCache();
  }

  revalidatePath("/perfil");
}
