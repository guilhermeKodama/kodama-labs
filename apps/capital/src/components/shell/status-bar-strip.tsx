import { cn } from "@/lib/utils";

/**
 * An opaque strip under the status bar, fixed to the top edge, as tall as
 * the safe area (0 outside the installed iOS app, so it draws nothing).
 *
 * iOS 26 blurs the top of an installed web app's page (a scroll-edge
 * effect reaching about 40pt below the status bar), which smeared the top
 * bar. WebKit skips that blur and extends a solid colour instead when a
 * fixed box at least 90% of the viewport wide and more than 10px tall
 * paints a background at the top edge (LocalFrameView::fixedContainerEdges).
 * This strip is that box, in the colour of the surface under it.
 */
export function StatusBarStrip({ className }: { className?: string }) {
  return <div aria-hidden data-status-bar-strip className={cn("pointer-events-none fixed inset-x-0 top-0 z-40 h-(--safe-top)", className ?? "bg-editor")} />;
}
