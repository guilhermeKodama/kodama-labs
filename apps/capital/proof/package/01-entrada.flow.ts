import { expect, flow } from "@repo/proof-video";

// The way in, before any session.
flow.use({ storageState: { cookies: [], origins: [] } });

flow("Validation package: the way in", async ({ page, scene, check, type, typeSecret }) => {
  await scene("Entrada", "The homepage, sign-in, and sign-up while it is closed, before any session");
  await page.goto("/");
  await check("Homepage · claro", async () => {
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Patrimônio se faz em anéis.");
  });
  await page.goto("/login");
  await check("Entrar · claro", async () => {
    await expect(page.getByRole("heading", { name: "Entrar" })).toBeVisible();
  });
  await page.goto("/signup");
  await check("Cadastro fechado · claro", async () => {
    await expect(page.getByRole("heading", { name: "O Cerne ainda não está aberto" })).toBeVisible();
  });
  await page.getByRole("link", { name: "Já tem conta? Entrar" }).click();
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole("heading", { name: "Entrar" })).toBeVisible();
  await type(page.locator("#auth-email"), process.env.PROOF_DEMO_EMAIL ?? "");
  await typeSecret(page.locator("#auth-password"), process.env.PROOF_DEMO_PASSWORD ?? "");
  await page.getByRole("button", { name: "Entrar" }).click();
  await check("Signed in, the app opens Transações", async () => {
    await expect(page).toHaveURL(/\/transactions/);
  });
});
