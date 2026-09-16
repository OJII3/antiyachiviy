import type { ReactNode } from "react";

import { formatTimestamp } from "@web/lib/format";

export type View = "logs" | "sessions";

interface AppShellProps {
  view: View;
  lastUpdated: Date | null;
  onViewChange: (view: View) => void;
  onRefresh: () => void;
  children: ReactNode;
}

export function AppShell({ view, lastUpdated, onViewChange, onRefresh, children }: AppShellProps) {
  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true">
            ◒
          </span>
          <h1 className="eyebrow">YACHIGRAVITY OBSERVATORY</h1>
        </div>
        <div className="header-status">
          <span className="status-dot" aria-hidden="true" />
          <span>ローカル接続</span>
          {lastUpdated && (
            <time dateTime={lastUpdated.toISOString()}>
              更新 {formatTimestamp(lastUpdated.toISOString())}
            </time>
          )}
          <button aria-label="再読み込み" className="icon-button" onClick={onRefresh} type="button">
            ↻
          </button>
        </div>
      </header>

      <nav className="view-tabs" aria-label="表示切り替え">
        <button
          className={view === "logs" ? "is-active" : ""}
          onClick={() => onViewChange("logs")}
          type="button"
        >
          <span aria-hidden="true">▤</span> ログ
        </button>
        <button
          className={view === "sessions" ? "is-active" : ""}
          onClick={() => onViewChange("sessions")}
          type="button"
        >
          <span aria-hidden="true">◌</span> Antigravityセッション
        </button>
      </nav>

      <main>{children}</main>

      <footer className="app-footer">Yachigravity / read-only viewer</footer>
    </div>
  );
}
