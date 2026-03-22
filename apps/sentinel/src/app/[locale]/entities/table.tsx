"use client";

import { DataTable, type ColumnDef } from "@/components/data-table";
import { formatCurrency, formatCnpj } from "@/lib/utils";
import Link from "next/link";

interface EntityRow {
  id: string;
  name: string;
  cnpj: string;
  legalNature: string | null;
  state: string | null;
  city: string | null;
  capital: number | null;
  activityDesc: string | null;
  contractCount: number;
  shareholderCount: number;
  sanctionCount: number;
  alertCount: number;
  riskScore: number | null;
  isShellCompany: boolean;
}

export function EntitiesTable({ data, locale }: { data: EntityRow[]; locale: string }) {
  const columns: ColumnDef<EntityRow>[] = [
    {
      id: "name",
      header: "Empresa",
      width: "w-[25%]",
      accessorFn: (row) => `${row.name} ${row.cnpj} ${row.activityDesc ?? ""}`,
      cell: (row) => (
        <Link href={`/${locale}/entities/${row.id}`} className="hover:underline">
          <div className="font-medium truncate">{row.name}</div>
          <div className="text-[11px] text-muted-foreground">{formatCnpj(row.cnpj)}</div>
        </Link>
      ),
    },
    {
      id: "legalNature",
      header: "Natureza",
      width: "w-[15%]",
      accessorFn: (row) => row.legalNature,
      filterable: true,
      cell: (row) =>
        row.legalNature ? (
          <span className="text-[11px] text-muted-foreground truncate block">{row.legalNature}</span>
        ) : (
          <span className="text-muted-foreground">-</span>
        ),
    },
    {
      id: "state",
      header: "UF",
      width: "w-[5%]",
      accessorFn: (row) => row.state,
      filterable: true,
      cell: (row) => <span className="text-muted-foreground text-xs">{row.state ?? "-"}</span>,
    },
    {
      id: "capital",
      header: "Capital",
      width: "w-[12%]",
      accessorFn: (row) => row.capital,
      align: "right",
      filterable: true,
      filterType: "range",
      cell: (row) => (
        <span className="tabular-nums text-xs">{row.capital != null ? formatCurrency(row.capital) : "-"}</span>
      ),
    },
    {
      id: "contractCount",
      header: "Contr.",
      width: "w-[6%]",
      accessorFn: (row) => row.contractCount,
      align: "center",
      cell: (row) => <span className="text-xs">{row.contractCount}</span>,
    },
    {
      id: "sanctionCount",
      header: "Sanções",
      width: "w-[7%]",
      accessorFn: (row) => row.sanctionCount,
      align: "center",
      cell: (row) =>
        row.sanctionCount > 0 ? (
          <span className="px-1.5 py-0.5 rounded bg-destructive/20 text-destructive text-[11px] font-medium">{row.sanctionCount}</span>
        ) : null,
    },
    {
      id: "alertCount",
      header: "Alertas",
      width: "w-[6%]",
      accessorFn: (row) => row.alertCount,
      align: "center",
      cell: (row) =>
        row.alertCount > 0 ? (
          <span className="text-[11px] px-1.5 py-0.5 rounded bg-orange-500/20 text-orange-500 font-medium">{row.alertCount}</span>
        ) : null,
    },
    {
      id: "riskScore",
      header: "Risco",
      width: "w-[7%]",
      accessorFn: (row) => row.riskScore,
      align: "center",
      cell: (row) =>
        row.riskScore != null ? (
          <span className={`px-1.5 py-0.5 rounded text-[11px] font-medium ${
            row.riskScore >= 0.7
              ? "bg-red-500/20 text-red-500"
              : row.riskScore >= 0.4
                ? "bg-yellow-500/20 text-yellow-500"
                : "bg-green-500/20 text-green-500"
          }`}>
            {(row.riskScore * 100).toFixed(0)}%
          </span>
        ) : (
          <span className="text-muted-foreground text-xs">-</span>
        ),
    },
    {
      id: "isShellCompany",
      header: "Fachada",
      width: "w-[6%]",
      accessorFn: (row) => row.isShellCompany ? "SIM" : "",
      align: "center",
      filterable: true,
      filterOptions: [
        { label: "Sim — possível fachada", value: "SIM" },
        { label: "Não", value: "" },
      ],
      cell: (row) =>
        row.isShellCompany ? (
          <span className="px-1.5 py-0.5 rounded bg-red-500/20 text-red-500 text-[11px] font-medium">SIM</span>
        ) : null,
    },
  ];

  return (
    <DataTable
      data={data}
      columns={columns}
      searchPlaceholder="Pesquisar empresa, CNPJ, atividade, UF..."
      emptyMessage="Nenhuma entidade encontrada. Execute o pipeline para começar."
    />
  );
}
