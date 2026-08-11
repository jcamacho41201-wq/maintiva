import { createHash, randomBytes } from "node:crypto";

const tokenBytes = 32;
const tokenAlphabet = "base64url";

export const appointmentRequestPathPrefix = "/request/";
export const appointmentRequestTokenPattern = /^[A-Za-z0-9_-]{43}$/;

export function createAppointmentRequestToken() {
  return randomBytes(tokenBytes).toString(tokenAlphabet);
}

export function normalizeAppointmentRequestToken(token: string | string[] | null | undefined) {
  const value = Array.isArray(token) ? token[0] : token;
  if (!value) return "";
  try {
    return decodeURIComponent(value).trim();
  } catch {
    return value.trim();
  }
}

export function isAppointmentRequestTokenFormat(token: string) {
  return appointmentRequestTokenPattern.test(token);
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
