import { expect, flow } from "@repo/proof-video";

flow("Cerne identity: the name, the rings, the icons and the export", async ({ page, scene, say, check }) => {
  await page.goto("/transactions");

  await scene("O nome", "Capital is now Cerne wherever the user reads it");
  await check("The tab title and the sidebar say cerne, next to the rings", async () => {
    await expect(page).toHaveTitle("Cerne");
    const aside = page.locator("aside");
    await expect(aside.getByText("cerne", { exact: true })).toBeVisible();
    await expect(aside.locator("svg circle")).not.toHaveCount(0);
  });

  await scene("O ícone", "The app icon and the installable app carry the rings");
  await say("The icon the phone shows on the home screen");
  await page.goto("/icon-512.png?v=3");
  await check("The 512px app icon is served", async () => {
    const size = await page.locator("img").evaluate((img: HTMLImageElement) => [img.naturalWidth, img.naturalHeight]);
    expect(size).toEqual([512, 512]);
  });
  await say("The manifest names the app Cerne and offers a maskable icon");
  await page.goto("/manifest.webmanifest");
  await check("The manifest is named Cerne and lists the maskable icon", async () => {
    await expect(page.locator("body")).toContainText('"short_name":"Cerne"');
    await expect(page.locator("body")).toContainText('"purpose":"maskable"');
  });

  await scene("O export", "A CSV export downloads as a Cerne file");
  await page.goto("/transactions");
  await say("Select one row and export it");
  await page.getByRole("checkbox", { name: "Selecionar linha" }).first().click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Exportar" }).click();
  await check("The export is saved as cerne-export.csv", async () => {
    expect((await download).suggestedFilename()).toBe("cerne-export.csv");
  });
  await page.keyboard.press("Escape");
});
