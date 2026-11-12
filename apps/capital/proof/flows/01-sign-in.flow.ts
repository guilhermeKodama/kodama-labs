import { expect, flow } from "@repo/proof-video";

// This flow signs in on camera, so it starts without the saved session.
flow.use({ storageState: { cookies: [], origins: [] } });

flow("Sign in and sign out", async ({ page, scene, say, check, type, typeSecret }) => {
  await scene("Sign in", "Cerne shows nothing without a session");
  await page.goto("/transactions");
  await check("Without a session, the app sends you to the sign-in page", async () => {
    await expect(page).toHaveURL(/\/login\?redirect=/);
    await expect(page.getByRole("heading", { name: "Entrar" })).toBeVisible();
  });
  await check("The sign-in card carries the Cerne rings and name", async () => {
    await expect(page).toHaveTitle("Entrar · Cerne");
    await expect(page.locator("form").getByText("cerne", { exact: true })).toBeVisible();
  });

  await say("Sign in as the demo user");
  await type(page.locator("#auth-email"), process.env.PROOF_DEMO_EMAIL ?? "");
  await typeSecret(page.locator("#auth-password"), process.env.PROOF_DEMO_PASSWORD ?? "");
  await page.getByRole("button", { name: "Entrar" }).click();
  await check("After signing in, the app opens Transações", async () => {
    await expect(page).toHaveURL(/\/transactions/);
    await expect(page.getByRole("link", { name: "Carteira" })).toBeVisible();
  });

  await scene("Sign out");
  await say("The account menu sits at the foot of the sidebar");
  await page.getByRole("button", { name: /Ajustes · Tema/ }).click();
  await page.getByRole("menuitem", { name: "Sair" }).click();
  await check("Signing out returns to the sign-in page", async () => {
    await expect(page).toHaveURL(/\/login/);
  });
  await page.goto("/transactions");
  await check("The session is gone: Transações asks to sign in again", async () => {
    await expect(page).toHaveURL(/\/login\?redirect=/);
  });
});
