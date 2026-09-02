'use client';

import { FileText } from 'lucide-react';
import type { MessageAttachment } from '@/types/assistant';

interface MessageAttachmentsProps {
  files: MessageAttachment[];
}

function isImage(file: MessageAttachment): boolean {
  return typeof file.mediaType === 'string' && file.mediaType.startsWith('image/');
}

/**
 * What the user attached to their own message, shown under the bubble.
 * Without this, pasting a screenshot sends it into a void - the thread
 * would show only the text that went with it.
 */
export function MessageAttachments({ files }: MessageAttachmentsProps) {
  if (files.length === 0) return null;

  return (
    <div className="mt-1.5 flex flex-wrap justify-end gap-1.5">
      {files.map((file) =>
        isImage(file) && file.blobUrl ? (
          <a
            key={file.fileId}
            href={file.blobUrl}
            target="_blank"
            rel="noreferrer"
            title={file.originalName}
            className="block overflow-hidden rounded-lg border border-slate-700 transition-opacity hover:opacity-80"
          >
            {/* Blob URLs are external//api-served and unsized here, so a
                plain img beats next/image's required dimensions. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={file.blobUrl}
              alt={file.originalName}
              className="max-h-40 max-w-[220px] object-cover"
            />
          </a>
        ) : (
          <span
            key={file.fileId}
            className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800/60 px-2.5 py-1.5 text-[11px] text-slate-300"
          >
            <FileText className="h-3 w-3 flex-shrink-0" />
            <span className="max-w-[180px] truncate">{file.originalName}</span>
          </span>
        )
      )}
    </div>
  );
}
