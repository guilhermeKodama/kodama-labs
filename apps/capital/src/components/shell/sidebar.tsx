"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useTheme } from "next-themes";
import { Link, usePathname, useRouter } from "@/i18n/navigation";
import { ArrowLeftRight, Landmark, LogOut, Moon, PieChart, Settings, Sun, Wallet } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useLogout, useSession } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { openCommandMenu } from "@/components/shell/command-menu";

const ITEMS = [
  { href: "/transactions", key: "transactions", icon: ArrowLeftRight },
  { href: "/transactions/budgets", key: "budgets", icon: Wallet },
  { href: "/investments", key: "portfolio", icon: PieChart },
  { href: "/investments/contributions", key: "contributions", icon: Landmark },
] as const;

export function Sidebar() {
  const t = useTranslations("app");
  const pathname = usePathname();
  const router = useRouter();
  const session = useSession();
  const logout = useLogout();
  const { resolvedTheme, setTheme } = useTheme();
  const [menu, setMenu] = useState(false);
  const user = session.data;
  const views = useQuery({
    queryKey: ["views", "ledger"],
    queryFn: () => api<{ id: string; name: string; isFavorite: boolean }[]>("/api/v2/views?dataset=ledger"),
  });

  async function signOut() {
    await logout.mutateAsync();
    router.replace("/login");
  }

  return (
    <aside className="flex h-dvh w-16 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground md:w-60">
      <div className="flex h-14 items-center px-4 text-sm font-semibold tracking-tight">{t("brand")}</div>
      <nav className="flex flex-1 flex-col gap-1 px-2">
        <p className="hidden px-2 pt-2 pb-1 text-xs text-muted-foreground md:block">{t("pillarTransactions")}</p>
        {ITEMS.slice(0, 2).map((item) => (
          <NavLink key={item.href} href={item.href} active={pathname === item.href} label={t(item.key)} icon={item.icon} />
        ))}
        {(views.data ?? []).filter((view) => view.isFavorite).map((view) => (
          <Link key={view.id} href={`/transactions?view=${view.id}`} className="hidden truncate rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-sidebar-accent/60 md:block">
            {view.name}
          </Link>
        ))}
        <p className="mt-4 hidden px-2 pt-2 pb-1 text-xs text-muted-foreground md:block">{t("pillarInvestments")}</p>
        {ITEMS.slice(2).map((item) => (
          <NavLink key={item.href} href={item.href} active={pathname === item.href} label={t(item.key)} icon={item.icon} />
        ))}
      </nav>
      <div className="relative border-t p-2">
        <button type="button" className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-sidebar-accent" onClick={() => setMenu((value) => !value)}>
          <span className="flex size-8 items-center justify-center rounded-full bg-muted text-xs">{user?.name?.slice(0, 1) ?? "?"}</span>
          <span className="hidden min-w-0 md:block">
            <span className="block truncate font-medium">{user?.name}</span>
            <span className="block truncate text-xs text-muted-foreground">{user?.email}</span>
          </span>
        </button>
        {menu ? (
          <div className="absolute bottom-16 left-2 z-20 w-52 rounded-lg border bg-popover p-1 text-sm shadow-md">
            <button type="button" className="flex w-full items-center gap-2 rounded-md px-2 py-2 hover:bg-accent" onClick={() => { setMenu(false); router.push("/settings"); }}>
              <Settings className="size-4" /> {t("settings")}
            </button>
            <button type="button" className="flex w-full items-center gap-2 rounded-md px-2 py-2 hover:bg-accent" onClick={() => openCommandMenu()}>
              {t("command")}
            </button>
            <button type="button" className="flex w-full items-center gap-2 rounded-md px-2 py-2 hover:bg-accent" onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}>
              {resolvedTheme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />} {t("theme")}
            </button>
            <button type="button" className="flex w-full items-center gap-2 rounded-md px-2 py-2 hover:bg-accent" onClick={() => void signOut()}>
              <LogOut className="size-4" /> {t("logout")}
            </button>
          </div>
        ) : null}
      </div>
    </aside>
  );
}

function NavLink({ href, active, label, icon: Icon }: { href: string; active: boolean; label: string; icon: typeof Wallet }) {
  return (
    <Link href={href} className={cn("flex items-center gap-2 rounded-md px-2 py-2 text-sm", active ? "bg-sidebar-accent text-sidebar-accent-foreground" : "hover:bg-sidebar-accent/60")}>
      <Icon className="size-4 shrink-0" />
      <span className="hidden md:inline">{label}</span>
    </Link>
  );
}

export function ShellFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh bg-background text-foreground">
      <Sidebar />
      <div className="min-w-0 flex-1">
        <div className="flex h-14 items-center justify-end border-b px-4 md:hidden">
          <Button variant="outline" size="sm" onClick={() => openCommandMenu()}>
            ⌘K
          </Button>
        </div>
        <main className="h-[calc(100dvh-3.5rem)] overflow-auto md:h-dvh">{children}</main>
      </div>
    </div>
  );
}
