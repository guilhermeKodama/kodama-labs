import { expect, flow } from "@repo/proof-video";

// The way in, before any session.
flow.use({ storageState: { cookies: [], origins: [] } });

flow("Validation package: the way in", async ({ page, scene, check, type, typeSecret }) => {
  await scene("Entrada", "Sign-in and sign-up, before any session");
  await page.goto("/login");
  await check("Entrar · claro", async () => {
    await expect(page.getByRole("heading", { name: "Entrar" })).toBeVisible();
  });
  await page.getByRole("link", { name: "Criar uma conta" }).click();
  await check("Criar conta · claro", async () => {
    await expect(page.getByRole("heading", { name: "Criar conta" })).toBeVisible();
  });
  await page.getByRole("link", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole("heading", { name: "Entrar" })).toBeVisible();
  await type(page.locator("#auth-email"), process.env.PROOF_DEMO_EMAIL ?? "");
  await typeSecret(page.locator("#auth-password"), process.env.PROOF_DEMO_PASSWORD ?? "");
  await page.getByRole("button", { name: "Entrar" }).click();
  await check("Signed in, the app opens Transações", async () => {
    await expect(page).toHaveURL(/\/transactions/);
  });
});
