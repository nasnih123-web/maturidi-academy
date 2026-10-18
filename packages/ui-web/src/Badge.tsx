import React from "react";

export type BadgeTone = "neutral" | "info" | "success" | "warning" | "danger";

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
}

/**
 * Maps the §9 shared content-workflow states to tones.
 * draft → in_review → approved → published (↘ rejected / archived)
 */
export function statusTone(status: string): BadgeTone {
  switch (status) {
    case "published":
      return "success";
    case "approved":
      return "info";
    case "in_review":
      return "warning";
    case "rejected":
      return "danger";
    default:
      return "neutral"; // draft, archived, unknown
  }
}

const tones: Record<BadgeTone, React.CSSProperties> = {
  neutral: { background: "#f1f5f9", color: "#475569" },
  info: { background: "#dbeafe", color: "#1d4ed8" },
  success: { background: "#dcfce7", color: "#15803d" },
  warning: { background: "#fef3c7", color: "#b45309" },
  danger: { background: "#fee2e2", color: "#b91c1c" },
};

export function Badge({
  tone = "neutral",
  style,
  children,
  ...rest
}: BadgeProps): React.ReactElement {
  return (
    <span
      {...rest}
      style={{
        display: "inline-block",
        padding: "0.15rem 0.6rem",
        borderRadius: "999px",
        fontSize: "0.75rem",
        fontWeight: 600,
        whiteSpace: "nowrap",
        ...tones[tone],
        ...style,
      }}
    >
      {children}
    </span>
  );
}
