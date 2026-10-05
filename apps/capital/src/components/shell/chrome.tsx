"use client";

import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, usePathname, useRouter } from "@/i18n/navigation";
import { api } from "@/lib/api";
import { useLogout, useSession } from "@/lib/session";
import { cn } from "@/lib/utils";

export function Btn({
  children,
  primary,
  dashed,
  ghost,
  onClick,
  type = "button",
}: {
  children: ReactNode;
  primary?: boolean;
  dashed?: boolean;
  ghost?: boolean;
  onClick?: () => void;
  type?: "button" | "submit";
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      className={cn(
        "inline-flex h-[26px] items-center gap-1.5 rounded-[6px] px-2.5 text-[12px] font-medium whitespace-nowrap",
        primary && "border border-neutral-950 bg-neutral-950 text-white",
        !primary && !ghost && "border border-neutral-300 bg-transparent text-neutral-950",
        dashed && "border-dashed",
        ghost && "border border-transparent text-neutral-500",
      )}
    >
      {children}
    </button>
  );
}

export function Segmented({
  value,
  options,
  onChange,
}: {
  value: string;
  options: { v: string; l: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <span className="inline-flex gap-0.5 rounded-[7px] border border-neutral-200 p-0.5">
      {options.map((option) => (
        <button
          key={option.v}
          type="button"
          onClick={() => onChange(option.v)}
          className={cn(
            "inline-flex h-[22px] items-center rounded-[5px] px-2 text-[12px] whitespace-nowrap",
            option.v === value ? "bg-neutral-100 font-medium text-neutral-950" : "text-neutral-400",
          )}
        >
          {option.l}
        </button>
      ))}
    </span>
  );
}

export function Kpi({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "pos" | "neg" }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="text-[11px] text-neutral-400">{label}</span>
      <span className={cn("font-mono text-[17px] font-medium tabular-nums", tone === "pos" && "text-emerald-700", tone === "neg" && "text-red-600")}>{value}</span>
      {sub ? <span className="text-[11px] text-neutral-400">{sub}</span> : null}
    </div>
  );
}

export function KpiStrip({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap gap-7 rounded-lg border border-neutral-200 px-3.5 py-3">{children}</div>;
}

export function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="min-w-0 overflow-hidden rounded-lg border border-neutral-200">
      <header className="flex h-9 items-center px-3 text-[12.5px] font-medium">{title}</header>
      <div className="border-t border-neutral-200 p-3">{children}</div>
    </section>
  );
}

export function AppFrame({
  crumbs,
  actions,
  children,
}: {
  crumbs: [string, string];
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="grid h-dvh grid-cols-[200px_minmax(0,1fr)] bg-white text-neutral-950">
      <Sidebar />
      <div className="flex min-w-0 flex-col">
        <header className="flex h-[46px] items-center gap-2 border-b border-neutral-200 px-3.5">
          <span className="text-[12.5px] text-neutral-400">{crumbs[0]} / </span>
          <span className="text-[12.5px] font-medium">{crumbs[1]}</span>
          <div className="ml-auto flex items-center gap-1.5">{actions}</div>
        </header>
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-3.5">{children}</div>
      </div>
    </div>
  );
}

function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const session = useSession();
  const logout = useLogout();
  const views = useQuery({
    queryKey: ["views", "ledger"],
    queryFn: () => api<{ id: string; name: string; isFavorite: boolean }[]>("/api/v2/views?dataset=ledger"),
  });
  const user = session.data;
  const initials = (user?.name ?? "?").split(" ").map((part) => part[0]).slice(0, 2).join("").toUpperCase();

  return (
    <aside className="flex h-dvh flex-col gap-0.5 border-r border-neutral-200 bg-neutral-50 p-2">
      <div className="flex items-center gap-2 px-1.5 pt-1 pb-2">
        <span className="inline-flex size-6 items-center justify-center rounded-[6px] bg-neutral-950 text-[12px] font-bold text-white">C</span>
        <span className="text-[12.5px] font-semibold">Capital</span>
      </div>
      <button
        type="button"
        onClick={() => window.dispatchEvent(new CustomEvent("capital:command"))}
        className="mb-1 flex h-7 items-center gap-1.5 rounded-[6px] border border-neutral-200 px-2 text-[12px] text-neutral-400"
      >
        <span className="flex-1 text-left">Buscar ou executar…</span>
        <kbd className="font-mono text-[10px]">⌘K</kbd>
      </button>
      <p className="px-2 pt-3 pb-1 text-[11px] text-neutral-400">Transações</p>
      {(views.data ?? []).filter((view) => view.isFavorite).map((view) => (
        <Link key={view.id} href={`/transactions?view=${view.id}`} className={cn("flex h-7 items-center truncate rounded-[6px] px-2 text-[12.5px]", pathname.startsWith("/transactions") && !pathname.includes("budgets") ? "text-neutral-700" : "text-neutral-600")}>
          {view.name}
        </Link>
      ))}
      <Link href="/transactions" className="flex h-7 items-center gap-2 px-2 text-[12.5px] text-neutral-400">
        <span className="w-3">+</span> Nova view
      </Link>
      <NavItem href="/transactions/budgets" active={pathname.includes("/budgets")} label="Orçamentos" />
      <p className="px-2 pt-3 pb-1 text-[11px] text-neutral-400">Investimentos</p>
      <NavItem href="/investments" active={pathname === "/investments"} label="Carteira" />
      <NavItem href="/investments/contributions" active={pathname.includes("/contributions")} label="Aportes" />
      <div className="flex-1" />
      <div className="flex items-center gap-2 border-t border-neutral-200 px-1.5 py-2">
        <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-neutral-200 text-[10px] font-semibold">{initials}</span>
        <span className="min-w-0">
          <span className="block truncate text-[12px]">{user?.name}</span>
          <span className="block text-[11px] text-neutral-400">
            <button type="button" onClick={() => router.push("/settings")}>Ajustes</button>
            {" · "}
            <button type="button" onClick={() => void logout.mutateAsync().then(() => router.replace("/login"))}>Sair</button>
          </span>
        </span>
      </div>
    </aside>
  );
}

function NavItem({ href, active, label }: { href: string; active: boolean; label: string }) {
  return (
    <Link href={href} className={cn("flex h-7 items-center rounded-[6px] px-2 text-[12.5px]", active ? "bg-neutral-200/80 font-medium text-neutral-950" : "text-neutral-600")}>
      {label}
    </Link>
  );
}
