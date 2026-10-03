import { describe, expect, it } from "vitest";
import {
  appendChatMessage,
  createAnchor,
  createChatSession,
  extractCitations,
  parseCoreEvent,
  replaceChatMessage,
  sessionTitleFromQuestion,
  stripCitationMarkers,
  tidyAssistantText,
  titleFromFileName,
  type PaperPage,
} from "../src/index";

const PAGES: readonly PaperPage[] = [
  { pageNumber: 1, text: "Attention is all you need. 自注意力可以并行计算。这是第一页的结尾。" },
  { pageNumber: 2, text: "Multi-head attention projects queries. 第二页讲多头注意力。" },
];

describe("extractCitations", () => {
  it("keeps only markers that point at real pages, deduplicated in order", () => {
    const text = "自注意力可以并行计算。[p.1] 多头注意力拆分子空间。[p.2] 再强调一次。[p.1] 不存在的页。[p.9]";
    expect(extractCitations(text, PAGES)).toEqual([
      { pageNumber: 1, quote: "自注意力可以并行计算。" },
      { pageNumber: 2, quote: "多头注意力拆分子空间。" },
    ]);
  });

  it("ignores text without markers", () => {
    expect(extractCitations("没有引用的回答。", PAGES)).toEqual([]);
  });
});

describe("stripCitationMarkers", () => {
  it("removes markers and collapses the leftover spaces", () => {
    expect(stripCitationMarkers("多头注意力拆分子空间。[p.2] 结束。")).toBe("多头注意力拆分子空间。 结束。");
  });
});

describe("tidyAssistantText", () => {
  it("removes the stray space before Chinese punctuation", () => {
    expect(tidyAssistantText("提出 Transformer，不依赖循环和卷积 。对应机制是 Scaled Dot-Product Attention 。"))
      .toBe("提出 Transformer，不依赖循环和卷积。对应机制是 Scaled Dot-Product Attention。");
  });

  it("keeps spaces inside English text", () => {
    expect(tidyAssistantText("The Transformer uses attention. It has no recurrence."))
      .toBe("The Transformer uses attention. It has no recurrence.");
  });

  it("keeps full-width punctuation in normal positions", () => {
    expect(tidyAssistantText("结论：只用注意力机制（不含循环）。")).toBe("结论：只用注意力机制（不含循环）。");
  });
});

describe("titleFromFileName", () => {
  it("strips the extension and normalises separators", () => {
    expect(titleFromFileName("attention_is-all_you_need.pdf")).toBe("attention is all you need");
  });

  it("falls back to the raw name when nothing is left", () => {
    expect(titleFromFileName(".pdf")).toBe(".pdf");
  });
});

describe("createAnchor", () => {
  it("records the character range of a quote inside its page", () => {
    const anchor = createAnchor({ paperId: "abc123", pageNumber: 2, pageText: "Multi-head attention projects queries.", quote: "attention projects" });
    expect(anchor).toEqual({ paperId: "abc123", pageNumber: 2, startOffset: 11, endOffset: 29, quote: "attention projects" });
  });

  it("rejects a quote that is not on the page", () => {
    expect(createAnchor({ paperId: "abc123", pageNumber: 1, pageText: "abc", quote: "zzz" })).toBeNull();
  });

  it("rejects a blank quote", () => {
    expect(createAnchor({ paperId: "abc123", pageNumber: 1, pageText: "abc", quote: "   " })).toBeNull();
  });
});

describe("chat sessions", () => {
  it("appends messages and bumps updatedAt", () => {
    const session = createChatSession({ id: "s1", paperId: "p1", title: "会话", now: "2026-10-03T00:00:00.000Z" });
    const next = appendChatMessage(session, { id: "m1", role: "user", text: "这篇的贡献是什么？", createdAt: "2026-10-03T00:01:00.000Z", citations: [] });
    expect(next.messages).toHaveLength(1);
    expect(next.updatedAt).toBe("2026-10-03T00:01:00.000Z");
    expect(session.messages).toHaveLength(0);
  });

  it("patches a streaming message in place", () => {
    const session = appendChatMessage(
      createChatSession({ id: "s1", paperId: "p1", title: "会话", now: "2026-10-03T00:00:00.000Z" }),
      { id: "m1", role: "assistant", text: "", createdAt: "2026-10-03T00:01:00.000Z", citations: [] },
    );
    const patched = replaceChatMessage(session, "m1", { text: "答案", citations: [{ pageNumber: 1, quote: "q" }] });
    expect(patched.messages[0]?.text).toBe("答案");
    expect(patched.messages[0]?.citations).toHaveLength(1);
    expect(replaceChatMessage(session, "missing", { text: "x" })).toBe(session);
  });

  it("derives a title from the first question", () => {
    expect(sessionTitleFromQuestion("  这篇论文的核心贡献是什么？  ")).toBe("这篇论文的核心贡献是什么？");
    expect(sessionTitleFromQuestion("x".repeat(60))).toBe(`${"x".repeat(40)}…`);
    expect(sessionTitleFromQuestion("   ")).toBe("新会话");
  });
});

describe("parseCoreEvent", () => {
  it("accepts well-formed events", () => {
    expect(parseCoreEvent('{"type":"text-delta","sessionId":"s1","runId":"r1","delta":"hi"}')).toEqual({
      type: "text-delta",
      sessionId: "s1",
      runId: "r1",
      delta: "hi",
    });
  });

  it("rejects malformed frames", () => {
    expect(parseCoreEvent("not json")).toBeNull();
    expect(parseCoreEvent('{"type":"text-delta"}')).toBeNull();
    expect(parseCoreEvent("[]")).toBeNull();
  });
});
