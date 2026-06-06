import { createHash, timingSafeEqual } from "crypto";

/**
 * Constant-time string equality for secret/token comparison.
 *
 * A plain `a === b` short-circuits on the first differing byte, leaking the
 * shared prefix length through timing. We hash both sides to a fixed-length
 * SHA-256 digest first: this both equalizes the buffer length (timingSafeEqual
 * throws on length mismatch and would otherwise leak the secret's length) and
 * keeps the comparison itself constant-time.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  const ah = createHash("sha256").update(a).digest();
  const bh = createHash("sha256").update(b).digest();
  return timingSafeEqual(ah, bh);
}
