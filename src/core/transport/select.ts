/**
 * Transport selection (E3-01, AC3): env-based, fail-fast on unknown value.
 */
import { HonoTransport } from "./http.js";
import { StdioTransport } from "./stdio.js";

export type TransportType = "stdio" | "http";

export class UnknownTransportError extends Error {
  constructor(value: string) {
    super(`Unknown MCP_TRANSPORT value: "${value}". Valid options: "stdio" (default) | "http".`);
    this.name = "UnknownTransportError";
  }
}

export function selectTransport(
  env = process.env.MCP_TRANSPORT ?? "stdio",
): StdioTransport | HonoTransport {
  switch (env) {
    case "stdio":
      return new StdioTransport();
    case "http":
      return new HonoTransport();
    default:
      throw new UnknownTransportError(env);
  }
}
