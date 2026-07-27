import { ComingSoon } from "@/components/coming-soon";

export default function LoginPage() {
  return (
    <ComingSoon
      title="Demo Access"
      description="The working demo runs as the seeded shop owner. Production auth is scaffolded for the later database-backed flow."
      items={[
        "Credentials auth scaffold",
        "Owner and staff roles",
        "Shop-scoped sessions",
        "Protected route middleware",
      ]}
    />
  );
}
