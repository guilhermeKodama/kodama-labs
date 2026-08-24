"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import type { JSONContent } from "@tiptap/react";
import { TiptapEditor } from "@/components/tiptap-editor";
import {
  createNote,
  updateNoteTitle,
  updateNoteContent,
  togglePinNote,
  deleteNote,
} from "@/server/modules/notes/actions";
import { Pin, Trash2, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

type NoteItem = {
  id: string;
  title: string | null;
  contentJson: unknown;
  pinned: boolean;
};

function NoteCard({ note, path }: { note: NoteItem; path: string }) {
  const [isPending, startTransition] = useTransition();
  const [title, setTitle] = React.useState(note.title ?? "");

  return (
    <div className={cn("rounded-xl border border-border bg-card p-4", isPending && "opacity-60")}>
      <div className="mb-2 flex items-center gap-2">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => startTransition(() => void updateNoteTitle(note.id, title, path))}
          placeholder="Sem título"
          className="flex-1 bg-transparent text-sm font-semibold outline-none placeholder:text-muted-foreground"
        />
        <button
          type="button"
          title={note.pinned ? "Desafixar" : "Fixar"}
          onClick={() => startTransition(() => void togglePinNote(note.id, !note.pinned, path))}
          className={cn("text-muted-foreground hover:text-foreground", note.pinned && "text-primary")}
        >
          <Pin className="size-3.5" />
        </button>
        <button
          type="button"
          title="Excluir"
          onClick={() => startTransition(() => void deleteNote(note.id, path))}
          className="text-muted-foreground hover:text-destructive"
        >
          <Trash2 className="size-3.5" />
        </button>
      </div>
      <TiptapEditor
        content={(note.contentJson as JSONContent) ?? { type: "doc", content: [] }}
        onSave={async (json, text) => {
          await updateNoteContent(note.id, json, text);
        }}
      />
    </div>
  );
}

export function NotesSection({
  notes,
  jobId,
  companyId,
  path,
}: {
  notes: NoteItem[];
  jobId?: string;
  companyId?: string;
  path: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Notas</span>
        <button
          type="button"
          disabled={isPending}
          onClick={() =>
            startTransition(async () => {
              await createNote({ jobId, companyId, path });
              router.refresh();
            })
          }
          className="flex items-center gap-1 rounded-md bg-secondary px-2 py-1 text-[11px] font-medium hover:bg-secondary/80 disabled:opacity-50"
        >
          <Plus className="size-3" />
          Nova nota
        </button>
      </div>
      <div className="flex flex-col gap-3">
        {notes.map((note) => (
          <NoteCard key={note.id} note={note} path={path} />
        ))}
        {notes.length === 0 && <p className="text-xs text-muted-foreground">Nenhuma nota ainda.</p>}
      </div>
    </div>
  );
}
