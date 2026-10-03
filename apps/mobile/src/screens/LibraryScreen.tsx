import type { PaperSummary } from "@paperwitha/domain";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { core } from "../client";
import { Screen } from "../components/Screen";
import { StatusView } from "../components/StatusView";
import { useAsync } from "../hooks/useAsync";

export interface LibraryScreenProps {
  readonly onOpenReader: (paper: PaperSummary) => void;
  readonly onOpenChat: (paper: PaperSummary) => void;
}

export function LibraryScreen({ onOpenReader, onOpenChat }: LibraryScreenProps) {
  const papers = useAsync(() => core.listPapers(), []);

  const refreshButton = (
    <Pressable onPress={papers.reload} hitSlop={10} disabled={papers.loading}>
      <Text style={[styles.refresh, papers.loading && styles.refreshDisabled]}>刷新</Text>
    </Pressable>
  );

  return (
    <Screen title="论文库" subtitle={papers.data !== null ? `共 ${papers.data.length} 篇` : undefined} right={refreshButton}>
      {papers.data === null && papers.loading ? (
        <StatusView kind="loading" title="正在加载论文…" />
      ) : papers.error !== null && (papers.data === null || papers.data.length === 0) ? (
        <StatusView kind="error" title="连接 core 失败" detail={papers.error} actionLabel="重试" onAction={papers.reload} />
      ) : papers.data !== null && papers.data.length === 0 ? (
        <StatusView
          kind="empty"
          title="还没有论文"
          detail="请先在桌面端或网页端导入 PDF / TXT / Markdown，然后回到这里刷新。"
          actionLabel="刷新"
          onAction={papers.reload}
        />
      ) : (
        <ScrollView contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled">
          {papers.error !== null ? <Text style={styles.banner}>刷新失败：{papers.error}</Text> : null}
          {papers.data?.map((paper) => (
            <View key={paper.id} style={styles.card}>
              <Pressable style={styles.cardMain} onPress={() => onOpenReader(paper)}>
                <Text style={styles.cardTitle} numberOfLines={2}>
                  {paper.title}
                </Text>
                <Text style={styles.cardMeta}>
                  {paper.pageCount} 页 · {formatSize(paper.size)} · {formatDate(paper.addedAt)}
                </Text>
              </Pressable>
              <Pressable style={styles.chatButton} onPress={() => onOpenChat(paper)}>
                <Text style={styles.chatButtonText}>对话</Text>
              </Pressable>
            </View>
          ))}
          {papers.loading ? <ActivityIndicator style={styles.spinner} color="#2563eb" /> : null}
        </ScrollView>
      )}
    </Screen>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString();
}

const styles = StyleSheet.create({
  list: {
    padding: 12,
    gap: 10,
  },
  banner: {
    color: "#b91c1c",
    fontSize: 13,
    paddingHorizontal: 4,
  },
  card: {
    flexDirection: "row",
    alignItems: "stretch",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#e5e7eb",
    borderRadius: 10,
    backgroundColor: "#ffffff",
    overflow: "hidden",
  },
  cardMain: {
    flex: 1,
    padding: 14,
    gap: 6,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: "600",
    color: "#111827",
  },
  cardMeta: {
    fontSize: 12,
    color: "#6b7280",
  },
  chatButton: {
    justifyContent: "center",
    paddingHorizontal: 16,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: "#e5e7eb",
    backgroundColor: "#f9fafb",
  },
  chatButtonText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#2563eb",
  },
  refresh: {
    fontSize: 14,
    color: "#2563eb",
    fontWeight: "600",
  },
  refreshDisabled: {
    color: "#9ca3af",
  },
  spinner: {
    marginTop: 12,
  },
});
