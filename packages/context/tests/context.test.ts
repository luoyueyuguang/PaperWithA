import { describe, expect, it } from "vitest";
import { buildContext } from "../src/context.js";

describe("ContextBuilder", () => {
  it("keeps fixed evidence first and explains ordinary cropping", () => {
    const result = buildContext({
      documents: ["paper-a"],
      fixedSourceIds: ["fixed"],
      query: "method",
      retrievalVersion: "lexical-v1",
    }, [
      { sourceId: "fixed", documentId: "paper-a", text: "fixed evidence" },
      { sourceId: "candidate", documentId: "paper-a", text: "method result" },
    ], 3);

    expect(result.status).toBe("ready");
    expect(result.selectedSourceIds).toEqual(["fixed"]);
    expect(result.omittedSourceIds).toEqual(["candidate"]);
  });
});
