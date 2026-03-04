import type express from "express";

const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_MAX_REQUESTS = 120;
const DEFAULT_MAX_KEYS = 20_000;

type RateLimitBucket = {
  count: number;
  resetAt: number;
};

const buckets = new Map<string, RateLimitBucket>();

function getWindowMs(): number {
  const parsed = Number(process.env.HTTP_RATE_LIMIT_WINDOW_MS);
  if (Number.isFinite(parsed) && parsed > 0) {
    return Math.floor(parsed);
  }

  return DEFAULT_WINDOW_MS;
}

function getMaxRequests(): number {
  const parsed = Number(process.env.HTTP_RATE_LIMIT_MAX_REQUESTS);
  if (Number.isFinite(parsed) && parsed > 0) {
    return Math.floor(parsed);
  }

  return DEFAULT_MAX_REQUESTS;
}

function getClientIp(req: express.Request): string {
  const forwardedFor = req.headers["x-forwarded-for"];
  if (typeof forwardedFor === "string") {
    const firstIp = forwardedFor.split(",")[0]?.trim();
    if (firstIp) {
      return firstIp;
    }
  }

  return req.ip || req.socket.remoteAddress || "unknown";
}

function shouldSkipRateLimit(req: express.Request): boolean {
  return req.path === "/health" || req.path === "/healthz";
}

function pruneBuckets(now: number): void {
  buckets.forEach((bucket, key) => {
    if (bucket.resetAt <= now) {
      buckets.delete(key);
    }
  });

  while (buckets.size > DEFAULT_MAX_KEYS) {
    const oldestKey = buckets.keys().next().value;
    if (!oldestKey) {
      break;
    }

    buckets.delete(oldestKey);
  }
}

export function createGlobalHttpRateLimiter(): express.RequestHandler {
  return (req, res, next) => {
    if (shouldSkipRateLimit(req)) {
      next();
      return;
    }

    const now = Date.now();
    const windowMs = getWindowMs();
    const maxRequests = getMaxRequests();
    const key = `${req.method}:${getClientIp(req)}`;

    pruneBuckets(now);

    const current = buckets.get(key);
    if (!current || current.resetAt <= now) {
      buckets.set(key, {
        count: 1,
        resetAt: now + windowMs,
      });
      next();
      return;
    }

    current.count += 1;

    const remaining = Math.max(0, maxRequests - current.count);
    res.setHeader("X-RateLimit-Limit", String(maxRequests));
    res.setHeader("X-RateLimit-Remaining", String(remaining));
    res.setHeader("X-RateLimit-Reset", String(Math.ceil(current.resetAt / 1000)));

    if (current.count > maxRequests) {
      const retryAfterSeconds = Math.max(1, Math.ceil((current.resetAt - now) / 1000));
      res.setHeader("Retry-After", String(retryAfterSeconds));
      res.status(429).json({
        error: "Too Many Requests",
        message: "Global HTTP rate limit exceeded. Please retry shortly.",
      });
      return;
    }

    next();
  };
}

export function resetGlobalHttpRateLimiter(): void {
  buckets.clear();
}

export { DEFAULT_MAX_REQUESTS, DEFAULT_WINDOW_MS };
