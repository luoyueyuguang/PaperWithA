/**
 * 端到端烟测：起真实的 core、上传论文、提问，接收流式回答。
 * 需要本机 ~/.omp/agent 里有可用的模型凭证。
 *
 *   corepack pnpm --filter @paperwitha/core smoke
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CoreClient } from "@paperwitha/api-client";
import type { CoreEvent } from "@paperwitha/domain";
import { EmbeddedAgent } from "../src/agent";
import { corePaths } from "../src/config";
import { detectRenderers } from "../src/render";
import { CoreServer } from "../src/server";
import { ArtifactStore } from "../src/store/artifacts";
import { PaperStore } from "../src/store/papers";
import { SessionStore } from "../src/store/sessions";

const PORT = 4199;
const TIMEOUT_MS = 180_000;
const PAPER = `Attention Is All You Need

Abstract: The dominant sequence transduction models are based on complex recurrent or convolutional
neural networks. We propose a new simple network architecture, the Transformer, based solely on
attention mechanisms, dispensing with recurrence and convolutions entirely.

1 Introduction: Recurrent models typically factor computation along the symbol positions of the
input and output sequences. This inherently sequential nature precludes parallelization within
training examples.

3.2 Attention: An attention function can be described as mapping a query and a set of key-value
pairs to an output. We call our particular attention "Scaled Dot-Product Attention".
`;

const dataDir = await mkdtemp(join(tmpdir(), "pwa-smoke-"));
const paths = corePaths({ ...process.env, PAPERWITHA_DATA_DIR: dataDir });
const server = new CoreServer({
  paths,
  papers: await PaperStore.open(paths),
  sessions: new SessionStore(paths),
  artifacts: new ArtifactStore(paths),
  agent: new EmbeddedAgent(paths),
  renderers: await detectRenderers(),
});
server.start(PORT);

const client = new CoreClient({ baseUrl: `http://127.0.0.1:${PORT}` });
let failures = 0;

function check(label: string, condition: boolean, detail = ""): void {
  if (condition) {
    console.log(`[smoke] ok   ${label}${detail ? ` — ${detail}` : ""}`);
    return;
  }
  failures += 1;
  console.log(`[smoke] FAIL ${label}${detail ? ` — ${detail}` : ""}`);
}

try {
  const form = new FormData();
  form.append("file", new File([PAPER], "attention.txt", { type: "text/plain" }));
  const paper = await client.uploadPaper(form);
  check("upload", paper.id.length === 12 && paper.pageCount === 1, `${paper.title} / ${paper.pageCount} page`);

  const text = await client.getPaperText(paper.id);
  check("paper text", (text?.pages.length ?? 0) === 1);

  const session = await client.createSession(paper.id);
  check("create session", session.paperId === paper.id);

  let streamed = "";
  let toolCalls = 0;
  const outcomePromise = new Promise<CoreEvent | "timeout">((resolve) => {
    const timer = setTimeout(() => resolve("timeout"), TIMEOUT_MS);
    const subscription = client.subscribe((event) => {
      if (event.sessionId !== session.id) return;
      if (event.type === "text-delta") streamed += event.delta;
      if (event.type === "tool-start") toolCalls += 1;
      if (event.type === "message-completed" || event.type === "run-failed") {
        clearTimeout(timer);
        subscription.close();
        resolve(event);
      }
    });
  });

  const { runId } = await client.prompt(session.id, "这篇论文的核心贡献是什么？用一句话回答，并标注页码。");
  check("prompt accepted", runId.length > 0);

  const outcome = await outcomePromise;

  check("agent responded", outcome !== "timeout", outcome === "timeout" ? `超时 ${TIMEOUT_MS}ms` : `${streamed.length} chars, ${toolCalls} tool calls`);

  if (outcome !== "timeout" && outcome.type === "message-completed") {
    check("answer non-empty", outcome.message.text.length > 0, outcome.message.text.slice(0, 160));
    check(
      "citations parsed",
      outcome.message.citations.length > 0,
      JSON.stringify(outcome.message.citations.map((citation) => citation.pageNumber)),
    );
  } else if (outcome !== "timeout") {
    check("agent run", false, outcome.type === "run-failed" ? outcome.message : outcome.type);
  }

  const stored = (await client.listSessions(paper.id)).at(0);
  check("session persisted", (stored?.messages.length ?? 0) === 2, `${stored?.messages.length ?? 0} messages`);
} finally {
  await server.stop();
  await rm(dataDir, { recursive: true, force: true });
}

console.log(failures === 0 ? "[smoke] PASS" : `[smoke] ${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
