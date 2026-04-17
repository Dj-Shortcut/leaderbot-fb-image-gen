import { t, type Lang } from "../i18n";
import { getStylesForCategory, type Style, type StyleCategory } from "../messengerStyles";
import {
  getOrCreateState,
  setFlowState,
  setPreselectedStyle,
  setSelectedStyleCategory,
} from "../messengerState";
import {
  normalizeStyle,
  parseStyle,
  styleCategoryPayloadToCategory,
  stylePayloadToStyle,
  STYLE_CATEGORY_LABELS,
  STYLE_LABELS,
} from "../webhookHelpers";
import {
  sendWhatsAppButtonsReply,
  sendWhatsAppListReply,
  sendWhatsAppTextReply,
} from "../whatsappResponseService";
import { runWhatsAppStyleGeneration } from "./styleGenerationFlow";

const WHATSAPP_CATEGORY_CHOICES = [
  { key: "1", category: "illustrated" as const },
  { key: "2", category: "atmosphere" as const },
  { key: "3", category: "bold" as const },
];

export function parseWhatsAppCategorySelection(
  text: string
): StyleCategory | undefined {
  const normalizedText = text.trim().toLowerCase();
  if (normalizedText === "wa_illustrated") return "illustrated";
  if (normalizedText === "wa_atmosphere") return "atmosphere";
  if (normalizedText === "wa_bold") return "bold";

  const numbered = WHATSAPP_CATEGORY_CHOICES.find(
    choice => choice.key === normalizedText
  );
  if (numbered) return numbered.category;
  if (normalizedText.includes("illustr")) return "illustrated";
  if (normalizedText.includes("atmos")) return "atmosphere";
  if (normalizedText.includes("bold")) return "bold";
  return styleCategoryPayloadToCategory(normalizedText.toUpperCase());
}

export function parseWhatsAppStyleSelection(
  text: string,
  category: StyleCategory | null | undefined
): Style | undefined {
  const normalizedText = text.trim().toLowerCase();
  if (category) {
    const numericIndex = Number.parseInt(normalizedText, 10);
    if (Number.isFinite(numericIndex) && numericIndex > 0) {
      return getStylesForCategory(category)[numericIndex - 1]?.style;
    }
  }

  return stylePayloadToStyle(text) ?? parseStyle(text) ?? normalizeStyle(text);
}

export async function sendWhatsAppStyleCategoryPrompt(
  senderId: string,
  lang: Lang
): Promise<void> {
  await sendWhatsAppButtonsReply(
    senderId,
    lang === "en"
      ? "Choose a style group to continue."
      : "Kies een stijlgroep om verder te gaan.",
    WHATSAPP_CATEGORY_CHOICES.map(choice => ({
      id: `WA_${choice.category.toUpperCase()}`,
      title: STYLE_CATEGORY_LABELS[choice.category],
    }))
  );
}

export async function sendWhatsAppStyleOptions(
  senderId: string,
  category: StyleCategory,
  lang: Lang
): Promise<void> {
  await setSelectedStyleCategory(senderId, category);
  await setFlowState(senderId, "AWAITING_STYLE");
  await sendWhatsAppListReply(
    senderId,
    lang === "en"
      ? `Pick a ${STYLE_CATEGORY_LABELS[category].toLowerCase()} style.`
      : `Kies een ${STYLE_CATEGORY_LABELS[category].toLowerCase()}-stijl.`,
    lang === "en" ? "Choose style" : "Kies stijl",
    getStylesForCategory(category).map(style => ({
      id: style.payload,
      title: STYLE_LABELS[style.style],
      description:
        lang === "en"
          ? `${STYLE_CATEGORY_LABELS[category]} style`
          : `${STYLE_CATEGORY_LABELS[category]}-stijl`,
    })),
    STYLE_CATEGORY_LABELS[category]
  );
}

export async function handleWhatsAppPayloadSelection(input: {
  payload: string;
  senderId: string;
  userId: string;
  reqId: string;
  lang: Lang;
}): Promise<boolean> {
  const { payload, senderId, userId, reqId, lang } = input;
  if (payload === "WHAT_IS_THIS") {
    await sendWhatsAppTextReply(senderId, t(lang, "flowExplanation"));
    return true;
  }
  if (payload === "PRIVACY_INFO") {
    const appBaseUrl = process.env.APP_BASE_URL?.trim() ?? process.env.BASE_URL?.trim();
    const privacyUrl =
      process.env.PRIVACY_POLICY_URL?.trim() ||
      (appBaseUrl && /^https?:\/\//i.test(appBaseUrl)
        ? `${appBaseUrl.replace(/\/$/, "")}/privacy`
        : undefined);
    await sendWhatsAppTextReply(senderId, t(lang, "privacy", { link: privacyUrl }));
    return true;
  }
  if (payload === "CHOOSE_STYLE") {
    await setPreselectedStyle(senderId, null);
    await setSelectedStyleCategory(senderId, null);
    await setFlowState(senderId, "AWAITING_STYLE");
    await sendWhatsAppStyleCategoryPrompt(senderId, lang);
    return true;
  }
  if (payload !== "RETRY_STYLE") {
    return false;
  }

  const currentState = await Promise.resolve(getOrCreateState(senderId));
  const retryStyle = currentState.selectedStyle
    ? parseStyle(currentState.selectedStyle)
    : undefined;
  if (retryStyle) {
    await runWhatsAppStyleGeneration({ senderId, userId, style: retryStyle, reqId, lang });
    return true;
  }

  await setFlowState(senderId, "AWAITING_STYLE");
  await sendWhatsAppStyleCategoryPrompt(senderId, lang);
  return true;
}
