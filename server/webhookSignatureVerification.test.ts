import { createHmac } from "node:crypto";
import http from "node:http";
import express, { type Request, type Response } from "express";
import { afterEach, describe, expect, it } from "vitest";
import {
  captureMetaWebhookRawBody,
  verifyMetaWebhookSignature,
} from "./_core/webhookSignatureVerification";

function buildSignature(body: string, secret: string): string {
  const digest = createHmac("sha256", secret).update(body).digest("hex");
  return `sha256=${digest}`;
}

async function postWebhook(body: string, signature: string): Promise<{ status: number; payload: string }> {
  const app = express();

  app.use(
    express.json({
      verify: captureMetaWebhookRawBody,
    })
  );

  app.post("/webhook/facebook", verifyMetaWebhookSignature, (req: Request, res: Response) => {
    res.status(200).json({ ok: true, object: (req.body as { object?: string }).object });
  });

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
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
        path: "/webhook/facebook",
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(body),
          "x-hub-signature-256": signature,
        },
      },
      (response) => {
        let payload = "";
        response.on("data", (chunk) => {
          payload += chunk;
        });
        response.on("end", () => {
          resolve({ status: response.statusCode ?? 0, payload });
        });
      }
    );

    request.on("error", reject);
    request.write(body);
    request.end();
  });

  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });

  return result;
}

describe("Meta webhook signature verification", () => {
  afterEach(() => {
    delete process.env.FB_APP_SECRET;
  });

  it("accepts webhook requests with a valid signature", async () => {
    const secret = "test-secret";
    process.env.FB_APP_SECRET = secret;

    const body = JSON.stringify({ object: "page", entry: [] });
    const response = await postWebhook(body, buildSignature(body, secret));

    expect(response.status).toBe(200);
    expect(response.payload).toContain('"ok":true');
  });

  it("rejects webhook requests with an invalid signature", async () => {
    process.env.FB_APP_SECRET = "test-secret";

    const body = JSON.stringify({ object: "page", entry: [] });
    const response = await postWebhook(body, "sha256=invalid");

    expect(response.status).toBe(403);
    expect(response.payload).toContain("Signature verification failed");
  });
});
