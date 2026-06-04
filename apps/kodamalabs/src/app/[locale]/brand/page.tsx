import { setRequestLocale } from 'next-intl/server';

import { BRAND_OPTIONS } from '@/components/brand/marks';

interface BrandPageProps {
  params: Promise<{ locale: string }>;
}

export default async function BrandPage({ params }: BrandPageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <main className="min-h-screen px-6 py-20">
      <div className="mx-auto max-w-5xl">
        <header className="mb-16">
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
            — brand exploration
          </span>
          <h1 className="mt-3 text-balance text-4xl font-bold tracking-tight md:text-5xl">
            Five marks. Pick one.
          </h1>
          <p className="mt-4 max-w-2xl text-balance text-base leading-relaxed text-muted-foreground">
            All five sit at the intersection of inventor / laboratory / da
            Vinci sketch. Each rendered at three sizes — hero (96px), wordmark
            (28px), and favicon (16px) — so you can stress-test legibility.
          </p>
        </header>

        <div className="flex flex-col gap-5">
          {BRAND_OPTIONS.map(
            ({ id, name, tagline, description, Component }, index) => (
              <article
                key={id}
                className="grid grid-cols-1 gap-8 rounded-2xl border border-border/60 bg-card/40 p-8 backdrop-blur-sm md:grid-cols-[auto_1fr] md:gap-12"
              >
                {/* Size ladder */}
                <div className="flex items-end gap-8 md:flex-col md:items-start md:gap-10">
                  <div className="flex flex-col items-center gap-2">
                    <Component size={96} />
                    <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground/60">
                      96
                    </span>
                  </div>
                  <div className="flex flex-col items-center gap-2">
                    <div className="flex items-center gap-2.5 rounded-full border border-border/60 bg-background/40 px-3 py-1.5">
                      <Component size={20} />
                      <span className="text-sm font-semibold tracking-tight">
                        Kodama Labs
                      </span>
                    </div>
                    <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground/60">
                      lockup
                    </span>
                  </div>
                  <div className="flex flex-col items-center gap-2">
                    <div className="flex size-8 items-center justify-center rounded-md bg-[#0c1714]">
                      <Component size={16} />
                    </div>
                    <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground/60">
                      16
                    </span>
                  </div>
                </div>

                {/* Meta */}
                <div className="flex flex-col gap-3">
                  <div className="flex items-baseline gap-3">
                    <span className="font-mono text-xs text-muted-foreground/60">
                      0{index + 1}
                    </span>
                    <h2 className="text-2xl font-semibold tracking-tight">
                      {name}
                    </h2>
                    <span className="font-mono text-xs text-emerald-300/80">
                      {id}
                    </span>
                  </div>
                  <p className="text-sm font-medium text-emerald-300/90">
                    {tagline}
                  </p>
                  <p className="text-base leading-relaxed text-muted-foreground">
                    {description}
                  </p>
                </div>
              </article>
            )
          )}
        </div>

        <footer className="mt-16 rounded-2xl border border-dashed border-border/40 p-6 text-sm text-muted-foreground">
          <p>
            <span className="font-medium text-foreground">To choose</span>: tell
            Claude the <span className="font-mono text-xs">id</span> (e.g.{' '}
            <span className="font-mono text-xs text-emerald-300">compass</span>
            ) and it&apos;ll be wired into the header, footer, hero, favicon,
            and watermark.
          </p>
        </footer>
      </div>
    </main>
  );
}
