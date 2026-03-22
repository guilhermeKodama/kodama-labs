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
}: {
  data: PoliticianRow[];
  locale: string;
}) {
  const columns: ColumnDef<PoliticianRow>[] = [
    {
      id: "name",
      header: "Nome",
      width: "w-[25%]",
      accessorFn: (row) =>
        `${row.name} ${row.ballotName ?? ""} ${row.cpf}`,
      cell: (row) => (
        <Link
          href={`/${locale}/politicians/${row.id}`}
          className="hover:underline"
        >
          <div className="font-medium truncate">
            {row.ballotName ?? row.name}
          </div>
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
      cell: (row) => (
        <span className="text-xs font-medium">{row.party ?? "-"}</span>
      ),
    },
    {
      id: "position",
      header: "Cargo",
      width: "w-[15%]",
      accessorFn: (row) => row.position,
      filterable: true,
      cell: (row) => (
        <span className="text-xs text-muted-foreground truncate block">
          {row.position}
        </span>
      ),
    },
    {
      id: "state",
      header: "UF",
      width: "w-[5%]",
      accessorFn: (row) => row.state,
      filterable: true,
      cell: (row) => (
        <span className="text-xs text-muted-foreground">
          {row.state ?? "-"}
        </span>
      ),
    },
    {
      id: "city",
      header: "Cidade",
      width: "w-[12%]",
      accessorFn: (row) => row.city,
      cell: (row) => (
        <span className="text-xs text-muted-foreground truncate block">
          {row.city ?? "-"}
        </span>
      ),
    },
    {
      id: "electionYear",
      header: "Eleição",
      width: "w-[7%]",
      accessorFn: (row) => row.electionYear,
      filterable: true,
      cell: (row) => (
        <span className="text-xs">{row.electionYear ?? "-"}</span>
      ),
    },
    {
      id: "status",
      header: "Status",
      width: "w-[8%]",
      accessorFn: (row) =>
        row.active ? "Ativo" : row.elected ? "Eleito" : "Candidato",
      filterable: true,
      filterOptions: [
        { label: "Ativo", value: "Ativo" },
        { label: "Eleito", value: "Eleito" },
        { label: "Candidato", value: "Candidato" },
      ],
      cell: (row) => {
        if (row.active) {
          return (
            <span className="px-1.5 py-0.5 rounded bg-green-500/20 text-green-600 text-[11px] font-medium">
              Ativo
            </span>
          );
        }
        if (row.elected) {
          return (
            <span className="px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-600 text-[11px] font-medium">
              Eleito
            </span>
          );
        }
        return (
          <span className="text-[11px] text-muted-foreground">Candidato</span>
        );
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

  return (
    <DataTable
      data={data}
      columns={columns}
      searchPlaceholder="Pesquisar por nome, CPF, partido, cargo, UF..."
      emptyMessage="Nenhum político encontrado. Execute o pipeline de ingestão de dados políticos."
    />
  );
}
