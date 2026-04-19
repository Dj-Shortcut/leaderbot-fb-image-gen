import type express from "express";
import {
  clearFaceMemoryState,
  getOrCreateState,
  rememberFaceSourceImage,
  type MessengerUserState,
} from "./messengerState";
import { forEachStoredState } from "./stateStore";
import { storageDelete, storageKeyFromPublicUrl } from "../storage";

export const FACE_MEMORY_CONSENT_YES = "CONSENT_FACE_YES";
export const FACE_MEMORY_CONSENT_NO = "CONSENT_FACE_NO";
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export function isFaceMemoryEnabled(): boolean {
  return process.env.ENABLE_FACE_MEMORY === "true";
}

async function deleteStoredImageUrl(imageUrl: string | null | undefined): Promise<void> {
  if (!imageUrl) {
    return;
  }

  const key = storageKeyFromPublicUrl(imageUrl);
  if (!key) {
    return;
  }

  try {
    await storageDelete(key);
  } catch (error) {
    console.warn("face_memory_storage_delete_failed", {
      key,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function deleteFaceMemoryForUser(psid: string): Promise<void> {
  const state = await getOrCreateState(psid);
  await deleteStoredImageUrl(state.lastSourceImageUrl ?? state.lastPhotoUrl);
  await clearFaceMemoryState(psid);
}

export async function expireFaceMemory(
  now = Date.now(),
  options: { force?: boolean } = {}
): Promise<number> {
  if (!options.force && !isFaceMemoryEnabled()) {
    return 0;
  }

  const expiredBefore = now - THIRTY_DAYS_MS;
  let deleted = 0;

  await forEachStoredState<Partial<MessengerUserState>>(async (psid, state) => {
    const updatedAt = state.lastSourceImageUpdatedAt;
    if (!updatedAt || updatedAt >= expiredBefore) {
      return;
    }

    await deleteStoredImageUrl(state.lastSourceImageUrl);
    await clearFaceMemoryState(psid, now);
    deleted += 1;
  });

  return deleted;
}

export async function updateConsentedFaceMemorySource(
  psid: string,
  imageUrl: string
): Promise<void> {
  if (!isFaceMemoryEnabled()) {
    return;
  }

  const state = await getOrCreateState(psid);
  if (state.faceMemoryConsent?.given) {
    await deleteStoredImageUrl(state.lastSourceImageUrl);
    await rememberFaceSourceImage(psid, imageUrl);
  }
}

export function registerFaceMemoryAdminRoutes(app: express.Express): void {
  app.post("/admin/disable-face-memory", async (req, res) => {
    const adminToken = process.env.ADMIN_TOKEN;
    const providedToken = req.header("x-admin-token");
    if (!adminToken || providedToken !== adminToken) {
      res.sendStatus(403);
      return;
    }

    const deleted = await expireFaceMemory(Number.POSITIVE_INFINITY, {
      force: true,
    });
    res.status(200).json({ ok: true, deleted });
  });
}

export function scheduleFaceMemoryExpiry(): void {
  const run = () => {
    expireFaceMemory().catch(error => {
      console.warn("face_memory_expiry_failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  };

  run();
  const timer = setInterval(run, 24 * 60 * 60 * 1000);
  timer.unref();
}
