"use node";

import { timingSafeEqual } from "node:crypto";

export function assertAdminAccess(received: string) {
  const expected = process.env.LEADS_API_TOKEN;
  if (!expected) {
    throw new Error("Lead access is not configured.");
  }
  const receivedBytes = Buffer.from(received);
  const expectedBytes = Buffer.from(expected);
  if (
    receivedBytes.length !== expectedBytes.length ||
    !timingSafeEqual(receivedBytes, expectedBytes)
  ) {
    throw new Error("Invalid lead access token.");
  }
}
