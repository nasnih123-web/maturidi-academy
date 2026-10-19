/**
 * apps/mobile — src/hooks/useSettings.ts
 *
 * Settings UI state: locale + push opt-in. Persistence and server mirroring
 * live in services/settings.ts.
 */
import { useCallback, useEffect, useState } from "react";
import {
  getLocale,
  getPushEnabled,
  setLocale as svcSetLocale,
  setPushEnabled as svcSetPush,
} from "../services/settings";
import type { Locale } from "../types";

export function useSettings(): {
  locale: Locale;
  pushEnabled: boolean;
  saving: boolean;
  changeLocale: (l: Locale) => Promise<void>;
  changePush: (enabled: boolean) => Promise<void>;
} {
  const [locale, setLocaleState] = useState<Locale>("fa");
  const [pushEnabled, setPushState] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      setLocaleState(await getLocale());
      setPushState(await getPushEnabled());
    })();
  }, []);

  const changeLocale = useCallback(async (l: Locale) => {
    setSaving(true);
    try {
      await svcSetLocale(l);
      setLocaleState(l);
    } finally {
      setSaving(false);
    }
  }, []);

  const changePush = useCallback(async (enabled: boolean) => {
    setSaving(true);
    try {
      await svcSetPush(enabled);
      setPushState(enabled);
    } finally {
      setSaving(false);
    }
  }, []);

  return { locale, pushEnabled, saving, changeLocale, changePush };
}
