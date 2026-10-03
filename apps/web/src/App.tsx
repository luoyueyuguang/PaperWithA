import { useCallback, useEffect, useRef, useState } from "react";
import type { ArtifactKind, ChatMessage, ChatSession, PaperSummary, PaperText, RenderCapabilities } from "@paperwitha/domain";
import { ChatPanel } from "./components/ChatPanel";
import { LibraryPanel } from "./components/LibraryPanel";
import { ReaderPanel, type ReaderHandle } from "./components/ReaderPanel";
import { createSessionView, mergeArtifacts, reduceSessionView, upsertArtifact, type SessionView } from "./chatState";
import { client, errorText } from "./core";

export function App() {
  const [papers, setPapers] = useState<readonly PaperSummary[]>([]);
  const [papersLoading, setPapersLoading] = useState(true);
  const [papersError, setPapersError] = useState<string | null>(null);
  const [uploading, setUploading] = useState<{ readonly name: string } | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [health, setHealth] = useState("正在连接 core…");
  const [healthError, setHealthError] = useState<string | null>(null);
  const [renderers, setRenderers] = useState<RenderCapabilities | null>(null);

  const [paperId, setPaperId] = useState<string | null>(null);
  const [text, setText] = useState<PaperText | null>(null);
  const [textLoading, setTextLoading] = useState(false);
  const [textError, setTextError] = useState<string | null>(null);

  const [sessions, setSessions] = useState<readonly ChatSession[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [views, setViews] = useState<Record<string, SessionView>>({});
  const [artifactError, setArtifactError] = useState<string | null>(null);

  const [draft, setDraft] = useState("");
  const [focusSignal, setFocusSignal] = useState(0);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);

  const readerRef = useRef<ReaderHandle>(null);
  const paperIdRef = useRef<string | null>(null);
  const activeSessionRef = useRef<string | null>(null);

  useEffect(() => {
    paperIdRef.current = paperId;
  }, [paperId]);
  useEffect(() => {
    activeSessionRef.current = activeSessionId;
  }, [activeSessionId]);

  const loadPapers = useCallback(async (selectPaperId?: string) => {
    try {
      const list = await client.listPapers();
      setPapers(list);
      setPapersError(null);
      if (selectPaperId !== undefined) setPaperId(selectPaperId);
      return list;
    } catch (error) {
      setPapersError(errorText(error));
      return [];
    } finally {
      setPapersLoading(false);
    }
  }, []);

  const refreshHealth = useCallback(async () => {
    try {
      const status = await client.health();
      setHealth(`core 已连接 · ${status.papers} 篇论文`);
      setRenderers(status.renderers);
      setHealthError(null);
    } catch (error) {
      setHealth("core 未连接");
      setHealthError(errorText(error));
    }
  }, []);

  useEffect(() => {
    void (async () => {
      await refreshHealth();
      await loadPapers();
    })();
  }, [loadPapers, refreshHealth]);

  /** 只同步会话元数据（标题、排序），不动正在流式的消息。 */
  const syncSessionMeta = useCallback(async () => {
    const id = paperIdRef.current;
    if (!id) return;
    try {
      setSessions(await client.listSessions(id));
    } catch {
      // 标题刷新失败不影响对话本身。
    }
  }, []);

  // App 里唯一一次订阅；按 event.sessionId 分发到对应会话。
  useEffect(() => {
    const subscription = client.subscribe((event) => {
      setViews((previous) => {
        const current = previous[event.sessionId] ?? createSessionView();
        return { ...previous, [event.sessionId]: reduceSessionView(current, event) };
      });
      if (event.type === "message-completed") void syncSessionMeta();
    });
    return () => subscription.close();
  }, [syncSessionMeta]);

  // 切到某个会话时拉一次它的图件全量；之后的增量更新都走 ws 的 artifact-updated。
  useEffect(() => {
    if (activeSessionId === null) return;
    let cancelled = false;
    setArtifactError(null);
    void (async () => {
      try {
        const artifacts = await client.listArtifacts(activeSessionId);
        if (cancelled) return;
        setViews((previous) => {
          const current = previous[activeSessionId] ?? createSessionView();
          return { ...previous, [activeSessionId]: { ...current, artifacts: mergeArtifacts(current.artifacts, artifacts) } };
        });
      } catch {
        // 拉图件列表失败不影响对话；ws 事件到达时会自动补上。
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeSessionId]);

  const createArtifact = useCallback(async (kind: ArtifactKind, messageId: string | null) => {
    const sessionId = activeSessionRef.current;
    if (!sessionId) return;
    setArtifactError(null);
    try {
      const artifact = await client.createArtifact(sessionId, kind, messageId ?? undefined);
      setViews((previous) => {
        const current = previous[sessionId] ?? createSessionView();
        return { ...previous, [sessionId]: { ...current, artifacts: upsertArtifact(current.artifacts, artifact) } };
      });
    } catch (error) {
      setArtifactError(errorText(error));
    }
  }, []);

  const deleteArtifact = useCallback(async (artifactId: string) => {
    const sessionId = activeSessionRef.current;
    if (!sessionId) return;
    setArtifactError(null);
    try {
      await client.deleteArtifact(artifactId);
    } catch (error) {
      setArtifactError(errorText(error));
      return;
    }
    setViews((previous) => {
      const current = previous[sessionId];
      if (!current) return previous;
      return {
        ...previous,
        [sessionId]: { ...current, artifacts: current.artifacts.filter((artifact) => artifact.id !== artifactId) },
      };
    });
  }, []);

  const artifactFileUrl = useCallback((artifactId: string, file: string) => client.artifactFileUrl(artifactId, file), []);

  // 选中论文：并行取正文与会话；没有会话就自动建一个。
  useEffect(() => {
    if (paperId === null) {
      setText(null);
      setTextError(null);
      setSessions([]);
      setActiveSessionId(null);
      return;
    }
    let cancelled = false;
    setText(null);
    setTextError(null);
    setTextLoading(true);
    setSessions([]);
    setSessionError(null);
    setActiveSessionId(null);
    setSessionsLoading(true);
    void (async () => {
      try {
        const [loadedText, loadedSessions] = await Promise.all([client.getPaperText(paperId), client.listSessions(paperId)]);
        const list = loadedSessions.length > 0 ? loadedSessions : [await client.createSession(paperId)];
        if (cancelled) return;
        setText(loadedText);
        setSessions(list);
        setActiveSessionId(list[0]?.id ?? null);
        setViews((previous) => {
          const next = { ...previous };
          for (const session of list) next[session.id] = createSessionView(session.messages);
          return next;
        });
      } catch (error) {
        if (cancelled) return;
        setTextError(errorText(error));
        setSessionError(errorText(error));
      } finally {
        if (!cancelled) {
          setTextLoading(false);
          setSessionsLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [paperId]);

  const selectPaper = useCallback((id: string) => {
    setPaperId(id);
    setLibraryOpen(false);
  }, []);

  const upload = useCallback(
    async (file: File) => {
      setUploading({ name: file.name });
      setUploadError(null);
      const form = new FormData();
      form.append("file", file);
      try {
        const paper = await client.uploadPaper(form);
        await loadPapers(paper.id);
        await refreshHealth();
      } catch (error) {
        setUploadError(errorText(error));
      } finally {
        setUploading(null);
      }
    },
    [loadPapers, refreshHealth],
  );

  const deletePaper = useCallback(
    async (id: string) => {
      try {
        await client.deletePaper(id);
      } catch (error) {
        setPapersError(errorText(error));
        return;
      }
      const list = await loadPapers();
      await refreshHealth();
      if (paperIdRef.current === id) setPaperId(list[0]?.id ?? null);
    },
    [loadPapers, refreshHealth],
  );

  const createSession = useCallback(async () => {
    const id = paperIdRef.current;
    if (!id) return;
    try {
      const session = await client.createSession(id);
      setSessions((previous) => [session, ...previous]);
      setViews((previous) => ({ ...previous, [session.id]: createSessionView() }));
      setActiveSessionId(session.id);
      setSessionError(null);
      setChatOpen(true);
    } catch (error) {
      setSessionError(errorText(error));
    }
  }, []);

  const deleteSession = useCallback(
    async (sessionId: string) => {
      try {
        await client.deleteSession(sessionId);
      } catch (error) {
        setSessionError(errorText(error));
        return;
      }
      const remaining = sessions.filter((session) => session.id !== sessionId);
      setSessions(remaining);
      if (activeSessionRef.current !== sessionId) return;
      if (remaining.length === 0) {
        await createSession();
        return;
      }
      setActiveSessionId(remaining[0]?.id ?? null);
    },
    [sessions, createSession],
  );

  const send = useCallback(async () => {
    const sessionId = activeSessionRef.current;
    const question = draft.trim();
    if (!sessionId || question.length === 0) return;
    const localMessage: ChatMessage = {
      id: `local-${crypto.randomUUID()}`,
      role: "user",
      text: question,
      createdAt: new Date().toISOString(),
      citations: [],
    };
    setViews((previous) => {
      const current = previous[sessionId] ?? createSessionView();
      return { ...previous, [sessionId]: { ...current, messages: [...current.messages, localMessage], running: true, error: null } };
    });
    setDraft("");
    try {
      await client.prompt(sessionId, question);
    } catch (error) {
      setViews((previous) => ({
        ...previous,
        [sessionId]: { ...(previous[sessionId] ?? createSessionView()), running: false, error: errorText(error) },
      }));
    }
  }, [draft]);

  const stop = useCallback(async () => {
    const sessionId = activeSessionRef.current;
    if (!sessionId) return;
    try {
      await client.abort(sessionId);
    } catch (error) {
      setViews((previous) => ({
        ...previous,
        [sessionId]: { ...(previous[sessionId] ?? createSessionView()), error: errorText(error) },
      }));
    }
  }, []);

  const askAboutSelection = useCallback((pageNumber: number, quote: string) => {
    setDraft(`关于第 ${pageNumber} 页的这段内容：“${quote}”——`);
    setFocusSignal((value) => value + 1);
    setChatOpen(true);
  }, []);

  const jumpToPage = useCallback((pageNumber: number) => {
    readerRef.current?.scrollToPage(pageNumber);
    setChatOpen(false);
  }, []);

  const activePaper = papers.find((paper) => paper.id === paperId) ?? null;
  const view = activeSessionId !== null ? (views[activeSessionId] ?? createSessionView()) : createSessionView();

  return (
    <div className={`app-shell${libraryOpen ? " library-open" : ""}${chatOpen ? " chat-open" : ""}`}>
      <header className="topbar">
        <button className="btn btn-ghost topbar-toggle" onClick={() => setLibraryOpen((open) => !open)}>
          论文库
        </button>
        <span className="brand">PaperWithA</span>
        <span className={healthError ? "status status-error topbar-status" : "status topbar-status"} title={healthError ?? health}>
          {healthError ?? health}
        </span>
        <button className="btn btn-ghost topbar-toggle" onClick={() => setChatOpen((open) => !open)}>
          对话
        </button>
      </header>

      <LibraryPanel
        papers={papers}
        loading={papersLoading}
        error={papersError}
        selectedPaperId={paperId}
        uploading={uploading}
        uploadError={uploadError}
        onSelect={selectPaper}
        onUpload={(file) => void upload(file)}
        onDelete={(id) => void deletePaper(id)}
      />

      <ReaderPanel
        ref={readerRef}
        paper={activePaper}
        text={text}
        loading={textLoading}
        textError={textError}
        onAsk={askAboutSelection}
      />

      <ChatPanel
        paper={activePaper}
        sessions={sessions}
        activeSessionId={activeSessionId}
        view={view}
        draft={draft}
        focusSignal={focusSignal}
        sessionsLoading={sessionsLoading}
        sessionError={sessionError}
        renderers={renderers}
        artifactError={artifactError}
        artifactFileUrl={artifactFileUrl}
        onDraftChange={setDraft}
        onSend={() => void send()}
        onStop={() => void stop()}
        onCreateSession={() => void createSession()}
        onCreateArtifact={(kind, messageId) => void createArtifact(kind, messageId)}
        onDeleteArtifact={(artifactId) => void deleteArtifact(artifactId)}
        onSelectSession={setActiveSessionId}
        onDeleteSession={(id) => void deleteSession(id)}
        onCitationClick={jumpToPage}
        onClose={() => setChatOpen(false)}
      />
    </div>
  );
}
