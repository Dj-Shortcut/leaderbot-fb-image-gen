import { type Lang, t } from "./i18n";
import {
  getQuickRepliesForState,
  type ConversationState,
  type StateQuickReply,
} from "./messengerState";

function localizeReplyTitle(reply: StateQuickReply, lang: Lang): string {
  switch (reply.payload) {
    case "WHAT_IS_THIS":
      return lang === "en" ? "What is this?" : "Wat doe ik?";
    case "PRIVACY_INFO":
      return t(lang, "privacyButtonLabel");
    case "CHOOSE_STYLE":
      return lang === "en" ? "New style" : "Nieuwe stijl";
    case "RETRY_STYLE":
      return lang === "en" ? "Retry" : "Probeer opnieuw";
    default:
      return reply.title;
  }
}

export function buildStateResponseText(
  state: ConversationState,
  leadText: string,
  lang: Lang
): string {
  const replies = getQuickRepliesForState(state);
  if (replies.length === 0) {
    return leadText;
  }

  return [
    leadText,
    "",
    ...replies.map(
      (reply, index) => `${index + 1}. ${localizeReplyTitle(reply, lang)}`
    ),
  ].join("\n");
}
