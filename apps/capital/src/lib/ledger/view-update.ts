import type { ViewConfig } from "@capital/server/modules/ledger/contracts";
import { applyViewDraft, diffViewConfig, isDirty, type ViewDraft } from "./view-draft";

/**
 * Where a change to the view on screen goes (mockup update() 2087–2103,
 * decisions viewSave=auto, todasPrefs=keep, periodNav=dirty):
 *
 * - "Todas" (built-in): display preferences (layout, period, grouping,
 *   sort, columns, calcs, chart) are saved; filters stay in the draft
 *   (temporary, the yellow dot, "Limpar / Salvar como nova").
 * - Any view with a draft on screen (a drill, or temporary filters):
 *   the change stays in the draft until "Limpar" or "Salvar como nova".
 * - Otherwise the whole config is saved at once ("salvo automaticamente").
 */

/** Keys "Todas" keeps (BUILTIN_PERSISTED_CONFIG_KEYS on the server). */
export const BUILTIN_SAVED_KEYS = ["layout", "period", "dateField", "groupBy", "sort", "columns", "calcs", "chart", "transferDisplay"] as const;

export interface ViewUpdatePlan {
  /** The config to save (PATCH), or null when nothing is saved. */
  save: ViewConfig | null;
  /** The draft to keep in the URL, or null to drop it. */
  draft: ViewDraft | null;
}

const orNull = (draft: ViewDraft): ViewDraft | null => (Object.keys(draft).length ? draft : null);

/**
 * A change made inside a drill keeps its banner: the next draft still
 * says what was opened ("Detalhe: …") and "voltar à view" still returns
 * to the draft before the drill. The banner goes once nothing is left
 * in the draft (the change brought the view back to its saved config).
 */
function keepBanner(next: ViewDraft | null, previous: ViewDraft | null): ViewDraft | null {
  if (!next || !previous?.label) return next;
  return { ...next, label: previous.label, ...(previous.back ? { back: previous.back } : {}) };
}

export function planViewUpdate(input: { saved: ViewConfig; draft: ViewDraft | null; isBuiltin: boolean; patch: Partial<ViewConfig> }): ViewUpdatePlan {
  const { saved, draft, isBuiltin, patch } = input;
  const next: ViewConfig = { ...applyViewDraft(saved, draft), ...patch };
  if (isBuiltin) {
    const kept: Partial<ViewConfig> = {};
    for (const key of BUILTIN_SAVED_KEYS) if (key in patch) Object.assign(kept, { [key]: patch[key] });
    const savedNext: ViewConfig = { ...saved, ...kept };
    return { save: Object.keys(kept).length ? savedNext : null, draft: keepBanner(orNull(diffViewConfig(savedNext, next)), draft) };
  }
  if (isDirty(saved, draft)) return { save: null, draft: keepBanner(orNull(diffViewConfig(saved, next)), draft) };
  return { save: next, draft: null };
}
