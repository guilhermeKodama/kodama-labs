"use client";

import { useState, useMemo } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Search, X, ExternalLink, ChevronLeft, ChevronRight } from "lucide-react";
import { cn, formatDate, type AppLocale } from "@/lib/utils";
import { extractAlertI18n, renderAlertText } from "@/lib/alert-render";

interface AlertRow {
  id: string;
  type: string;
  severity: string;
  title: string;
  description: string;
  data: Record<string, unknown> | null;
  createdAt: string;
  resolved: boolean;
  entityId: string | null;
  entityName: string | null;
  entityCnpj: string | null;
  entityState: string | null;
  procurementId: string | null;
  procurementOrgName: string | null;
  procurementState: string | null;
  procurementModality: string | null;
  state: string | null;
}

interface Props {
  data: AlertRow[];
  locale: string;
  severityCounts: Record<string, number>;
}

const SEVERITY_ORDER = ["CRITICAL", "HIGH", "MEDIUM", "LOW"] as const;
const SEVERITY_RANK: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };

const SEVERITY_STYLES: Record<string, { dot: string; card: string; badge: string }> = {
  CRITICAL: {
    dot: "bg-red-500",
    card: "border-red-500/50 text-red-500",
    badge: "bg-red-500/15 text-red-500 border-red-500/30",
  },
  HIGH: {
    dot: "bg-orange-500",
    card: "border-orange-500/50 text-orange-500",
    badge: "bg-orange-500/15 text-orange-500 border-orange-500/30",
  },
  MEDIUM: {
    dot: "bg-yellow-500",
    card: "border-yellow-500/50 text-yellow-500",
    badge: "bg-yellow-500/15 text-yellow-500 border-yellow-500/30",
  },
  LOW: {
    dot: "bg-blue-500",
    card: "border-blue-500/50 text-blue-500",
    badge: "bg-blue-500/15 text-blue-500 border-blue-500/30",
  },
};

export function AlertsClient({ data, locale, severityCounts }: Props) {
  const tAlerts = useTranslations("alerts");
  const tFilters = useTranslations("alerts.filters");
  const tPagination = useTranslations("alerts.pagination");
  const tCodes = useTranslations("codes");
  const tCommon = useTranslations("common");
  const tTemplates = useTranslations();

  const [search, setSearch] = useState("");
  const [selectedSeverities, setSelectedSeverities] = useState<Set<string>>(new Set());
  const [selectedTypes, setSelectedTypes] = useState<Set<string>>(new Set());
  const [selectedStates, setSelectedStates] = useState<Set<string>>(new Set());
  const [selectedOrgs, setSelectedOrgs] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(0);
  const pageSize = 25;

  const renderAlertTitle = (alert: AlertRow): string => {
    const i18n = extractAlertI18n(alert.data);
    return renderAlertText(alert.title, i18n, "titleKey", tTemplates, tCodes);
  };

  const renderAlertDescription = (alert: AlertRow): string => {
    const i18n = extractAlertI18n(alert.data);
    return renderAlertText(alert.description, i18n, "descriptionKey", tTemplates, tCodes);
  };

  const typeLabel = (type: string): string => {
    const translated = tCodes(`alertType.${type}`);
    return translated === `alertType.${type}` ? type : translated;
  };

  const severityLabel = (sev: string): string => {
    const translated = tCodes(`severity.${sev}`);
    return translated === `severity.${sev}` ? sev : translated;
  };

  const availableTypes = useMemo(() =>
    [...new Set(data.map((a) => a.type))].sort(),
  [data]);

  const availableStates = useMemo(() =>
    [...new Set(data.map((a) => a.state).filter(Boolean) as string[])].sort(),
  [data]);

  const availableOrgs = useMemo(() =>
    [...new Set(data.map((a) => a.procurementOrgName).filter(Boolean) as string[])].sort(),
  [data]);

  const filtered = useMemo(() => {
    let result = data;

    if (selectedSeverities.size > 0) {
      result = result.filter((a) => selectedSeverities.has(a.severity));
    }
    if (selectedTypes.size > 0) {
      result = result.filter((a) => selectedTypes.has(a.type));
    }
    if (selectedStates.size > 0) {
      result = result.filter((a) => a.state && selectedStates.has(a.state));
    }
    if (selectedOrgs.size > 0) {
      result = result.filter((a) => a.procurementOrgName && selectedOrgs.has(a.procurementOrgName));
    }

    if (search.trim()) {
      const terms = search.toLowerCase().split(/\s+/).filter(Boolean);
      result = result.filter((a) => {
        const text = [a.title, a.description, a.entityName, a.entityCnpj, a.procurementOrgName, a.state, a.type]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return terms.every((t) => text.includes(t));
      });
    }

    result.sort((a, b) => {
      const sevDiff = (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9);
      if (sevDiff !== 0) return sevDiff;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

    return result;
  }, [data, search, selectedSeverities, selectedTypes, selectedStates, selectedOrgs]);

  const totalPages = Math.ceil(filtered.length / pageSize);
  const paged = filtered.slice(page * pageSize, (page + 1) * pageSize);

  const toggleSet = (setter: React.Dispatch<React.SetStateAction<Set<string>>>, value: string) => {
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
    setPage(0);
  };

  const hasFilters = selectedSeverities.size > 0 || selectedTypes.size > 0 || selectedStates.size > 0 || selectedOrgs.size > 0 || search.trim() !== "";

  const clearAll = () => {
    setSelectedSeverities(new Set());
    setSelectedTypes(new Set());
    setSelectedStates(new Set());
    setSelectedOrgs(new Set());
    setSearch("");
    setPage(0);
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {SEVERITY_ORDER.map((sev) => {
          const isActive = selectedSeverities.has(sev);
          const style = SEVERITY_STYLES[sev];
          return (
            <button
              key={sev}
              onClick={() => toggleSet(setSelectedSeverities, sev)}
              className={cn(
                "rounded-lg border bg-card p-4 text-left transition-all",
                style.card,
                isActive && "ring-2 ring-offset-1 ring-current",
              )}
            >
              <p className="text-xs uppercase tracking-wider">{severityLabel(sev)}</p>
              <p className="text-xl font-bold">{severityCounts[sev] ?? 0}</p>
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[280px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            placeholder={tAlerts("search")}
            className="pl-9 h-9"
          />
          {search && (
            <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        <FilterDropdown
          label={tFilters("severity")}
          noOptionsLabel={tFilters("noOptions")}
          clearLabel={tCommon("clear")}
          options={SEVERITY_ORDER.map((s) => ({ value: s, label: severityLabel(s) }))}
          selected={selectedSeverities}
          onToggle={(v) => toggleSet(setSelectedSeverities, v)}
          onClear={() => { setSelectedSeverities(new Set()); setPage(0); }}
        />

        <FilterDropdown
          label={tFilters("category")}
          noOptionsLabel={tFilters("noOptions")}
          clearLabel={tCommon("clear")}
          options={availableTypes.map((t) => ({ value: t, label: typeLabel(t) }))}
          selected={selectedTypes}
          onToggle={(v) => toggleSet(setSelectedTypes, v)}
          onClear={() => { setSelectedTypes(new Set()); setPage(0); }}
        />

        <FilterDropdown
          label={tFilters("state")}
          noOptionsLabel={tFilters("noOptions")}
          clearLabel={tCommon("clear")}
          options={availableStates.map((s) => ({ value: s, label: s }))}
          selected={selectedStates}
          onToggle={(v) => toggleSet(setSelectedStates, v)}
          onClear={() => { setSelectedStates(new Set()); setPage(0); }}
        />

        <FilterDropdown
          label={tFilters("organization")}
          noOptionsLabel={tFilters("noOptions")}
          clearLabel={tCommon("clear")}
          options={availableOrgs.map((o) => ({ value: o, label: o }))}
          selected={selectedOrgs}
          onToggle={(v) => toggleSet(setSelectedOrgs, v)}
          onClear={() => { setSelectedOrgs(new Set()); setPage(0); }}
        />

        {hasFilters && (
          <Button variant="ghost" size="sm" onClick={clearAll} className="h-9 text-muted-foreground">
            <X className="h-3.5 w-3.5 mr-1" />
            {tCommon("clear")}
          </Button>
        )}
      </div>

      {hasFilters && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {tPagination("of", { count: filtered.length, total: data.length })}
          </span>
          {Array.from(selectedSeverities).map((s) => (
            <Badge key={`sev-${s}`} variant="secondary" className="gap-1 text-xs">
              {severityLabel(s)}
              <button onClick={() => toggleSet(setSelectedSeverities, s)}><X className="h-3 w-3" /></button>
            </Badge>
          ))}
          {Array.from(selectedTypes).map((t) => (
            <Badge key={`type-${t}`} variant="secondary" className="gap-1 text-xs">
              {typeLabel(t)}
              <button onClick={() => toggleSet(setSelectedTypes, t)}><X className="h-3 w-3" /></button>
            </Badge>
          ))}
          {Array.from(selectedStates).map((s) => (
            <Badge key={`state-${s}`} variant="secondary" className="gap-1 text-xs">
              {tFilters("stateLabel", { state: s })}
              <button onClick={() => toggleSet(setSelectedStates, s)}><X className="h-3 w-3" /></button>
            </Badge>
          ))}
          {Array.from(selectedOrgs).map((o) => (
            <Badge key={`org-${o}`} variant="secondary" className="gap-1 text-xs">
              {o}
              <button onClick={() => toggleSet(setSelectedOrgs, o)}><X className="h-3 w-3" /></button>
            </Badge>
          ))}
        </div>
      )}

      {paged.length === 0 ? (
        <div className="rounded-lg border bg-card p-12 text-center">
          <p className="text-muted-foreground">
            {hasFilters ? tAlerts("emptyFiltered") : tAlerts("empty")}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {paged.map((alert) => {
            const style = SEVERITY_STYLES[alert.severity] ?? SEVERITY_STYLES.LOW;
            return (
              <Link
                key={alert.id}
                href={`/${locale}/alerts/${alert.id}`}
                className="block rounded-lg border bg-card p-4 hover:bg-muted/30 transition-colors"
              >
                <div className="flex items-start gap-3">
                  <div className={`w-2.5 h-2.5 rounded-full mt-1.5 flex-shrink-0 ${style.dot}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium border ${style.badge}`}>
                        {severityLabel(alert.severity)}
                      </span>
                      <span className="text-[11px] px-2 py-0.5 rounded bg-muted font-medium">
                        {typeLabel(alert.type)}
                      </span>
                      {alert.state && (
                        <span className="text-[11px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                          {alert.state}
                        </span>
                      )}
                      <span className="text-[11px] text-muted-foreground">
                        {formatDate(alert.createdAt, locale as AppLocale)}
                      </span>
                    </div>
                    <p className="font-medium text-sm">{renderAlertTitle(alert)}</p>
                    <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                      {renderAlertDescription(alert)}
                    </p>
                    <div className="flex flex-wrap gap-2 mt-2">
                      {alert.entityName && (
                        <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-md bg-blue-500/10 text-blue-600">
                          <ExternalLink className="h-3 w-3" />
                          {alert.entityName}
                        </span>
                      )}
                      {alert.procurementOrgName && (
                        <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-md bg-purple-500/10 text-purple-600">
                          <ExternalLink className="h-3 w-3" />
                          {alert.procurementOrgName}
                        </span>
                      )}
                    </div>
                  </div>
                  <ExternalLink className="h-4 w-4 text-muted-foreground mt-1 flex-shrink-0" />
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {filtered.length > pageSize && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">
            {tPagination("range", {
              start: page * pageSize + 1,
              end: Math.min((page + 1) * pageSize, filtered.length),
              total: filtered.length,
            })}
          </span>
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
        </div>
      )}
    </div>
  );
}

function FilterDropdown({
  label,
  noOptionsLabel,
  clearLabel,
  options,
  selected,
  onToggle,
  onClear,
}: {
  label: string;
  noOptionsLabel: string;
  clearLabel: string;
  options: { value: string; label: string }[];
  selected: Set<string>;
  onToggle: (value: string) => void;
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  const isActive = selected.size > 0;

  return (
    <div className="relative">
      <Button
        variant="outline"
        size="sm"
        className={cn("h-9 gap-1 text-xs", isActive && "border-primary text-primary")}
        onClick={() => setOpen((o) => !o)}
      >
        {label}
        {isActive && (
          <Badge variant="secondary" className="ml-1 h-4 px-1 text-[10px]">{selected.size}</Badge>
        )}
      </Button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute top-full left-0 mt-1 z-50 w-64 rounded-lg border bg-popover shadow-lg overflow-hidden">
            <div className="max-h-60 overflow-y-auto p-1">
              {options.length === 0 ? (
                <p className="text-xs text-muted-foreground p-3 text-center">{noOptionsLabel}</p>
              ) : (
                options.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => onToggle(opt.value)}
                    className="flex items-center gap-2 w-full px-3 py-1.5 text-sm hover:bg-muted rounded-md transition-colors text-left"
                  >
                    <div className={cn(
                      "h-3.5 w-3.5 rounded-sm border flex items-center justify-center flex-shrink-0",
                      selected.has(opt.value) ? "bg-primary border-primary" : "opacity-50"
                    )}>
                      {selected.has(opt.value) && (
                        <svg className="h-2.5 w-2.5 text-primary-foreground" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M2 6l3 3 5-5" />
                        </svg>
                      )}
                    </div>
                    <span className="truncate">{opt.label}</span>
                  </button>
                ))
              )}
            </div>
            {isActive && (
              <div className="border-t p-1.5">
                <Button variant="ghost" size="sm" onClick={() => { onClear(); setOpen(false); }} className="w-full text-xs h-7">
                  {clearLabel}
                </Button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
