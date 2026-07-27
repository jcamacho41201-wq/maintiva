import { ComingSoon } from "@/components/coming-soon";

export default function AnalyticsPage() {
  return (
    <ComingSoon
      title="Analytics"
      description="Pilot reporting focuses on the operating loop that turns due maintenance into scheduled revenue."
      items={[
        "Predicted maintenance revenue",
        "Customer retention",
        "Booking conversion",
        "Automation attribution",
        "Bay utilization",
        "Technician capacity",
      ]}
    />
  );
}
