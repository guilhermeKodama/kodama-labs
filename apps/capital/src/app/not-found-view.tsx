import Link from "next/link";

/** The 404 page of app/not-found.tsx and [locale]/not-found.tsx, with a way back to Transações. */
export function NotFoundView({ title, description, back }: { title: string; description: string; back: string }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-background px-4 text-center text-fg-1">
      <span className="inline-flex size-6 items-center justify-center rounded-[6px] bg-gold text-body-sm font-bold text-primary-foreground">C</span>
      <span className="font-mono text-caption text-fg-3">404</span>
      <div className="flex max-w-[360px] flex-col gap-[3px]">
        <h1 className="text-heading font-semibold">{title}</h1>
        <p className="text-body text-fg-3">{description}</p>
      </div>
      <Link
        href="/transactions"
        className="mt-1 inline-flex h-(--cap-control-h) items-center rounded-[6px] border border-gold-line bg-gold px-2.5 text-button font-medium text-primary-foreground"
      >
        {back}
      </Link>
    </div>
  );
}
