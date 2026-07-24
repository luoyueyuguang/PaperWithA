import React, { useMemo, useState } from "react";
import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from "react-native";
import { createMobileShell } from "./src/index";
import { createAgentSession, createAgentWorkspace, addAgentSession, appendAgentMessage, type AgentWorkspaceState, type AgentSession } from "@paperwitha/agent-core";
import type { DocumentGraph } from "@paperwitha/domain";
import { createPaperViewState } from "@paperwitha/reader-core";

const demoGraph: DocumentGraph = {
  graphId: "mobile-demo-graph",
  documentId: "mobile-demo-document",
  documentVersionId: "mobile-demo-document:v1",
  pages: [{ pageId: "mobile-page-1", pageNumber: 1, text: "The dominant sequence transduction models are based on complex recurrent or convolutional neural networks. We propose a new simple network architecture, the Transformer, based solely on attention mechanisms.", confidence: 1 }],
  blobHash: null,
};
const demoPage = demoGraph.pages[0]!;
const layout = { root: { kind: "stack" as const, stackId: "main", panelIds: ["paper"] }, panels: { paper: { panelId: "paper", contentRef: "paper-view" } } };

function createDemoSession(): AgentSession {
  const now = new Date().toISOString();
  let session = createAgentSession({
    sessionId: "mobile-session-1",
    branchId: "mobile-branch-1",
    title: "Transformer analysis",
    agentProfileId: "paperwitha-evidence-agent",
    runtimeProfileId: "paperwitha-local-runtime",
    context: { documentIds: [demoGraph.documentId] },
    now,
  });
  session = appendAgentMessage(session, { messageId: "m1", role: "user", text: "What is the main contribution?", createdAt: now, runId: null });
  session = appendAgentMessage(session, { messageId: "m2", role: "assistant", text: "The key contribution is replacing recurrence and convolution with pure attention mechanisms, enabling parallel computation and capturing long-range dependencies.", createdAt: now, runId: null });
  return session;
}

export default function App() {
  const shell = useMemo(() => createMobileShell({ workspaceId: "mobile-workspace", papers: [], layout, activePaperId: null }), []);
  const [workspace] = useState<AgentWorkspaceState>(() => addAgentSession(createAgentWorkspace(), createDemoSession()));
  const [mode, setMode] = useState<"reader" | "brief" | "agents">("reader");
  const [opened, setOpened] = useState(false);
  const openDemo = () => { shell.openPaper({ documentId: demoGraph.documentId, graph: demoGraph, title: "Attention Is All You Need" }); setOpened(true); };
  const session = workspace.sessions[0];
  const branch = session?.branches[0];

  return <SafeAreaView style={styles.safe}>
    <View style={styles.header}><Text style={styles.logo}>P</Text><Text style={styles.title}>PaperWithA</Text><Text style={styles.caption}>LOCAL FIRST</Text></View>
    <ScrollView contentContainerStyle={styles.scroll}>
      {!opened ? <><Text style={styles.eyebrow}>MOBILE READER</Text><Text style={styles.heading}>Your paper workspace</Text><Text style={styles.copy}>A touch-first reading view with multi-session agents, handwriting, and structured briefs.</Text><Pressable style={styles.primary} onPress={openDemo}><Text style={styles.primaryText}>Open demo paper</Text></Pressable></> : <>
        <View style={styles.tabs}>
          <Pressable onPress={() => setMode("reader")}><Text style={[styles.tab, mode === "reader" && styles.activeTab]}>Paper</Text></Pressable>
          <Pressable onPress={() => setMode("brief")}><Text style={[styles.tab, mode === "brief" && styles.activeTab]}>Brief</Text></Pressable>
          <Pressable onPress={() => setMode("agents")}><Text style={[styles.tab, mode === "agents" && styles.activeTab]}>Agents</Text></Pressable>
        </View>
        {mode === "reader" && <View style={styles.card}><Text style={styles.paperTitle}>{demoPage.text.split(".")[0]}.</Text><Text style={styles.body}>{demoPage.text}</Text></View>}
        {mode === "brief" && <View style={styles.card}><Text style={styles.paperTitle}>Reading Brief</Text><Text style={styles.body}>The Transformer uses attention rather than recurrence or convolution. This enables parallel computation and captures global dependencies across all positions in a sequence.</Text><View style={styles.badge}><Text style={styles.badgeText}>stated</Text></View></View>}
        {mode === "agents" && <View style={styles.card}><Text style={styles.paperTitle}>Agent Session · {session?.title}</Text>{branch?.messages.map((msg) => <View key={msg.messageId} style={[styles.message, msg.role === "user" ? styles.userMsg : styles.assistantMsg]}><Text style={styles.msgRole}>{msg.role === "user" ? "You" : "Evidence Agent"}</Text><Text style={styles.msgText}>{msg.text}</Text></View>)}</View>}
        <Text style={styles.local}>Saved locally · {shell.capabilities.persistentStorage}</Text>
      </>}
    </ScrollView>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#09111f" },
  header: { height: 70, paddingHorizontal: 22, flexDirection: "row", alignItems: "center", gap: 10 },
  logo: { width: 32, height: 32, paddingTop: 3, textAlign: "center", borderRadius: 9, backgroundColor: "#c9f269", color: "#15200c", fontSize: 21, fontWeight: "800" },
  title: { color: "#f2f5fa", fontSize: 16, fontWeight: "800" },
  caption: { marginLeft: "auto", color: "#8393aa", fontSize: 9, letterSpacing: 1.4 },
  scroll: { flexGrow: 1, padding: 24, backgroundColor: "#f4f6fa", borderTopLeftRadius: 22, borderTopRightRadius: 22 },
  eyebrow: { marginTop: 15, color: "#8193a9", fontSize: 10, fontWeight: "800", letterSpacing: 1.8 },
  heading: { marginTop: 18, color: "#172943", fontFamily: "Georgia", fontSize: 38, fontWeight: "400", letterSpacing: -1 },
  copy: { marginTop: 14, color: "#6b7d95", fontSize: 14, lineHeight: 22 },
  primary: { marginTop: 28, padding: 16, borderRadius: 12, backgroundColor: "#c9f269", alignItems: "center" },
  primaryText: { color: "#15200c", fontSize: 15, fontWeight: "750" },
  tabs: { flexDirection: "row", gap: 22, marginTop: 18, marginBottom: 18 },
  tab: { color: "#8c9cb3", fontSize: 13, fontWeight: "700", paddingBottom: 6 },
  activeTab: { color: "#172943", borderBottomWidth: 2, borderBottomColor: "#c9f269" },
  card: { padding: 22, borderRadius: 14, backgroundColor: "#fff", borderWidth: 1, borderColor: "#e2e7ee" },
  paperTitle: { color: "#172943", fontFamily: "Georgia", fontSize: 22, marginBottom: 14 },
  body: { color: "#35445b", fontSize: 14, lineHeight: 22 },
  badge: { alignSelf: "flex-start", marginTop: 12, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 5, backgroundColor: "#d4edda" },
  badgeText: { color: "#1a4d24", fontSize: 9, fontWeight: "700", textTransform: "uppercase" },
  message: { marginTop: 14, padding: 12, borderRadius: 10 },
  userMsg: { backgroundColor: "#edf4ff", marginLeft: 16 },
  assistantMsg: { backgroundColor: "#f4f7f8", marginRight: 8 },
  msgRole: { fontSize: 9, fontWeight: "800", color: "#8291a4", textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 },
  msgText: { fontSize: 12, color: "#35445b", lineHeight: 18 },
  local: { marginTop: 22, color: "#a3b1c4", fontSize: 10, textAlign: "center" },
});
