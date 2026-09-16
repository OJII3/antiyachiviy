import type { AntigravitySessionEvent, SessionSummary } from "@web/api";
import { EmptyState } from "@web/components/feedback";
import { JsonValue } from "@web/components/json-value";
import { formatTimestamp } from "@web/lib/format";

interface SessionTimelineProps {
  events: AntigravitySessionEvent[];
  session: SessionSummary;
}

export function SessionTimeline({ events, session }: SessionTimelineProps) {
  return (
    <div className="timeline-panel">
      <div className="session-detail-heading">
        <div>
          <p className="eyebrow">{session.channelKey}</p>
          <h3>{session.firstMessage || "Antigravity session"}</h3>
        </div>
        <dl className="session-stats">
          <div>
            <dt>メッセージ</dt>
            <dd>{session.messageCount}</dd>
          </div>
          <div>
            <dt>開始</dt>
            <dd>{formatTimestamp(session.created)}</dd>
          </div>
        </dl>
      </div>
      {events.length === 0 ? (
        <EmptyState>イベントがありません</EmptyState>
      ) : (
        <ol className="timeline">
          {events.map((event) => (
            <li className="timeline-item" key={event.id}>
              <span className={`timeline-dot timeline-dot-${event.role ?? event.kind}`} />
              <article className="timeline-event">
                <header>
                  <div className="timeline-kind">
                    <span className="event-pill">{event.kind}</span>
                    {event.role && <span className="role-label">{event.role}</span>}
                  </div>
                  <time dateTime={event.timestamp}>{formatTimestamp(event.timestamp)}</time>
                </header>
                {event.content !== undefined && (
                  <JsonValue className="timeline-content" value={event.content} />
                )}
                {event.parentId && <p className="timeline-parent">parent: {event.parentId}</p>}
              </article>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
