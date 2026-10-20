import { expect, type Locator, type Page } from "@playwright/test";
import { commandPalette, dialog, openBudgets, settingsNav } from "../helpers";

/**
 * The validation-package tour: every screen a user reaches once signed in,
 * in sidebar order, then Ajustes and the 404. Each screen is one `check`,
 * so the recording keeps a frame and a full-resolution screenshot of it.
 * A screen added to the app is added here.
 */
export interface Screen {
  /** Shown as the scene title for the first screen of each group. */
  group: string;
  name: string;
  open: (page: Page) => Promise<void>;
  /** Something only that screen shows once it has loaded. */
  ready: (page: Page) => Locator;
  /** Closes what `open` left on top (a dialog, the palette). */
  close?: (page: Page) => Promise<void>;
}

const escape = async (page: Page) => {
  await page.keyboard.press("Escape");
};

/** A saved view of Transações, opened from the sidebar. */
const view = (name: string): Screen => ({
  group: "Transações",
  name: `Transações · ${name}`,
  open: async (page) => {
    await page.getByRole("complementary").getByRole("link", { name, exact: true }).click();
  },
  ready: (page) => page.locator("header").getByText(name, { exact: true }),
});

const SETTINGS: string[] = [
  "Perfil e preferências",
  "Notificações",
  "Negócios e PF",
  "Contas bancárias",
  "Cartões de crédito",
  "Corretoras",
  "Categorias",
  "Regras de categorização",
  "Moedas e câmbio",
  "Importações",
  "Open Finance",
  "Integrações e API",
];

export const SCREENS: Screen[] = [
  {
    group: "Transações",
    name: "Transações · Todas",
    open: async (page) => {
      await page.goto("/transactions");
    },
    ready: (page) => page.locator("header").getByText("Todas", { exact: true }),
  },
  ...["PJ", "Assinaturas", "Dedutíveis IR", "Gastos por categoria", "Gastos por mês"].map(view),
  {
    group: "Transações",
    name: "Nova transação",
    open: async (page) => {
      await page.goto("/transactions");
      await page.getByRole("button", { name: "+ Nova transação" }).click();
    },
    ready: (page) => page.getByRole("dialog"),
    close: escape,
  },
  {
    group: "Transações",
    name: "Buscar ou executar (⌘K)",
    open: async (page) => {
      await commandPalette(page).open();
    },
    ready: (page) => commandPalette(page).root,
    close: escape,
  },
  {
    group: "Transações",
    name: "Assistente",
    open: async (page) => {
      await page.goto("/transactions?assistant=1");
    },
    ready: (page) => page.getByText("Pergunte sobre as suas finanças"),
    close: escape,
  },
  {
    group: "Orçamentos",
    name: "Orçamentos · mês",
    open: openBudgets,
    ready: (page) => page.getByText("Contas fixas · próximos 14 dias"),
  },
  {
    group: "Orçamentos",
    name: "Orçamentos · ano",
    open: async (page) => {
      await page.getByRole("radio", { name: "Anual" }).click();
    },
    ready: (page) => page.getByRole("radio", { name: "Anual" }),
  },
  {
    group: "Investimentos",
    name: "Carteira",
    open: async (page) => {
      await page.goto("/investments");
    },
    ready: (page) => page.getByText("Patrimônio vs total aportado", { exact: true }),
  },
  {
    group: "Investimentos",
    name: "Carteira · ficha do ativo",
    open: async (page) => {
      await page.getByRole("button", { name: /^BOVA11 / }).click();
    },
    ready: (page) => dialog(page, /^BOVA11 /),
    close: escape,
  },
  {
    group: "Investimentos",
    name: "Carteira · nova operação",
    open: async (page) => {
      await page.getByRole("button", { name: "+ Operação" }).click();
    },
    ready: (page) => dialog(page, "Nova operação"),
    close: escape,
  },
  {
    group: "Investimentos",
    name: "Aportes",
    open: async (page) => {
      await page.goto("/investments/contributions");
    },
    ready: (page) => page.getByText("Onde aportar este mês", { exact: true }),
  },
  {
    group: "Investimentos",
    name: "Aportes · todos os aportes",
    open: async (page) => {
      await page.getByRole("tab", { name: "Todos os aportes" }).click();
    },
    ready: (page) => page.getByRole("tab", { name: "Todos os aportes", selected: true }),
  },
  {
    group: "Investimentos",
    name: "Liberdade financeira",
    open: async (page) => {
      await page.goto("/investments/fire");
    },
    ready: (page) => page.getByRole("img", { name: /^Corte do tronco/ }),
  },
  {
    group: "Investimentos",
    name: "Liberdade financeira · anéis e marcos",
    open: async (page) => {
      await page.getByRole("heading", { name: "Marcos no caminho" }).scrollIntoViewIfNeeded();
    },
    ready: (page) => page.getByRole("heading", { name: "Um anel por ano" }),
  },
  {
    group: "Investimentos",
    name: "Liberdade financeira · novo marco",
    open: async (page) => {
      await page.getByRole("button", { name: "+ Marco" }).click();
    },
    ready: (page) => dialog(page, "Novo marco"),
    close: escape,
  },
  ...SETTINGS.map(
    (title, index): Screen => ({
      group: "Ajustes",
      name: `Ajustes · ${title}`,
      open: async (page) => {
        if (index === 0) await page.goto("/settings");
        await settingsNav(page, title).click();
      },
      ready: (page) => page.getByRole("main").getByRole("heading", { name: title }).first(),
    }),
  ),
  {
    group: "Outros",
    name: "Página não encontrada",
    open: async (page) => {
      await page.goto("/pagina-que-nao-existe");
    },
    ready: (page) => page.getByRole("heading", { name: "Página não encontrada" }),
  },
];

/** Plays every screen: a scene per group, a check (frame and screenshot) per screen. */
export async function tour(
  page: Page,
  theme: "claro" | "escuro",
  { scene, check }: { scene: (title: string, description?: string) => Promise<void>; check: (claim: string, assertion: () => Promise<void>) => Promise<void> },
): Promise<void> {
  let group = "";
  for (const screen of SCREENS) {
    if (screen.group !== group) {
      group = screen.group;
      await scene(`${group} · tema ${theme}`);
    }
    await screen.open(page);
    await check(`${screen.name} · ${theme}`, async () => {
      await expect(screen.ready(page)).toBeVisible();
    });
    if (screen.close) {
      await screen.close(page);
      await expect(page.getByRole("dialog")).toHaveCount(0);
    }
  }
}

/** Sets Ajustes › Tema, the way a user does. */
export async function setTheme(page: Page, theme: "Claro" | "Escuro"): Promise<void> {
  await page.goto("/settings");
  await page.getByRole("radiogroup", { name: "Tema" }).getByRole("radio", { name: theme }).click();
  await expect(page.locator("html")).toHaveClass(theme === "Escuro" ? /\bdark\b/ : /^(?!.*\bdark\b)/);
}
