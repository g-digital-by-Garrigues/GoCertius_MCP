/**
 * SSE Bridge: connects to the upstream GoCertius/EAD SSE events endpoint and
 * maps events to MCP Task state transitions (E7, FR-T-001..004, ADR-06).
 *
 * Endpoint: GET /notifications/sse/{companyId}
 *
 * Reconnect: exponential backoff 1s/2s/4s/8s/16s (max 5 attempts).
 * Fallback: after 5 failed reconnects, all pending tasks receive onFail().
 * Background tool execution serves as a parallel fallback path (NFR-OPS-003).
 *
 * Persistence (STR-E13-02): when persistencePath + filterFactory are provided,
 * pending task registrations survive server restarts. On startup the bridge
 * re-registers entries from disk and logs SSE events even if the task store
 * is no longer available (InMemoryTaskStore does not survive restarts).
 */
import { readFileSync, renameSync, writeFileSync } from "node:fs";

export interface SseEvent {
  type: string;
  data: Record<string, unknown>;
  id?: string;
}

export type TaskEventFilter = (event: SseEvent) => boolean;
export type TerminalMatcher = (event: SseEvent) => "completed" | "failed" | null;

export interface BridgeTaskConfig {
  filter: TaskEventFilter;
  terminal: TerminalMatcher;
  resultExtractor: (event: SseEvent) => unknown;
}

/** Factory called on restart to reconstruct filter/terminal/extractor from persisted metadata. */
export type FilterFactory = (toolName: string, filterKey: string) => BridgeTaskConfig | null;

export interface BridgedTask extends BridgeTaskConfig {
  taskId: string;
  /** Called when the SSE event signals task completion. */
  onComplete: (result: unknown) => Promise<void>;
  /** Called when the SSE event signals task failure. */
  onFail: (error: string) => Promise<void>;
  /** Persistence metadata — required for state file write (STR-E13-02). */
  toolName?: string;
  filterKey?: string;
}

interface PersistedEntry {
  taskId: string;
  toolName: string;
  filterKey: string;
  registeredAt: number;
}

interface BridgeState {
  tasks: PersistedEntry[];
}

const RECONNECT_DELAYS_MS = [1000, 2000, 4000, 8000, 16000];

export class SseBridge {
  private readonly tasks = new Map<string, BridgedTask>();
  private abortController: AbortController | null = null;
  private reconnectAttempts = 0;
  private running = false;
  private _everStarted = false;
  private _streamActive = false;

  /**
   * @param getSseUrl      Returns the SSE endpoint URL, or null if unavailable.
   * @param getAuthToken   Returns a valid JWT for Bearer auth.
   * @param persistencePath  Optional path to JSON state file (STR-E13-02).
   * @param filterFactory    Required when persistencePath is set — reconstructs
   *                         filter config from persisted toolName + filterKey.
   */
  constructor(
    private readonly getSseUrl: () => Promise<string | null>,
    private readonly getAuthToken: () => Promise<string>,
    private readonly persistencePath?: string,
    private readonly filterFactory?: FilterFactory,
  ) {
    if (persistencePath && filterFactory) {
      this.loadAndReregister(filterFactory);
    }
  }

  connectionStatus(): "connected" | "disconnected" | "unused" {
    if (!this._everStarted) return "unused";
    if (this._streamActive) return "connected";
    return "disconnected";
  }

  registerTask(bridged: BridgedTask): void {
    this.tasks.set(bridged.taskId, bridged);
    if (bridged.toolName && bridged.filterKey) {
      this.persistAdd({ taskId: bridged.taskId, toolName: bridged.toolName, filterKey: bridged.filterKey, registeredAt: Date.now() });
    }
    if (!this.running) this.connect();
  }

  deregisterTask(taskId: string): void {
    this.tasks.delete(taskId);
    this.persistRemove(taskId);
  }

  // ── Persistence helpers ──────────────────────────────────────────────────────

  private readState(): BridgeState {
    if (!this.persistencePath) return { tasks: [] };
    try {
      const raw = readFileSync(this.persistencePath, "utf8");
      return JSON.parse(raw) as BridgeState;
    } catch {
      return { tasks: [] };
    }
  }

  private writeState(state: BridgeState): void {
    if (!this.persistencePath) return;
    const tmp = `${this.persistencePath}.tmp`;
    try {
      writeFileSync(tmp, JSON.stringify(state, null, 2), "utf8");
      renameSync(tmp, this.persistencePath);
    } catch {
      // Non-fatal — persistence best-effort
    }
  }

  private persistAdd(entry: PersistedEntry): void {
    const state = this.readState();
    state.tasks = state.tasks.filter((t) => t.taskId !== entry.taskId);
    state.tasks.push(entry);
    this.writeState(state);
  }

  private persistRemove(taskId: string): void {
    const state = this.readState();
    state.tasks = state.tasks.filter((t) => t.taskId !== taskId);
    this.writeState(state);
  }

  private loadAndReregister(factory: FilterFactory): void {
    const state = this.readState();
    for (const entry of state.tasks) {
      const cfg = factory(entry.toolName, entry.filterKey);
      if (!cfg) continue;
      const { taskId, toolName } = entry;
      // Re-register with log-only callbacks — task store is empty after restart.
      this.tasks.set(taskId, {
        taskId,
        toolName,
        filterKey: entry.filterKey,
        ...cfg,
        onComplete: async (result) => {
          console.error(JSON.stringify({ level: 30, msg: `SSE (recovered after restart): task ${taskId} (${toolName}) completed`, result: JSON.stringify(result).slice(0, 300) }));
          this.persistRemove(taskId);
        },
        onFail: async (error) => {
          console.error(JSON.stringify({ level: 40, msg: `SSE (recovered after restart): task ${taskId} (${toolName}) failed — ${error}` }));
          this.persistRemove(taskId);
        },
      });
    }
    if (this.tasks.size > 0) this.connect();
  }

  private async connect(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this._everStarted = true;
    this.reconnectAttempts = 0;

    while (this.running && this.tasks.size > 0) {
      try {
        const url = await this.getSseUrl();
        if (!url) {
          // No SSE URL available — fail all pending tasks immediately
          for (const [, bridged] of this.tasks) {
            await bridged.onFail("SSE bridge: companyId not found in JWT. Task fell back to background execution.");
          }
          this.tasks.clear();
          break;
        }
        await this.stream(url);
        this.reconnectAttempts = 0;
      } catch (err) {
        if (!this.running) break;
        const delay = RECONNECT_DELAYS_MS[this.reconnectAttempts] ?? 16000;
        this.reconnectAttempts++;

        if (this.reconnectAttempts > RECONNECT_DELAYS_MS.length) {
          const msg = err instanceof Error ? err.message : "SSE connection failed permanently";
          for (const [, bridged] of this.tasks) {
            await bridged.onFail(`SSE bridge disconnected after ${RECONNECT_DELAYS_MS.length} retries: ${msg}`);
          }
          this.tasks.clear();
          break;
        }

        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    this.running = false;
  }

  private async stream(url: string): Promise<void> {
    this.abortController = new AbortController();
    this._streamActive = true;
    const token = await this.getAuthToken();

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "text/event-stream",
        "Last-Event-ID": "0",
      },
      signal: this.abortController.signal,
    });

    if (!response.ok) {
      throw new Error(`SSE connection failed: HTTP ${response.status}`);
    }

    if (!response.body) {
      throw new Error("SSE response has no body");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        await this.processLines(lines);

        if (this.tasks.size === 0) {
          this.abortController.abort();
          break;
        }
      }
    } finally {
      this._streamActive = false;
      this.abortController = null;
    }
  }

  private pendingEvent: Partial<SseEvent> = {};

  private async processLines(lines: string[]): Promise<void> {
    for (const line of lines) {
      if (line.startsWith("data:")) {
        const raw = line.slice(5).trim();
        try {
          this.pendingEvent.data = JSON.parse(raw) as Record<string, unknown>;
        } catch {
          // Non-JSON SSE data — ignore
        }
      } else if (line.startsWith("event:")) {
        this.pendingEvent.type = line.slice(6).trim();
      } else if (line.startsWith("id:")) {
        this.pendingEvent.id = line.slice(3).trim();
      } else if (line === "" && this.pendingEvent.data) {
        await this.dispatchEvent(this.pendingEvent as SseEvent);
        this.pendingEvent = {};
      }
    }
  }

  private async dispatchEvent(event: SseEvent): Promise<void> {
    for (const [taskId, bridged] of this.tasks) {
      if (!bridged.filter(event)) continue;

      const terminal = bridged.terminal(event);
      if (terminal === "completed") {
        this.deregisterTask(taskId);
        await bridged.onComplete(bridged.resultExtractor(event));
      } else if (terminal === "failed") {
        this.deregisterTask(taskId);
        const errMsg =
          typeof event.data.error === "string" ? event.data.error : "Upstream reported failure";
        await bridged.onFail(errMsg);
      }
    }
  }

  stop(): void {
    this.running = false;
    this.abortController?.abort();
  }
}

// ── Per-tool SSE filter + terminal factories ─────────────────────────────────

/** Filter for evidence_seal (CloseEvidenceGroupController) */
export function evidenceSealFilter(evidenceGroupId: string): TaskEventFilter {
  return (event) =>
    typeof event.data.evidenceGroupId === "string" &&
    event.data.evidenceGroupId === evidenceGroupId;
}

export function evidenceSealTerminal(event: SseEvent): "completed" | "failed" | null {
  const status = event.data.status;
  if (status === "sealed" || status === "SEALED" || event.type === "EVIDENCE_GROUP_SEALED") {
    return "completed";
  }
  if (status === "failed" || status === "FAILED" || event.type === "EVIDENCE_GROUP_FAILED") {
    return "failed";
  }
  return null;
}

/** Filter for notification_request_create / notification_request_send */
export function notificationFilter(notificationRequestId: string): TaskEventFilter {
  return (event) =>
    (typeof event.data.notificationRequestId === "string" &&
      event.data.notificationRequestId === notificationRequestId) ||
    (typeof event.data.id === "string" && event.data.id === notificationRequestId);
}

export function notificationTerminal(event: SseEvent): "completed" | "failed" | null {
  const status = event.data.status;
  if (status === "DELIVERED" || event.type === "NOTIFICATION_DELIVERED") return "completed";
  if (status === "FAILED" || event.type === "NOTIFICATION_FAILED") return "failed";
  return null;
}

/** Filter for signature_request_create */
export function signatureRequestFilter(requestId: string): TaskEventFilter {
  return (event) =>
    (typeof event.data.signatureRequestId === "string" &&
      event.data.signatureRequestId === requestId) ||
    (typeof event.data.id === "string" && event.data.id === requestId);
}

export function signatureRequestTerminal(event: SseEvent): "completed" | "failed" | null {
  const status = event.data.status;
  if (
    status === "SIGNED" ||
    status === "CLOSED" ||
    event.type === "SIGNATURE_REQUEST_SIGNED" ||
    event.type === "SIGNATURE_REQUEST_CLOSED"
  ) {
    return "completed";
  }
  if (
    status === "CANCELLED" ||
    status === "FAILED" ||
    event.type === "SIGNATURE_REQUEST_CANCELLED" ||
    event.type === "SIGNATURE_REQUEST_FAILED"
  ) {
    return "failed";
  }
  return null;
}

/**
 * Extract companyId from a JWT payload.
 * Tries common field names used by GoCertius/EAD identity tokens.
 */
export function extractCompanyIdFromJwt(jwt: string): string | null {
  try {
    const b64 = jwt.split(".")[1];
    if (!b64) return null;
    const payload = JSON.parse(Buffer.from(b64, "base64").toString()) as Record<string, unknown>;
    // Try common field names in order of likelihood
    const candidates = ["companyId", "company_id", "cid", "tenantId", "tenant_id", "tid", "oid"];
    for (const key of candidates) {
      if (typeof payload[key] === "string" && payload[key]) {
        return payload[key] as string;
      }
    }
    // Try nested company object
    const company = payload.company;
    if (company && typeof company === "object" && "id" in company && typeof (company as Record<string, unknown>).id === "string") {
      return (company as Record<string, unknown>).id as string;
    }
    return null;
  } catch {
    return null;
  }
}
