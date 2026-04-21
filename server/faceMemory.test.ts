import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { storageDeleteMock } = vi.hoisted(() => ({
  storageDeleteMock: vi.fn(async () => undefined),
}));

vi.mock("./storage", () => ({
  storageDelete: storageDeleteMock,
  storageKeyFromPublicUrl: (publicUrl: string) => {
    try {
      return new URL(publicUrl).pathname.replace(/^\/+/, "") || null;
    } catch {
      return null;
    }
  },
}));

import { deleteFaceMemoryForUser } from "./_core/faceMemory";
import {
  getState,
  rememberFaceSourceImage,
  resetStateStore,
  setPendingStoredImage,
} from "./_core/messengerState";

describe("face memory deletion", () => {
  const originalPrivacyPepper = process.env.PRIVACY_PEPPER;

  beforeEach(() => {
    process.env.PRIVACY_PEPPER = "ci-test-pepper";
    resetStateStore();
    storageDeleteMock.mockClear();
  });

  afterEach(() => {
    resetStateStore();
    if (originalPrivacyPepper === undefined) {
      delete process.env.PRIVACY_PEPPER;
    } else {
      process.env.PRIVACY_PEPPER = originalPrivacyPepper;
    }
  });

  it("deletes active retained face-memory source data", async () => {
    const sourceUrl = "https://assets.example/generated/face-source.jpg";
    await rememberFaceSourceImage("user-1", sourceUrl, Date.now());

    await deleteFaceMemoryForUser("user-1");

    const state = await getState("user-1");
    expect(storageDeleteMock).toHaveBeenCalledWith("generated/face-source.jpg");
    expect(state?.faceMemoryConsent).toBeNull();
    expect(state?.lastSourceImageUrl).toBeNull();
    expect(state?.lastSourceImageUpdatedAt).toBeNull();
    expect(state?.lastPhotoUrl).toBeNull();
    expect(state?.pendingSourceImageDeleteUrl).toBeNull();
  });

  it("does not delete unrelated photo state when no face-memory source is active", async () => {
    const sessionPhotoUrl = "https://assets.example/generated/session-photo.jpg";
    await setPendingStoredImage("user-2", sessionPhotoUrl, Date.now());

    await deleteFaceMemoryForUser("user-2");

    const state = await getState("user-2");
    expect(storageDeleteMock).not.toHaveBeenCalled();
    expect(state?.faceMemoryConsent).toBeNull();
    expect(state?.lastSourceImageUrl).toBeNull();
    expect(state?.lastSourceImageUpdatedAt).toBeNull();
    expect(state?.pendingSourceImageDeleteUrl).toBeNull();
  });

  it("records a pending delete marker when retained source deletion fails", async () => {
    const sourceUrl = "https://assets.example/generated/face-source-fail.jpg";
    storageDeleteMock.mockRejectedValueOnce(new Error("storage unavailable"));
    await rememberFaceSourceImage("user-3", sourceUrl, Date.now());

    await deleteFaceMemoryForUser("user-3");

    const state = await getState("user-3");
    expect(storageDeleteMock).toHaveBeenCalledWith("generated/face-source-fail.jpg");
    expect(state?.faceMemoryConsent).toBeNull();
    expect(state?.lastSourceImageUrl).toBeNull();
    expect(state?.lastSourceImageUpdatedAt).toBeNull();
    expect(state?.lastPhotoUrl).toBeNull();
    expect(state?.pendingSourceImageDeleteUrl).toBe(sourceUrl);
  });
});
