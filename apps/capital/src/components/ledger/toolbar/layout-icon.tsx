import { LAYOUT_ICON } from "@/lib/ledger/view-glyphs";

/** The lucide icon of a view layout (tabs, sidebar, Carteira tabs), size-3.5 by default. */
export function LayoutIcon({ layout, className = "size-3.5 shrink-0 text-fg-3" }: { layout: string | undefined; className?: string }) {
  const Icon = (layout && LAYOUT_ICON[layout]) || LAYOUT_ICON.table;
  return <Icon aria-hidden className={className} />;
}
