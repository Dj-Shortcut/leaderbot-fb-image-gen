import type { BotFeature } from "../features";

/**
 * Reserved extension point for future conversational editing.
 *
 * Future requirements:
 * - last image context (lastGeneratedUrl / lastPhotoUrl)
 * - last prompt context (latest remix instruction or generation prompt)
 * - intent detection to separate edits from new generation requests
 * - safe fallback to normal generation flow when intent is unclear
 */
export const conversationalEditingPlaceholderFeature: BotFeature = {
  name: "conversational_editing_placeholder",
};
