/**
 * Stdio transport adapter (E3-01, FR-E-001, FR-E-004).
 * Wraps SDK's StdioServerTransport. All logging goes to stderr.
 * No stdout writes outside JSON-RPC frames (AC4).
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

export { StdioServerTransport };

/** Thin wrapper for naming consistency */
export class StdioTransport extends StdioServerTransport {}
