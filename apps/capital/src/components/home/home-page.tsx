import type { CSSProperties } from "react";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { Mark } from "@/components/cap";
import { Link } from "@/i18n/navigation";
import { CONTACT_EMAIL } from "@/lib/brand";
import { cn } from "@/lib/utils";

/**
 * The public homepage (canvas board CerneHome), at `/` for visitors without
 * a session. Every link works: the sections are anchors, "Entrar" opens the
 * sign-in page, and asking for access writes to the contact address (Cerne
 * is not open yet, so nothing is collected here).
 */

const CONTAINER = "mx-auto w-full max-w-[1200px] px-6";
const EYEBROW = "m-0 font-mono text-home-eyebrow tracking-[0.08em] text-fg-3 uppercase";
const H2 = "m-0 font-title text-home-h2 font-medium tracking-[-0.025em]";
const BODY = "m-0 text-home-body text-fg-2";
const PRIMARY = "inline-flex items-center rounded-[12px] bg-brand px-[22px] py-[15px] text-home-body font-semibold text-on-brand no-underline hover:bg-brand/90";

const accessHref = (subject: string) => `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(subject)}`;

/** The eccentric rings behind the hero and the access section. */
function RingsDecor({ rings, className }: { rings: { cx: number; cy: number; r: number; w: number }[]; className: string }) {
  return (
    <svg aria-hidden viewBox="0 0 64 64" className={cn("pointer-events-none absolute", className)}>
      <g fill="none" stroke="var(--cap-home-rings)">
        {rings.map((ring) => (
          <circle key={ring.r} cx={ring.cx} cy={ring.cy} r={ring.r} strokeWidth={ring.w} />
        ))}
      </g>
    </svg>
  );
}

const HERO_RINGS = [
  { cx: 32, cy: 32, r: 30, w: 0.35 },
  { cx: 32, cy: 32, r: 26, w: 0.45 },
  { cx: 31.2, cy: 32.6, r: 22.2, w: 0.35 },
  { cx: 30.4, cy: 33.2, r: 18.5, w: 0.5 },
  { cx: 29.6, cy: 33.8, r: 15, w: 0.35 },
  { cx: 28.8, cy: 34.4, r: 11.5, w: 0.5 },
  { cx: 28.2, cy: 34.8, r: 8.2, w: 0.35 },
  { cx: 27.6, cy: 35.3, r: 5, w: 0.5 },
];
const ACCESS_RINGS = [
  { cx: 32, cy: 32, r: 26, w: 0.6 },
  { cx: 30.4, cy: 33.2, r: 18.5, w: 0.6 },
  { cx: 28.8, cy: 34.4, r: 11.5, w: 0.6 },
  { cx: 27.6, cy: 35.3, r: 5, w: 0.6 },
];

function SectionHead({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div className="flex max-w-[760px] flex-col gap-3.5">
      <p className={EYEBROW}>{eyebrow}</p>
      <h2 className={H2}>{title}</h2>
    </div>
  );
}

function Step({ n, title, text, filled }: { n: number; title: string; text: string; filled?: boolean }) {
  return (
    <div className="flex gap-[18px]">
      <span
        className={cn(
          "inline-flex size-11 shrink-0 items-center justify-center rounded-full font-mono text-home-step",
          filled ? "bg-brand text-on-brand" : "border-2 border-brand text-brand",
        )}
      >
        {n}
      </span>
      <div className="flex flex-col gap-1.5">
        <h3 className="m-0 text-home-h3 font-semibold">{title}</h3>
        <p className={BODY}>{text}</p>
      </div>
    </div>
  );
}

function ProposalRow({ date, label, amount, last }: { date: string; label: string; amount: string; last?: boolean }) {
  return (
    <div className={cn("grid min-h-[42px] grid-cols-[52px_minmax(0,1fr)_auto] items-center gap-x-3 px-3.5 py-2 text-home-row text-fg-2 sm:grid-cols-[64px_minmax(0,1fr)_120px]", !last && "border-b border-dashed border-resin-line/60")}>
      <span className="font-mono text-home-note">{date}</span>
      <span>{label}</span>
      <span className="text-right font-mono whitespace-nowrap">{amount}</span>
    </div>
  );
}

function Feature({ title, text }: { title: string; text: string }) {
  return (
    <div className="flex flex-col gap-2.5 bg-editor p-7">
      <h3 className="m-0 text-home-h4 font-semibold">{title}</h3>
      <p className="m-0 text-home-feature text-fg-2">{text}</p>
    </div>
  );
}

function Rule({ title, text }: { title: string; text: string }) {
  return (
    <div className="flex flex-col gap-2.5 border-t-2 border-brand pt-[18px]">
      <h3 className="m-0 text-home-h4 font-semibold">{title}</h3>
      <p className={BODY}>{text}</p>
    </div>
  );
}

/** A screenshot of the app in the active theme (one image per theme, as webp at twice the size it shows). */
function Shot({ name, alt, width, height, priority }: { name: string; alt: string; width: number; height: number; priority?: boolean }) {
  return (
    <>
      <Image src={`/home/${name}-claro.webp`} alt={alt} width={width} height={height} priority={priority} className="h-auto w-full dark:hidden" />
      <Image src={`/home/${name}-escuro.webp`} alt={alt} width={width} height={height} className="hidden h-auto w-full dark:block" />
    </>
  );
}

export function HomePage() {
  const t = useTranslations("home");
  const access = accessHref(t("access.subject"));
  // The footer's mark: sapwood rings and a resin core on charcoal, whatever the theme.
  const footerMark = { "--cap-brand": "var(--cap-home-footer-ink)", "--cap-resin": "var(--cap-home-ring)" } as CSSProperties;

  return (
    <div id="cerne-home" className="min-h-dvh bg-editor text-fg-1">
      <header className="relative z-[2] border-b border-stroke-2 bg-home-band pt-safe">
        <div className={cn(CONTAINER, "flex flex-wrap items-center justify-between gap-4 py-4")}>
          <Link href="/" className="inline-flex items-center gap-2.5 text-wordmark no-underline">
            <Mark detail="full" className="size-7" />
            <span className="font-title text-home-wordmark font-semibold tracking-[-0.02em]">cerne</span>
          </Link>
          <nav aria-label={t("nav.label")} className="flex flex-wrap gap-x-[22px] gap-y-1 text-home-small">
            <a href="#juntos" className="text-fg-2 no-underline hover:text-fg-1">{t("nav.together")}</a>
            <a href="#como" className="text-fg-2 no-underline hover:text-fg-1">{t("nav.how")}</a>
            <a href="#recursos" className="text-fg-2 no-underline hover:text-fg-1">{t("nav.features")}</a>
            <a href="#liberdade" className="text-fg-2 no-underline hover:text-fg-1">{t("nav.freedom")}</a>
            <a href="#controle" className="text-fg-2 no-underline hover:text-fg-1">{t("nav.control")}</a>
          </nav>
          <div className="flex items-center gap-2.5">
            <Link href="/login" className="px-3.5 py-2.5 text-home-small font-medium text-fg-1 no-underline">
              {t("nav.signIn")}
            </Link>
            <a href="#acesso" className="rounded-[10px] bg-brand px-[18px] py-[11px] text-home-small font-semibold text-on-brand no-underline hover:bg-brand/90">
              {t("nav.access")}
            </a>
          </div>
        </div>
      </header>

      <section className="relative overflow-hidden bg-home-band">
        <RingsDecor rings={HERO_RINGS} className="-top-[180px] -right-[260px] size-[900px]" />
        <div className={cn(CONTAINER, "relative flex flex-col gap-7 pt-[88px]")}>
          <p className={EYEBROW}>{t("hero.eyebrow")}</p>
          <h1 className="m-0 max-w-[860px] font-title text-home-display font-medium tracking-[-0.035em] text-wordmark">{t("hero.title")}</h1>
          <p className="m-0 max-w-[640px] text-home-lead text-fg-2">{t("hero.lead")}</p>
          <div className="flex flex-wrap gap-3">
            <a href="#acesso" className={PRIMARY}>{t("hero.primary")}</a>
            <a href="#como" className="inline-flex items-center rounded-[12px] border border-home-outline px-[22px] py-[15px] text-home-body font-medium text-fg-1 no-underline hover:bg-fill-4">
              {t("hero.secondary")}
            </a>
          </div>
          <div className="mt-9 overflow-hidden rounded-t-[18px] border border-b-0 border-stroke-1 shadow-[0_30px_80px_var(--cap-home-shadow)] sm:h-[min(620px,52vw)]">
            {/* The whole screen from sm up; on a phone it would be too small, so the trunk alone. */}
            <div className="hidden sm:block">
              <Shot name="aneis" alt={t("hero.shot")} width={2880} height={1800} priority />
            </div>
            <div className="sm:hidden">
              <Shot name="aneis-corte" alt={t("hero.shot")} width={1120} height={1160} />
            </div>
          </div>
        </div>
      </section>

      <section id="juntos" className="border-b border-stroke-2">
        <div className={cn(CONTAINER, "flex flex-col gap-11 pt-[104px] pb-24")}>
          <SectionHead eyebrow={t("together.eyebrow")} title={t("together.title")} />
          <div className="flex flex-wrap items-start gap-12">
            <div className="flex flex-[1_1_300px] flex-col gap-8">
              {(["apart", "joined", "plan"] as const).map((key) => (
                <Rule key={key} title={t(`together.${key}.title`)} text={t(`together.${key}.text`)} />
              ))}
            </div>
            <figure className="m-0 min-w-0 flex-[1.7_1_520px] overflow-hidden rounded-[18px] border border-stroke-1 shadow-[0_30px_80px_var(--cap-home-shadow)]">
              <Shot name="livro" alt={t("together.shot")} width={2160} height={1240} />
            </figure>
          </div>
        </div>
      </section>

      <section className={cn(CONTAINER, "flex flex-col gap-11 pt-[104px] pb-24")}>
        <SectionHead eyebrow={t("who.eyebrow")} title={t("who.title")} />
        <div className="grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] gap-5">
          {(
            [
              ["abroad", "text-pos"],
              ["business", "text-brand"],
              ["goal", "text-resin-ink"],
            ] as const
          ).map(([key, tone]) => (
            <div key={key} className="flex flex-col gap-3 rounded-[18px] border border-stroke-2 bg-panel p-7">
              <span className={cn("font-mono text-home-tag", tone)}>{t(`who.${key}.tag`)}</span>
              <h3 className="m-0 text-home-h3 font-semibold">{t(`who.${key}.title`)}</h3>
              <p className={BODY}>{t(`who.${key}.text`)}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="como" className="border-y border-stroke-2 bg-home-band">
        <div className={cn(CONTAINER, "flex flex-col gap-12 py-24")}>
          <SectionHead eyebrow={t("how.eyebrow")} title={t("how.title")} />
          <div className="flex flex-wrap items-stretch gap-8">
            <div className="flex flex-[1_1_360px] flex-col gap-7">
              <Step n={1} title={t("how.connect.title")} text={t("how.connect.text")} />
              <Step n={2} title={t("how.check.title")} text={t("how.check.text")} />
              <Step n={3} title={t("how.grow.title")} text={t("how.grow.text")} filled />
            </div>
            <figure aria-label={t("how.proposal.label")} className="m-0 flex min-w-0 flex-[1_1_420px] flex-col gap-3.5 rounded-[20px] border border-stroke-1 bg-editor p-[22px]">
              <div className="flex flex-wrap justify-between gap-3 font-mono text-home-note text-fg-3">
                <span>{t("how.proposal.source")}</span>
                <span>{t("how.proposal.status")}</span>
              </div>
              <div className="overflow-hidden rounded-[12px] border-[1.5px] border-dashed border-resin-line bg-resin-wash">
                <ProposalRow date="12 out" label={t("how.proposal.rows.pharmacy")} amount="−R$ 87,40" />
                <ProposalRow date="12 out" label={t("how.proposal.rows.restaurant")} amount="−R$ 132,00" />
                <ProposalRow date="13 out" label={t("how.proposal.rows.pix")} amount="+R$ 1.200,00" last />
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="text-home-row text-fg-2">{t("how.proposal.more")}</span>
                {/* An illustration of the assistant's card: shown, not clickable. */}
                <span aria-hidden className="inline-flex h-10 items-center rounded-[10px] bg-brand px-[18px] text-home-row font-semibold text-on-brand">
                  {t("how.proposal.confirm")}
                </span>
              </div>
              <p className="m-0 text-home-note text-fg-3">{t("how.proposal.illustrative")}</p>
            </figure>
          </div>
        </div>
      </section>

      <section id="recursos" className={cn(CONTAINER, "flex flex-col gap-11 pt-[104px] pb-24")}>
        <SectionHead eyebrow={t("features.eyebrow")} title={t("features.title")} />
        <div className="grid grid-cols-[repeat(auto-fit,minmax(300px,1fr))] gap-px overflow-hidden rounded-[18px] border border-stroke-2 bg-stroke-2">
          {(["ledger", "currencies", "cards", "investments", "budgets", "claude"] as const).map((key) => (
            <Feature key={key} title={t(`features.${key}.title`)} text={t(`features.${key}.text`)} />
          ))}
        </div>
      </section>

      <section id="liberdade" className="bg-home-band-strong text-home-band-ink">
        <div className={cn(CONTAINER, "flex flex-wrap items-center gap-14 py-[104px]")}>
          <div className="flex flex-[1_1_420px] flex-col gap-[18px]">
            <p className={cn(EYEBROW, "text-home-band-muted")}>{t("freedom.eyebrow")}</p>
            <h2 className={H2}>{t("freedom.title")}</h2>
            <p className="m-0 text-home-large text-home-band-body">{t("freedom.text")}</p>
          </div>
          <figure className="m-0 flex max-w-[492px] flex-[1_1_380px] flex-col gap-3">
            {/* On the app's own surface, so its heartwood card does not melt into the band. */}
            <div className="rounded-[20px] bg-editor p-3 shadow-[0_30px_80px_var(--cap-home-shadow)] sm:p-4">
              <Shot name="painel" alt={t("freedom.shot")} width={984} height={940} />
            </div>
            <figcaption className="text-home-note text-home-band-muted">{t("freedom.demo")}</figcaption>
          </figure>
        </div>
      </section>

      <section id="controle" className={cn(CONTAINER, "flex flex-col gap-11 pt-[104px] pb-24")}>
        <SectionHead eyebrow={t("control.eyebrow")} title={t("control.title")} />
        <div className="grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] gap-8">
          {(["confirm", "undo", "export"] as const).map((key) => (
            <Rule key={key} title={t(`control.${key}.title`)} text={t(`control.${key}.text`)} />
          ))}
        </div>
      </section>

      <section id="acesso" className="relative overflow-hidden border-t border-stroke-2 bg-home-band">
        <RingsDecor rings={ACCESS_RINGS} className="-bottom-[220px] -left-[160px] size-[520px]" />
        <div className="relative mx-auto flex max-w-[760px] flex-col items-center gap-[22px] px-6 py-28 text-center">
          <h2 className="m-0 font-title text-home-cta font-medium tracking-[-0.03em] text-wordmark">{t("access.title")}</h2>
          <p className="m-0 text-home-large text-fg-2">{t("access.text")}</p>
          <a href={access} className={PRIMARY}>{t("access.button")}</a>
          <p className="m-0 text-home-small text-fg-3">
            {t("access.or")}{" "}
            <a href={access} className="font-medium text-brand underline-offset-2 hover:underline">
              {CONTACT_EMAIL}
            </a>
          </p>
        </div>
      </section>

      <footer className="bg-home-footer text-home-footer-text">
        <div className={cn(CONTAINER, "flex flex-wrap items-center justify-between gap-5 py-10")}>
          <div className="flex items-center gap-2.5" style={footerMark}>
            <Mark detail="full" className="size-[26px]" />
            <span className="font-title text-home-tag font-semibold text-home-footer-ink">cerne</span>
            <span className="pl-2 text-home-row">{t("footer.tagline")}</span>
          </div>
          <nav aria-label={t("footer.label")} className="flex flex-wrap gap-5 text-home-row">
            <Link href="/login" className="text-home-footer-text no-underline hover:text-home-footer-ink">{t("footer.signIn")}</Link>
            <a href="https://kodamalabs.ai" className="text-home-footer-text no-underline hover:text-home-footer-ink">{t("footer.labs")}</a>
            <a href={`mailto:${CONTACT_EMAIL}`} className="text-home-footer-text no-underline hover:text-home-footer-ink">{CONTACT_EMAIL}</a>
          </nav>
        </div>
      </footer>
    </div>
  );
}
