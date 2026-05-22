'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Download, FileText, Loader2, Trash2, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';

export type AttachmentOwnerType =
  | 'transaction'
  | 'transfer'
  | 'recurringTransaction'
  | 'recurringTransfer';

export type AttachmentKind = 'BILL' | 'RECEIPT' | 'TRANSFER_RECEIPT';

export interface Attachment {
  id: string;
  kind: AttachmentKind;
  blobUrl: string;
  mimeType: string;
  sizeBytes: number;
  originalName: string;
  uploadedAt: string;
}

interface AttachmentUploaderProps {
  ownerType: AttachmentOwnerType;
  ownerId: string;
  kind: AttachmentKind;
  label: string;
  helperText?: string;
}

const ACCEPT_MIME = '.pdf,.jpg,.jpeg,.png,.webp';
const MAX_BYTES = 10 * 1024 * 1024;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function AttachmentUploader({
  ownerType,
  ownerId,
  kind,
  label,
  helperText,
}: AttachmentUploaderProps) {
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ ownerType, ownerId });
      const res = await fetch(`/api/v1/attachments?${params.toString()}`, {
        credentials: 'include',
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as
          | { error?: { message?: string } }
          | null;
        throw new Error(body?.error?.message ?? `Failed (${res.status})`);
      }
      const data = (await res.json()) as Attachment[];
      setAttachments(data.filter((a) => a.kind === kind));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load attachments');
    } finally {
      setIsLoading(false);
    }
  }, [ownerType, ownerId, kind]);

  useEffect(() => {
    if (!ownerId) return;
    void refresh();
  }, [ownerId, refresh]);

  async function handleFileSelected(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    if (file.size > MAX_BYTES) {
      setError(`File too large (max ${formatBytes(MAX_BYTES)})`);
      return;
    }

    setIsUploading(true);
    setError(null);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('kind', kind);
      form.append('ownerType', ownerType);
      form.append('ownerId', ownerId);

      const res = await fetch('/api/v1/attachments', {
        method: 'POST',
        body: form,
        credentials: 'include',
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as
          | { error?: { message?: string } }
          | null;
        throw new Error(body?.error?.message ?? `Upload failed (${res.status})`);
      }
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setIsUploading(false);
    }
  }

  async function handleDelete(id: string) {
    setError(null);
    try {
      const res = await fetch(`/api/v1/attachments/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as
          | { error?: { message?: string } }
          | null;
        throw new Error(body?.error?.message ?? `Delete failed (${res.status})`);
      }
      setAttachments((prev) => prev.filter((a) => a.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-slate-200">{label}</p>
          {helperText ? (
            <p className="text-xs text-slate-500">{helperText}</p>
          ) : null}
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => fileInputRef.current?.click()}
          disabled={isUploading}
          className="border-slate-700 text-slate-200 hover:bg-slate-800"
        >
          {isUploading ? (
            <Loader2 className="mr-1 h-3 w-3 animate-spin" />
          ) : (
            <Upload className="mr-1 h-3 w-3" />
          )}
          Add file
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPT_MIME}
          className="hidden"
          onChange={handleFileSelected}
        />
      </div>

      {error ? (
        <p className="text-xs text-red-400">{error}</p>
      ) : null}

      <div className="space-y-1.5">
        {isLoading && attachments.length === 0 ? (
          <p className="text-xs text-slate-500">Loading…</p>
        ) : attachments.length === 0 ? (
          <p className="text-xs text-slate-500">No files attached yet.</p>
        ) : (
          attachments.map((a) => (
            <div
              key={a.id}
              className="flex items-center justify-between rounded-md border border-slate-800 bg-slate-900/60 px-3 py-2"
            >
              <div className="flex min-w-0 items-center gap-2">
                <FileText className="h-4 w-4 shrink-0 text-slate-400" />
                <div className="min-w-0">
                  <p className="truncate text-sm text-slate-200">{a.originalName}</p>
                  <p className="text-xs text-slate-500">{formatBytes(a.sizeBytes)}</p>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <a
                  href={a.blobUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-md p-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                  aria-label="Open file"
                >
                  <Download className="h-3.5 w-3.5" />
                </a>
                <button
                  type="button"
                  onClick={() => handleDelete(a.id)}
                  className="rounded-md p-1.5 text-slate-400 hover:bg-red-500/20 hover:text-red-300"
                  aria-label="Delete file"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
