export type Style =
  | "caricature"
  | "gold"
  | "petals"
  | "clouds"
  | "cinematic"
  | "disco";

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
  | "STYLE_CLOUDS";

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
    id: "STYLE_DISCO",
    payload: "STYLE_DISCO",
    style: "disco",
    label: "🪩 Disco Glow",
    demoThumbnailUrl: getLocalDemoUrl("disco"),
    mockResultUrls: [getLocalDemoUrl("disco")],
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
