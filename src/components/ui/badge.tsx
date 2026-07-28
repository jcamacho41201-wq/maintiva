import { cn } from "@/lib/utils";

const variants = {
  neutral: "border-zinc-200 bg-zinc-50 text-zinc-700",
  green: "border-emerald-200 bg-emerald-50 text-emerald-700",
  yellow: "border-yellow-200 bg-yellow-50 text-yellow-800",
  orange: "border-orange-200 bg-orange-50 text-orange-700",
  red: "border-red-200 bg-red-50 text-red-700",
  purple: "border-violet-200 bg-violet-50 text-violet-700",
};

export function Badge({
  children,
  variant = "neutral",
  className,
}: {
  children: React.ReactNode;
  variant?: keyof typeof variants;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium",
        variants[variant],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function statusVariant(status: string) {
  if (
    status === "HEALTHY" ||
    status === "CONFIRMED" ||
    status === "ACTIVE" ||
    status === "SCHEDULED" ||
    status === "BOOKED" ||
    status === "COMPLETED" ||
    status === "INTERESTED"
  ) {
    return "green" as const;
  }
  if (
    status === "DUE_SOON" ||
    status === "TENTATIVE" ||
    status === "REQUESTED" ||
    status === "WATCHLIST" ||
    status === "DRAFTED" ||
    status === "MANUALLY_SENT" ||
    status === "RESPONDED" ||
    status === "WANTS_CALLBACK" ||
    status === "PARTIAL"
  ) {
    return "yellow" as const;
  }
  if (
    status === "OVERDUE" ||
    status === "NO_RESPONSE" ||
    status === "DUE" ||
    status === "DECLINED" ||
    status === "FAILED" ||
    status === "DO_NOT_CONTACT"
  ) {
    return "red" as const;
  }
  if (status === "PAUSED" || status === "SNOOZED" || status === "NOT_NOW") {
    return "orange" as const;
  }
  return "neutral" as const;
}
