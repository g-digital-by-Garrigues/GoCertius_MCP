/**
 * Idempotency LRU with per-tool windows (E3-06, FR-E-008, NFR-R-004).
 *
 * - Default 60s window for sync tools.
 * - Tools can declare idempotencyWindowSeconds: 86400 for 24h (pollable).
 * - LRU bounded at MAX_ENTRIES entries.
 * - Idempotency key auto-generated from (toolName, normalizedInput).
 * - Replay within window returns cached result without calling upstream.
 */

import { createHash } from "node:crypto";
import { LRUCache } from "lru-cache";

export const DEFAULT_WINDOW_SECONDS = 60;
export const MAX_ENTRIES = 10_000;

interface CacheEntry<T> {
  result: T;
  expiresAt: number;
}

export class IdempotencyCache<T = unknown> {
  private readonly lru: LRUCache<string, CacheEntry<T>>;

  constructor(maxEntries = MAX_ENTRIES) {
    this.lru = new LRUCache({ max: maxEntries });
  }

  /** AC3: Compute idempotency key from tool name + normalized input */
  static computeKey(toolName: string, input: unknown): string {
    const normalized = JSON.stringify(input, Object.keys(input as object).sort());
    return createHash("sha256").update(`${toolName}:${normalized}`).digest("hex").slice(0, 32);
  }

  /** AC4: Return cached result if still within window */
  get(toolName: string, key: string): T | undefined {
    const cacheKey = `${toolName}:${key}`;
    const entry = this.lru.get(cacheKey);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.lru.delete(cacheKey);
      return undefined;
    }
    return entry.result;
  }

  /** Store result with window-specific TTL */
  set(toolName: string, key: string, result: T, windowSeconds = DEFAULT_WINDOW_SECONDS): void {
    const cacheKey = `${toolName}:${key}`;
    this.lru.set(cacheKey, {
      result,
      expiresAt: Date.now() + windowSeconds * 1000,
    });
  }

  get size(): number {
    return this.lru.size;
  }
}

/**
 * ADR-A4-shaped idempotency key: `<pkg>/<version>/<tool>/<sha256(input)>`.
 * Exposed to tools via ToolContext.getIdempotencyKey() (Story 4.5) — distinct from the
 * internal LRU cache key above (IdempotencyCache.computeKey), which stays unchanged for
 * cache-dedup correctness. This is a full (untruncated) sha256 hex digest, matching the
 * ADR's documented format literally.
 */
export function buildIdempotencyKeyHeader(
  pkg: string,
  version: string,
  toolName: string,
  input: unknown,
): string {
  const normalized = JSON.stringify(input, Object.keys(input as object).sort());
  const hash = createHash("sha256").update(normalized).digest("hex");
  return `${pkg}/${version}/${toolName}/${hash}`;
}

export const idempotencyCache = new IdempotencyCache();
