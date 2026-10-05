"use client";

import type { ReactNode } from "react";
import { SidebarTrigger } from "./sidebar";

/**
 * One screen of the app, inside the (app) layout's main column (the
 * sidebar stays mounted across navigations): the 46px header with ▤, the
 * breadcrumbs ("Transações / Todas") and the screen's actions, an
 * optional subheader (view tabs), then the scrolling body (padding 14,
 * gap 12). `overlay` is placed over the main column (a side panel
 * positioned against it).
 */
export function Page({
  crumbs,
  actions,
  subheader,
  overlay,
  children,
}: {
  crumbs: readonly string[];
  actions?: ReactNode;
  subheader?: ReactNode;
  overlay?: ReactNode;
  children: ReactNode;
}) {
  const parents = crumbs.slice(0, -1);
  const current = crumbs[crumbs.length - 1];
  return (
    <>
      <header className="flex h-[46px] shrink-0 items-center gap-2 border-b border-stroke-3 px-3.5">
        <SidebarTrigger />
        {parents.map((crumb, index) => (
          <span key={index} className="text-[12.5px] whitespace-nowrap text-fg-3">
            {crumb} /{" "}
          </span>
        ))}
        <span className="truncate text-[12.5px] font-medium">{current}</span>
        <div className="ml-auto flex items-center gap-1.5">{actions}</div>
      </header>
      {subheader}
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-3.5">{children}</div>
      {overlay}
    </>
  );
}
