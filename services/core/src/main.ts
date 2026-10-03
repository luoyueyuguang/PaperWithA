import { mkdir } from "node:fs/promises";
import { EmbeddedAgent } from "./agent";
import { corePaths, corePort } from "./config";
import { detectRenderers } from "./render";
import { CoreServer } from "./server";
import { ArtifactStore } from "./store/artifacts";
import { PaperStore } from "./store/papers";
import { SessionStore } from "./store/sessions";

const paths = corePaths();
for (const dir of [paths.papersDir, paths.textDir, paths.sessionsDir, paths.workspacesDir, paths.artifactsDir]) {
  await mkdir(dir, { recursive: true });
}

const papers = await PaperStore.open(paths);
const artifacts = new ArtifactStore(paths);
const interrupted = await artifacts.failInterrupted();
if (interrupted > 0) console.log(`[core] ${interrupted} 个上次没跑完的图件已标记为失败`);
const renderers = await detectRenderers();
const server = new CoreServer({
  paths,
  papers,
  sessions: new SessionStore(paths),
  artifacts,
  agent: new EmbeddedAgent(paths),
  renderers,
});

const port = corePort();
server.start(port);
const capabilities = [renderers.svg ? "svg" : null, renderers.video ? "video" : null, renderers.manim ? "manim" : null]
  .filter((name): name is string => name !== null)
  .join("+");
console.log(
  `[core] listening on http://127.0.0.1:${port}  data: ${paths.dataDir}  papers: ${papers.list().length}  renderers: ${capabilities || "无"}`,
);

let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    if (stopping) return;
    stopping = true;
    void server.stop().then(() => process.exit(0));
  });
}
