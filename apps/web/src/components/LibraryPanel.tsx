import { useState } from "react";
import type { PaperSummary } from "@paperwitha/domain";

export interface LibraryPanelProps {
  readonly papers: readonly PaperSummary[];
  readonly loading: boolean;
  readonly error: string | null;
  readonly selectedPaperId: string | null;
  readonly uploading: { readonly name: string } | null;
  readonly uploadError: string | null;
  readonly onSelect: (paperId: string) => void;
  readonly onUpload: (file: File) => void;
  readonly onDelete: (paperId: string) => void;
}

export function LibraryPanel(props: LibraryPanelProps) {
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  return (
    <aside className="panel library" aria-label="论文库">
      <header className="panel-head">
        <h1 className="panel-title">论文库</h1>
        <label className="btn btn-primary import-button">
          导入论文
          <input
            id="paper-file-input"
            type="file"
            accept=".pdf,.txt,.md"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) props.onUpload(file);
            }}
          />
        </label>
      </header>

      {props.uploading && <p className="status status-busy">正在上传 {props.uploading.name}…</p>}
      {props.uploadError && <p className="status status-error">上传失败：{props.uploadError}</p>}
      {props.error && <p className="status status-error">加载论文失败：{props.error}</p>}
      {props.loading && <p className="status">正在加载论文…</p>}

      <div className="panel-scroll" id="library-list">
        {!props.loading && props.papers.length === 0 && !props.error && (
          <p className="empty-hint">还没有论文，先导入一份 PDF、TXT 或 Markdown。</p>
        )}
        <ul className="paper-list">
          {props.papers.map((paper) => {
            const selected = paper.id === props.selectedPaperId;
            return (
              <li key={paper.id} className={selected ? "paper-item selected" : "paper-item"}>
                <button className="paper-select" onClick={() => props.onSelect(paper.id)} title={paper.fileName}>
                  <span className="paper-title">{paper.title}</span>
                  <span className="paper-meta">
                    {paper.pageCount} 页 · {paper.fileName}
                  </span>
                </button>
                {pendingDelete === paper.id ? (
                  <span className="paper-delete-confirm">
                    <button
                      className="btn btn-danger btn-sm"
                      onClick={() => {
                        setPendingDelete(null);
                        props.onDelete(paper.id);
                      }}
                    >
                      确认删除
                    </button>
                    <button className="btn btn-ghost btn-sm" onClick={() => setPendingDelete(null)}>
                      取消
                    </button>
                  </span>
                ) : (
                  <button className="btn btn-ghost btn-sm" title="删除论文" onClick={() => setPendingDelete(paper.id)}>
                    删除
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </aside>
  );
}
