/**
 * apps/mobile — src/hooks/useFatwa.ts
 */
import { useCallback, useState } from "react";
import { ApiError } from "../lib/api";
import { askFatwa as svcAsk } from "../services/fatwa";
import type { FatwaAnswer, Locale } from "../types";

export function useFatwa(locale: Locale): {
  answer: FatwaAnswer | null;
  asking: boolean;
  error: string | null;
  ask: (question: string) => Promise<void>;
  clear: () => void;
} {
  const [answer, setAnswer] = useState<FatwaAnswer | null>(null);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ask = useCallback(
    async (question: string) => {
      setAsking(true);
      setError(null);
      setAnswer(null);
      try {
        const res = await svcAsk(question, locale);
        setAnswer(res);
      } catch (e) {
        setError(e instanceof ApiError ? e.code : "unknown");
      } finally {
        setAsking(false);
      }
    },
    [locale],
  );

  const clear = useCallback(() => {
    setAnswer(null);
    setError(null);
  }, []);

  return { answer, asking, error, ask, clear };
}
