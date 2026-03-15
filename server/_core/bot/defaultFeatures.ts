import { hasBotFeature, registerBotFeature } from "./features";
import { rateLimitFeature } from "./features/rateLimitFeature";
import { remixFeature } from "./features/remixFeature";
import { statsFeature } from "./features/statsFeature";
import { conversationalEditingPlaceholderFeature } from "./features/conversationalEditingPlaceholderFeature";

export function ensureDefaultBotFeaturesRegistered(): void {
  const defaults = [
    rateLimitFeature,
    remixFeature,
    statsFeature,
    conversationalEditingPlaceholderFeature,
  ] as const;

  for (const feature of defaults) {
    if (!hasBotFeature(feature.name)) {
      registerBotFeature(feature);
    }
  }
}
