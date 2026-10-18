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
  neutral: {
    background: "var(--ma-color-neutral-100, #f1f5f9)",
    color: "var(--ma-color-text-muted, #475569)",
  },
  info: {
    background: "var(--ma-color-info-bg, #dbeafe)",
    color: "var(--ma-color-info-text, #1d4ed8)",
  },
  success: {
    background: "var(--ma-color-success-bg, #dcfce7)",
    color: "var(--ma-color-success-text, #15803d)",
  },
  warning: {
    background: "var(--ma-color-warning-bg, #fef3c7)",
    color: "var(--ma-color-warning-text, #b45309)",
  },
  danger: {
    background: "var(--ma-color-danger-bg, #fee2e2)",
    color: "var(--ma-color-danger-text, #b91c1c)",
  },
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
        padding: "var(--ma-space-1, 0.15rem) var(--ma-space-3, 0.6rem)",
        borderRadius: "var(--ma-radius-full, 999px)",
        fontSize: "var(--ma-font-size-xs, 0.75rem)",
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
