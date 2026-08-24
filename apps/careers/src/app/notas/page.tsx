import { prisma } from "@/server/lib/prisma";
import { NotesSection } from "@/components/notes-section";

export const dynamic = "force-dynamic";

export default async function NotesPage() {
  const notes = await prisma.note.findMany({
    where: { jobId: null, companyId: null },
    orderBy: [{ pinned: "desc" }, { updatedAt: "desc" }],
  });

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-6">
        <span className="text-sm font-semibold">Notas</span>
        <span className="text-xs text-muted-foreground">{notes.length}</span>
      </div>
      <div className="flex-1 overflow-auto p-6">
        <div className="mx-auto max-w-2xl">
          <NotesSection notes={notes} path="/notas" />
        </div>
      </div>
    </div>
  );
}
