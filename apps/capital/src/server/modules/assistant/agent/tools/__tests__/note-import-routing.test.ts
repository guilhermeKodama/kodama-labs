import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AGENT_TOOLS } from "../index";
import { loadAgentKnowledge } from "../../knowledge";

/**
 * "Importar nota" (Carteira) sends a brokerage note, PDF or image, to the
 * assistant and promises a plan to confirm. The playbooks and the tool
 * descriptions must never route a note to a tool that writes directly.
 */
const DIRECT_WRITERS = ["record_investment_transaction", "manage_investment_holding"];
const knowledgeFile = (name: string) => readFileSync(path.join(process.cwd(), "src/server/modules/assistant/agent/knowledge", name), "utf8");

function section(markdown: string, heading: string): string {
  const start = markdown.indexOf(heading);
  expect(start).toBeGreaterThanOrEqual(0);
  const next = markdown.indexOf("\n## ", start + heading.length);
  return markdown.slice(start, next < 0 ? undefined : next);
}

describe("brokerage notes always go through a confirmable plan", () => {
  it("the image playbook sends notes (and broker prints) to propose_import_plan, never to a direct writer", () => {
    const broker = section(knowledgeFile("53-playbook-imagens.md"), "## Print de corretora ou investimento");
    const noteLine = broker.split("\n").find((line) => /nota de corretagem|nota de negociação/i.test(line));
    expect(noteLine).toBeDefined();
    expect(noteLine).toContain("propose_import_plan");
    // A direct writer may only be named to forbid it.
    for (const line of broker.split("\n")) {
      if (DIRECT_WRITERS.some((tool) => line.includes(tool))) expect(line.toLowerCase()).toMatch(/nunca/);
    }
  });

  it("the PDF playbook and the tool guide say the same for notes in PDF or image", () => {
    expect(knowledgeFile("52-playbook-investment-pdf.md")).toMatch(/nota de corretagem em PDF ou imagem[^\n]*propose_import_plan/);
    const guide = knowledgeFile("90-tool-guide.md");
    const recordLine = guide.split("\n").find((line) => line.startsWith("- `record_investment_transaction`"));
    expect(recordLine).toMatch(/nota de corretagem em PDF ou imagem/);
    expect(recordLine).toMatch(/propose_import_plan/);
    // The "create the missing holding" step of statement imports carves notes out.
    const createStep = knowledgeFile("40-investments.md").split("\n").find((line) => line.includes("Crie com `manage_investment_account`"));
    expect(createStep).toMatch(/nota de corretagem[^\n]*nunca crie a posição com `manage_investment_holding`[^\n]*newHolding[^\n]*propose_import_plan/);
    expect(loadAgentKnowledge()).toContain("Nota de corretagem (nota de negociação) ou extrato de operações, em imagem ou PDF: sempre `propose_import_plan`");
  });

  it("the direct-writing tools' descriptions exclude notes and point to propose_import_plan", () => {
    for (const name of DIRECT_WRITERS) {
      const tool = AGENT_TOOLS.find((t) => t.name === name);
      expect(tool, name).toBeDefined();
      expect(tool!.description).toMatch(/Never[^.]*brokerage note/);
      expect(tool!.description).toContain("propose_import_plan");
    }
    expect(AGENT_TOOLS.find((t) => t.name === "propose_import_plan")?.access).toBe("write_plan");
  });
});
