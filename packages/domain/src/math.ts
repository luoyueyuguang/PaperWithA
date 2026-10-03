export type MathSegment =
  | { readonly kind: "text"; readonly value: string }
  | { readonly kind: "math"; readonly value: string; readonly display: boolean };

const DELIMITERS: ReadonlyArray<{ readonly open: string; readonly close: string; readonly display: boolean }> = [
  { open: "$$", close: "$$", display: true },
  { open: "\\[", close: "\\]", display: true },
  { open: "\\(", close: "\\)", display: false },
  { open: "$", close: "$", display: false },
];

/**
 * 把文本切成「纯文本」与「LaTeX 片段」。
 * 行内 `$...$` 要求紧贴内容（首尾不能是空格），否则 `价格 $5 和 $10` 会被误判成公式。
 * 没有配对的定界符一律当普通文本，不猜。
 */
export function splitMath(input: string): MathSegment[] {
  const segments: MathSegment[] = [];
  let buffer = "";
  let index = 0;

  while (index < input.length) {
    const char = input[index]!;
    if (char === "\\" && input[index + 1] === "$") {
      buffer += "$";
      index += 2;
      continue;
    }
    const delimiter = DELIMITERS.find((candidate) => input.startsWith(candidate.open, index));
    const contentStart = index + (delimiter?.open.length ?? 0);
    const closeIndex = delimiter ? input.indexOf(delimiter.close, contentStart) : -1;
    const content = closeIndex < 0 ? "" : input.slice(contentStart, closeIndex);
    const usable =
      delimiter !== undefined &&
      closeIndex > contentStart &&
      content.trim().length > 0 &&
      (delimiter.display || (!content.includes("\n") && !/^\s|\s$/.test(content)));

    if (!usable) {
      buffer += char;
      index += 1;
      continue;
    }
    if (buffer.length > 0) {
      segments.push({ kind: "text", value: buffer });
      buffer = "";
    }
    segments.push({ kind: "math", value: content, display: delimiter.display });
    index = closeIndex + delimiter.close.length;
  }

  if (buffer.length > 0) segments.push({ kind: "text", value: buffer });
  return segments;
}

/** 去掉 LaTeX 定界符、保留算式本身。给不做公式排版的宿主用。 */
export function stripMathDelimiters(input: string): string {
  return splitMath(input)
    .map((segment) => segment.value)
    .join("");
}
