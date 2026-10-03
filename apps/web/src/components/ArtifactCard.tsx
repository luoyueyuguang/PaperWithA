import { useState } from "react";
import { ARTIFACT_KIND_LABEL, type Artifact, type ArtifactKind, type RenderCapabilities } from "@paperwitha/domain";

/** 图件相关的回调与能力，由 App 注入，卡片本身不直接碰 core 客户端。 */
export interface ArtifactActions {
  readonly renderers: RenderCapabilities | null;
  /** 本会话有图件正在生成时置灰全部生成按钮。 */
  readonly busy: boolean;
  readonly fileUrl: (artifactId: string, file: string) => string;
  readonly onCreate: (kind: ArtifactKind, messageId: string | null) => void;
  readonly onDelete: (artifactId: string) => void;
}

const STATUS_LABEL: Record<Artifact["status"], string> = { running: "生成中", ready: "已完成", failed: "失败" };

/**
 * 图解与幻灯片的产物是浏览器直接渲染的 SVG（幻灯片还会生成自包含的 deck.html），不依赖外部渲染器；
 * 动画要么交给 manim，要么由 core 用 ffmpeg + rsvg-convert 把帧序列拼成 MP4。
 */
export function artifactCapability(kind: ArtifactKind, renderers: RenderCapabilities | null): { readonly enabled: boolean; readonly reason: string | null } {
  if (kind !== "animation") return { enabled: true, reason: null };
  if (renderers === null) return { enabled: false, reason: "还没取到 core 的渲染能力" };
  if (renderers.manim || renderers.video) return { enabled: true, reason: null };
  return { enabled: false, reason: renderers.svg ? "缺少 ffmpeg，无法把帧序列渲染成视频" : "缺少 rsvg-convert 或 ffmpeg，无法渲染视频" };
}

export function ArtifactButton({
  kind,
  label,
  messageId,
  actions,
}: {
  readonly kind: ArtifactKind;
  readonly label: string;
  readonly messageId: string | null;
  readonly actions: ArtifactActions;
}) {
  const capability = artifactCapability(kind, actions.renderers);
  const title = capability.enabled ? (actions.busy ? "正在生成图件，请稍候" : `生成${label}`) : (capability.reason ?? "");
  return (
    <button
      className="btn btn-sm artifact-action"
      disabled={!capability.enabled || actions.busy}
      title={title}
      onClick={() => actions.onCreate(kind, messageId)}
    >
      {label}
    </button>
  );
}

export function ArtifactCard({ artifact, actions }: { readonly artifact: Artifact; readonly actions: ArtifactActions }) {
  const label = ARTIFACT_KIND_LABEL[artifact.kind];
  return (
    <article className={`artifact-card artifact-card-${artifact.status}`}>
      <header className="artifact-head">
        <span className="artifact-kind">{label}</span>
        <span className="artifact-title" title={artifact.title}>
          {artifact.title}
        </span>
        <span className={`artifact-status artifact-status-${artifact.status}`}>{STATUS_LABEL[artifact.status]}</span>
        <button className="artifact-delete" title="删除图件" onClick={() => actions.onDelete(artifact.id)}>
          ×
        </button>
      </header>
      {artifact.status === "running" && (
        <p className="artifact-running">
          <span className="spinner" aria-hidden="true" />
          正在生成{label}…
        </p>
      )}
      {artifact.status === "failed" && <p className="artifact-error">{artifact.error ?? "生成失败，core 没有给出原因。"}</p>}
      {artifact.status === "ready" && <ArtifactPreview artifact={artifact} actions={actions} />}
    </article>
  );
}

function ArtifactPreview({ artifact, actions }: { readonly artifact: Artifact; readonly actions: ArtifactActions }) {
  const [slide, setSlide] = useState(0);
  const entry = artifact.entry;
  if (entry === null) return <p className="artifact-error">图件标记为已完成，但没有产物文件。</p>;

  if (artifact.kind === "diagram") {
    return <img className="artifact-media" src={actions.fileUrl(artifact.id, entry)} alt={artifact.title} />;
  }
  if (artifact.kind === "animation") {
    return <video className="artifact-media artifact-video" controls src={actions.fileUrl(artifact.id, entry)} />;
  }

  const total = artifact.slides.length;
  const current = Math.min(slide, Math.max(total - 1, 0));
  const active = artifact.slides[current];
  return (
    <div className="artifact-slides">
      {active ? (
        <img className="artifact-media" src={actions.fileUrl(artifact.id, active.file)} alt={active.title} />
      ) : (
        <p className="artifact-error">这份幻灯片没有页面。</p>
      )}
      <div className="artifact-pager">
        <button className="btn btn-sm" disabled={current <= 0} onClick={() => setSlide(current - 1)}>
          上一页
        </button>
        <span className="artifact-page-number">
          {current + 1} / {total}
        </span>
        <button className="btn btn-sm" disabled={current >= total - 1} onClick={() => setSlide(current + 1)}>
          下一页
        </button>
        <a className="artifact-link" href={actions.fileUrl(artifact.id, "deck.html")} target="_blank" rel="noreferrer">
          在浏览器打开 deck.html
        </a>
      </div>
    </div>
  );
}
