export type Style =
  | "caricature"
  | "gold"
  | "petals"
  | "clouds"
  | "cinematic"
  | "disco";

export type PromptProfile = "base" | "wow";

export const STYLE_TO_DEMO_FILE: Record<Style, string> = {
  caricature: "01-caricature.png",
  petals: "02-petals.png",
  gold: "03-gold.png",
  cinematic: "04-crayon.png",
  disco: "05-paparazzi.png",
  clouds: "06-clouds.png",
};

export type StyleId =
  | "STYLE_CARICATURE"
  | "STYLE_PETALS"
  | "STYLE_GOLD"
  | "STYLE_CINEMATIC"
  | "STYLE_DISCO"
  | "STYLE_CLOUDS"
  | "gold";

export type StyleConfig = {
  id: StyleId;
  payload: StyleId;
  style: Style;
  label: string;
  demoThumbnailUrl: string;
  mockResultUrls: string[];
};

function getLocalDemoUrl(style: Style): string {
  return `/demo/${STYLE_TO_DEMO_FILE[style]}`;
}

export const STYLE_CONFIGS: StyleConfig[] = [
  {
    id: "STYLE_CARICATURE",
    payload: "STYLE_CARICATURE",
    style: "caricature",
    label: "🎨 Caricature",
    demoThumbnailUrl: getLocalDemoUrl("caricature"),
    mockResultUrls: [getLocalDemoUrl("caricature")],
  },
  {
    id: "STYLE_PETALS",
    payload: "STYLE_PETALS",
    style: "petals",
    label: "🌸 Petals",
    demoThumbnailUrl: getLocalDemoUrl("petals"),
    mockResultUrls: [getLocalDemoUrl("petals")],
  },
  {
    id: "STYLE_GOLD",
    payload: "STYLE_GOLD",
    style: "gold",
    label: "✨ Gold",
    demoThumbnailUrl: getLocalDemoUrl("gold"),
    mockResultUrls: [getLocalDemoUrl("gold")],
  },
  {
    id: "STYLE_CINEMATIC",
    payload: "STYLE_CINEMATIC",
    style: "cinematic",
    label: "🎬 Cinematic",
    demoThumbnailUrl: getLocalDemoUrl("cinematic"),
    mockResultUrls: [getLocalDemoUrl("cinematic")],
  },
  {
    id: "STYLE_DISCO",
    payload: "STYLE_DISCO",
    style: "disco",
    label: "🪩 Disco Glow",
    demoThumbnailUrl: getLocalDemoUrl("disco"),
    mockResultUrls: [getLocalDemoUrl("disco")],
  },
  {
    id: "STYLE_CLOUDS",
    payload: "STYLE_CLOUDS",
    style: "clouds",
    label: "☁️ Clouds",
    demoThumbnailUrl: getLocalDemoUrl("clouds"),
    mockResultUrls: [getLocalDemoUrl("clouds")],
  },
];

export const STYLE_IDS = new Set<StyleId>(STYLE_CONFIGS.map(style => style.id));

export function isStylePayload(value: string): value is StyleId {
  return STYLE_IDS.has(value as StyleId);
}

export function getStyleById(styleId: StyleId): StyleConfig {
  const style = STYLE_CONFIGS.find(item => item.id === styleId);

  if (!style) {
    throw new Error(`Unknown style: ${styleId}`);
  }

  return style;
}

export function getDemoThumbnailUrl(style: Style): string {
  return getLocalDemoUrl(style);
}


export const STYLE_PROMPTS_BASE: Record<Style, string> = {
  caricature: "Create a playful caricature portrait. Keep identity recognizable.",
  petals: "Create a soft floral portrait with floating petals. Keep identity recognizable.",
  gold: "Create a luxury golden portrait with elegant highlights. Keep identity recognizable.",
  cinematic: "Create a cinematic portrait with dramatic lighting and filmic grading. Keep identity recognizable.",
  disco: "Create a disco party portrait with neon lights and sparkles. Keep identity recognizable.",
  clouds: "Create a dreamy portrait with soft clouds and pastel atmosphere. Keep identity recognizable.",
};

export const STYLE_PROMPTS_WOW: Record<Style, string> = {
  caricature: "High-end editorial caricature with crisp contours, rich color separation, and premium studio finish. Preserve identity and likeness.",
  petals: "Cinematic floral fantasy with layered petals, depth-rich bokeh, and romantic backlight. Preserve identity and likeness.",
  gold: "Premium luxury gold aesthetic with metallic accents, glossy highlights, and beauty-grade finish. Preserve identity and likeness.",
  cinematic: "Dramatic cinematic key-art look with directional movie lighting, atmospheric depth, and filmic contrast. Preserve identity and likeness.",
  disco: "Vibrant disco night scene with neon interplay, reflective sparkles, and high-fashion nightlife finish. Preserve identity and likeness.",
  clouds: "Ethereal sky dreamscape with volumetric soft clouds, airy pastel light, and serene depth haze. Preserve identity and likeness.",
};

export function getStylePrompt(style: Style, profile: PromptProfile): string {
  return profile === "wow" ? STYLE_PROMPTS_WOW[style] : STYLE_PROMPTS_BASE[style];
}
