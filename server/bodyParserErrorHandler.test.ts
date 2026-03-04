import http from "node:http";
import express from "express";
import { describe, expect, it } from "vitest";
import { bodyParserErrorHandler } from "./_core/bodyParserErrorHandler";

describe("body parser payload limits", () => {
  it("returns 413 with friendly message for oversized JSON payloads", async () => {
    const app = express();

    app.use(express.json({ limit: "10mb" }));
    app.post("/upload", (_req, res) => {
      res.status(200).json({ ok: true });
    });
    app.use(bodyParserErrorHandler);

    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();

    if (!address || typeof address === "string") {
      server.close();
      throw new Error("Failed to bind test server");
    }

    const oversized = `{"data":"${"x".repeat(10 * 1024 * 1024 + 1024)}"}`;

    const response = await new Promise<{ status: number; payload: string }>((resolve, reject) => {
      const request = http.request(
        {
          hostname: "127.0.0.1",
          port: address.port,
          path: "/upload",
          method: "POST",
          headers: {
            "content-type": "application/json",
            "content-length": Buffer.byteLength(oversized),
          },
        },
        (res) => {
          let payload = "";
          res.on("data", (chunk) => {
            payload += chunk;
          });
          res.on("end", () => {
            resolve({ status: res.statusCode ?? 0, payload });
          });
        }
      );

      request.on("error", reject);
      request.write(oversized);
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

    expect(response.status).toBe(413);
    expect(response.payload).toContain("Payload too large");
    expect(response.payload).toContain("10mb");
  });
});
