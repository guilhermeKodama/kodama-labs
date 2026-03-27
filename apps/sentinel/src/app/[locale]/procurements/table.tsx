"use client";

import { DataTable, type ColumnDef } from "@/components/data-table";
import { formatCurrency, formatCnpj, stripHtml } from "@/lib/utils";
import Link from "next/link";

interface ProcurementRow {
  id: string;
  orgName: string;
  orgCnpj: string;
  modality: string;
  description: string;
  legalBasis: string | null;
  estimatedValue: number | null;
  approvedValue: number | null;
  status: string | null;
  state: string | null;
  publishedAt: string;
  itemCount: number;
  alertCount: number;
  contractCount: number;
}

export function ProcurementsTable({
  data,
  locale,
  totalCount,
  nextCursor,
  prevCursor,
  filterOptions,
}: {
  data: ProcurementRow[];
  locale: string;
  totalCount: number;
  nextCursor: string | null;
  prevCursor: string | null;
  filterOptions: {
    modality: { label: string; value: string }[];
    status: { label: string; value: string }[];
    state: { label: string; value: string }[];
  };
}) {
  const columns: ColumnDef<ProcurementRow>[] = [
    {
      id: "orgName",
      header: "Órgão",
      width: "w-[18%]",
      accessorFn: (row) => `${row.orgName} ${row.orgCnpj}`,
      cell: (row) => (
        <div>
          <div className="font-medium truncate">{row.orgName}</div>
          <div className="text-[11px] text-muted-foreground">{formatCnpj(row.orgCnpj)}</div>
        </div>
      ),
    },
    {
      id: "modality",
      header: "Modalidade",
      width: "w-[10%]",
      accessorFn: (row) => row.modality,
      filterable: true,
      filterKey: "modality",
      filterOptions: filterOptions.modality,
      cell: (row) => <span className="text-xs">{row.modality}</span>,
    },
    {
      id: "description",
      header: "Objeto",
      width: "w-[22%]",
      accessorFn: (row) => row.description,
      cell: (row) => (
        <Link href={`/${locale}/procurements/${row.id}`} className="hover:underline">
          <div className="truncate">{stripHtml(row.description)}</div>
          {row.legalBasis && (
            <div className="text-[11px] text-muted-foreground truncate">{row.legalBasis}</div>
          )}
        </Link>
      ),
    },
    {
      id: "estimatedValue",
      header: "Estimado",
      width: "w-[10%]",
      accessorFn: (row) => row.estimatedValue,
      align: "right",
      cell: (row) => (
        <span className="tabular-nums text-xs">{row.estimatedValue != null ? formatCurrency(row.estimatedValue) : "-"}</span>
      ),
    },
    {
      id: "approvedValue",
      header: "Homologado",
      width: "w-[10%]",
      accessorFn: (row) => row.approvedValue,
      align: "right",
      cell: (row) => (
        <span className="tabular-nums text-xs font-medium">{row.approvedValue != null ? formatCurrency(row.approvedValue) : "-"}</span>
      ),
    },
    {
      id: "itemCount",
      header: "Itens",
      width: "w-[5%]",
      accessorFn: (row) => row.itemCount,
      align: "center",
      cell: (row) => <span className="text-muted-foreground text-xs">{row.itemCount}</span>,
    },
    {
      id: "status",
      header: "Situação",
      width: "w-[10%]",
      accessorFn: (row) => row.status,
      filterable: true,
      filterKey: "status",
      filterOptions: filterOptions.status,
      cell: (row) =>
        row.status ? (
          <span className="text-[11px] px-1.5 py-0.5 rounded bg-muted truncate block">{row.status}</span>
        ) : null,
    },
    {
      id: "state",
      header: "UF",
      width: "w-[5%]",
      accessorFn: (row) => row.state,
      filterable: true,
      filterKey: "state",
      filterOptions: filterOptions.state,
      cell: (row) => <span className="text-muted-foreground text-xs">{row.state ?? "-"}</span>,
    },
    {
      id: "publishedAt",
      header: "Data",
      width: "w-[8%]",
      accessorFn: (row) => row.publishedAt,
      cell: (row) => (
        <span className="text-muted-foreground text-[11px]">
          {new Date(row.publishedAt).toLocaleDateString("pt-BR")}
        </span>
      ),
    },
  ];

  return (
    <DataTable
      data={data}
      columns={columns}
      searchPlaceholder="Pesquisar órgão, CNPJ, objeto..."
      emptyMessage="Nenhuma licitação encontrada."
      totalCount={totalCount}
      basePath={`/${locale}/procurements`}
      nextCursor={nextCursor}
      prevCursor={prevCursor}
    />
  );
}
