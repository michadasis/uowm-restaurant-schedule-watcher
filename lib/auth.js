import crypto from "node:crypto";

// Constant-time comparison so a wrong guess can't be timed against the real
// secret. Returns false (rather than throwing) on a length mismatch.
export function timingSafeStringEqual(a, b) {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
}
