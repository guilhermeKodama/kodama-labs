"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Field, Segmented, Select, TextInput } from "@/components/cap";
import { usePathname, useRouter } from "@/i18n/navigation";
import { useCurrencies } from "@/lib/api/catalog";
import { apiPatch } from "@/lib/api/client";
import { useSession, type SessionUser } from "@/lib/api/session";
import { useAppMutation } from "@/lib/api/use-app-mutation";
import { APP_LOCALES, DATE_FORMATS, NUMBER_FORMATS, normalizeDateFormat, normalizeLocale, normalizeNumberFormat, type AppLocale } from "@/lib/format/prefs";
import { THEME_PREFERENCES, parseThemePreference, type ThemePreference } from "@/lib/theme/preference";
import { useBaseCurrencyChange } from "./base-currency";

type MePatch = Partial<Pick<SessionUser, "name" | "theme" | "dateFormat" | "numberFormat" | "timezone">> & { locale?: AppLocale };

/**
 * Perfil e preferências: every field saves on its own (no Salvar). Formats,
 * theme and language only touch the session; the time zone and the base
 * currency change how periods and totals are computed.
 */
export function PrefsPage() {
  const t = useTranslations("settings.prefs");
  const me = useSession().data;
  const currencies = useCurrencies();
  const router = useRouter();
  const pathname = usePathname();
  const base = useBaseCurrencyChange();
  const [nameDraft, setNameDraft] = useState<string | null>(null);

  const saveDisplay = useAppMutation({ event: "me.write", mutationFn: (body: MePatch) => apiPatch<SessionUser>("/api/v2/me", body) });
  const saveTimezone = useAppMutation({ event: "settings.write", mutationFn: (timezone: string) => apiPatch<SessionUser>("/api/v2/me", { timezone }) });

  const timezone = me?.timezone;
  const zones = useMemo(() => {
    const list = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : ["America/Sao_Paulo", "America/New_York", "UTC"];
    return timezone && !list.includes(timezone) ? [timezone, ...list] : list;
  }, [timezone]);

  if (!me) return null;

  const commitName = () => {
    const name = nameDraft?.trim();
    setNameDraft(null);
    if (name && name !== me.name) saveDisplay.mutate({ name });
  };
  const changeLocale = (next: string) => {
    const locale = normalizeLocale(next);
    saveDisplay.mutate(
      { locale },
      {
        // Switches the UI language in place (next-intl writes the cookie and re-renders), keeping ?page=.
        onSuccess: () => router.replace(`${pathname}${window.location.search}`, { locale }),
      },
    );
  };
  const currencyCodes = currencies.data?.currencies.map((c) => c.code) ?? [me.baseCurrency];

  return (
    <div className="grid max-w-[560px] grid-cols-2 gap-3">
      <Field label={t("name")} htmlFor="prefs-name">
        <TextInput
          id="prefs-name"
          value={nameDraft ?? me.name}
          onChange={setNameDraft}
          onBlur={commitName}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
        />
      </Field>
      <Field label={t("email")} htmlFor="prefs-email">
        <TextInput id="prefs-email" value={me.email} onChange={() => undefined} disabled readOnly />
      </Field>
      <Field label={t("baseCurrency")} hint={t("baseCurrencyHint")}>
        <Select
          aria-label={t("baseCurrency")}
          value={me.baseCurrency}
          onChange={base.change}
          disabled={base.saving}
          options={(currencyCodes.includes(me.baseCurrency) ? currencyCodes : [me.baseCurrency, ...currencyCodes]).map((code) => ({ value: code, label: code }))}
        />
      </Field>
      <Field label={t("timezone")}>
        <Select aria-label={t("timezone")} value={me.timezone} onChange={(timezone) => saveTimezone.mutate(timezone)} options={zones.map((zone) => ({ value: zone, label: zone }))} />
      </Field>
      <Field label={t("dateFormat")}>
        <Select
          aria-label={t("dateFormat")}
          value={normalizeDateFormat(me.dateFormat)}
          onChange={(dateFormat) => saveDisplay.mutate({ dateFormat })}
          options={DATE_FORMATS.map((format) => ({ value: format, label: format }))}
        />
      </Field>
      <Field label={t("numberFormat")}>
        <Select
          aria-label={t("numberFormat")}
          value={normalizeNumberFormat(me.numberFormat)}
          onChange={(numberFormat) => saveDisplay.mutate({ numberFormat })}
          options={NUMBER_FORMATS.map((format) => ({ value: format, label: t(`numberFormats.${format}`) }))}
        />
      </Field>
      <Field label={t("theme")}>
        <Segmented<ThemePreference>
          aria-label={t("theme")}
          value={parseThemePreference(me.theme) ?? "light"}
          options={THEME_PREFERENCES.map((v) => ({ v, l: t(`themes.${v}`) })).sort((a, b) => ORDER.indexOf(a.v) - ORDER.indexOf(b.v))}
          onChange={(theme) => saveDisplay.mutate({ theme })}
        />
      </Field>
      <Field label={t("language")}>
        <Select
          aria-label={t("language")}
          value={normalizeLocale(me.locale)}
          onChange={changeLocale}
          options={APP_LOCALES.map((locale) => ({ value: locale, label: t(`languages.${locale}`) }))}
        />
      </Field>
      {base.dialog}
    </div>
  );
}

/** Mockup order: Sistema, Claro, Escuro. */
const ORDER: ThemePreference[] = ["system", "light", "dark"];
