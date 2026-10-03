/** 论文的最小领域模型。core 落盘、三端渲染共用这一组类型。 */

export interface PaperPage {
  readonly pageNumber: number;
  readonly text: string;
}

export interface PaperSummary {
  /** 内容哈希前 12 位，跨设备稳定。 */
  readonly id: string;
  readonly title: string;
  readonly fileName: string;
  /** 落盘文件名：`<id>-<fileName>`。 */
  readonly storedName: string;
  readonly size: number;
  readonly pageCount: number;
  readonly addedAt: string;
}

export interface PaperText {
  readonly paperId: string;
  readonly pages: readonly PaperPage[];
}

export const PAPER_ID_LENGTH = 12;

export function titleFromFileName(fileName: string): string {
  const base = fileName.replace(/\.[^.]+$/, "");
  const cleaned = base.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
  return cleaned.length > 0 ? cleaned : fileName;
}
