import { prisma } from "../../lib/prisma";
import type { SearchProfile } from "../../../generated/prisma";

let cached: { profile: SearchProfile; fetchedAt: number } | null = null;
const CACHE_MS = 30_000; // short TTL: a profile edit should take effect within one worker tick

/**
 * The active SearchProfile, cached briefly in-process. Every ingestion and
 * scoring call reads through this — never query SearchProfile.isActive
 * directly elsewhere, or a profile edit mid-run could be read inconsistently
 * across two calls in the same task.
 */
export async function getActiveProfile(): Promise<SearchProfile> {
  if (cached && Date.now() - cached.fetchedAt < CACHE_MS) return cached.profile;

  const profile = await prisma.searchProfile.findFirst({ where: { isActive: true }, orderBy: { version: "desc" } });
  if (!profile) {
    throw new Error(
      "Nenhum SearchProfile ativo. Rode o import do vault (pnpm import:vault) ou crie um em /perfil antes de ingerir vagas."
    );
  }
  cached = { profile, fetchedAt: Date.now() };
  return profile;
}

export function invalidateActiveProfileCache(): void {
  cached = null;
}
