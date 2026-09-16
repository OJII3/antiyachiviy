import { useCallback, useEffect, useState } from "react";

import { listLogs, type LogsQuery, type PinoLog } from "@web/api";

interface UseLogsOptions {
  active: boolean;
  onUpdated: () => void;
}

export function useLogs({ active, onUpdated }: UseLogsOptions) {
  const [logs, setLogs] = useState<PinoLog[]>([]);
  const [filters, setFilters] = useState<LogsQuery>({ limit: 100 });
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (query: LogsQuery, append = false) => {
      if (append) setLoadingMore(true);
      else setLoading(true);
      setError(null);

      try {
        const response = await listLogs(query);
        setLogs((current) => (append ? [...current, ...response.items] : response.items));
        setNextCursor(response.nextCursor);
        onUpdated();
      } catch (requestError) {
        setError(requestError instanceof Error ? requestError.message : "ログの取得に失敗しました");
      } finally {
        if (append) setLoadingMore(false);
        else setLoading(false);
      }
    },
    [onUpdated],
  );

  const reload = useCallback(() => {
    void load(filters);
  }, [filters, load]);

  useEffect(() => {
    if (!active) return;

    reload();
    const timer = window.setInterval(reload, 5000);
    return () => window.clearInterval(timer);
  }, [active, reload]);

  const loadMore = useCallback(() => {
    if (nextCursor) void load({ ...filters, cursor: nextCursor }, true);
  }, [filters, load, nextCursor]);

  return {
    logs,
    filters,
    setFilters,
    nextCursor,
    loading,
    loadingMore,
    error,
    reload,
    loadMore,
  };
}
