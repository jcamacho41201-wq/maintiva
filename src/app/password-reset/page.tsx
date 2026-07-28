"use client";

import { FormEvent, useMemo, useState } from "react";
import Link from "next/link";
import { KeyRound } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export default function PasswordResetPage() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    setMessage("");
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (updateError) setError(updateError.message);
    else setMessage("Password updated. You can sign in with the new password.");
  }

  return (
    <div className="mx-auto flex min-h-[calc(100vh-6rem)] max-w-md flex-col justify-center py-10">
      <form onSubmit={submit} className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
        <div className="mb-5">
          <div className="mb-4 grid h-10 w-10 place-items-center rounded-lg bg-violet-950 text-white">
            <KeyRound className="h-5 w-5" />
          </div>
          <h1 className="text-xl font-semibold">Set a new password</h1>
          <p className="mt-1 text-sm text-zinc-500">Supabase verifies the reset link before this form can update your account.</p>
        </div>
        {error && <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        {message && <p className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{message}</p>}
        <label className="block text-sm font-medium">
          New password
          <input type="password" minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} className="mt-2 h-10 w-full rounded-lg border border-zinc-200 px-3 outline-none focus:border-violet-500" />
        </label>
        <button disabled={loading} className="mt-5 w-full rounded-lg bg-violet-950 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60">
          {loading ? "Saving..." : "Update password"}
        </button>
        <Link href="/login" className="mt-4 block text-sm font-semibold text-violet-950">
          Back to sign in
        </Link>
      </form>
    </div>
  );
}
