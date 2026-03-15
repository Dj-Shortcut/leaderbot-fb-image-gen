import type { BotFeature } from "../features";
import { normalizeStyle } from "../../webhookHelpers";
import { setFlowState } from "../../messengerState";

export const remixFeature: BotFeature = {
  name: "remix",
  async onText(context) {
    const trimmed = context.text?.trim();
    if (!trimmed) {
      return false;
    }

    if (!trimmed.toLowerCase().startsWith("remix:")) {
      return false;
    }

    const instruction = trimmed.slice("remix:".length).trim();
    const lastGeneratedUrl = context.state.lastGeneratedUrl ?? context.state.lastImageUrl ?? null;
    const sourcePhotoUrl = context.state.lastPhotoUrl ?? context.state.lastPhoto ?? null;

    if (!lastGeneratedUrl) {
      await context.sendText("I can't remix yet—send a photo and generate one first.");
      return true;
    }

    if (!sourcePhotoUrl) {
      await context.sendText("I need your original source photo first. Please send it again.");
      return true;
    }

    const requestedStyle = normalizeStyle(instruction);
    const style = requestedStyle ?? context.state.lastStyle;

    if (!style) {
      await context.sendText("I need your last style context first. Choose a style and generate once.");
      await setFlowState(context.psid, "AWAITING_STYLE");
      return true;
    }

    const combinedPrompt = [context.state.lastPrompt, instruction]
      .map(value => value?.trim())
      .filter(Boolean)
      .join(" | ");

    await context.runStyleGeneration(
      style,
      sourcePhotoUrl,
      combinedPrompt || undefined,
    );
    return true;
  },
};
