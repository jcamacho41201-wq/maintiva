import { createHash, randomBytes } from "node:crypto";

const tokenBytes = 32;
const tokenAlphabet = "base64url";

export const appointmentRequestPathPrefix = "/request/";

export function createAppointmentRequestToken() {
  return randomBytes(tokenBytes).toString(tokenAlphabet);
}

export function hashAppointmentRequestToken(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function appointmentRequestUrl(appUrl: string, token: string) {
  const baseUrl = appUrl.endsWith("/") ? appUrl.slice(0, -1) : appUrl;
  return `${baseUrl}${appointmentRequestPathPrefix}${encodeURIComponent(token)}`;
}

export function appointmentRequestIdempotencyKey(tokenHash: string, startsAt: string, clientKey: string) {
  return hashAppointmentRequestToken(`${tokenHash}:${startsAt}:${clientKey}`);
}
