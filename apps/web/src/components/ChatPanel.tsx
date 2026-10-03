import { useEffect, useRef, useState } from "react";
import type { Artifact, ArtifactKind, ChatMessage, ChatSession, PaperSummary, RenderCapabilities } from "@paperwitha/domain";
import type { SessionView, ToolState } from "../chatState";
import { ArtifactButton, ArtifactCard, type ArtifactActions } from "./ArtifactCard";
import { MessageText } from "./MessageText";

export interface ChatPanelProps {
  readonly paper: PaperSummary | null;
  readonly sessions: readonly ChatSession[];
  readonly activeSessionId: string | null;
  readonly view: SessionView;
  readonly draft: string;
  readonly focusSignal: number;
  readonly sessionsLoading: boolean;
  readonly sessionError: string | null;
  readonly renderers: RenderCapabilities | null;
  readonly artifactError: string | null;
  readonly artifactFileUrl: (artifactId: string, file: string) => string;
  readonly onDraftChange: (value: string) => void;
  readonly onSend: () => void;
  readonly onStop: () => void;
  readonly onCreateSession: () => void;
  readonly onCreateArtifact: (kind: ArtifactKind, messageId: string | null) => void;
  readonly onDeleteArtifact: (artifactId: string) => void;
  readonly onSelectSession: (sessionId: string) => void;
  readonly onDeleteSession: (sessionId: string) => void;
  readonly onCitationClick: (pageNumber: number) => void;
  readonly onClose: () => void;
}

const TOOL_STATE_LABEL: Record<ToolState, string> = { running: "进行中", ok: "完成", error: "失败" };

export function ChatPanel(props: ChatPanelProps) {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const { view } = props;

  useEffect(() => {
    if (props.focusSignal === 0) return;
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }, [props.focusSignal]);

  // 有新内容时贴住底部（用户往上翻时会在下一轮被拉回，符合助手流式输出的预期）。
  useEffect(() => {
    const list = messagesRef.current;
    if (!list) return;
    list.scrollTop = list.scrollHeight;
  }, [view.messages.length, view.draft, view.running]);

  const canSend = props.activeSessionId !== null && props.draft.trim().length > 0;
  const artifactBusy = view.artifacts.some((artifact) => artifact.status === "running");
  const artifactActions: ArtifactActions = {
    renderers: props.renderers,
    busy: artifactBusy,
    fileUrl: props.artifactFileUrl,
    onCreate: props.onCreateArtifact,
    onDelete: props.onDeleteArtifact,
  };
  const sessionArtifacts = view.artifacts.filter((artifact) => artifact.messageId === null);

  return (
    <aside className="panel chat" aria-label="对话">
      <header className="panel-head chat-head">
        <div className="chat-head-row">
          <div className="chat-head-text">
            <h2 className="panel-title">对话</h2>
            <p className="panel-subtitle">{props.paper ? props.paper.title : "未选择论文"}</p>
          </div>
          <button className="btn btn-ghost btn-sm chat-close" onClick={props.onClose} title="收起对话">
            收起
          </button>
        </div>

        <div className="session-bar">
          <span className="session-bar-label">本论文的会话</span>
          <button className="btn btn-ghost btn-sm" onClick={props.onCreateSession} disabled={props.paper === null}>
            新建会话
          </button>
          {props.sessionsLoading && <span className="status">加载中…</span>}
        </div>
        {props.sessionError && <p className="status status-error">会话加载失败：{props.sessionError}</p>}
        {props.activeSessionId !== null && (
          <div className="artifact-session-bar">
            <span className="artifact-actions-label">整篇会话</span>
            <ArtifactButton kind="slides" label="幻灯片" messageId={null} actions={artifactActions} />
            <ArtifactButton kind="animation" label="视频" messageId={null} actions={artifactActions} />
          </div>
        )}
        {props.artifactError && <p className="status status-error">图件操作失败：{props.artifactError}</p>}
        <ul className="session-chips">
          {props.sessions.map((session) => (
            <li key={session.id} className={session.id === props.activeSessionId ? "session-chip active" : "session-chip"}>
              <button className="session-chip-name" onClick={() => props.onSelectSession(session.id)} title={session.title}>
                {session.title}
              </button>
              {pendingDelete === session.id ? (
                <>
                  <button
                    className="session-chip-confirm"
                    onClick={() => {
                      setPendingDelete(null);
                      props.onDeleteSession(session.id);
                    }}
                  >
                    确认删除
                  </button>
                  <button className="session-chip-cancel" onClick={() => setPendingDelete(null)}>
                    取消
                  </button>
                </>
              ) : (
                <button className="session-chip-delete" title="删除会话" onClick={() => setPendingDelete(session.id)}>
                  ×
                </button>
              )}
            </li>
          ))}
        </ul>
      </header>

      <div className="chat-messages" id="chat-messages" ref={messagesRef}>
        {sessionArtifacts.map((artifact) => (
          <ArtifactCard key={artifact.id} artifact={artifact} actions={artifactActions} />
        ))}
        {props.activeSessionId === null && <p className="empty-hint">选择论文后开始提问。</p>}
        {props.activeSessionId !== null && view.messages.length === 0 && !view.running && (
          <p className="empty-hint">问点关于这篇论文的问题，比如「这篇文章的方法是什么？」</p>
        )}
        {view.messages.map((message) => (
          <MessageBubble
            key={message.id}
            message={message}
            artifacts={view.artifacts.filter((artifact) => artifact.messageId === message.id)}
            actions={artifactActions}
            onCitationClick={props.onCitationClick}
          />
        ))}

        {view.activities.length > 0 && (
          <details className="activity-block">
            <summary>工具调用 · {view.activities.length}</summary>
            <ul>
              {view.activities.map((activity) => (
                <li key={activity.id}>
                  <span className={`activity-state activity-${activity.state}`}>{TOOL_STATE_LABEL[activity.state]}</span>
                  <code className="activity-tool">{activity.toolName}</code>
                  {activity.detail.length > 0 && <span className="activity-detail">{activity.detail}</span>}
                </li>
              ))}
            </ul>
          </details>
        )}

        {view.running && (
          <div className="message message-assistant streaming">
            <span className="message-role">助手</span>
            <div className="message-body">
              {view.draft.length > 0 ? <MessageText text={view.draft} /> : <p className="muted">正在阅读论文…</p>}
              <span className="caret" />
            </div>
          </div>
        )}

        {view.error && <p className="chat-error">出错了：{view.error}</p>}
      </div>

      <div className="chat-composer">
        <textarea
          id="chat-input"
          ref={inputRef}
          value={props.draft}
          placeholder={props.paper ? "针对这篇论文提问…" : "先选择一篇论文"}
          disabled={props.paper === null}
          rows={3}
          onChange={(event) => props.onDraftChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
            event.preventDefault();
            if (canSend && !view.running) props.onSend();
          }}
        />
        <div className="composer-actions">
          <span className="composer-hint">回车发送 · Shift+回车换行</span>
          {view.running ? (
            <button className="btn btn-danger" onClick={props.onStop}>
              停止
            </button>
          ) : (
            <button className="btn btn-primary" onClick={props.onSend} disabled={!canSend}>
              发送
            </button>
          )}
        </div>
      </div>
    </aside>
  );
}

function MessageBubble({
  message,
  artifacts,
  actions,
  onCitationClick,
}: {
  readonly message: ChatMessage;
  readonly artifacts: readonly Artifact[];
  readonly actions: ArtifactActions;
  readonly onCitationClick: (pageNumber: number) => void;
}) {
  return (
    <div className={`message message-${message.role}`}>
      <span className="message-role">{message.role === "user" ? "我" : "助手"}</span>
      <div className="message-body">
        {message.text.trim().length > 0 ? <MessageText text={message.text} /> : <p className="muted">（没有返回内容）</p>}
      </div>
      {message.citations.length > 0 && (
        <div className="message-citations">
          {message.citations.map((citation) => (
            <button
              key={citation.pageNumber}
              className="citation-chip"
              title={citation.quote}
              onClick={() => onCitationClick(citation.pageNumber)}
            >
              p.{citation.pageNumber}
            </button>
          ))}
        </div>
      )}
      {message.role === "assistant" && (
        <div className="artifact-actions">
          <ArtifactButton kind="diagram" label="图解" messageId={message.id} actions={actions} />
          <ArtifactButton kind="animation" label="动画" messageId={message.id} actions={actions} />
        </div>
      )}
      {artifacts.map((artifact) => (
        <ArtifactCard key={artifact.id} artifact={artifact} actions={actions} />
      ))}
    </div>
  );
}
