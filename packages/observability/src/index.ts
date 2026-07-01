import { LogEntry, StepUpdate, WorkflowStep, StepStatus } from '@ai-app-builder/core';
import * as fs from 'fs';
import * as path from 'path';

type LogLevel = 'info' | 'warn' | 'error' | 'debug';

export class Logger {
  private logs: LogEntry[] = [];
  private runId: string;
  private logDir: string;
  private logStream: fs.WriteStream | null = null;

  constructor(runId?: string) {
    this.runId = runId || 'unknown';
    this.logDir = process.env.LOG_DIR || path.join(process.cwd(), '.logs');
    
    try {
      if (!fs.existsSync(this.logDir)) {
        fs.mkdirSync(this.logDir, { recursive: true });
      }
      const logFile = path.join(this.logDir, `${this.runId}.jsonl`);
      this.logStream = fs.createWriteStream(logFile, { flags: 'a' });
    } catch {
      // File logging unavailable, fall back to in-memory only
    }
  }

  log(step: string, data: unknown, level: LogLevel = 'info'): void {
    const entry: LogEntry = {
      timestamp: new Date(),
      level,
      component: step,
      message: typeof data === 'string' ? data : JSON.stringify(data),
      metadata: typeof data === 'object' && data !== null ? data as Record<string, unknown> : undefined,
      runId: this.runId,
    };
    
    this.logs.push(entry);
    this.writeToStream(entry);
    
    // Always console.log for immediate visibility in dev
    const prefix = level === 'error' ? '❌' : level === 'warn' ? '⚠️' : level === 'debug' ? '🔍' : '✅';
    console.log(`${prefix} [${step}]`, typeof data === 'string' ? data : JSON.stringify(data, null, 2));
  }

  warn(step: string, data: unknown): void {
    this.log(step, data, 'warn');
  }

  error(step: string, data: unknown): void {
    this.log(step, data, 'error');
  }

  debug(step: string, data: unknown): void {
    this.log(step, data, 'debug');
  }

  createStepUpdate(
    step: WorkflowStep,
    status: StepStatus,
    message: string,
    detail?: string,
    payload?: Record<string, unknown>,
  ): StepUpdate {
    return {
      runId: this.runId,
      step,
      status,
      message,
      detail,
      timestamp: new Date().toISOString(),
      payload,
    };
  }

  getLogs(): LogEntry[] {
    return [...this.logs];
  }

  getRunLogs(runId: string): LogEntry[] {
    return this.logs.filter(l => l.runId === runId);
  }

  close(): void {
    if (this.logStream) {
      this.logStream.end();
    }
  }

  private writeToStream(entry: LogEntry): void {
    if (this.logStream) {
      try {
        this.logStream.write(JSON.stringify(entry) + '\n');
      } catch {
        // Silently fail on write errors
      }
    }
  }
}

export function createLogger(runId?: string): Logger {
  return new Logger(runId);
}
