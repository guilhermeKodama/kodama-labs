import Link from "next/link";
import { listFavoriteCompanies } from "@/server/modules/companies/queries";

export const dynamic = "force-dynamic";

const HEALTH_LABEL: Record<string, string> = {
  FORTE: "forte",
  ATENCAO: "atenção",
  RISCO: "risco",
  A_CONFIRMAR: "a confirmar",
};

export default async function CompaniesPage() {
  const companies = await listFavoriteCompanies();

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-6">
        <span className="text-sm font-semibold">Empresas favoritas</span>
        <span className="text-xs text-muted-foreground">{companies.length}</span>
      </div>
      <div className="flex-1 overflow-auto px-6 py-4">
        <div className="grid grid-cols-[40px_1fr_90px_100px_90px_70px] gap-3 border-b border-border pb-2 text-[11px] font-medium text-muted-foreground">
          <span></span>
          <span>Empresa</span>
          <span>Prio</span>
          <span>PJ-BR</span>
          <span>Saúde</span>
          <span>Vagas</span>
        </div>
        {companies.map((c) => (
          <Link
            key={c.id}
            href={`/empresa/${c.slug}`}
            className="grid grid-cols-[40px_1fr_90px_100px_90px_70px] items-center gap-3 border-b border-border py-2.5 hover:bg-secondary/40"
          >
            <div className="flex size-7 items-center justify-center rounded-lg bg-secondary text-xs font-bold">
              {c.name.charAt(0)}
            </div>
            <div className="min-w-0">
              <div className="truncate text-sm font-medium">{c.name}</div>
              <div className="truncate text-xs text-muted-foreground">{c.stackSummary ?? c.sectorGroup ?? "—"}</div>
            </div>
            <span className="text-sm tabular-nums">{c.priority ?? "—"}</span>
            <span className="text-xs text-muted-foreground">{c.pjBrazil.replace("_", " ").toLowerCase()}</span>
            <span className="text-xs text-muted-foreground">{HEALTH_LABEL[c.health]}</span>
            <span className="text-sm tabular-nums">{c._count.jobs}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
