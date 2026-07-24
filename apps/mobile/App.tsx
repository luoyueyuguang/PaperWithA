import React, { useMemo, useState } from "react";
import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from "react-native";
import { createMobileShell } from "./src/index";

const graph = {
  graphId: "mobile-demo-graph",
  documentId: "mobile-demo-document",
  documentVersionId: "mobile-demo-document:v1",
  pages: [{ pageId: "mobile-page-1", pageNumber: 1, confidence: 1, text: "Attention Is All You Need\n\nThe Transformer follows a different path: it relies entirely on attention to draw global dependencies between input and output. Self-attention connects all positions in a sequence with a constant number of operations." }],
};
const demoPage = graph.pages[0]!;
const layout = { root: { kind: "stack" as const, stackId: "main", panelIds: ["paper"] }, panels: { paper: { panelId: "paper", contentRef: "paper-view" } } };

export default function App() {
  const shell = useMemo(() => createMobileShell({ workspaceId: "mobile-workspace", papers: [], layout, activePaperId: null }), []);
  const [mode, setMode] = useState<"reader" | "brief">("reader");
  const [opened, setOpened] = useState(false);
  const openDemo = () => { shell.openPaper({ documentId: graph.documentId, graph, title: "Attention Is All You Need" }); setOpened(true); };
  return <SafeAreaView style={styles.safe}>
    <View style={styles.header}><Text style={styles.logo}>P</Text><Text style={styles.title}>PaperWithA</Text><Text style={styles.caption}>LOCAL FIRST</Text></View>
    <ScrollView contentContainerStyle={styles.scroll}>
      <Text style={styles.eyebrow}>MOBILE READER</Text>
      <Text style={styles.heading}>{opened ? "Read deeply." : "Your paper workspace."}</Text>
      {!opened ? <><Text style={styles.copy}>A touch-first reading view with explicit evidence context and a structured brief.</Text><Pressable style={styles.primary} onPress={openDemo}><Text style={styles.primaryText}>Open demo paper</Text></Pressable></> : <>
        <View style={styles.tabs}><Pressable onPress={() => setMode("reader")}><Text style={[styles.tab, mode === "reader" && styles.activeTab]}>Paper</Text></Pressable><Pressable onPress={() => setMode("brief")}><Text style={[styles.tab, mode === "brief" && styles.activeTab]}>Brief</Text></Pressable></View>
        <View style={styles.card}>{mode === "reader" ? <><Text style={styles.paperTitle}>{demoPage.text.split("\n")[0]}</Text><Text style={styles.body}>{demoPage.text.split("\n").slice(2).join(" ")}</Text></> : <><Text style={styles.paperTitle}>Reading Brief</Text><Text style={styles.body}>The Transformer uses attention rather than recurrence or convolution to connect all positions in a sequence. This enables parallel computation and captures global dependencies.</Text></>}</View>
        <Text style={styles.local}>Saved in the mobile workspace · {shell.capabilities.persistentStorage}</Text>
      </>}
    </ScrollView>
  </SafeAreaView>;
}

const styles = StyleSheet.create({ safe: { flex: 1, backgroundColor: "#09111f" }, header: { height: 70, paddingHorizontal: 22, flexDirection: "row", alignItems: "center", gap: 10 }, logo: { width: 32, height: 32, paddingTop: 3, textAlign: "center", borderRadius: 9, backgroundColor: "#c9f269", color: "#15200c", fontSize: 21, fontWeight: "800" }, title: { color: "#f2f5fa", fontSize: 16, fontWeight: "800" }, caption: { marginLeft: "auto", color: "#8393aa", fontSize: 9, letterSpacing: 1.4 }, scroll: { flexGrow: 1, padding: 24, backgroundColor: "#f4f6fa", borderTopLeftRadius: 22, borderTopRightRadius: 22 }, eyebrow: { marginTop: 15, color: "#8193a9", fontSize: 10, fontWeight: "800", letterSpacing: 1.8 }, heading: { marginTop: 18, color: "#172943", fontFamily: "Georgia", fontSize: 39, lineHeight: 43 }, copy: { maxWidth: 330, marginTop: 15, color: "#6f7f94", fontSize: 15, lineHeight: 24 }, primary: { alignSelf: "flex-start", marginTop: 26, paddingHorizontal: 18, paddingVertical: 13, borderRadius: 9, backgroundColor: "#c9f269" }, primaryText: { color: "#15200c", fontSize: 13, fontWeight: "800" }, tabs: { flexDirection: "row", gap: 24, marginTop: 26, borderBottomWidth: 1, borderBottomColor: "#dfe5ed" }, tab: { paddingBottom: 12, color: "#8a98aa", fontSize: 13, fontWeight: "700" }, activeTab: { color: "#172943", borderBottomWidth: 2, borderBottomColor: "#9fbd58" }, card: { marginTop: 22, padding: 20, borderRadius: 14, backgroundColor: "#fff", shadowColor: "#20304b", shadowOpacity: 0.08, shadowRadius: 14 }, paperTitle: { color: "#172943", fontFamily: "Georgia", fontSize: 24, fontWeight: "700" }, body: { marginTop: 16, color: "#43546b", fontFamily: "Georgia", fontSize: 17, lineHeight: 29 }, local: { marginTop: 18, color: "#8794a6", fontSize: 11 }
});
