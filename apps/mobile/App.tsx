import React, { useMemo, useState } from "react";
import {
  Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { createMobileShell } from "./src/index";
import {
  createAgentWorkspace,
  createAgentSession,
  addAgentSession,
  appendAgentMessage,
  replaceAgentSession,
  activeAgentBranch,
  startAgentRun,
  finishAgentRun,
  type AgentWorkspaceState,
  type AgentSession,
  type AgentContextSnapshot,
} from "@paperwitha/agent-core";
import type { DocumentGraph } from "@paperwitha/domain";
import { createPaperViewState } from "@paperwitha/reader-core";
import { buildContext, type ContextSource } from "@paperwitha/context";

const demoGraph: DocumentGraph = {
  graphId: "mobile-demo-graph",
  documentId: "mobile-demo-document",
  documentVersionId: "mobile-demo-document:v1",
  pages: [{
    pageId: "mobile-page-1",
    pageNumber: 1,
    text: "The dominant sequence transduction models are based on complex recurrent or convolutional neural networks. We propose a new simple network architecture, the Transformer, based solely on attention mechanisms.",
    confidence: 1,
  }],
  blobHash: null,
};
const demoPage = demoGraph.pages[0]!;

const demoSources: ContextSource[] = [
  { sourceId: "source-1", documentId: demoGraph.documentId, text: demoPage.text },
];

interface RuntimeProfileMeta {
  id: string;
  name: string;
  adapterKind: string;
  icon: string;
}
interface AgentProfileMeta {
  id: string;
  name: string;
  runtimeId: string;
  description: string;
  defaultModel: string | null;
}
const RUNTIME_PROFILES: readonly RuntimeProfileMeta[] = [
  { id: "paperwitha-local-runtime", name: "Local Evidence Agent", adapterKind: "embedded", icon: "◎" },
  { id: "omp-rpc", name: "OMP", adapterKind: "omp-rpc", icon: "○" },
  { id: "pi-rpc", name: "Pi", adapterKind: "pi-rpc", icon: "π" },
  { id: "opencode-http", name: "OpenCode", adapterKind: "opencode-http", icon: "◇" },
];
const AGENT_PROFILES: readonly AgentProfileMeta[] = [
  { id: "paperwitha-evidence-agent", name: "Evidence Agent", runtimeId: "paperwitha-local-runtime", description: "Local evidence-based answers", defaultModel: null },
  { id: "omp-task", name: "OMP Task Agent", runtimeId: "omp-rpc", description: "General-purpose coding and research agent", defaultModel: null },
  { id: "pi-coding-agent", name: "Pi Coding Agent", runtimeId: "pi-rpc", description: "Interactive coding agent with tool calling", defaultModel: null },
  { id: "opencode-task", name: "OpenCode Agent", runtimeId: "opencode-http", description: "Headless OpenCode agent", defaultModel: null },
];

const layout = {
  root: { kind: "stack" as const, stackId: "main", panelIds: ["paper"] },
  panels: { paper: { panelId: "paper", contentRef: "paper-view" } },
};

function createAgentSnapshot(input: {
  runId: string;
  docIds: string[];
  query: string;
  now: string;
}): AgentContextSnapshot {
  const result = buildContext(
    { documents: input.docIds, fixedSourceIds: [], query: input.query, retrievalVersion: "1" },
    demoSources,
    8192,
  );
  return {
    snapshotId: input.runId,
    documentIds: input.docIds,
    fixedSourceIds: [],
    selectedSourceIds: result.selectedSourceIds,
    omittedSourceIds: result.omittedSourceIds,
    query: input.query,
    retrievalVersion: "1",
    tokenCount: result.tokenCount,
    createdAt: input.now,
  };
}

function createDemoSession(runtimeProfileId = "paperwitha-local-runtime", agentProfileId = "paperwitha-evidence-agent"): AgentSession {
  const now = new Date().toISOString();
  let session = createAgentSession({
    sessionId: "mobile-session-1",
    branchId: "mobile-branch-1",
    title: "Transformer analysis",
    agentProfileId,
    runtimeProfileId,
    context: { documentIds: [demoGraph.documentId] },
    now,
  });
  session = appendAgentMessage(session, {
    messageId: "m1",
    role: "user",
    text: "What is the main contribution?",
    createdAt: now, runId: null,
  });
  session = appendAgentMessage(session, {
    messageId: "m2",
    role: "assistant",
    text: "The key contribution is replacing recurrence and convolution with pure attention mechanisms, enabling parallel computation and capturing long-range dependencies.",
    createdAt: now, runId: null,
  });
  return session;
}

export default function App() {
  const shell = useMemo(() => createMobileShell({
    workspaceId: "mobile-workspace",
    papers: [],
    layout,
    activePaperId: null,
  }), []);
  const [workspace, setWorkspace] = useState<AgentWorkspaceState>(() =>
    addAgentSession(createAgentWorkspace(), createDemoSession()),
  );
  const [mode, setMode] = useState<"reader" | "brief" | "agents">("reader");
  const [opened, setOpened] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [defaultRuntimeId, setDefaultRuntimeId] = useState("paperwitha-local-runtime");
  const [defaultAgentId, setDefaultAgentId] = useState("paperwitha-evidence-agent");
  const runtimeMeta = RUNTIME_PROFILES.find((r) => r.id === defaultRuntimeId) ?? RUNTIME_PROFILES[0]!;
  const agentMeta = AGENT_PROFILES.find((a) => a.id === defaultAgentId) ?? AGENT_PROFILES[0]!;

  const openDemo = () => {
    shell.openPaper({
      documentId: demoGraph.documentId,
      graph: demoGraph,
      title: "Attention Is All You Need",
    });
    setOpened(true);
  };

  const replaceSession = (session: AgentSession) => {
    setWorkspace((prev) => replaceAgentSession(prev, session));
  };

  const handleSend = () => {
    const text = chatInput.trim();
    if (!text) return;
    setChatInput("");

    const session = workspace.sessions[0];
    if (!session) return;

    const now = new Date().toISOString();
    const runId = `run-${Date.now()}`;
    const userMsgId = `m-usr-${Date.now()}`;
    const asstMsgId = `m-asst-${Date.now()}`;

    // 1. Append user message
    let next = appendAgentMessage(session, {
      messageId: userMsgId,
      role: "user",
      text,
      createdAt: now,
      runId: null,
    });

    // 2. Build context snapshot and start run
    const snapshot = createAgentSnapshot({
      runId,
      docIds: [demoGraph.documentId],
      query: text,
      now,
    });
    next = startAgentRun(next, { runId, snapshot, model: null, now });

    // 3. Simulate agent response (mobile demo - no real LLM runtime)
    const demoResponse = buildDemoResponse(text);
    next = appendAgentMessage(next, {
      messageId: asstMsgId,
      role: "assistant",
      text: demoResponse,
      createdAt: now,
      runId,
    });

    // 4. Finish run
    next = finishAgentRun(next, runId, { status: "completed", now });

    replaceSession(next);
  };

  const session = workspace.sessions[0];
  const branch = session ? activeAgentBranch(session) : null;

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Text style={styles.logo}>P</Text>
        <Text style={styles.title}>PaperWithA</Text>
        <Text style={styles.caption}>LOCAL FIRST</Text>
      </View>
      <ScrollView contentContainerStyle={styles.scroll}>
        {!opened ? (
          <>
            <Text style={styles.eyebrow}>MOBILE READER</Text>
            <Text style={styles.heading}>Your paper workspace</Text>
            <Text style={styles.copy}>
              A touch-first reading view with multi-session agents, handwriting,
              and structured briefs.
            </Text>
            <Pressable style={styles.primary} onPress={openDemo}>
              <Text style={styles.primaryText}>Open demo paper</Text>
            </Pressable>
          </>
        ) : (
          <>
            <View style={styles.tabs}>
              <Pressable onPress={() => setMode("reader")}>
                <Text style={[styles.tab, mode === "reader" && styles.activeTab]}>
                  Paper
                </Text>
              </Pressable>
              <Pressable onPress={() => setMode("brief")}>
                <Text style={[styles.tab, mode === "brief" && styles.activeTab]}>
                  Brief
                </Text>
              </Pressable>
              <Pressable onPress={() => setMode("agents")}>
                <Text style={[styles.tab, mode === "agents" && styles.activeTab]}>
                  Agents
                </Text>
              </Pressable>
            </View>

            {mode === "reader" && (
              <View style={styles.card}>
                <Text style={styles.paperTitle}>
                  {demoPage.text.split(".")[0]}.
                </Text>
                <Text style={styles.body}>{demoPage.text}</Text>
              </View>
            )}

            {mode === "brief" && (
              <View style={styles.card}>
                <Text style={styles.paperTitle}>Reading Brief</Text>
                <Text style={styles.body}>
                  The Transformer uses attention rather than recurrence or
                  convolution. This enables parallel computation and captures
                  global dependencies across all positions in a sequence.
                </Text>
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>stated</Text>
                </View>
              </View>
            )}

            {mode === "agents" && (
              <View style={styles.card}>
                <View style={styles.profileBar}>
                  <Text style={styles.profileIcon}>{runtimeMeta.icon}</Text>
                  <View style={styles.profileSelects}>
                    <View style={styles.profileRow}>
                      <Text style={styles.profileLabel}>Runtime:</Text>
                      <View style={styles.profileOptions}>
                        {RUNTIME_PROFILES.map((r) => (
                          <Pressable key={r.id} onPress={() => { setDefaultRuntimeId(r.id); const compat = AGENT_PROFILES.find((a) => a.runtimeId === r.id); if (compat) setDefaultAgentId(compat.id); }}>
                            <Text style={[styles.profileOption, r.id === defaultRuntimeId && styles.profileOptionActive]}>{r.icon} {r.name}</Text>
                          </Pressable>
                        ))}
                      </View>
                    </View>
                    <View style={styles.profileRow}>
                      <Text style={styles.profileLabel}>Agent:</Text>
                      <View style={styles.profileOptions}>
                        {AGENT_PROFILES.filter((a) => a.runtimeId === defaultRuntimeId).map((a) => (
                          <Pressable key={a.id} onPress={() => setDefaultAgentId(a.id)}>
                            <Text style={[styles.profileOption, a.id === defaultAgentId && styles.profileOptionActive]}>{a.name}</Text>
                          </Pressable>
                        ))}
                      </View>
                    </View>
                  </View>
                </View>
                <Text style={styles.sessionMeta}>
                  {runtimeMeta.icon} {agentMeta.name} · {runtimeMeta.name}
                  {session && branch?.activeRunId ? " · Running" : ""}
                </Text>
                <Text style={styles.paperTitle}>
                  Agent Session · {session?.title}
                </Text>

                {branch?.messages.map((msg) => (
                  <View
                    key={msg.messageId}
                    style={[
                      styles.message,
                      msg.role === "user" ? styles.userMsg : styles.assistantMsg,
                    ]}
                  >
                    <Text style={styles.msgRole}>
                      {msg.role === "user" ? "You" : agentMeta.name}
                    </Text>
                    <Text style={styles.msgText}>{msg.text}</Text>
                  </View>
                ))}

                <View style={styles.chatBar}>
                  <TextInput
                    style={styles.chatInput}
                    value={chatInput}
                    onChangeText={setChatInput}
                    placeholder={`Ask ${agentMeta.name}...`}
                    placeholderTextColor="#a3b1c4"
                    onSubmitEditing={handleSend}
                    returnKeyType="send"
                  />
                  <Pressable
                    style={[
                      styles.sendBtn,
                      !chatInput.trim() && styles.sendBtnDisabled,
                    ]}
                    onPress={handleSend}
                    disabled={!chatInput.trim()}
                  >
                    <Text style={styles.sendBtnText}>Send</Text>
                  </Pressable>
                </View>
              </View>
            )}

            <Text style={styles.local}>
              Saved locally · {shell.capabilities.persistentStorage}
            </Text>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function buildDemoResponse(query: string): string {
  const q = query.toLowerCase();
  if (q.includes("attention") || q.includes("mechanism")) {
    return "Attention mechanisms allow the model to weigh the importance of different input tokens when computing each output token. Self-attention specifically relates different positions within a single sequence to compute a representation of that sequence.";
  }
  if (q.includes("transformer") || q.includes("architecture")) {
    return "The Transformer architecture consists of an encoder and decoder, each composed of stacked self-attention and feed-forward layers. It processes all input tokens in parallel rather than sequentially.";
  }
  if (q.includes("contribution") || q.includes("main")) {
    return "The key contribution is replacing recurrence and convolution with pure attention mechanisms, enabling parallel computation and capturing long-range dependencies.";
  }
  return `Based on the paper "Attention Is All You Need," the authors propose a simple yet powerful architecture that relies entirely on attention mechanisms, eliminating the need for recurrence and convolution. This enables significantly more parallelization and achieves state-of-the-art results on machine translation tasks.`;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#09111f" },
  header: {
    height: 70,
    paddingHorizontal: 22,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  logo: {
    width: 32,
    height: 32,
    paddingTop: 3,
    textAlign: "center",
    borderRadius: 9,
    backgroundColor: "#c9f269",
    color: "#15200c",
    fontSize: 21,
    fontWeight: "800",
  },
  title: { color: "#f2f5fa", fontSize: 16, fontWeight: "800" },
  caption: {
    marginLeft: "auto",
    color: "#8393aa",
    fontSize: 9,
    letterSpacing: 1.4,
  },
  scroll: {
    flexGrow: 1,
    padding: 24,
    backgroundColor: "#f4f6fa",
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
  },
  eyebrow: {
    marginTop: 15,
    color: "#8193a9",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.8,
  },
  heading: {
    marginTop: 18,
    color: "#172943",
    fontFamily: "Georgia",
    fontSize: 38,
    fontWeight: "400",
    letterSpacing: -1,
  },
  copy: {
    marginTop: 14,
    color: "#6b7d95",
    fontSize: 14,
    lineHeight: 22,
  },
  primary: {
    marginTop: 28,
    padding: 16,
    borderRadius: 12,
    backgroundColor: "#c9f269",
    alignItems: "center",
  },
  primaryText: { color: "#15200c", fontSize: 15, fontWeight: "700" },
  tabs: { flexDirection: "row", gap: 22, marginTop: 18, marginBottom: 18 },
  tab: { color: "#8c9cb3", fontSize: 13, fontWeight: "700", paddingBottom: 6 },
  activeTab: {
    color: "#172943",
    borderBottomWidth: 2,
    borderBottomColor: "#c9f269",
  },
  card: {
    padding: 22,
    borderRadius: 14,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#e2e7ee",
  },
  profileBar: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    marginBottom: 16,
    padding: 14,
    borderRadius: 10,
    backgroundColor: "#f7f9fc",
    borderWidth: 1,
    borderColor: "#e8ecf2",
  },
  profileIcon: { fontSize: 24, marginTop: 2 },
  profileSelects: { flex: 1, gap: 10 },
  profileRow: { flexDirection: "column", gap: 4 },
  profileLabel: { color: "#6b7d95", fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.8 },
  profileOptions: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  profileOption: {
    color: "#6b7d95",
    fontSize: 12,
    fontWeight: "600",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: "#e8ecf2",
  },
  profileOptionActive: {
    color: "#15200c",
    backgroundColor: "#c9f269",
  },
  sessionMeta: {
    color: "#8393aa",
    fontSize: 11,
    marginBottom: 8,
  },
  paperTitle: {
    color: "#172943",
    fontFamily: "Georgia",
    fontSize: 22,
    marginBottom: 14,
  },
  body: { color: "#35445b", fontSize: 14, lineHeight: 22 },
  badge: {
    alignSelf: "flex-start",
    marginTop: 12,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 5,
    backgroundColor: "#d4edda",
  },
  badgeText: {
    color: "#1a4d24",
    fontSize: 9,
    fontWeight: "700",
    textTransform: "uppercase",
  },
  message: { marginTop: 14, padding: 12, borderRadius: 10 },
  userMsg: { backgroundColor: "#edf4ff", marginLeft: 16 },
  assistantMsg: { backgroundColor: "#f4f7f8", marginRight: 8 },
  msgRole: {
    fontSize: 9,
    fontWeight: "800",
    color: "#8291a4",
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 4,
  },
  msgText: { fontSize: 12, color: "#35445b", lineHeight: 18 },
  chatBar: {
    marginTop: 18,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: "#e2e7ee",
    paddingTop: 12,
  },
  chatInput: {
    flex: 1,
    height: 42,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: "#f4f6fa",
    borderWidth: 1,
    borderColor: "#e2e7ee",
    fontSize: 13,
    color: "#172943",
  },
  sendBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: "#c9f269",
  },
  sendBtnDisabled: {
    backgroundColor: "#e2e7ee",
  },
  sendBtnText: {
    color: "#15200c",
    fontSize: 13,
    fontWeight: "700",
  },
  local: {
    marginTop: 22,
    color: "#a3b1c4",
    fontSize: 10,
    textAlign: "center",
  },
});
