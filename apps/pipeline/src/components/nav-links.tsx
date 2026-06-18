"use client";

import { useTranslations } from "next-intl";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Users, Wrench } from "lucide-react";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/", labelKey: "portfolio", icon: LayoutDashboard },
  { href: "/leads", labelKey: "leads", icon: Users },
  { href: "/ops", labelKey: "ops", icon: Wrench },
] as const;

export function NavLinks({
  onNavigate,
  collapsed = false,
}: {
  onNavigate?: () => void;
  collapsed?: boolean;
}) {
  const pathname = usePathname();
  const tNav = useTranslations("nav");

  const match = pathname.match(/^\/(pt-BR|en)(\/|$)/);
  const locale = match ? match[1] : "";
  const basePath = locale ? pathname.slice(locale.length + 1) || "/" : pathname;

  return (
    <nav className={cn("flex-1 space-y-1 overflow-y-auto", collapsed ? "px-2.5" : "px-3")}>
      {navItems.map((item) => {
        const fullHref = locale
          ? `/${locale}${item.href === "/" ? "" : item.href}`
          : item.href;
        const isActive =
          item.href === "/"
            ? basePath === "/" || basePath.startsWith("/ideas")
            : basePath.startsWith(item.href);
        const label = tNav(item.labelKey);

        return (
          <Link
            key={item.href}
            href={fullHref || "/"}
            onClick={onNavigate}
            title={collapsed ? label : undefined}
            className={cn(
              "flex items-center gap-2.5 rounded-lg text-sm transition-colors",
              collapsed ? "justify-center px-0 py-2.5" : "px-3 py-2",
              isActive
                ? "bg-accent text-foreground font-medium"
                : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
            )}
          >
            <item.icon
              className={cn("h-4 w-4 flex-shrink-0", isActive && "text-foreground")}
            />
            {!collapsed ? label : null}
          </Link>
        );
      })}
    </nav>
  );
}
