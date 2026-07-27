import { ComingSoon } from "@/components/coming-soon";

export default function AnalyticsPage() {
  return (
    <ComingSoon
      title="Analytics"
      description="Advanced forecasting is deferred so the working demo can focus on the customer-to-appointment workflow."
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
