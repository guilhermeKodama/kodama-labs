import { describe, expect, it } from "vitest";
import { operationLabel, operationSubject } from "../operation-label";

describe("operationLabel", () => {
  it("uses a trimmed ticker, then the name, and never a trailing space", () => {
    expect(operationSubject(" PETR4 ", "Petrobras")).toBe("PETR4");
    expect(operationSubject("", "Caixinha Nubank PJ")).toBe("Caixinha Nubank PJ");
    expect(operationSubject("   ", "Caixinha Nubank PJ")).toBe("Caixinha Nubank PJ");
    expect(operationSubject(null, "Caixinha Nubank PJ")).toBe("Caixinha Nubank PJ");
    expect(operationLabel("Compra", "", "Caixinha Nubank PJ")).toBe("Compra Caixinha Nubank PJ");
    expect(operationLabel("Compra", null, "Caixinha Nubank PJ")).toBe("Compra Caixinha Nubank PJ");
    expect(operationLabel("Compra", "PETR4", "Petrobras")).toBe("Compra PETR4");
    expect(operationLabel("Compra", "  ", "  ")).toBe("Compra");
    expect(operationLabel("Aporte", null, "Caixinha Nubank PJ")).toBe("Aporte Caixinha Nubank PJ");
    expect(operationLabel("Resgate", "CDB", "Caixinha")).toBe("Resgate CDB");
  });
});