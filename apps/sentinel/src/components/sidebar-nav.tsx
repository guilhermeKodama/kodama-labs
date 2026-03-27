"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  FileText,
  ScrollText,
  Building2,
  Network,
  AlertTriangle,
  Brain,
  Activity,
  Landmark,
} from "lucide-react";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/procurements", label: "Licitações", icon: FileText },
  { href: "/contracts", label: "Contratos", icon: ScrollText },
  { href: "/entities", label: "Entidades", icon: Building2 },
  { href: "/politicians", label: "Políticos", icon: Landmark },
  { href: "/network", label: "Rede", icon: Network },
  { href: "/alerts", label: "Alertas", icon: AlertTriangle },
  { href: "/analysis", label: "Análise IA", icon: Brain },
  { href: "/pipeline", label: "Pipeline", icon: Activity },
];

export function SidebarNav() {
  const pathname = usePathname();

  const getLocale = () => {
    const match = pathname.match(/^\/(pt-BR|en)(\/|$)/);
    return match ? match[1] : "";
  };
  const locale = getLocale();

  return (
    <aside className="w-56 flex-shrink-0 border-r bg-card flex flex-col overflow-y-auto">
      <div className="p-4 pb-6">
        <h1 className="text-lg font-bold tracking-tight">Sentinel</h1>
        <p className="text-[11px] text-muted-foreground leading-tight">
          Government Corruption Tracker
        </p>
      </div>

      <nav className="flex-1 px-3 space-y-0.5">
        {navItems.map((item) => {
          const fullHref = locale ? `/${locale}${item.href}` : item.href;
          const isActive = pathname.includes(item.href);

          return (
            <Link
              key={item.href}
              href={fullHref}
              className={cn(
                "flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors",
                isActive
                  ? "bg-primary text-primary-foreground font-medium"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              <item.icon className="h-4 w-4 flex-shrink-0" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="p-4 pt-3 border-t mt-auto">
        <p className="text-[11px] text-muted-foreground">v0.1.0</p>
      </div>
    </aside>
  );
}
