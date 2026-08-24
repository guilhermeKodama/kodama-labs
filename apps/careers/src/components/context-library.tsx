"use client";

import * as React from "react";
import { useActionState, useTransition } from "react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Trash2 } from "lucide-react";
import {
  uploadContextDocument,
  toggleContextDocInPrompt,
  deleteContextDocument,
  reorderContextDocuments,
} from "@/server/modules/context-docs/actions";
import { cn } from "@/lib/utils";

type ContextDoc = {
  id: string;
  title: string;
  kind: string;
  includeInPrompt: boolean;
  sizeBytes: number | null;
};

function SortableDoc({ doc }: { doc: ContextDoc }) {
  const [isPending, startTransition] = useTransition();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: doc.id });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2.5",
        isDragging && "opacity-50",
        isPending && "opacity-60"
      )}
    >
      <button type="button" {...attributes} {...listeners} className="cursor-grab touch-none text-muted-foreground active:cursor-grabbing">
        <GripVertical className="size-3.5" />
      </button>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{doc.title}</div>
        <div className="text-xs text-muted-foreground">{doc.kind}</div>
      </div>
      <button
        type="button"
        onClick={() => startTransition(() => void toggleContextDocInPrompt(doc.id, !doc.includeInPrompt))}
        className={cn(
          "shrink-0 rounded-md px-2 py-1 text-[11px] font-medium",
          doc.includeInPrompt ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground"
        )}
      >
        {doc.includeInPrompt ? "no prompt" : "fora do prompt"}
      </button>
      <button
        type="button"
        title="Remover"
        onClick={() => startTransition(() => void deleteContextDocument(doc.id))}
        className="shrink-0 text-muted-foreground hover:text-destructive"
      >
        <Trash2 className="size-3.5" />
      </button>
    </div>
  );
}

const initialUploadState: { error?: string } = {};

function ContextDropzone() {
  const [state, formAction, isPending] = useActionState(
    async (_prev: { error?: string }, formData: FormData) => uploadContextDocument(formData),
    initialUploadState
  );
  const [isDragOver, setIsDragOver] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const formRef = React.useRef<HTMLFormElement>(null);

  return (
    <form
      ref={formRef}
      action={formAction}
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragOver(true);
      }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setIsDragOver(false);
        const file = e.dataTransfer.files?.[0];
        if (file && inputRef.current) {
          const dt = new DataTransfer();
          dt.items.add(file);
          inputRef.current.files = dt.files;
          formRef.current?.requestSubmit();
        }
      }}
      className={cn(
        "rounded-xl border border-dashed p-4 text-center transition-colors",
        isDragOver ? "border-primary bg-secondary/40" : "border-border"
      )}
    >
      <input ref={inputRef} type="file" name="file" className="hidden" onChange={() => formRef.current?.requestSubmit()} />
      <input type="hidden" name="title" value="" />
      <p className="text-xs text-muted-foreground">
        {isPending ? "Enviando..." : "Arraste um arquivo aqui, ou"}{" "}
        {!isPending && (
          <button type="button" onClick={() => inputRef.current?.click()} className="font-medium text-foreground underline">
            escolha um arquivo
          </button>
        )}
      </p>
      {state?.error && <p className="mt-2 text-xs text-destructive">{state.error}</p>}
    </form>
  );
}

export function ContextLibrary({ docs }: { docs: ContextDoc[] }) {
  const [items, setItems] = React.useState(docs);
  React.useEffect(() => setItems(docs), [docs]);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = items.findIndex((d) => d.id === active.id);
    const newIndex = items.findIndex((d) => d.id === over.id);
    const reordered = [...items];
    const [moved] = reordered.splice(oldIndex, 1);
    reordered.splice(newIndex, 0, moved);
    setItems(reordered);
    void reorderContextDocuments(reordered.map((d) => d.id));
  }

  return (
    <div className="flex flex-col gap-3">
      <ContextDropzone />
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={items.map((d) => d.id)} strategy={verticalListSortingStrategy}>
          <div className="flex flex-col gap-2">
            {items.map((doc) => (
              <SortableDoc key={doc.id} doc={doc} />
            ))}
          </div>
        </SortableContext>
      </DndContext>
      {items.length === 0 && <p className="text-xs text-muted-foreground">Nenhum documento de contexto ainda.</p>}
    </div>
  );
}
