import { createElement, type ComponentProps, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";
import { FireGoalPhaseList } from "@/components/invest/dialogs";
import type { ContributionPhase } from "@/lib/fire/types";
import enInvest from "@/messages/en/invest.json";
import ptInvest from "@/messages/pt-BR/invest.json";

type Locale = "pt-BR" | "en";
const MESSAGES = {
  "pt-BR": { invest: ptInvest },
  en: { invest: enInvest },
};

function render(locale: Locale, element: ReactElement): string {
  const intl: ComponentProps<typeof NextIntlClientProvider> = {
    locale,
    messages: MESSAGES[locale],
    timeZone: "America/Sao_Paulo",
    children: null,
  };
  return renderToStaticMarkup(createElement(NextIntlClientProvider, intl, element));
}

const phases: ContributionPhase[] = [
  { fromMonth: 0, toMonth: 15, monthlyContribution: 15_000, label: "curto" },
  { fromMonth: 15, toMonth: null, monthlyContribution: 8_000, label: "depois" },
];

describe("FireGoalPhaseList", () => {
  it("badges only the phase that covers month 0", () => {
    const html = render(
      "pt-BR",
      createElement(FireGoalPhaseList, {
        phases,
        amounts: ["15.000", "8.000"],
        currentIndex: 0,
        byDateNote: null,
        onAmount: () => undefined,
      }),
    );
    expect(html.match(/data-current-phase="true"/g)).toHaveLength(1);
    expect(html).toContain("Fase atual");
    expect(html.match(/Fase atual/g)).toHaveLength(1);
    expect(html).toContain("curto");
    expect(html).toContain("depois");
    expect(html).toContain("Do mês 0, por 15 meses");
    expect(html).toContain("A partir do mês 15");
    expect(html).not.toContain("Salvar o aporte passa a valer o valor digitado");

    const en = render(
      "en",
      createElement(FireGoalPhaseList, {
        phases,
        amounts: ["15,000", "8,000"],
        currentIndex: 0,
        byDateNote: "Saving the contribution makes the typed amount the plan; the date stops setting the contribution.",
        onAmount: () => undefined,
      }),
    );
    expect(en.match(/data-current-phase="true"/g)).toHaveLength(1);
    expect(en).toContain("Current phase");
    expect(en).toContain("Saving the contribution makes the typed amount the plan");
  });
});
