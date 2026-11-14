import { expect, flow } from "@repo/proof-video";

flow.setTimeout(180_000);

flow("The projection backtest: synthetic results, a read-only database run, and the production guard", async ({ scene, say, check, terminal }) => {
  await scene("Synthetic backtest", "300 seeded households, forecasts on days 5–25 against the closed month");
  await say("The same seed every run, so the table in the pull request can be reproduced");
  const synthetic = await terminal("pnpm", ["projection:backtest"], { timeoutMs: 120_000 });
  await check("The new model beats the old one on the cards", async () => {
    expect(synthetic.code).toBe(0);
    const row = (label: string) => {
      const line = synthetic.output.split("\n").find((l) => l.startsWith(`| ${label} |`) && l.includes("R$"));
      if (!line) throw new Error(`no row ${label}`);
      const cells = line.split("|").map((c) => c.trim());
      return { maeOld: Number(cells[3].replace(/\D/g, "")), maeNew: Number(cells[4].replace(/\D/g, "")) };
    };
    expect(row("Fixo").maeNew).toBeLessThan(row("Fixo").maeOld);
    expect(row("Total").maeNew).toBeLessThan(row("Total").maeOld);
    expect(synthetic.output).toMatch(/\| Tendência acima de ±200% \| \d+ \| 0 \|/);
  });

  await scene("Against a database, read-only", "Here the proof database; on the server, production");
  await say("Every query runs in one READ ONLY transaction and prints only errors and counts");
  const database = await terminal("pnpm", ["projection:backtest", "--database"], { timeoutMs: 120_000 });
  await check("It reads the database and prints only aggregates", async () => {
    expect(database.code).toBe(0);
    expect(database.output).toContain("Read-only backtest:");
    expect(database.output).toContain("| Diagnóstico (contagens) | valor |");
    expect(database.output).not.toMatch(/Aluguel|Mercado|proof@capital/);
  });

  await say("A production-looking database name is refused without the explicit opt-in");
  const refused = await terminal("sh", ["-c", "DATABASE_URL=postgresql://reader:secret@localhost:5432/capital CAPITAL_ALLOW_PROD_DB= pnpm exec tsx scripts/projection-backtest.ts --database"], { timeoutMs: 60_000 });
  await check("The guard refuses it", async () => {
    expect(refused.code).not.toBe(0);
    expect(refused.output).toContain('Refusing to connect: projection backtest resolved the database "capital"');
  });
});
