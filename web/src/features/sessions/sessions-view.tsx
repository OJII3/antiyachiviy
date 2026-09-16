import type { AntigravitySessionEvent, SessionSummary } from "@web/api";
import { EmptyState, ErrorNotice, LoadingState } from "@web/components/feedback";
import { formatTimestamp } from "@web/lib/format";
import { SessionTimeline } from "@web/features/sessions/session-timeline";

interface SessionsViewProps {
  sessions: SessionSummary[];
  selectedSession: SessionSummary | null;
  events: AntigravitySessionEvent[];
  loading: boolean;
  loadingDetail: boolean;
  error: string | null;
  detailError: string | null;
  onSelect: (id: string) => void;
  onRetry: () => void;
  onRetryDetail: () => void;
}

export function SessionsView({
  sessions,
  selectedSession,
  events,
  loading,
  loadingDetail,
  error,
  detailError,
  onSelect,
  onRetry,
  onRetryDetail,
}: SessionsViewProps) {
  return (
    <section className="view-section" aria-labelledby="sessions-heading">
      <div className="section-heading">
        <div>
          <p className="eyebrow">ANTIGRAVITY / SESSION JSON</p>
          <h2 id="sessions-heading">Antigravityセッション</h2>
        </div>
        <span className="result-count">{sessions.length.toLocaleString("ja-JP")} 件</span>
      </div>

      {error && <ErrorNotice message={error} onRetry={onRetry} />}
      {loading && sessions.length === 0 ? (
        <LoadingState />
      ) : sessions.length === 0 ? (
        <EmptyState>セッションがまだありません</EmptyState>
      ) : (
        <div className="sessions-layout">
          <div className="session-list" aria-label="セッション一覧">
            {sessions.map((session) => (
              <button
                className={`session-list-item${selectedSession?.id === session.id ? " is-selected" : ""}`}
                key={session.id}
                onClick={() => onSelect(session.id)}
                type="button"
              >
                <span className="session-list-topline">
                  <span className="session-channel">{session.channelKey}</span>
                  <span className="session-count">{session.messageCount} msg</span>
                </span>
                <strong>{session.firstMessage || "（メッセージなし）"}</strong>
                <time dateTime={session.modified}>更新 {formatTimestamp(session.modified)}</time>
              </button>
            ))}
          </div>

          <div className="session-detail">
            {detailError && <ErrorNotice message={detailError} onRetry={onRetryDetail} />}
            {loadingDetail ? (
              <LoadingState label="セッションを読み込み中…" />
            ) : selectedSession ? (
              <SessionTimeline events={events} session={selectedSession} />
            ) : (
              <EmptyState>セッションを選択してください</EmptyState>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
