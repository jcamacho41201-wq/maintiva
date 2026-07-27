"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { Building2, CheckCircle2 } from "lucide-react";

export default function OnboardingPage() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    const formData = new FormData(event.currentTarget);
    const response = await fetch("/api/pilot/onboarding", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        shopName: formData.get("shopName"),
        phone: formData.get("phone"),
        email: formData.get("email"),
        address: formData.get("address"),
        timezone: formData.get("timezone"),
        dailyBayHours: formData.get("dailyBayHours"),
      }),
    });
    setLoading(false);

    if (!response.ok) {
      setError("Unable to create your shop workspace. Check the details and try again.");
      return;
    }

    router.push("/");
    router.refresh();
  }

  return (
    <div className="mx-auto max-w-3xl py-10">
      <div className="mb-6">
        <div className="mb-4 grid h-11 w-11 place-items-center rounded-lg bg-violet-950 text-white">
          <Building2 className="h-6 w-6" />
        </div>
        <h1 className="text-3xl font-semibold tracking-tight">Set up your shop</h1>
        <p className="mt-2 text-sm text-zinc-600">
          Add the basics Maintiva needs before saving real customers, vehicles, services, outreach, and appointments.
        </p>
      </div>

      <form onSubmit={submit} className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
        {error && <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm font-medium">
            Shop name
            <input name="shopName" required className="mt-2 h-10 w-full rounded-lg border border-zinc-200 px-3 outline-none focus:border-violet-500" />
          </label>
          <label className="text-sm font-medium">
            Shop phone
            <input name="phone" className="mt-2 h-10 w-full rounded-lg border border-zinc-200 px-3 outline-none focus:border-violet-500" />
          </label>
          <label className="text-sm font-medium">
            Shop email
            <input name="email" type="email" className="mt-2 h-10 w-full rounded-lg border border-zinc-200 px-3 outline-none focus:border-violet-500" />
          </label>
          <label className="text-sm font-medium">
            Timezone
            <input name="timezone" defaultValue="America/New_York" className="mt-2 h-10 w-full rounded-lg border border-zinc-200 px-3 outline-none focus:border-violet-500" />
          </label>
          <label className="text-sm font-medium">
            Daily bay hours
            <input name="dailyBayHours" type="number" min="1" max="200" defaultValue="64" className="mt-2 h-10 w-full rounded-lg border border-zinc-200 px-3 outline-none focus:border-violet-500" />
          </label>
          <label className="text-sm font-medium sm:col-span-2">
            Address
            <input name="address" className="mt-2 h-10 w-full rounded-lg border border-zinc-200 px-3 outline-none focus:border-violet-500" />
          </label>
        </div>
        <button
          disabled={loading}
          className="mt-5 inline-flex items-center gap-2 rounded-lg bg-violet-950 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
        >
          <CheckCircle2 className="h-4 w-4" />
          {loading ? "Creating..." : "Create shop workspace"}
        </button>
      </form>
    </div>
  );
}
