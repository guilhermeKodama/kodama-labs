"use client";

import { useTranslations } from "next-intl";
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
  { href: "/dashboard", labelKey: "dashboard", icon: LayoutDashboard },
  { href: "/procurements", labelKey: "procurements", icon: FileText },
  { href: "/contracts", labelKey: "contracts", icon: ScrollText },
  { href: "/entities", labelKey: "entities", icon: Building2 },
  { href: "/politicians", labelKey: "politicians", icon: Landmark },
  { href: "/network", labelKey: "network", icon: Network },
  { href: "/alerts", labelKey: "alerts", icon: AlertTriangle },
  { href: "/analysis", labelKey: "analysis", icon: Brain },
  { href: "/pipeline", labelKey: "pipeline", icon: Activity },
] as const;

export function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const tNav = useTranslations("nav");

  const match = pathname.match(/^\/(pt-BR|en)(\/|$)/);
  const locale = match ? match[1] : "";

  return (
    <nav className="flex-1 px-3 space-y-0.5 overflow-y-auto">
      {navItems.map((item) => {
        const fullHref = locale ? `/${locale}${item.href}` : item.href;
        const isActive = pathname.includes(item.href);

        return (
          <Link
            key={item.href}
            href={fullHref}
            onClick={onNavigate}
            className={cn(
              "flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors",
              isActive
                ? "bg-primary text-primary-foreground font-medium"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
          >
            <item.icon className="h-4 w-4 flex-shrink-0" />
            {tNav(item.labelKey)}
          </Link>
        );
      })}
    </nav>
  );
}
