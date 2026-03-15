import type { BotFeature } from "../features";
import { t } from "../../i18n";
import { normalizeStyle } from "../../webhookHelpers";

function getRemixState(context: Parameters<NonNullable<BotFeature["onText"]>>[0]) {
  const hasPriorGeneration = Boolean(
    context.state.lastGeneratedUrl ?? context.state.lastImageUrl
  );
  const sourcePhotoUrl = context.state.lastPhotoUrl ?? context.state.lastPhoto ?? null;
  const selectedStyle =
    normalizeStyle(context.state.selectedStyle ?? "") ?? context.state.lastStyle;

  return {
    hasPriorGeneration,
    sourcePhotoUrl,
    selectedStyle,
  };
}

export const remixFeature: BotFeature = {
  name: "remix",
  async onPayload(ctx) {
    if (ctx.payload !== "REMIX_LAST") {
      return { handled: false };
    }

    const hasPriorGeneration = Boolean(
      ctx.state.lastGeneratedUrl ?? ctx.state.lastImageUrl
    );
    const sourcePhotoUrl = ctx.state.lastPhotoUrl ?? ctx.state.lastPhoto ?? null;
    const selectedStyle =
      normalizeStyle(ctx.state.selectedStyle ?? "") ?? ctx.state.lastStyle;

    if (!hasPriorGeneration) {
      await ctx.sendText("I can't remix yet—send a photo and generate one first.");
      return { handled: true };
    }

    if (!sourcePhotoUrl) {
      await ctx.sendText(t(ctx.lang, "textWithoutPhoto"));
      return { handled: true };
    }

    if (!selectedStyle) {
      await ctx.sendStateQuickReplies("AWAITING_STYLE", t(ctx.lang, "stylePicker"));
      return { handled: true };
    }

    await ctx.runStyleGeneration(
      selectedStyle,
      sourcePhotoUrl,
      ctx.state.lastPrompt,
    );
    return { handled: true };
  },
  async onText(ctx) {
    if (!ctx.normalizedText.startsWith("remix")) {
      return { handled: false };
    }

    const { hasPriorGeneration, sourcePhotoUrl, selectedStyle } = getRemixState(ctx);

    if (!hasPriorGeneration) {
      await ctx.sendText("I can't remix yet—send a photo and generate one first.");
      return { handled: true };
    }

    if (!sourcePhotoUrl) {
      await ctx.sendText("I need your original source photo first. Please send it again.");
      return { handled: true };
    }

    if (ctx.normalizedText === "remix") {
      if (!selectedStyle) {
        await ctx.sendStateQuickReplies("AWAITING_STYLE", t(ctx.lang, "stylePicker"));
        return { handled: true };
      }

      await ctx.runStyleGeneration(
        selectedStyle,
        sourcePhotoUrl,
        ctx.state.lastPrompt,
      );
      return { handled: true };
    }

    if (!ctx.normalizedText.startsWith("remix:")) {
      return { handled: false };
    }

    const instruction = ctx.messageText.slice("remix:".length).trim();
    if (!instruction) {
      await ctx.sendStateQuickReplies("AWAITING_STYLE", t(ctx.lang, "stylePicker"));
      return { handled: true };
    }

    const requestedStyle = normalizeStyle(instruction);
    const style = requestedStyle ?? selectedStyle;
    if (!style) {
      await ctx.sendStateQuickReplies("AWAITING_STYLE", t(ctx.lang, "stylePicker"));
      return { handled: true };
    }

    const combinedPrompt = [ctx.state.lastPrompt, instruction]
      .map(value => value?.trim())
      .filter(Boolean)
      .join(" | ");

    await ctx.runStyleGeneration(
      style,
      sourcePhotoUrl,
      combinedPrompt || undefined,
    );
    return { handled: true };
  },
};
