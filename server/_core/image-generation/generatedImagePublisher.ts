import { randomUUID } from "node:crypto";
import type { Style } from "../messengerStyles";
import { storagePut } from "../../storage";
import {
  buildGeneratedImageUrl,
  putGeneratedImage,
} from "../generatedImageStore";
import {
  getRequiredPublicBaseUrl,
  hasObjectStorageConfig,
  isProductionRuntime,
} from "./imageServiceConfig";
import { MissingObjectStorageConfigError } from "./imageServiceErrors";

export async function publishGeneratedImage(
  jpegBuffer: Buffer,
  style: Style,
  reqId?: string
): Promise<string> {
  if (hasObjectStorageConfig()) {
    const key = `generated/${style}/${Date.now()}-${randomUUID()}.jpg`;
    try {
      const { url } = await storagePut(key, jpegBuffer, "image/jpeg");
      console.info(
        JSON.stringify({
          level: "info",
          msg: "generated_image_upload_success",
          reqId,
          style,
          storageKey: key,
          publicUrl: url,
        })
      );
      return url;
    } catch (error) {
      console.error("GENERATED_IMAGE_UPLOAD_FAILED", {
        reqId,
        style,
        storageKey: key,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  if (isProductionRuntime()) {
    throw new MissingObjectStorageConfigError(
      "BUILT_IN_FORGE_API_URL and BUILT_IN_FORGE_API_KEY are required in production for durable generated image storage"
    );
  }

  const token = putGeneratedImage(jpegBuffer, "image/jpeg");
  const publicBaseUrl = getRequiredPublicBaseUrl();
  const localUrl = buildGeneratedImageUrl(publicBaseUrl, token);
  console.warn("GENERATED_IMAGE_LOCAL_FALLBACK", {
    reqId,
    style,
    token,
    publicUrl: localUrl,
  });
  return localUrl;
}
