import fs from "node:fs";
import path from "node:path";
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

  it("leads with the canvas headline and the rings screen in each theme", () => {
    expect(html).toContain("Patrimônio se faz em anéis.");
    expect(html).toMatch(/<img[^>]*alt="A tela de Liberdade financeira do Cerne[^"]*"[^>]*aneis-claro\.webp/);
    expect(html).toMatch(/<img[^>]*aneis-escuro\.webp/);
  });

  it("explains PF + PJ next to the transactions screen, and shows the real freedom panel", () => {
    expect(html).toContain("Duas contas, um patrimônio.");
    expect(html).toMatch(/<img[^>]*alt="A tela de transações do Cerne[^"]*"[^>]*livro-claro\.webp/);
    expect(html).toMatch(/<img[^>]*alt="O painel da Liberdade financeira[^"]*"[^>]*painel-claro\.webp/);
    for (const name of ["aneis", "aneis-corte", "livro", "painel"]) {
      for (const theme of ["claro", "escuro"]) {
        expect(fs.existsSync(path.resolve(__dirname, `../../../../public/home/${name}-${theme}.webp`))).toBe(true);
      }
    }
  });

  it("has a section for every anchor the header links to", () => {
    for (const id of ["juntos", "como", "recursos", "liberdade", "controle", "acesso"]) {
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
