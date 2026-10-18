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
        background: "#fff",
        border: "1px solid #e2e8f0",
        borderRadius: "14px",
        padding,
        boxShadow: "0 1px 2px rgba(15,23,42,.04)",
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
        gap: "0.75rem",
        marginBottom: "0.75rem",
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
    <h3 {...rest} style={{ margin: 0, fontSize: "1rem", fontWeight: 700, ...style }}>
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
