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
    stylePicker: "Kies je stijl 👇",
    success: "Klaar ✅",
    processingBlocked: "Even geduld — je vorige afbeelding is bijna klaar.",
    styleWithoutPhoto: "Stuur eerst een foto, dan maak ik die stijl voor je.",
    textWithoutPhoto: "Stuur gerust een foto, dan kan ik een stijl voor je maken.",
    privacy: ({ link }) => [
      "Je foto wordt enkel gebruikt om de afbeelding te maken.",
      "Ze wordt daarna niet bewaard.",
      `Hier kan je het volledige privacybeleid lezen: ${link ?? "<link>"}`,
    ].join("\n"),
    aboutLeaderbot: "Leaderbot is gemaakt door Andy. Je mag hem gerust contacteren via Facebook.\nVolledige naam op vraag: Andy Arijs.",
    failure: "Oeps. Probeer nog een stijl.",
    missingInputImage: "Ik kon je foto niet goed lezen. Stuur ze nog eens door aub.",
    generatingPrompt: ({ styleLabel }) => `Ik maak nu je ${styleLabel ?? ""}-stijl.`,
    retryThisStyle: "Opnieuw",
    otherStyle: "Andere",
    hdUnavailable: "I can share HD downloads after I generate an image.",
    generationUnavailable: "AI generation isn’t enabled yet.",
    generationTimeout: "This took too long.",
    generationGenericFailure: "I couldn’t generate that image right now.",
  },
  en: {
    flowExplanation: "Send a photo and I will make a special version of it in another style for free.",
    stylePicker: "Pick a style 👇",
    success: "Done ✅",
    processingBlocked: "One sec — your previous image is almost done.",
    styleWithoutPhoto: "Send a photo first, then I can make that style for you.",
    textWithoutPhoto: "Feel free to send a photo, then I can make a style for you.",
    privacy: ({ link }) => [
      "Your photo is only used to make the image.",
      "It is not stored afterwards.",
      `You can read the full privacy policy here: ${link ?? "<link>"}`,
    ].join("\n"),
    aboutLeaderbot: "Leaderbot was made by Andy. Feel free to contact him via Facebook.\nFull name on request: Andy Arijs.",
    failure: "Oops. Try another style.",
    missingInputImage: "I could not read your photo properly. Please send it again.",
    generatingPrompt: ({ styleLabel }) => `I am now making your ${styleLabel ?? ""} style.`,
    retryThisStyle: "Retry",
    otherStyle: "Another",
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
