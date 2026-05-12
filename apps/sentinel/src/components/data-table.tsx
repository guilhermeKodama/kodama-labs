"use client";

import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
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
  /** Server-side filter key used in URL params (defaults to column id) */
  filterKey?: string;
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
  totalCount?: number;
  basePath?: string;
  nextCursor?: string | null;
  prevCursor?: string | null;
}

export function DataTable<T extends { id: string }>({
  data,
  columns,
  pageSize: defaultPageSize = 25,
  searchPlaceholder = "Pesquisar em todos os campos...",
  emptyMessage = "Nenhum registro encontrado.",
  totalCount,
  basePath,
  nextCursor,
  prevCursor,
}: DataTableProps<T>) {
  const isServer = basePath != null && totalCount != null;
  const router = useRouter();
  const searchParams = useSearchParams();

  const serverSearch = isServer ? (searchParams.get("search") ?? "") : "";
  const serverFilters = useMemo(() => {
    if (!isServer) return {};
    const f: Record<string, string> = {};
    for (const col of columns) {
      if (!col.filterable) continue;
      const key = col.filterKey ?? col.id;
      const val = searchParams.get(key);
      if (val) f[key] = val;
    }
    return f;
  }, [isServer, columns, searchParams]);

  const [localSearch, setLocalSearch] = useState("");
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>(null);
  const [localFilters, setLocalFilters] = useState<Record<string, Set<string>>>({});
  const [rangeFilters, setRangeFilters] = useState<Record<string, { min: string; max: string }>>({});
  const [page, setPage] = useState(0);
  const [pageSize] = useState(defaultPageSize);

  const searchValue = isServer ? serverSearch : localSearch;

  const buildServerUrl = useCallback(
    (overrides: Record<string, string | null> = {}) => {
      if (!basePath) return "";
      const params = new URLSearchParams();
      const currentSearch = overrides.search !== undefined
        ? overrides.search
        : searchParams.get("search");
      if (currentSearch) params.set("search", currentSearch);

      for (const col of columns) {
        if (!col.filterable) continue;
        const key = col.filterKey ?? col.id;
        const val = overrides[key] !== undefined
          ? overrides[key]
          : searchParams.get(key);
        if (val) params.set(key, val);
      }

      if (overrides.cursor) params.set("cursor", overrides.cursor);
      if (overrides.dir) params.set("dir", overrides.dir);

      const qs = params.toString();
      return qs ? `${basePath}?${qs}` : basePath;
    },
    [basePath, columns, searchParams],
  );

  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [searchDraft, setSearchDraft] = useState(serverSearch);

  useEffect(() => {
    setSearchDraft(serverSearch);
  }, [serverSearch]);

  const handleSearchChange = useCallback(
    (value: string) => {
      if (isServer) {
        setSearchDraft(value);
        if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
        searchTimerRef.current = setTimeout(() => {
          router.push(buildServerUrl({ search: value || null, cursor: null, dir: null }));
        }, 400);
      } else {
        setLocalSearch(value);
        setPage(0);
      }
    },
    [isServer, router, buildServerUrl],
  );

  const handleFilterToggle = useCallback(
    (colId: string, value: string) => {
      if (isServer) {
        const key = columns.find((c) => c.id === colId)?.filterKey ?? colId;
        const current = searchParams.get(key);
        const next = current === value ? null : value;
        router.push(buildServerUrl({ [key]: next, cursor: null, dir: null }));
      } else {
        setLocalFilters((prev) => {
          const existing = new Set(prev[colId] ?? []);
          if (existing.has(value)) existing.delete(value);
          else existing.add(value);
          const next = { ...prev };
          if (existing.size === 0) delete next[colId];
          else next[colId] = existing;
          return next;
        });
        setPage(0);
      }
    },
    [isServer, columns, searchParams, router, buildServerUrl],
  );

  const handleFilterClear = useCallback(
    (colId: string) => {
      if (isServer) {
        const key = columns.find((c) => c.id === colId)?.filterKey ?? colId;
        router.push(buildServerUrl({ [key]: null, cursor: null, dir: null }));
      } else {
        setLocalFilters((prev) => { const n = { ...prev }; delete n[colId]; return n; });
        setRangeFilters((prev) => { const n = { ...prev }; delete n[colId]; return n; });
        setPage(0);
      }
    },
    [isServer, columns, router, buildServerUrl],
  );

  const handleClearAll = useCallback(() => {
    if (isServer) {
      router.push(basePath!);
    } else {
      setLocalFilters({});
      setRangeFilters({});
      setLocalSearch("");
      setPage(0);
    }
  }, [isServer, router, basePath]);

  const updateRange = useCallback((colId: string, field: "min" | "max", value: string) => {
    setRangeFilters((prev) => ({
      ...prev,
      [colId]: { ...(prev[colId] ?? { min: "", max: "" }), [field]: value },
    }));
    setPage(0);
  }, []);

  const searchableColumns = useMemo(
    () => columns.filter((c) => c.searchable !== false),
    [columns],
  );

  const toggleSort = useCallback((colId: string) => {
    setSortColumn((prev) => {
      if (prev !== colId) { setSortDirection("asc"); return colId; }
      setSortDirection((d) => (d === "asc" ? "desc" : d === "desc" ? null : "asc"));
      return prev;
    });
    setPage(0);
  }, []);

  const filteredData = useMemo(() => {
    if (isServer) return data;

    let result = data;
    if (localSearch.trim()) {
      const terms = localSearch.toLowerCase().split(/\s+/).filter(Boolean);
      result = result.filter((row) => {
        const rowText = searchableColumns
          .map((c) => { const v = c.accessorFn(row); return v != null ? String(v).toLowerCase() : ""; })
          .join(" ");
        return terms.every((t) => rowText.includes(t));
      });
    }
    for (const [colId, selectedValues] of Object.entries(localFilters)) {
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
          if (!isNaN(aNum) && !isNaN(bNum)) return sortDirection === "asc" ? aNum - bNum : bNum - aNum;
          const cmp = String(aVal).localeCompare(String(bVal), "pt-BR");
          return sortDirection === "asc" ? cmp : -cmp;
        });
      }
    }
    return result;
  }, [data, localSearch, localFilters, rangeFilters, sortColumn, sortDirection, columns, searchableColumns, isServer]);

  const effectiveTotal = isServer ? totalCount : filteredData.length;
  const totalPages = isServer ? 0 : Math.ceil(effectiveTotal / pageSize);
  const pagedData = isServer ? data : filteredData.slice(page * pageSize, (page + 1) * pageSize);

  const activeFilterCount = isServer
    ? Object.keys(serverFilters).length
    : Object.keys(localFilters).length + Object.values(rangeFilters).filter((r) => r.min || r.max).length;
  const hasActiveFilters = activeFilterCount > 0 || searchValue.trim() !== "";

  const getActiveValues = (colId: string): Set<string> | undefined => {
    if (isServer) {
      const key = columns.find((c) => c.id === colId)?.filterKey ?? colId;
      const val = serverFilters[key];
      return val ? new Set([val]) : undefined;
    }
    return localFilters[colId];
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[300px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={isServer ? searchDraft : localSearch}
            onChange={(e) => handleSearchChange(e.target.value)}
            placeholder={searchPlaceholder}
            className="pl-9 h-10"
          />
          {searchValue && (
            <button
              onClick={() => handleSearchChange("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {columns.filter((c) => c.filterable).map((col) => (
          <ColumnFilter
            key={col.id}
            column={col}
            data={data}
            activeValues={getActiveValues(col.id)}
            rangeValue={rangeFilters[col.id]}
            onToggle={(value) => handleFilterToggle(col.id, value)}
            onRangeChange={(field, value) => updateRange(col.id, field, value)}
            onClear={() => handleFilterClear(col.id)}
          />
        ))}

        {hasActiveFilters && (
          <Button variant="ghost" size="sm" onClick={handleClearAll} className="h-10 text-muted-foreground">
            <X className="h-3.5 w-3.5 mr-1" />
            Limpar
          </Button>
        )}
      </div>

      {hasActiveFilters && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {effectiveTotal.toLocaleString("pt-BR")} registros
          </span>
          {isServer
            ? Object.entries(serverFilters).map(([key, val]) => {
                const col = columns.find((c) => (c.filterKey ?? c.id) === key);
                return (
                  <Badge key={key} variant="secondary" className="gap-1 text-xs">
                    {col?.header ?? key}: {val}
                    <button onClick={() => handleFilterClear(col?.id ?? key)}>
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                );
              })
            : Object.entries(localFilters).map(([colId, values]) => {
                const col = columns.find((c) => c.id === colId);
                return Array.from(values).map((v) => (
                  <Badge key={`${colId}-${v}`} variant="secondary" className="gap-1 text-xs">
                    {col?.header}: {v || "(vazio)"}
                    <button onClick={() => handleFilterToggle(colId, v)}>
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
                <button onClick={() => handleFilterClear(colId)}>
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            );
          })}
        </div>
      )}

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
                      !isServer && col.sortable !== false && "cursor-pointer select-none hover:bg-muted/70 transition-colors",
                      col.width,
                    )}
                    onClick={!isServer && col.sortable !== false ? () => toggleSort(col.id) : undefined}
                  >
                    <div className={cn(
                      "flex items-center gap-1",
                      col.align === "right" ? "justify-end" : col.align === "center" ? "justify-center" : "justify-start",
                    )}>
                      {col.header}
                      {!isServer && col.sortable !== false && (
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
                    {hasActiveFilters
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
                          col.align === "right" ? "text-right" : col.align === "center" ? "text-center" : "text-left",
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

      {effectiveTotal > 0 && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">
            {data.length > 0
              ? `Mostrando ${data.length} de ${effectiveTotal.toLocaleString("pt-BR")} registros`
              : `${effectiveTotal.toLocaleString("pt-BR")} registros`}
          </span>

          {isServer ? (
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={!prevCursor}
                onClick={() => router.push(buildServerUrl({ cursor: prevCursor!, dir: "prev" }))}
                className="h-8 gap-1"
              >
                <ChevronLeft className="h-4 w-4" />
                Anterior
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={!nextCursor}
                onClick={() => router.push(buildServerUrl({ cursor: nextCursor!, dir: "next" }))}
                className="h-8 gap-1"
              >
                Próximo
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          ) : (
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
                if (totalPages <= 7) pageNum = i;
                else if (page < 3) pageNum = i;
                else if (page > totalPages - 4) pageNum = totalPages - 7 + i;
                else pageNum = page - 3 + i;
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
          )}
        </div>
      )}
    </div>
  );
}

function SortIndicator({ active, direction }: { active: boolean; direction: SortDirection }) {
  if (!active || !direction) return <ChevronsUpDown className="h-3.5 w-3.5 text-muted-foreground/50" />;
  return direction === "asc" ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />;
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
                    activeValues?.has(opt.value) ? "bg-primary border-primary text-primary-foreground" : "opacity-50",
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
