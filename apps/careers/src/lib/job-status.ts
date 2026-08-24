import type { JobStatus } from "../generated/prisma";

// Client-safe: no imports from src/server/**. job-status-select.tsx (a
// client component) needs STATUS_LABELS as a real runtime value, and
// pulling it from server/modules/jobs/queries.ts drags that whole module —
// including its unconditional `import { prisma } from "../../lib/prisma"`
// — into the client bundle, tripping env.ts's "server var accessed on
// client" guard on DATABASE_URL.
export const STATUS_LABELS: Record<JobStatus, string> = {
  RADAR: "0 - Radar",
  TRIAGEM: "1 - Triagem",
  SHORTLIST: "2 - Shortlist",
  APLICADA: "3 - Aplicada",
  ENTREVISTA: "4 - Entrevista",
  OFERTA: "5 - Oferta",
  CONTRATADA: "6 - Contratada",
  DESCARTADA: "X - Descartada",
};

export const FUNNEL_ORDER: JobStatus[] = [
  "RADAR",
  "TRIAGEM",
  "SHORTLIST",
  "APLICADA",
  "ENTREVISTA",
  "OFERTA",
  "CONTRATADA",
  "DESCARTADA",
];
