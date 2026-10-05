"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, usePathname, useRouter } from "@/i18n/navigation";
import { api, apiPost } from "@/lib/api";
import { useLogout, useSession } from "@/lib/session";
import { cn } from "@/lib/utils";

export function Btn({
  children,
  primary,
  dashed,
  ghost,
  danger,
  disabled,
  onClick,
  type = "button",
  className,
}: {
  children: ReactNode;
  primary?: boolean;
  dashed?: boolean;
  ghost?: boolean;
  danger?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  type?: "button" | "submit";
  className?: string;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex h-[26px] shrink-0 items-center gap-1.5 rounded-[6px] px-2.5 text-[12px] font-medium whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-40",
        primary && "border border-neutral-950 bg-neutral-950 text-white",
        !primary && !ghost && "border border-neutral-300 bg-white text-neutral-950 hover:bg-neutral-50",
        dashed && "border-dashed",
        ghost && "border border-transparent text-neutral-500 hover:bg-neutral-100",
        danger && "text-red-600",
        className,
      )}
    >
      {children}
    </button>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { v: T; l: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <span className="inline-flex shrink-0 gap-0.5 rounded-[7px] border border-neutral-200 p-0.5">
      {options.map((option) => (
        <button
          key={option.v}
          type="button"
          onClick={() => onChange(option.v)}
          className={cn(
            "inline-flex h-[22px] items-center rounded-[5px] px-2 text-[12px] whitespace-nowrap",
            option.v === value ? "bg-neutral-100 font-medium text-neutral-950" : "text-neutral-400 hover:text-neutral-700",
          )}
        >
          {option.l}
        </button>
      ))}
    </span>
  );
}

export function Kpi({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "pos" | "neg" | "warn" }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="text-[11px] text-neutral-400">{label}</span>
      <span
        className={cn(
          "font-mono text-[17px] font-medium tabular-nums",
          tone === "pos" && "text-emerald-700",
          tone === "neg" && "text-red-600",
          tone === "warn" && "text-amber-600",
        )}
      >
        {value}
      </span>
      {sub ? <span className="text-[11px] text-neutral-400">{sub}</span> : null}
    </div>
  );
}

export function KpiStrip({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap gap-7 rounded-lg border border-neutral-200 px-3.5 py-3">{children}</div>;
}

export function Panel({ title, trailing, children, pad = true }: { title: string; trailing?: ReactNode; children: ReactNode; pad?: boolean }) {
  return (
    <section className="min-w-0 overflow-hidden rounded-lg border border-neutral-200">
      <header className="flex h-9 items-center gap-2 border-b border-neutral-200 px-3 text-[12.5px] font-medium">
        <span>{title}</span>
        <span className="ml-auto flex items-center gap-1.5">{trailing}</span>
      </header>
      <div className={pad ? "p-3" : ""}>{children}</div>
    </section>
  );
}

export function Badge({ children, tone }: { children: ReactNode; tone?: "warn" | "neg" }) {
  return (
    <span
      className={cn(
        "inline-flex h-[18px] max-w-full items-center truncate rounded border border-neutral-200 px-1.5 text-[11px] text-neutral-600",
        tone === "warn" && "border-amber-200 text-amber-700",
        tone === "neg" && "border-red-200 text-red-600",
      )}
    >
      {children}
    </span>
  );
}

export function TextInput({
  value,
  onChange,
  placeholder,
  type = "text",
  className,
  autoFocus,
  required,
  mono,
  onBlur,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
  className?: string;
  autoFocus?: boolean;
  required?: boolean;
  mono?: boolean;
  onBlur?: () => void;
}) {
  return (
    <input
      type={type}
      value={value}
      autoFocus={autoFocus}
      required={required}
      onBlur={onBlur}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      className={cn(
        "h-[26px] min-w-0 rounded-[6px] border border-neutral-300 bg-white px-2 text-[12.5px] outline-none placeholder:text-neutral-400 focus:border-neutral-500",
        mono && "font-mono tabular-nums",
        className,
      )}
    />
  );
}

export function SelectInput({
  value,
  onChange,
  options,
  placeholder,
  className,
  required,
}: {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
  className?: string;
  required?: boolean;
}) {
  return (
    <select
      value={value}
      required={required}
      onChange={(event) => onChange(event.target.value)}
      className={cn("h-[26px] min-w-0 rounded-[6px] border border-neutral-300 bg-white px-1.5 text-[12.5px] outline-none focus:border-neutral-500", className)}
    >
      {placeholder !== undefined ? <option value="">{placeholder}</option> : null}
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

export function Field({ label, hint, children, className }: { label: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cn("flex min-w-0 flex-col gap-1", className)}>
      <span className="text-[11px] text-neutral-500">{label}</span>
      {children}
      {hint ? <span className="text-[11px] text-neutral-400">{hint}</span> : null}
    </label>
  );
}

export function Check({ checked, onChange, label }: { checked: boolean; onChange: (value: boolean) => void; label?: string }) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-1.5 text-[12.5px]">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="size-3.5 accent-neutral-900" />
      {label}
    </label>
  );
}

/** Anchored menu that closes on outside click and Escape. */
export function Popover({
  open,
  onClose,
  children,
  align = "left",
  width = 240,
  up,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  align?: "left" | "right";
  width?: number;
  up?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div
      ref={ref}
      style={{ width }}
      className={cn(
        "absolute z-40 flex max-h-[360px] flex-col gap-0.5 overflow-y-auto rounded-lg border border-neutral-300 bg-white p-1.5 text-[12.5px] shadow-lg",
        align === "left" ? "left-0" : "right-0",
        up ? "bottom-[calc(100%+6px)]" : "top-[calc(100%+6px)]",
      )}
    >
      {children}
    </div>
  );
}

export function MenuItem({ label, hint, onClick, danger, active }: { label: ReactNode; hint?: ReactNode; onClick?: () => void; danger?: boolean; active?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn("flex h-7 w-full items-center gap-2 rounded-[5px] px-2 text-left hover:bg-neutral-100", danger && "text-red-600", active && "font-medium")}
    >
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {hint ? <span className="shrink-0 text-[11px] text-neutral-400">{hint}</span> : null}
    </button>
  );
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <span className="px-2 pt-1 pb-0.5 text-[11px] text-neutral-400">{children}</span>;
}

export function Modal({
  title,
  description,
  onClose,
  children,
  footer,
  width = 520,
}: {
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div data-modal className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-neutral-950/30 py-[8vh]" onMouseDown={onClose}>
      <div style={{ width }} className="flex max-w-[94vw] flex-col rounded-[10px] border border-neutral-300 bg-white shadow-xl" onMouseDown={(event) => event.stopPropagation()}>
        <div className="flex items-start gap-2 border-b border-neutral-200 px-4 py-3">
          <div className="flex flex-col gap-0.5">
            <span className="text-[14px] font-semibold">{title}</span>
            {description ? <span className="text-[12px] text-neutral-500">{description}</span> : null}
          </div>
          <button type="button" className="ml-auto text-neutral-400 hover:text-neutral-700" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="flex flex-col gap-3 px-4 py-3.5">{children}</div>
        {footer ? <div className="flex items-center justify-end gap-1.5 border-t border-neutral-200 px-4 py-2.5">{footer}</div> : null}
      </div>
    </div>
  );
}

export function EmptyRow({ children }: { children: ReactNode }) {
  return <div className="border-t border-neutral-200 px-3 py-6 text-center text-[12px] text-neutral-400 first:border-t-0">{children}</div>;
}

export function AppFrame({
  crumbs,
  actions,
  subheader,
  children,
  overlay,
}: {
  crumbs: [string, string];
  actions?: ReactNode;
  subheader?: ReactNode;
  children: ReactNode;
  overlay?: ReactNode;
}) {
  return (
    <div className="grid h-dvh grid-cols-[200px_minmax(0,1fr)] bg-white text-neutral-950">
      <Sidebar />
      <div className="relative flex min-w-0 flex-col overflow-hidden">
        <header className="flex h-[46px] shrink-0 items-center gap-2 border-b border-neutral-200 px-3.5">
          <span className="text-[13px] text-neutral-400">▤</span>
          <span className="text-[12.5px] whitespace-nowrap text-neutral-400">{crumbs[0]} / </span>
          <span className="truncate text-[12.5px] font-medium">{crumbs[1]}</span>
          <div className="ml-auto flex items-center gap-1.5">{actions}</div>
        </header>
        {subheader}
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-3.5">{children}</div>
        {overlay}
      </div>
    </div>
  );
}

function Sidebar() {
  const pathname = usePathname();
  const params = useSearchParams();
  const router = useRouter();
  const session = useSession();
  const logout = useLogout();
  const queryClient = useQueryClient();
  const views = useQuery({
    queryKey: ["views", "ledger"],
    queryFn: () => api<{ id: string; name: string; isFavorite: boolean; config: { layout: string } }[]>("/api/v2/views?dataset=ledger"),
  });
  const createView = useMutation({
    mutationFn: () => apiPost<{ id: string }>("/api/v2/views", { name: "Nova view", dataset: "ledger", isFavorite: true, config: {} }),
    onSuccess: async (view) => {
      await queryClient.invalidateQueries({ queryKey: ["views", "ledger"] });
      router.push(`/transactions?view=${view.id}`);
    },
  });
  const user = session.data;
  const initials = (user?.name ?? "?").split(/\s+/).map((part) => part[0]).slice(0, 2).join("").toUpperCase();
  const onLedger = pathname === "/transactions";
  const firstId = views.data?.[0]?.id;
  const activeViewId = params.get("view") ?? firstId;

  return (
    <aside className="flex h-dvh min-h-0 flex-col gap-0.5 overflow-y-auto border-r border-neutral-200 bg-neutral-50 p-2">
      <div className="flex items-center gap-2 px-1.5 pt-1 pb-2">
        <span className="inline-flex size-6 items-center justify-center rounded-[6px] bg-neutral-950 text-[12px] font-bold text-white">C</span>
        <span className="text-[12.5px] font-semibold">Capital</span>
      </div>
      <button
        type="button"
        onClick={() => window.dispatchEvent(new CustomEvent("capital:command"))}
        className="mb-1 flex h-7 items-center gap-1.5 rounded-[6px] border border-neutral-200 bg-white px-2 text-[12px] text-neutral-400 hover:border-neutral-300"
      >
        <span className="flex-1 text-left">Buscar ou executar…</span>
        <kbd className="rounded border border-neutral-200 px-1 font-mono text-[10px]">⌘K</kbd>
      </button>
      <p className="px-2 pt-3 pb-1 text-[11px] text-neutral-400">Transações</p>
      {(views.data ?? [])
        .filter((view) => view.isFavorite)
        .map((view) => (
          <Link
            key={view.id}
            href={`/transactions?view=${view.id}`}
            className={cn(
              "flex h-7 items-center gap-2 rounded-[6px] px-2 text-[12.5px]",
              onLedger && activeViewId === view.id ? "bg-neutral-200/80 font-medium text-neutral-950" : "text-neutral-600 hover:bg-neutral-100",
            )}
          >
            <span className="w-3 text-[11px] text-neutral-400">{LAYOUT_GLYPH[view.config.layout] ?? "▦"}</span>
            <span className="truncate">{view.name}</span>
          </Link>
        ))}
      <button type="button" onClick={() => createView.mutate()} className="flex h-7 items-center gap-2 rounded-[6px] px-2 text-left text-[12.5px] text-neutral-400 hover:bg-neutral-100">
        <span className="w-3">+</span> Nova view
      </button>
      <NavItem href="/transactions/budgets" active={pathname === "/transactions/budgets"} label="Orçamentos" />
      <p className="px-2 pt-3 pb-1 text-[11px] text-neutral-400">Investimentos</p>
      <NavItem href="/investments" active={pathname === "/investments"} label="Carteira" />
      <NavItem href="/investments/contributions" active={pathname === "/investments/contributions"} label="Aportes" />
      <div className="flex-1" />
      <div className="flex items-center gap-2 border-t border-neutral-200 px-1.5 pt-2 pb-1">
        <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-neutral-200 text-[10px] font-semibold">{initials}</span>
        <span className="min-w-0">
          <span className="block truncate text-[12px]">{user?.name}</span>
          <span className="block text-[11px] text-neutral-400">
            <Link href="/settings" className={cn("hover:text-neutral-700", pathname === "/settings" && "text-neutral-700")}>Ajustes</Link>
            {" · "}
            <button type="button" className="hover:text-neutral-700" onClick={() => void logout.mutateAsync().then(() => router.replace("/login"))}>
              Sair
            </button>
          </span>
        </span>
      </div>
    </aside>
  );
}

const LAYOUT_GLYPH: Record<string, string> = { table: "▦", pivot: "▤", chart: "▮", board: "▥", calendar: "▣" };

function NavItem({ href, active, label }: { href: string; active: boolean; label: string }) {
  return (
    <Link href={href} className={cn("flex h-7 items-center rounded-[6px] px-2 text-[12.5px]", active ? "bg-neutral-200/80 font-medium text-neutral-950" : "text-neutral-600 hover:bg-neutral-100")}>
      {label}
    </Link>
  );
}
