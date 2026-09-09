"use client";

import { DataTable, type ColumnDef } from "@/components/data-table";
import Link from "next/link";

interface PoliticianRow {
  id: string;
  name: string;
  ballotName: string | null;
  cpf: string;
  party: string | null;
  position: string;
  state: string | null;
  city: string | null;
  electionYear: number | null;
  elected: boolean;
  active: boolean;
  donationCount: number;
  linkCount: number;
}

export function PoliticiansTable({
  data,
  locale,
  totalCount,
  nextCursor,
  prevCursor,
  filterOptions,
}: {
  data: PoliticianRow[];
  locale: string;
  totalCount: number;
  nextCursor: string | null;
  prevCursor: string | null;
  filterOptions: {
    party: { label: string; value: string }[];
    position: { label: string; value: string }[];
    state: { label: string; value: string }[];
    city: { label: string; value: string }[];
    year: { label: string; value: string }[];
  };
}) {
  const columns: ColumnDef<PoliticianRow>[] = [
    {
      id: "name",
      header: "Nome",
      width: "w-[25%]",
      accessorFn: (row) => `${row.name} ${row.ballotName ?? ""} ${row.cpf}`,
      cell: (row) => (
        <Link href={`/${locale}/politicians/${row.id}`} className="hover:underline">
          <div className="font-medium truncate">{row.ballotName ?? row.name}</div>
          <div className="text-[11px] text-muted-foreground truncate">
            {row.name !== row.ballotName ? row.name : ""}
          </div>
        </Link>
      ),
    },
    {
      id: "party",
      header: "Partido",
      width: "w-[8%]",
      accessorFn: (row) => row.party,
      filterable: true,
      filterKey: "party",
      filterOptions: filterOptions.party,
      cell: (row) => <span className="text-xs font-medium">{row.party ?? "-"}</span>,
    },
    {
      id: "position",
      header: "Cargo",
      width: "w-[15%]",
      accessorFn: (row) => row.position,
      filterable: true,
      filterKey: "position",
      filterOptions: filterOptions.position,
      cell: (row) => (
        <span className="text-xs text-muted-foreground truncate block">{row.position}</span>
      ),
    },
    {
      id: "state",
      header: "UF",
      width: "w-[5%]",
      accessorFn: (row) => row.state,
      filterable: true,
      filterKey: "state",
      filterOptions: filterOptions.state,
      cell: (row) => <span className="text-xs text-muted-foreground">{row.state ?? "-"}</span>,
    },
    {
      id: "city",
      header: "Cidade",
      width: "w-[12%]",
      accessorFn: (row) => row.city,
      filterable: true,
      filterKey: "city",
      filterOptions: filterOptions.city,
      cell: (row) => (
        <span className="text-xs text-muted-foreground truncate block">{row.city ?? "-"}</span>
      ),
    },
    {
      id: "electionYear",
      header: "Eleição",
      width: "w-[7%]",
      accessorFn: (row) => row.electionYear,
      filterable: true,
      filterKey: "year",
      filterOptions: filterOptions.year,
      cell: (row) => <span className="text-xs">{row.electionYear ?? "-"}</span>,
    },
    {
      id: "status",
      header: "Status",
      width: "w-[8%]",
      accessorFn: (row) =>
        row.active ? "Ativo" : row.elected ? "Eleito" : "Candidato",
      filterable: true,
      filterKey: "status",
      filterOptions: [
        { label: "Ativo", value: "Ativo" },
        { label: "Eleito", value: "Eleito" },
        { label: "Candidato", value: "Candidato" },
      ],
      cell: (row) => {
        if (row.active)
          return <span className="px-1.5 py-0.5 rounded bg-green-500/20 text-green-600 text-[11px] font-medium">Ativo</span>;
        if (row.elected)
          return <span className="px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-600 text-[11px] font-medium">Eleito</span>;
        return <span className="text-[11px] text-muted-foreground">Candidato</span>;
      },
    },
    {
      id: "donationCount",
      header: "Doações",
      width: "w-[7%]",
      accessorFn: (row) => row.donationCount,
      align: "center",
      cell: (row) =>
        row.donationCount > 0 ? (
          <span className="text-[11px] px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-500 font-medium">
            {row.donationCount}
          </span>
        ) : null,
    },
    {
      id: "linkCount",
      header: "Vínculos",
      width: "w-[7%]",
      accessorFn: (row) => row.linkCount,
      align: "center",
      cell: (row) =>
        row.linkCount > 0 ? (
          <span className="text-[11px] px-1.5 py-0.5 rounded bg-orange-500/20 text-orange-500 font-medium">
            {row.linkCount}
          </span>
        ) : null,
    },
  ];

  const renderMobileRow = (row: PoliticianRow) => (
    <Link
      href={`/${locale}/politicians/${row.id}`}
      className="flex items-start justify-between gap-3 p-3 hover:bg-muted/30 transition-colors"
    >
      <div className="flex-1 min-w-0">
        <div className="font-medium text-sm truncate">{row.ballotName ?? row.name}</div>
        <div className="text-xs text-muted-foreground truncate">{row.position}</div>
        <div className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-1.5 flex-wrap">
          {row.party && <span className="font-medium">{row.party}</span>}
          {row.state && (
            <>
              {row.party && <span>·</span>}
              <span>{row.state}</span>
            </>
          )}
          {row.electionYear && (
            <>
              <span>·</span>
              <span>{row.electionYear}</span>
            </>
          )}
        </div>
      </div>
      <div className="flex-shrink-0 text-right flex flex-col items-end gap-1">
        {row.active ? (
          <span className="px-1.5 py-0.5 rounded bg-green-500/20 text-green-600 text-[11px] font-medium">
            Ativo
          </span>
        ) : row.elected ? (
          <span className="px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-600 text-[11px] font-medium">
            Eleito
          </span>
        ) : null}
        {row.linkCount > 0 && (
          <span className="text-[11px] px-1.5 py-0.5 rounded bg-orange-500/20 text-orange-500 font-medium">
            {row.linkCount} vínc.
          </span>
        )}
      </div>
    </Link>
  );

  return (
    <DataTable
      data={data}
      columns={columns}
      searchPlaceholder="Pesquisar por nome, CPF..."
      emptyMessage="Nenhum político encontrado."
      totalCount={totalCount}
      basePath={`/${locale}/politicians`}
      nextCursor={nextCursor}
      prevCursor={prevCursor}
      renderMobileRow={renderMobileRow}
    />
  );
}
