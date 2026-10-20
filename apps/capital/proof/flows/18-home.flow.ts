import { expect, flow } from "@repo/proof-video";

// A visitor: no session.
flow.use({ storageState: { cookies: [], origins: [] } });

flow("The homepage: the rings up front, PF + PJ in one net worth, and the way in", async ({ page, scene, say, check }) => {
  await scene("The homepage", "Cerne's address now opens on the product, not on a sign-in form");
  await page.goto("/");
  await check("/ shows the homepage to a visitor, with the rings screen under the headline", async () => {
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Patrimônio se faz em anéis.");
    const rings = page.getByRole("img", { name: /^A tela de Liberdade financeira do Cerne/ });
    await expect(rings.first()).toBeVisible();
    await expect(rings.first()).toHaveAttribute("src", /aneis-claro\.webp/);
  });
  await say("The lead says what Cerne is for: company and personal life in one ledger, to reach financial freedom");
  await check("The lead talks about consolidating PF and PJ", async () => {
    await expect(page.getByText(/^Sua empresa e sua vida pessoal num livro só\./)).toBeVisible();
  });

  await scene("PF + PJ", "Why bring the company and the person together");
  await page.getByRole("navigation", { name: "Seções" }).getByRole("link", { name: "PF + PJ" }).click();
  const together = page.locator("#juntos");
  await check("PF + PJ scrolls to “Duas contas, um patrimônio.”, with the three reasons", async () => {
    await expect(page).toHaveURL(/#juntos$/);
    await expect(together.getByRole("heading", { name: "Duas contas, um patrimônio." })).toBeInViewport();
    for (const reason of ["Separado, o dinheiro some no caminho", "Junto, tudo fecha", "E o plano usa o todo"]) {
      await expect(together.getByRole("heading", { name: reason })).toBeVisible();
    }
  });
  await say("Next to them, Transações with a profit distribution from the company to the person");
  await together.getByRole("img").first().scrollIntoViewIfNeeded();
  await check("The section shows the transactions screen, PF and company entries together", async () => {
    await expect(together.getByRole("img", { name: /^A tela de transações do Cerne/ }).first()).toBeInViewport();
  });

  await scene("Liberdade financeira", "The plan, shown with the real screen");
  await page.getByRole("navigation", { name: "Seções" }).getByRole("link", { name: "Liberdade financeira" }).click();
  const freedom = page.locator("#liberdade");
  await check("Liberdade financeira shows the real panel with demo data, not an illustration", async () => {
    await expect(page).toHaveURL(/#liberdade$/);
    await expect(page.getByRole("heading", { name: "Um plano, não só um gráfico." })).toBeInViewport();
    await expect(freedom.getByRole("img", { name: /^O painel da Liberdade financeira/ }).first()).toBeVisible();
    await expect(freedom.getByText("Tela real, com dados de demonstração.")).toBeVisible();
  });

  await scene("Asking for access", "Cerne is not open yet: the request is an email to the team");
  await page.getByRole("link", { name: "Pedir acesso" }).first().click();
  const access = page.locator("#acesso");
  await check("Pedir acesso antecipado writes to contato@kodamavending.com.br", async () => {
    await expect(access.getByRole("heading", { name: "Comece o primeiro anel." })).toBeInViewport();
    await expect(access.getByRole("link", { name: "Pedir acesso antecipado" })).toHaveAttribute("href", "mailto:contato@kodamavending.com.br?subject=Acesso%20antecipado%20ao%20Cerne");
  });

  await scene("Entrar", "The header's Entrar opens the sign-in page");
  await page.getByRole("banner").getByRole("link", { name: "Entrar" }).click();
  await check("Entrar opens the sign-in page", async () => {
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("heading", { name: "Entrar" })).toBeVisible();
  });
});
