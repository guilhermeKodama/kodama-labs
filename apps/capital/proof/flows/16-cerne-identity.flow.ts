import { expect, flow } from "@repo/proof-video";

flow("Cerne identity: the name, the rings, the icons under their own names and the export", async ({ page, scene, say, check }) => {
  await page.goto("/transactions");

  await scene("O nome", "Capital is now Cerne wherever the user reads it");
  await check("The tab title and the sidebar say cerne, next to the rings", async () => {
    await expect(page).toHaveTitle("Cerne");
    const aside = page.locator("aside");
    await expect(aside.getByText("cerne", { exact: true })).toBeVisible();
    await expect(aside.locator("svg circle")).not.toHaveCount(0);
  });

  await scene("O ícone", "The app icon and the installable app carry the rings, under file names of their own");
  await say("The iPhone takes its home-screen icon from this link, now a file named after the artwork");
  await check("The page points iOS at /icons/cerne-apple-180.png", async () => {
    await expect(page.locator('head link[rel="apple-touch-icon"]')).toHaveAttribute("href", "/icons/cerne-apple-180.png");
  });
  await say("The icon the phone shows on the home screen");
  await page.goto("/icons/cerne-512.png");
  await check("The 512px app icon is served at /icons/cerne-512.png", async () => {
    const size = await page.locator("img").evaluate((img: HTMLImageElement) => [img.naturalWidth, img.naturalHeight]);
    expect(size).toEqual([512, 512]);
  });
  await say("The manifest names the app Cerne and lists the renamed icons, so an installed app sees a new URL");
  await page.goto("/manifest.webmanifest");
  await check("The manifest is named Cerne and lists /icons/cerne-192.png, -512 and the maskable icon", async () => {
    const body = page.locator("body");
    await expect(body).toContainText('"short_name":"Cerne"');
    await expect(body).toContainText('"src":"/icons/cerne-192.png"');
    await expect(body).toContainText('"src":"/icons/cerne-512.png"');
    await expect(body).toContainText('"src":"/icons/cerne-maskable-512.png","sizes":"512x512","type":"image/png","purpose":"maskable"');
    await expect(body).not.toContainText("?v=");
  });
  await say("The old names are gone");
  const old = await page.request.get("/icon-512.png?v=3");
  await check("/icon-512.png no longer answers with the icon", async () => {
    expect(old.status()).toBe(404);
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
