import { getStyleById, type StyleId } from "./messengerStyles";

export function getMockGeneratedImage(styleId: StyleId, cursor = 0): { imageUrl: string; nextCursor: number } {
  const style = getStyleById(styleId);
  const index = cursor % style.mockResultUrls.length;

  return {
    imageUrl: style.mockResultUrls[index],
    nextCursor: cursor + 1,
  };
}

// Future integration point:
// Replace getMockGeneratedImage with OpenAI/real generation logic and keep the webhook UX unchanged.
