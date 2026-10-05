"use client";

import type { ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useTheme } from "next-themes";
import { DropdownMenu } from "radix-ui";
import { CheckIcon } from "lucide-react";
import { FLOATING, MENU_ROW } from "@/components/cap/styles";
import { usePathname, useRouter } from "@/i18n/navigation";
import { isLocale, routing, type Locale } from "@/i18n/routing";
import { apiPatch } from "@/lib/api/client";
import { useSession, useSignOut } from "@/lib/api/session";
import { useAppMutation } from "@/lib/api/use-app-mutation";
import { rememberAppUrl, sessionStore } from "@/lib/shell/last-app-url";
import { SETTINGS_PATH, SHELL_SHORTCUTS } from "@/lib/shell/shortcuts";
import { firstName } from "@/lib/shell/user";
import { parseThemePreference, THEME_PREFERENCES, type ThemePreference } from "@/lib/theme/preference";
import { OverlayScope, useOverlayRoot, useShortcutLabel } from "@/lib/shortcuts/provider";
import { cn } from "@/lib/utils";

const LANGUAGE_KEY: Record<Locale, "ptBR" | "en"> = { "pt-BR": "ptBR", en: "en" };

/**
 * Ajustes from the app: remembers the current URL for "← Voltar ao app"
 * (the shell also does it on every navigation; nuqs may have changed the
 * query since) and opens the settings page. Used by ⌘, and the user menu.
 */
export function useOpenSettings(): () => void {
  const router = useRouter();
  return () => {
    rememberAppUrl(sessionStore(), `${window.location.pathname}${window.location.search}`);
    router.push(SETTINGS_PATH);
  };
}

/**
 * The account menu on the sidebar footer (the mockup's "Ajustes · Tema"
 * block): Ajustes ⌘, · Tema (Sistema / Claro / Escuro) · Idioma · Sair.
 * Theme and language are saved on the user (PATCH /v2/me) and applied
 * at once. `trigger` is the footer block itself, rendered as the Radix
 * trigger (a button that forwards ref and props).
 */
export function UserMenu({ trigger, side = "top", onNavigate }: { trigger: ReactNode; side?: "top" | "right"; onNavigate?: () => void }) {
  const t = useTranslations("shell.userMenu");
  const root = useOverlayRoot({});
  const session = useSession();
  const signOut = useSignOut();
  const openSettings = useOpenSettings();
  const settingsLabel = useShortcutLabel(SHELL_SHORTCUTS.settings.combo);
  const { theme: activeTheme, setTheme } = useTheme();
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();

  const theme = parseThemePreference(activeTheme) ?? parseThemePreference(session.data?.theme) ?? "light";
  const saveTheme = useAppMutation({
    event: "me.write",
    mutationFn: (next: { theme: ThemePreference; previous: ThemePreference }) => apiPatch("/api/v2/me", { theme: next.theme }),
    // Applied before the request; back to the previous theme when it fails.
    onError: (_error, next) => setTheme(next.previous),
  });
  const saveLocale = useAppMutation({
    event: "me.write",
    mutationFn: (next: Locale) => apiPatch("/api/v2/me", { locale: next }),
    // Saved first, so the language sticks; next-intl's router then switches the page (and its cookie).
    onSuccess: (_data, next) => router.replace(`${pathname}${window.location.search}`, { locale: next }),
  });

  const pickTheme = (value: string) => {
    const next = parseThemePreference(value);
    if (!next || next === theme) return;
    setTheme(next);
    saveTheme.mutate({ theme: next, previous: theme });
  };
  const pickLocale = (value: string) => {
    if (!isLocale(value) || value === locale) return;
    saveLocale.mutate(value);
  };

  return (
    <DropdownMenu.Root open={root.open} onOpenChange={root.onOpenChange} modal={false}>
      <DropdownMenu.Trigger asChild>{trigger}</DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          side={side}
          align={side === "top" ? "start" : "end"}
          sideOffset={4}
          collisionPadding={8}
          aria-label={t("label", { name: firstName(session.data?.name, session.data?.email) })}
          style={{ width: 210 }}
          className={cn(FLOATING, "rounded-[8px] p-1")}
        >
          <OverlayScope id={root.overlayId}>
            <DropdownMenu.Item
              className={cn(MENU_ROW, "text-fg-1")}
              onSelect={() => {
                onNavigate?.();
                openSettings();
              }}
            >
              <span className="min-w-0 flex-1 truncate">{t("settings")}</span>
              <span className="shrink-0 font-mono text-[10.5px] text-fg-4">{settingsLabel}</span>
            </DropdownMenu.Item>
            <SubMenu label={t("theme")} value={t(`themes.${theme}`)}>
              <DropdownMenu.RadioGroup value={theme} onValueChange={pickTheme}>
                {THEME_PREFERENCES.map((option) => (
                  <Choice key={option} value={option} label={t(`themes.${option}`)} />
                ))}
              </DropdownMenu.RadioGroup>
            </SubMenu>
            <SubMenu label={t("language")} value={isLocale(locale) ? t(`languages.${LANGUAGE_KEY[locale]}`) : locale}>
              <DropdownMenu.RadioGroup value={locale} onValueChange={pickLocale}>
                {routing.locales.map((option) => (
                  <Choice key={option} value={option} label={t(`languages.${LANGUAGE_KEY[option]}`)} lang={option} disabled={saveLocale.isPending} />
                ))}
              </DropdownMenu.RadioGroup>
            </SubMenu>
            <DropdownMenu.Separator className="my-1 h-px bg-stroke-3" />
            <DropdownMenu.Item className={cn(MENU_ROW, "text-fg-1")} onSelect={signOut}>
              <span className="min-w-0 flex-1 truncate">{t("signOut")}</span>
            </DropdownMenu.Item>
          </OverlayScope>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/** A row that opens a side menu, showing the current value ("Tema   Claro ›"). */
function SubMenu({ label, value, children }: { label: string; value: string; children: ReactNode }) {
  return (
    <DropdownMenu.Sub>
      <DropdownMenu.SubTrigger className={cn(MENU_ROW, "text-fg-1 data-[state=open]:bg-fill-3")}>
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <span className="shrink-0 text-[12px] text-fg-3">{value}</span>
        <span aria-hidden className="shrink-0 text-[11px] text-fg-3">
          ›
        </span>
      </DropdownMenu.SubTrigger>
      <DropdownMenu.Portal>
        <DropdownMenu.SubContent sideOffset={6} collisionPadding={8} style={{ width: 160 }} className={cn(FLOATING, "rounded-[8px] p-1")}>
          {children}
        </DropdownMenu.SubContent>
      </DropdownMenu.Portal>
    </DropdownMenu.Sub>
  );
}

function Choice({ value, label, lang, disabled }: { value: string; label: string; lang?: string; disabled?: boolean }) {
  return (
    <DropdownMenu.RadioItem value={value} disabled={disabled} className={cn(MENU_ROW, "text-fg-1")}>
      <span lang={lang} className="min-w-0 flex-1 truncate">
        {label}
      </span>
      <DropdownMenu.ItemIndicator>
        <CheckIcon className="size-3.5" />
      </DropdownMenu.ItemIndicator>
    </DropdownMenu.RadioItem>
  );
}
