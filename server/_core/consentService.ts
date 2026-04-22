import { deleteUserData } from "./dataDeletionService";
import type { Lang } from "./i18n";
import type { QuickReply } from "./messengerApi";
import {
  setConsentState,
  setPendingDeleteConfirm,
  type MessengerUserState,
} from "./messengerState";
import type { NormalizedWhatsAppEvent } from "./whatsappTypes";

export const GDPR_CONSENT_AGREE = "GDPR_CONSENT_AGREE";
export const GDPR_CONSENT_DECLINE = "GDPR_CONSENT_DECLINE";
export const GDPR_DELETE_CONFIRM = "GDPR_DELETE_CONFIRM";
export const GDPR_DELETE_CANCEL = "GDPR_DELETE_CANCEL";

const DELETE_COMMANDS = new Set(["delete my data", "verwijder mijn data"]);

type MessengerConsentGateInput = {
  psid: string;
  lang: Lang;
  text?: string | null;
  payload?: string | null;
  state: MessengerUserState;
  sendText: (text: string) => Promise<void>;
  sendQuickReplies: (text: string, replies: QuickReply[]) => Promise<void>;
};

type WhatsAppConsentGateInput = {
  event: NormalizedWhatsAppEvent;
  lang: Lang;
  state: MessengerUserState;
  sendText: (text: string) => Promise<void>;
  sendButtons: (
    text: string,
    options: Array<{ id: string; title: string }>
  ) => Promise<void>;
};

function isDeleteCommand(text: string | null | undefined): boolean {
  return DELETE_COMMANDS.has(text?.trim().toLocaleLowerCase("nl-BE") ?? "");
}

function consentText(lang: Lang): string {
  return lang === "en"
    ? "Hey! Before we continue, I need your permission to process your images and data."
    : "Hey! Voor we verdergaan heb ik je toestemming nodig om je beelden en data te verwerken.";
}

function deletionConfirmText(lang: Lang): string {
  return lang === "en"
    ? "Are you sure you want to delete all your data? This includes your images, generated results, stored preferences, and chat history."
    : "Weet je zeker dat je al je data wil verwijderen? Dit omvat je beelden, gegenereerde resultaten, opgeslagen voorkeuren en chatgeschiedenis.";
}

function deletionDoneText(lang: Lang): string {
  return lang === "en"
    ? "Your data has been deleted. If you contact me again, I will ask for consent first."
    : "Je data is verwijderd. Als je opnieuw contact opneemt, vraag ik eerst opnieuw toestemming.";
}

function consentDeclinedText(lang: Lang): string {
  return lang === "en"
    ? "No problem. I cannot continue without your consent."
    : "Geen probleem. Zonder je toestemming kan ik niet verdergaan.";
}

function consentAcceptedText(lang: Lang): string {
  return lang === "en"
    ? "You're all set ✅\nYou can delete your data anytime.\nType 'delete my data' or use the button below 👇"
    : "Je bent klaar ✅\nJe kan je data altijd verwijderen.\nTyp 'delete my data' of gebruik de knop hieronder 👇";
}

function deleteCancelledText(lang: Lang): string {
  return lang === "en" ? "Deletion cancelled." : "Verwijderen geannuleerd.";
}

function consentReplies(lang: Lang): QuickReply[] {
  return [
    {
      content_type: "text",
      title: lang === "en" ? "I Agree" : "Ik ga akkoord",
      payload: GDPR_CONSENT_AGREE,
    },
    {
      content_type: "text",
      title: lang === "en" ? "No thanks" : "Nee bedankt",
      payload: GDPR_CONSENT_DECLINE,
    },
  ];
}

function deleteNoticeReplies(): QuickReply[] {
  return [
    {
      content_type: "text",
      title: "🗑 Delete my data",
      payload: "delete my data",
    },
  ];
}

function deleteReplies(lang: Lang): QuickReply[] {
  return [
    {
      content_type: "text",
      title: lang === "en" ? "Yes, delete" : "Ja, verwijder",
      payload: GDPR_DELETE_CONFIRM,
    },
    {
      content_type: "text",
      title: lang === "en" ? "Cancel" : "Annuleer",
      payload: GDPR_DELETE_CANCEL,
    },
  ];
}

function whatsAppConsentButtons(lang: Lang): Array<{ id: string; title: string }> {
  return [
    {
      id: GDPR_CONSENT_AGREE,
      title: lang === "en" ? "I Agree" : "Akkoord",
    },
    {
      id: GDPR_CONSENT_DECLINE,
      title: lang === "en" ? "No thanks" : "Nee",
    },
  ];
}

function whatsAppDeleteButtons(lang: Lang): Array<{ id: string; title: string }> {
  return [
    {
      id: GDPR_DELETE_CONFIRM,
      title: lang === "en" ? "Yes, delete" : "Verwijder",
    },
    {
      id: GDPR_DELETE_CANCEL,
      title: lang === "en" ? "Cancel" : "Annuleer",
    },
  ];
}

function whatsAppDeleteNoticeButtons(): Array<{ id: string; title: string }> {
  return [
    {
      id: "delete my data",
      title: "🗑 Delete my data",
    },
  ];
}

export async function handleMessengerConsentGate(
  input: MessengerConsentGateInput
): Promise<boolean> {
  if (input.payload === GDPR_CONSENT_AGREE) {
    await Promise.resolve(setConsentState(input.psid, true));
    await input.sendQuickReplies(
      consentAcceptedText(input.lang),
      deleteNoticeReplies()
    );
    return true;
  }

  if (input.payload === GDPR_CONSENT_DECLINE) {
    await Promise.resolve(setConsentState(input.psid, false));
    await input.sendText(consentDeclinedText(input.lang));
    return true;
  }

  if (input.payload === GDPR_DELETE_CANCEL) {
    await Promise.resolve(setPendingDeleteConfirm(input.psid, false));
    await input.sendText(deleteCancelledText(input.lang));
    return true;
  }

  if (input.payload === GDPR_DELETE_CONFIRM) {
    await deleteUserData(input.psid);
    await input.sendText(deletionDoneText(input.lang));
    return true;
  }

  if (isDeleteCommand(input.text) || isDeleteCommand(input.payload)) {
    await Promise.resolve(setPendingDeleteConfirm(input.psid, true));
    await input.sendQuickReplies(deletionConfirmText(input.lang), deleteReplies(input.lang));
    return true;
  }

  if (input.state.pendingDeleteConfirm) {
    await input.sendQuickReplies(deletionConfirmText(input.lang), deleteReplies(input.lang));
    return true;
  }

  if (input.state.consentGiven !== true) {
    await input.sendQuickReplies(consentText(input.lang), consentReplies(input.lang));
    return true;
  }

  return false;
}

export async function handleWhatsAppConsentGate(
  input: WhatsAppConsentGateInput
): Promise<boolean> {
  const payload =
    typeof input.event.rawEventMeta?.interactiveReplyId === "string"
      ? input.event.rawEventMeta.interactiveReplyId
      : null;
  const text = input.event.textBody;

  if (payload === GDPR_CONSENT_AGREE) {
    await Promise.resolve(setConsentState(input.event.senderId, true));
    await input.sendButtons(
      consentAcceptedText(input.lang),
      whatsAppDeleteNoticeButtons()
    );
    return true;
  }

  if (payload === GDPR_CONSENT_DECLINE) {
    await Promise.resolve(setConsentState(input.event.senderId, false));
    await input.sendText(consentDeclinedText(input.lang));
    return true;
  }

  if (payload === GDPR_DELETE_CANCEL) {
    await Promise.resolve(setPendingDeleteConfirm(input.event.senderId, false));
    await input.sendText(deleteCancelledText(input.lang));
    return true;
  }

  if (payload === GDPR_DELETE_CONFIRM) {
    await deleteUserData(input.event.senderId);
    await input.sendText(deletionDoneText(input.lang));
    return true;
  }

  if (isDeleteCommand(text) || isDeleteCommand(payload)) {
    await Promise.resolve(setPendingDeleteConfirm(input.event.senderId, true));
    await input.sendButtons(
      deletionConfirmText(input.lang),
      whatsAppDeleteButtons(input.lang)
    );
    return true;
  }

  if (input.state.pendingDeleteConfirm) {
    await input.sendButtons(
      deletionConfirmText(input.lang),
      whatsAppDeleteButtons(input.lang)
    );
    return true;
  }

  if (input.state.consentGiven !== true) {
    await input.sendButtons(consentText(input.lang), whatsAppConsentButtons(input.lang));
    return true;
  }

  return false;
}
