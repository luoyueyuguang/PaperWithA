import { ARTIFACT_KIND_LABEL, type ArtifactKind, type PaperPage, type PaperSummary, type RenderCapabilities } from "@paperwitha/domain";

export interface ArtifactContext {
  readonly paper: PaperSummary;
  readonly pages: readonly PaperPage[];
  /** 针对单条回答时是那条回答的正文。 */
  readonly messageText: string | null;
  /** 针对整个会话时是对话记录。 */
  readonly conversation: string | null;
}

const CANVAS = "画布固定 1280×720（width=\"1280\" height=\"720\" viewBox=\"0 0 1280 720\"）。";
const PALETTE = "配色：背景 #0b1220，主色 #4f8cff，强调色 #f59e0b，正文 #e6edf7，次要文字 #9fb4d4。";
const TYPE_SCALE = "字体用 font-family=\"system-ui, 'Noto Sans CJK SC', sans-serif\"；图上的正文 ≥ 24px，标题 ≥ 34px。";
const SELF_CONTAINED = "SVG 必须自包含：不要 <script>、不要 @import、不要外链字体或 <image href>，只用基本图元、path 与 text。";

const FRAMES_SCHEMA = '{"width":1280,"height":720,"fps":30,"frames":[{"file":"frames/f01.svg","durationMs":900}]}';
const DECK_SCHEMA = '{"title":"标题","slides":[{"title":"本页标题","file":"slides/01.svg"}]}';

export function buildArtifactSystemPrompt(kind: ArtifactKind, renderers: RenderCapabilities): string {
  return [
    "你是给论文画图的作者。工作目录里有 paper.md（论文全文，每页以 \"## Page N\" 开头）和 context.md（这次要图解的原文）。",
    "只写文件，不要输出解释性正文；写完后用 bash 确认文件确实存在。",
    CANVAS,
    PALETTE,
    TYPE_SCALE,
    SELF_CONTAINED,
    ...kindInstructions(kind, renderers),
  ].join("\n");
}

function kindInstructions(kind: ArtifactKind, renderers: RenderCapabilities): readonly string[] {
  switch (kind) {
    case "diagram":
      return [
        "产出 diagram.svg：一张图讲清 context.md 里的核心机制。",
        "画出结构与流向（形状、箭头、分组、标注），不要把原文句子抄进图里；每条标注不超过 18 个字。",
      ];
    case "animation":
      return [
        "产出一段动画，最终要得到一个 MP4。",
        renderers.manim
          ? "环境里有 manim：写 scene.py，并用 `manim -ql --format=mp4 -o animation.mp4 scene.py <SceneName>` 渲染出 animation.mp4。"
          : "环境里没有 manim，用下面的帧序列方案。",
        "帧序列方案：写 frames/f01.svg、frames/f02.svg…，再写 frames.json：",
        FRAMES_SCHEMA,
        "帧数 6–24，每帧 600–2500ms。每帧都是完整 SVG；第一帧先画静态底图，之后每帧只推进变化的部分。",
        "动作要连续：位置、长度、透明度逐帧小步变化，不要整页切换。",
      ];
    case "slides":
      return [
        "产出一份幻灯片。写 slides/01.svg、slides/02.svg…，再写 deck.json：",
        DECK_SCHEMA,
        "6–14 页：第一页是标题页（论文题目 + 一句话结论），最后一页是结论，中间每页只讲一个点。",
        "每页文字不超过 6 行；页标题 ≥ 44px，正文 ≥ 28px。图为主、字为辅。",
      ];
  }
}

export function buildArtifactTaskPrompt(kind: ArtifactKind, context: ArtifactContext): string {
  const label = ARTIFACT_KIND_LABEL[kind];
  if (context.messageText) {
    return `把这条回答讲的内容做成${label}。原文在 context.md，论文全文在 paper.md。\n\n${context.messageText}`;
  }
  return `把整段对话的核心内容做成${label}。对话记录在 context.md，论文全文在 paper.md。`;
}

export function contextDocument(context: ArtifactContext): string {
  if (context.messageText) return `# 要图解的这条回答\n\n${context.messageText}\n`;
  return `# 对话记录\n\n${context.conversation ?? "（这个会话还没有对话内容）"}\n`;
}
