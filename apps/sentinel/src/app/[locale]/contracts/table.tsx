"use client";

import { DataTable, type ColumnDef } from "@/components/data-table";
import { formatCurrency, formatCnpj, stripHtml } from "@/lib/utils";
import Link from "next/link";

interface ContractRow {
  id: string;
  supplierName: string;
  supplierCnpj: string;
  supplierType: string | null;
  orgName: string | null;
  unitState: string | null;
  objectDescription: string;
  contractType: string | null;
  value: number;
  amendmentCount: number;
  sanctionCount: number;
  alertCount: number;
  startDate: string;
  endDate: string | null;
  entityId: string | null;
}

export function ContractsTable({
  data,
  locale,
  totalCount,
  nextCursor,
  prevCursor,
  filterOptions,
}: {
  data: ContractRow[];
  locale: string;
  totalCount: number;
  nextCursor: string | null;
  prevCursor: string | null;
  filterOptions: {
    contractType: { label: string; value: string }[];
    state: { label: string; value: string }[];
  };
}) {
  const columns: ColumnDef<ContractRow>[] = [
    {
      id: "supplier",
      header: "Fornecedor",
      width: "w-[20%]",
      accessorFn: (row) => `${row.supplierName} ${row.supplierCnpj}`,
      cell: (row) => (
        <div>
          <div className="flex items-center gap-1">
            <Link href={`/${locale}/contracts/${row.id}`} className="hover:underline font-medium truncate">
              {row.supplierName}
            </Link>
            {row.entityId && (
              <Link
                href={`/${locale}/entities/${row.entityId}`}
                className="text-[10px] px-1 py-0.5 rounded bg-blue-500/10 text-blue-600 hover:bg-blue-500/20 transition-colors flex-shrink-0"
              >
                →
              </Link>
            )}
          </div>
          <div className="text-[11px] text-muted-foreground">{formatCnpj(row.supplierCnpj)}</div>
        </div>
      ),
    },
    {
      id: "object",
      header: "Objeto",
      width: "w-[25%]",
      accessorFn: (row) => row.objectDescription,
      cell: (row) => (
        <Link href={`/${locale}/contracts/${row.id}`} className="hover:underline">
          <div className="truncate">{stripHtml(row.objectDescription)}</div>
        </Link>
      ),
    },
    {
      id: "contractType",
      header: "Tipo",
      width: "w-[10%]",
      accessorFn: (row) => row.contractType,
      filterable: true,
      filterKey: "contractType",
      filterOptions: filterOptions.contractType,
      cell: (row) =>
        row.contractType ? (
          <span className="text-[11px] px-1.5 py-0.5 rounded bg-muted truncate block">{row.contractType}</span>
        ) : null,
    },
    {
      id: "value",
      header: "Valor",
      width: "w-[12%]",
      accessorFn: (row) => row.value,
      align: "right",
      cell: (row) => (
        <span className="tabular-nums font-medium text-xs">{formatCurrency(row.value)}</span>
      ),
    },
    {
      id: "amendmentCount",
      header: "Adit.",
      width: "w-[5%]",
      accessorFn: (row) => row.amendmentCount,
      align: "center",
      cell: (row) =>
        row.amendmentCount > 0 ? (
          <span className="text-[11px] px-1.5 py-0.5 rounded bg-yellow-500/20 text-yellow-600 font-medium">{row.amendmentCount}</span>
        ) : (
          <span className="text-muted-foreground text-xs">0</span>
        ),
    },
    {
      id: "sanctionCount",
      header: "Sanções",
      width: "w-[7%]",
      accessorFn: (row) => row.sanctionCount,
      align: "center",
      cell: (row) =>
        row.sanctionCount > 0 ? (
          <span className="text-[11px] px-1.5 py-0.5 rounded bg-red-500/20 text-red-600 font-medium">{row.sanctionCount}</span>
        ) : (
          <span className="text-muted-foreground text-xs">0</span>
        ),
    },
    {
      id: "state",
      header: "UF",
      width: "w-[5%]",
      accessorFn: (row) => row.unitState,
      filterable: true,
      filterKey: "state",
      filterOptions: filterOptions.state,
      cell: (row) => <span className="text-muted-foreground text-xs">{row.unitState ?? "-"}</span>,
    },
    {
      id: "startDate",
      header: "Vigência",
      width: "w-[10%]",
      accessorFn: (row) => row.startDate,
      cell: (row) => (
        <div className="text-muted-foreground text-[11px]">
          <div>{new Date(row.startDate).toLocaleDateString("pt-BR")}</div>
          {row.endDate && <div>{new Date(row.endDate).toLocaleDateString("pt-BR")}</div>}
        </div>
      ),
    },
    {
      id: "alertCount",
      header: "Alertas",
      width: "w-[6%]",
      accessorFn: (row) => row.alertCount,
      align: "center",
      cell: (row) =>
        row.alertCount > 0 ? (
          <span className="text-[11px] px-1.5 py-0.5 rounded bg-red-500/20 text-red-500 font-medium">{row.alertCount}</span>
        ) : null,
    },
  ];

  return (
    <DataTable
      data={data}
      columns={columns}
      searchPlaceholder="Pesquisar fornecedor, CNPJ, órgão, objeto..."
      emptyMessage="Nenhum contrato encontrado."
      totalCount={totalCount}
      basePath={`/${locale}/contracts`}
      nextCursor={nextCursor}
      prevCursor={prevCursor}
    />
  );
}
