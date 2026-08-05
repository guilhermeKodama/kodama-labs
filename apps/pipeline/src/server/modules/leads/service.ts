import { prisma } from "@pipeline/server/lib/prisma";
import {
  canTransition,
  FIRST_REACH_COLUMN,
  type LeadStatusValue,
} from "@/lib/funnel/lead-status";
import type { Lead, LeadStatus } from "@/generated/prisma";

export interface TransitionOptions {
  note?: string;
  actor?: string;
  force?: boolean;
}

export class InvalidTransitionError extends Error {
  constructor(from: LeadStatus, to: LeadStatus) {
    super(`invalid transition ${from} → ${to}`);
    this.name = "InvalidTransitionError";
  }
}

// Single write path for lead status: validates against LEAD_TRANSITIONS (or
// records forced: true), sets the first-reach timestamp ONCE, and appends the
// audit event — all in one transaction. AR/PCR derive from the timestamps.
export async function transitionLead(
  leadId: string,
  toStatus: LeadStatus,
  { note, actor = "ui", force = false }: TransitionOptions = {},
): Promise<Lead> {
  return prisma.$transaction(async (tx) => {
    const lead = await tx.lead.findUniqueOrThrow({ where: { id: leadId } });

    if (lead.status === toStatus && !note) return lead;

    const allowed = canTransition(
      lead.status as LeadStatusValue,
      toStatus as LeadStatusValue,
    );
    if (!allowed && !force && lead.status !== toStatus) {
      throw new InvalidTransitionError(lead.status, toStatus);
    }

    const firstReach = FIRST_REACH_COLUMN[toStatus as LeadStatusValue];
    const reachUpdate =
      firstReach && lead[firstReach as keyof Lead] == null
        ? { [firstReach]: new Date() }
        : {};

    const updated = await tx.lead.update({
      where: { id: leadId },
      data: { status: toStatus, ...reachUpdate },
    });

    await tx.leadStatusEvent.create({
      data: {
        leadId,
        fromStatus: lead.status,
        toStatus,
        note,
        actor,
        forced: !allowed && lead.status !== toStatus,
      },
    });

    return updated;
  });
}
