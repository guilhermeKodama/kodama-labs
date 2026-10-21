import { expect, flow } from "@repo/proof-video";

// A visitor on an iPhone 17 Pro: 402 × 874 pt, a touch screen.
flow.use({ storageState: { cookies: [], origins: [] }, viewport: { width: 402, height: 874 }, hasTouch: true, isMobile: true });

flow("The sign-in page on a phone: centered, with finger-sized fields", async ({ page, scene, check }) => {
  await scene("Entrar no celular", "The card sat near the top, as on a desktop");
  await page.goto("/login");
  const card = page.locator("form").filter({ has: page.getByRole("heading", { name: "Entrar" }) });
  await check("The card is centered on the screen", async () => {
    await expect(card).toBeVisible();
    const box = (await card.boundingBox())!;
    const above = box.y;
    const below = 874 - (box.y + box.height);
    expect(Math.abs(above - below)).toBeLessThanOrEqual(24);
    expect(Math.abs(box.x - (402 - box.x - box.width))).toBeLessThanOrEqual(2);
  });
  await check("Fields and Entrar are finger-sized", async () => {
    expect((await card.getByLabel("E-mail").boundingBox())!.height).toBeGreaterThanOrEqual(40);
    expect((await card.getByRole("button", { name: "Entrar" }).boundingBox())!.height).toBeGreaterThanOrEqual(40);
  });
});
