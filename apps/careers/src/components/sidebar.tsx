"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Briefcase,
  ClipboardCheck,
  CheckCircle2,
  Building2,
  FileText,
  StickyNote,
  Sliders,
  FlaskConical,
  PanelLeftClose,
  PanelLeft,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "./theme-toggle";

const COLLAPSE_COOKIE = "careers_sidebar_collapsed";

type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: number;
};

const FUNNEL_ITEMS: NavItem[] = [
  { href: "/", label: "Vagas", icon: Briefcase },
  { href: "/triagem", label: "Triagem", icon: ClipboardCheck },
  { href: "/auto", label: "Descartadas auto", icon: CheckCircle2 },
];

const BASE_ITEMS: NavItem[] = [
  { href: "/empresas", label: "Empresas", icon: Building2 },
  { href: "/curriculo", label: "Currículo", icon: FileText },
  { href: "/notas", label: "Notas", icon: StickyNote },
];

const FOOTER_ITEMS: NavItem[] = [
  { href: "/perfil", label: "Parâmetros de busca", icon: Sliders },
  { href: "/lab", label: "Lab", icon: FlaskConical },
];

function setCollapseCookie(value: boolean) {
  document.cookie = `${COLLAPSE_COOKIE}=${value ? "1" : "0"}; path=/; max-age=31536000; samesite=lax`;
}

export function AppSidebar({
  defaultCollapsed,
  counts,
}: {
  defaultCollapsed: boolean;
  counts: { jobs: number; triage: number; autoDiscarded: number };
}) {
  const [collapsed, setCollapsed] = React.useState(defaultCollapsed);
  const pathname = usePathname();

  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    setCollapseCookie(next);
  };

  const badgeFor = (href: string): number | undefined => {
    if (href === "/") return counts.jobs;
    if (href === "/triagem") return counts.triage;
    if (href === "/auto") return counts.autoDiscarded;
    return undefined;
  };

  const NavLink = ({ item }: { item: NavItem }) => {
    const Icon = item.icon;
    const active = pathname === item.href;
    const badge = badgeFor(item.href);
    return (
      <Link
        href={item.href}
        className={cn(
          "flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm",
          active ? "bg-secondary font-medium text-foreground" : "text-muted-foreground hover:text-foreground",
          collapsed && "justify-center px-0"
        )}
        title={collapsed ? item.label : undefined}
      >
        <Icon className="size-[15px] shrink-0" />
        {!collapsed && <span className="flex-1 truncate">{item.label}</span>}
        {!collapsed && badge !== undefined && (
          <span className="text-xs text-muted-foreground">{badge}</span>
        )}
      </Link>
    );
  };

  return (
    <div
      className={cn(
        "flex h-full shrink-0 flex-col gap-5 border-r border-border p-3 transition-[width] duration-150",
        collapsed ? "w-14" : "w-[232px]"
      )}
    >
      <div className={cn("flex items-center gap-2 px-1", collapsed && "justify-center")}>
        <div className="flex size-[26px] shrink-0 items-center justify-center rounded-md bg-primary">
          <Briefcase className="size-[15px] text-primary-foreground" />
        </div>
        {!collapsed && <span className="flex-1 truncate text-sm font-semibold">careers</span>}
        <button
          type="button"
          onClick={toggle}
          className="flex size-[26px] shrink-0 items-center justify-center rounded-md text-muted-foreground hover:text-foreground"
          title={collapsed ? "Expandir menu" : "Recolher menu"}
        >
          {collapsed ? <PanelLeft className="size-[15px]" /> : <PanelLeftClose className="size-[15px]" />}
        </button>
      </div>

      <nav className="flex flex-col gap-0.5">
        {!collapsed && (
          <div className="px-2 pb-1.5 text-[11px] font-medium text-muted-foreground">Funil</div>
        )}
        {FUNNEL_ITEMS.map((item) => (
          <NavLink key={item.href} item={item} />
        ))}
      </nav>

      <nav className="flex flex-col gap-0.5">
        {!collapsed && (
          <div className="px-2 pb-1.5 text-[11px] font-medium text-muted-foreground">Base</div>
        )}
        {BASE_ITEMS.map((item) => (
          <NavLink key={item.href} item={item} />
        ))}
      </nav>

      <div className="flex-1" />

      <nav className="flex flex-col gap-0.5">
        {FOOTER_ITEMS.map((item) => (
          <NavLink key={item.href} item={item} />
        ))}
      </nav>

      {!collapsed && <ThemeToggle />}
    </div>
  );
}
