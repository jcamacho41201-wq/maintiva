import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

export function ComingSoon({
  title,
  description,
  items,
}: {
  title: string;
  description: string;
  items: string[];
}) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-2 text-sm text-zinc-600">{description}</p>
      </div>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">Coming soon</h2>
            <p className="mt-1 text-sm text-zinc-500">
              This area is prepared for controlled rollout after the first shop pilot.
            </p>
          </div>
          <Badge variant="purple">Pilot scope</Badge>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          {items.map((item) => (
            <div key={item} className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 text-sm font-medium text-zinc-700">
              {item}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
