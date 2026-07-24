export interface ContextSource {
  sourceId: string;
  documentId: string;
  text: string;
}

export interface ContextSet {
  documents: string[];
  fixedSourceIds: string[];
  query: string;
  retrievalVersion: string;
}

export interface ContextBuildResult {
  status: "ready" | "budget_exceeded";
  selectedSourceIds: string[];
  omittedSourceIds: string[];
  tokenCount: number;
  fixedTokenCount: number;
}

function tokenCount(text: string): number {
  return text.trim() === "" ? 0 : text.trim().split(/\s+/).length;
}

function lexicalScore(text: string, query: string): number {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const normalized = text.toLowerCase();
  return terms.reduce((score, term) => score + (normalized.includes(term) ? 1 : 0), 0);
}

export function buildContext(
  contextSet: ContextSet,
  sources: readonly ContextSource[],
  budgetTokens: number,
): ContextBuildResult {
  const eligible = sources.filter((source) => contextSet.documents.includes(source.documentId));
  const byId = new Map(eligible.map((source) => [source.sourceId, source]));
  const fixed = contextSet.fixedSourceIds.flatMap((sourceId) => {
    const source = byId.get(sourceId);
    return source ? [source] : [];
  });
  const fixedTokenCount = fixed.reduce((sum, source) => sum + tokenCount(source.text), 0);
  if (fixedTokenCount > budgetTokens) {
    return {
      status: "budget_exceeded",
      selectedSourceIds: fixed.map((source) => source.sourceId),
      omittedSourceIds: [],
      tokenCount: fixedTokenCount,
      fixedTokenCount,
    };
  }

  const fixedIds = new Set(fixed.map((source) => source.sourceId));
  const candidates = eligible
    .filter((source) => !fixedIds.has(source.sourceId))
    .sort((left, right) => lexicalScore(right.text, contextSet.query) - lexicalScore(left.text, contextSet.query)
      || left.sourceId.localeCompare(right.sourceId));
  const selected = [...fixed];
  const omittedSourceIds: string[] = [];
  let tokenCountSoFar = fixedTokenCount;
  for (const source of candidates) {
    const sourceTokens = tokenCount(source.text);
    if (tokenCountSoFar + sourceTokens <= budgetTokens) {
      selected.push(source);
      tokenCountSoFar += sourceTokens;
    } else {
      omittedSourceIds.push(source.sourceId);
    }
  }
  return {
    status: "ready",
    selectedSourceIds: selected.map((source) => source.sourceId),
    omittedSourceIds,
    tokenCount: tokenCountSoFar,
    fixedTokenCount,
  };
}
