import type { GroupKey, LedgerGroup } from "@capital/server/modules/ledger/contracts";

/**
 * The table's drawn lines (mockup renderGroups 2668–2680): with grouping,
 * a header per group (two levels at most) before its rows. Rows come from
 * the server already in group order, each with its groupKeys; the
 * headers take count and Σ from the server's groups, so they are complete
 * while rows are still paging in. A collapsed group hides its rows (and
 * its subgroups).
 */

export interface GroupItem {
  type: "group";
  /** "g/<key0>" or "g/<key0>/<key1>". */
  id: string;
  level: 0 | 1;
  groupKey: GroupKey;
  value: string | null;
  group: LedgerGroup | null;
  collapsed: boolean;
}

export interface RowItem<R> {
  type: "row";
  id: string;
  row: R;
}

export type TableItem<R> = GroupItem | RowItem<R>;

const keyPart = (value: string | null) => (value === null ? "∅" : value);

export function groupItemId(values: readonly (string | null)[]): string {
  return `g/${values.map(keyPart).join("/")}`;
}

export function tableItems<R extends { id: string; groupKeys?: (string | null)[] }>(
  rows: readonly R[],
  groups: readonly LedgerGroup[],
  groupBy: readonly GroupKey[],
  collapsed: ReadonlySet<string>,
): TableItem<R>[] {
  if (!groupBy.length) return rows.map((row) => ({ type: "row", id: row.id, row }));
  const out: TableItem<R>[] = [];
  let current0: string | null | undefined;
  let current1: string | null | undefined;
  let group0: LedgerGroup | null = null;
  let hidden0 = false;
  let hidden1 = false;
  for (const row of rows) {
    const k0 = row.groupKeys?.[0] ?? null;
    const k1 = row.groupKeys?.[1] ?? null;
    if (k0 !== current0) {
      current0 = k0;
      current1 = undefined;
      group0 = groups.find((g) => g.key === k0) ?? null;
      const id = groupItemId([k0]);
      hidden0 = collapsed.has(id);
      hidden1 = false;
      out.push({ type: "group", id, level: 0, groupKey: groupBy[0], value: k0, group: group0, collapsed: hidden0 });
    }
    if (hidden0) continue;
    if (groupBy.length > 1 && k1 !== current1) {
      current1 = k1;
      const id = groupItemId([k0, k1]);
      hidden1 = collapsed.has(id);
      const group1 = group0?.children?.find((g) => g.key === k1) ?? null;
      out.push({ type: "group", id, level: 1, groupKey: groupBy[1], value: k1, group: group1, collapsed: hidden1 });
    }
    if (hidden1) continue;
    out.push({ type: "row", id: row.id, row });
  }
  return out;
}

/** Ids of the rows in drawn order (shift-click ranges, ↑/↓). */
export function visualRowIds<R>(items: readonly TableItem<R>[]): string[] {
  return items.filter((item): item is RowItem<R> => item.type === "row").map((item) => item.id);
}
