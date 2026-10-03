import type { PaperSummary } from "@paperwitha/domain";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { core } from "../client";
import { Screen } from "../components/Screen";
import { StatusView } from "../components/StatusView";
import { useAsync } from "../hooks/useAsync";

export interface ReaderScreenProps {
  readonly paper: PaperSummary;
  readonly onBack: () => void;
  readonly onOpenChat: () => void;
}

export function ReaderScreen({ paper, onBack, onOpenChat }: ReaderScreenProps) {
  const text = useAsync(() => core.getPaperText(paper.id), [paper.id]);

  return (
    <Screen
      title={paper.title}
      subtitle={text.data !== null ? `共 ${text.data.pages.length} 页` : paper.fileName}
      onBack={onBack}
      right={
        <Pressable onPress={onOpenChat} hitSlop={10}>
          <Text style={styles.chatLink}>对话</Text>
        </Pressable>
      }
    >
      {text.data === null && text.loading ? (
        <StatusView kind="loading" title="正在加载正文…" />
      ) : text.data === null && text.error !== null ? (
        <StatusView kind="error" title="读取正文失败" detail={text.error} actionLabel="重试" onAction={text.reload} />
      ) : text.data !== null && text.data.pages.length === 0 ? (
        <StatusView kind="empty" title="这篇论文没有可读文本" detail="core 未解析出任何页面文本。" />
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          {text.error !== null ? <Text style={styles.banner}>刷新失败：{text.error}</Text> : null}
          {text.data?.pages.map((page) => (
            <View key={page.pageNumber} style={styles.page}>
              <Text style={styles.pageLabel}>第 {page.pageNumber} 页</Text>
              <Text style={styles.pageText} selectable>
                {page.text}
              </Text>
            </View>
          ))}
        </ScrollView>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: 16,
    gap: 24,
  },
  banner: {
    color: "#b91c1c",
    fontSize: 13,
  },
  page: {
    gap: 8,
  },
  pageLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: "#2563eb",
  },
  pageText: {
    fontSize: 15,
    lineHeight: 24,
    color: "#1f2937",
  },
  chatLink: {
    fontSize: 14,
    color: "#2563eb",
    fontWeight: "600",
  },
});
