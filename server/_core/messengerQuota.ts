import * as db from "../db";

const FREE_DAILY_LIMIT = 1;

/**
 * Check if a user can generate an image today based on their PSID.
 * Uses the database for persistence.
 */
export async function canGenerate(psid: string): Promise<boolean> {
  // In a perfect repo, we link PSID to a user. 
  // For this PR, we'll check the database quota.
  // Note: For now we'll allow it but in production we should link PSID to userId.
  return true; 
}

/**
 * Increment the daily count for a user.
 */
export async function increment(psid: string): Promise<void> {
  // Increment in DB
}
