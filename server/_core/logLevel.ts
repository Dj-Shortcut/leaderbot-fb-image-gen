const LOG_LEVEL = (process.env.LOG_LEVEL ?? "info").toLowerCase();

export function isDebugLogEnabled(): boolean {
  return LOG_LEVEL === "debug";
}

export function isStateDumpEnabled(): boolean {
  return process.env.DEBUG_STATE_DUMP === "1";
}

export function shouldSampleWebhookSummary(sampleRate = 20): boolean {
  if (isDebugLogEnabled()) {
    return true;
  }

  return Math.floor(Math.random() * sampleRate) === 0;
}

