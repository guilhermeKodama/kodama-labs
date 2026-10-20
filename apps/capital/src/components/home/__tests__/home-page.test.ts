import { createElement, type ComponentProps, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import enHome from "@/messages/en/home.json";
import ptHome from "@/messages/pt-BR/home.json";

vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => createElement("a", { href, ...rest }, children),
}));

const { HomePage } = await import("../home-page");

function render(locale: "pt-BR" | "en"): string {
  const intl: ComponentProps<typeof NextIntlClientProvider> = {
    locale,
    messages: { home: locale === "en" ? enHome : ptHome },
    timeZone: "America/Sao_Paulo",
    children: null,
  };
  return renderToStaticMarkup(createElement(NextIntlClientProvider, intl, createElement(HomePage)));
}

describe("HomePage", () => {
  const html = render("pt-BR");

  it("leads with the canvas headline and a screenshot of the app in each theme", () => {
    expect(html).toContain("Patrimônio se faz em anéis.");
    expect(html).toMatch(/<img[^>]*alt="A tela de transações do Cerne"[^>]*app-claro\.webp/);
    expect(html).toMatch(/<img[^>]*app-escuro\.webp/);
  });

  it("has a section for every anchor the header links to", () => {
    for (const id of ["como", "recursos", "liberdade", "controle", "acesso"]) {
      expect(html).toContain(`href="#${id}"`);
      expect(html).toContain(`id="${id}"`);
    }
  });

  it("signs in on /login and asks for access by email, with no field that collects anything", () => {
    expect(html).toContain('href="/login"');
    expect(html).toContain('href="mailto:contato@kodamavending.com.br?subject=Acesso%20antecipado%20ao%20Cerne"');
    expect(html).not.toMatch(/<(input|form|button)\b/);
  });

  it("speaks English too", () => {
    expect(render("en")).toContain("Wealth grows in rings.");
  });
});
