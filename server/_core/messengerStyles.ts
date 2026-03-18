export type Style =
  | "caricature"
  | "gold"
  | "petals"
  | "clouds"
  | "cinematic"
  | "disco"
  | "cyberpunk"
  | "oil-paint"
  | "norman-blackwell";

export type StyleId =
  | "STYLE_CARICATURE"
  | "STYLE_PETALS"
  | "STYLE_GOLD"
  | "STYLE_CINEMATIC"
  | "STYLE_OIL_PAINT"
  | "STYLE_DISCO"
  | "STYLE_CLOUDS"
  | "STYLE_CYBERPUNK"
  | "STYLE_NORMAN_BLACKWELL"
  | "gold";

export type StyleConfig = {
  id: StyleId;
  payload: StyleId;
  style: Style;
  label: string;
};

export const STYLE_CONFIGS: StyleConfig[] = [
  {
    id: "STYLE_CARICATURE",
    payload: "STYLE_CARICATURE",
    style: "caricature",
    label: "🎨 Caricature",
  },
  {
    id: "STYLE_PETALS",
    payload: "STYLE_PETALS",
    style: "petals",
    label: "🌸 Petals",
  },
  {
    id: "STYLE_GOLD",
    payload: "STYLE_GOLD",
    style: "gold",
    label: "✨ Gold",
  },
  {
    id: "STYLE_CINEMATIC",
    payload: "STYLE_CINEMATIC",
    style: "cinematic",
    label: "🎬 Cinematic",
  },
  {
    id: "STYLE_OIL_PAINT",
    payload: "STYLE_OIL_PAINT",
    style: "oil-paint",
    label: "🖼️ Oil Paint",
  },
  {
    id: "STYLE_CYBERPUNK",
    payload: "STYLE_CYBERPUNK",
    style: "cyberpunk",
    label: "🌃 Cyberpunk",
  },
  {
    id: "STYLE_NORMAN_BLACKWELL",
    payload: "STYLE_NORMAN_BLACKWELL",
    style: "norman-blackwell",
    label: "📰 Norman Blackwell",
  },
  {
    id: "STYLE_DISCO",
    payload: "STYLE_DISCO",
    style: "disco",
    label: "🪩 Disco Glow",
  },
  {
    id: "STYLE_CLOUDS",
    payload: "STYLE_CLOUDS",
    style: "clouds",
    label: "☁️ Clouds",
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
