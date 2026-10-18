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
  gap: "0.5rem",
  borderRadius: "10px",
  border: "1px solid transparent",
  cursor: "pointer",
  fontWeight: 600,
  fontFamily: "inherit",
  transition: "opacity .15s ease",
};

const variants: Record<ButtonVariant, React.CSSProperties> = {
  primary: { background: "#1d4ed8", color: "#fff", borderColor: "#1d4ed8" },
  secondary: { background: "#f1f5f9", color: "#0f172a", borderColor: "#cbd5e1" },
  danger: { background: "#dc2626", color: "#fff", borderColor: "#dc2626" },
  ghost: { background: "transparent", color: "#1d4ed8", borderColor: "transparent" },
};

const sizes: Record<ButtonSize, React.CSSProperties> = {
  sm: { padding: "0.35rem 0.75rem", fontSize: "0.8rem" },
  md: { padding: "0.55rem 1.1rem", fontSize: "0.9rem" },
  lg: { padding: "0.75rem 1.5rem", fontSize: "1rem" },
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
