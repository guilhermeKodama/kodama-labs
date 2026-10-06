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

export function planViewUpdate(input: { saved: ViewConfig; draft: ViewDraft | null; isBuiltin: boolean; patch: Partial<ViewConfig> }): ViewUpdatePlan {
  const { saved, draft, isBuiltin, patch } = input;
  const next: ViewConfig = { ...applyViewDraft(saved, draft), ...patch };
  if (isBuiltin) {
    const kept: Partial<ViewConfig> = {};
    for (const key of BUILTIN_SAVED_KEYS) if (key in patch) Object.assign(kept, { [key]: patch[key] });
    const savedNext: ViewConfig = { ...saved, ...kept };
    return { save: Object.keys(kept).length ? savedNext : null, draft: orNull(diffViewConfig(savedNext, next)) };
  }
  if (isDirty(saved, draft)) return { save: null, draft: orNull(diffViewConfig(saved, next)) };
  return { save: next, draft: null };
}
