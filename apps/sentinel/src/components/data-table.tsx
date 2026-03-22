"use client";

import { useState, useMemo, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Search,
  ChevronUp,
  ChevronDown,
  ChevronsUpDown,
  X,
  Filter,
  ChevronLeft,
  ChevronRight,
  Check,
} from "lucide-react";
import { cn } from "@/lib/utils";

export type SortDirection = "asc" | "desc" | null;

export interface ColumnDef<T> {
  id: string;
  header: string;
  accessorFn: (row: T) => string | number | null | undefined;
  cell: (row: T) => React.ReactNode;
  sortable?: boolean;
  filterable?: boolean;
  filterType?: "select" | "range" | "boolean";
  filterOptions?: { label: string; value: string }[];
  align?: "left" | "center" | "right";
  searchable?: boolean;
  width?: string;
}

interface DataTableProps<T> {
  data: T[];
  columns: ColumnDef<T>[];
  pageSize?: number;
  searchPlaceholder?: string;
  emptyMessage?: string;
}

export function DataTable<T extends { id: string }>({
  data,
  columns,
  pageSize: defaultPageSize = 25,
  searchPlaceholder = "Pesquisar em todos os campos...",
  emptyMessage = "Nenhum registro encontrado.",
}: DataTableProps<T>) {
  const [search, setSearch] = useState("");
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>(null);
  const [filters, setFilters] = useState<Record<string, Set<string>>>({});
  const [rangeFilters, setRangeFilters] = useState<Record<string, { min: string; max: string }>>({});
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(defaultPageSize);

  const searchableColumns = useMemo(
    () => columns.filter((c) => c.searchable !== false),
    [columns]
  );

  const toggleSort = useCallback((colId: string) => {
    setSortColumn((prev) => {
      if (prev !== colId) {
        setSortDirection("asc");
        return colId;
      }
      setSortDirection((d) => {
        if (d === "asc") return "desc";
        if (d === "desc") return null;
        return "asc";
      });
      return prev;
    });
    setPage(0);
  }, []);

  const toggleFilter = useCallback((colId: string, value: string) => {
    setFilters((prev) => {
      const existing = new Set(prev[colId] ?? []);
      if (existing.has(value)) {
        existing.delete(value);
      } else {
        existing.add(value);
      }
      const next = { ...prev };
      if (existing.size === 0) {
        delete next[colId];
      } else {
        next[colId] = existing;
      }
      return next;
    });
    setPage(0);
  }, []);

  const clearFilter = useCallback((colId: string) => {
    setFilters((prev) => {
      const next = { ...prev };
      delete next[colId];
      return next;
    });
    setRangeFilters((prev) => {
      const next = { ...prev };
      delete next[colId];
      return next;
    });
    setPage(0);
  }, []);

  const clearAllFilters = useCallback(() => {
    setFilters({});
    setRangeFilters({});
    setSearch("");
    setPage(0);
  }, []);

  const updateRange = useCallback((colId: string, field: "min" | "max", value: string) => {
    setRangeFilters((prev) => ({
      ...prev,
      [colId]: { ...prev[colId] ?? { min: "", max: "" }, [field]: value },
    }));
    setPage(0);
  }, []);

  const filteredData = useMemo(() => {
    let result = data;

    if (search.trim()) {
      const terms = search.toLowerCase().split(/\s+/).filter(Boolean);
      result = result.filter((row) => {
        const rowText = searchableColumns
          .map((c) => {
            const val = c.accessorFn(row);
            return val != null ? String(val).toLowerCase() : "";
          })
          .join(" ");
        return terms.every((term) => rowText.includes(term));
      });
    }

    for (const [colId, selectedValues] of Object.entries(filters)) {
      if (selectedValues.size === 0) continue;
      const col = columns.find((c) => c.id === colId);
      if (!col) continue;
      result = result.filter((row) => {
        const val = col.accessorFn(row);
        return selectedValues.has(val != null ? String(val) : "");
      });
    }

    for (const [colId, range] of Object.entries(rangeFilters)) {
      const col = columns.find((c) => c.id === colId);
      if (!col) continue;
      const minVal = range.min ? parseFloat(range.min) : null;
      const maxVal = range.max ? parseFloat(range.max) : null;
      if (minVal == null && maxVal == null) continue;
      result = result.filter((row) => {
        const val = col.accessorFn(row);
        if (val == null) return false;
        const numVal = typeof val === "number" ? val : parseFloat(String(val));
        if (isNaN(numVal)) return false;
        if (minVal != null && numVal < minVal) return false;
        if (maxVal != null && numVal > maxVal) return false;
        return true;
      });
    }

    if (sortColumn && sortDirection) {
      const col = columns.find((c) => c.id === sortColumn);
      if (col) {
        result = [...result].sort((a, b) => {
          const aVal = col.accessorFn(a);
          const bVal = col.accessorFn(b);
          if (aVal == null && bVal == null) return 0;
          if (aVal == null) return 1;
          if (bVal == null) return -1;
          const aNum = typeof aVal === "number" ? aVal : parseFloat(String(aVal));
          const bNum = typeof bVal === "number" ? bVal : parseFloat(String(bVal));
          if (!isNaN(aNum) && !isNaN(bNum)) {
            return sortDirection === "asc" ? aNum - bNum : bNum - aNum;
          }
          const cmp = String(aVal).localeCompare(String(bVal), "pt-BR");
          return sortDirection === "asc" ? cmp : -cmp;
        });
      }
    }

    return result;
  }, [data, search, filters, rangeFilters, sortColumn, sortDirection, columns, searchableColumns]);

  const totalPages = Math.ceil(filteredData.length / pageSize);
  const pagedData = filteredData.slice(page * pageSize, (page + 1) * pageSize);

  const activeFilterCount = Object.keys(filters).length + Object.values(rangeFilters).filter((r) => r.min || r.max).length;
  const hasActiveFilters = activeFilterCount > 0 || search.trim() !== "";

  return (
    <div className="space-y-4">
      {/* Search + filter bar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[300px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            placeholder={searchPlaceholder}
            className="pl-9 h-10"
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* Column filters */}
        {columns
          .filter((c) => c.filterable)
          .map((col) => (
            <ColumnFilter
              key={col.id}
              column={col}
              data={data}
              activeValues={filters[col.id]}
              rangeValue={rangeFilters[col.id]}
              onToggle={(value) => toggleFilter(col.id, value)}
              onRangeChange={(field, value) => updateRange(col.id, field, value)}
              onClear={() => clearFilter(col.id)}
            />
          ))}

        {hasActiveFilters && (
          <Button variant="ghost" size="sm" onClick={clearAllFilters} className="h-10 text-muted-foreground">
            <X className="h-3.5 w-3.5 mr-1" />
            Limpar
          </Button>
        )}
      </div>

      {/* Active filter badges */}
      {hasActiveFilters && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {filteredData.length} de {data.length} registros
          </span>
          {Object.entries(filters).map(([colId, values]) => {
            const col = columns.find((c) => c.id === colId);
            return Array.from(values).map((v) => (
              <Badge key={`${colId}-${v}`} variant="secondary" className="gap-1 text-xs">
                {col?.header}: {v || "(vazio)"}
                <button onClick={() => toggleFilter(colId, v)}>
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ));
          })}
          {Object.entries(rangeFilters).map(([colId, range]) => {
            if (!range.min && !range.max) return null;
            const col = columns.find((c) => c.id === colId);
            return (
              <Badge key={colId} variant="secondary" className="gap-1 text-xs">
                {col?.header}: {range.min || "0"} – {range.max || "∞"}
                <button onClick={() => clearFilter(colId)}>
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            );
          })}
        </div>
      )}

      {/* Table */}
      <div className="rounded-lg border bg-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm table-fixed">
            <thead>
              <tr className="border-b bg-muted/50">
                {columns.map((col) => (
                  <th
                    key={col.id}
                    className={cn(
                      "p-3 font-medium",
                      col.align === "right" ? "text-right" : col.align === "center" ? "text-center" : "text-left",
                      col.sortable !== false && "cursor-pointer select-none hover:bg-muted/70 transition-colors",
                      col.width
                    )}
                    onClick={col.sortable !== false ? () => toggleSort(col.id) : undefined}
                  >
                    <div className={cn(
                      "flex items-center gap-1",
                      col.align === "right" ? "justify-end" : col.align === "center" ? "justify-center" : "justify-start"
                    )}>
                      {col.header}
                      {col.sortable !== false && (
                        <SortIndicator active={sortColumn === col.id} direction={sortColumn === col.id ? sortDirection : null} />
                      )}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pagedData.length === 0 ? (
                <tr>
                  <td colSpan={columns.length} className="p-12 text-center text-muted-foreground">
                    {search || activeFilterCount > 0
                      ? "Nenhum registro corresponde aos filtros aplicados."
                      : emptyMessage}
                  </td>
                </tr>
              ) : (
                pagedData.map((row) => (
                  <tr key={row.id} className="border-b hover:bg-muted/30 transition-colors">
                    {columns.map((col) => (
                      <td
                        key={col.id}
                        className={cn(
                          "p-3",
                          col.align === "right" ? "text-right" : col.align === "center" ? "text-center" : "text-left"
                        )}
                      >
                        {col.cell(row)}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      {filteredData.length > 0 && (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span>Mostrando {page * pageSize + 1}–{Math.min((page + 1) * pageSize, filteredData.length)} de {filteredData.length}</span>
            <select
              value={pageSize}
              onChange={(e) => { setPageSize(Number(e.target.value)); setPage(0); }}
              className="bg-transparent border rounded px-2 py-1 text-xs"
            >
              {[25, 50, 100, 200].map((n) => (
                <option key={n} value={n}>{n} por página</option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="h-8 w-8 p-0"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
              let pageNum: number;
              if (totalPages <= 7) {
                pageNum = i;
              } else if (page < 3) {
                pageNum = i;
              } else if (page > totalPages - 4) {
                pageNum = totalPages - 7 + i;
              } else {
                pageNum = page - 3 + i;
              }
              return (
                <Button
                  key={pageNum}
                  variant={page === pageNum ? "default" : "outline"}
                  size="sm"
                  onClick={() => setPage(pageNum)}
                  className="h-8 w-8 p-0 text-xs"
                >
                  {pageNum + 1}
                </Button>
              );
            })}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
              className="h-8 w-8 p-0"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function SortIndicator({ active, direction }: { active: boolean; direction: SortDirection }) {
  if (!active || !direction) {
    return <ChevronsUpDown className="h-3.5 w-3.5 text-muted-foreground/50" />;
  }
  return direction === "asc"
    ? <ChevronUp className="h-3.5 w-3.5" />
    : <ChevronDown className="h-3.5 w-3.5" />;
}

function ColumnFilter<T>({
  column,
  data,
  activeValues,
  rangeValue,
  onToggle,
  onRangeChange,
  onClear,
}: {
  column: ColumnDef<T>;
  data: T[];
  activeValues?: Set<string>;
  rangeValue?: { min: string; max: string };
  onToggle: (value: string) => void;
  onRangeChange: (field: "min" | "max", value: string) => void;
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  const isActive = (activeValues && activeValues.size > 0) || (rangeValue && (rangeValue.min || rangeValue.max));

  if (column.filterType === "range") {
    return (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className={cn("h-10 gap-1", isActive && "border-primary text-primary")}>
            <Filter className="h-3.5 w-3.5" />
            {column.header}
            {isActive && <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-[10px]">1</Badge>}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-64 p-4" align="start">
          <div className="space-y-3">
            <p className="text-sm font-medium">{column.header}</p>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-muted-foreground">Mínimo</label>
                <Input
                  type="number"
                  value={rangeValue?.min ?? ""}
                  onChange={(e) => onRangeChange("min", e.target.value)}
                  placeholder="0"
                  className="h-8 text-xs"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Máximo</label>
                <Input
                  type="number"
                  value={rangeValue?.max ?? ""}
                  onChange={(e) => onRangeChange("max", e.target.value)}
                  placeholder="∞"
                  className="h-8 text-xs"
                />
              </div>
            </div>
            {isActive && (
              <Button variant="ghost" size="sm" onClick={onClear} className="w-full text-xs">
                Limpar filtro
              </Button>
            )}
          </div>
        </PopoverContent>
      </Popover>
    );
  }

  const options = column.filterOptions ??
    [...new Set(data.map((row) => {
      const v = column.accessorFn(row);
      return v != null ? String(v) : "";
    }))]
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b, "pt-BR"))
      .map((v) => ({ label: v, value: v }));

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className={cn("h-10 gap-1", isActive && "border-primary text-primary")}>
          <Filter className="h-3.5 w-3.5" />
          {column.header}
          {activeValues && activeValues.size > 0 && (
            <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-[10px]">{activeValues.size}</Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start">
        <Command>
          <CommandInput placeholder={`Filtrar ${column.header.toLowerCase()}...`} />
          <CommandList>
            <CommandEmpty>Nenhum resultado.</CommandEmpty>
            <CommandGroup>
              {options.map((opt) => (
                <CommandItem
                  key={opt.value}
                  onSelect={() => onToggle(opt.value)}
                  className="cursor-pointer"
                >
                  <div className={cn(
                    "mr-2 flex h-4 w-4 items-center justify-center rounded-sm border",
                    activeValues?.has(opt.value) ? "bg-primary border-primary text-primary-foreground" : "opacity-50"
                  )}>
                    {activeValues?.has(opt.value) && <Check className="h-3 w-3" />}
                  </div>
                  <span className="text-sm truncate">{opt.label}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
          {activeValues && activeValues.size > 0 && (
            <div className="border-t p-2">
              <Button variant="ghost" size="sm" onClick={onClear} className="w-full text-xs">
                Limpar filtro
              </Button>
            </div>
          )}
        </Command>
      </PopoverContent>
    </Popover>
  );
}
