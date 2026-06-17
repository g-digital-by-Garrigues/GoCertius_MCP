/**
 * Transport port interface (E3-01, FR-E-001, FR-E-002, ADR-02).
 * Abstracts stdio and HTTP transports behind a common interface.
 * Transport is selected at startup via MCP_TRANSPORT env var.
 */

export { HttpTransport } from "./http.js";
export { selectTransport } from "./select.js";
export { StdioTransport } from "./stdio.js";
