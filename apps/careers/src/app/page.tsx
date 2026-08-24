import Link from "next/link";
import { listJobs, STATUS_LABELS, type JobListItem, type SortMode } from "@/server/modules/jobs/queries";
import { JobsTable } from "@/components/jobs-table";
import { cn } from "@/lib/utils";
import type { JobStatus } from "@/generated/prisma";

export const dynamic = "force-dynamic";

const VIEWS = [
  { key: "triagem", label: "Triagem" },
  { key: "funil", label: "Funil" },
  { key: "processo", label: "Em processo" },
  { key: "todas", label: "Todas" },
] as const;
type ViewKey = (typeof VIEWS)[number]["key"];

const SORT_MODES: { key: SortMode; label: string }[] = [
  { key: "ordem", label: "Minha ordem" },
  { key: "score", label: "Score" },
  { key: "data", label: "Data" },
];

function groupJobs(jobs: JobListItem[], view: ViewKey): { key: string; label: string; interest?: number; items: JobListItem[] }[] {
  if (view === "triagem") {
    const byInterest = new Map<number, JobListItem[]>();
    for (const job of jobs) {
      const list = byInterest.get(job.interest) ?? [];
      list.push(job);
      byInterest.set(job.interest, list);
    }
    return [5, 4, 3, 2, 1]
      .filter((n) => byInterest.has(n))
      .map((n) => ({ key: `interest-${n}`, label: `interesse ${n}`, interest: n, items: byInterest.get(n)! }));
  }

  const byStatus = new Map<JobStatus, JobListItem[]>();
  for (const job of jobs) {
    const list = byStatus.get(job.status) ?? [];
    list.push(job);
    byStatus.set(job.status, list);
  }
  return [...byStatus.entries()].map(([status, items]) => ({ key: status, label: STATUS_LABELS[status], items }));
}

export default async function VagasPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; sort?: string }>;
}) {
  const params = await searchParams;
  const view: ViewKey = (VIEWS.find((v) => v.key === params.view)?.key ?? "triagem") as ViewKey;
  const sort: SortMode = (SORT_MODES.find((s) => s.key === params.sort)?.key ?? "ordem") as SortMode;
  const jobs = await listJobs(view, sort);
  const groups = groupJobs(jobs, view);
  const draggable = sort === "ordem";

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 shrink-0 items-center gap-3.5 border-b border-border px-6">
        <span className="text-sm font-semibold">Vagas</span>
        <div className="flex gap-0.5 rounded-lg border border-border bg-card p-0.5">
          {VIEWS.map((v) => (
            <Link
              key={v.key}
              href={`/?view=${v.key}&sort=${sort}`}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs",
                view === v.key ? "bg-secondary font-medium text-foreground" : "text-muted-foreground"
              )}
            >
              {v.label}
            </Link>
          ))}
        </div>
        <div className="flex gap-0.5 rounded-lg border border-border bg-card p-0.5">
          {SORT_MODES.map((s) => (
            <Link
              key={s.key}
              href={`/?view=${view}&sort=${s.key}`}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs",
                sort === s.key ? "bg-secondary font-medium text-foreground" : "text-muted-foreground"
              )}
            >
              {s.label}
            </Link>
          ))}
        </div>
        <div className="flex-1" />
        <Link
          href="/triagem"
          className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground"
        >
          Triar
        </Link>
      </div>

      <div className="flex-1 overflow-auto px-6 py-4">
        {jobs.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">Nenhuma vaga nesta view.</p>
        ) : (
          <JobsTable groups={groups} draggable={draggable} allowRegroup={draggable && view === "triagem"} />
        )}
      </div>
    </div>
  );
}
