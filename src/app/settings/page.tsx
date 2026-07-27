import { ComingSoon } from "@/components/coming-soon";

export default function SettingsPage() {
  return (
    <ComingSoon
      title="Settings"
      description="Production configuration remains documented and modeled, while the demo keeps settings non-destructive."
      items={[
        "Role permissions",
        "Communication rules",
        "Provider credentials",
        "Import mappings",
        "Shop hours",
        "Calendar integration",
      ]}
    />
  );
}
