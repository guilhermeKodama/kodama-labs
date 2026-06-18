import { z } from "zod";

export const IDEA_CONFIG_SCHEMA_VERSION = 1;

// Ratios are FRACTIONS (0.015 = 1.5%). Values > 1 are almost always a "1.5"
// typo for 1.5%, so the schema rejects them outright.
const ratio = z
  .number()
  .nonnegative()
  .max(1, "ratios are fractions: write 0.015 for 1.5%");

const ratioPair = z.object({
  healthy: ratio,
  death: ratio,
});

const decisionEnum = z.enum(["double_down", "scale", "optimize", "hold_fix", "kill"]);

const decisionBand = z.object({
  cac_max: z.number().positive().optional(), // absent on the last (kill) band
  ar_min: ratio.nullable().optional(),
  decision: decisionEnum,
});

const gateOp = z.enum(["lt", "lte", "gt", "gte"]);

const computableGate = z.object({
  metric: z.enum([
    "cac",
    "cpl",
    "ctr",
    "bounce",
    "session_to_lead",
    "ar",
    "pcr",
  ]),
  op: gateOp,
  value: z.number(),
  label: z.string().optional(),
});

const manualGate = z.object({
  label: z.string().min(1),
  manual: z.literal(true),
  checkedAt: z.string().datetime().nullable().optional(),
});

const gateItem = z.union([computableGate, manualGate]);

export const ideaConfigSchema = z
  .object({
    schema_version: z.literal(IDEA_CONFIG_SCHEMA_VERSION),
    name: z.string().min(1),
    status: z.enum(["hypothesis", "validating", "validated", "killed", "paused"]),
    landing_url: z.string().url().nullable().default(null),
    timezone: z.string().default("America/Sao_Paulo"),

    budget: z
      .object({
        total: z.number().positive(), // BRL
        weeks: z.number().int().positive(),
      })
      .nullable()
      .default(null),

    economics: z
      .object({
        price_monthly: z.number().positive().nullable().default(null), // BRL
        projected_ltv: z.number().positive(), // BRL
        max_cac: z.number().positive().nullable().default(null), // BRL; null → LTV/4
        cac_ceiling_per_lead: z.number().positive().nullable().default(null),
        channel_kill_cac: z.number().positive().nullable().default(null),
      })
      .nullable()
      .default(null),

    decision_matrix: z.array(decisionBand).min(1).nullable().default(null),

    funnel_targets: z
      .object({
        ctr: ratioPair.optional(),
        ctr_google: ratioPair.optional(), // per-channel override → (CTR, GOOGLE) row
        bounce: ratioPair.optional(),
        session_to_lead: ratioPair.optional(),
        ar: ratioPair.optional(),
        pcr: ratioPair.optional(),
      })
      .nullable()
      .default(null),

    gates: z
      .object({
        go: z.array(gateItem).default([]),
        pivot: z.array(gateItem).default([]),
        kill: z.array(gateItem).default([]),
      })
      .nullable()
      .default(null),

    ads: z
      .object({
        meta_ad_account_id: z
          .string()
          .regex(/^act_\d+$/, 'meta ad account ids look like "act_123..."')
          .nullable()
          .default(null),
        google_customer_id: z
          .string()
          .regex(/^\d{10}$/, "google customer id: 10 digits, no dashes")
          .nullable()
          .default(null),
        google_campaign_prefix: z.string().min(1).nullable().default(null), // null → slug
      })
      .nullable()
      .default(null),

    tracking: z
      .object({
        ga4_property_id: z
          .string()
          .regex(/^\d+$/, "numeric GA4 property id (not the G-XXXX measurement id)")
          .nullable()
          .default(null),
      })
      .nullable()
      .default(null),

    ads_launched_at: z.coerce.date().nullable().default(null),
    go_no_go_at: z.coerce.date().nullable().default(null),
  })
  .superRefine((cfg, ctx) => {
    // Promotion gate: an idea cannot be marked live without the wiring that
    // makes its metrics computable.
    if (cfg.status === "validating" || cfg.status === "validated") {
      const required: Array<[unknown, string]> = [
        [cfg.landing_url, "landing_url"],
        [cfg.economics, "economics"],
        [cfg.tracking?.ga4_property_id, "tracking.ga4_property_id"],
      ];
      for (const [value, path] of required) {
        if (value == null) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: path.split("."),
            message: `required when status is "${cfg.status}"`,
          });
        }
      }
      const hasAdsAccount =
        cfg.ads?.meta_ad_account_id != null || cfg.ads?.google_customer_id != null;
      if (!hasAdsAccount) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["ads"],
          message: `at least one ads account (meta_ad_account_id or google_customer_id) is required when status is "${cfg.status}"`,
        });
      }
    }
  });

export type IdeaConfig = z.infer<typeof ideaConfigSchema>;

export const syncPayloadSchema = z.object({
  source: z.object({
    repo: z.string(),
    commitSha: z.string().nullable(),
    ref: z.string().nullable(),
  }),
  ideas: z
    .array(
      z.object({
        slug: z.string().regex(/^[a-z][a-z0-9-]*$/),
        config: ideaConfigSchema,
      }),
    )
    .max(200),
  // dirs without idea.yaml — listed so the server knows the snapshot is
  // complete and absence means deletion, not "not scanned"
  skipped: z.array(z.string()).default([]),
});

export type SyncPayload = z.infer<typeof syncPayloadSchema>;
