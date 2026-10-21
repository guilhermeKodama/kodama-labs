"use client";

import { useRef, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Ellipsis } from "lucide-react";
import { Btn, Kbd, Menu, MenuItem } from "@/components/cap";
import { cn } from "@/lib/utils";
import { PageFab } from "./page-fab";
import { SidebarTrigger } from "./sidebar";

/** A secondary action of a screen: a button in the header on a desktop, a row of the ⋯ menu on a phone. */
export interface PageAction {
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  title?: string;
  /** The header button without a border (the "Lixeira · N" of Transações). */
  ghost?: boolean;
}

/** The screen's one primary action: the filled button in the header on a desktop, the floating button on a phone. */
export interface PagePrimary {
  label: string;
  onSelect: () => void;
  /** The keyboard shortcut shown before the desktop button (Transações' N). */
  hint?: string;
  /** Keeps the floating button out of the way (Transações while rows are selected: the bulk bar takes its place). */
  hideFab?: boolean;
}

/**
 * One screen of the app, inside the (app) layout's main column (the
 * sidebar stays mounted across navigations): the header, an optional
 * subheader (view tabs), then the scrolling body (padding 14, gap 12; its
 * children never shrink, the body scrolls instead). `overlay` is placed
 * over the main column (a side panel positioned against it).
 *
 * The header holds ▤, the breadcrumbs ("Transações / Todas") and the
 * screen's parts: `controls` (filters such as the period or PF/PJ), the
 * `secondary` actions and the `primary` one. On a desktop they line up on
 * the right of the 46px bar, as in the mockup. On a phone (below md) the
 * bar keeps ▤, the screen's own title and a ⋯ menu with the secondary
 * actions; the controls get a row of their own under it, and the primary
 * action becomes a floating button at the bottom right (Material's FAB;
 * Apple asks for the same: one primary action, the rest in a menu).
 */
export function Page({
  crumbs,
  controls,
  secondary = [],
  primary,
  subheader,
  overlay,
  children,
}: {
  crumbs: readonly string[];
  controls?: ReactNode;
  secondary?: readonly PageAction[];
  primary?: PagePrimary;
  subheader?: ReactNode;
  overlay?: ReactNode;
  children: ReactNode;
}) {
  const t = useTranslations("shell.page");
  const body = useRef<HTMLDivElement>(null);
  const parents = crumbs.slice(0, -1);
  const current = crumbs[crumbs.length - 1];
  return (
    <>
      <header className="flex min-h-[46px] shrink-0 flex-wrap items-center gap-x-2 border-b border-stroke-3 px-3.5 py-1.5 max-md:min-h-14 max-md:gap-x-1 max-md:pr-2 max-md:pl-1">
        <SidebarTrigger />
        {/* One run of text, as in the mockup ("Transações / Todas"): the header's 8px gap is not between crumbs. A phone shows the screen's own title only. */}
        <span className="min-w-0 flex-1 truncate text-body text-fg-3">
          {parents.map((crumb, index) => (
            <span key={index} className="whitespace-nowrap max-md:hidden">
              {crumb} /{" "}
            </span>
          ))}
          <span className="font-title text-heading font-medium text-fg-1">{current}</span>
        </span>
        {/* Desktop: the controls, the secondary buttons and the primary one, in one group. On a phone the group dissolves
            (contents): the controls wrap to the last row, and the buttons give way to ⋯ and the floating button. */}
        <div className="contents md:flex md:items-center md:gap-1.5">
          {controls ? (
            <div className="flex min-w-0 items-center gap-2 max-md:order-last max-md:basis-full max-md:overflow-x-auto max-md:px-2.5 max-md:pb-2.5 md:contents">
              {controls}
            </div>
          ) : null}
          {secondary.map((action) => (
            <Btn key={action.label} ghost={action.ghost} disabled={action.disabled} title={action.title} onClick={action.onSelect} className="max-md:hidden">
              {action.label}
            </Btn>
          ))}
          {primary?.hint ? <Kbd className="max-md:hidden">{primary.hint}</Kbd> : null}
          {primary ? (
            <Btn primary onClick={primary.onSelect} className="max-md:hidden">
              {primary.label}
            </Btn>
          ) : null}
        </div>
        {secondary.length > 0 ? (
          <Menu
            align="end"
            width={240}
            trigger={
              <button
                type="button"
                aria-label={t("more")}
                title={t("more")}
                className="inline-flex size-11 shrink-0 items-center justify-center rounded-[8px] text-fg-2 outline-none hover:bg-fill-3 focus-visible:ring-2 focus-visible:ring-fg-3/40 data-[state=open]:bg-fill-3 md:hidden"
              >
                <Ellipsis aria-hidden className="size-6" />
              </button>
            }
          >
            {secondary.map((action) => (
              <MenuItem key={action.label} label={action.label} disabled={action.disabled} onSelect={action.onSelect} />
            ))}
          </Menu>
        ) : null}
      </header>
      {subheader}
      {/* Children keep their height (shrink-0) and the body scrolls: a tall table with overflow-hidden is never squeezed and clipped.
          On a phone with a floating button, the end of the body clears it. */}
      <div ref={body} className={cn("flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-3.5 [&>*]:shrink-0", primary && "max-md:pb-24")}>
        {children}
      </div>
      {primary && !primary.hideFab ? <PageFab label={primary.label} onSelect={primary.onSelect} scroller={body} /> : null}
      {overlay}
    </>
  );
}
