import { flow } from "@repo/proof-video";
import { setTheme, tour } from "./tour";

flow("Validation package: every screen, light theme", async ({ page, scene, check }) => {
  await setTheme(page, "Claro");
  await tour(page, "claro", { scene, check });
});
