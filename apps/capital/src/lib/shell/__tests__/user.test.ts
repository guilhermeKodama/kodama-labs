import { describe, expect, it } from "vitest";
import { firstName, initials } from "@/lib/shell/user";

describe("firstName", () => {
  it("is the first word of the name", () => {
    expect(firstName("Guilherme Kodama")).toBe("Guilherme");
    expect(firstName("  Ana   Maria da Silva ")).toBe("Ana");
    expect(firstName("Élodie")).toBe("Élodie");
  });

  it("skips leading punctuation", () => {
    expect(firstName("(PJ) Kodama LTDA")).toBe("PJ");
    expect(firstName("— Guilherme")).toBe("Guilherme");
  });

  it("falls back to the e-mail's local part, capitalized", () => {
    expect(firstName("", "guilherme.kodama@gmail.com")).toBe("Guilherme");
    expect(firstName(null, "s7+abc@capital.test")).toBe("S7");
    expect(firstName("   ", "éva@x.com")).toBe("Éva");
  });

  it("is empty with nothing to show", () => {
    expect(firstName(undefined)).toBe("");
    expect(firstName("", "")).toBe("");
    expect(firstName("---", null)).toBe("");
  });
});

describe("initials", () => {
  it("takes the first and last words", () => {
    expect(initials("Guilherme Kodama")).toBe("GK");
    expect(initials("Ana Maria da Silva")).toBe("AS");
    expect(initials("guilherme")).toBe("G");
    expect(initials("élodie durand")).toBe("ÉD");
  });

  it("keeps a whole code point (astral letters)", () => {
    expect(initials("𝒜lice 𝒞arol")).toBe("𝒜𝒞");
    expect(initials("Ana 🙂")).toBe("A");
  });

  it("falls back to the e-mail, then to ?", () => {
    expect(initials("", "guilherme.kodama@gmail.com")).toBe("GK");
    expect(initials(null, "ana@x.com")).toBe("A");
    expect(initials(undefined, undefined)).toBe("?");
    expect(initials("  ", "")).toBe("?");
  });
});
