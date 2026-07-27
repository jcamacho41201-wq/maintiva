export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-4 py-10">
      <h1 className="text-3xl font-semibold tracking-tight">Privacy</h1>
      <p className="text-sm leading-6 text-zinc-600">
        Maintiva stores shop, customer, vehicle, service, outreach, and appointment data only for the authenticated shop workspace. Pilot deployments must use Supabase Auth, Supabase PostgreSQL, HTTPS, and least-privilege environment variables.
      </p>
      <p className="text-sm leading-6 text-zinc-600">
        Customer outreach is manual in the pilot MVP. Maintiva generates drafts and records manual status; it does not send SMS, email, or calls until a provider integration is explicitly configured in a later release.
      </p>
    </div>
  );
}
