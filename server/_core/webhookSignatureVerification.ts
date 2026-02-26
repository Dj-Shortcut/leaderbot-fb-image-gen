import { createHmac } from "node:crypto";
import type { Request, Response, NextFunction } from "express";

/**
 * Verifies Meta webhook signature using HMAC-SHA256
 * Protects against forged webhook events
 */
export function verifyMetaWebhookSignature(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const signature = req.headers["x-hub-signature-256"];
  const appSecret = process.env.FB_APP_SECRET;

  // Fail closed if app secret is not configured
  if (!appSecret) {
    console.error("[Webhook] FB_APP_SECRET not configured - rejecting all webhooks");
    res.status(500).json({ error: "Server misconfiguration" });
    return;
  }

  // Require signature header
  if (!signature || typeof signature !== "string") {
    console.warn("[Webhook] Missing or invalid X-Hub-Signature-256 header");
    res.status(403).json({ error: "Signature verification failed" });
    return;
  }

  // Get raw body (must be captured before JSON parsing)
  const rawBody = (req as any).rawBody as Buffer | string;
  if (!rawBody) {
    console.error("[Webhook] Raw body not available for signature verification");
    res.status(500).json({ error: "Server misconfiguration" });
    return;
  }

  // Recreate signature
  const bodyString = typeof rawBody === "string" ? rawBody : rawBody.toString("utf-8");
  const expectedSignature = createHmac("sha256", appSecret)
    .update(bodyString)
    .digest("hex");

  const expectedHeader = `sha256=${expectedSignature}`;

  // Compare signatures using constant-time comparison to prevent timing attacks
  const isValid = constantTimeCompare(signature, expectedHeader);

  if (!isValid) {
    console.warn("[Webhook] Signature verification failed", {
      received: signature.substring(0, 20) + "...",
      expected: expectedHeader.substring(0, 20) + "...",
    });
    res.status(403).json({ error: "Signature verification failed" });
    return;
  }

  // Signature is valid, proceed
  next();
}

/**
 * Constant-time string comparison to prevent timing attacks
 */
function constantTimeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }

  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }

  return result === 0;
}

/**
 * Middleware to capture raw body for signature verification
 * Must be applied BEFORE express.json()
 */
export function captureRawBody(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  let rawBody = "";

  req.on("data", (chunk: Buffer) => {
    rawBody += chunk.toString("utf-8");
  });

  req.on("end", () => {
    (req as any).rawBody = rawBody;
    next();
  });
}
