import { splitMath } from "@paperwitha/domain";
import katex from "katex";
import "katex/dist/katex.min.css";
import type { ReactNode } from "react";

/**
 * 助手回答的渲染：按空行分段，段内把 LaTeX 交给 KaTeX。
 * 文本走 React 的文本节点，只有 KaTeX 自己生成的 HTML 走 innerHTML。
 */
export function MessageText({ text }: { readonly text: string }) {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter((block) => block.length > 0);
  if (paragraphs.length === 0) return null;
  return (
    <>
      {paragraphs.map((paragraph, index) => (
        <p key={index}>{renderSegments(paragraph)}</p>
      ))}
    </>
  );
}

function renderSegments(paragraph: string): ReactNode[] {
  return splitMath(paragraph).map((segment, index) => {
    if (segment.kind === "text") return <span key={index}>{segment.value}</span>;
    const html = katex.renderToString(segment.value, {
      displayMode: segment.display,
      throwOnError: false,
      strict: false,
    });
    return (
      <span
        key={index}
        className={segment.display ? "math-display" : "math-inline"}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  });
}
