"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";

/**
 * URL-driven tab bar (`?tab=`) for detail pages. Server-first: each tab is a
 * server-rendered section, so switching tabs is a navigation that lets the
 * active section fetch only its own data. The first tab is the default.
 */
export function DetailTabs({
  tabs,
}: {
  tabs: { value: string; label: string }[];
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const current = searchParams.get("tab") ?? tabs[0]?.value;

  return (
    <div className="mb-6 border-b">
      <nav
        className="-mb-px flex gap-1 overflow-x-auto"
        aria-label="Seções do perfil"
      >
        {tabs.map((tab) => {
          const isActive = current === tab.value;
          return (
            <Link
              key={tab.value}
              href={`${pathname}?tab=${tab.value}`}
              scroll={false}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:border-muted-foreground/30 hover:text-foreground",
              )}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
