/**
 * Unified hardened file ingestion (Story 3.x, ADR-A3 / P-A3, FR-17..23).
 *
 * One `FileInput` discriminated union + one `FileResolver` used by every file-ingesting
 * tool, so SSRF / path-traversal / resource-exhaustion guards live in exactly one place.
 * Tools call `await ctx.files.resolve(input.file)` and NEVER read the filesystem or fetch
 * URLs directly. Size cap is enforced before full buffering; SHA-256 is always computed
 * server-side (hex + base64 for the presigned-PUT `x-amz-checksum-sha256`).
 *
 * Sources: path (Story 3.1) · base64 (3.2) · url (3.3, via safeDownload) · n8n-binary (3.4).
 */
import { createHash } from "node:crypto";
import { lstat, readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, basename as pathBasename, resolve as pathResolve, sep } from "node:path";
import { z } from "zod";
import type { McpErrorContent } from "../errors/index.js";
import { safeDownload } from "../safe-fetch.js";

/** Shared file-input contract (P-A3). One instance reused by every tool field. */
export const FileInput = z
  .discriminatedUnion("source", [
    z.object({
      source: z.literal("path"),
      path: z.string().describe("Absolute local path to the file (stdio/local mode only)."),
    }),
    z.object({
      source: z.literal("base64"),
      filename: z.string().describe("File name including extension."),
      contentBase64: z.string().describe("Base64-encoded file content."),
    }),
    z.object({
      source: z.literal("url"),
      url: z.string().url().describe("HTTPS URL to fetch the file from (SSRF-guarded)."),
    }),
    z.object({
      source: z.literal("n8n-binary"),
      binaryRef: z.string().describe("Reference to an n8n binary item from a prior node."),
    }),
  ])
  .describe("File to ingest. One of: local path | base64 | https URL | n8n binary item.");

export type FileInput = z.infer<typeof FileInput>;

/**
 * True when a schema is the shared `FileInput` contract (optionally `.optional()`-wrapped).
 * Lets the n8n adapter detect a file field and map it to a binary-property/URL once,
 * generically — without per-tool glue (FR-23). Tools must use the shared instance directly.
 */
export function isFileInputSchema(schema: unknown): boolean {
  if (schema === FileInput) return true;
  const inner = (schema as { unwrap?: () => unknown } | null)?.unwrap?.();
  return inner === FileInput;
}

/** Result of resolving a FileInput — bytes + server-side integrity + metadata. */
export interface ResolvedFile {
  bytes: Buffer;
  /** Server-side SHA-256, hex. */
  sha256: string;
  /** Server-side SHA-256, base64 (for `x-amz-checksum-sha256`). */
  sha256Base64: string;
  size: number;
  contentType: string;
  filename: string;
}

export const DEFAULT_FILE_MAX_BYTES = 1024 ** 3; // 1 GiB — matches safeDownload / evidence_upload
const DEFAULT_CONTENT_TYPE = "application/octet-stream";

/**
 * Structured file-ingestion failure (Story 3.5 formalizes the surface; introduced here so
 * every source throws the same shape from the start).
 */
export class FileIngestionError extends Error {
  constructor(
    /** Which source failed. */
    public readonly source: FileInput["source"],
    /** The constraint that was violated. */
    public readonly reason: string,
    /** How the caller can correct it. */
    public readonly remediation: string,
  ) {
    super(`File ingestion failed (${source}): ${reason}. ${remediation}`);
    this.name = "FileIngestionError";
  }

  /** Render as a suite MCP error — distinct from upstream/network errors (Story 3.5). */
  toMcpError(): McpErrorContent {
    return { isError: true, content: [{ type: "text", text: this.message }] };
  }
}

/** True when an error is a structured file-ingestion failure (Story 3.5). */
export function isFileIngestionError(err: unknown): err is FileIngestionError {
  return err instanceof FileIngestionError;
}

export interface FileResolverConfig {
  maxBytes: number;
  /** Absolute, resolved roots; when non-empty a `path` must resolve under one of them. */
  allowedRoots: string[];
  transportMode: "http" | "stdio";
  /** Optional host allowlist for the `url` source; when non-empty, only these hosts are fetched. */
  urlAllowedHosts?: string[];
  /**
   * Resolves an n8n binary item reference to its bytes — injected by the generated n8n node,
   * which is the only context that can dereference a `binaryRef`. Absent in the plain MCP server.
   */
  n8nBinaryResolver?: (
    binaryRef: string,
  ) => Promise<{ bytes: Buffer; contentType?: string; filename?: string }>;
}

function sha256Of(bytes: Buffer): { hex: string; base64: string } {
  return {
    hex: createHash("sha256").update(bytes).digest("hex"),
    base64: createHash("sha256").update(bytes).digest("base64"),
  };
}

function isUnder(child: string, root: string): boolean {
  const normChild = child.endsWith(sep) ? child : child + sep;
  const normRoot = root.endsWith(sep) ? root : root + sep;
  return normChild === normRoot || normChild.startsWith(normRoot);
}

export class FileResolver {
  constructor(private readonly config: FileResolverConfig) {}

  async resolve(input: FileInput): Promise<ResolvedFile> {
    switch (input.source) {
      case "path":
        return this.resolvePath(input.path);
      case "base64":
        return this.resolveBase64(input.filename, input.contentBase64);
      case "url":
        return this.resolveUrl(input.url);
      case "n8n-binary":
        return this.resolveN8nBinary(input.binaryRef);
    }
  }

  private async resolveN8nBinary(binaryRef: string): Promise<ResolvedFile> {
    const resolver = this.config.n8nBinaryResolver;
    if (!resolver) {
      throw new FileIngestionError(
        "n8n-binary",
        "the n8n binary source is only available inside the n8n node",
        "Use source 'base64' or 'url' outside n8n.",
      );
    }
    const { bytes, contentType, filename } = await resolver(binaryRef);
    if (bytes.byteLength > this.config.maxBytes) {
      throw new FileIngestionError(
        "n8n-binary",
        `binary content exceeds the ${this.config.maxBytes}-byte limit`,
        "Reduce the file size or raise MCP_FILE_MAX_BYTES.",
      );
    }
    const { hex, base64 } = sha256Of(bytes);
    return {
      bytes,
      sha256: hex,
      sha256Base64: base64,
      size: bytes.byteLength,
      contentType: contentType ?? DEFAULT_CONTENT_TYPE,
      filename: filename ?? "binary",
    };
  }

  private async resolvePath(rawPath: string): Promise<ResolvedFile> {
    if (this.config.transportMode === "http") {
      throw new FileIngestionError(
        "path",
        "local paths are not readable in HTTP (multi-user) mode",
        "Use source 'base64' or 'url' instead.",
      );
    }
    if (!isAbsolute(rawPath)) {
      throw new FileIngestionError(
        "path",
        "path must be absolute",
        "Provide an absolute filesystem path.",
      );
    }
    // Reject `..` traversal segments before touching the filesystem.
    if (rawPath.split(/[/\\]/).includes("..")) {
      throw new FileIngestionError(
        "path",
        "path must not contain '..' segments",
        "Provide a direct absolute path without parent-directory traversal.",
      );
    }

    const resolved = pathResolve(rawPath);

    // Reject symlinks (the link itself) — a symlink could escape the allow-list.
    let linkInfo: Awaited<ReturnType<typeof lstat>>;
    try {
      linkInfo = await lstat(resolved);
    } catch {
      throw new FileIngestionError("path", "file does not exist", "Check the path and retry.");
    }
    if (linkInfo.isSymbolicLink()) {
      throw new FileIngestionError(
        "path",
        "symlinks are not allowed",
        "Provide a direct path to a regular file.",
      );
    }

    // Resolve the real path and enforce the allow-list (when configured).
    // Roots are realpath'd too so a symlinked root (e.g. macOS /var → /private/var) still matches.
    const real = await realpath(resolved);
    if (this.config.allowedRoots.length > 0) {
      const realRoots = await Promise.all(
        this.config.allowedRoots.map((root) => realpath(root).catch(() => root)),
      );
      const allowed = realRoots.some((root) => isUnder(real, root));
      if (!allowed) {
        throw new FileIngestionError(
          "path",
          "path is outside the allowed roots",
          "Place the file under an MCP_FILE_ALLOWED_ROOTS directory, or pass it as base64/url.",
        );
      }
    }

    // Size cap BEFORE reading into memory.
    const info = await stat(real);
    if (!info.isFile()) {
      throw new FileIngestionError("path", "not a regular file", "Provide a path to a file.");
    }
    if (info.size > this.config.maxBytes) {
      throw new FileIngestionError(
        "path",
        `file exceeds the ${this.config.maxBytes}-byte limit`,
        "Reduce the file size or raise MCP_FILE_MAX_BYTES.",
      );
    }

    const bytes = await readFile(real);
    const { hex, base64 } = sha256Of(bytes);
    return {
      bytes,
      sha256: hex,
      sha256Base64: base64,
      size: bytes.byteLength,
      contentType: DEFAULT_CONTENT_TYPE,
      filename: pathBasename(real),
    };
  }

  private resolveBase64(filename: string, contentBase64: string): ResolvedFile {
    const clean = contentBase64.replace(/\s+/g, "");

    // Estimate decoded size from the encoded length and reject BEFORE decoding (FR-20).
    const padding = clean.endsWith("==") ? 2 : clean.endsWith("=") ? 1 : 0;
    const estimatedBytes = Math.floor(clean.length / 4) * 3 - padding;
    if (estimatedBytes > this.config.maxBytes) {
      throw new FileIngestionError(
        "base64",
        `decoded content exceeds the ${this.config.maxBytes}-byte limit`,
        "Reduce the file size, raise MCP_FILE_MAX_BYTES, or use source 'url'.",
      );
    }

    // Strict validation — Buffer.from is lenient and silently drops invalid chars.
    if (clean.length === 0 || clean.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(clean)) {
      throw new FileIngestionError(
        "base64",
        "contentBase64 is not valid base64",
        "Provide standard base64-encoded content.",
      );
    }

    const bytes = Buffer.from(clean, "base64");
    if (bytes.byteLength > this.config.maxBytes) {
      throw new FileIngestionError(
        "base64",
        `decoded content exceeds the ${this.config.maxBytes}-byte limit`,
        "Reduce the file size, raise MCP_FILE_MAX_BYTES, or use source 'url'.",
      );
    }

    const safeName = sanitizeFilename(filename);
    if (!safeName) {
      throw new FileIngestionError(
        "base64",
        "filename is empty after sanitization",
        "Provide a valid file name including its extension.",
      );
    }

    const { hex, base64 } = sha256Of(bytes);
    return {
      bytes,
      sha256: hex,
      sha256Base64: base64,
      size: bytes.byteLength,
      contentType: DEFAULT_CONTENT_TYPE,
      filename: safeName,
    };
  }

  private async resolveUrl(url: string): Promise<ResolvedFile> {
    // Optional host allowlist — checked before any network call (AC3).
    const allow = this.config.urlAllowedHosts;
    if (allow && allow.length > 0) {
      let host: string;
      try {
        host = new URL(url).hostname.toLowerCase();
      } catch {
        throw new FileIngestionError("url", "not a valid URL", "Provide a valid HTTPS URL.");
      }
      if (!allow.includes(host)) {
        throw new FileIngestionError(
          "url",
          `host '${host}' is not in MCP_FILE_URL_ALLOWED_HOSTS`,
          "Use a permitted host, or pass the file as base64.",
        );
      }
    }

    let bytes: Buffer;
    try {
      // safeDownload enforces HTTPS-only, DNS private-range block, no-redirect, timeout, streamed cap.
      bytes = await safeDownload(url, { maxBytes: this.config.maxBytes });
    } catch (err) {
      throw new FileIngestionError(
        "url",
        err instanceof Error ? err.message : String(err),
        "Ensure the URL is a public HTTPS resource that does not redirect and is within the size limit.",
      );
    }

    const { hex, base64 } = sha256Of(bytes);
    return {
      bytes,
      sha256: hex,
      sha256Base64: base64,
      size: bytes.byteLength,
      contentType: DEFAULT_CONTENT_TYPE,
      filename: filenameFromUrl(url),
    };
  }
}

/** Derive a filename from a URL path; fall back to "download" when there is no basename. */
function filenameFromUrl(url: string): string {
  try {
    const name = pathBasename(new URL(url).pathname);
    return name && name !== "/" ? name : "download";
  } catch {
    return "download";
  }
}

/** Reduce a caller-supplied filename to a safe basename: no path parts, no control chars. */
function sanitizeFilename(name: string): string {
  const base = pathBasename(name.replace(/\\/g, "/"));
  // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping control chars is the intent
  return base.replace(/[\x00-\x1f\x7f]/g, "").trim();
}

function parseAllowedRoots(csv: string | undefined): string[] {
  return (csv ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((p) => pathResolve(p));
}

function parseHostList(csv: string | undefined): string[] {
  return (csv ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Build a FileResolver from env: MCP_FILE_MAX_BYTES, MCP_FILE_ALLOWED_ROOTS,
 * MCP_FILE_URL_ALLOWED_HOSTS.
 */
export function createFileResolver(opts: {
  transportMode: "http" | "stdio";
  env?: NodeJS.ProcessEnv;
}): FileResolver {
  const env = opts.env ?? process.env;
  const parsedMax = Number(env.MCP_FILE_MAX_BYTES);
  const maxBytes = Number.isFinite(parsedMax) && parsedMax > 0 ? parsedMax : DEFAULT_FILE_MAX_BYTES;
  return new FileResolver({
    maxBytes,
    allowedRoots: parseAllowedRoots(env.MCP_FILE_ALLOWED_ROOTS),
    transportMode: opts.transportMode,
    urlAllowedHosts: parseHostList(env.MCP_FILE_URL_ALLOWED_HOSTS),
  });
}
