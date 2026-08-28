import { z } from "zod";
import { defineTool } from "../registry";
import { fetchContextSnapshot } from "../../../data/queries/fetch-context-snapshot";

export const getContextSnapshot = defineTool({
  name: "get_context_snapshot",
  description:
    "Orient yourself before doing anything else: the user's businesses, personal account, categories, credit cards, investment accounts, currencies, last 5 statement imports, and up to 200 learned merchant->category mappings (most recently used first). Call this once near the start of a turn that will reconcile or import a statement - the mappings are what let you auto-categorize without asking, so always check them before writing 'Uncategorized'.",
  inputSchema: z.object({}),
  access: "read",
  handler: async (ctx) => {
    const snapshot = await fetchContextSnapshot(ctx.userId, ctx.db);
    return { ...snapshot };
  },
});
