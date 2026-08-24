import { prisma } from "../lib/prisma";
import { enqueue } from "../jobs/queue";
import { resolveCompany } from "./resolve-company";
import { normalizeTitle, regionOk, normalizeRegions } from "./text-normalize";
import { spTodayStart } from "../lib/timezone";
import { getActiveProfile } from "../modules/search-profile";
import type { PostingDecision } from "../../generated/prisma";

async function countJobsCreatedToday(): Promise<number> {
  return prisma.job.count({ where: { createdAt: { gte: spTodayStart() } } });
}

// profile.avoidStack is free-text edited by hand (e.g. "C / C++") and can
// contain regex metacharacters — interpolating it unescaped crashes the
// normalize task ("Nothing to repeat") the first time a real entry like
// that is hit, taking the whole raw posting's processing down with it.
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function declaredSalaryBelowFloor(salaryMax: number | null, floor: number): boolean {
  // Only discards when a number was actually DECLARED and it's below the
  // floor — a posting with no salary at all is never discarded on this
  // rule (most postings — 124 of 155 in the original vault — don't
  // disclose a number, and that must not read as "$0").
  if (salaryMax === null) return false;
  return salaryMax < floor;
}

/**
 * The normalize algorithm, run once per RawPosting whose decision is
 * PENDING. Cheapest checks first (no LLM anywhere in this function):
 *   1. hard filters — excluded title/company, avoid-stack in title,
 *      region, declared-salary-below-floor
 *   2. resolve Company
 *   3. dedup by (companyId, normalizedTitle)
 *   4. daily cap — defers (not discards) once hit
 *   5. create Job, enqueue score
 */
export async function normalizeRawPosting(rawPostingId: string): Promise<PostingDecision> {
  const raw = await prisma.rawPosting.findUnique({ where: { id: rawPostingId } });
  if (!raw) return "FILTERED_OUT";

  const profile = await getActiveProfile();

  // title/companyName are nullable on RawPosting (an adapter can, in
  // principle, fail to supply either) — normalized to empty strings once
  // here so every filter below reads a plain `string`, not `string | null`.
  const title = raw.title ?? "";
  const companyName = raw.companyName ?? "";

  // --- 1. hard filters ---
  const titleLower = title.toLowerCase();

  for (const substr of profile.excludedTitleSubstrs) {
    if (titleLower.includes(substr.toLowerCase())) {
      await prisma.rawPosting.update({
        where: { id: raw.id },
        data: { decision: "FILTERED_OUT", filterReason: `título contém "${substr}"`, processedAt: new Date() },
      });
      return "FILTERED_OUT";
    }
  }

  for (const excluded of profile.excludedCompanies) {
    if (companyName.toLowerCase().includes(excluded.toLowerCase())) {
      await prisma.rawPosting.update({
        where: { id: raw.id },
        data: { decision: "FILTERED_OUT", filterReason: `empresa excluída: ${excluded}`, processedAt: new Date() },
      });
      return "FILTERED_OUT";
    }
  }

  for (const avoided of profile.avoidStack) {
    if (new RegExp(`\\b${escapeRegExp(avoided)}\\b`, "i").test(title)) {
      await prisma.rawPosting.update({
        where: { id: raw.id },
        data: { decision: "FILTERED_OUT", filterReason: `stack a evitar no título: ${avoided}`, processedAt: new Date() },
      });
      return "FILTERED_OUT";
    }
  }

  if (profile.requireRemote && !regionOk(raw.locationRaw ?? "")) {
    await prisma.rawPosting.update({
      where: { id: raw.id },
      data: { decision: "FILTERED_OUT", filterReason: `região fora do alcance: ${raw.locationRaw}`, processedAt: new Date() },
    });
    return "FILTERED_OUT";
  }

  const salaryMax = extractSalaryMax(raw.compensationRaw);
  if (declaredSalaryBelowFloor(salaryMax, profile.salaryFloorUsdAnnual)) {
    await prisma.rawPosting.update({
      where: { id: raw.id },
      data: {
        decision: "FILTERED_OUT",
        filterReason: `salário declarado (${salaryMax}) abaixo do piso (${profile.salaryFloorUsdAnnual})`,
        processedAt: new Date(),
      },
    });
    return "FILTERED_OUT";
  }

  // LinkedIn (and any future card-only source) never auto-promotes — it
  // needs a human to confirm the role has real substance before it costs
  // any LLM budget or occupies a triage slot.
  if (raw.needsEnrichment) {
    await prisma.rawPosting.update({
      where: { id: raw.id },
      data: { decision: "NEEDS_REVIEW", processedAt: new Date() },
    });
    return "NEEDS_REVIEW";
  }

  // --- 2. resolve company ---
  const company = await resolveCompany(companyName);
  if (company.isExcluded) {
    await prisma.rawPosting.update({
      where: { id: raw.id },
      data: { decision: "FILTERED_OUT", filterReason: `empresa excluída: ${company.name}`, processedAt: new Date() },
    });
    return "FILTERED_OUT";
  }

  // --- 3. dedup ---
  const dedupTitle = normalizeTitle(title);
  const existingJob = await prisma.job.findUnique({
    where: { companyId_dedupTitle: { companyId: company.id, dedupTitle } },
  });

  if (existingJob) {
    await prisma.jobSighting.upsert({
      where: { sourceKey_externalId: { sourceKey: raw.sourceKey, externalId: raw.externalId } },
      create: {
        jobId: existingJob.id,
        sourceKey: raw.sourceKey,
        rawPostingId: raw.id,
        externalId: raw.externalId,
        url: raw.url,
      },
      update: { lastSeenAt: new Date() },
    });
    await prisma.rawPosting.update({
      where: { id: raw.id },
      data: { decision: "DUPLICATE", jobId: existingJob.id, processedAt: new Date() },
    });
    return "DUPLICATE";
  }

  // --- 4. daily cap ---
  const createdToday = await countJobsCreatedToday();
  if (createdToday >= profile.maxJobsPerDay) {
    // Deferred, not discarded — stays PENDING so tomorrow's run picks it
    // back up. The original pipeline's queue[:CAP] silently dropped
    // whatever didn't fit; this doesn't.
    return "PENDING";
  }

  // --- 5. promote ---
  const regions = normalizeRegions(raw.locationRaw ?? "");
  const job = await prisma.job.create({
    data: {
      companyId: company.id,
      title,
      dedupTitle,
      workModel: profile.requireRemote ? "REMOTO" : "DESCONHECIDO",
      locationRaw: raw.locationRaw,
      regions,
      salaryRaw: raw.compensationRaw,
      salaryMax,
      canonicalUrl: raw.url,
      status: profile.initialStatus,
      discoveredAt: new Date(),
    },
  });

  await prisma.jobSighting.create({
    data: {
      jobId: job.id,
      sourceKey: raw.sourceKey,
      rawPostingId: raw.id,
      externalId: raw.externalId,
      url: raw.url,
    },
  });

  await prisma.jobStatusChange.create({
    data: { jobId: job.id, toStatus: profile.initialStatus, actor: "agent" },
  });

  await prisma.rawPosting.update({
    where: { id: raw.id },
    data: { decision: "PROMOTED", jobId: job.id, processedAt: new Date() },
  });

  await enqueue(
    "score",
    { jobId: job.id },
    // rubricHash is filled in once scoring computes it; a coarse uniqueKey
    // here is fine since scoring itself is idempotent on the real hash.
    { uniqueKey: `score:${job.id}:initial` }
  );

  return "PROMOTED";
}

/** Best-effort numeric ceiling out of a free-text compensation blurb. */
function extractSalaryMax(raw: string | null): number | null {
  if (!raw) return null;
  const numbers = [...raw.matchAll(/\$?\s?(\d{2,3})[,.]?(\d{3})?\s?k/gi)]
    .map((m) => {
      const whole = m[1] ?? "";
      const thousands = m[2];
      return thousands ? Number(`${whole}${thousands}`) : Number(whole) * 1000;
    })
    .filter((n) => Number.isFinite(n) && n > 10_000);
  if (numbers.length === 0) return null;
  return Math.max(...numbers);
}
