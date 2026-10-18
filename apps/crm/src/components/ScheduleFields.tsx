import React from "react";
import { isoToLocalInput, localInputToIso } from "../lib/contentApi";
import { useI18n } from "../lib/i18n";

/**
 * Timezone-aware scheduling (§9.5 Schedule): the operator picks local
 * date/time; values are converted to UTC ISO before leaving the UI
 * (contract §1 — wire times are always UTC ISO). The hint shows the
 * exact UTC instant that will be stored, so there is no ambiguity.
 */
export default function ScheduleFields({
  startsAt,
  endsAt,
  onChange,
}: {
  startsAt: string | null;
  endsAt: string | null;
  onChange: (patch: { starts_at: string | null; ends_at: string | null }) => void;
}): React.ReactElement {
  const { t, formatDate } = useI18n();
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: "0.75rem",
      }}
    >
      <div className="field" style={{ marginBottom: 0 }}>
        <label htmlFor="sched-start">{t("studio.startsAt")}</label>
        <input
          id="sched-start"
          type="datetime-local"
          className="input"
          value={isoToLocalInput(startsAt)}
          onChange={(e) =>
            onChange({ starts_at: localInputToIso(e.target.value), ends_at: endsAt })
          }
        />
      </div>
      <div className="field" style={{ marginBottom: 0 }}>
        <label htmlFor="sched-end">{t("studio.endsAt")}</label>
        <input
          id="sched-end"
          type="datetime-local"
          className="input"
          value={isoToLocalInput(endsAt)}
          onChange={(e) =>
            onChange({ starts_at: startsAt, ends_at: localInputToIso(e.target.value) })
          }
        />
      </div>
      <div className="hint" style={{ gridColumn: "1 / -1", margin: 0 }}>
        {t("studio.tzHint").replace("{tz}", tz)}
        {startsAt
          ? ` · ${t("studio.storedAs")}: ${formatDate(startsAt)}`
          : ""}
      </div>
    </div>
  );
}
