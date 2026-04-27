import { createHash } from "node:crypto";
import { executeGenerationFlow } from "../generationFlow";
import { getGenerationMetrics } from "../image-generation/openAiImageClient";
import { t, type Lang } from "../i18n";
import type { Style } from "../messengerStyles";
import { canGenerate, increment } from "../messengerQuota";
import {
  clearPendingImageState,
  getOrCreateState,
  setChosenStyle,
  setFlowState,
  setLastGenerated,
  setLastGenerationContext,
} from "../messengerState";
import { STYLE_LABELS } from "../webhookHelpers";
import {
  sendWhatsAppImageReply,
  sendWhatsAppTextReply,
} from "../whatsappResponseService";

function summarizeSensitiveUrl(url: string): { host: string; shortHash: string } {
  const shortHash = createHash("sha256").update(url).digest("hex").slice(0, 12);
  try {
    return { host: new URL(url).host || "invalid-url", shortHash };
  } catch {
    return { host: "invalid-url", shortHash };
  }
}

export async function runWhatsAppStyleGeneration(input: {
  senderId: string;
  userId: string;
  style: Style;
  reqId: string;
  lang: Lang;
  sourceImageUrl?: string;
  promptHint?: string;
}): Promise<void> {
  const { senderId, userId, style, reqId, lang, sourceImageUrl, promptHint } = input;
  const allowed = await canGenerate(senderId);
  if (!allowed) {
    await sendWhatsAppTextReply(
      senderId,
      lang === "en"
        ? "You used your free credits for today. Come back tomorrow."
        : "Je hebt je gratis credits voor vandaag opgebruikt. Kom morgen terug."
    );
    await setFlowState(senderId, "AWAITING_STYLE");
    return;
  }

  const state = await Promise.resolve(getOrCreateState(senderId));
  const resolvedSourceImageUrl = sourceImageUrl ?? state.lastPhotoUrl ?? undefined;
  console.info("[whatsapp webhook] generation requested", {
    user: userId,
    style,
    hasPromptHint: Boolean(promptHint?.trim()),
    sourceImageUrlHost: resolvedSourceImageUrl
      ? (() => {
          try {
            return new URL(resolvedSourceImageUrl).hostname.toLowerCase();
          } catch {
            return undefined;
          }
        })()
      : undefined,
    trustedSourceImageUrl:
      resolvedSourceImageUrl !== undefined &&
      resolvedSourceImageUrl === state.lastPhotoUrl &&
      state.lastPhotoSource === "stored",
  });

  await setChosenStyle(senderId, style);
  await setFlowState(senderId, "PROCESSING");
  await sendWhatsAppTextReply(
    senderId,
    t(lang, "generatingPrompt", { styleLabel: STYLE_LABELS[style] })
  );

  const result = await executeGenerationFlow({
    style,
    userId,
    reqId,
    promptHint,
    sourceImageUrl,
    lastPhotoUrl: state.lastPhotoUrl,
    lastPhotoSource: state.lastPhotoSource,
  });

  if (result.kind === "success") {
    await sendWhatsAppImageReply(senderId, result.imageUrl);
    await increment(senderId);
    await setLastGenerated(senderId, result.imageUrl);
    await setLastGenerationContext(senderId, { style, prompt: promptHint });
    await setFlowState(senderId, "RESULT_READY");
    await sendWhatsAppTextReply(
      senderId,
      `${t(lang, "success")}\n${
        lang === "en"
          ? "Reply with 'new style' if you want another version."
          : "Antwoord met 'nieuwe stijl' als je nog een versie wilt."
      }`
    );
    return;
  }

  const metrics = result.metrics ?? getGenerationMetrics(result.error);
  console.error("[whatsapp webhook] generation failed", {
    user: userId,
    style,
    totalMs: metrics?.totalMs,
    error: result.error instanceof Error ? result.error.message : String(result.error),
  });

  let failureText = t(lang, "generationGenericFailure");
  if (result.errorKind === "missing_source_image") {
    failureText = t(lang, "styleWithoutPhoto");
    await setFlowState(senderId, "AWAITING_PHOTO");
  } else if (
    result.errorKind === "invalid_source_image" ||
    result.errorKind === "missing_input_image"
  ) {
    failureText = t(lang, "missingInputImage");
    if (
      result.errorKind === "invalid_source_image" &&
      (!sourceImageUrl || result.resolvedSourceImageUrl === state.lastPhotoUrl)
    ) {
      await clearPendingImageState(senderId);
    }
    await setFlowState(senderId, "AWAITING_PHOTO");
    if (result.errorKind === "invalid_source_image" && result.resolvedSourceImageUrl) {
      console.error("[whatsapp webhook] source image rejected", {
        user: userId,
        style,
        sourceImageUrl: summarizeSensitiveUrl(result.resolvedSourceImageUrl),
      });
    }
  } else if (result.errorKind === "generation_unavailable") {
    failureText = t(lang, "generationUnavailable");
    await setFlowState(senderId, "AWAITING_STYLE");
  } else if (result.errorKind === "generation_timeout") {
    failureText = t(lang, "generationTimeout");
    await setFlowState(senderId, "AWAITING_STYLE");
  } else if (result.errorKind === "generation_budget_reached") {
    failureText = t(lang, "generationBudgetReached");
    await setFlowState(senderId, "AWAITING_STYLE");
  } else {
    await setFlowState(senderId, "FAILURE");
  }

  await sendWhatsAppTextReply(senderId, failureText);
}
