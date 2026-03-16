import { hasBotFeature, registerBotFeature } from "./features";
import { rateLimitFeature } from "./features/rateLimitFeature";
import { statsFeature } from "./features/statsFeature";
import { assistantCommandsFeature } from "./features/assistantCommandsFeature";
import { conversationalEditingFeature } from "./features/conversationalEditingFeature";
import { styleCommandsFeature } from "./features/styleCommandsFeature";

export function ensureDefaultBotFeaturesRegistered(): void {
  const defaults = [
    rateLimitFeature,
    styleCommandsFeature,
    conversationalEditingFeature,
    statsFeature,
    assistantCommandsFeature,
  ] as const;

  for (const feature of defaults) {
    if (!hasBotFeature(feature.name)) {
      registerBotFeature(feature);
    }
  }
}
