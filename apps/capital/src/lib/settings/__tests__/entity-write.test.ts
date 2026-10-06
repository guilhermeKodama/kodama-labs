import { describe, expect, it } from "vitest";
import { readEntityWrite } from "../entity-write";

describe("readEntityWrite", () => {
  const entity = { id: "e1", name: "Kodama LTDA" };

  it("reads the entity and its batch from a flat response", () => {
    expect(readEntityWrite({ ...entity, batchId: "b1" })).toEqual({ entity: { ...entity, batchId: "b1" }, batchId: "b1" });
  });

  it("reads the entity and its batch from { entity, batchId }", () => {
    expect(readEntityWrite({ entity, batchId: "b2" })).toEqual({ entity, batchId: "b2" });
  });

  it("has no batch to undo when the server recorded none", () => {
    expect(readEntityWrite(entity)).toEqual({ entity, batchId: null });
    expect(readEntityWrite({ entity, batchId: null }).batchId).toBeNull();
  });
});
