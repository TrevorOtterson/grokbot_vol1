export function StatusBadge({ status }: { status: string }) {
  const tone =
    status === "received"
      ? "success"
      : status === "partial"
        ? "warning"
        : status === "cancelled"
          ? "critical"
          : "info";
  const label =
    status === "received"
      ? "Received"
      : status === "partial"
        ? "Partial"
        : status === "cancelled"
          ? "Cancelled"
          : "Open";

  return <s-badge tone={tone}>{label}</s-badge>;
}

export function formatDate(value: Date | string | null | undefined) {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}
