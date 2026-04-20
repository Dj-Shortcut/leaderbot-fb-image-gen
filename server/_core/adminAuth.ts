import { timingSafeEqual } from "node:crypto";
import { safeLog } from "./messengerApi";

export function verifyAdminToken(input: {
  providedToken: string | undefined;
  eventName: string;
}): boolean {
  const adminToken = process.env.ADMIN_TOKEN;
  if (!adminToken || !input.providedToken) {
    safeLog(input.eventName, { reason: "missing_token" });
    return false;
  }

  const expected = Buffer.from(adminToken);
  const provided = Buffer.from(input.providedToken);
  if (expected.length !== provided.length) {
    safeLog(input.eventName, { reason: "length_mismatch" });
    return false;
  }

  const ok = timingSafeEqual(expected, provided);
  if (!ok) {
    safeLog(input.eventName, { reason: "token_mismatch" });
  }
  return ok;
}
