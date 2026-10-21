"use client";

import type { ReactNode } from "react";
import { SidebarTrigger } from "./sidebar";

/**
 * One screen of the app, inside the (app) layout's main column (the
 * sidebar stays mounted across navigations): the 46px header with ▤, the
 * breadcrumbs ("Transações / Todas") and the screen's actions (on a phone
 * they wrap to a second row of their own, which scrolls sideways when the
 * buttons do not fit), an
 * optional subheader (view tabs), then the scrolling body (padding 14,
 * gap 12; its children never shrink, the body scrolls instead). `overlay` is placed over the main column (a side panel
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
      <header className="flex min-h-[46px] shrink-0 flex-wrap items-center gap-x-2 gap-y-1.5 border-b border-stroke-3 px-3.5 py-1.5">
        <SidebarTrigger />
        {/* One run of text, as in the mockup ("Transações / Todas"): the header's 8px gap is not between crumbs. */}
        <span className="min-w-0 grow truncate text-body text-fg-3">
          {parents.map((crumb, index) => (
            <span key={index} className="whitespace-nowrap">
              {crumb} /{" "}
            </span>
          ))}
          <span className="font-title text-heading font-medium text-fg-1">{current}</span>
        </span>
        {actions ? (
          <div className="ml-auto flex max-w-full min-w-0 items-center gap-1.5 overflow-x-auto py-0.5 [&>*]:shrink-0">{actions}</div>
        ) : null}
      </header>
      {subheader}
      {/* Children keep their height (shrink-0) and the body scrolls: a tall table with overflow-hidden is never squeezed and clipped. */}
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-3.5 [&>*]:shrink-0">{children}</div>
      {overlay}
    </>
  );
}
