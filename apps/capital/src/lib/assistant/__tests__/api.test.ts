import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api/client";
import { messageBody, requestError } from "../api";

describe("messageBody", () => {
  it("sends only what the input has", () => {
    expect(messageBody({ text: "oi" }, "c1")).toEqual({ text: "oi", clientMessageId: "c1" });
    expect(messageBody({ files: [{ fileId: "f1", originalName: "extrato.ofx" }] }, "c2")).toEqual({ fileIds: ["f1"], clientMessageId: "c2" });
    const cardResponse = { cardId: "k1", decisions: [{ pairId: "p1", label: "Pular" }] };
    expect(messageBody({ cardResponse }, "c3")).toEqual({ cardResponse, clientMessageId: "c3" });
  });
});

describe("requestError", () => {
  it("keeps the code of an API error, for the localized message", () => {
    const error = new ApiError({ status: 409, code: "assistant.turn_running", message: "busy", params: { a: 1 } });
    expect(requestError(error)).toEqual({ kind: "request", status: 409, code: "assistant.turn_running", params: { a: 1 } });
  });

  it("treats anything else as a network failure", () => {
    expect(requestError(new TypeError("Failed to fetch"))).toEqual({ kind: "request", status: 0, code: "network", params: {} });
  });
});
