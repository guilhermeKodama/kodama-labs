import type { SourceAdapter } from "./types";
import { ashbyAdapter } from "./ats-ashby";
import { greenhouseAdapter } from "./ats-greenhouse";
import { leverAdapter } from "./ats-lever";
import { smartRecruitersAdapter } from "./ats-smartrecruiters";
import { remoteOkAdapter } from "./remoteok";
import { remotiveAdapter } from "./remotive";
import { arbeitnowAdapter } from "./arbeitnow";
import { himalayasAdapter } from "./himalayas";
import { jobicyAdapter } from "./jobicy";
import { wwrAdapter } from "./wwr";
import { hnAdapter } from "./hn";
import { linkedinGuestAdapter } from "./linkedin-guest";

// Single place mapping a Source.key to its adapter. ATS adapters are keyed
// by provider (one adapter serves every CompanyBoard using that provider);
// aggregator/forum/scrape adapters are keyed 1:1 with their Source row.
export const ADAPTERS: Record<string, SourceAdapter> = {
  "ats:ashby": ashbyAdapter,
  "ats:greenhouse": greenhouseAdapter,
  "ats:lever": leverAdapter,
  "ats:smartrecruiters": smartRecruitersAdapter,
  remoteok: remoteOkAdapter,
  remotive: remotiveAdapter,
  arbeitnow: arbeitnowAdapter,
  himalayas: himalayasAdapter,
  jobicy: jobicyAdapter,
  weworkremotely: wwrAdapter,
  hn: hnAdapter,
  linkedin_guest: linkedinGuestAdapter,
};

export const ALL_ADAPTERS = Object.values(ADAPTERS);

export function getAdapter(key: string): SourceAdapter | undefined {
  return ADAPTERS[key];
}
