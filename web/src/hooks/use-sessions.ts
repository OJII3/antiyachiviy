import { useCallback, useEffect, useState } from "react";

import {
  getSession,
  listSessions,
  type AntigravitySessionEvent,
  type SessionSummary,
} from "@web/api";

interface UseSessionsOptions {
  active: boolean;
  onUpdated: () => void;
}

export function useSessions({ active, onUpdated }: UseSessionsOptions) {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [selectedSession, setSelectedSession] = useState<SessionSummary | null>(null);
  const [events, setEvents] = useState<AntigravitySessionEvent[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailReloadKey, setDetailReloadKey] = useState(0);

  const load = useCallback(async () => {
    setSessionsLoading(true);
    setSessionsError(null);

    try {
      const response = await listSessions();
      setSessions(response.items);
      setSelectedSessionId((current) => current ?? response.items[0]?.id ?? null);
      onUpdated();
    } catch (requestError) {
      setSessionsError(
        requestError instanceof Error ? requestError.message : "セッションの取得に失敗しました",
      );
    } finally {
      setSessionsLoading(false);
    }
  }, [onUpdated]);

  useEffect(() => {
    if (!active) return;

    void load();
    const timer = window.setInterval(load, 10000);
    return () => window.clearInterval(timer);
  }, [active, load]);

  useEffect(() => {
    if (!active || !selectedSessionId) return;

    let current = true;
    setDetailLoading(true);
    setDetailError(null);

    void getSession(selectedSessionId)
      .then((response) => {
        if (!current) return;
        setSelectedSession(response.session);
        setEvents(response.items);
      })
      .catch((requestError: unknown) => {
        if (!current) return;
        setDetailError(
          requestError instanceof Error ? requestError.message : "セッションの取得に失敗しました",
        );
      })
      .finally(() => {
        if (current) setDetailLoading(false);
      });

    return () => {
      current = false;
    };
  }, [active, detailReloadKey, selectedSessionId]);

  const retryDetail = useCallback(() => {
    setDetailReloadKey((key) => key + 1);
  }, []);

  const selectedFromList =
    sessions.find((session) => session.id === selectedSessionId) ?? selectedSession;

  return {
    sessions,
    sessionsLoading,
    sessionsError,
    selectedSessionId,
    selectedSession: selectedFromList ?? null,
    events,
    detailLoading,
    detailError,
    selectSession: setSelectedSessionId,
    reload: load,
    retryDetail,
  };
}
