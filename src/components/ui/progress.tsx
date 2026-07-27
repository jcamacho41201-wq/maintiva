import { cn } from "@/lib/utils";

function progressColor(value: number) {
  if (value <= 10) return "bg-red-500";
  if (value <= 25) return "bg-orange-500";
  if (value <= 45) return "bg-yellow-500";
  return "bg-emerald-500";
}

export function Progress({
  value,
  className,
}: {
  value: number;
  className?: string;
}) {
  return (
    <div className={cn("h-2 w-full rounded-full bg-zinc-100", className)}>
      <div
        className={cn("h-full rounded-full", progressColor(value))}
        style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
      />
    </div>
  );
}
