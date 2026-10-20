"use client";

import { parseAsString, useQueryStates } from "nuqs";
import { useTranslations } from "next-intl";
import { Kbd } from "@/components/cap";
import { NAV_OFF, NAV_ON } from "@/components/cap/styles";
import { Link, useRouter } from "@/i18n/navigation";
import { useNames } from "@/lib/api/catalog";
import { resolveSettingsPage, SETTINGS_SECTIONS, type SettingsPage } from "@/lib/settings/nav";
import { useLastAppUrl } from "@/lib/shell/use-last-app-url";
import { useShortcut } from "@/lib/shortcuts/provider";
import { cn } from "@/lib/utils";
import { AccountsPage } from "./accounts-page";
import { ApiPage } from "./api-page";
import { CategoriesPage } from "./categories-page";
import { EntitiesPage } from "./entities-page";
import { FxPage } from "./fx-page";
import { ImportsPage } from "./imports";
import { NotificationsPage } from "./notifications-page";
import { PluggyPage } from "./pluggy-page";
import { PrefsPage } from "./prefs-page";
import { RulesPage } from "./rules-page";

/**
 * Ajustes (mockup SettingsScreen, settingsShell=page): a full page with the
 * 220px nav (Conta, Finanças, Dados) and the page's title, description and
 * content. ?page= picks the page and ?id= the selected row of a list page.
 * "← Voltar ao app" and Esc (when nothing is focused for typing and no
 * overlay is open) go back to the last app URL.
 */
export function SettingsScreen() {
  const t = useTranslations("settings");
  const router = useRouter();
  const [params, setParams] = useQueryStates({ page: parseAsString, id: parseAsString });
  const page = resolveSettingsPage(params.page);
  const backHref = useLastAppUrl();
  useShortcut("escape", () => router.push(backHref), { scope: "screen" });

  return (
    <div className="grid h-dvh grid-cols-1 bg-editor text-fg-1 md:grid-cols-[220px_minmax(0,1fr)]">
      <nav className="flex gap-1 overflow-x-auto border-b border-stroke-3 bg-chrome p-2 md:flex-col md:gap-0.5 md:overflow-y-auto md:border-r md:border-b-0 md:p-2.5">
        <Link href={backHref} className="flex h-[30px] shrink-0 items-center gap-1.5 rounded-[6px] px-2 text-control text-fg-3 outline-none hover:text-fg-strong focus-visible:ring-2 focus-visible:ring-fg-3/40">
          {t("back")}
          <span className="hidden flex-1 md:block" />
          <Kbd className="hidden md:inline-flex">Esc</Kbd>
        </Link>
        <span className="hidden px-2 pt-1.5 pb-1 text-title-sm font-semibold md:block">{t("title")}</span>
        {SETTINGS_SECTIONS.map((section) => (
          <div key={section.section} className="flex shrink-0 flex-row gap-1 md:flex-col md:gap-0.5">
            <span className="hidden px-2 pt-3 pb-1 text-caption text-fg-3 md:block">{t(`sections.${section.section}`)}</span>
            {section.pages.map((key) => (
              <button
                key={key}
                type="button"
                aria-current={key === page ? "page" : undefined}
                onClick={() => void setParams({ page: key, id: null })}
                className={cn(
                  "flex h-(--cap-menu-row-h) shrink-0 items-center whitespace-nowrap rounded-[6px] px-2 text-left text-control outline-none focus-visible:ring-2 focus-visible:ring-fg-3/40",
                  key === page ? NAV_ON : NAV_OFF,
                )}
              >
                {t(`nav.${key}.title`)}
              </button>
            ))}
          </div>
        ))}
      </nav>
      <main className="flex min-w-0 flex-col gap-3.5 overflow-y-auto px-4 py-4 md:px-6 md:py-5">
        <div className="flex flex-col gap-[3px]">
          <h1 className="font-title text-heading font-medium">{t(`nav.${page}.title`)}</h1>
          <span className="text-body text-fg-3">{t(`nav.${page}.desc`)}</span>
        </div>
        <SettingsContent key={page} page={page} />
      </main>
    </div>
  );
}

function SettingsContent({ page }: { page: SettingsPage }) {
  switch (page) {
    case "prefs":
      return <PrefsPage />;
    case "notif":
      return <NotificationsPage />;
    case "ent":
      return <EntitiesPage />;
    case "bank":
    case "card":
    case "broker":
      return <AccountsPage kind={page} />;
    case "cat":
      return <CategoriesPage />;
    case "rules":
      return <RulesPage />;
    case "fx":
      return <FxPage />;
    case "imports":
      return <ImportsContent />;
    case "pluggy":
      return <PluggyPage />;
    case "api":
      return <ApiPage />;
  }
}

/** Importações is the import slice's page (src/components/settings/imports.tsx). */
function ImportsContent() {
  const names = useNames();
  return <ImportsPage names={names} />;
}
