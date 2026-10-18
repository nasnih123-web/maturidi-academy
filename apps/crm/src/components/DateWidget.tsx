import React from "react";
import { useI18n } from "../lib/i18n";

/**
 * Date widget, adapted from turbo's PrayerWidget.
 *
 * Shows the Hijri (Umm al-Qura, computed client-side via Intl — no backend)
 * and the Gregorian date in the UI locale. Prayer times are intentionally NOT
 * shown: turbo hardcoded a placeholder time, which would be fake data; real
 * prayer times need a location-aware service and are deferred (see report).
 */

function hijriString(): string {
  try {
    return new Intl.DateTimeFormat("ar-SA-u-ca-islamic-umalqura", {
      dateStyle: "short",
    }).format(new Date());
  } catch {
    return "";
  }
}

function gregorianString(locale: string): string {
  try {
    const tag = locale === "fa" ? "fa-IR" : locale === "ar" ? "ar" : "en";
    return new Intl.DateTimeFormat(tag, { dateStyle: "short" }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

export function DateWidget(): React.ReactElement {
  const { t, locale } = useI18n();
  return (
    <div className="hijri-widget" aria-label={t("widget.calendarLabel")}>
      <span className="pw-hijri">
        {hijriString()} {t("widget.hijriSuffix")}
      </span>
      <span className="pw-sep" aria-hidden="true">
        ◆
      </span>
      <span className="pw-greg">{gregorianString(locale)}</span>
    </div>
  );
}
