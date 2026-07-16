// SSRF-safe file downloader (STR-E13-01).
// Refuses URLs that resolve to private/internal addresses, caps download time
// and size, and never follows redirects (a redirect could bypass the IP check).
//
// KNOWN LIMITATION — DNS TOCTOU (Story 3.3, audit S4): the private-IP check
// resolves the hostname with lookup() below, but the subsequent fetch() call
// re-resolves it independently. A DNS answer that changes between the two
// resolutions (attacker-controlled record with TTL 0: first answer public,
// second answer private) can bypass the check. The standard mitigation is to
// PIN the validated IP for the actual connection — e.g. an undici Agent with a
// custom connect/lookup that only dials the already-vetted address. That is
// deliberately DEFERRED: mcp-core ships with a strict no-runtime-dependencies
// constraint (NFR1) and the bare global fetch exposes no lookup/connect hook
// without adding one. Revisit if the no-deps constraint is ever relaxed or
// Node exposes a native dispatcher hook. Until then the residual risk requires
// an attacker who both supplies the URL and controls its DNS zone.

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export interface SafeDownloadOptions {
  /** Maximum bytes to download before aborting. Default 1 GiB. */
  maxBytes?: number;
  /** Whole-request timeout in ms. Default 60_000 (60s). */
  timeoutMs?: number;
}

const DEFAULT_MAX_BYTES = 1024 ** 3; // 1 GiB
const DEFAULT_TIMEOUT_MS = 60_000; // 60s

// Hostnames that must never be fetched even before DNS resolution.
const BLOCKED_HOSTNAMES = new Set(["localhost", "metadata.google.internal"]);

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split(".").map((p) => Number(p));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return true; // malformed → treat as unsafe
  }
  const [a = 0, b = 0] = parts;
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 127) return true; // loopback 127.0.0.0/8
  if (a === 10) return true; // private 10.0.0.0/8
  if (a === 172 && b >= 16 && b <= 31) return true; // private 172.16.0.0/12
  if (a === 192 && b === 168) return true; // private 192.168.0.0/16
  if (a === 169 && b === 254) return true; // link-local 169.254.0.0/16
  return false;
}

function isPrivateIPv6(ip: string): boolean {
  const addr = ip.toLowerCase();
  if (addr === "::1" || addr === "::") return true; // loopback / unspecified
  if (addr.startsWith("fe80")) return true; // link-local fe80::/10
  if (addr.startsWith("fc") || addr.startsWith("fd")) return true; // ULA fc00::/7
  // IPv4-mapped IPv6 (::ffff:a.b.c.d) — re-check the embedded v4.
  const mapped = addr.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (mapped?.[1]) return isPrivateIPv4(mapped[1]);
  return false;
}

function isPrivateAddress(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) return isPrivateIPv4(ip);
  if (kind === 6) return isPrivateIPv6(ip);
  return true; // not a recognisable IP → unsafe
}

function formatLimit(bytes: number): string {
  const gib = bytes / 1024 ** 3;
  if (Number.isInteger(gib)) return `${gib} GiB`;
  const mib = bytes / 1024 ** 2;
  if (Number.isInteger(mib)) return `${mib} MiB`;
  return `${bytes} bytes`;
}

/**
 * Download a remote file with SSRF and resource guards.
 * @throws Error with an actionable message on any guard failure.
 */
export async function safeDownload(url: string, opts: SafeDownloadOptions = {}): Promise<Buffer> {
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("fileUrl rejected: not a valid URL");
  }

  const allowInsecure = process.env.MCP_ALLOW_INSECURE_FILE_URL === "true";
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && allowInsecure)) {
    throw new Error("fileUrl rejected: only HTTPS URLs are allowed");
  }

  // Strip IPv6 brackets that the URL API keeps on `hostname`.
  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (BLOCKED_HOSTNAMES.has(hostname)) {
    throw new Error("fileUrl rejected: resolves to a private/internal address");
  }

  // Resolve ALL addresses and reject if ANY is private/internal — done before
  // any TCP connection is opened.
  const addresses = await lookup(hostname, { all: true });
  if (addresses.length === 0 || addresses.some((a) => isPrivateAddress(a.address))) {
    throw new Error("fileUrl rejected: resolves to a private/internal address");
  }

  let response: Response;
  try {
    response = await fetch(parsed, {
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "error", // a 30x to an internal IP would bypass the check above
    });
  } catch (err) {
    throw mapFetchError(err, timeoutMs);
  }

  if (!response.ok) {
    throw new Error(`fileUrl download failed (HTTP ${response.status})`);
  }

  // Fast-path reject using content-length, but never trust it as the only guard.
  const contentLength = response.headers.get("content-length");
  if (contentLength !== null) {
    const len = Number(contentLength);
    if (Number.isFinite(len) && len > maxBytes) {
      throw new Error(`fileUrl download exceeded ${formatLimit(maxBytes)} limit`);
    }
  }

  if (!response.body) {
    const buf = Buffer.from(await response.arrayBuffer());
    if (buf.byteLength > maxBytes) {
      throw new Error(`fileUrl download exceeded ${formatLimit(maxBytes)} limit`);
    }
    return buf;
  }

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        total += value.byteLength;
        if (total > maxBytes) {
          await reader.cancel();
          throw new Error(`fileUrl download exceeded ${formatLimit(maxBytes)} limit`);
        }
        chunks.push(Buffer.from(value));
      }
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes("exceeded")) throw err;
    throw mapFetchError(err, timeoutMs);
  }

  return Buffer.concat(chunks);
}

function mapFetchError(err: unknown, timeoutMs: number): Error {
  const name = err instanceof Error ? err.name : "";
  const message = err instanceof Error ? err.message : String(err);
  const cause = err instanceof Error && err.cause instanceof Error ? err.cause.message : "";
  if (name === "TimeoutError" || name === "AbortError") {
    return new Error(`fileUrl download timed out after ${Math.round(timeoutMs / 1000)}s`);
  }
  if (/redirect/i.test(message) || /redirect/i.test(cause)) {
    return new Error("fileUrl rejected: the URL must not redirect");
  }
  return new Error(`fileUrl download failed: ${message}`);
}
