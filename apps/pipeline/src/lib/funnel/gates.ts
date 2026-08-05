import { FORMULAS } from "./health";
import type { MetricKeyT, RawCounts } from "./types";

// Gate items as normalized by the sync service (money already in cents).
export interface ComputableGate {
  metric: "cac" | "cpl" | "ctr" | "bounce" | "session_to_lead" | "ar" | "pcr";
  op: "lt" | "lte" | "gt" | "gte";
  value: number;
  unit: "cents" | "ratio";
  label?: string | null;
}

export interface ManualGate {
  label: string;
  manual: true;
  checkedAt: string | null;
}

export type GateItem = ComputableGate | ManualGate;

export interface Gates {
  go: GateItem[];
  pivot: GateItem[];
  kill: GateItem[];
}

export function isManualGate(item: GateItem): item is ManualGate {
  return "manual" in item && item.manual === true;
}

const GATE_METRIC: Record<ComputableGate["metric"], MetricKeyT> = {
  cac: "CAC",
  cpl: "CPL",
  ctr: "CTR",
  bounce: "BOUNCE_RATE",
  session_to_lead: "SESSION_TO_LEAD",
  ar: "AR",
  pcr: "PCR",
};

export type GateResult = "pass" | "fail" | "unknown";

export function evaluateGate(gate: ComputableGate, counts: RawCounts): GateResult {
  const value = FORMULAS[GATE_METRIC[gate.metric]](counts);
  if (value == null) return "unknown";
  switch (gate.op) {
    case "lt":
      return value < gate.value ? "pass" : "fail";
    case "lte":
      return value <= gate.value ? "pass" : "fail";
    case "gt":
      return value > gate.value ? "pass" : "fail";
    case "gte":
      return value >= gate.value ? "pass" : "fail";
  }
}

export function parseGates(raw: unknown): Gates | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  const section = (key: string): GateItem[] =>
    Array.isArray(obj[key]) ? (obj[key] as GateItem[]) : [];
  return { go: section("go"), pivot: section("pivot"), kill: section("kill") };
}
