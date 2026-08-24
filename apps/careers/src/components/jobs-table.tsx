"use client";

import * as React from "react";
import Link from "next/link";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  DragOverlay,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy, arrayMove } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import { JobStatusSelect } from "@/components/job-status-select";
import { JobInterestPicker } from "@/components/job-interest-picker";
import { updateJobManualRank } from "@/server/modules/jobs/actions";
import type { JobListItem } from "@/server/modules/jobs/queries";
import { cn } from "@/lib/utils";

type Group = { key: string; label: string; interest?: number; items: JobListItem[] };

const GRID_COLS = "grid-cols-[22px_1fr_140px_100px_110px_130px]";

function computeInsertRank(items: JobListItem[], index: number): number {
  let prev: number | null = null;
  for (let i = index - 1; i >= 0; i--) {
    if (items[i].manualRank != null) {
      prev = items[i].manualRank;
      break;
    }
  }
  let next: number | null = null;
  for (let i = index + 1; i < items.length; i++) {
    if (items[i].manualRank != null) {
      next = items[i].manualRank;
      break;
    }
  }
  if (prev == null && next == null) return 0;
  if (prev == null) return next! - 1;
  if (next == null) return prev + 1;
  return (prev + next) / 2;
}

function JobRow({ job, draggable }: { job: JobListItem; draggable: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: job.id,
    disabled: !draggable,
  });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        `grid ${GRID_COLS} items-center gap-3 border-b border-border py-2.5`,
        isDragging && "opacity-50 bg-secondary/40"
      )}
    >
      {draggable ? (
        <button
          type="button"
          {...attributes}
          {...listeners}
          className="cursor-grab touch-none text-muted-foreground active:cursor-grabbing"
        >
          <GripVertical className="size-3.5" />
        </button>
      ) : (
        <span />
      )}
      <div className="min-w-0">
        <Link href={`/vaga/${job.id}`} className="truncate text-sm font-medium hover:underline">
          {job.title}
        </Link>
        <div className="truncate text-xs text-muted-foreground">{job.stack.join(" · ") || "—"}</div>
      </div>
      <Link href={`/empresa/${job.company.slug}`} className="truncate text-sm hover:underline">
        {job.company.name}
      </Link>
      <span className="text-sm tabular-nums">{job.compatibilityScore ?? "—"}</span>
      <JobInterestPicker jobId={job.id} interest={job.interest} />
      <JobStatusSelect jobId={job.id} status={job.status} />
    </div>
  );
}

function GroupContainer({ group, draggable }: { group: Group; draggable: boolean }) {
  const { setNodeRef } = useDroppable({ id: group.key });
  return (
    <div ref={setNodeRef} className="flex flex-col">
      <div className="flex items-center gap-2 py-2 text-[11px] font-medium text-muted-foreground">
        <span className="rounded-md bg-secondary px-2 py-0.5 text-foreground">{group.label}</span>
        <span>{group.items.length} vaga(s)</span>
      </div>
      <SortableContext items={group.items.map((j) => j.id)} strategy={verticalListSortingStrategy}>
        {group.items.map((job) => (
          <JobRow key={job.id} job={job} draggable={draggable} />
        ))}
      </SortableContext>
      {group.items.length === 0 && draggable && (
        <div className="border-b border-dashed border-border py-3 text-center text-[11px] text-muted-foreground">
          solte aqui
        </div>
      )}
    </div>
  );
}

export function JobsTable({ groups: initialGroups, draggable, allowRegroup }: { groups: Group[]; draggable: boolean; allowRegroup: boolean }) {
  const [groups, setGroups] = React.useState(initialGroups);
  React.useEffect(() => setGroups(initialGroups), [initialGroups]);
  const [activeJob, setActiveJob] = React.useState<JobListItem | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  function findContainer(id: string): string | undefined {
    return groups.find((g) => g.key === id || g.items.some((j) => j.id === id))?.key;
  }

  function handleDragStart(event: DragStartEvent) {
    const job = groups.flatMap((g) => g.items).find((j) => j.id === event.active.id);
    setActiveJob(job ?? null);
  }

  function handleDragOver(event: DragOverEvent) {
    if (!allowRegroup) return;
    const { active, over } = event;
    if (!over) return;
    const activeContainer = findContainer(String(active.id));
    const overContainer = findContainer(String(over.id));
    if (!activeContainer || !overContainer || activeContainer === overContainer) return;

    setGroups((prev) => {
      const activeGroup = prev.find((g) => g.key === activeContainer)!;
      const overGroup = prev.find((g) => g.key === overContainer)!;
      const activeItem = activeGroup.items.find((j) => j.id === active.id);
      if (!activeItem) return prev;
      const overIndex = overGroup.items.findIndex((j) => j.id === over.id);
      const insertIndex = overIndex >= 0 ? overIndex : overGroup.items.length;
      return prev.map((g) => {
        if (g.key === activeContainer) return { ...g, items: g.items.filter((j) => j.id !== active.id) };
        if (g.key === overContainer) {
          const items = [...g.items];
          items.splice(insertIndex, 0, activeItem);
          return { ...g, items };
        }
        return g;
      });
    });
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveJob(null);
    const { active, over } = event;
    if (!over) return;

    const container = findContainer(String(active.id));
    if (!container) return;
    const groupIndex = groups.findIndex((g) => g.key === container);
    const group = groups[groupIndex];
    const oldIndex = group.items.findIndex((j) => j.id === active.id);
    const overContainer = findContainer(String(over.id));

    let finalItems = group.items;
    let finalIndex = oldIndex;
    if (overContainer === container && String(over.id) !== container) {
      finalIndex = group.items.findIndex((j) => j.id === over.id);
      if (finalIndex === -1) finalIndex = group.items.length - 1;
      finalItems = arrayMove(group.items, oldIndex, finalIndex);
      setGroups((prev) => prev.map((g, i) => (i === groupIndex ? { ...g, items: finalItems } : g)));
    }

    const newRank = computeInsertRank(finalItems, finalIndex);
    const movedJob = finalItems[finalIndex];
    if (!movedJob) return;
    const regroup = allowRegroup && group.interest !== undefined && movedJob.interest !== group.interest;
    void updateJobManualRank(movedJob.id, newRank, regroup ? group.interest : undefined);
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
    >
      <div className="flex flex-col gap-1">
        <div className={`grid ${GRID_COLS} gap-3 border-b border-border pb-2 text-[11px] font-medium text-muted-foreground`}>
          <span />
          <span>Vaga</span>
          <span>Empresa</span>
          <span>Score</span>
          <span>Interesse</span>
          <span>Status</span>
        </div>
        {groups.map((group) => (
          <GroupContainer key={group.key} group={group} draggable={draggable} />
        ))}
      </div>
      <DragOverlay>
        {activeJob && (
          <div className={`grid ${GRID_COLS} items-center gap-3 rounded-lg border border-border bg-card px-2 py-2.5 shadow-lg`}>
            <GripVertical className="size-3.5 text-muted-foreground" />
            <span className="truncate text-sm font-medium">{activeJob.title}</span>
            <span className="truncate text-sm">{activeJob.company.name}</span>
            <span className="text-sm tabular-nums">{activeJob.compatibilityScore ?? "—"}</span>
            <span />
            <span />
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}
