"use client";

import { useRef, useState, type ClipboardEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { apiDelete, apiGet, apiUpload } from "@/lib/api/client";
import { keys } from "@/lib/api/keys";
import { useAppMutation } from "@/lib/api/use-app-mutation";
import { cn } from "@/lib/utils";

/** Where a receipt hangs: an income/expense entry or a transfer. */
export interface AttachmentOwner {
  ownerType: "entry" | "transfer";
  ownerId: string;
}

export interface AttachmentRecord {
  id: string;
  originalName: string;
  blobUrl: string;
}

/** Uploads one receipt (POST /v2/attachments, multipart). */
export function uploadReceipt(owner: AttachmentOwner, file: File): Promise<AttachmentRecord> {
  const form = new FormData();
  form.set("file", file);
  form.set("kind", owner.ownerType === "transfer" ? "TRANSFER_RECEIPT" : "RECEIPT");
  form.set("ownerType", owner.ownerType);
  form.set("ownerId", owner.ownerId);
  return apiUpload<AttachmentRecord>("/api/v2/attachments", form);
}

/** Files pasted with ⌘V (images copied to the clipboard), for the dialog's and sheet's onPaste. */
export function pastedFiles(event: ClipboardEvent): File[] {
  const files = Array.from(event.clipboardData?.files ?? []);
  if (files.length) event.preventDefault();
  return files;
}

export interface DropzoneItem {
  key: string;
  name: string;
  href?: string;
  onRemove: () => void;
}

/**
 * "Arraste o comprovante, cole uma imagem (⌘V) ou clique para anexar"
 * (mockup 4961-4963): a 44px dashed box that takes dropped or picked
 * files, with the attached ones listed under it.
 */
export function Dropzone({ onFiles, items, disabled }: { onFiles: (files: File[]) => void; items: DropzoneItem[]; disabled?: boolean }) {
  const t = useTranslations("entry.form");
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        disabled={disabled}
        onClick={() => input.current?.click()}
        onDragOver={(event) => {
          event.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(event) => {
          event.preventDefault();
          setOver(false);
          const files = Array.from(event.dataTransfer.files);
          if (files.length) onFiles(files);
        }}
        className={cn(
          "flex h-11 items-center justify-center rounded-[8px] border border-dashed border-stroke-1 text-body-sm text-fg-3 outline-none hover:border-fg-3 focus-visible:border-fg-muted disabled:opacity-40",
          over && "border-fg-muted bg-fill-4",
        )}
      >
        {t("dropzone")}
      </button>
      <input
        ref={input}
        type="file"
        multiple
        className="hidden"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          if (files.length) onFiles(files);
          event.target.value = "";
        }}
      />
      {items.map((item) => (
        <span key={item.key} className="flex items-center gap-2 text-body-sm">
          {item.href ? (
            <a href={item.href} target="_blank" rel="noreferrer" className="min-w-0 truncate underline">
              {item.name}
            </a>
          ) : (
            <span className="min-w-0 truncate">{item.name}</span>
          )}
          <button type="button" className="ml-auto shrink-0 text-caption text-fg-3 hover:text-neg" onClick={item.onRemove}>
            {t("removeFile")}
          </button>
        </span>
      ))}
    </div>
  );
}

/** The receipts of an existing entry or transfer: listed, uploaded at once, removable. */
export function useOwnerAttachments(owner: AttachmentOwner | null) {
  const list = useQuery({
    queryKey: owner ? keys.attachments(owner.ownerType, owner.ownerId) : ["attachments", "none"],
    queryFn: async () => (await apiGet<{ attachments: AttachmentRecord[] }>("/api/v2/attachments", { ownerType: owner!.ownerType, ownerId: owner!.ownerId })).attachments,
    enabled: !!owner,
  });
  const upload = useAppMutation({
    event: "ledger.write",
    mutationFn: async (files: File[]) => {
      for (const file of files) await uploadReceipt(owner!, file);
    },
  });
  const remove = useAppMutation({
    event: "ledger.write",
    mutationFn: (id: string) => apiDelete(`/api/v2/attachments/${encodeURIComponent(id)}`),
  });
  const items: DropzoneItem[] = (list.data ?? []).map((attachment) => ({
    key: attachment.id,
    name: attachment.originalName,
    href: attachment.blobUrl,
    onRemove: () => remove.mutate(attachment.id),
  }));
  return { items, add: (files: File[]) => owner && upload.mutate(files), busy: upload.isPending || remove.isPending };
}
