import { Card, CardContent, CardHeader } from "@/components/ui/card";

export default function LoginPage() {
  return (
    <div className="mx-auto flex min-h-[calc(100vh-8rem)] max-w-md items-center">
      <Card className="w-full">
        <CardHeader>
          <h1 className="text-2xl font-semibold tracking-tight">Sign in to Maintiva</h1>
          <p className="mt-2 text-sm text-zinc-500">
            Demo authentication is wired for Credentials provider architecture.
          </p>
        </CardHeader>
        <CardContent>
          <form className="space-y-4">
            <label className="block text-sm font-medium">
              Email
              <input
                defaultValue="owner@maintiva.dev"
                className="mt-2 h-11 w-full rounded-lg border border-zinc-200 px-3 outline-none focus:border-violet-500"
              />
            </label>
            <label className="block text-sm font-medium">
              Password
              <input
                defaultValue="demo-password"
                type="password"
                className="mt-2 h-11 w-full rounded-lg border border-zinc-200 px-3 outline-none focus:border-violet-500"
              />
            </label>
            <button className="h-11 w-full rounded-lg bg-violet-950 text-sm font-semibold text-white">
              Continue
            </button>
          </form>
          <p className="mt-4 text-xs text-zinc-500">
            Demo account: owner@maintiva.dev / demo-password
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
