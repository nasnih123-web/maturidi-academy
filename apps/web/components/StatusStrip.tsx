/**
 * StatusStrip — solar / gregorian / hijri dates plus an optional API-driven
 * status line. Dates are formatted with Intl (presentation only); the status
 * line comes from the API section data. Nothing is hardcoded: prayer times
 * are rendered only when the API provides them (currently it doesn't).
 */
export interface StatusStripLabels {
  aria: string;
  solar: string;
  gregorian: string;
  hijri: string;
}

export function StatusStrip({
  locale,
  labels,
  statusLine,
}: {
  locale: string;
  labels: StatusStripLabels;
  statusLine: string | null;
}) {
  const now = new Date();
  const gregorianIntl =
    locale === "fa" ? "fa-IR-u-ca-gregory" : locale === "ar" ? "ar-u-ca-gregory" : "en-US-u-ca-gregory";
  const solar = new Intl.DateTimeFormat("fa-IR", { dateStyle: "full" }).format(now);
  const gregorian = new Intl.DateTimeFormat(gregorianIntl, { dateStyle: "full" }).format(now);
  const hijri = new Intl.DateTimeFormat("ar-SA-u-ca-islamic-umalqura", { dateStyle: "long" }).format(now);

  const cells: { label: string; value: string }[] = [
    { label: labels.solar, value: solar },
    { label: labels.gregorian, value: gregorian },
    { label: labels.hijri, value: hijri },
  ];

  return (
    <section className="status-strip" aria-label={labels.aria}>
      <div className="status-inner">
        {cells.map((c, i) => (
          <span key={c.label} style={{ display: "contents" }}>
            {i > 0 ? (
              <span className="status-sep" aria-hidden>
                ◆
              </span>
            ) : null}
            <div className="status-cell">
              <span className="status-label">{c.label}</span>
              <span className="status-value">{c.value}</span>
            </div>
          </span>
        ))}
        {statusLine ? (
          <>
            <span className="status-sep" aria-hidden>
              ◆
            </span>
            <div className="status-cell">
              <span className="status-value">{statusLine}</span>
            </div>
          </>
        ) : null}
      </div>
    </section>
  );
}
