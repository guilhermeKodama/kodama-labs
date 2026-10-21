import { expect, flow } from "@repo/proof-video";
import { openTransactions } from "../helpers";

// A desktop window made narrow: phone width, but a mouse (no touch screen).
flow.use({ viewport: { width: 600, height: 900 }, hasTouch: false, isMobile: false });

flow("A narrow desktop window gets the phone bar with a full-size menu button", async ({ page, scene, check }) => {
  await scene("Janela estreita no desktop", "The phone layout follows the width, with a mouse too");
  await openTransactions(page);
  const header = page.getByRole("main").locator("header").first();
  const menuButton = header.getByRole("button", { name: "Abrir o menu" });
  await check("▤ is a 44px button with the menu icon", async () => {
    const box = (await menuButton.boundingBox())!;
    expect(Math.min(box.width, box.height)).toBeGreaterThanOrEqual(44);
    await expect(menuButton.locator("svg")).toBeVisible();
  });
  await check("⋯ and the floating button are there too", async () => {
    await expect(header.getByRole("button", { name: "Mais ações" })).toBeVisible();
    await expect(page.locator("[data-fab]")).toHaveText("Nova transação");
  });
});
