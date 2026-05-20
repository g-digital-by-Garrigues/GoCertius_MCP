/**
 * MCP Tasks runtime scaffold (E3-05, FR-T-001..004, ADR-06).
 *
 * Wraps the SDK's experimental/tasks support.
 * Full SSE bridge to upstream GoCertius events is implemented in E7.
 * This module provides the core types and helper that emitted pollable tools use.
 */

export type TaskStatus = "running" | "completed" | "failed" | "cancelled";

export interface TaskState {
  taskId: string;
  status: TaskStatus;
  createdAt: number;
  updatedAt: number;
  result?: unknown;
  error?: string;
}

/**
 * In-memory task store for E3 scaffold.
 * E7 replaces/extends this with SSE bridge for upstream events.
 */
export class InMemoryTaskStore {
  private readonly tasks = new Map<string, TaskState>();
  private staleCheckInterval: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly staleTimeoutMs = 600_000) {
    // AC5: Start stale-task watchdog
    this.staleCheckInterval = setInterval(() => this.sweepStaleTasks(), 60_000);
    // Allow process to exit even if interval is running
    if (this.staleCheckInterval.unref) {
      this.staleCheckInterval.unref();
    }
  }

  create(taskId: string): TaskState {
    const state: TaskState = {
      taskId,
      status: "running",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.tasks.set(taskId, state);
    return state;
  }

  /** AC3: Get task state */
  get(taskId: string): TaskState | undefined {
    return this.tasks.get(taskId);
  }

  complete(taskId: string, result: unknown): void {
    const task = this.tasks.get(taskId);
    if (!task) return;
    task.status = "completed";
    task.result = result;
    task.updatedAt = Date.now();
  }

  fail(taskId: string, error: string): void {
    const task = this.tasks.get(taskId);
    if (!task) return;
    task.status = "failed";
    task.error = error;
    task.updatedAt = Date.now();
  }

  /** AC5: Mark tasks with no progress for > staleTimeoutMs as failed */
  private sweepStaleTasks(): void {
    const now = Date.now();
    for (const [id, task] of this.tasks) {
      if (task.status === "running" && now - task.updatedAt > this.staleTimeoutMs) {
        task.status = "failed";
        task.error = `Task timed out after ${this.staleTimeoutMs / 1000}s with no progress`;
        task.updatedAt = now;
      }
      // Clean up terminal tasks older than 1h
      if (task.status !== "running" && now - task.updatedAt > 3_600_000) {
        this.tasks.delete(id);
      }
    }
  }

  stop(): void {
    if (this.staleCheckInterval) {
      clearInterval(this.staleCheckInterval);
      this.staleCheckInterval = null;
    }
  }

  get size(): number {
    return this.tasks.size;
  }
}

export const taskStore = new InMemoryTaskStore();

/** Generate a unique task ID */
export function generateTaskId(): string {
  return `task_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}
