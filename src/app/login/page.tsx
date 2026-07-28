"use client";

import { FormEvent, Suspense, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Gauge, LogIn, UserPlus } from "lucide-react";
import {
  createSupabaseBrowserClient,
  isBrowserSupabaseConfigured,
} from "@/lib/supabase/client";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [mode, setMode] = useState<"signin" | "signup" | "reset">("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const next = searchParams.get("next") || "/";
  const configured = isBrowserSupabaseConfigured();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    setMessage("");

    if (!configured) {
      setLoading(false);
      setError("Supabase Auth is not configured for this environment.");
      return;
    }

    if (mode === "reset") {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/password-reset`,
      });
      setLoading(false);
      if (resetError) setError(resetError.message);
      else setMessage("Password reset instructions sent.");
      return;
    }

    if (mode === "signup") {
      const { error: signupError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { name },
          emailRedirectTo: `${window.location.origin}/onboarding`,
        },
      });
      setLoading(false);
      if (signupError) {
        setError(signupError.message);
        return;
      }
      setMessage("Account created. Check your email if confirmation is enabled, then continue onboarding.");
      return;
    }

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    setLoading(false);
    if (signInError) {
      setError("Invalid email or password.");
      return;
    }
    router.push(next);
    router.refresh();
  }

  return (
    <div className="mx-auto flex min-h-[calc(100vh-6rem)] max-w-md flex-col justify-center py-10">
      <div className="mb-6 flex items-center gap-3">
        <div className="grid h-11 w-11 place-items-center rounded-lg bg-violet-950 text-white">
          <Gauge className="h-6 w-6" aria-hidden="true" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Maintiva</h1>
          <p className="text-sm font-medium text-violet-700">
            Recover Maintenance Revenue.
          </p>
        </div>
      </div>

      <form onSubmit={submit} className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
        <div className="mb-5">
          <h2 className="text-lg font-semibold">
            {mode === "signin" ? "Sign in" : mode === "signup" ? "Create account" : "Reset password"}
          </h2>
          <p className="mt-1 text-sm text-zinc-500">
            {mode === "signin"
              ? "Use your shop account to continue."
              : mode === "signup"
                ? "Start a pilot workspace for your repair shop."
                : "We will send reset instructions through Supabase Auth."}
          </p>
        </div>

        {!configured && (
          <p className="mb-4 rounded-lg border border-yellow-200 bg-yellow-50 px-3 py-2 text-sm text-yellow-800">
            Supabase environment variables are missing. The app can still run the local demo, but real accounts require Supabase.
          </p>
        )}
        {error && <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        {message && <p className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{message}</p>}

        <div className="space-y-4">
          {mode === "signup" && (
            <label className="block text-sm font-medium">
              Name
              <input value={name} onChange={(event) => setName(event.target.value)} className="mt-2 h-10 w-full rounded-lg border border-zinc-200 px-3 outline-none focus:border-violet-500" />
            </label>
          )}
          <label className="block text-sm font-medium">
            Email
            <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} className="mt-2 h-10 w-full rounded-lg border border-zinc-200 px-3 outline-none focus:border-violet-500" />
          </label>
          {mode !== "reset" && (
            <label className="block text-sm font-medium">
              Password
              <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} className="mt-2 h-10 w-full rounded-lg border border-zinc-200 px-3 outline-none focus:border-violet-500" />
            </label>
          )}
        </div>

        <button
          disabled={loading}
          className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-violet-950 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
        >
          {mode === "signup" ? <UserPlus className="h-4 w-4" /> : <LogIn className="h-4 w-4" />}
          {loading
            ? "Working..."
            : mode === "signin"
              ? "Sign in"
              : mode === "signup"
                ? "Create account"
                : "Send reset email"}
        </button>

        <div className="mt-4 flex flex-wrap justify-between gap-2 text-sm">
          <button type="button" onClick={() => setMode(mode === "signin" ? "signup" : "signin")} className="font-semibold text-violet-950">
            {mode === "signin" ? "Create account" : "Back to sign in"}
          </button>
          <button type="button" onClick={() => setMode("reset")} className="font-semibold text-violet-950">
            Forgot password?
          </button>
        </div>
      </form>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
