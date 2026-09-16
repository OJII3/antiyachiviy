import { useEffect, useState, type SubmitEvent } from "react";

import type { LogsQuery, PinoLog } from "@web/api";
import { EmptyState, ErrorNotice, LoadingState } from "@web/components/feedback";
import { LEVEL_OPTIONS } from "@web/lib/format";
import { LogTable } from "@web/features/logs/log-table";

interface LogsViewProps {
  logs: PinoLog[];
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  nextCursor: string | null;
  filters: LogsQuery;
  onFilter: (query: LogsQuery) => void;
  onRetry: () => void;
  onLoadMore: () => void;
}

interface LogFilterDraft {
  level: string;
  q: string;
  channelId: string;
  event: string;
}

function draftFromFilters(filters: LogsQuery): LogFilterDraft {
  return {
    level: filters.level ?? "",
    q: filters.q ?? "",
    channelId: filters.channelId ?? "",
    event: filters.event ?? "",
  };
}

export function LogsView({
  logs,
  loading,
  loadingMore,
  error,
  nextCursor,
  filters,
  onFilter,
  onRetry,
  onLoadMore,
}: LogsViewProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [draft, setDraft] = useState(() => draftFromFilters(filters));

  useEffect(() => {
    setDraft(draftFromFilters(filters));
  }, [filters]);

  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    onFilter({
      limit: 100,
      ...(draft.level ? { level: draft.level } : {}),
      ...(draft.q ? { q: draft.q } : {}),
      ...(draft.channelId ? { channelId: draft.channelId } : {}),
      ...(draft.event ? { event: draft.event } : {}),
    });
  };

  const clear = () => {
    setDraft({ level: "", q: "", channelId: "", event: "" });
    onFilter({ limit: 100 });
  };

  return (
    <section className="view-section" aria-labelledby="logs-heading">
      <div className="section-heading">
        <div>
          <p className="eyebrow">PINO / JSONL</p>
          <h2 id="logs-heading">アプリケーションログ</h2>
        </div>
        <span className="result-count">{logs.length.toLocaleString("ja-JP")} 件</span>
      </div>

      <form className="filter-bar" onSubmit={submit}>
        <label>
          <span>レベル</span>
          <select
            aria-label="ログレベル"
            onChange={(event) => setDraft((current) => ({ ...current, level: event.target.value }))}
            value={draft.level}
          >
            <option value="">すべて</option>
            {LEVEL_OPTIONS.map((level) => (
              <option key={level} value={level}>
                {level}
              </option>
            ))}
          </select>
        </label>
        <label className="filter-grow">
          <span>検索</span>
          <input
            aria-label="ログを検索"
            onChange={(event) => setDraft((current) => ({ ...current, q: event.target.value }))}
            placeholder="概要、イベント名…"
            type="search"
            value={draft.q}
          />
        </label>
        <label>
          <span>チャンネル</span>
          <input
            aria-label="チャンネルID"
            onChange={(event) =>
              setDraft((current) => ({ ...current, channelId: event.target.value }))
            }
            placeholder="channel ID"
            value={draft.channelId}
          />
        </label>
        <label>
          <span>イベント</span>
          <input
            aria-label="イベント名"
            onChange={(event) => setDraft((current) => ({ ...current, event: event.target.value }))}
            placeholder="event"
            value={draft.event}
          />
        </label>
        <div className="filter-actions">
          <button className="button button-primary" type="submit">
            絞り込む
          </button>
          <button className="button button-quiet" onClick={clear} type="button">
            クリア
          </button>
        </div>
      </form>

      {error && <ErrorNotice message={error} onRetry={onRetry} />}
      {loading && logs.length === 0 ? (
        <LoadingState />
      ) : logs.length === 0 ? (
        <EmptyState>条件に一致するログはありません</EmptyState>
      ) : (
        <div className="data-panel">
          <LogTable
            expandedId={expandedId}
            logs={logs}
            onToggle={(id) => setExpandedId((current) => (current === id ? null : id))}
          />
          <div className="pagination-row">
            {nextCursor ? (
              <button className="button" disabled={loadingMore} onClick={onLoadMore} type="button">
                {loadingMore ? "読み込み中…" : "次のログを読み込む"}
              </button>
            ) : (
              <span className="muted">これより古いログはありません</span>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
