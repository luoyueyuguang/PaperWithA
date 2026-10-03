/**
 * 生成的图件：图解、动画、幻灯片。
 * 作者是 agent，格式固定成 SVG / frames.json / deck.json，core 负责校验与渲染。
 */

export type ArtifactKind = "diagram" | "animation" | "slides";
export type ArtifactStatus = "running" | "ready" | "failed";

export interface ArtifactSlide {
  readonly index: number;
  readonly title: string;
  /** 相对 artifact 目录的路径。 */
  readonly file: string;
}

export interface Artifact {
  readonly id: string;
  readonly sessionId: string;
  /** 绑定到某条回答；整个会话生成的图件为 null。 */
  readonly messageId: string | null;
  readonly kind: ArtifactKind;
  readonly title: string;
  readonly status: ArtifactStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly error: string | null;
  /** 主文件相对路径（svg / mp4 / deck.html）；尚未产出时为 null。 */
  readonly entry: string | null;
  readonly slides: readonly ArtifactSlide[];
  readonly durationMs: number | null;
}

export const ARTIFACT_KIND_LABEL: Record<ArtifactKind, string> = {
  diagram: "图解",
  animation: "动画",
  slides: "幻灯片",
};

export function isArtifactKind(value: unknown): value is ArtifactKind {
  return value === "diagram" || value === "animation" || value === "slides";
}

/** 渲染能力。UI 据此禁用点不动的按钮。 */
export interface RenderCapabilities {
  readonly svg: boolean;
  readonly video: boolean;
  readonly manim: boolean;
}
