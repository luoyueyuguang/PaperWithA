import type { PaperPage } from "./paper";

/**
 * 回答里的引用。模型按系统提示写出 `[p.N]`，core 解析成引用对象。
 * pageNumber 必须在论文实际页范围内，否则丢弃，防止编造页码。
 */
export interface Citation {
  readonly pageNumber: number;
  readonly quote: string;
}

const QUOTE_LIMIT = 240;

export function extractCitations(text: string, pages: readonly PaperPage[]): readonly Citation[] {
  const known = new Set(pages.map((page) => page.pageNumber));
  const seen = new Set<number>();
  const citations: Citation[] = [];
  for (const match of text.matchAll(/\[p\.(\d+)\]/g)) {
    const pageNumber = Number(match[1]);
    if (!Number.isInteger(pageNumber) || !known.has(pageNumber) || seen.has(pageNumber)) continue;
    seen.add(pageNumber);
    citations.push({ pageNumber, quote: quoteBefore(text, match.index ?? 0) });
  }
  return citations;
}

export function stripCitationMarkers(text: string): string {
  return text.replace(/\[p\.(\d+)\]/g, "").replace(/[ \t]{2,}/g, " ").replace(/ +\n/g, "\n").trim();
}

/** 模型常在中文标点前多打一个空格，落盘和展示前统一收掉。 */
export function tidyAssistantText(text: string): string {
  return text.replace(/[ \t]+([，。！？；：、）」』】])/g, "$1");
}

function quoteBefore(text: string, markerIndex: number): string {
  const before = text.slice(0, markerIndex).replace(/\s+$/, "");
  // 末尾的句号属于当前句子，所以从倒数第二个字符往前找上一个句末标点。
  const searchable = before.slice(0, -1);
  const lastStop = Math.max(
    searchable.lastIndexOf("。"),
    searchable.lastIndexOf("！"),
    searchable.lastIndexOf("？"),
    searchable.lastIndexOf(". "),
    searchable.lastIndexOf("! "),
    searchable.lastIndexOf("? "),
    searchable.lastIndexOf("\n"),
  );
  const sentence = before
    .slice(lastStop + 1)
    .replace(/\[p\.\d+\]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (sentence.length === 0) return "";
  return sentence.length > QUOTE_LIMIT ? `…${sentence.slice(sentence.length - QUOTE_LIMIT).trim()}` : sentence;
}
