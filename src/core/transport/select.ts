/**
 * Transport selection (E3-01, AC3): env-based, fail-fast on unknown value.
 */
import { HttpTransport } from "./http.js";
import { StdioTransport } from "./stdio.js";

export type TransportType = "stdio" | "http";

export class UnknownTransportError extends Error {
  constructor(value: string) {
    super(`Unknown MCP_TRANSPORT value: "${value}". Valid options: "stdio" (default) | "http".`);
    this.name = "UnknownTransportError";
  }
}

export function selectTransport(env = process.env.MCP_TRANSPORT): StdioTransport | HttpTransport {
  // Empty means unset, as it does for every other variable in .env.example (Story 20-06,
  // second review). `?? "stdio"` let "" through to the unknown-value branch, so the emitted
  // `MCP_TRANSPORT=` line — or an optional form field left blank — refused to start the server.
  const value = env || "stdio";
  switch (value) {
    case "stdio":
      return new StdioTransport();
    case "http":
      return new HttpTransport();
    default:
      throw new UnknownTransportError(value);
  }
}
