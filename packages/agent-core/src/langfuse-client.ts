/**
 * Langfuse tracing client - observability for task orchestration
 * Traces per task with generation spans for Bedrock calls and tool execution
 * Graceful degradation: if unreachable, logging continues without blocking tasks
 */

export interface LangfuseGenerationParams {
  name: string;
  input: string;
  output: string;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  costUSD?: number;
}

export interface LangfuseSpanParams {
  name: string;
  input?: string;
  output?: string;
  metadata?: Record<string, any>;
}

export interface LangfuseTraceParams {
  userId: string;
  sessionId: string;
  metadata: {
    orgId: string;
    tier: string;
    taskId: string;
  };
}

/**
 * Langfuse client wrapper - mock implementation for now
 * In production, integrate with real Langfuse API
 */
export class LangfuseClient {
  private traceId: string | null = null;

  constructor(
    private apiKey: string,
    private publicKey: string
  ) {}

  /**
   * Start a trace for a task
   */
  startTrace(params: LangfuseTraceParams): string {
    this.traceId = `trace-${Date.now()}-${Math.random().toString(36).substring(7)}`;
    return this.traceId;
  }

  /**
   * Log a generation (Bedrock call)
   */
  async logGeneration(params: LangfuseGenerationParams): Promise<void> {
    if (!this.traceId) {
      return;
    }

    try {
      // In production: POST to Langfuse API
      // POST https://api.langfuse.com/api/public/generations
      // with headers: Authorization: Bearer ${this.apiKey}
      // and body with trace_id, generation params, etc.

      // For now, just validate that sensitive data isn't being logged
      this.validateNoSecrets(params.input);
      this.validateNoSecrets(params.output);
    } catch (error) {
      // Graceful degradation: don't fail the task
      console.error('[Langfuse] Generation logging failed (non-blocking):', error);
    }
  }

  /**
   * Log a span (tool execution)
   */
  async logSpan(params: LangfuseSpanParams): Promise<void> {
    if (!this.traceId) {
      return;
    }

    try {
      this.validateNoSecrets(params.input);
      this.validateNoSecrets(params.output);
      this.validateNoSecrets(JSON.stringify(params.metadata));
    } catch (error) {
      console.error('[Langfuse] Span logging failed (non-blocking):', error);
    }
  }

  /**
   * End the trace
   */
  async endTrace(): Promise<void> {
    this.traceId = null;
  }

  /**
   * Validate no secrets in logged content
   */
  private validateNoSecrets(content?: string): void {
    if (!content) return;

    const sensitivePatterns = [
      /password[_-]?\w*["']?\s*[:=]/i,
      /secret[_-]?\w*["']?\s*[:=]/i,
      /token[_-]?\w*["']?\s*[:=]/i,
      /(api[_-]?key|apikey)["']?\s*[:=]/i,
      /access[_-]?token["']?\s*[:=]/i,
      /refresh[_-]?token["']?\s*[:=]/i,
      /private[_-]?key["']?\s*[:=]/i,
      /client[_-]?secret["']?\s*[:=]/i,
      /bearer\s+[a-z0-9_.-]+/i
    ];

    for (const pattern of sensitivePatterns) {
      if (pattern.test(content)) {
        throw new Error('Sensitive credential pattern detected in Langfuse span');
      }
    }
  }
}
