import { stripMathDelimiters, type ChatMessage, type ChatSession, type CoreEvent, type PaperSummary } from "@paperwitha/domain";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { core, describeError } from "../client";
import { Screen } from "../components/Screen";
import { StatusView } from "../components/StatusView";
import { subscribeCoreEvents } from "../events";

export interface ChatScreenProps {
  readonly paper: PaperSummary;
  readonly onBack: () => void;
}

interface Activity {
  readonly id: string;
  readonly toolName: string;
  readonly detail: string;
  readonly status: "running" | "done" | "error";
}

export function ChatScreen({ paper, onBack }: ChatScreenProps) {
  const [sessions, setSessions] = useState<readonly ChatSession[] | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [running, setRunning] = useState(false);
  const [draft, setDraft] = useState("");
  const [activities, setActivities] = useState<Activity[]>([]);

  const sessionsRef = useRef<readonly ChatSession[] | null>(null);
  sessionsRef.current = sessions;
  const activeIdRef = useRef<string | null>(null);
  activeIdRef.current = activeId;
  const scrollRef = useRef<ScrollView | null>(null);

  const loadSessions = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const list = await core.listSessions(paper.id);
      setSessions(list);
      setActiveId((current) =>
        current !== null && list.some((session) => session.id === current) ? current : (list[0]?.id ?? null),
      );
    } catch (error) {
      setLoadError(describeError(error));
    } finally {
      setLoading(false);
    }
  }, [paper.id]);

  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  useEffect(() => {
    return subscribeCoreEvents((event: CoreEvent) => {
      if (event.sessionId !== activeIdRef.current) return;
      switch (event.type) {
        case "run-started":
          setRunning(true);
          setFailure(null);
          setDraft("");
          setActivities([]);
          break;
        case "text-delta":
          setDraft((previous) => previous + event.delta);
          break;
        case "tool-start":
          setActivities((previous) => [
            ...previous,
            { id: `${event.toolName}#${previous.length}`, toolName: event.toolName, detail: event.detail, status: "running" },
          ]);
          break;
        case "tool-end":
          setActivities((previous) => settleActivity(previous, event.toolName, event.isError));
          break;
        case "message-completed":
          setRunning(false);
          setDraft("");
          setActivities([]);
          void loadSessions();
          break;
        case "run-completed":
          setRunning(false);
          setDraft("");
          setActivities([]);
          break;
        case "run-failed":
          setRunning(false);
          setDraft("");
          setActivities([]);
          setFailure(event.message);
          break;
      }
    });
  }, [loadSessions]);

  const createSession = useCallback(async () => {
    setFailure(null);
    try {
      const created = await core.createSession(paper.id);
      setSessions((previous) => (previous === null ? [created] : [created, ...previous]));
      setActiveId(created.id);
      setDraft("");
      setActivities([]);
    } catch (error) {
      setFailure(describeError(error));
    }
  }, [paper.id]);

  const removeActiveSession = useCallback(async () => {
    const id = activeIdRef.current;
    if (id === null) return;
    setFailure(null);
    try {
      await core.deleteSession(id);
      const next = (sessionsRef.current ?? []).filter((session) => session.id !== id);
      setSessions(next);
      setActiveId(next[0]?.id ?? null);
    } catch (error) {
      setFailure(describeError(error));
    }
  }, []);

  const send = useCallback(async () => {
    const question = input.trim();
    if (question.length === 0 || running) return;
    setInput("");
    setFailure(null);
    let sessionId = activeIdRef.current;
    try {
      if (sessionId === null) {
        const created = await core.createSession(paper.id);
        sessionId = created.id;
        setSessions((previous) => (previous === null ? [created] : [created, ...previous]));
        setActiveId(created.id);
      }
      const optimistic: ChatMessage = {
        id: `local-${Date.now()}`,
        role: "user",
        text: question,
        createdAt: new Date().toISOString(),
        citations: [],
      };
      const target = sessionId;
      setSessions((previous) =>
        previous === null
          ? previous
          : previous.map((session) =>
              session.id === target ? { ...session, messages: [...session.messages, optimistic] } : session,
            ),
      );
      setDraft("");
      setActivities([]);
      setRunning(true);
      await core.prompt(target, question);
    } catch (error) {
      setRunning(false);
      setFailure(describeError(error));
    }
  }, [input, paper.id, running]);

  const stop = useCallback(async () => {
    const id = activeIdRef.current;
    if (id === null) return;
    try {
      await core.abort(id);
    } catch (error) {
      setFailure(describeError(error));
    }
    setRunning(false);
    setDraft("");
    setActivities([]);
  }, []);

  const active = sessions?.find((session) => session.id === activeId) ?? null;
  const messages = active?.messages ?? [];
  const showDraft = running || draft.length > 0;

  return (
    <Screen title="对话" subtitle={paper.title} onBack={onBack}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        {sessions === null && loading ? (
          <StatusView kind="loading" title="正在加载会话…" />
        ) : sessions === null && loadError !== null ? (
          <StatusView kind="error" title="加载会话失败" detail={loadError} actionLabel="重试" onAction={loadSessions} />
        ) : (
          <>
            <View style={styles.sessionBar}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.sessionChips}>
                <Pressable style={[styles.chip, styles.newChip]} onPress={createSession}>
                  <Text style={styles.newChipText}>＋ 新会话</Text>
                </Pressable>
                {sessions?.map((session) => (
                  <Pressable
                    key={session.id}
                    style={[styles.chip, session.id === activeId && styles.chipActive]}
                    onPress={() => {
                      setActiveId(session.id);
                      setDraft("");
                      setActivities([]);
                      setFailure(null);
                    }}
                  >
                    <Text
                      style={[styles.chipText, session.id === activeId && styles.chipTextActive]}
                      numberOfLines={1}
                    >
                      {session.title}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
              {active !== null ? (
                <Pressable onPress={removeActiveSession} hitSlop={8}>
                  <Text style={styles.deleteLink}>删除</Text>
                </Pressable>
              ) : null}
            </View>

            {failure !== null ? <Text style={styles.failure}>{failure}</Text> : null}

            <ScrollView
              ref={scrollRef}
              style={styles.messages}
              contentContainerStyle={styles.messagesContent}
              onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
              keyboardShouldPersistTaps="handled"
            >
              {messages.length === 0 && !showDraft ? (
                <Text style={styles.placeholder}>向这篇论文提问，回答会引用原文页码。</Text>
              ) : null}
              {messages.map((message) => (
                <MessageBubble key={message.id} message={message} />
              ))}
              {showDraft ? (
                <View style={styles.assistantRow}>
                  <View style={[styles.bubble, styles.assistantBubble]}>
                    {activities.map((activity) => (
                      <View key={activity.id} style={styles.activity}>
                        <Text style={[styles.activityDot, activity.status === "error" && styles.activityDotError]}>
                          {activity.status === "running" ? "●" : activity.status === "error" ? "×" : "✓"}
                        </Text>
                        <Text style={styles.activityText} numberOfLines={2}>
                          {activity.toolName}
                          {activity.detail.length > 0 ? ` · ${activity.detail}` : ""}
                        </Text>
                      </View>
                    ))}
                    {draft.length > 0 ? (
                      <Text style={styles.messageText}>{stripMathDelimiters(draft)}</Text>
                    ) : (
                      <View style={styles.thinking}>
                        <ActivityIndicator size="small" color="#6b7280" />
                        <Text style={styles.thinkingText}>正在思考…</Text>
                      </View>
                    )}
                  </View>
                </View>
              ) : null}
            </ScrollView>

            <View style={styles.composer}>
              <TextInput
                style={styles.input}
                value={input}
                onChangeText={setInput}
                placeholder="输入问题…"
                placeholderTextColor="#9ca3af"
                multiline
              />
              {running ? (
                <Pressable style={[styles.sendButton, styles.stopButton]} onPress={stop}>
                  <Text style={styles.sendText}>停止</Text>
                </Pressable>
              ) : (
                <Pressable
                  style={[styles.sendButton, input.trim().length === 0 && styles.sendButtonDisabled]}
                  onPress={send}
                  disabled={input.trim().length === 0}
                >
                  <Text style={styles.sendText}>发送</Text>
                </Pressable>
              )}
            </View>
          </>
        )}
      </KeyboardAvoidingView>
    </Screen>
  );
}

function MessageBubble({ message }: { readonly message: ChatMessage }) {
  const isUser = message.role === "user";
  return (
    <View style={isUser ? styles.userRow : styles.assistantRow}>
      <View style={[styles.bubble, isUser ? styles.userBubble : styles.assistantBubble]}>
        <Text style={[styles.messageText, isUser && styles.userText]}>{stripMathDelimiters(message.text)}</Text>
        {message.citations.length > 0 ? (
          <View style={styles.citations}>
            {message.citations.map((citation) => (
              <View key={citation.pageNumber} style={styles.citation}>
                <Text style={styles.citationPage}>第 {citation.pageNumber} 页</Text>
                {citation.quote.length > 0 ? (
                  <Text style={styles.citationQuote} numberOfLines={2}>
                    {citation.quote}
                  </Text>
                ) : null}
              </View>
            ))}
          </View>
        ) : null}
      </View>
    </View>
  );
}

function settleActivity(activities: Activity[], toolName: string, isError: boolean): Activity[] {
  let index = -1;
  for (let i = activities.length - 1; i >= 0; i -= 1) {
    const candidate = activities[i];
    if (candidate !== undefined && candidate.toolName === toolName && candidate.status === "running") {
      index = i;
      break;
    }
  }
  if (index < 0) return activities;
  const current = activities[index];
  if (current === undefined) return activities;
  const next = activities.slice();
  next[index] = { ...current, status: isError ? "error" : "done" };
  return next;
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  sessionBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#e5e7eb",
    gap: 8,
  },
  sessionChips: {
    gap: 8,
    paddingRight: 8,
    alignItems: "center",
  },
  chip: {
    maxWidth: 180,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: "#f3f4f6",
  },
  chipActive: {
    backgroundColor: "#2563eb",
  },
  chipText: {
    fontSize: 13,
    color: "#374151",
  },
  chipTextActive: {
    color: "#ffffff",
    fontWeight: "600",
  },
  newChip: {
    backgroundColor: "#eef2ff",
  },
  newChipText: {
    fontSize: 13,
    color: "#2563eb",
    fontWeight: "600",
  },
  deleteLink: {
    fontSize: 13,
    color: "#b91c1c",
  },
  failure: {
    color: "#b91c1c",
    fontSize: 13,
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: "#fef2f2",
  },
  messages: {
    flex: 1,
  },
  messagesContent: {
    padding: 16,
    gap: 12,
  },
  placeholder: {
    textAlign: "center",
    color: "#9ca3af",
    fontSize: 14,
    marginTop: 32,
  },
  userRow: {
    alignItems: "flex-end",
  },
  assistantRow: {
    alignItems: "flex-start",
  },
  bubble: {
    maxWidth: "88%",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
  },
  userBubble: {
    backgroundColor: "#2563eb",
  },
  assistantBubble: {
    backgroundColor: "#f3f4f6",
  },
  messageText: {
    fontSize: 15,
    lineHeight: 22,
    color: "#1f2937",
  },
  userText: {
    color: "#ffffff",
  },
  citations: {
    gap: 6,
  },
  citation: {
    borderLeftWidth: 2,
    borderLeftColor: "#2563eb",
    paddingLeft: 8,
    gap: 2,
  },
  citationPage: {
    fontSize: 12,
    fontWeight: "700",
    color: "#2563eb",
  },
  citationQuote: {
    fontSize: 12,
    lineHeight: 17,
    color: "#6b7280",
  },
  activity: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 6,
  },
  activityDot: {
    fontSize: 11,
    lineHeight: 18,
    color: "#2563eb",
  },
  activityDotError: {
    color: "#b91c1c",
  },
  activityText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 18,
    color: "#4b5563",
  },
  thinking: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  thinkingText: {
    fontSize: 13,
    color: "#6b7280",
  },
  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
    padding: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#e5e7eb",
    backgroundColor: "#ffffff",
  },
  input: {
    flex: 1,
    maxHeight: 120,
    minHeight: 40,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#d1d5db",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: "#111827",
  },
  sendButton: {
    paddingHorizontal: 18,
    paddingVertical: 11,
    borderRadius: 10,
    backgroundColor: "#2563eb",
  },
  sendButtonDisabled: {
    backgroundColor: "#93c5fd",
  },
  stopButton: {
    backgroundColor: "#b91c1c",
  },
  sendText: {
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "600",
  },
});
