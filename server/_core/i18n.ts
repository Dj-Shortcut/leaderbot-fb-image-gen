export type Lang = "nl" | "en";

type TranslationParams = {
  link?: string;
  styleLabel?: string;
};

type TranslationKey =
  | "flowExplanation"
  | "stylePicker"
  | "success"
  | "processingBlocked"
  | "styleWithoutPhoto"
  | "textWithoutPhoto"
  | "privacy"
  | "aboutLeaderbot"
  | "failure"
  | "missingInputImage"
  | "generatingPrompt"
  | "retryThisStyle"
  | "otherStyle"
  | "hdUnavailable"
  | "generationUnavailable"
  | "generationTimeout"
  | "generationGenericFailure";

type TranslationValue = string | ((params: TranslationParams) => string);

const translations: Record<Lang, Record<TranslationKey, TranslationValue>> = {
  nl: {
    flowExplanation: "Stuur een foto en ik maak er een speciale versie van in een andere stijl — het is gratis.",
    stylePicker: "Dank je. Kies hieronder een stijl.",
    success: "Klaar. Je kan de afbeelding opslaan door erop te tikken.",
    processingBlocked: "Ik ben nog bezig met je vorige afbeelding.",
    styleWithoutPhoto: "Stuur eerst een foto, dan maak ik die stijl voor je.",
    textWithoutPhoto: "Stuur gerust een foto, dan kan ik een stijl voor je maken.",
    privacy: ({ link }) => [
      "Je foto wordt enkel gebruikt om de afbeelding te maken.",
      "Ze wordt daarna niet bewaard.",
      `Hier kan je het volledige privacybeleid lezen: ${link ?? "<link>"}`,
    ].join("\n"),
    aboutLeaderbot: "Leaderbot is gemaakt door Andy. Je mag hem gerust contacteren via Facebook.\nVolledige naam op vraag: Andy Arijs.",
    failure: "Er ging iets mis bij het maken van je afbeelding. Kies gerust opnieuw een stijl.",
    missingInputImage: "Ik kon je foto niet goed lezen. Stuur ze nog eens door aub.",
    generatingPrompt: ({ styleLabel }) => `Ik maak nu je ${styleLabel ?? ""}-stijl.`,
    retryThisStyle: "Retry this style",
    otherStyle: "Andere stijl",
    hdUnavailable: "I can share HD downloads after I generate an image.",
    generationUnavailable: "AI generation isn’t enabled yet.",
    generationTimeout: "This took too long.",
    generationGenericFailure: "I couldn’t generate that image right now.",
  },
  en: {
    flowExplanation: "Send a photo and I will make a special version of it in another style for free.",
    stylePicker: "Thanks. Choose a style below.",
    success: "Done. You can save the image by tapping it.",
    processingBlocked: "I am still working on your previous image.",
    styleWithoutPhoto: "Send a photo first, then I can make that style for you.",
    textWithoutPhoto: "Feel free to send a photo, then I can make a style for you.",
    privacy: ({ link }) => [
      "Your photo is only used to make the image.",
      "It is not stored afterwards.",
      `You can read the full privacy policy here: ${link ?? "<link>"}`,
    ].join("\n"),
    aboutLeaderbot: "Leaderbot was made by Andy. Feel free to contact him via Facebook.\nFull name on request: Andy Arijs.",
    failure: "Something went wrong while making your image. Feel free to choose a style again.",
    missingInputImage: "I could not read your photo properly. Please send it again.",
    generatingPrompt: ({ styleLabel }) => `I am now making your ${styleLabel ?? ""} style.`,
    retryThisStyle: "Retry this style",
    otherStyle: "Other style",
    hdUnavailable: "I can share HD downloads after I generate an image.",
    generationUnavailable: "AI generation isn’t enabled yet.",
    generationTimeout: "This took too long.",
    generationGenericFailure: "I couldn’t generate that image right now.",
  },
};

export function normalizeLang(lang: string | null | undefined): Lang {
  return typeof lang === "string" && lang.toLowerCase().startsWith("en") ? "en" : "nl";
}

export function t(lang: Lang, key: TranslationKey, params: TranslationParams = {}): string {
  const entry = translations[lang][key];
  return typeof entry === "function" ? entry(params) : entry;
}
