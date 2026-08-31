/**
 * Full-bleed wrapper for the chat screens: edge-to-edge, internally-scrolling
 * column instead of the centered max-width padding every other screen gets
 * (see `(padded)/layout.tsx`). Replaces the old `<AppShell fullBleed>` prop.
 */
export default function AssistantLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-[calc(100dvh-4rem-env(safe-area-inset-bottom,0px))] md:h-dvh">
      {children}
    </div>
  );
}
