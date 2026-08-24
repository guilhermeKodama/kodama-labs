import { getTriageQueue } from "@/server/modules/jobs/triage-queue";
import { TriageFlow } from "@/components/triage-flow";

export const dynamic = "force-dynamic";

export default async function TriagemPage() {
  const jobs = await getTriageQueue();
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-6">
        <span className="text-sm font-semibold">Triagem</span>
        <span className="text-xs text-muted-foreground">{jobs.length} na fila</span>
      </div>
      <div className="flex-1 overflow-hidden">
        <TriageFlow jobs={jobs} />
      </div>
    </div>
  );
}
