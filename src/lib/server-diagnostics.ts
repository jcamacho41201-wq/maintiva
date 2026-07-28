import type { AuthenticatedShopContext } from "@/lib/auth";

type SafeError = {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
};

function valueFrom(error: unknown, key: "code" | "message" | "detail" | "details" | "hint") {
  if (!error || typeof error !== "object") return undefined;
  const value = (error as Record<string, unknown>)[key];
  return typeof value === "string" ? value : undefined;
}

export function safeDatabaseError(error: unknown): SafeError {
  const cause = error && typeof error === "object" ? (error as { cause?: unknown }).cause : undefined;
  return {
    code: valueFrom(error, "code") ?? valueFrom(cause, "code"),
    message: valueFrom(error, "message") ?? valueFrom(cause, "message"),
    details: valueFrom(error, "details") ?? valueFrom(error, "detail") ?? valueFrom(cause, "details") ?? valueFrom(cause, "detail"),
    hint: valueFrom(error, "hint") ?? valueFrom(cause, "hint"),
  };
}

export function safeMutationPayloadShape(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const action = typeof (value as { action?: unknown }).action === "string"
    ? (value as { action: string }).action
    : undefined;
  const payload = (value as { payload?: unknown }).payload;

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { action };
  }

  return {
    action,
    payloadFields: Object.keys(payload).sort(),
    payloadPresence: Object.fromEntries(
      Object.entries(payload).map(([key, child]) => [
        key,
        child !== null && child !== undefined && String(child).length > 0,
      ]),
    ),
  };
}

export function logPilotMutationFailure({
  error,
  context,
  payload,
}: {
  error: unknown;
  context?: AuthenticatedShopContext;
  payload?: unknown;
}) {
  console.error("Maintiva pilot mutation failed", {
    auth: context
      ? {
          userId: context.userId,
          shopId: context.shopId,
          membershipActive: true,
          role: context.role,
        }
      : undefined,
    mutation: safeMutationPayloadShape(payload),
    database: safeDatabaseError(error),
  });
}
