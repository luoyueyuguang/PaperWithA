import type { DocumentGraph } from "@paperwitha/domain";

export type GraphLoader = (documentVersionId: string) => Promise<DocumentGraph>;

export class DocumentGraphCache {
  private readonly entries = new Map<string, Promise<DocumentGraph>>();

  getOrCreate(documentVersionId: string, loader: GraphLoader): Promise<DocumentGraph> {
    const existing = this.entries.get(documentVersionId);
    if (existing) return existing;

    const pending = loader(documentVersionId).catch((error: unknown) => {
      this.entries.delete(documentVersionId);
      throw error;
    });
    this.entries.set(documentVersionId, pending);
    return pending;
  }

  clear(documentVersionId?: string): void {
    if (documentVersionId) {
      this.entries.delete(documentVersionId);
      return;
    }
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }
}

export function visiblePageNumbers(
  totalPages: number,
  centerPage: number,
  bufferPages = 1,
): number[] {
  if (totalPages < 1) return [];
  const start = Math.max(1, centerPage - bufferPages);
  const end = Math.min(totalPages, centerPage + bufferPages);
  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}
