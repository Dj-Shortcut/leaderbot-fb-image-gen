import { STYLE_TO_DEMO_FILE, type Style } from "./messengerStyles";

export interface ImageGenerator {
  generate(input: {
    style: Style;
    sourceImageUrl?: string;
    psid: string;
  }): Promise<{ imageUrl: string }>;
}

function getBaseUrl(): string {
  const configuredBaseUrl = process.env.APP_BASE_URL?.trim() ?? process.env.BASE_URL?.trim();

  if (configuredBaseUrl && /^https?:\/\//.test(configuredBaseUrl)) {
    return configuredBaseUrl;
  }

  return "http://localhost:3000";
}

function getMockImageForStyle(style: Style): string {
  const filename = STYLE_TO_DEMO_FILE[style];
  return `${getBaseUrl()}/demo/${filename}`;
}

class MockImageGenerator implements ImageGenerator {
  async generate(input: { style: Style; sourceImageUrl?: string; psid: string }): Promise<{ imageUrl: string }> {
    return {
      imageUrl: getMockImageForStyle(input.style),
    };
  }
}

export function createImageGenerator(): ImageGenerator {
  return new MockImageGenerator();
}
