'use client';

/**
 * useFatwaChat — multi-turn grounded fatwa chat state machine.
 *
 * Owns: turns, streaming lifecycle (start/cancel), session id, category
 * list, local session history. All network I/O goes through lib/fatwa.ts;
 * the component only renders (ADR-001).
 *
 * History is persisted in localStorage under an auth-aware key: signed-in
 * users get a key derived from their token identity, guests share an
 * anonymous key — history never leaks across identities.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  askFatwa,
  getFatwaCategories,
  streamFatwa,
  type AskResult,
  type Citation,
  type FatwaCategory,
  type FatwaStatus,
} from '../fatwa';
import { getAccessToken } from '../auth-client';

export interface ChatTurn {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  citations: Citation[];
  status: FatwaStatus | null;
  /** Backend-provided AI-assistant label (ai_label). */
  aiLabel: string | null;
  categoryId: string | null;
  createdAt: string;
}

export interface ChatSession {
  id: string;
  title: string;
  sessionId: string | null;
  createdAt: string;
  turns: ChatTurn[];
}

const HISTORY_LIMIT = 20;

function identityKey(): string {
  const token = getAccessToken();
  if (!token) return 'anon';
  try {
    const payload = JSON.parse(
      Buffer.from(token.split('.')[1] ?? '', 'base64').toString('utf8'),
    ) as { sub?: string };
    return typeof payload.sub === 'string' && payload.sub ? `u_${payload.sub}` : 'anon';
  } catch {
    return 'anon';
  }
}

function historyStorageKey(): string {
  return `ma.fatwa.history.${identityKey()}`;
}

function loadHistory(): ChatSession[] {
  try {
    const raw = window.localStorage.getItem(historyStorageKey());
    if (!raw) return [];
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return [];
    return arr.filter(
      (s): s is ChatSession =>
        !!s && typeof s === 'object' && typeof (s as ChatSession).id === 'string',
    );
  } catch {
    return [];
  }
}

function saveHistory(sessions: ChatSession[]): void {
  try {
    window.localStorage.setItem(historyStorageKey(), JSON.stringify(sessions.slice(0, HISTORY_LIMIT)));
  } catch {
    /* storage full/blocked — non-fatal */
  }
}

let turnSeq = 0;
function nextTurnId(): string {
  turnSeq += 1;
  return `t${Date.now()}_${turnSeq}`;
}

export function useFatwaChat(locale: string) {
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [streamText, setStreamText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [categories, setCategories] = useState<FatwaCategory[]>([]);
  const [categoriesLoading, setCategoriesLoading] = useState(true);
  const [categoriesFailed, setCategoriesFailed] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionKey, setSessionKey] = useState<string | null>(null);
  const [history, setHistory] = useState<ChatSession[]>([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const turnsRef = useRef<ChatTurn[]>([]);
  turnsRef.current = turns;

  // Categories are independent of auth; locale labels come from the API
  // (localized title) or the category id fallback.
  useEffect(() => {
    const ctrl = new AbortController();
    setCategoriesLoading(true);
    setCategoriesFailed(false);
    getFatwaCategories(ctrl.signal)
      .then((items) => {
        setCategories(items);
        setCategoriesLoading(false);
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setCategoriesFailed(true);
        setCategoriesLoading(false);
      });
    return () => ctrl.abort();
  }, []);

  // Load per-identity history once on mount.
  useEffect(() => {
    setHistory(loadHistory());
    setHistoryLoaded(true);
  }, []);

  const persistSession = useCallback(
    (finalTurns: ChatTurn[], sid: string | null) => {
      const firstUser = finalTurns.find((t) => t.role === 'user');
      const entry: ChatSession = {
        id: sessionKey ?? `s${Date.now()}`,
        title: firstUser ? firstUser.text.slice(0, 60) : '',
        sessionId: sid,
        createdAt: new Date().toISOString(),
        turns: finalTurns,
      };
      setHistory((prev) => {
        const without = prev.filter((s) => s.id !== entry.id);
        const next = [entry, ...without].slice(0, HISTORY_LIMIT);
        saveHistory(next);
        return next;
      });
      setSessionKey(entry.id);
    },
    [sessionKey],
  );

  const finishAssistantTurn = useCallback(
    (text: string, result: AskResult | null, categoryId: string | null) => {
      const turn: ChatTurn = {
        id: nextTurnId(),
        role: 'assistant',
        text,
        citations: result?.citations ?? [],
        status: result?.status ?? null,
        aiLabel: result?.aiLabel ?? null,
        categoryId,
        createdAt: new Date().toISOString(),
      };
      setTurns((prev) => {
        const next = [...prev, turn];
        if (result?.session_id) setSessionId(result.session_id);
        persistSession(next, result?.session_id ?? sessionId);
        return next;
      });
      setStreamText('');
    },
    [persistSession, sessionId],
  );

  const ask = useCallback(
    async (question: string, categoryId: string | null, useStream: boolean) => {
      const q = question.trim();
      if (!q || streaming) return;
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setError(null);
      const userTurn: ChatTurn = {
        id: nextTurnId(),
        role: 'user',
        text: q,
        citations: [],
        status: null,
        aiLabel: null,
        categoryId,
        createdAt: new Date().toISOString(),
      };
      setTurns((prev) => [...prev, userTurn]);
      setStreaming(true);
      setStreamText('');
      let acc = '';
      try {
        if (useStream) {
          const result = await streamFatwa(q, {
            sessionId,
            category: categoryId,
            locale,
            signal: ctrl.signal,
            onToken: (delta) => {
              acc += delta;
              setStreamText(acc);
            },
          });
          finishAssistantTurn(result.answer || acc, result, categoryId);
        } else {
          const result = await askFatwa(q, {
            sessionId,
            category: categoryId,
            locale,
            signal: ctrl.signal,
          });
          finishAssistantTurn(result.answer, result, categoryId);
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          // Cancelled by the user: keep what streamed, if anything.
          if (acc.trim()) finishAssistantTurn(acc, null, categoryId);
          else setTurns((prev) => prev); // no-op, keep state consistent
        } else {
          setError(err instanceof Error ? err.message : 'request failed');
          setTurns((prev) => prev.filter((t) => t.id !== userTurn.id));
        }
      } finally {
        setStreaming(false);
        setStreamText('');
        if (abortRef.current === ctrl) abortRef.current = null;
      }
    },
    [finishAssistantTurn, sessionId, streaming],
  );

  /** Cancel the in-flight stream — aborts the HTTP request. */
  const cancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const newChat = useCallback(() => {
    abortRef.current?.abort();
    setTurns([]);
    setSessionId(null);
    setSessionKey(null);
    setError(null);
    setStreamText('');
  }, []);

  const openSession = useCallback((session: ChatSession) => {
    abortRef.current?.abort();
    setTurns(session.turns);
    setSessionId(session.sessionId);
    setSessionKey(session.id);
    setError(null);
  }, []);

  const clearHistory = useCallback(() => {
    setHistory([]);
    try {
      window.localStorage.removeItem(historyStorageKey());
    } catch {
      /* ignore */
    }
  }, []);

  return useMemo(
    () => ({
      locale,
      turns,
      streaming,
      streamText,
      error,
      categories,
      categoriesLoading,
      categoriesFailed,
      sessionId,
      history,
      historyLoaded,
      ask,
      cancel,
      newChat,
      openSession,
      clearHistory,
    }),
    [
      locale,
      turns,
      streaming,
      streamText,
      error,
      categories,
      categoriesLoading,
      categoriesFailed,
      sessionId,
      history,
      historyLoaded,
      ask,
      cancel,
      newChat,
      openSession,
      clearHistory,
    ],
  );
}

/**
 * Read-only view of the same assistant history store the chat writes
 * (localStorage, auth-aware key — see loadHistory). Used by surfaces
 * outside the chat itself (e.g. the fatwa listing page) so a past
 * conversation is shown from one source of truth, never a second copy.
 * History lives on this device only; there is no backend fatwa-history
 * endpoint, so nothing here is fetched from the server.
 */
export function useFatwaHistory() {
  const [history, setHistory] = useState<ChatSession[]>([]);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    setHistory(loadHistory());
    setLoaded(true);
  }, []);
  return { history, loaded };
}
