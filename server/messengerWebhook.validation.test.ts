import { createHmac } from "node:crypto";
import http from "node:http";
import express from "express";
import { afterEach, describe, expect, it } from "vitest";

import {
  captureMetaWebhookRawBody,
  verifyMetaWebhookSignature,
} from "./_core/webhookSignatureVerification";
import { registerMetaWebhookRoutes } from "./_core/meta/webhookRoutes";

function buildSignature(body: string, secret: string): string {
  const digest = createHmac("sha256", secret).update(body).digest("hex");
  return `sha256=${digest}`;
}

async function postWebhook(
  body: string,
  signature: string,
  path = "/webhook/facebook",
): Promise<{ status: number; payload: string }> {
  const app = express();

  app.use(
    express.json({
      verify: captureMetaWebhookRawBody,
    }),
  );
  app.use("/webhook", verifyMetaWebhookSignature);
  registerMetaWebhookRoutes(app);

  const server = http.createServer(app);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();

  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Failed to bind test server");
  }

  const result = await new Promise<{ status: number; payload: string }>((resolve, reject) => {
    const request = http.request(
      {
        hostname: "127.0.0.1",
        port: address.port,
        path,
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(body),
          "x-hub-signature-256": signature,
        },
      },
      response => {
        let payload = "";
        response.on("data", chunk => {
          payload += chunk;
        });
        response.on("end", () => {
          resolve({ status: response.statusCode ?? 0, payload });
        });
      },
    );

    request.on("error", reject);
    request.write(body);
    request.end();
  });

  await new Promise<void>((resolve, reject) => {
    server.close(error => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });

  return result;
}

describe("messenger webhook payload validation", () => {
  afterEach(() => {
    delete process.env.FB_APP_SECRET;
  });

  it("rejects schema-invalid signed webhook payloads", async () => {
    const secret = "test-secret";
    process.env.FB_APP_SECRET = secret;

    const body = JSON.stringify({ object: "page", entry: [{ messaging: "invalid" }] });
    const response = await postWebhook(body, buildSignature(body, secret));

    expect(response.status).toBe(400);
    expect(response.payload).toContain("Invalid webhook payload");
  });

  it("accepts signed payloads on the generic /webhook callback path", async () => {
    const secret = "test-secret";
    process.env.FB_APP_SECRET = secret;

    const body = JSON.stringify({
      object: "whatsapp_business_account",
      entry: [],
    });
    const response = await postWebhook(body, buildSignature(body, secret), "/webhook");

    expect(response.status).toBe(200);
  });

  it("rate limits repeated signed webhook requests from the same IP", async () => {
    const secret = "test-secret";
    process.env.FB_APP_SECRET = secret;

    const body = JSON.stringify({ object: "page", entry: [] });
    let response: { status: number; payload: string } | undefined;

    for (let attempt = 0; attempt < 61; attempt += 1) {
      response = await postWebhook(body, buildSignature(body, secret));
    }

    expect(response?.status).toBe(429);
  }, 15000);
});
