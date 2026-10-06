"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Table } from "@/components/cap";
import { entityLabel, type Names } from "@/lib/api/catalog";
import { apiGet, apiPost } from "@/lib/api/client";
import { keys } from "@/lib/api/keys";
import { useAppMutation } from "@/lib/api/use-app-mutation";
import { useFmt } from "@/lib/format/provider";

/** One row of GET /v2/imports. */
interface ImportListItem {
  id: string;
  entity: { id: string; name: string; kind: string } | null;
  account: { id: string; name: string; type: string } | null;
  kind: "card" | "bank";
  bankName: string | null;
  fileName: string | null;
  source: string;
  transactionCount: number;
  revertedAt: string | null;
  createdAt: string;
}

/**
 * Ajustes › Importações (mockup 6529-6541): the history of imports, each
 * one undoable. Importing itself is the "Importar extrato" dialog in
 * Transações. Desfazer reverts the import (its rows go to the trash) and
 * the toast's own Desfazer brings it back.
 *
 * Rendered by settings-screen.tsx (S6); `names` is accepted for that call
 * and not needed here.
 */
export function ImportsPage(props: { names?: Names }) {
  void props;
  const t = useTranslations("import.history");
  const fmt = useFmt();
  const history = useQuery({
    queryKey: keys.imports(),
    queryFn: async () => (await apiGet<{ imports: ImportListItem[] }>("/api/v2/imports")).imports,
  });

  const fileOf = (item: ImportListItem) => item.fileName ?? (item.source === "agent" ? t("viaAssistant") : (item.bankName ?? "—"));

  const revert = useAppMutation({
    event: "imports.write",
    mutationFn: (item: ImportListItem) => apiPost<{ batchId: string | null }>(`/api/v2/imports/${encodeURIComponent(item.id)}/revert`),
    undo: (_data, item) => t("revertedToast", { file: fileOf(item) }),
  });

  const items = history.data ?? [];
  return (
    <Table
      className="max-w-[920px]"
      headers={[t("date"), t("file"), t("account"), t("rows"), t("status"), ""]}
      columnAlign={["left", "left", "left", "right", "left", "right"]}
      rowKey={(index) => items[index].id}
      rows={items.map((item) => [
        <span key="date" className="font-mono text-[11.5px] text-fg-3">
          {fmt.date(item.createdAt)}
        </span>,
        <span key="file" className="block max-w-[320px] truncate" title={fileOf(item)}>
          {fileOf(item)}
        </span>,
        <span key="account" className="text-fg-2">
          {item.account?.name ?? (item.entity ? entityLabel(item.entity) : "—")}
        </span>,
        <span key="rows" className="font-mono tabular-nums">
          {fmt.number(item.transactionCount, 0)}
        </span>,
        item.revertedAt ? t("reverted") : t("imported"),
        item.revertedAt ? (
          ""
        ) : (
          <button
            key="revert"
            type="button"
            disabled={revert.isPending && revert.variables?.id === item.id}
            onClick={() => revert.mutate(item)}
            className="cursor-pointer underline disabled:cursor-wait disabled:opacity-40"
          >
            {t("revert")}
          </button>
        ),
      ])}
      emptyMessage={history.isPending ? null : history.isError ? t("loadError") : t("empty")}
    />
  );
}
