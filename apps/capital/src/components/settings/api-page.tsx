"use client";

import { useState, useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Btn, Dialog, DialogFooter, DialogHead, Field, Select, Table, TextInput } from "@/components/cap";
import { useApiTokens, useCreateApiToken, useRevokeApiToken, useUpdateApiToken, type ApiTokenRecord } from "@/lib/api/tokens";
import { useFmt } from "@/lib/format/provider";
import { ConfirmDialog } from "./confirm-dialog";

const noSubscribe = () => () => {};
const useOrigin = () => useSyncExternalStore(noSubscribe, () => window.location.origin, () => "");

/**
 * Integrações e API: the MCP server URL (click to copy), the newest token
 * masked (the plaintext only exists in the dialog that opens right after
 * "Gerar novo token"), the API docs, and each connected client with its
 * last use and the token's permissions (switchable, revocable).
 */
export function ApiPage() {
  const t = useTranslations("settings.api");
  const fmt = useFmt();
  const origin = useOrigin();
  const tokens = useApiTokens();
  const create = useCreateApiToken();
  const update = useUpdateApiToken();
  const revoke = useRevokeApiToken();
  const [revealed, setRevealed] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<ApiTokenRecord | null>(null);

  const list = tokens.data ?? [];
  const latest = list[0] ?? null;
  const tokenValue = latest?.masked ?? "";
  const serverUrl = origin ? `${origin}/mcp` : "";

  const generate = () =>
    create.mutate(
      {},
      {
        onSuccess: ({ token }) => setRevealed(token),
      },
    );
  const copy = (text: string) =>
    void navigator.clipboard.writeText(text).then(
      () => toast(t("copied")),
      () => toast(t("copyFailed")),
    );

  // One row per connected client; a token no client used yet gets its own row, so it can be switched or revoked.
  type Row = { key: string; token: ApiTokenRecord; name: string | null; lastUsedAt: string | null };
  const rows = list.flatMap((token): Row[] =>
    token.clients.length
      ? token.clients.map((client) => ({ key: client.id, token, name: client.clientName, lastUsedAt: client.lastUsedAt }))
      : [{ key: token.id, token, name: null, lastUsedAt: token.lastUsedAt }],
  );
  const permissionOptions = [
    { value: "rw", label: t("permissions.readWrite") },
    { value: "r", label: t("permissions.read") },
  ];

  return (
    <div className="flex flex-col gap-3">
      <div className="grid max-w-[620px] grid-cols-2 gap-3">
        <Field label={t("server")} htmlFor="api-server" hint={t("serverHint")}>
          <TextInput
            id="api-server"
            value={serverUrl}
            title={t("copyServer")}
            onChange={() => undefined}
            readOnly
            mono
            onFocus={(event) => event.currentTarget.select()}
            onClick={() => serverUrl && copy(serverUrl)}
            className="cursor-copy"
          />
        </Field>
        <Field label={t("token")} htmlFor="api-token" hint={t("tokenHint")}>
          <TextInput id="api-token" value={tokenValue} placeholder={t("noToken")} onChange={() => undefined} readOnly mono onFocus={(event) => event.currentTarget.select()} />
        </Field>
      </div>
      <div className="flex gap-1.5">
        <Btn onClick={generate} disabled={create.isPending}>
          {t("generate")}
        </Btn>
        <a href="/api/reference" target="_blank" rel="noreferrer" className="inline-flex h-[26px] items-center rounded-[6px] px-2.5 text-[12px] font-medium text-fg-2 outline-none hover:bg-fill-3 focus-visible:ring-2 focus-visible:ring-fg-3/40">
          {t("docs")}
        </a>
      </div>
      <Table
        headers={[t("headers.client"), t("headers.lastUsed"), t("headers.permissions"), ""]}
        columnAlign={["left", "left", "left", "right"]}
        rowKey={(i) => rows[i].key}
        emptyMessage={tokens.isSuccess ? t("empty") : undefined}
        rows={rows.map((row) => [
          <span key="name" className="inline-flex items-baseline gap-1.5">
            {row.name ?? <span className="text-fg-3">{t("noClient")}</span>}
            <span className="font-mono text-[11px] text-fg-3">{t("tokenSuffix", { last4: row.token.last4 })}</span>
          </span>,
          <span key="used" className="text-fg-2">
            {row.lastUsedAt ? fmt.relative(row.lastUsedAt) : t("never")}
          </span>,
          <Select
            key="perm"
            aria-label={t("headers.permissions")}
            className="h-[24px] w-[150px]"
            value={row.token.readOnly ? "r" : "rw"}
            disabled={update.isPending}
            onChange={(value) => update.mutate({ id: row.token.id, readOnly: value === "r" })}
            options={permissionOptions}
          />,
          <button key="revoke" type="button" onClick={() => setRevoking(row.token)} className="text-fg-3 outline-none hover:text-fg-1 focus-visible:underline">
            {t("revoke")}
          </button>,
        ])}
      />
      <Dialog open={revealed !== null} onOpenChange={(open) => !open && setRevealed(null)} width={480}>
        {revealed ? <RevealBody token={revealed} onCopy={() => copy(revealed)} onDone={() => setRevealed(null)} /> : null}
      </Dialog>
      <ConfirmDialog
        open={revoking !== null}
        onOpenChange={(open) => !open && setRevoking(null)}
        title={t("revokeDialog.title", { last4: revoking?.last4 ?? "" })}
        desc={t("revokeDialog.desc", { count: revoking?.clients.length ?? 0 })}
        confirmLabel={t("revokeDialog.confirm")}
        danger
        pending={revoke.isPending}
        onConfirm={() =>
          revoking &&
          revoke.mutate(revoking.id, {
            onSuccess: () => {
              toast(t("toastRevoked", { last4: revoking.last4 }));
              setRevoking(null);
            },
          })
        }
      />
    </div>
  );
}

/** The one time the plaintext token is shown: copy it now, it never comes back. */
function RevealBody({ token, onCopy, onDone }: { token: string; onCopy: () => void; onDone: () => void }) {
  const t = useTranslations("settings.api.reveal");
  return (
    <div className="flex flex-col gap-3.5">
      <DialogHead title={t("title")} desc={t("desc")} />
      <TextInput aria-label={t("title")} value={token} onChange={() => undefined} readOnly mono autoFocus onFocus={(event) => event.currentTarget.select()} className="w-full" />
      <DialogFooter>
        <Btn ghost onClick={onDone}>
          {t("done")}
        </Btn>
        <Btn primary onClick={onCopy}>
          {t("copy")}
        </Btn>
      </DialogFooter>
    </div>
  );
}
