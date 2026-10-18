import React from "react";

export type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** When true the button is disabled and marked busy; no text spinner is rendered. */
  loading?: boolean;
}

const base: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: "var(--ma-space-2, 0.5rem)",
  borderRadius: "var(--ma-radius-lg, 10px)",
  border: "1px solid transparent",
  cursor: "pointer",
  fontWeight: 600,
  fontFamily: "var(--ma-font-body, inherit)",
  transition: "opacity .15s ease",
};

const variants: Record<ButtonVariant, React.CSSProperties> = {
  primary: {
    background: "var(--ma-color-primary-700, #1d4ed8)",
    color: "var(--ma-color-surface, #fff)",
    borderColor: "var(--ma-color-primary-700, #1d4ed8)",
  },
  secondary: {
    background: "var(--ma-color-neutral-100, #f1f5f9)",
    color: "var(--ma-color-text, #0f172a)",
    borderColor: "var(--ma-color-border, #cbd5e1)",
  },
  danger: {
    background: "var(--ma-color-danger-solid, #dc2626)",
    color: "var(--ma-color-surface, #fff)",
    borderColor: "var(--ma-color-danger-solid, #dc2626)",
  },
  ghost: {
    background: "transparent",
    color: "var(--ma-color-primary-700, #1d4ed8)",
    borderColor: "transparent",
  },
};

const sizes: Record<ButtonSize, React.CSSProperties> = {
  sm: {
    padding: "var(--ma-space-1, 0.35rem) var(--ma-space-3, 0.75rem)",
    fontSize: "var(--ma-font-size-sm, 0.8rem)",
  },
  md: {
    padding: "var(--ma-space-2, 0.55rem) var(--ma-space-4, 1.1rem)",
    fontSize: "var(--ma-font-size-base, 0.9rem)",
  },
  lg: {
    padding: "var(--ma-space-3, 0.75rem) var(--ma-space-6, 1.5rem)",
    fontSize: "var(--ma-font-size-lg, 1rem)",
  },
};

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  disabled,
  style,
  children,
  ...rest
}: ButtonProps): React.ReactElement {
  const isDisabled = disabled === true || loading;
  return (
    <button
      {...rest}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      style={{
        ...base,
        ...variants[variant],
        ...sizes[size],
        ...(isDisabled ? { opacity: 0.6, cursor: "not-allowed" } : null),
        ...style,
      }}
    >
      {children}
    </button>
  );
}
