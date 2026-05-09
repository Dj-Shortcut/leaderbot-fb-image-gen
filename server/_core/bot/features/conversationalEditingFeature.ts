import type { BotFeature } from "../features";
import { t } from "../../i18n";
import { DIRECTOR_GENERATION_STYLE } from "../../image-generation/director/directorModes";
import { normalizeStyle } from "../../webhookHelpers";
import { interpretConversationalEdit } from "../../conversationalEditInterpreter";

export const conversationalEditingFeature: BotFeature = {
  name: "conversationalEditing",
  async onText(ctx) {
    if (
      ctx.normalizedText.startsWith("remix") ||
      ctx.normalizedText === "nieuwe stijl" ||
      ctx.normalizedText === "new style" ||
      ctx.normalizedText.startsWith("/")
    ) {
      return { handled: false };
    }

    const hasPriorGeneration = Boolean(
      ctx.state.lastGeneratedUrl ?? ctx.state.lastImageUrl
    );
    const sourcePhotoUrl = ctx.state.lastPhotoUrl ?? ctx.state.lastPhoto ?? null;
    if (!hasPriorGeneration || !sourcePhotoUrl) {
      return { handled: false };
    }

    const decision = await interpretConversationalEdit({
      text: ctx.messageText,
      lang: ctx.lang,
      lastStyle: normalizeStyle(ctx.state.selectedStyle ?? "") ?? ctx.state.lastStyle,
      lastDirectorMode: ctx.state.lastDirectorMode,
    });
    if (!decision?.shouldEdit) {
      return { handled: false };
    }

    const selectedStyle = normalizeStyle(ctx.state.selectedStyle ?? "");
    const style = decision.style ?? selectedStyle ?? ctx.state.lastStyle;
    const directorMode =
      decision.directorMode ??
      (decision.style ? undefined : ctx.state.lastDirectorMode);
    if (!style) {
      await ctx.sendStateQuickReplies("AWAITING_STYLE", t(ctx.lang, "stylePicker"));
      return { handled: true };
    }

    const combinedPrompt = [ctx.state.lastPrompt, decision.promptHint]
      .map(value => value?.trim())
      .filter(Boolean)
      .join(" | ");

    ctx.logger.info("bot_feature_conversational_edit", {
      style,
      directorMode,
      hasPromptHint: Boolean(decision.promptHint),
    });

    await ctx.runStyleGeneration(
      directorMode ? DIRECTOR_GENERATION_STYLE : style,
      sourcePhotoUrl,
      combinedPrompt || ctx.state.lastPrompt,
      directorMode,
    );
    return { handled: true };
  },
};
