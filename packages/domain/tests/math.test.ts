import { describe, expect, it } from "vitest";
import { splitMath, stripMathDelimiters } from "../src/math";

describe("splitMath", () => {
  it("splits inline math out of surrounding text", () => {
    expect(splitMath("记忆状态 $S_t \\in \\mathbb{R}^{d_k \\times d_v}$ 表示矩阵形式。")).toEqual([
      { kind: "text", value: "记忆状态 " },
      { kind: "math", value: "S_t \\in \\mathbb{R}^{d_k \\times d_v}", display: false },
      { kind: "text", value: " 表示矩阵形式。" },
    ]);
  });

  it("marks display delimiters", () => {
    expect(splitMath("推导如下：\n$$A[t]_{ij} = \\gamma_i[t] / \\gamma_j[t]$$\n结束")).toEqual([
      { kind: "text", value: "推导如下：\n" },
      { kind: "math", value: "A[t]_{ij} = \\gamma_i[t] / \\gamma_j[t]", display: true },
      { kind: "text", value: "\n结束" },
    ]);
    expect(splitMath("\\[a=b\\]")).toEqual([{ kind: "math", value: "a=b", display: true }]);
    expect(splitMath("\\(a=b\\)")).toEqual([{ kind: "math", value: "a=b", display: false }]);
  });

  it("keeps prices as plain text", () => {
    expect(splitMath("成本 $5 和 $10，都不是公式。")).toEqual([{ kind: "text", value: "成本 $5 和 $10，都不是公式。" }]);
  });

  it("treats an unpaired delimiter as text", () => {
    expect(splitMath("这里是 $\\alpha 没写完")).toEqual([{ kind: "text", value: "这里是 $\\alpha 没写完" }]);
    expect(splitMath("空公式 $$ 也当文本")).toEqual([{ kind: "text", value: "空公式 $$ 也当文本" }]);
  });

  it("unescapes \\$ in prose", () => {
    expect(splitMath("价格 \\$100")).toEqual([{ kind: "text", value: "价格 $100" }]);
  });

  it("does not treat a multiline dollar pair as inline math", () => {
    expect(splitMath("$a\nb$")).toEqual([{ kind: "text", value: "$a\nb$" }]);
  });
});

describe("stripMathDelimiters", () => {
  it("keeps the formula but drops the delimiters", () => {
    expect(stripMathDelimiters("记忆状态 $S_t \\in \\mathbb{R}^{d_k}$ 与 $$A[t]$$ 。"))
      .toBe("记忆状态 S_t \\in \\mathbb{R}^{d_k} 与 A[t] 。");
  });

  it("leaves prose untouched", () => {
    expect(stripMathDelimiters("成本 $5 和 $10。")).toBe("成本 $5 和 $10。");
  });
});
