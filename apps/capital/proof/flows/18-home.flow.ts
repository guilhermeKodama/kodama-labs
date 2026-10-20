import { expect, flow } from "@repo/proof-video";

// A visitor: no session.
flow.use({ storageState: { cookies: [], origins: [] } });

flow("The homepage: what a visitor sees at /, and the way in", async ({ page, scene, say, check }) => {
  await scene("The homepage", "Cerne's address now opens on the product, not on a sign-in form");
  await page.goto("/");
  await check("/ shows the homepage to a visitor", async () => {
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Patrimônio se faz em anéis.");
    await expect(page.getByRole("img", { name: "A tela de transações do Cerne" }).first()).toBeVisible();
  });

  await say("The header's links go to their sections");
  await page.getByRole("navigation", { name: "Seções" }).getByRole("link", { name: "Liberdade financeira" }).click();
  await check("Liberdade financeira scrolls to its section", async () => {
    await expect(page).toHaveURL(/#liberdade$/);
    await expect(page.getByRole("heading", { name: "Um plano, não só um gráfico." })).toBeInViewport();
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
