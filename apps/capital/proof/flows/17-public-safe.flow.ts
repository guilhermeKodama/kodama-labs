import { expect, flow } from "@repo/proof-video";

// What a stranger meets once Cloudflare Access is gone: no session, and no Access in front.
flow.use({ storageState: { cookies: [], origins: [] } });

/** A documentation address (RFC 5737) per run, so the wrong attempts below never lock the demo user. */
const ADDRESS = `203.0.113.${Math.floor(Math.random() * 250) + 1}`;
const STRANGER = "ninguem@capital.test";

flow("Safe without Cloudflare Access: closed sign-up, a sign-in limit and private files", async ({ page, scene, say, check, type }) => {
  await page.setExtraHTTPHeaders({ "cf-connecting-ip": ADDRESS });

  await scene("Sign-up is closed", "Cerne is not open yet, so nobody can create an account");
  await page.goto("/login");
  await check("The sign-in card no longer offers to create an account", async () => {
    await expect(page.getByRole("heading", { name: "Entrar" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Criar uma conta" })).toHaveCount(0);
  });
  await page.goto("/signup");
  await check("/signup says Cerne is not open and gives the contact address", async () => {
    await expect(page.getByRole("heading", { name: "O Cerne ainda não está aberto" })).toBeVisible();
    await expect(page.getByRole("link", { name: "contato@kodamavending.com.br" })).toHaveAttribute("href", "mailto:contato@kodamavending.com.br");
    await expect(page.locator("#auth-password")).toHaveCount(0);
  });

  await scene("A limit on wrong passwords", "Five wrong tries from one address, then it has to wait");
  await page.getByRole("link", { name: "Já tem conta? Entrar" }).click();
  await expect(page.getByRole("heading", { name: "Entrar" })).toBeVisible();
  await type(page.locator("#auth-email"), STRANGER);
  await type(page.locator("#auth-password"), "senha-errada");
  const submit = page.getByRole("button", { name: "Entrar" });
  const alert = page.locator("form").getByRole("alert");
  for (let attempt = 1; attempt <= 5; attempt++) {
    await submit.click();
    await expect(alert).toHaveText("E-mail ou senha incorretos.");
  }
  await say("The sixth try is refused before the password is even checked");
  await submit.click();
  await check("After five wrong passwords the form asks to wait 15 minutes", async () => {
    await expect(alert).toHaveText("Muitas tentativas erradas. Tente de novo em 15 minutos.");
  });

  await scene("Files stay private", "Receipts and statements need their owner's session");
  await page.goto("/api/blob/capital/qualquer/receipt/recibo.pdf");
  await check("A stored file asks for a session instead of answering", async () => {
    await expect(page.locator("body")).toContainText('"code":"auth.required"');
  });
});
