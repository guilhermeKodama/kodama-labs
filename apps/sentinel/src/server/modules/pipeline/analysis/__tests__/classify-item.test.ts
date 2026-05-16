import { describe, it, expect } from "vitest";
import { classifyItem } from "../classify-item";

describe("classifyItem", () => {
  it("returns GENERIC for the canonical 'PRESTAÇÃO DE SERVIÇO' case", () => {
    expect(
      classifyItem({
        description: "PRESTAÇÃO DE SERVIÇO",
        materialOrService: "S",
        unit: "UN",
      }),
    ).toBe("GENERIC");
  });

  it("returns GENERIC for vague catch-all descriptions", () => {
    for (const desc of ["MATERIAL DIVERSO", "OUTROS SERVIÇOS", "DIVERSOS", "TAXA"]) {
      expect(classifyItem({ description: desc })).toBe("GENERIC");
    }
  });

  it("returns GENERIC for very short descriptions without qualifiers", () => {
    expect(classifyItem({ description: "ITEM" })).toBe("GENERIC");
    expect(classifyItem({ description: "TAXA" })).toBe("GENERIC");
  });

  it("returns SERVICE when materialOrService = 'S'", () => {
    expect(
      classifyItem({
        description: "Manutenção corretiva de elevadores conforme contrato",
        materialOrService: "S",
        unit: "MES",
      }),
    ).toBe("SERVICE");
  });

  it("returns SERVICE when unit is hours/days/months", () => {
    expect(
      classifyItem({
        description: "Consultoria especializada em segurança da informação",
        unit: "HR",
      }),
    ).toBe("SERVICE");
    expect(classifyItem({ description: "Locação de impressoras laser monocromática", unit: "MES" })).toBe("SERVICE");
  });

  it("returns PRODUCT when CATMAT code is present and description is specific", () => {
    expect(
      classifyItem({
        description: "ÓLEO HIDRÁULICO 20L NEW HOLLAND",
        catmatCode: "123456",
        unit: "UN",
      }),
    ).toBe("PRODUCT");
  });

  it("returns PRODUCT when materialOrService = 'M'", () => {
    expect(
      classifyItem({
        description: "Cadeira giratória ergonômica com encosto",
        materialOrService: "M",
      }),
    ).toBe("PRODUCT");
  });

  it("returns PRODUCT as conservative fallback", () => {
    expect(
      classifyItem({
        description: "Algum item bem descrito com vários detalhes específicos aqui",
      }),
    ).toBe("PRODUCT");
  });

  it("uses materialOrServiceName when materialOrService code is missing", () => {
    expect(
      classifyItem({
        description: "Manutenção preventiva mensal de ar-condicionado",
        materialOrServiceName: "Serviço",
      }),
    ).toBe("SERVICE");
  });

  it("treats descriptions with model numbers as specific (not generic)", () => {
    expect(classifyItem({ description: "PNEU 175/70 R13" })).toBe("PRODUCT");
  });
});
