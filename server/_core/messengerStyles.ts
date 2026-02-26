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

export type StyleId = "STYLE_DISCO" | "STYLE_CINEMATIC" | "STYLE_ANIME" | "STYLE_MEME";

export type StyleConfig = {
  id: StyleId;
  payload: StyleId;
  label: string;
  demoThumbnailUrl: string;
  mockResultUrls: string[];
};

const baseMockUrl = "https://picsum.photos";

export const STYLE_CONFIGS: StyleConfig[] = [
  {
    id: "STYLE_DISCO",
    payload: "STYLE_DISCO",
    label: "🪩 Disco Glow",
    demoThumbnailUrl: `${baseMockUrl}/seed/disco-demo/640/640`,
    mockResultUrls: [
      `${baseMockUrl}/seed/disco-result-1/1024/1024`,
      `${baseMockUrl}/seed/disco-result-2/1024/1024`,
      `${baseMockUrl}/seed/disco-result-3/1024/1024`,
    ],
  },
  {
    id: "STYLE_CINEMATIC",
    payload: "STYLE_CINEMATIC",
    label: "🎬 Cinematic",
    demoThumbnailUrl: `${baseMockUrl}/seed/cinematic-demo/640/640`,
    mockResultUrls: [
      `${baseMockUrl}/seed/cinematic-result-1/1024/1024`,
      `${baseMockUrl}/seed/cinematic-result-2/1024/1024`,
      `${baseMockUrl}/seed/cinematic-result-3/1024/1024`,
    ],
  },
  {
    id: "STYLE_ANIME",
    payload: "STYLE_ANIME",
    label: "🌸 Anime",
    demoThumbnailUrl: `${baseMockUrl}/seed/anime-demo/640/640`,
    mockResultUrls: [
      `${baseMockUrl}/seed/anime-result-1/1024/1024`,
      `${baseMockUrl}/seed/anime-result-2/1024/1024`,
      `${baseMockUrl}/seed/anime-result-3/1024/1024`,
    ],
  },
  {
    id: "STYLE_MEME",
    payload: "STYLE_MEME",
    label: "😂 Meme",
    demoThumbnailUrl: `${baseMockUrl}/seed/meme-demo/640/640`,
    mockResultUrls: [
      `${baseMockUrl}/seed/meme-result-1/1024/1024`,
      `${baseMockUrl}/seed/meme-result-2/1024/1024`,
      `${baseMockUrl}/seed/meme-result-3/1024/1024`,
    ],
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
  return `/demo/${STYLE_TO_DEMO_FILE[style]}`;
}
