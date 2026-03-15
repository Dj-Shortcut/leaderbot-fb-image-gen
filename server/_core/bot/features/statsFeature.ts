import type { BotFeature } from "../features";

function isAdmin(psid: string, userId: string): boolean {
  const configured = (process.env.MESSENGER_ADMIN_IDS ?? "")
    .split(",")
    .map(value => value.trim())
    .filter(Boolean);

  if (configured.length === 0) {
    return false;
  }

  const allowed = new Set(configured);
  return allowed.has(psid) || allowed.has(userId);
}

export const statsFeature: BotFeature = {
  name: "stats",
  async onText(context) {
    if (context.text?.trim() !== "/stats") {
      return false;
    }

    if (!isAdmin(context.psid, context.userId)) {
      return false;
    }

    const stats = context.getRuntimeStats();
    const avgLatency =
      stats.averageGenerationLatencyMs === null
        ? "n/a"
        : `${stats.averageGenerationLatencyMs}ms`;

    await context.sendText(
      [
        `📊 ${stats.date}`,
        `images generated: ${stats.imagesGeneratedToday}`,
        `active users: ${stats.activeUsersToday}`,
        `errors: ${stats.errorCountToday}`,
        `avg latency: ${avgLatency}`,
        "note: node-local debug metrics (reset on restart; not cross-instance)",
      ].join("\n")
    );

    return true;
  },
};
