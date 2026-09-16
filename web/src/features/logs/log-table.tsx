import { Fragment } from "react";

import type { PinoLog } from "@web/api";
import { formatTimestamp, levelClass, levelLabel } from "@web/lib/format";
import { LogDetails } from "@web/features/logs/log-details";

interface LogTableProps {
  logs: PinoLog[];
  expandedId: string | null;
  onToggle: (id: string) => void;
}

export function LogTable({ logs, expandedId, onToggle }: LogTableProps) {
  return (
    <>
      <div className="desktop-table-wrap">
        <table className="log-table">
          <thead>
            <tr>
              <th scope="col">時刻</th>
              <th scope="col">レベル</th>
              <th scope="col">イベント</th>
              <th scope="col">概要</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((log) => {
              const isExpanded = expandedId === log.id;
              return (
                <Fragment key={log.id}>
                  <tr
                    aria-expanded={isExpanded}
                    className={`log-row${isExpanded ? " is-expanded" : ""}`}
                    onClick={() => onToggle(log.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        onToggle(log.id);
                      }
                    }}
                    role="button"
                    tabIndex={0}
                  >
                    <td>
                      <time dateTime={log.timestamp}>{formatTimestamp(log.timestamp)}</time>
                    </td>
                    <td>
                      <span className={`level-badge ${levelClass(log.level)}`}>
                        {levelLabel(log.level)}
                      </span>
                    </td>
                    <td>
                      <code className="event-name">{log.kind}</code>
                    </td>
                    <td>
                      <span className="summary-cell">{log.summary}</span>
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr className="log-detail-row">
                      <td colSpan={4}>
                        <LogDetails log={log} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mobile-log-list">
        {logs.map((log) => {
          const isExpanded = expandedId === log.id;
          return (
            <article className={`log-card${isExpanded ? " is-expanded" : ""}`} key={log.id}>
              <button className="log-card-trigger" onClick={() => onToggle(log.id)} type="button">
                <span className="log-card-meta">
                  <time dateTime={log.timestamp}>{formatTimestamp(log.timestamp)}</time>
                  <span className={`level-badge ${levelClass(log.level)}`}>
                    {levelLabel(log.level)}
                  </span>
                </span>
                <code className="event-name">{log.kind}</code>
                <span className="log-card-summary">{log.summary}</span>
              </button>
              {isExpanded && <LogDetails log={log} />}
            </article>
          );
        })}
      </div>
    </>
  );
}
