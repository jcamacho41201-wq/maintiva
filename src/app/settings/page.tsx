import { ComingSoon } from "@/components/coming-soon";

export default function SettingsPage() {
  return (
    <ComingSoon
      title="Settings"
      description="Workspace, communication, import, and permission controls for a repair shop pilot."
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
