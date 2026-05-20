/**
 * SSE Bridge: connects to upstream GoCertius SSE events endpoint and
 * maps events to MCP task state transitions (E7, FR-T-001..004, ADR-06).
 *
 * Endpoint: GET /notifications/sse/{companyId}
 * Events drive InMemoryTaskStore updates for pollable tools.
 *
 * Reconnect: exponential backoff 1s/2s/4s/8s/16s (max 5 attempts).
 * Fallback: polling via tasks/get if SSE fails permanently (NFR-OPS-003).
 */

import type { InMemoryTaskStore } from "./index.js";

export interface SseEvent {
  type: string;
  data: Record<string, unknown>;
  id?: string;
}

export type TaskEventFilter = (event: SseEvent) => boolean;
export type TerminalMatcher = (event: SseEvent) => "completed" | "failed" | null;

export interface BridgedTask {
  taskId: string;
  filter: TaskEventFilter;
  terminal: TerminalMatcher;
  resultExtractor: (event: SseEvent) => unknown;
}

const RECONNECT_DELAYS_MS = [1000, 2000, 4000, 8000, 16000];

export class SseBridge {
  private readonly tasks = new Map<string, BridgedTask>();
  private abortController: AbortController | null = null;
  private reconnectAttempts = 0;
  private running = false;

  constructor(
    private readonly sseUrl: string,
    private readonly store: InMemoryTaskStore,
    private readonly getAuthToken: () => Promise<string>,
  ) {}

  /**
   * Register a task to be updated by SSE events.
   * The task runs until the terminal matcher returns a status.
   */
  registerTask(bridged: BridgedTask): void {
    this.tasks.set(bridged.taskId, bridged);
    if (!this.running) this.connect();
  }

  private async connect(): Promise<void> {
    if (this.running) return;
    this.running = true;

    while (this.running && this.tasks.size > 0) {
      try {
        await this.stream();
        this.reconnectAttempts = 0;
      } catch (err) {
        if (!this.running) break;
        const delay = RECONNECT_DELAYS_MS[this.reconnectAttempts] ?? 16000;
        this.reconnectAttempts++;

        if (this.reconnectAttempts > RECONNECT_DELAYS_MS.length) {
          // Max attempts reached — fail all pending tasks (NFR-OPS-003 degraded mode)
          for (const [taskId] of this.tasks) {
            const msg = err instanceof Error ? err.message : "SSE connection failed permanently";
            this.store.fail(
              taskId,
              `SSE bridge disconnected: ${msg}. Use tasks/get to poll status.`,
            );
          }
          this.tasks.clear();
          break;
        }

        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    this.running = false;
  }

  private async stream(): Promise<void> {
    this.abortController = new AbortController();
    const token = await this.getAuthToken();

    const response = await fetch(this.sseUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "text/event-stream",
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

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      this.processLines(lines);

      // Stop if no more tasks to track
      if (this.tasks.size === 0) {
        this.abortController.abort();
        break;
      }
    }
  }

  private pendingEvent: Partial<SseEvent> = {};

  private processLines(lines: string[]): void {
    for (const line of lines) {
      if (line.startsWith("data:")) {
        const raw = line.slice(5).trim();
        try {
          this.pendingEvent.data = JSON.parse(raw) as Record<string, unknown>;
        } catch {
          // Ignore non-JSON SSE data
        }
      } else if (line.startsWith("event:")) {
        this.pendingEvent.type = line.slice(6).trim();
      } else if (line.startsWith("id:")) {
        this.pendingEvent.id = line.slice(3).trim();
      } else if (line === "" && this.pendingEvent.data) {
        // Dispatch the complete event
        this.dispatchEvent(this.pendingEvent as SseEvent);
        this.pendingEvent = {};
      }
    }
  }

  private dispatchEvent(event: SseEvent): void {
    for (const [taskId, bridged] of this.tasks) {
      if (!bridged.filter(event)) continue;

      const terminal = bridged.terminal(event);
      if (terminal === "completed") {
        this.store.complete(taskId, bridged.resultExtractor(event));
        this.tasks.delete(taskId);
      } else if (terminal === "failed") {
        const errMsg =
          typeof event.data.error === "string" ? event.data.error : "Upstream reported failure";
        this.store.fail(taskId, errMsg);
        this.tasks.delete(taskId);
      }
    }
  }

  stop(): void {
    this.running = false;
    this.abortController?.abort();
  }
}

/**
 * Create a task filter for evidence_seal operations.
 * Matches SSE events where the evidenceGroupId matches.
 */
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

/**
 * Create a task filter for notification_request operations.
 */
export function notificationFilter(notificationRequestId: string): TaskEventFilter {
  return (event) =>
    typeof event.data.notificationRequestId === "string" &&
    event.data.notificationRequestId === notificationRequestId;
}

export function notificationTerminal(event: SseEvent): "completed" | "failed" | null {
  const status = event.data.status;
  if (status === "DELIVERED" || event.type === "NOTIFICATION_DELIVERED") return "completed";
  if (status === "FAILED" || event.type === "NOTIFICATION_FAILED") return "failed";
  return null;
}
