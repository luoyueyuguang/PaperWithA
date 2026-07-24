export interface ReadingBriefSection {
  heading: string;
  content: string;
  evidenceAnchorIds: string[];
  confidence: "stated" | "inferred" | "general-knowledge" | "insufficient-evidence";
  userEdited: boolean;
}

export interface ReadingBriefVersion {
  briefId: string;
  documentId: string;
  documentVersionId: string;
  generatedAt: string;
  model: string | null;
  /** Ordered list of sections that make up the brief. */
  sections: ReadingBriefSection[];
  /** User edits overlay: key = section index, value = user's replacement content. */
  userOverlay: Record<string, string>;
  /** Whether this version is the current active pointer. */
  active: boolean;
}

export function createReadingBriefVersion(input: {
  briefId: string;
  documentId: string;
  documentVersionId: string;
  model: string | null;
  sections: Omit<ReadingBriefSection, "userEdited">[];
  now: string;
}): ReadingBriefVersion {
  return {
    briefId: input.briefId,
    documentId: input.documentId,
    documentVersionId: input.documentVersionId,
    generatedAt: input.now,
    model: input.model,
    sections: input.sections.map((s) => ({ ...s, userEdited: false })),
    userOverlay: {},
    active: true,
  };
}

export function applyUserEdits(
  version: ReadingBriefVersion,
  overlay: Record<string, string>,
): ReadingBriefVersion {
  for (const [key, value] of Object.entries(overlay)) {
    const index = Number(key);
    if (Number.isNaN(index) || index < 0 || index >= version.sections.length) continue;
    version.sections[index]!.userEdited = true;
  }
  return { ...version, userOverlay: { ...version.userOverlay, ...overlay } };
}

/** Default section headings for an AI-generated Reading Brief. */
export const READING_BRIEF_SECTIONS = [
  "Problem Statement",
  "Author Claims",
  "Method & Approach",
  "Key Contributions",
  "Critical Evidence",
  "Results & Limitations",
  "5C Completeness Check",
  "Three-Pass Progress",
  "Suggested Focus Areas",
  "Open Questions",
] as const;
