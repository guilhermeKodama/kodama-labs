import { flow } from "@repo/proof-video";
import { setTheme, tour } from "./tour";

flow("Validation package: every screen, dark theme", async ({ page, scene, check }) => {
  await setTheme(page, "Escuro");
  try {
    await tour(page, "escuro", { scene, check });
  } finally {
    // The other suites expect Claro.
    await setTheme(page, "Claro");
  }
});
