import React from "react";

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  padding?: string;
}

export function Card({
  padding = "1.25rem",
  style,
  children,
  ...rest
}: CardProps): React.ReactElement {
  return (
    <div
      {...rest}
      style={{
        background: "var(--ma-color-surface, #fff)",
        border: "1px solid var(--ma-color-border, #e2e8f0)",
        borderRadius: "var(--ma-radius-xl, 14px)",
        padding,
        boxShadow:
          "var(--ma-shadow-sm, 0 1px 2px rgba(15,23,42,.04))",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  style,
  children,
  ...rest
}: React.HTMLAttributes<HTMLDivElement>): React.ReactElement {
  return (
    <div
      {...rest}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "var(--ma-space-3, 0.75rem)",
        marginBottom: "var(--ma-space-3, 0.75rem)",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export function CardTitle({
  style,
  children,
  ...rest
}: React.HTMLAttributes<HTMLHeadingElement>): React.ReactElement {
  return (
    <h3
      {...rest}
      style={{
        margin: 0,
        fontSize: "var(--ma-font-size-lg, 1rem)",
        fontWeight: 700,
        fontFamily: "var(--ma-font-body, inherit)",
        ...style,
      }}
    >
      {children}
    </h3>
  );
}

export function CardContent({
  style,
  children,
  ...rest
}: React.HTMLAttributes<HTMLDivElement>): React.ReactElement {
  return (
    <div {...rest} style={{ ...style }}>
      {children}
    </div>
  );
}
