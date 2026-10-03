/**
 * 证据锚点：把一段文本绑定到某篇论文的某一页和字符范围。
 * 页面是纯文本，偏移以页面文本为基准。
 */
export interface EvidenceAnchor {
  readonly paperId: string;
  readonly pageNumber: number;
  readonly startOffset: number;
  readonly endOffset: number;
  readonly quote: string;
}

export function createAnchor(input: {
  readonly paperId: string;
  readonly pageNumber: number;
  readonly pageText: string;
  readonly quote: string;
}): EvidenceAnchor | null {
  const quote = input.quote.trim();
  if (quote.length === 0) return null;
  const startOffset = input.pageText.indexOf(quote);
  if (startOffset < 0) return null;
  return {
    paperId: input.paperId,
    pageNumber: input.pageNumber,
    startOffset,
    endOffset: startOffset + quote.length,
    quote,
  };
}
