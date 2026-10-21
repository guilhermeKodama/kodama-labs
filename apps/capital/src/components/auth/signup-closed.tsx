import { useTranslations } from "next-intl";
import { Wordmark } from "@/components/cap";
import { Link } from "@/i18n/navigation";
import { CONTACT_EMAIL } from "@/lib/brand";

/** /signup while sign-up is closed (SIGNUP_OPEN): the same card as the forms, with the contact address instead of fields. */
export function SignupClosed() {
  const t = useTranslations("auth.closed");
  // Centered on a phone (clear of the status bar and home indicator); 12% from the top on a desktop, as in the mockup.
  return (
    <main className="flex min-h-dvh items-center justify-center bg-chrome px-4 pt-[calc(2.5rem+var(--safe-top))] pb-[calc(2.5rem+var(--safe-bottom))] text-fg-1 standalone:min-h-screen sm:items-start sm:pt-[12vh]">
      <section className="flex w-full max-w-[360px] flex-col gap-3.5 rounded-[12px] border border-stroke-1 bg-panel p-[18px]">
        <Wordmark className="self-start" markClassName="size-7" />
        <div className="flex flex-col gap-[3px]">
          <h1 className="font-title text-title font-medium">{t("title")}</h1>
          <p className="text-body-sm text-fg-3">{t("description")}</p>
        </div>
        <a
          href={`mailto:${CONTACT_EMAIL}`}
          className="inline-flex h-(--cap-control-h) w-full items-center justify-center rounded-[6px] border border-brand bg-brand text-button font-medium text-on-brand hover:bg-brand/90"
        >
          {CONTACT_EMAIL}
        </a>
        <Link href="/login" className="text-body-sm font-medium text-fg-1 underline-offset-2 hover:underline">
          {t("login")}
        </Link>
      </section>
    </main>
  );
}
